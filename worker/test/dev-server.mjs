// Lokaler Testserver für den Worker OHNE Cloudflare-Laufzeit (workerd ist auf Firmen-PCs oft gesperrt).
// Bildet D1 mit node:sqlite nach (gleiche SQLite-Engine). Nur für Tests mit erfundenen Daten.
//
//   node test/dev-server.mjs --db <pfad.sqlite> [--port 8787] [--origins http://localhost:8790]
//   node test/dev-server.mjs --db <pfad.sqlite> --person "Testperson"   → legt Person an, gibt Code aus
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const dbFile = arg('db', ':memory:');
const db = new DatabaseSync(dbFile);
db.exec(readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));

class Stmt {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.sql, p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))); }
  _exec() {
    const st = db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      const rows = st.all(...this.params).map((r) => ({ ...r }));
      return { success: true, results: rows, meta: { changes: 0 } };
    }
    const r = st.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first(col) { const r = this._exec().results[0] ?? null; return col && r ? r[col] : r; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(stmts) {
    db.exec('BEGIN');
    try { const out = stmts.map((s) => s._exec()); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};

if (process.argv.includes('--person')) {
  const name = arg('person');
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 20; i++) c += A[randomInt(31)];
  const code = c.match(/.{5}/g).join('-');
  const hash = createHash('sha256').update(c).digest('hex');
  db.prepare('INSERT INTO users(name, code_hash, active, created_at, created_by) VALUES(?,?,1,?,?) ON CONFLICT(name) DO UPDATE SET code_hash=excluded.code_hash, active=1')
    .run(name, hash, new Date().toISOString(), 'Test');
  console.log(code);
  process.exit(0);
}

const env = {
  DB,
  ALLOWED_ORIGINS: arg('origins', 'http://localhost:8790,http://127.0.0.1:8790'),
  AI_MODEL: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  // Für Tests: KI-Attrappe, liefert festen Wert (zeigt nur den Ablauf, nicht die Erkennungsqualität)
  AI: process.argv.includes('--ki-attrappe')
    ? { run: async () => ({ response: '{"wert":"12345,6","typ":"mechanisch","sicher":true,"hinweis":"***TEST*** Attrappe"}' }) }
    : undefined,
};
const port = Number(arg('port', 8787));
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('CF-Connecting-IP', req.headers['x-test-ip'] || req.socket.remoteAddress || 'lokal');
  const request = new Request('http://localhost:' + port + req.url, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const waits = [];
  const r = await worker.fetch(request, env, { waitUntil: (p) => waits.push(p) });
  const out = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(out);
  await Promise.allSettled(waits);
}).listen(port, '127.0.0.1', () => console.log('Test-API läuft auf http://127.0.0.1:' + port + ' (DB: ' + dbFile + ')'));
