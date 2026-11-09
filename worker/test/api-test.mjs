// Automatischer Test der API (Stufe a) gegen den lokalen Testserver mit frischer Datenbank.
//   node test/api-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'sz-test-'));
const dbFile = path.join(dir, 'test.sqlite');
const PORT = 8799;
const BASE = 'http://127.0.0.1:' + PORT;
const ORIGIN = 'http://localhost:8790';
const server = path.join(here, 'dev-server.mjs');

const code = execFileSync(process.execPath, [server, '--db', dbFile, '--person', '***TEST*** Anna'], { encoding: 'utf8' }).trim();
const srv = spawn(process.execPath, [server, '--db', dbFile, '--port', String(PORT), '--ki-attrappe'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

let ok = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
async function api(method, p, body, { token, origin = ORIGIN, ip } = {}) {
  const h = { 'content-type': 'application/json' };
  if (origin) h.Origin = origin;
  if (token) h.Authorization = 'Bearer ' + token;
  if (ip) h['x-test-ip'] = ip;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, h: r.headers };
}

try {
  console.log('Health & CORS');
  let r = await api('GET', '/health', null, { origin: null });
  check('/health ohne Anmeldung: ok, DB + Fotospeicher', r.status === 200 && r.j.datenbank === 'ok' && r.j.fotospeicher.startsWith('ok'), r.j);
  check('/health verrät keine Daten', !('ablesungen' in r.j) && Object.keys(r.j).every((k) => ['ok', 'datenbank', 'fotospeicher', 'ki', 'zeit'].includes(k)), r.j);
  r = await api('GET', '/daten', null, { origin: 'https://boese.example' });
  check('Fremde Herkunft → 403', r.status === 403, r);
  r = await api('GET', '/daten', null, { origin: null });
  check('Ohne Origin-Header → 403', r.status === 403, r);
  r = await api('OPTIONS', '/daten');
  check('Preflight von erlaubter Herkunft → 204 + CORS-Header', r.status === 204 && r.h.get('access-control-allow-origin') === ORIGIN);

  console.log('Ohne Anmeldung keine Daten');
  for (const p of ['/daten', '/fotos/abc', '/geraete', '/personen']) {
    r = await api('GET', p);
    check('GET ' + p + ' ohne Token → 401', r.status === 401, r.status);
  }
  r = await api('GET', '/daten', null, { token: 'x'.repeat(43) });
  check('Falsches Token → 401', r.status === 401);

  console.log('Anmeldung & Sperre');
  for (let i = 1; i <= 4; i++) {
    r = await api('POST', '/anmelden', { code: 'FALSCH-FALSCH-FALSCH', geraet: 'Test' }, { ip: '10.0.0.1' });
    check('Fehlversuch ' + i + ' → 401 mit Restversuchen', r.status === 401 && /Noch \d/.test(r.j.error), r.j);
  }
  r = await api('POST', '/anmelden', { code: 'FALSCH-FALSCH-FALSCH' }, { ip: '10.0.0.1' });
  check('5. Fehlversuch → 429 gesperrt', r.status === 429 && /gesperrt bis/.test(r.j.error), r.j);
  r = await api('POST', '/anmelden', { code, geraet: 'Test' }, { ip: '10.0.0.1' });
  check('Während Sperre hilft auch der richtige Code nicht', r.status === 429, r.j);
  r = await api('POST', '/anmelden', { code: code.toLowerCase().replace(/-/g, ' '), geraet: '***TEST*** iPhone' }, { ip: '10.0.0.2' });
  check('Richtiger Code von anderer IP (klein, mit Leerzeichen) → Token', r.status === 200 && r.j.token && r.j.person === '***TEST*** Anna', r.j);
  const tokA = r.j.token;
  r = await api('POST', '/anmelden', { code, geraet: '***TEST*** Android' }, { ip: '10.0.0.3' });
  const tokB = r.j.token, devB = r.j.geraet_id;
  check('Zweites Gerät angemeldet', r.status === 200 && tokB && tokB !== tokA);

  console.log('Daten');
  const meter = 'm-test-1';
  r = await api('PUT', '/zaehler/' + meter, { name: '***TEST*** Hauszähler', art: 'bezug', typ: 'mechanisch', stichtag: '12-31' }, { token: tokA });
  check('Zähler anlegen', r.status === 200, r.j);
  r = await api('POST', '/ablesungen', { id: 'r1', meter_id: meter, ts: '2026-01-01T11:00:00.000Z', value: 1000, source: 'hand', note: '***TEST***' }, { token: tokA });
  check('Ablesung von Gerät A', r.status === 200 && r.j.neu === 1, r.j);
  r = await api('POST', '/ablesungen', { id: 'r1', meter_id: meter, ts: '2026-01-01T11:00:00.000Z', value: 1000 }, { token: tokA });
  check('Gleiche ID nochmal (Offline-Wiederholung) → übersprungen', r.j.neu === 0 && r.j.uebersprungen === 1, r.j);
  r = await api('POST', '/ablesungen', { id: 'r1-dup', meter_id: meter, ts: '2026-01-01T11:00:20.000Z', value: 1000 }, { token: tokB });
  check('Gleicher Zeitpunkt + Stand mit anderer ID → als doppelt erkannt', r.j.neu === 0, r.j);
  r = await api('POST', '/ablesungen', { id: 'r2', meter_id: meter, ts: '2026-02-01T11:00:00.000Z', value: 1250.5, source: 'foto', ai_value: 1250.5, photo_id: 'r2', foto: { mime: 'image/jpeg', data: 'VEVTVA==' } }, { token: tokB });
  check('Ablesung mit Foto von Gerät B', r.j.neu === 1, r.j);
  r = await api('GET', '/daten', null, { token: tokA });
  check('Gerät A sieht Ablesung von Gerät B', r.j.ablesungen.length === 2 && r.j.ablesungen[1].created_by === '***TEST*** Anna', r.j);
  check('Daten enthalten keine Fotodaten', !JSON.stringify(r.j).includes('VEVTVA=='));
  r = await api('GET', '/fotos/r2', null, { token: tokA });
  check('Foto nur mit Token abrufbar', r.status === 200 && r.j.data === 'VEVTVA==', r.j);
  r = await api('GET', '/fotos/r2');
  check('Foto ohne Token → 401', r.status === 401);
  r = await api('POST', '/ablesungen', { liste: [
    { id: 'i1', meter_id: meter, ts: '2025-01-01T11:00:00Z', value: 500, source: 'import' },
    { id: 'i2', meter_id: meter, ts: '2025-06-01T10:00:00Z', value: 750, source: 'import' },
    { id: 'i3', meter_id: meter, ts: '2026-01-01T11:00:00Z', value: 1000, source: 'import' },
  ] }, { token: tokA });
  check('Import von 3 Altdaten, 1 doppelt erkannt', r.j.neu === 2 && r.j.uebersprungen === 1, r.j);
  r = await api('PUT', '/ablesungen/r2', { meter_id: meter, ts: '2026-02-01T11:00:00Z', value: 1250.7, note: 'korrigiert' }, { token: tokA });
  check('Ablesung bearbeiten', r.status === 200, r.j);
  r = await api('POST', '/ablesungen', { id: 'w1', meter_id: meter, ts: '2026-03-01T11:00:00Z', value: 3.2, kind: 'wechsel' }, { token: tokA });
  check('Zählerwechsel ohne Endstand → abgelehnt', r.status === 400, r.j);
  r = await api('POST', '/ablesungen', { id: 'w1', meter_id: meter, ts: '2026-03-01T11:00:00Z', value: 3.2, old_value: 1500, kind: 'wechsel' }, { token: tokA });
  check('Zählerwechsel mit Endstand', r.j.neu === 1, r.j);
  r = await api('POST', '/ablesungen', { id: 'x', meter_id: 'gibtsnicht', ts: '2026-03-01T11:00:00Z', value: 1 }, { token: tokA });
  check('Unbekannter Zähler → 400', r.status === 400);
  r = await api('DELETE', '/ablesungen/r2', null, { token: tokA });
  r = await api('GET', '/fotos/r2', null, { token: tokA });
  check('Löschen entfernt auch das Foto', r.status === 404);
  r = await api('PUT', '/tarife/t1', { meter_id: meter, valid_from: '2026-01-01', arbeitspreis_ct: 32.5, grundpreis_monat: 12.9, abschlag_monat: 85 }, { token: tokA });
  check('Tarif speichern', r.status === 200, r.j);
  r = await api('PUT', '/einstellungen/letzte_sicherung', { value: '2026-11-09T18:00:00Z' }, { token: tokA });
  r = await api('GET', '/daten', null, { token: tokB });
  check('Tarif + Einstellung für alle Geräte sichtbar', r.j.tarife.length === 1 && r.j.einstellungen.some((e) => e.key === 'letzte_sicherung'));

  console.log('Erkennung (KI-Attrappe, nur Ablauf)');
  r = await api('POST', '/erkennen', { bild: 'VEVTVA==', typ: 'mechanisch' }, { token: tokA });
  check('Antwort wird als Zahl 12345,6 gelesen', r.j.wert === 12345.6 && r.j.sicher === true, r.j);

  console.log('Geräte & Personen');
  r = await api('GET', '/geraete', null, { token: tokA });
  check('Geräteliste zeigt 2 Geräte', r.j.geraete.length === 2, r.j);
  r = await api('DELETE', '/geraete/' + devB, null, { token: tokA });
  r = await api('GET', '/daten', null, { token: tokB });
  check('Abgemeldetes Gerät B → 401', r.status === 401);
  r = await api('POST', '/personen', { name: '***TEST*** Ben' }, { token: tokA });
  check('Neue Person bekommt Code (einmalige Anzeige)', r.status === 200 && /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(r.j.code), r.j);
  const codeBen = r.j.code;
  r = await api('POST', '/anmelden', { code: codeBen, geraet: 'Ben' }, { ip: '10.0.0.4' });
  check('Ben kann sich anmelden', r.status === 200 && r.j.person === '***TEST*** Ben');
  const tokBen = r.j.token;
  r = await api('GET', '/personen', null, { token: tokA });
  const ben = r.j.personen.find((p) => p.name === '***TEST*** Ben');
  check('Personenliste enthält keine Hashes', !JSON.stringify(r.j).includes('code_hash'));
  r = await api('POST', '/personen/' + ben.id + '/neuer-code', null, { token: tokA });
  check('Neuer Code für Ben meldet seine Geräte ab', r.j.geraete_abgemeldet === 1, r.j);
  r = await api('GET', '/daten', null, { token: tokBen });
  check('Bens altes Token ungültig', r.status === 401);
  r = await api('POST', '/anmelden', { code: codeBen }, { ip: '10.0.0.5' });
  check('Alter Code von Ben ungültig', r.status === 401);

  console.log('Zähler löschen (Demo-Bereinigung)');
  r = await api('PUT', '/zaehler/demo', { name: '***TEST*** Demo', is_demo: 1 }, { token: tokA });
  r = await api('POST', '/ablesungen', { liste: [{ id: 'd1', meter_id: 'demo', ts: '2025-01-01T00:00:00Z', value: 1, source: 'demo' }] }, { token: tokA });
  r = await api('DELETE', '/zaehler/demo', null, { token: tokA });
  check('Demo-Zähler samt Ablesungen gelöscht', r.j.ablesungen_geloescht === 1, r.j);
  r = await api('GET', '/daten', null, { token: tokA });
  check('Echte Daten unberührt', r.j.zaehler.length === 1 && r.j.ablesungen.every((a) => a.meter_id === meter), r.j);

  r = await api('POST', '/abmelden', null, { token: tokA });
  r = await api('GET', '/daten', null, { token: tokA });
  check('Eigenes Abmelden wirkt', r.status === 401);
} finally {
  srv.kill();
  console.log(`\nErgebnis: ${ok} bestanden, ${fail} fehlgeschlagen`);
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); }, 300);
}
