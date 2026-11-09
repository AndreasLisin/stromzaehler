// Prüft die Rechenfunktionen aus index.html (Abschnitt CALC) mit den Demo-Daten.
//   node test/calc-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', '..', 'index.html'), 'utf8');
const code = html.split('// ==CALC-START==')[1].split('// ==CALC-END==')[0];
const ctx = vm.createContext({ Intl, Date, Math, Number, String, Map, Array, Object, JSON });
vm.runInContext(code + '\n;globalThis.C={bParts,bLocalToMs,key,dayKeyOf,addDays,daysInMonth,dayStart,isoWeek,weeksInYear,isoWeekStartKey,shiftYear,buildPoints,buildDays,aggregate,cumAt,rangeKwh,avgPerDay,projectYear,costByMonth,billing,checkReading,parseDe,fmtN,fmtKwh,fmtEur,genDemo,DAY};', ctx);
const C = ctx.C;

let ok = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

console.log('Kalender & Zeitzone');
for (const [k, y, w] of [['2020-12-31', 2020, 53], ['2021-01-03', 2020, 53], ['2021-01-04', 2021, 1], ['2024-12-30', 2025, 1], ['2026-01-01', 2026, 1], ['2026-12-31', 2026, 53], ['2027-01-03', 2026, 53], ['2025-06-15', 2025, 24]]) {
  const r = C.isoWeek(k);
  check(`ISO-KW ${k} = ${y}-W${w}`, r.y === y && r.w === w, r);
}
check('2026 hat 53 KW, 2025 hat 52', C.weeksInYear(2026) === 53 && C.weeksInYear(2025) === 52);
check('Montag KW 1/2026 = 29.12.2025', C.isoWeekStartKey(2026, 1) === '2025-12-29');
check('29.03.2026 hat 23 Stunden (Sommerzeit)', C.dayStart('2026-03-30') - C.dayStart('2026-03-29') === 23 * 3600e3);
check('25.10.2026 hat 25 Stunden (Winterzeit)', C.dayStart('2026-10-26') - C.dayStart('2026-10-25') === 25 * 3600e3);
check('Mitternacht Berlin 01.07.2026 = 22:00 UTC Vortag', new Date(C.bLocalToMs(2026, 7, 1)).toISOString() === '2026-06-30T22:00:00.000Z');
check('Mitternacht Berlin 01.01.2026 = 23:00 UTC Vortag', new Date(C.bLocalToMs(2026, 1, 1)).toISOString() === '2025-12-31T23:00:00.000Z');
check('Zahl lesen „31.845,6“ → 31845,6', C.parseDe('31.845,6') === 31845.6 && C.parseDe('31845.6') === 31845.6 && C.parseDe('1.234') === 1234);
check('Format 1.234,5 kWh / 1.234,56 €', C.fmtKwh(1234.5) === '1.234,5 kWh' && C.fmtEur(1234.56) === '1.234,56 €', [C.fmtKwh(1234.5), C.fmtEur(1234.56)]);

console.log('Demo-Daten (***TEST***)');
const now = Date.UTC(2026, 10, 9, 18, 0);
const demo = C.genDemo('demo', now);
const pts = C.buildPoints(demo);
const { days, intervals } = C.buildDays(pts);
const agg = C.aggregate(days);
console.log('    ' + demo.length + ' Ablesungen von ' + demo[0].ts.slice(0, 10) + ' bis ' + demo[demo.length - 1].ts.slice(0, 10));
check('Ablesungen über 3 Jahre', demo.length > 150 && demo[0].ts < '2023-10-03' && demo[demo.length - 1].ts > '2026-11-01');
check('Alle Demo-Daten als ***TEST*** markiert', demo.every((r) => r.note.includes('***TEST***')));
const w = demo.find((r) => r.kind === 'wechsel');
check('Zählerwechsel enthalten (alt ' + w.old_value + ' → neu ' + w.value + ')', !!w && w.old_value > 30000 && w.value === 0);
check('Reihe läuft beim Zählerwechsel durchgehend weiter (kein Sprung)', pts.every((p, i) => i === 0 || p.c >= pts[i - 1].c - 1e-9));
check('Lücke ≈ 6 Wochen als Schätzung erkannt', intervals.some((iv) => iv.est && (iv.t1 - iv.t0) / C.DAY > 30));

const total = pts[pts.length - 1].c - pts[0].c;
let sumDays = 0; for (const o of days.values()) sumDays += o.kwh;
check('Summe aller Tage = Gesamtverbrauch laut Zähler (' + C.fmtKwh(total) + ')', near(sumDays, total, 1e-9), [sumDays, total]);
let sumYears = 0;
for (const [y, Y] of Object.entries(agg.years)) {
  const sm = Y.months.reduce((s, m) => s + m.kwh, 0);
  sumYears += Y.kwh;
  check(`${y}: Summe der Monate (${C.fmtKwh(sm)}) = Jahresverbrauch (${C.fmtKwh(Y.kwh)})`, near(sm, Y.kwh, 1e-9));
}
check('Summe der Jahre = Gesamtverbrauch', near(sumYears, total, 1e-9));
let sumWeeks = 0; for (const W of Object.values(agg.weeks)) for (const o of Object.values(W)) sumWeeks += o.kwh;
check('Summe aller KW = Gesamtverbrauch', near(sumWeeks, total, 1e-9));

// Unabhängige Gegenrechnung: Zählerstand an den Monats-/Wochengrenzen interpolieren
let mOk = 0, mN = 0, mBad = [];
for (const [y, Y] of Object.entries(agg.years)) {
  Y.months.forEach((o, i) => {
    const a = C.bLocalToMs(+y, i + 1, 1), b = C.bLocalToMs(i === 11 ? +y + 1 : +y, i === 11 ? 1 : i + 2, 1);
    const r = C.rangeKwh(pts, a, b);
    if (r == null) return;
    mN++;
    if (near(r, o.kwh, 1e-9)) mOk++; else mBad.push([y, i + 1, r, o.kwh]);
  });
}
check(`Alle ${mN} vollständigen Monate stimmen mit Gegenrechnung überein`, mOk === mN && mN >= 30, mBad.slice(0, 3));
let wOk = 0, wN = 0, wBad = [];
for (const [y, W] of Object.entries(agg.weeks)) for (const [wk, o] of Object.entries(W)) {
  const sk = C.isoWeekStartKey(+y, +wk);
  const r = C.rangeKwh(pts, C.dayStart(sk), C.dayStart(C.addDays(sk, 7)));
  if (r == null) continue;
  wN++;
  if (near(r, o.kwh, 1e-9)) wOk++; else wBad.push([y, wk, r, o.kwh]);
}
check(`Alle ${wN} vollständigen KW stimmen mit Gegenrechnung überein`, wOk === wN && wN >= 140, wBad.slice(0, 3));
const y2025 = agg.years[2025];
check('2025 vollständig erfasst (365 Tage)', near(y2025.cov, 365, 1e-9), y2025.cov);
check('2025 plausibel (2.500–3.500 kWh): ' + C.fmtKwh(y2025.kwh, 0), y2025.kwh > 2500 && y2025.kwh < 3500);
check('Geschätzter Anteil 2025 ausgewiesen (Urlaubslücke)', y2025.est > 0 && y2025.months[6].estCov / y2025.months[6].cov > 0.5);

console.log('Kennzahlen, Kosten, Plausibilität');
const pr = C.projectYear(pts, 2026);
check('Hochrechnung 2026 plausibel: ' + C.fmtKwh(pr.total, 0) + ' (' + pr.methode + ')', pr.total > 2400 && pr.total < 3600 && pr.rest > 0);
const avg = C.avgPerDay(pts);
check('Ø/Tag (365 T) plausibel: ' + C.fmtN(avg, 2), avg > 6 && avg < 11);
const tarife = [
  { valid_from: '2023-01-01', arbeitspreis_ct: 40.12, grundpreis_monat: 13.5, abschlag_monat: 110 },
  { valid_from: '2025-01-01', arbeitspreis_ct: 34.9, grundpreis_monat: 14.2, abschlag_monat: 95 },
];
const cm = C.costByMonth(days, tarife, 2025);
const k25 = cm.reduce((s, m) => s + m.summe, 0);
const soll = y2025.kwh * 0.349 + 12 * 14.2;
check('Kosten 2025 = kWh × 34,90 ct + 12 × 14,20 € (' + C.fmtEur(k25) + ')', near(k25, soll, 1e-9), [k25, soll]);
check('Abschläge 2025 = 12 × 95 €', near(cm.reduce((s, m) => s + m.abschlag, 0), 1140, 1e-9));
const bl = C.billing(pts, days, tarife, '12-31', now);
check('Abrechnungszeitraum 01.01.–31.12.2026', bl.startKey === '2026-01-01' && bl.endKey === '2026-12-31', bl);
check('Prognose Saldo = Kosten − Abschläge (' + C.fmtEur(bl.saldo) + ')', near(bl.saldo, bl.kosten - bl.abschlaege) && near(bl.abschlaege, 12 * 95, 1e-9));
const lastR = demo[demo.length - 1];
const t1 = new Date(Date.parse(lastR.ts) + 3 * C.DAY).toISOString();
check('Warnung: Stand kleiner als vorher', C.checkReading(demo, { id: 'n', ts: t1, value: lastR.value - 5, kind: 'normal' }).some((x) => x.typ === 'kleiner'));
check('Warnung: mehr als das Dreifache des Ø', C.checkReading(demo, { id: 'n', ts: t1, value: lastR.value + 3 * avg * 3.5, kind: 'normal' }).some((x) => x.typ === 'hoch'));
check('Keine Warnung bei normalem Verbrauch', C.checkReading(demo, { id: 'n', ts: t1, value: lastR.value + 3 * avg, kind: 'normal' }).length === 0);
check('Hinweis bei Lücke > 3 Wochen', C.checkReading(demo, { id: 'n', ts: new Date(Date.parse(lastR.ts) + 30 * C.DAY).toISOString(), value: lastR.value + 30 * avg, kind: 'normal' }).some((x) => x.typ === 'luecke'));
check('Zählerwechsel löst keine „kleiner“-Warnung aus', !C.checkReading(demo, { id: 'n', ts: t1, value: 0.5, old_value: lastR.value + 50, kind: 'wechsel' }).some((x) => x.typ === 'kleiner'));

console.log(`\nErgebnis: ${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
