// Stromzähler – Einrichtung bei Cloudflare (einmalig).
// Aufruf im Ordner "worker":   node scripts/einrichten.mjs
//
// Fragt KEINE Zugangsdaten ab. Die Anmeldung bei Cloudflare passiert im Browser (wrangler login).
// Legt an: D1-Datenbank "stromzaehler", Tabellen, wrangler.toml (lokal, nicht im Repository), Worker.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(dir);
const WR = ['--yes', 'wrangler@4.159.0'];

function wrangler(args, { capture = false } = {}) {
  const r = spawnSync('npx', [...WR, ...args], { stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', shell: process.platform === 'win32', encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (capture) return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
  return { ok: r.status === 0 };
}
const schritt = (n, t) => console.log('\n━━━ Schritt ' + n + ': ' + t + ' ━━━');

schritt(1, 'Bei Cloudflare anmelden');
let who = wrangler(['whoami'], { capture: true });
if (!who.ok || /not authenticated|nicht angemeldet|You are not/i.test(who.out)) {
  console.log('Gleich öffnet sich der Browser. Melde dich dort bei Cloudflare an und klicke auf „Allow“.');
  if (!wrangler(['login']).ok) { console.error('Anmeldung fehlgeschlagen. Bitte erneut starten.'); process.exit(1); }
} else console.log('Bereits angemeldet ✓');

schritt(2, 'Datenbank „stromzaehler“ anlegen');
let id = null;
const list = wrangler(['d1', 'list', '--json'], { capture: true });
try { const j = JSON.parse(list.out.slice(list.out.indexOf('['))); id = (j.find((d) => d.name === 'stromzaehler') || {}).uuid || null; } catch {}
if (id) console.log('Datenbank gibt es schon ✓');
else {
  // Daten in der EU speichern (Jurisdiktion „eu“); falls nicht möglich: Standort Westeuropa
  let c = wrangler(['d1', 'create', 'stromzaehler', '--jurisdiction', 'eu'], { capture: true });
  if (!c.ok) c = wrangler(['d1', 'create', 'stromzaehler', '--location', 'weur'], { capture: true });
  console.log(c.out);
  const m = c.out.match(/database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/i);
  id = m && m[1];
  if (!id) { console.error('Datenbank-ID nicht gefunden. Bitte die Ausgabe oben an Claude schicken.'); process.exit(1); }
}
console.log('Datenbank-ID: ' + id + ' (keine geheime Angabe, steht nur lokal in wrangler.toml)');

schritt(3, 'Konfiguration wrangler.toml schreiben (bleibt lokal, steht in .gitignore)');
const tpl = readFileSync('wrangler.example.toml', 'utf8').replace('HIER-DATABASE-ID-EINTRAGEN', id);
if (existsSync('wrangler.toml') && !readFileSync('wrangler.toml', 'utf8').includes(id)) console.log('Vorhandene wrangler.toml wird ersetzt.');
writeFileSync('wrangler.toml', tpl);
console.log('wrangler.toml geschrieben ✓');

schritt(4, 'Tabellen anlegen');
if (!wrangler(['d1', 'execute', 'stromzaehler', '--remote', '--file', 'schema.sql', '--yes']).ok) { console.error('Tabellen konnten nicht angelegt werden.'); process.exit(1); }

schritt(5, 'Worker veröffentlichen');
console.log('Falls nach einer „workers.dev subdomain“ gefragt wird: einen Namen wählen, z. B. deinen Vornamen + Nachnamen.');
if (!wrangler(['deploy']).ok) { console.error('Veröffentlichen fehlgeschlagen. Bitte die Ausgabe an Claude schicken.'); process.exit(1); }

console.log(`
✅ Fertig.
Oben steht die Adresse deiner API, z. B.  https://stromzaehler-api.DEIN-NAME.workers.dev
1) Prüfen: diese Adresse + /health im Browser öffnen → dort muss "ok":true stehen.
2) Ersten Zugangscode anlegen:   node scripts/person-anlegen.mjs "Dein Vorname"
3) Die API-Adresse an Claude geben (oder in index.html bei DEFAULT_API eintragen).
`);
