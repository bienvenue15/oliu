# Analysis addendum — the system issues the client invoice itself

*Based on the two OLIU billing invoices in this folder: KGLDAR03102026 to Zhejiang Star Mining (Space Mining), 3 Oct 2026, USD 43,200 for 12 containers, and KGLDAR04102026 to Transvera Group, 4 Oct 2026, USD 21,600 for 6 containers.*

## 1. What the current invoice looks like

Both documents are typed by hand in Excel from the shipment sheet and signed by the Finance Officer. They share one layout, which the system will reproduce:

| Block | Content today |
|---|---|
| Header | "BILLING INVOICE", OLIU LOGISTICS LTD, KK 4 Avenue Kigali, TIN 120126551, phone, Gmail address |
| Invoice box | Invoice No, Date, Customer ID, Terms of payment ("FULL PAYMENT") |
| Bill to | Client name, address, client TIN where known |
| Description | One line of service text ("Export freight charges from Kigali to Dar es Salaam, border and port clearance service" / "Shipment from Kigali to China") |
| Container lines | One row per container: departure date, vessel, ETD, B/L No, container No, size, lot No, amount |
| Totals | Sub-total, "Amount to be paid in USD" |
| Payment details | OLIU accounts at Equity Bank (RWF + USD), Bank of Kigali (RWF + USD), I&M Bank (USD), with SWIFT codes |
| Sign-off | Finance Officer name and title |

## 2. What the system will do instead

The MIS generates the invoice itself. Nobody retypes container numbers, dates or amounts.

- **Raised from the container records.** Finance opens the booking, ticks the containers to bill, and the system fills every container row from data Operations already entered: departure date, vessel, ETD, B/L, container number, size and lot number. The rate per container comes from the client's agreed tariff and can be overridden per line with a reason.
- **Same layout as today.** The PDF keeps the current OLIU billing invoice format so clients, the accountant and the bank see nothing unfamiliar. Company header, bank blocks and the Finance Officer's name come from configuration, not from typing.
- **Gapless numbering.** The system assigns the number. Today's number is the date (KGLDAR03102026), which cannot distinguish two invoices issued on the same day and leaves no sequence to audit. The system keeps the KGLDAR prefix if the MD wants it and adds a running sequence, for example KGLDAR-2026-0041.
- **Fiscal receipt gate.** The invoice cannot be marked issued until the EBM receipt number is recorded against it. The receipt number prints on the PDF.
- **One client master.** Both invoices carry the same customer ID (OLISM00002) for two different clients. The system holds one record per client with its own ID, TIN, address and bank preference, and the invoice pulls from it.
- **Invoice gate at close.** A container cannot be closed to P&L until every billable cost line on it is on an issued invoice or written off with MD approval. The two invoices above would have been raised the day the containers were released, not when someone remembered.
- **Nothing billed twice.** A container that is already on an issued invoice cannot be added to another one. Partial billing of a booking is allowed; the system shows which boxes remain unbilled.
- **Sent and tracked.** The PDF goes to the client by email from the system, the invoice appears in aged receivables the same day, and each payment received is matched to it so the balance and the "Clients owe us" figure are always live.
- **Credit notes.** Corrections are made by credit note against the original number, never by editing or reissuing an invoice.

## 3. Defects in the current invoices that disappear

| Seen in the folder | Effect | How the system removes it |
|---|---|---|
| Invoice number equals the date | Two invoices on one day collide; no gap check possible | Sequence assigned by the system |
| Same customer ID on two clients | AR by client cannot be trusted | Client master with unique ID |
| B/L numbers missing on most rows | Client and auditor cannot trace the box to the shipment | B/L filled from the container record when the line issues it; invoice can wait for it or print "pending" |
| Spelling errors in the fixed text ("PAYMNENT", "BANK OF KIGAL") | Unprofessional, repeated on every invoice | Fixed text held once in configuration |
| No due date, only "FULL PAYMENT" | Ageing has nothing to count from | Terms in days per client; due date printed |
| No EBM receipt reference | Fiscal exposure for OLIU | Receipt number mandatory before issue |
| Three bank blocks printed on every invoice | Client picks the wrong account; reconciliation harder | Preferred bank per client, others optional |
| Column headed "UNPAID" instead of amount | Confuses amount invoiced with balance | Amount, paid and balance kept separately in the system; the PDF shows the amount |

## 4. Field map — where each printed value comes from

| Printed on the invoice | Source in the MIS |
|---|---|
| Company header, TIN, phone, email | Company configuration (OLIU) |
| Invoice No, date | Assigned on issue |
| Customer ID, bill-to name, address, TIN | Client master |
| Terms of payment, due date | Client master (default) or override |
| Description line | Service template per trade lane, editable |
| Departure date, vessel, ETD, B/L, container No, size | Container record and transport leg |
| Lot No | Container record (client reference) |
| Amount per container | Client tariff or manual rate with reason |
| Sub-total, total | Calculated |
| EBM receipt No | Entered at the fiscal gate |
| Bank details | Company configuration, filtered by client preference |
| Signatory | User who issued the invoice, Finance Officer role |

The two invoices in the folder serve as the acceptance sample: the system must reproduce both from migrated container data with no manual figure typed.
