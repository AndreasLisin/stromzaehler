// Erzeugt die App-Icons (PNG) ohne externe Bibliotheken: dunkler Hintergrund, blauer Blitz.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const bolt = [[0.58, 0.08], [0.24, 0.56], [0.47, 0.56], [0.40, 0.92], [0.77, 0.40], [0.53, 0.40], [0.62, 0.08]];
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function png(size, file, { maskable = false } = {}) {
  const S = 4; const raw = Buffer.alloc((size * 4 + 1) * size);
  const sc = maskable ? 0.62 : 0.8, off = (1 - sc) / 2;
  const P = bolt.map(([x, y]) => [off + x * sc, off + y * sc]);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cov = 0, inside = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
        const r = maskable ? 0 : 0.22; const dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - r)), dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - r));
        if (Math.hypot(dx, dy) <= r || maskable) { inside++; if (inPoly(u, v, P)) cov++; }
      }
      const n = S * S, a = inside / n, b = inside ? cov / inside : 0;
      const bg = [0x16, 0x20, 0x2e], fg = [0x3b, 0x82, 0xf6];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(bg[k] * (1 - b) + fg[k] * b);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
png(180, 'icon-180.png', { maskable: true });
png(192, 'icon-192.png');
png(512, 'icon-512.png');
png(512, 'icon-maskable-512.png', { maskable: true });
console.log('Icons erzeugt');
