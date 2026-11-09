// Legt eine Person mit neuem Zugangscode an (oder erneuert den Code einer vorhandenen Person).
// Aufruf im Ordner "worker":   node scripts/person-anlegen.mjs "Vorname"
//
// Der Code wird hier zufällig erzeugt (20 Zeichen ≈ 99 Bit), EINMAL angezeigt und nur als SHA-256-Hash
// in die Datenbank geschrieben. Er wird nirgends gespeichert – bitte sofort notieren.
import { createHash, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = (process.argv[2] || '').trim();
if (!name) { console.error('Bitte Namen angeben:  node scripts/person-anlegen.mjs "Vorname"'); process.exit(1); }
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let raw = '';
for (let i = 0; i < 20; i++) raw += A[randomInt(A.length)];
const code = raw.match(/.{5}/g).join('-');
const hash = createHash('sha256').update(raw).digest('hex');
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = `INSERT INTO users(name, code_hash, active, created_at, created_by) VALUES(${q(name)}, ${q(hash)}, 1, ${q(new Date().toISOString())}, 'Einrichtung')
ON CONFLICT(name) DO UPDATE SET code_hash=excluded.code_hash, active=1;\n`;

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sz-'));
const file = path.join(tmp, 'person.sql');
writeFileSync(file, sql);
const r = spawnSync('npx', ['--yes', 'wrangler@4.159.0', 'd1', 'execute', 'stromzaehler', '--remote', '--file', process.platform === 'win32' ? '"' + file + '"' : file, '--yes'], { stdio: ['inherit', 'pipe', 'inherit'], shell: process.platform === 'win32', encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
try { unlinkSync(file); } catch {}
if (r.status !== 0) { console.error(r.stdout || ''); console.error('Fehler beim Schreiben in die Datenbank.'); process.exit(1); }

console.log(`
┌──────────────────────────────────────────────┐
  Zugangscode für ${name}:

      ${code}

  Nur JETZT sichtbar. Bitte notieren und persönlich
  weitergeben (nicht per Mail/Chat).
└──────────────────────────────────────────────┘`);
