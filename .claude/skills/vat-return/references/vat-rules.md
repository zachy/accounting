# VAT classification rules (Kontrolní hlášení + přiznání k DPH)

Rules for Martin Zachov — OSVČ, IT/SW development (živnost volná, NACE 620000),
**quarterly** VAT payer, 100% taxable activity (full right to deduct). Validated
against the accountant's (Vlasta Špačková, SPAMI s.r.o.) filed Q2 2026 return.

## Fixed identity data (payer JSON for build_xml.js)

| Field | Value |
|---|---|
| dic | 9003094320 |
| titul / jmeno / prijmeni | Ing / Martin / Zachov |
| ulice / c_pop / naz_obce / psc | Boženy Němcové / 884 / Doksy / 47201 |
| email / c_telef | martin.zachov@gmail.com / 722128058 |
| c_ufo / c_pracufo | 457 / 2602 (FÚ pro Liberecký kraj, ÚzP Česká Lípa) |
| c_okec | 620000 |
| sest_jmeno / sest_prijmeni / sest_telef | Vlasta / Špačková / 777933162 |

Tax payment: účet předčíslí **705**, …/0710, VS **9003094320**.

## Classify every document into exactly one bucket

### Output — issued invoices (`prijem_*`, supplier = Martin)
- Standard domestic 21% supply to a Czech VAT payer → **KH A.4**, **DPH ř.1**.
- Belongs to the quarter by **DUZP** (datum zdan. plnění), regardless of when paid.
  An invoice with DUZP 30.06 but paid in July still counts this quarter.
- `dic_odb` = customer DIČ digits only (COPS Solutions = 62913883).
- Under 10 000 Kč incl. VAT would go to A.5 instead (rare here — invoices are large).

### Input — domestic receipts from Czech VAT payers (`vydaj_*` with a CZ DIČ)
- Deductible 21% input VAT → **DPH ř.40**. In KH: **B.2** if ≥10 000 Kč incl. VAT
  (needs per-doc detail + supplier DIČ), else **B.3** (aggregate, no detail).
- Typical vendors: T-Mobile, SPAMI, Datart, ORLEN fuel. Almost all are <10k → B.3.
- Use the doc's DUZP for period; the VAT base/tax are read from each doklad.
- **ORLEN fuel**: deduct from each individual receipt (daňový doklad), NOT the fuel-card
  top-up. Seller DIČ for fuel is the group reg. CZ699000139.
- **Advance/záloha (Datart phone)**: deduct once, in the period the supply/advance falls.
  The final invoice may show "K úhradě 0" with the advance deducted — the base+VAT are
  still real and deductible; don't double-count with a separate zálohový doklad.
- No valid daňový doklad (e.g. parking with only a card slip) → **no deduction**, exclude.

### Input — foreign services (reverse charge, §108)  ← the easy-to-get-wrong bucket
Every service from a supplier **not established in CZ** (Anthropic US, Miro NL, Google,
OpenAI, AWS, etc.) is self-assessed by the recipient → **KH A.2**, deduction **DPH ř.43**.
This is **VAT-neutral** (output = input; Martin deducts 100%).

- **This applies even if the invoice was billed B2C (no DIČ) and the supplier wrongly
  charged Czech VAT** (e.g. Anthropic R27NSHFT-0001 added $1.05 CZ VAT). The recipient's
  §108 duty stands regardless of the supplier's labeling; the wrongly-charged VAT is a
  non-deductible cost. **Do not exclude such invoices** — self-assess on the net value.
- Line mapping:
  - EU supplier registered to VAT (has an EU VAT ID) → **DPH ř.5** (`dph_line: 5`), and in
    KH A.2 set `k_stat` + `vatid` (number **without** country prefix, e.g. NL / 858562947B01).
  - Third-country supplier (US etc., no EU VAT ID) → **DPH ř.12** (`dph_line: 12`), KH A.2
    with `k_stat`/`vatid` omitted.
  - What decides is the **supplier entity's establishment**, not whether an EU VAT ID is
    printed. **Anthropic, PBC (US) → always ř.12, no k_stat/vatid**, even though its invoices
    since 08/2026 show "EU VAT: IE4276970QH" (accountant's filed Q3 2026 return).
  - Known EU-established suppliers (ř.5): Microsoft Ireland Operations Ltd (Azure) IE /
    8256796U · OpenAI Ireland Ltd IE / 4143435AH (bills in CZK, no FX) · Miro NL / 858562947B01.
- **Base** = the amount actually charged as consideration (after any credit/"applied
  balance" — treat that as a discount), not the list price.
- **DUZP** = invoice issue date / service date (whichever the doklad states).
- **FX** = ČNB daily rate for the DUZP (see below). base_CZK = amount_foreign × rate,
  then VAT = round(base_CZK × 0.21, 2).

### Not a VAT event — exclude
Personal spend (Google Cloud personal), own-account transfers, VOZP/OSSZ advances,
income-tax payments, bank fees. List them as excluded; don't drop silently.

## Foreign exchange (ČNB) — automatic

For each reverse-charge doc, get the rate with the bundled script:

```bash
echo '[{"date":"16.04.2026","currency":"EUR"},{"date":"03.06.2026","currency":"EUR"}]' \
  | node scripts/cnb_rate.js --batch
```

- Returns CZK-per-unit and the effective `rate_date`. ČNB doesn't publish on weekends or
  CZ public holidays (e.g. Good Friday, 1 May, 5–6 Jul, 28 Sep, 28 Oct, 17 Nov, 24–26 Dec);
  the script walks back to the last business day, which is the rate valid on that date.
- Sanity-check any USD line: if CZK/USD is inconsistent with the same-day CZK/EUR ÷ ~1.1
  EUR/USD cross, re-check the date (a holiday may have shifted it).

## Rounding & format

- **KH (DPHKH1)**: haléře (2 dp). **DPH (DPHDP3)**: whole crowns.
- `build_xml.js` handles both. It sums A.4→ř.1, A.2(ř.5/ř.12)→output, B.3→ř.40, A.2→ř.43,
  fills KH oddíl C (`obrat23`,`pln23`,`celk_zd_a2`), and computes ř.62/63/64.

## Tie-out checks (must hold before submitting)

- KH `obrat23` (A.4 base) == DPH `obrat23` (ř.1 base).
- KH `pln23` (B.3 base) == DPH `pln23` (ř.40 base).
- KH `celk_zd_a2` == DPH `nar_zdp23` (ř.43 base) == ř.5 base + ř.12 base.
- DPH `dano_da` = ř.62 − ř.63. Reverse charge nets to zero, so it never changes the tax due.
- No Souhrnné hlášení unless there is a supply **to** a VAT-registered person in another EU
  state (Martin's only customer is Czech → none).
