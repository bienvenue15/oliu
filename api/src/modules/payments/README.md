# payments

**Owns:** `Beneficiary` (the registry of protected accounts), `PaymentRequest` (the payment order), `PaymentSequence`
(the PR counter per company and year), `CostLine.paymentId` (which order a line is on), `AccountSettings.
approvalThresholdUsdCents`, `OtpChallenge.purpose = PAYMENT_APPROVAL | BENEFICIARY_CHANGE`, the MD-queue kind
`REPEAT_PAYMENT`. Answers "who is owed, who approved, what was paid, and could it have been paid twice".

**Routes:** `GET|POST /api/beneficiaries` · `POST /api/beneficiaries/:id/change` · `POST /api/beneficiaries/:id/code` ·
`POST /api/beneficiaries/:id/confirm` · `POST /api/beneficiaries/:id/drop` · `POST /api/beneficiaries/:id/suspend` ·
`POST /api/beneficiaries/:id/reactivate` · `GET /api/payments/setup` · `GET /api/payments/candidates?bookingId=&holderId=`
· `POST /api/payments` · `GET /api/payments?month=` · `POST /api/payments/:id/code` · `POST /api/payments/:id/approve` ·
`POST /api/payments/:id/reject` · `POST /api/payments/:id/pay`. The MD's ruling on a repeat goes through
`POST /api/md-queue/:id/resolve` (shipments), which calls `resolveRepeatPayment` here.

**Events (audit):** `beneficiary_proposed`, `beneficiary_change_proposed`, `beneficiary_code_sent`,
`beneficiary_added_by_md` (the MD's additions are verified at once, 30 Oct 2026), `beneficiary_verified`, `beneficiary_account_changed` (old and new numbers, whole), `beneficiary_change_dropped`,
`beneficiary_dropped`, `beneficiary_suspended`, `beneficiary_reactivated`, `payment_requested`, `payment_blocked`,
`approval_code_sent`, `payment_approved`, `float_settled`, `payment_rejected`, `payment_paid_locked`,
`repeat_payment_allowed`, `repeat_payment_refused`.

**Rules:** every payment is a fixed state — `REQUESTED → APPROVED → PAID`, or `REJECTED`; a repeat is `BLOCKED` and
waits for the MD · the order sits in the book of the company that requests it (`companyId`, the switcher's for the
MD); its lines must be in that book, live, and on no other order; one order, one currency · **nothing is paid without
an approval**, and the approver is never the requester (`approvable`) · above `approvalThresholdUsdCents` (default
USD 500) the approval needs the approver's one-time code, mailed to their own mailbox (`lib/codes.ts`: for this
purpose only, once, expires with `OTP_MINUTES`, five wrong tries burn it) · **a paid order is locked**: `lockedAt`
is set when paid and a database trigger (`payment_locked`, migration `20261029100100`) refuses every UPDATE and
DELETE from then on, the MD included · **one beneficiary + one box + one category = paid once**: a line whose box
and category are already on a live order (requested, blocked, approved or paid) to the same beneficiary blocks the
new order and opens `REPEAT_PAYMENT` with both numbers; the MD allows it (back to `REQUESTED`) or refuses it
(`REJECTED`, lines freed); an office expense repeats on the same beneficiary, category, amount, currency and date ·
rejecting frees the lines (`paymentId = null`) · **beneficiaries** are the account's; a new one is `PENDING` unless the MD added it (then `VERIFIED` at once), a change
of account sits in `pendingChange`; both wait for a second person with the `beneficiaries` permission who is not the
proposer, confirmed with a code; until then `notPayable` stops every approval and payment to it; numbers are masked
everywhere but the trail · **kinds**: `COST` (cost or tip lines), `EXPENSE` (no box; category, amount, date),
`FLOAT_ADVANCE` (to a `STAFF` beneficiary with a `userId`), `SETTLEMENT` (the holder's cash lines — their tips, the
lines they typed — against the float; approving it is the whole act: it becomes `PAID` with `paidRef = FLOAT`, no
money leaves the bank) · **cash in staff hands** = advances paid − settlements approved, per holder and currency
(`floats`) · `pay` may name a bank account of the paying company or its parent.

**Who may:** `queue` + `write` requests (MD, Operations Manager, Finance Officer); `queue` + `approve` approves and
rejects (MD, Operations Manager); `cashier` + `pay` pays (MD, Finance Officer); `ben` + `write` proposes a
beneficiary or a change; `ben` + `beneficiaries` confirms, suspends, reactivates (MD, Operations Manager — the
permission was added to the Operations Manager in this slice so a change the MD proposes has a second pair of eyes);
`reconcile` rules on a repeat (MD). A company-bound person sees their book only (`byCompany`); the registry is shared.

**Later slices add:** blind entry of the Finance figure and the compare (7); the invoice's "all own costs paid" gate
(8); payment approvals waiting on the MD's phone, cash out this month (9); the bank statement match (accounting).
