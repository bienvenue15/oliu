<script setup lang="ts">
/**
 * Payments → Needs payment. Staff request a payment (cost lines already typed, an office bill, a float advance,
 * a float settlement); the Operations Manager or the MD approves with one click — with their one-time code above
 * the threshold — or rejects with a reason. A repeat of a paid order is blocked here and shown with the MD.
 */
import { CURRENCIES, PAYMENT_KIND_LABEL, parseMoney, type Currency } from '@oliu/shared';
const api = useApi();
const { me, can } = useSession();

interface Beneficiary {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  userId: string | null;
  holder: string | null;
  bank: string;
  number: string;
  currency: string;
  status: string;
  payable: boolean;
  pending: unknown;
}
interface Line {
  id: string;
  containerNumber: string;
  category: string;
  date: string;
  currency: string;
  amount: string;
  usd: string;
  paidTo: string;
  tipId: string | null;
  bookingId: string;
}
interface Bk {
  id: string;
  fileNumber: string;
  reference: string;
  client: { name: string };
  status: string;
}
export interface Payment {
  id: string;
  number: string;
  kind: string;
  kindLabel: string;
  purpose: string;
  companyName: string;
  beneficiary: { id: string; name: string; bank: string; number: string; hold: string | null };
  category: string;
  date: string;
  currency: string;
  amount: string;
  usd: string;
  status: string;
  statusLabel: string;
  note: string;
  requestedBy: string;
  requestedById: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedWithCode: boolean;
  rejectedBy: string | null;
  rejectReason: string;
  paidBy: string | null;
  paidAt: string | null;
  paidRef: string;
  paidFrom: string;
  lockedAt: string | null;
  needsCode: boolean;
  blocked: { existingNumber: string } | null;
  lines: { id: string; containerNumber: string; category: string; amount: string; tip: boolean }[];
}
export interface Board {
  month: string;
  me: string;
  thresholdUsd: string;
  open: Payment[];
  done: Payment[];
  totals: {
    waiting: number;
    blocked: number;
    toPay: number;
    paidThisMonth: number;
    paidUsd: string;
  };
  floats: {
    beneficiaryId: string;
    holder: string;
    currency: string;
    advanced: string;
    settled: string;
    inHand: string;
    inHandUsd: string;
  }[];
  banks: { id: string; label: string; currency: string }[];
}

const board = ref<Board | null>(null);
const setup = ref<{
  beneficiaries: Beneficiary[];
  categories: { id: string; name: string }[];
} | null>(null);
const bookings = ref<Bk[]>([]);
const candidates = ref<Line[]>([]);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const kinds = Object.entries(PAYMENT_KIND_LABEL) as [keyof typeof PAYMENT_KIND_LABEL, string][];
const form = reactive({
  kind: 'COST' as keyof typeof PAYMENT_KIND_LABEL,
  bookingId: '',
  beneficiaryId: '',
  lineIds: [] as string[],
  categoryId: '',
  currency: (me.value?.companies[0]?.currency ?? 'RWF') as string,
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  purpose: '',
  note: '',
});
const codes = ref<Record<string, string>>({});
const sent = ref<Record<string, boolean>>({});
const rejectReason = ref<Record<string, string>>({});

async function reload() {
  error.value = '';
  try {
    board.value = await api<Board>('/api/payments');
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
if (can('write')) {
  try {
    [setup.value, bookings.value] = await Promise.all([
      api<NonNullable<typeof setup.value>>('/api/payments/setup'),
      api<Bk[]>('/api/bookings'),
    ]);
  } catch (e) {
    error.value = errorText(e);
  }
}
useLive().onChange(['payments', 'costs', 'tips'], reload);

const beneficiaries = computed(() => setup.value?.beneficiaries ?? []);
const holders = computed(() => beneficiaries.value.filter((b) => b.type === 'STAFF' && b.userId));
const payees = computed(() => beneficiaries.value.filter((b) => b.type !== 'STAFF'));
const withLines = computed(() => form.kind === 'COST' || form.kind === 'SETTLEMENT');
const amountMinor = computed(() => parseMoney(form.amount, form.currency as Currency));
const picked = computed(() => candidates.value.filter((l) => form.lineIds.includes(l.id)));
const pickedTotal = computed(() => {
  const cur = new Set(picked.value.map((l) => l.currency));
  return cur.size === 1
    ? `${picked.value[0]!.currency}, ${picked.value.length} lines`
    : cur.size > 1
      ? 'one order, one currency'
      : '';
});

async function loadCandidates() {
  form.lineIds = [];
  candidates.value = [];
  const q =
    form.kind === 'SETTLEMENT'
      ? form.beneficiaryId && `holderId=${form.beneficiaryId}`
      : form.bookingId && `bookingId=${form.bookingId}`;
  if (!q) return;
  try {
    candidates.value = await api<Line[]>(`/api/payments/candidates?${q}`);
  } catch (e) {
    error.value = errorText(e);
  }
}
watch(
  () => [form.kind, form.bookingId, form.kind === 'SETTLEMENT' ? form.beneficiaryId : ''],
  loadCandidates,
);
/** The lines' "paid to" word suggests the beneficiary: pick the first whose name contains it. */
watch(picked, (ls) => {
  if (form.kind !== 'COST' || form.beneficiaryId || !ls.length) return;
  const word = ls[0]!.paidTo.toLowerCase().split(/\s+/)[0] ?? '';
  const hit = word && payees.value.find((b) => b.name.toLowerCase().includes(word));
  if (hit) form.beneficiaryId = hit.id;
});
const canSubmit = computed(() =>
  withLines.value
    ? !!form.beneficiaryId &&
      form.lineIds.length > 0 &&
      new Set(picked.value.map((l) => l.currency)).size === 1
    : !!form.beneficiaryId &&
      amountMinor.value !== null &&
      amountMinor.value > 0 &&
      (form.kind !== 'EXPENSE' || (!!form.categoryId && form.purpose.trim().length >= 3)),
);

async function run(job: () => Promise<unknown>, done: string) {
  error.value = msg.value = '';
  busy.value = true;
  try {
    await job();
    msg.value = done;
    await reload();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  error.value = msg.value = '';
  busy.value = true;
  try {
    const body: Record<string, unknown> = {
      kind: form.kind,
      beneficiaryId: form.beneficiaryId,
      note: form.note,
    };
    if (withLines.value) body.costLineIds = form.lineIds;
    else {
      body.currency = form.currency;
      body.amountMinor = amountMinor.value;
    }
    if (form.kind !== 'SETTLEMENT') body.purpose = form.purpose;
    if (form.kind === 'EXPENSE') {
      body.categoryId = form.categoryId;
      body.date = form.date;
    }
    const p = await api<Payment>('/api/payments', { method: 'POST', body });
    msg.value =
      p.status === 'BLOCKED'
        ? `${p.number} is blocked: the same box, fee and payee are already on ${p.blocked?.existingNumber}. It is with the Managing Director.`
        : `${p.number} requested — waiting for approval${p.needsCode ? ' (above the threshold: the approver will need their code)' : ''}.`;
    Object.assign(form, { lineIds: [], amount: '', purpose: '', note: '', beneficiaryId: '' });
    await Promise.all([loadCandidates(), reload()]);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const sendCode = (p: Payment) =>
  run(async () => {
    await api(`/api/payments/${p.id}/code`, { method: 'POST' });
    sent.value[p.id] = true;
  }, `Your code for ${p.number} is in your mailbox. Type it here to approve.`);
const approve = (p: Payment) =>
  run(
    () =>
      api(`/api/payments/${p.id}/approve`, {
        method: 'POST',
        body: p.needsCode ? { code: codes.value[p.id] } : {},
      }),
    `${p.number} approved — ${p.kind === 'SETTLEMENT' ? 'settled; the float dropped' : 'ready to pay'}.`,
  );
const reject = (p: Payment) =>
  run(
    () =>
      api(`/api/payments/${p.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason.value[p.id] },
      }),
    `${p.number} rejected; its lines are free again.`,
  );

const mayApprove = (p: Payment) => can('approve') && p.requestedById !== board.value?.me;
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const waiting = computed(() => board.value?.open.filter((p) => p.status === 'REQUESTED') ?? []);
const blocked = computed(() => board.value?.open.filter((p) => p.status === 'BLOCKED') ?? []);
const toPay = computed(() => board.value?.open.filter((p) => p.status === 'APPROVED') ?? []);
</script>

<template>
  <div>
    <div class="cards">
      <div class="card">
        <div class="lbl">Waiting for approval</div>
        <div class="val">{{ board?.totals.waiting ?? 0 }}</div>
        <div class="subt">one click; above {{ board?.thresholdUsd }} USD, with your code</div>
      </div>
      <div class="card">
        <div class="lbl">Blocked</div>
        <div class="val" style="color: var(--bad)">{{ board?.totals.blocked ?? 0 }}</div>
        <div class="subt">same box, fee and payee — with the Managing Director</div>
      </div>
      <div class="card">
        <div class="lbl">Approved, to pay</div>
        <div class="val">{{ board?.totals.toPay ?? 0 }}</div>
        <div class="subt">the Finance Officer pays and locks</div>
      </div>
      <div class="card">
        <div class="lbl">Paid this month</div>
        <div class="val">{{ board?.totals.paidThisMonth ?? 0 }}</div>
        <div class="subt">USD {{ board?.totals.paidUsd ?? '0.00' }} · every one locked</div>
      </div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <form v-if="can('write') && setup" class="panel" @submit.prevent="submit">
      <div class="panel-h">
        <h2>Request a payment</h2>
        <div class="act">
          <button
            v-for="[k, label] in kinds"
            :key="k"
            type="button"
            class="btn sm"
            :class="form.kind === k ? '' : 'ghost'"
            @click="form.kind = k"
          >
            {{ label }}
          </button>
        </div>
      </div>
      <div class="form-grid">
        <div v-if="form.kind === 'COST'">
          <label class="f">1 · Booking — its cost lines not yet on an order</label>
          <select v-model="form.bookingId" class="f">
            <option value="" disabled>choose…</option>
            <option
              v-for="b in bookings"
              :key="b.id"
              :value="b.id"
              :disabled="b.status === 'CANCELLED'"
            >
              {{ b.fileNumber }} · {{ b.reference }} · {{ b.client.name }}
            </option>
          </select>
        </div>
        <div v-if="form.kind === 'SETTLEMENT' || form.kind === 'FLOAT_ADVANCE'">
          <label class="f">1 · Who holds the float</label>
          <select v-model="form.beneficiaryId" class="f">
            <option value="" disabled>choose…</option>
            <option v-for="b in holders" :key="b.id" :value="b.id" :disabled="!b.payable">
              {{ b.holder }} · {{ b.bank }} {{ b.number }} · {{ b.currency
              }}{{ b.payable ? '' : ' · not yet verified' }}
            </option>
          </select>
          <div v-if="!holders.length" class="hint">
            No float holder yet: add a staff beneficiary under Payments → Beneficiaries.
          </div>
        </div>
        <div v-if="form.kind === 'COST' || form.kind === 'EXPENSE'">
          <label class="f"
            >{{ form.kind === 'COST' ? '2' : '1' }} · Paid to — a registered beneficiary</label
          >
          <select v-model="form.beneficiaryId" class="f">
            <option value="" disabled>choose…</option>
            <option v-for="b in payees" :key="b.id" :value="b.id">
              {{ b.name }} · {{ b.bank }} {{ b.number }} · {{ b.currency
              }}{{ b.payable ? '' : ' · not yet verified' }}
            </option>
          </select>
        </div>
        <div v-if="withLines" class="full">
          <label class="f"
            >{{ form.kind === 'COST' ? '3' : '2' }} · Tick the lines this order pays</label
          >
          <div v-if="!candidates.length" class="hint">
            {{
              form.kind === 'SETTLEMENT'
                ? 'No cash line of this person waits for settlement.'
                : 'Choose a booking; only lines not yet on an order are listed.'
            }}
          </div>
          <div v-else class="tablewrap">
            <table>
              <tr>
                <th></th>
                <th>Box</th>
                <th>What</th>
                <th>Date</th>
                <th>Paid to (as typed)</th>
                <th>Amount</th>
                <th>≈ USD</th>
              </tr>
              <tr v-for="l in candidates" :key="l.id">
                <td><input v-model="form.lineIds" type="checkbox" :value="l.id" /></td>
                <td class="mono">{{ pretty(l.containerNumber) }}</td>
                <td>
                  {{ l.category
                  }}<span v-if="l.tipId" class="st st-cop" style="margin-left: 6px">tip</span>
                </td>
                <td class="mono">{{ l.date }}</td>
                <td>{{ l.paidTo || '—' }}</td>
                <td class="mono">{{ l.currency }} {{ l.amount }}</td>
                <td class="mono">{{ l.usd }}</td>
              </tr>
            </table>
          </div>
          <div v-if="picked.length" class="hint">{{ pickedTotal }}</div>
        </div>
        <template v-else>
          <div v-if="form.kind === 'EXPENSE'">
            <label class="f">2 · Category</label>
            <select v-model="form.categoryId" class="f">
              <option value="" disabled>choose…</option>
              <option v-for="c in setup.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div v-if="form.kind === 'EXPENSE'">
            <label class="f">3 · Date of the bill</label>
            <input v-model="form.date" class="f mono" type="date" required />
          </div>
          <div>
            <label class="f">{{ form.kind === 'EXPENSE' ? '4' : '2' }} · Amount</label>
            <div style="display: flex; gap: 8px">
              <select v-model="form.currency" class="f" style="width: 100px">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <input
                v-model="form.amount"
                class="f mono"
                inputmode="decimal"
                placeholder="e.g. 1,200,000"
              />
            </div>
          </div>
        </template>
        <div v-if="form.kind !== 'SETTLEMENT'" :class="withLines ? '' : ''">
          <label class="f">{{
            form.kind === 'EXPENSE' ? '5 · What for' : 'What for (optional)'
          }}</label>
          <input
            v-model="form.purpose"
            class="f"
            maxlength="160"
            :placeholder="
              form.kind === 'EXPENSE'
                ? 'e.g. Office rent — Kigali (October)'
                : 'filled in from the lines if left empty'
            "
          />
        </div>
        <div>
          <label class="f">Note (optional)</label>
          <input v-model="form.note" class="f" maxlength="300" />
        </div>
        <div class="full" style="margin-top: 10px">
          <button class="btn" :disabled="busy || !canSubmit">Request — waits for approval</button>
          <span class="hint" style="margin-left: 10px">
            {{
              form.kind === 'SETTLEMENT'
                ? 'Approving a settlement is the whole act: the cash in hands drops at once; no money leaves the bank.'
                : 'The same box + fee + payee is paid once; a repeat is blocked and goes to the Managing Director.'
            }}
          </span>
        </div>
      </div>
    </form>

    <div class="panel">
      <div class="panel-h">
        <h2>Waiting for approval — {{ waiting.length }}</h2>
        <span class="hint" style="margin-left: auto"
          >approved by someone other than the requester · above USD {{ board?.thresholdUsd }} with
          the approver's code</span
        >
      </div>
      <div v-if="!waiting.length" class="pad hint">Nothing waits.</div>
      <div v-for="p in waiting" :key="p.id" class="pad" style="border-bottom: 1px solid #eef2f7">
        <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline">
          <b class="mono">{{ p.number }}</b>
          <span class="st st-grey">{{ p.kindLabel }}</span>
          <span>{{ p.purpose }}</span>
          <span class="hint"
            >by {{ p.requestedBy }} · {{ fmt(p.requestedAt)
            }}<span v-if="p.companyName"> · {{ p.companyName }}</span></span
          >
        </div>
        <div
          style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 4px"
        >
          <span
            >{{ p.beneficiary.name }}
            <span class="hint">{{ p.beneficiary.bank }} {{ p.beneficiary.number }}</span></span
          >
          <b class="mono">{{ p.currency }} {{ p.amount }}</b>
          <span class="hint mono">≈ USD {{ p.usd }}</span>
          <span v-if="p.needsCode" class="st st-warn">above the threshold · code</span>
          <span v-if="p.beneficiary.hold" class="st st-bad">{{ p.beneficiary.hold }}</span>
          <span v-if="p.lines.length" class="hint">{{
            p.lines.map((l) => pretty(l.containerNumber)).join(', ')
          }}</span>
        </div>
        <div
          v-if="mayApprove(p)"
          style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px"
        >
          <template v-if="p.needsCode">
            <button type="button" class="btn sm ghost" :disabled="busy" @click="sendCode(p)">
              {{ sent[p.id] ? 'Send the code again' : 'Send me my code' }}
            </button>
            <input
              v-model="codes[p.id]"
              class="f mono"
              style="width: 110px"
              maxlength="6"
              inputmode="numeric"
              placeholder="6 digits"
            />
            <button
              type="button"
              class="btn sm"
              :disabled="busy || !/^\d{6}$/.test(codes[p.id] ?? '') || !!p.beneficiary.hold"
              @click="approve(p)"
            >
              Approve
            </button>
          </template>
          <button
            v-else
            type="button"
            class="btn sm"
            :disabled="busy || !!p.beneficiary.hold"
            @click="approve(p)"
          >
            Approve
          </button>
          <input
            v-model="rejectReason[p.id]"
            class="f"
            style="width: 220px"
            placeholder="reason to reject"
          />
          <button
            type="button"
            class="btn sm red"
            :disabled="busy || (rejectReason[p.id] ?? '').trim().length < 3"
            @click="reject(p)"
          >
            Reject
          </button>
        </div>
        <div v-else-if="can('approve')" class="hint" style="margin-top: 6px">
          You requested this one: someone else approves it.
        </div>
      </div>
    </div>

    <div v-if="blocked.length" class="panel">
      <div class="panel-h"><h2>Blocked — with the Managing Director</h2></div>
      <div v-for="p in blocked" :key="p.id" class="pad" style="border-bottom: 1px solid #eef2f7">
        <span class="st st-bad">double payment</span>
        <b class="mono" style="margin-left: 8px">{{ p.number }}</b> · {{ p.purpose }} ·
        <span class="mono">{{ p.currency }} {{ p.amount }}</span> to {{ p.beneficiary.name }}
        <div class="hint">
          this exact box + fee + payee is already on
          <b class="mono">{{ p.blocked?.existingNumber }}</b
          >. The system will not raise it twice on its own: the Managing Director rules, with both
          orders in view.
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Approved — ready to pay · {{ toPay.length }}</h2>
        <span class="hint" style="margin-left: auto">paid and locked under Payments → Pay</span>
      </div>
      <div v-if="!toPay.length" class="pad hint">Nothing approved waits for payment.</div>
      <div class="tablewrap" v-else>
        <table>
          <tr>
            <th>Ref</th>
            <th>Purpose</th>
            <th>Beneficiary</th>
            <th>Amount</th>
            <th>Approved by</th>
          </tr>
          <tr v-for="p in toPay" :key="p.id">
            <td class="mono">{{ p.number }}</td>
            <td>{{ p.purpose }}</td>
            <td>
              {{ p.beneficiary.name }} <span class="hint">{{ p.beneficiary.number }}</span>
            </td>
            <td class="mono">{{ p.currency }} {{ p.amount }}</td>
            <td>
              {{ p.approvedBy }} · {{ fmt(p.approvedAt)
              }}<span v-if="p.approvedWithCode" class="st st-ok" style="margin-left: 6px"
                >code</span
              >
            </td>
          </tr>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Decided this month — paid and locked, or rejected</h2></div>
      <div v-if="!board?.done.length" class="pad hint">Nothing yet this month.</div>
      <div class="tablewrap" v-else>
        <table>
          <tr>
            <th>Ref</th>
            <th>Purpose</th>
            <th>Beneficiary</th>
            <th>Amount</th>
            <th>State</th>
            <th>By</th>
          </tr>
          <tr v-for="p in board!.done" :key="p.id">
            <td class="mono">{{ p.number }}</td>
            <td>
              {{ p.purpose }}
              <div v-if="p.rejectReason" class="hint">{{ p.rejectReason }}</div>
            </td>
            <td>{{ p.beneficiary.name }}</td>
            <td class="mono">{{ p.currency }} {{ p.amount }}</td>
            <td>
              <span class="st" :class="p.status === 'PAID' ? 'st-ok' : 'st-grey'">{{
                p.statusLabel
              }}</span
              ><span v-if="p.paidRef" class="hint mono" style="margin-left: 6px">{{
                p.paidRef
              }}</span>
            </td>
            <td>
              {{
                p.status === 'PAID'
                  ? `${p.paidBy} · ${fmt(p.paidAt)}`
                  : `${p.rejectedBy} · ${fmt(p.rejectedAt)}`
              }}
            </td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>
