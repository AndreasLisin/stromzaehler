// Stromzähler – API (Cloudflare Worker + D1 + Workers AI)
// Enthält keine Zugangsdaten. Alle Daten liegen in D1, erreichbar nur mit gültigem Geräte-Token.

const LOCK = {
  ipFails: 5,          // ab so vielen Fehlversuchen je IP: Sperre
  ipBaseMin: 15,       // erste Sperre 15 Min., danach jeweils doppelt so lang
  ipMaxMin: 24 * 60,   // höchstens 24 Std.
  ipResetMs: 24 * 3600e3,
  globalFails: 30,     // insgesamt 30 Fehlversuche in 60 Min. → alle Anmeldungen 60 Min. gesperrt
  globalWindowMs: 3600e3,
  globalLockMs: 3600e3,
};
const MAX_PHOTO_B64 = 400_000;      // ≈ 300 KB Binär – Puffer über den 150 KB des Frontends
const MAX_AI_B64 = 1_500_000;
const enc = new TextEncoder();

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = originOk
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };
    const send = (status, body) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...cors,
        },
      });

    try {
      if (url.pathname === '/health') return await health(env, send);
      if (!originOk) return send(403, { error: 'Herkunft nicht erlaubt.' });
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      const p = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
      const m = req.method;

      if (m === 'POST' && p[0] === 'anmelden') return await login(req, env, send);

      const me = await auth(req, env, ctx);
      if (!me) return send(401, { error: 'Nicht angemeldet.' });

      // --- Sitzung / Geräte / Personen ---
      if (m === 'POST' && p[0] === 'abmelden') {
        await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(iso(), me.geraet_id).run();
        return send(200, { ok: true });
      }
      if (m === 'GET' && p[0] === 'geraete') {
        const r = await env.DB.prepare(
          'SELECT d.id, d.name, d.user_agent, d.created_at, d.last_seen, u.name AS person FROM devices d JOIN users u ON u.id=d.user_id WHERE d.revoked_at IS NULL ORDER BY d.last_seen DESC'
        ).all();
        return send(200, { geraete: r.results, dieses: me.geraet_id });
      }
      if (m === 'DELETE' && p[0] === 'geraete' && p[1]) {
        const r = await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(iso(), p[1]).run();
        return send(200, { ok: true, abgemeldet: r.meta.changes });
      }
      if (m === 'GET' && p[0] === 'personen') {
        const r = await env.DB.prepare('SELECT id, name, active, created_at, created_by FROM users ORDER BY name').all();
        return send(200, { personen: r.results });
      }
      if (m === 'POST' && p[0] === 'personen' && !p[1]) {
        const b = await body(req);
        const name = cleanText(b.name, 40);
        if (!name) return send(400, { error: 'Name fehlt.' });
        const exists = await env.DB.prepare('SELECT id FROM users WHERE name=?').bind(name).first();
        if (exists) return send(409, { error: 'Diese Person gibt es schon. Nutze „Neuer Code“.' });
        const code = newCode();
        await env.DB.prepare('INSERT INTO users(name, code_hash, active, created_at, created_by) VALUES(?,?,1,?,?)')
          .bind(name, await sha256hex(normCode(code)), iso(), me.name).run();
        return send(200, { name, code });
      }
      if (m === 'POST' && p[0] === 'personen' && p[1] && p[2] === 'neuer-code') {
        const code = newCode();
        const id = Number(p[1]);
        const r = await env.DB.batch([
          env.DB.prepare('UPDATE users SET code_hash=?, active=1 WHERE id=?').bind(await sha256hex(normCode(code)), id),
          env.DB.prepare('UPDATE devices SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND id<>?').bind(iso(), id, me.geraet_id),
        ]);
        if (!r[0].meta.changes) return send(404, { error: 'Person nicht gefunden.' });
        return send(200, { code, geraete_abgemeldet: r[1].meta.changes });
      }
      if (m === 'PUT' && p[0] === 'personen' && p[1]) {
        const b = await body(req);
        const id = Number(p[1]);
        if (id === me.user_id && b.active === 0) return send(400, { error: 'Du kannst dich nicht selbst deaktivieren.' });
        const stmts = [env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(b.active ? 1 : 0, id)];
        if (!b.active) stmts.push(env.DB.prepare('UPDATE devices SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(iso(), id));
        await env.DB.batch(stmts);
        return send(200, { ok: true });
      }

      // --- Daten ---
      if (m === 'GET' && p[0] === 'daten') {
        const [zr, ar, tr, er] = await env.DB.batch([
          env.DB.prepare('SELECT * FROM meters ORDER BY is_demo, sort, created_at'),
          env.DB.prepare('SELECT id, meter_id, ts, value, old_value, kind, source, ai_value, note, photo_id, created_by, created_at, updated_by, updated_at FROM readings ORDER BY meter_id, ts'),
          env.DB.prepare('SELECT * FROM tariffs ORDER BY meter_id, valid_from'),
          env.DB.prepare('SELECT key, value, updated_by, updated_at FROM settings'),
        ]);
        return send(200, {
          person: me.name,
          geraet_id: me.geraet_id,
          zaehler: zr.results,
          ablesungen: ar.results,
          tarife: tr.results,
          einstellungen: er.results,
          serverzeit: iso(),
        });
      }

      // Zähler anlegen/ändern (Upsert über Client-ID)
      if (m === 'PUT' && p[0] === 'zaehler' && p[1]) {
        const b = await body(req);
        const name = cleanText(b.name, 60);
        if (!name) return send(400, { error: 'Name fehlt.' });
        const art = ['bezug', 'einspeisung', 'waermepumpe', 'sonstiges'].includes(b.art) ? b.art : 'bezug';
        const typ = ['mechanisch', 'digital'].includes(b.typ) ? b.typ : 'mechanisch';
        const stichtag = /^\d\d-\d\d$/.test(b.stichtag || '') ? b.stichtag : '12-31';
        await env.DB.prepare(
          `INSERT INTO meters(id, name, art, obis, typ, stichtag, is_demo, sort, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, art=excluded.art, obis=excluded.obis, typ=excluded.typ, stichtag=excluded.stichtag, sort=excluded.sort`
        ).bind(cleanId(p[1]), name, art, cleanText(b.obis, 12) || '1.8.0', typ, stichtag, b.is_demo ? 1 : 0, Number(b.sort) || 0, b.created_at || iso(), b.created_by || me.name).run();
        return send(200, { ok: true });
      }
      if (m === 'DELETE' && p[0] === 'zaehler' && p[1]) {
        const id = cleanId(p[1]);
        const r = await env.DB.batch([
          env.DB.prepare('DELETE FROM photos WHERE reading_id IN (SELECT id FROM readings WHERE meter_id=?)').bind(id),
          env.DB.prepare('DELETE FROM readings WHERE meter_id=?').bind(id),
          env.DB.prepare('DELETE FROM tariffs WHERE meter_id=?').bind(id),
          env.DB.prepare('DELETE FROM meters WHERE id=?').bind(id),
        ]);
        return send(200, { ok: true, ablesungen_geloescht: r[1].meta.changes, fotos_geloescht: r[0].meta.changes });
      }

      // Ablesungen: eine oder viele (Import). Doppelte werden übersprungen.
      if (m === 'POST' && p[0] === 'ablesungen') {
        const b = await body(req);
        const liste = Array.isArray(b.liste) ? b.liste : [b];
        if (liste.length > 500) return send(400, { error: 'Höchstens 500 Ablesungen je Anfrage.' });
        const meters = new Set((await env.DB.prepare('SELECT id FROM meters').all()).results.map((r) => r.id));
        const rows = [];
        for (const x of liste) {
          const v = validReading(x, meters);
          if (v.error) return send(400, { error: v.error });
          rows.push(v.row);
        }
        const stmts = [
          env.DB.prepare(
            `INSERT OR IGNORE INTO readings(id, meter_id, ts, value, old_value, kind, source, ai_value, note, photo_id, created_by, created_at)
             SELECT json_extract(j.value,'$.id'), json_extract(j.value,'$.meter_id'), json_extract(j.value,'$.ts'), json_extract(j.value,'$.value'),
                    json_extract(j.value,'$.old_value'), json_extract(j.value,'$.kind'), json_extract(j.value,'$.source'), json_extract(j.value,'$.ai_value'),
                    json_extract(j.value,'$.note'), json_extract(j.value,'$.photo_id'), coalesce(json_extract(j.value,'$.created_by'), ?2),
                    coalesce(json_extract(j.value,'$.created_at'), ?3)
             FROM json_each(?1) j
             WHERE NOT EXISTS (
               SELECT 1 FROM readings r
               WHERE r.id = json_extract(j.value,'$.id')
                  OR (r.meter_id = json_extract(j.value,'$.meter_id')
                      AND abs(julianday(r.ts) - julianday(json_extract(j.value,'$.ts'))) < (1.0/1440)
                      AND abs(r.value - json_extract(j.value,'$.value')) < 0.0005))`
          ).bind(JSON.stringify(rows), me.name, iso()),
        ];
        const foto = b.foto;
        if (!Array.isArray(b.liste) && foto && foto.data) {
          if (String(foto.data).length > MAX_PHOTO_B64) return send(413, { error: 'Foto zu groß.' });
          stmts.push(
            env.DB.prepare('INSERT OR IGNORE INTO photos(id, reading_id, mime, data, bytes, created_at) VALUES(?,?,?,?,?,?)')
              .bind(rows[0].photo_id || rows[0].id, rows[0].id, foto.mime || 'image/jpeg', String(foto.data), Math.round(String(foto.data).length * 0.75), iso())
          );
        }
        const r = await env.DB.batch(stmts);
        return send(200, { neu: r[0].meta.changes, uebersprungen: rows.length - r[0].meta.changes });
      }
      if (m === 'PUT' && p[0] === 'ablesungen' && p[1]) {
        const b = await body(req);
        const meters = new Set((await env.DB.prepare('SELECT id FROM meters').all()).results.map((r) => r.id));
        const v = validReading({ ...b, id: p[1] }, meters);
        if (v.error) return send(400, { error: v.error });
        const x = v.row;
        const r = await env.DB.prepare(
          'UPDATE readings SET meter_id=?, ts=?, value=?, old_value=?, kind=?, note=?, updated_by=?, updated_at=? WHERE id=?'
        ).bind(x.meter_id, x.ts, x.value, x.old_value, x.kind, x.note, me.name, iso(), x.id).run();
        if (!r.meta.changes) return send(404, { error: 'Ablesung nicht gefunden (evtl. auf einem anderen Gerät gelöscht).' });
        return send(200, { ok: true });
      }
      if (m === 'DELETE' && p[0] === 'ablesungen' && p[1]) {
        const id = cleanId(p[1]);
        const r = await env.DB.batch([
          env.DB.prepare('DELETE FROM photos WHERE reading_id=?').bind(id),
          env.DB.prepare('DELETE FROM readings WHERE id=?').bind(id),
        ]);
        return send(200, { ok: true, geloescht: r[1].meta.changes });
      }

      // Fotos – nur mit Token, keine direkte URL
      if (m === 'GET' && p[0] === 'fotos' && p[1]) {
        const f = await env.DB.prepare('SELECT id, reading_id, mime, data FROM photos WHERE id=?').bind(cleanId(p[1])).first();
        if (!f) return send(404, { error: 'Foto nicht gefunden.' });
        return send(200, f);
      }
      if (m === 'PUT' && p[0] === 'fotos' && p[1]) {
        const b = await body(req);
        if (!b.data || String(b.data).length > MAX_PHOTO_B64) return send(400, { error: 'Foto fehlt oder ist zu groß.' });
        const r = await env.DB.prepare(
          'INSERT INTO photos(id, reading_id, mime, data, bytes, created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING'
        ).bind(cleanId(p[1]), cleanId(b.reading_id || ''), b.mime || 'image/jpeg', String(b.data), Math.round(String(b.data).length * 0.75), b.created_at || iso()).run();
        return send(200, { neu: r.meta.changes });
      }

      // Tarife (Upsert)
      if (m === 'PUT' && p[0] === 'tarife' && p[1]) {
        const b = await body(req);
        if (!/^\d{4}-\d\d-\d\d$/.test(b.valid_from || '')) return send(400, { error: 'Gültig-ab-Datum fehlt.' });
        const ap = Number(b.arbeitspreis_ct);
        if (!Number.isFinite(ap) || ap < 0 || ap > 500) return send(400, { error: 'Arbeitspreis unplausibel.' });
        await env.DB.prepare(
          `INSERT INTO tariffs(id, meter_id, valid_from, arbeitspreis_ct, grundpreis_monat, abschlag_monat, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET meter_id=excluded.meter_id, valid_from=excluded.valid_from, arbeitspreis_ct=excluded.arbeitspreis_ct,
             grundpreis_monat=excluded.grundpreis_monat, abschlag_monat=excluded.abschlag_monat, note=excluded.note`
        ).bind(cleanId(p[1]), cleanId(b.meter_id || ''), b.valid_from, ap, num0(b.grundpreis_monat), num0(b.abschlag_monat), cleanText(b.note, 200), b.created_by || me.name, b.created_at || iso()).run();
        return send(200, { ok: true });
      }
      if (m === 'DELETE' && p[0] === 'tarife' && p[1]) {
        await env.DB.prepare('DELETE FROM tariffs WHERE id=?').bind(cleanId(p[1])).run();
        return send(200, { ok: true });
      }

      // Einstellungen
      if (m === 'PUT' && p[0] === 'einstellungen' && p[1]) {
        const b = await body(req);
        const key = cleanId(p[1]);
        await env.DB.prepare(
          'INSERT INTO settings(key, value, updated_by, updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at'
        ).bind(key, cleanText(String(b.value ?? ''), 2000), me.name, iso()).run();
        return send(200, { ok: true });
      }

      // Zählerstand aus Foto erkennen (Workers AI)
      if (m === 'POST' && p[0] === 'erkennen') {
        const b = await body(req);
        return send(200, await erkennen(env, b));
      }

      return send(404, { error: 'Unbekannte Adresse.' });
    } catch (e) {
      return send(500, { error: 'Serverfehler: ' + (e && e.message ? e.message : String(e)) });
    }
  },
};

// ---------------------------------------------------------------- Hilfsfunktionen

async function health(env, send) {
  const out = { ok: false, datenbank: 'fehler', fotospeicher: 'fehler', ki: env.AI ? 'eingerichtet' : 'nicht eingerichtet', zeit: iso() };
  try {
    await env.DB.prepare('SELECT 1 FROM readings LIMIT 1').all();
    out.datenbank = 'ok';
    await env.DB.prepare('SELECT 1 FROM photos LIMIT 1').all();
    out.fotospeicher = 'ok (D1)';
    out.ok = true;
  } catch (e) {
    out.fehler = String(e && e.message ? e.message : e).slice(0, 200);
  }
  return send(out.ok ? 200 : 503, out);
}

async function login(req, env, send) {
  const ip = req.headers.get('CF-Connecting-IP') || 'lokal';
  const now = Date.now();
  const ipKey = 'ip:' + ip;
  const gKey = 'global';
  const rs = await env.DB.prepare('SELECT key, fails, locked_until, window_start FROM login_attempts WHERE key IN (?,?)').bind(ipKey, gKey).all();
  const att = Object.fromEntries(rs.results.map((r) => [r.key, r]));
  for (const k of [ipKey, gKey]) {
    if (att[k] && att[k].locked_until > now) {
      return send(429, { error: 'Zu viele Fehlversuche. Anmeldung gesperrt bis ' + berlin(att[k].locked_until) + ' Uhr.', gesperrt_bis: att[k].locked_until });
    }
  }
  const b = await body(req);
  const code = normCode(b.code);
  const user = code.length >= 10
    ? await env.DB.prepare('SELECT id, name FROM users WHERE code_hash=? AND active=1').bind(await sha256hex(code)).first()
    : null;

  if (!user) {
    const ipRow = att[ipKey];
    let fails = ipRow && now - ipRow.window_start < LOCK.ipResetMs ? ipRow.fails + 1 : 1;
    let lockUntil = 0;
    if (fails >= LOCK.ipFails) {
      const mins = Math.min(LOCK.ipMaxMin, LOCK.ipBaseMin * 2 ** (fails - LOCK.ipFails));
      lockUntil = now + mins * 60000;
    }
    const g = att[gKey];
    let gFails = 1, gStart = now;
    if (g && now - g.window_start < LOCK.globalWindowMs) { gFails = g.fails + 1; gStart = g.window_start; }
    const gLock = gFails >= LOCK.globalFails ? now + LOCK.globalLockMs : 0;
    const up = 'INSERT INTO login_attempts(key, fails, locked_until, window_start) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until, window_start=excluded.window_start';
    await env.DB.batch([
      env.DB.prepare(up).bind(ipKey, fails, lockUntil, now),
      env.DB.prepare(up).bind(gKey, gLock ? 0 : gFails, gLock, gLock ? now : gStart),
    ]);
    if (lockUntil || gLock) {
      return send(429, { error: 'Code falsch. Zu viele Fehlversuche – Anmeldung gesperrt bis ' + berlin(Math.max(lockUntil, gLock)) + ' Uhr.', gesperrt_bis: Math.max(lockUntil, gLock) });
    }
    return send(401, { error: 'Code falsch. Noch ' + (LOCK.ipFails - fails) + ' Versuch(e) bis zur Sperre.' });
  }

  const token = newToken();
  const devId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(ipKey),
    env.DB.prepare('INSERT INTO devices(id, user_id, token_hash, name, user_agent, created_at, last_seen) VALUES(?,?,?,?,?,?,?)')
      .bind(devId, user.id, await sha256hex(token), cleanText(b.geraet, 60) || 'Gerät', (req.headers.get('User-Agent') || '').slice(0, 200), iso(), iso()),
  ]);
  return send(200, { token, person: user.name, geraet_id: devId });
}

async function auth(req, env, ctx) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const row = await env.DB.prepare(
    'SELECT d.id AS geraet_id, d.last_seen, u.id AS user_id, u.name FROM devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=? AND d.revoked_at IS NULL AND u.active=1'
  ).bind(await sha256hex(m[1])).first();
  if (!row) return null;
  if (Date.now() - Date.parse(row.last_seen) > 3600e3) {
    ctx.waitUntil(env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(iso(), row.geraet_id).run());
  }
  return row;
}

function validReading(x, meters) {
  if (!x || typeof x !== 'object') return { error: 'Ablesung fehlt.' };
  const id = cleanId(x.id);
  if (!id) return { error: 'ID fehlt.' };
  if (!meters.has(x.meter_id)) return { error: 'Unbekannter Zähler.' };
  const t = Date.parse(x.ts);
  if (!Number.isFinite(t) || t < Date.UTC(1990, 0, 1) || t > Date.now() + 2 * 86400e3) return { error: 'Datum ungültig: ' + x.ts };
  const value = Number(x.value);
  if (!Number.isFinite(value) || value < 0 || value > 1e8) return { error: 'Zählerstand ungültig.' };
  const kind = x.kind === 'wechsel' ? 'wechsel' : 'normal';
  let old = x.old_value == null || x.old_value === '' ? null : Number(x.old_value);
  if (kind === 'wechsel' && !Number.isFinite(old)) return { error: 'Beim Zählerwechsel fehlt der Endstand des alten Zählers.' };
  if (kind !== 'wechsel') old = null;
  const source = ['foto', 'hand', 'import', 'demo'].includes(x.source) ? x.source : 'hand';
  const ai = x.ai_value == null || x.ai_value === '' ? null : Number(x.ai_value);
  return {
    row: {
      id,
      meter_id: x.meter_id,
      ts: new Date(t).toISOString(),
      value,
      old_value: old,
      kind,
      source,
      ai_value: Number.isFinite(ai) ? ai : null,
      note: cleanText(x.note, 300) || null,
      photo_id: x.photo_id ? cleanId(x.photo_id) : null,
      created_by: x.created_by ? cleanText(x.created_by, 40) : null,
      created_at: x.created_at && Number.isFinite(Date.parse(x.created_at)) ? new Date(Date.parse(x.created_at)).toISOString() : null,
    },
  };
}

async function erkennen(env, b) {
  if (!env.AI) return { wert: null, fehler: 'Workers AI ist nicht eingerichtet.' };
  const bild = String(b.bild || '');
  if (!bild || bild.length > MAX_AI_B64) return { wert: null, fehler: 'Bild fehlt oder ist zu groß.' };
  const typ = b.typ === 'digital' ? 'digital' : b.typ === 'mechanisch' ? 'mechanisch' : 'unbekannt';
  const prompt = [
    'Du siehst einen Bildausschnitt eines Stromzählers. Lies den Zählerstand in kWh ab.',
    'Zählertyp laut Nutzer: ' + typ + '.',
    'Regeln:',
    '- Mechanischer Rollenzähler: alle Ziffernrollen von links nach rechts lesen. Rollen, die rot sind oder rot umrandet sind (meist die letzte), sind Nachkommastellen. Steht eine Rolle zwischen zwei Ziffern, nimm die kleinere.',
    '- Digitaler Zähler oder moderne Messeinrichtung: nimm den Wert zur Kennzahl 1.8.0 (Bezug). Werte zu 2.8.0 (Einspeisung) ignorieren.',
    '- Niemals Zählernummer, Seriennummer, Datum, Leistung in W oder Umdrehungen/kWh als Zählerstand nehmen.',
    'Antworte ausschließlich mit JSON ohne weitere Worte, Dezimaltrennzeichen Komma:',
    '{"wert":"12345,6","typ":"mechanisch oder digital","sicher":true,"hinweis":"kurz, z. B. letzte Stelle unscharf"}',
    'Wenn du keinen Zählerstand erkennst: {"wert":null,"sicher":false,"hinweis":"Grund"}',
  ].join('\n');
  const model = env.AI_MODEL || '@cf/mistralai/mistral-small-3.1-24b-instruct';
  let res;
  try {
    res = await env.AI.run(model, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + bild } },
          ],
        },
      ],
      max_tokens: 150,
      temperature: 0,
    });
  } catch (e) {
    return { wert: null, fehler: 'KI-Fehler: ' + String(e && e.message ? e.message : e).slice(0, 200), modell: model };
  }
  const text = typeof res === 'string' ? res : res?.response ?? res?.choices?.[0]?.message?.content ?? JSON.stringify(res);
  const raw = typeof text === 'string' ? text : JSON.stringify(text);
  let j = null;
  const mm = raw.match(/\{[\s\S]*\}/);
  if (mm) { try { j = JSON.parse(mm[0]); } catch { j = null; } }
  const wert = parseDeNumber(j ? j.wert : raw);
  return { wert, sicher: !!(j && j.sicher && wert != null), typ: j?.typ || null, hinweis: j?.hinweis ? String(j.hinweis).slice(0, 200) : null, roh: raw.slice(0, 400), modell: model };
}

function parseDeNumber(v) {
  if (v == null) return null;
  let s = String(v).replace(/\s|kwh/gi, '');
  const m = s.match(/[\d.,]+/);
  if (!m) return null;
  s = m[0];
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function body(req) {
  try { return (await req.json()) || {}; } catch { return {}; }
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let s = '';
  while (s.length < 20) {
    for (const x of crypto.getRandomValues(new Uint8Array(32))) {
      if (x < 248 && s.length < 20) s += ALPH[x % 31]; // ohne Verzerrung
    }
  }
  return s.match(/.{5}/g).join('-');
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function iso() { return new Date().toISOString(); }
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function cleanText(v, max) { return v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function cleanId(v) { return String(v || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64); }
function berlin(ms) {
  try {
    return new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ms).toISOString();
  }
}
