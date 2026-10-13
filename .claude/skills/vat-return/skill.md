---
name: vat-return
description: "Prepare the Czech quarterly VAT filing — Kontrolní hlášení (DPHKH1) + přiznání k DPH (DPHDP3) — as validated XML ready to send by datová schránka, plus a review worksheet. Use this skill whenever the user wants to build, generate, prepare, or file DPH / kontrolní hlášení / KH / VAT return / přiznání k DPH for a quarter, wants the XML for EPO or datová schránka, asks 'how much VAT do I owe this quarter', or needs foreign-service reverse charge, ČNB exchange rates, or VAT figures computed from a quarter folder. Triggers on: 'kontrolní hlášení', 'KH', 'DPH', 'VAT return', 'přiznání k DPH', 'DPHKH1', 'DPHDP3', 'reverse charge', 'kolik platím DPH', 'datová schránka DPH'. Run this after reconcile for the same quarter."
---

# VAT return: Kontrolní hlášení (DPHKH1) + přiznání k DPH (DPHDP3)

Build the Czech quarterly VAT filing for Martin Zachov (OSVČ, quarterly VAT payer)
from a reconciled quarter folder. Output: two schema-valid XML files ready to load in
EPO / send by datová schránka, a human-review HTML worksheet, and a submission checklist.

This skill encodes the approach validated against the accountant's (Vlasta Špačková) filed
return — `scripts/build_xml.js` reproduces her Q2 2026 filing byte-for-byte. It is a working
aid, not tax advice; the accountant stays the final signer.

## Input

A **year** and **quarter** (e.g. `2026 Q2`) → folder `<year>/<Qn>/`. Run **after** the
`reconcile` skill for the same quarter (it verifies documents and normalises filenames to
`prijem_* / vydaj_* / zaloha_*`), so the docs are complete and consistently named.

## Step 1 — Read the rules, then classify every document

Read `references/vat-rules.md` in full — it holds the fixed payer identity, the bucket
definitions, the FX rule, and the tie-out checks. Then read each PDF's VAT detail (base,
tax, DUZP, doc number, supplier DIČ) and place it in exactly one bucket:

- **A.4** — issued invoices `prijem_*` (domestic 21% output) → also DPH ř.1. Period by **DUZP**.
- **A.2** — foreign services `vydaj_*` from suppliers not established in CZ (reverse charge,
  §108). EU → ř.5, third country → ř.12. **Include B2C-mislabeled ones** (e.g. an Anthropic
  invoice with no DIČ where the supplier wrongly charged CZ VAT) — the §108 duty stands.
- **B.3** — domestic `vydaj_*` receipts <10 000 Kč incl. VAT (aggregate) → DPH ř.40.
  (≥10 000 Kč → B.2 with per-doc detail; almost never occurs here.)
- **Excluded** — personal spend, transfers, insurance/tax advances, docs without a valid
  daňový doklad. List them; never drop silently.

Read the VAT base/tax straight off each doklad. For the reverse-charge (A.2) docs you need
CZK bases — go to Step 2.

## Step 2 — Fetch ČNB exchange rates automatically

For every A.2 doc in foreign currency, convert with the ČNB daily rate for its DUZP:

```bash
echo '[{"date":"16.04.2026","currency":"EUR"},{"date":"03.06.2026","currency":"EUR"}]' \
  | node scripts/cnb_rate.js --batch
```

Then `base_CZK = round(amount_foreign × rate, 2)` and `dan = round(base_CZK × 0.21, 2)`.
The script handles weekends/holidays (walks back to the last published business day) and
reports the effective `rate_date`. Sanity-check USD lines against the EUR/USD cross.

## Step 3 — Generate the XML

Assemble a classified JSON (shape documented at the top of `scripts/build_xml.js` and in
`references/vat-rules.md`) with `period`, `payer` (copy identity from the rules file),
`a4[]`, `a2[]` (each with `dph_line` 5 or 12, and `k_stat`/`vatid` for EU suppliers), and
`b3`. Then:

```bash
node scripts/build_xml.js classified.json "<year>/<Qn>"
```

This writes `DPHKH1_<Y>Q<q>.xml` and `DPHDP3_<Y>Q<q>.xml` with correct attribute names,
haléře-vs-whole-crown rounding, KH oddíl C, and the ř.62/63/64 computation. It prints the
totals — confirm the tie-outs in `references/vat-rules.md` hold.

## Step 4 — Generate the review worksheet

Read `templates/vat_report.html`, replace the whole placeholder token
`/*__VAT_DATA__*/null/*__VAT_DATA_END__*/` with a JSON object (see the `DATA` shape in the template — summary, a4/a2/b3 tables, dph lines, an `fx`
table showing each ČNB rate + rate_date, the B.3 `detail` rows, `flags` for judgment calls,
and `steps`). Save as `<year>/<Qn>/kontrolni_hlaseni_<Y>_<Qn>.html`. Always include flags
for: any reverse-charge base assumption, the FX rate_date used, and anything excluded.

## Step 5 — Submission checklist (print + put in `steps`)

- **Validate first:** load both XMLs in EPO (`www.mojedane.cz` → *Načíst soubor* → check
  *Protokol chyb*). This is the safety net — the accountant's software signature differs, so
  EPO re-checks the schema and the tax-office routing.
- **Send by datová schránka:** from EPO choose *Odeslat datovou schránkou*, or attach the
  validated XML to a data message to **FÚ pro Liberecký kraj** (c_ufo 457). Send the XML, not
  the HTML/PDF.
- **Pay** the vlastní daň to FÚ Liberecký kraj, předčíslí 705, VS 9003094320, by the deadline
  (25th after quarter-end; if it falls on a weekend/holiday it moves to the next business day
  per §33 daňového řádu).
- **Souhrnné hlášení:** only if there was a supply to a VAT-registered person in another EU
  state — Martin's customer is Czech, so normally none.
- Note that the accountant (Vlasta Špačková) is the final reviewer/signer.

## Notes

- KH is in haléře, DPH in whole crowns — `build_xml.js` handles both; don't hand-round.
- Reverse charge is VAT-neutral (declared = deducted) — it never changes the tax due, but
  must still be reported in A.2 and on ř.5/12/43.
- If the payer's competent tax office, VAT period (monthly vs quarterly), or activity ever
  changes, update `references/vat-rules.md` — everything downstream reads from it.
