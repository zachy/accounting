---
name: reconcile
description: "Reconcile bank statements against PDF invoices/receipts for a given year and quarter. Use this skill whenever the user wants to check for missing documents, cross-reference bank transactions with invoices, verify accounting completeness, find unmatched expenses or incomes, or audit a quarterly accounting folder. Triggers on: 'reconcile', 'missing invoices', 'check quarter', 'cross-reference bank', 'what's missing in Q*', 'verify documents', 'audit accounting', or any request to compare bank statements with attached PDFs."
---

# Reconcile: Bank Statement vs. Document Cross-Reference

You are reconciling a Czech sole-proprietor's (OSVČ) accounting archive. The goal is to read all bank statements for a given period, extract every transaction, then check which transactions have a matching PDF document (invoice, receipt, etc.) in the same folder — and which do not.

## Input

The user provides a **year** and **quarter**, e.g. `2025 Q4` or `2024 3`.

## Step 1: Locate the folder

The accounting repo is organized by year, then by period:

```
accounting/
├── 2024/
│   ├── 1/          # Q2 2024 (Apr–Jun) — legacy numbering
│   ├── 3/          # Q3 2024 (Jul–Sep)
│   ├── 4/          # Q4 2024 (Oct–Dec)
│   └── DP/         # Income tax
├── 2025/
│   ├── Q1/ – Q4/   # Quarterly folders
├── 2026/
│   └── Q1/
```

For 2024, the folder names are `1`, `3`, `4` (not Q-prefixed). For 2025+, folders use `Q1`–`Q4`.

Determine the correct folder path. If the folder doesn't exist, tell the user and stop.

## Step 2: Read ALL bank statements

Find all files matching `Vypis_z_uctu_*.pdf` in the target folder. These are monthly bank statements from Česká spořitelna (account 6222151389/0800).

Read every bank statement PDF. Each statement covers one calendar month and contains a table under **"PŘEHLED POHYBŮ NA ÚČTU"** (Transaction overview).

### Transaction structure

Each transaction row contains:
- **Zaúčtováno** (Posting date) — format `DD.MM.YYYY`
- **Položka** (Transaction type) — e.g. `Příchozí úhrada`, `Tuzemská odchozí úhrada`, `Platba kartou`, `Inkaso`, `Trvalý příkaz`, `Ceny za služby`
- **Číslo protiúčtu** (Counter-account number)
- **Název protiúčtu** (Counter-account name)
- **Variabilní symbol** (Variable symbol) — often matches invoice numbers
- **Konstantní symbol**
- **Specifický symbol**
- **Částka** (Amount) — positive = incoming, negative = outgoing
- **Popis** (Description) — free text with vendor/payment details

For card payments (`Platba kartou`), the description line contains:
- The card number (masked)
- `d.tran.DD.MM.YYYY` — actual transaction date
- Merchant location and name (e.g. `IE msbill.info Microsoft-G117`, `CZ Litvinov Orlen`, `IE DUBLIN OPENAI *CHATGP`)
- Currency info if foreign (e.g. `EUR 32.50 ... kurz EUR 25.081`)

Extract a structured list of ALL transactions with these fields:
- `date`: posting date
- `type`: transaction type
- `amount`: signed amount in CZK
- `variable_symbol`: if present
- `counterparty`: account name or merchant name
- `description`: full description text
- `category`: your best guess (see categories below)

## Step 3: Read ALL other PDFs

List all PDF files in the folder that are NOT bank statements. Read each one and extract:
- **Vendor/issuer name**
- **Date** (invoice date, receipt date, or tax date — DUZP)
- **Total amount** (including VAT where applicable)
- **Invoice/document number**
- **Variable symbol** (if present on the document)

### Known document patterns

| Pattern | Vendor | Type |
|---|---|---|
| `martinzachov-20XX-NNNN.pdf` | Martin Zachov (self) | Issued invoice (income) |
| `ORLEN_uctenka_YYYY-MM-DD_*.pdf` | ORLEN/Benzina | Fuel receipt |
| `benzina-*.pdf` | Benzina | Fuel receipt |
| `azure*.pdf` or `G*_Invoice.pdf` or `G*_Azure.pdf` | Microsoft Azure | Cloud hosting |
| `tmobile*.pdf` or `Tmobile*.pdf` or `Vyuctovani_*.pdf` | T-Mobile CZ | Mobile phone |
| `ChatGpt-*.pdf` or `Invoice-7B09DEBF-*.pdf` or `Invoice-92C1B8B8-*.pdf` | OpenAI | AI subscription |
| `alza*.pdf` | Alza.cz | Electronics |
| `asko*.pdf` | ASKO | Furniture |
| `spami*.pdf` or `Spami*.pdf` | Spami | Supplier |
| `datart*.pdf` | Datart | Electronics |
| `houseland*.pdf` | Houseland | Supplier |
| `liftor*.pdf` | Liftor | Supplier |
| `smarty*.pdf` | Smarty | Supplier |
| `czc*.pdf` | CZC.cz | Electronics |
| `receipt_linuxfoundation*.pdf` | Linux Foundation | Donation/membership |
| `skoda.pdf` | Škoda | Car |

## Step 4: Match transactions to documents

For each bank transaction, attempt to find a matching PDF document using these strategies (in priority order):

### 1. Variable symbol match
The **variable symbol** (`Variabilní symbol`) on bank transactions often directly corresponds to an invoice number. For issued invoices, `20250011` matches `martinzachov-2025-0011.pdf`. For supplier invoices, the variable symbol may appear on the invoice itself.

### 2. Amount + vendor match
Match by amount (exact or very close — within 1 CZK for rounding) AND a vendor name hint:
- Bank description contains `Microsoft` or `msbill.info` → match Azure invoices
- Bank description contains `T-MOBILE` or T-Mobile inkaso → match T-Mobile bills
- Bank description contains `OPENAI` or `CHATGP` → match ChatGPT invoices
- Bank description contains `Orlen` or `Litvinov` → match ORLEN fuel receipts
- Bank description contains `COPS` → match issued invoices (income from client)

### 3. Date proximity
For fuel receipts, the ORLEN filename contains the transaction date (`ORLEN_uctenka_YYYY-MM-DD_*`). The bank statement card payment contains `d.tran.DD.MM.YYYY`. Match these dates (allow 1–3 days tolerance for posting delay).

### Transactions that typically have NO document

These are expected to have no matching PDF — flag them as **"OK — no document needed"**:
- `Trvalý příkaz` to account `2010201091/0710` → **VOZP zálohy** (health insurance advance)
- `Trvalý příkaz` to account `1011-17925421/0710` → **OSSZ zálohy** (social insurance advance)
- `Trvalý příkaz` to account `705-77628461/0710` → **Daň z příjmu / záloha na daň** (income tax advance)
- `Tuzemská odchozí úhrada` to `2190590193/0800` → **Personal transfer** (own savings)
- `Ceny za služby` → **Bank fees** (account maintenance)
- Transactions with description matching `zálohy`, `záloha na daň`, or clearly marked government payments (ČSSZ, VOZP, finanční úřad)

## Step 5: Build the reconciliation data

After matching, organize all data into this exact structure. Every transaction falls into exactly ONE of the four categories:

**Categories** (every transaction gets exactly one):
- `matched` — bank transaction has a corresponding PDF in the folder
- `missing` — bank transaction SHOULD have a document but doesn't (action needed)
- `no_doc_needed` — bank transaction that correctly has no document (insurance, tax, personal, fees)
- `cross_quarter` — payment or invoice that spans quarter boundary (see invoice timing rules)

**Every transaction record must contain these fields** (use `—` for absent values):
- `date` — DD.MM.YYYY
- `amount` — signed number in CZK (positive = income, negative = expense)
- `type` — transaction type from bank statement
- `counterparty` — vendor/payer name
- `description` — short description of the transaction
- `variable_symbol` — VS or `—`
- `category` — one of the four categories above
- `matched_pdf` — filename or `—`
- `note` — explanation (match method, why no doc needed, what's missing, etc.)

**Issued invoices with DUZP in the current quarter but no payment yet:** If an issued invoice (`martinzachov-*`) has a DUZP falling within the current quarter but no matching incoming payment in the quarter's bank statements, it is NOT an extra document. It belongs to this quarter by DUZP. Add it as a `cross_quarter` transaction in the month matching its DUZP, with a note like "Issued invoice 2026-0003, DUZP 31.03.2026, due 14.04.2026 — payment expected in next quarter."

**Extra documents** (PDFs whose DUZP falls outside the current quarter and that have no matching bank transaction) are tracked separately with:
- `filename`
- `vendor`
- `amount` — from the document
- `date` — from the document (DUZP)
- `note` — why it's extra (belongs to previous/next quarter, duplicate, etc.)

The key rule: **use DUZP (Datum uskutečnění zdanitelného plnění)** to determine whether a document belongs to the current quarter. A document with DUZP inside the quarter is never "extra" — it either matches a transaction or is a cross-quarter item awaiting payment.

## Step 6: Generate the report

You produce TWO outputs:
1. A **console summary** printed to the user (concise, scannable)
2. An **HTML report** file saved to the quarter folder

### Output 1: Console summary

Print this exact structure. Do not deviate from the format. Replace bracketed placeholders with actual values.

```
============================================================
  RECONCILIATION: [YYYY] [QN]
  Account: 6222151389/0800 — Martin Zachov
  Generated: [current date]
============================================================

BANK STATEMENTS: [N] found ([Month1, Month2, Month3])
DOCUMENTS: [N] PDFs in folder (excluding statements)

------------------------------------------------------------
  [MONTH1 YYYY] — Statement #[NNN]
  Opening: [amount] CZK → Closing: [amount] CZK
  Income: +[amount] CZK | Expenses: -[amount] CZK
------------------------------------------------------------

  MATCHED ([N]):
    [DD.MM] [+/-amount CZK] [counterparty] → [filename.pdf]
    [DD.MM] [+/-amount CZK] [counterparty] → [filename.pdf]
    ...

  MISSING DOCUMENTS ([N]):
    [DD.MM] [+/-amount CZK] [type] [counterparty]
      ↳ Hint: [what to look for]
    ...

  NO DOCUMENT NEEDED ([N]):
    [DD.MM] [+/-amount CZK] [counterparty] ([reason])
    ...

  CROSS-QUARTER ([N]):
    [DD.MM] [+/-amount CZK] [counterparty]
      ↳ [explanation]
    ...

  MONTH VERDICT: [CLEAN | ACTION NEEDED — N missing documents]

------------------------------------------------------------
  [MONTH2 YYYY] — Statement #[NNN]
  ...same structure...
------------------------------------------------------------

  [MONTH3 YYYY] — Statement #[NNN]
  ...same structure...
------------------------------------------------------------

============================================================
  QUARTERLY SUMMARY
============================================================
  Total income:         +[amount] CZK
  Total expenses:       -[amount] CZK
  Net:                  [+/-amount] CZK

  Matched:              [N] transactions
  Missing documents:    [N] transactions
  No document needed:   [N] transactions
  Cross-quarter:        [N] transactions

  EXTRA DOCUMENTS ([N]):
    [filename.pdf] — [vendor], [amount] CZK, [date]
      ↳ [reason it's extra]
    ...

============================================================
  STATUS: [CLEAN | ACTION NEEDED]
============================================================
  [If ACTION NEEDED, list each issue as a numbered item:]
  1. [issue description]
  2. [issue description]
  ...
============================================================
```

If a section has zero items, print the header with `(0)` and write `    (none)` on the next line. Never omit a section.

### Output 2: HTML report

After printing the console summary, generate an HTML file and save it to the quarter folder as:

```
[folder]/reconciliation_[YYYY]_[QN].html
```

For example: `2025/Q4/reconciliation_2025_Q4.html`

Use the HTML template from the bundled file at `templates/report.html`. Read that file, then replace the data placeholder `/*__RECONCILIATION_DATA__*/` with a JSON object containing all the reconciliation data, structured as:

```json
{
  "year": 2025,
  "quarter": "Q4",
  "generated": "2026-04-07",
  "account": "6222151389/0800",
  "holder": "Martin Zachov",
  "months": [
    {
      "name": "October 2025",
      "statement_number": "010",
      "opening_balance": 9766.38,
      "closing_balance": 15285.03,
      "total_income": 207055.20,
      "total_expenses": -201536.55,
      "transactions": [
        {
          "date": "10.10.2025",
          "amount": -4136.00,
          "type": "Trvalý příkaz",
          "counterparty": "VOZP",
          "description": "VOZP zálohy",
          "variable_symbol": "9003094320",
          "category": "no_doc_needed",
          "matched_pdf": "—",
          "note": "Health insurance advance"
        }
      ]
    }
  ],
  "extra_documents": [
    {
      "filename": "martinzachov-2025-0013.pdf",
      "vendor": "Martin Zachov",
      "amount": 155291.40,
      "date": "19.12.2025",
      "note": "Invoice due 02.01.2026 — payment expected in Q1 2026"
    }
  ],
  "summary": {
    "total_income": 632969.25,
    "total_expenses": -622475.23,
    "net": 10494.02,
    "matched_count": 22,
    "missing_count": 3,
    "no_doc_needed_count": 15,
    "cross_quarter_count": 2
  },
  "status": "ACTION_NEEDED",
  "issues": [
    "Unknown payment -4,143.00 CZK (13.10, VS 2050348008) — identify vendor",
    "ORLEN fuel card billing mismatch — receipts don't match bank charges"
  ]
}
```

Tell the user where the HTML file was saved and suggest they open it in a browser.

## Step 7: Remove extra documents

After generating the report, if there are any **extra documents** (PDFs whose DUZP falls outside the current quarter and have no matching bank transaction), **delete them from the quarter folder without asking for confirmation**. These documents do not belong in this quarter.

Print a summary of removed files:
```
REMOVED EXTRA DOCUMENTS:
  [filename.pdf] — [reason]
  ...
```

If there are no extra documents, skip this step silently.

Do NOT remove bank statement files (`Vypis_z_uctu_*.pdf`) or the generated reconciliation HTML file.

## Step 8: Rename documents

After generating the report, rename ALL non-statement PDF documents in the quarter folder to a standardized format:

```
<direction>_<companyname>_<invoicenumber>.pdf
```

Where:
- **`<direction>`** is either:
  - `prijem` — for issued invoices (income documents, e.g. `martinzachov-*` invoices)
  - `vydaj` — for received invoices/receipts (expense documents, e.g. T-Mobile, ORLEN, Spami, etc.)
- **`<companyname>`** — lowercase, no spaces or diacritics (e.g. `tmobile`, `orlen`, `spami`, `alza`, `openai`, `anthropic`, `aeroparking`, `google`, `datart`, `suntech`, `cops`)
- **`<invoicenumber>`** — the invoice/document number from the PDF (e.g. `1855242526`, `2026004`, `PRG-PA-3038379`, `7B09DEBF-0010`). For ORLEN receipts use the receipt document number from the PDF (e.g. `349992601120004`). If no clear invoice number exists, use the date in `YYYYMMDD` format.

**Examples:**
- `tmobile_58043079_2601.pdf` → `vydaj_tmobile_1855242526.pdf`
- `spami2025Q4.pdf` → `vydaj_spami_2026004.pdf`
- `chatgpt.pdf` → `vydaj_openai_7B09DEBF-0010.pdf`
- `PRG-PA-3038379.pdf` → `vydaj_aeroparking_PRG-PA-3038379.pdf`
- `ORLEN_uctenka_2026-01-12_CS_349_06350244519.pdf` → `vydaj_orlen_349992601120004.pdf`
- `martinzachov-2026-0001.pdf` → `prijem_cops_20260001.pdf`

Show the user the full rename plan (old name → new name) and then **proceed with the renames immediately without asking for confirmation**.

Do NOT rename bank statement files (`Vypis_z_uctu_*.pdf`) or the generated reconciliation HTML file.

## Important notes

- Amounts on bank statements use Czech formatting: space as thousands separator, comma or period as decimal separator. E.g. `207 055.20` means 207,055.20 CZK.
- Card payments in EUR show both the EUR amount and CZK equivalent. Use the CZK amount for matching.
- Some invoices span multiple months (e.g., a Q4 Spami invoice covering Oct–Dec). These may appear as a single PDF but match multiple or no specific bank transactions.
- **ORLEN fuel card billing model:** The bank shows card payments at "CZ Litvinov Orlen" for round amounts (e.g. 5,000 CZK). This does NOT mean the full amount was spent on fuel. The actual fuel purchases are documented by individual ORLEN receipts (`ORLEN_uctenka_*`). Expect 2–3 receipts per bank charge on average. The receipt totals will usually be LESS than the bank charge (the remainder stays as credit on the fuel card). Match each Orlen bank charge to the nearby ORLEN receipts by date proximity and mark as matched. Do NOT flag the difference between the bank charge and receipt totals as a mismatch — this is the normal fuel card prepayment model.
- Issued invoices (`martinzachov-*`) are INCOME — they match incoming payments (`Příchozí úhrada`) from client COPS Solutions / COPS Financial Systems.
- When a variable symbol like `20250010` appears on a bank transaction, it corresponds to invoice `martinzachov-2025-0010.pdf` (strip the leading `2025` and pad to 4 digits, or just match the full number).

## Invoice payment timing across quarters

Invoices are issued at the end of each month with a ~14-day payment term. This creates a natural offset:

- An invoice issued on **31 October** (last day of Month 1 in Q4) is typically paid in **mid-November** (Month 2 of Q4). Both the invoice PDF and the incoming payment appear within the same quarter — no issue.
- An invoice issued on **31 December** (last day of Q4) is due around **14 January** (Q1 of next year). The invoice PDF is in the Q4 folder, but **the incoming payment will NOT appear in any Q4 bank statement**. This is expected — do NOT flag it as missing income.
- Conversely, the **first incoming payment** in a quarter (typically in Month 1) usually corresponds to an invoice from the **previous quarter's last month**. The matching `martinzachov-*` PDF will be in the previous quarter's folder, not the current one. This is also expected — do NOT flag it as a missing invoice in the current quarter.

**How to handle this:**
- When an issued invoice PDF exists in the folder but has no matching incoming payment in the quarter: check its due date. If the due date falls after the quarter ends, mark it as **"Payment expected in next quarter — OK"**, not as missing.
- When an incoming payment arrives in Month 1 of the quarter with a variable symbol pointing to a previous quarter's invoice: mark it as **"Payment for previous quarter's invoice [number] — OK, invoice in [previous Q] folder"**, not as missing.
- Only flag a genuinely missing issued invoice if: (a) there is an incoming payment whose variable symbol does not match ANY `martinzachov-*` PDF in either the current or previous quarter's folder, OR (b) an invoice is present, its due date has long passed (>30 days), and no payment has arrived.
