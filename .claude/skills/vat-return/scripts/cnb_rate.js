#!/usr/bin/env node
// Fetch ČNB daily FX rate (CZK per 1 unit) for a date & currency.
// The VAT base for a foreign-currency reverse-charge supply uses the ČNB rate
// published for the DUZP date. ČNB does not publish on weekends/CZ holidays
// (e.g. Good Friday, 1 May), so this walks back to the last business day —
// which is exactly the rate that is "valid" on the non-business day.
//
// Usage:
//   node cnb_rate.js EUR 16.04.2026            -> {"rate":24.35,...}
//   echo '[{"date":"16.04.2026","currency":"EUR"},...]' | node cnb_rate.js --batch
const https = require('node:https');

function fetchList(ddmmyyyy) {
  const url = `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt?date=${ddmmyyyy}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); }).on('error', reject);
  });
}
function parse(txt, code) {
  const lines = txt.trim().split(/\r?\n/);
  if (lines.length < 3) return null;
  const header = lines[0].split('#')[0].trim();        // effective (published) date
  for (let i = 2; i < lines.length; i++) {
    const f = lines[i].split('|');                     // země|měna|množství|kód|kurz
    if (f.length >= 5 && f[3] === code) {
      const qty = parseInt(f[2], 10);                  // e.g. JPY is per 100
      const rate = parseFloat(f[4].replace(/\s/g,'').replace(',','.'));
      return { rate: rate/qty, rate_date: header };
    }
  }
  return null;
}
function addDays(ddmmyyyy, delta) {
  const [d,m,y] = ddmmyyyy.split('.').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const p = n => String(n).padStart(2,'0');
  return `${p(dt.getUTCDate())}.${p(dt.getUTCMonth()+1)}.${dt.getUTCFullYear()}`;
}
async function rateFor(date, currency) {
  for (let back = 0; back <= 6; back++) {
    const q = addDays(date, -back);
    let txt; try { txt = await fetchList(q); } catch(e) { continue; }
    const r = parse(txt, currency);
    if (r) return { query_date: date, currency, rate: r.rate, rate_date: r.rate_date, days_back: back };
  }
  return { query_date: date, currency, rate: null, error: 'no rate within 6 days' };
}
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--batch')) {
    const input = await new Promise(r => { let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>r(s)); });
    const out = [];
    for (const it of JSON.parse(input)) out.push(await rateFor(it.date, it.currency));
    console.log(JSON.stringify(out, null, 2));
  } else {
    const [currency, date] = args;
    console.log(JSON.stringify(await rateFor(date, currency)));
  }
})();
