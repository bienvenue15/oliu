<script setup lang="ts">
/**
 * Payments → Beneficiaries: the registry of protected accounts. Anyone who may write proposes a beneficiary or a
 * change of account; a second person (the Operations Manager or the MD, never the proposer) confirms it with a
 * one-time code from their own mailbox. Until then no payment uses that account. Numbers are masked here; the
 * trail keeps them whole.
 */
import { BENEFICIARY_TYPE_LABEL, CURRENCIES, PAYEE_ACCOUNT_KINDS } from '@oliu/shared';
const api = useApi();
const { can, me } = useSession();

interface Beneficiary {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  userId: string | null;
  holder: string | null;
  accountKind: string;
  bank: string;
  number: string;
  currency: string;
  status: string;
  note: string;
  pending: {
    accountKind: string;
    bank: string;
    number: string;
    currency: string;
    reason: string;
    by: string;
    byId: string | null;
    at: string;
  } | null;
  proposedBy: string;
  proposedById: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  suspendReason: string;
  payable: boolean;
  updatedAt: string;
}
interface Registry {
  beneficiaries: Beneficiary[];
  people: { id: string; name: string; role: string; companyName: string }[];
  me: string;
}

const data = ref<Registry | null>(null);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const typeFilter = ref('');
const statusFilter = ref('');
const types = Object.entries(BENEFICIARY_TYPE_LABEL);
const form = reactive({
  name: '',
  type: 'TRANSPORTER',
  userId: '',
  accountKind: 'BANK',
  bank: '',
  number: '',
  currency: 'RWF',
  note: '',
});
const changing = ref<string | null>(null);
const change = reactive({ accountKind: 'BANK', bank: '', number: '', currency: 'RWF', reason: '' });
const codes = ref<Record<string, string>>({});
const sent = ref<Record<string, boolean>>({});
const reasons = ref<Record<string, string>>({});

async function reload() {
  error.value = '';
  try {
    data.value = await api<Registry>('/api/beneficiaries');
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
useLive().onChange(['payments'], reload);

const rows = computed(() =>
  (data.value?.beneficiaries ?? []).filter(
    (b) =>
      (!typeFilter.value || b.type === typeFilter.value) &&
      (!statusFilter.value ||
        (statusFilter.value === 'WAITING'
          ? b.status === 'PENDING' || b.pending
          : b.status === statusFilter.value)),
  ),
);
const waiting = computed(() =>
  (data.value?.beneficiaries ?? []).filter((b) => b.status === 'PENDING' || b.pending),
);
/** Who proposed what is waiting: that person does not confirm it. */
const proposerOf = (b: Beneficiary) => (b.pending ? b.pending.byId : b.proposedById);
const mayConfirm = (b: Beneficiary) => can('beneficiaries') && proposerOf(b) !== data.value?.me;

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
const add = () =>
  run(
    () =>
      api('/api/beneficiaries', {
        method: 'POST',
        body: { ...form, userId: form.type === 'STAFF' ? form.userId || null : null },
      }).then(() => Object.assign(form, { name: '', number: '', bank: '', note: '', userId: '' })),
    me.value?.user.role === 'MD'
      ? 'Added and verified — payments to this beneficiary can go ahead.'
      : 'Proposed. A second person confirms it with their code before any payment uses it.',
  );
const startChange = (b: Beneficiary) => {
  changing.value = changing.value === b.id ? null : b.id;
  Object.assign(change, {
    accountKind: b.accountKind,
    bank: b.bank,
    number: '',
    currency: b.currency,
    reason: '',
  });
};
const proposeChange = (b: Beneficiary) =>
  run(
    () =>
      api(`/api/beneficiaries/${b.id}/change`, { method: 'POST', body: { ...change } }).then(
        () => (changing.value = null),
      ),
    `Change proposed for ${b.name}. Until a second person confirms it, no payment goes to this beneficiary.`,
  );
const sendCode = (b: Beneficiary) =>
  run(async () => {
    await api(`/api/beneficiaries/${b.id}/code`, { method: 'POST' });
    sent.value[b.id] = true;
  }, `Your code for ${b.name} is in your mailbox. Type it here to confirm.`);
const confirm = (b: Beneficiary) =>
  run(
    () =>
      api(`/api/beneficiaries/${b.id}/confirm`, {
        method: 'POST',
        body: { code: codes.value[b.id] },
      }),
    `${b.name} confirmed. The old and new numbers are in the audit trail.`,
  );
const drop = (b: Beneficiary) =>
  run(
    () =>
      api(`/api/beneficiaries/${b.id}/drop`, {
        method: 'POST',
        body: { reason: reasons.value[b.id] },
      }),
    'Dropped.',
  );
const suspend = (b: Beneficiary) =>
  run(
    () =>
      api(`/api/beneficiaries/${b.id}/${b.status === 'SUSPENDED' ? 'reactivate' : 'suspend'}`, {
        method: 'POST',
        body: { reason: reasons.value[b.id] },
      }),
    b.status === 'SUSPENDED' ? `${b.name} is active again.` : `${b.name} suspended.`,
  );
const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
const account = (x: { accountKind: string; bank: string; number: string; currency: string }) =>
  `${x.bank} ${x.number} · ${x.currency}${x.accountKind === 'MOMO' ? ' · MoMo' : ''}`;
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div v-if="waiting.length" class="panel">
      <div class="panel-h">
        <h2>Awaiting a second pair of eyes — {{ waiting.length }}</h2>
        <span class="hint" style="margin-left: auto"
          >confirmed with a code to your mailbox, never by the proposer</span
        >
      </div>
      <div v-for="b in waiting" :key="b.id" class="pad" style="border-bottom: 1px solid #eef2f7">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <span class="st st-warn">{{ b.pending ? 'account change' : 'new beneficiary' }}</span>
          <b>{{ b.name }}</b>
          <span class="hint">{{ b.typeLabel }}</span>
          <span v-if="b.pending" class="mono"
            >{{ account(b) }} → <b>{{ account(b.pending) }}</b></span
          >
          <span v-else class="mono">{{ account(b) }}</span>
          <span class="hint">{{
            b.pending
              ? `${b.pending.reason} · by ${b.pending.by} · ${fmt(b.pending.at)}`
              : `by ${b.proposedBy}`
          }}</span>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px">
          <template v-if="mayConfirm(b)">
            <button type="button" class="btn sm ghost" :disabled="busy" @click="sendCode(b)">
              {{ sent[b.id] ? 'Send the code again' : 'Send me my code' }}
            </button>
            <input
              v-model="codes[b.id]"
              class="f mono"
              style="width: 110px"
              maxlength="6"
              inputmode="numeric"
              placeholder="6 digits"
            />
            <button
              type="button"
              class="btn sm"
              :disabled="busy || !/^\d{6}$/.test(codes[b.id] ?? '')"
              @click="confirm(b)"
            >
              Confirm
            </button>
          </template>
          <span v-else-if="can('beneficiaries')" class="hint"
            >You proposed this: someone else confirms it.</span
          >
          <span v-else class="hint"
            >Waits for the Operations Manager or the Managing Director.</span
          >
          <template v-if="can('write')">
            <input
              v-model="reasons[b.id]"
              class="f"
              style="width: 200px"
              placeholder="reason to drop"
            />
            <button
              type="button"
              class="btn sm red"
              :disabled="busy || (reasons[b.id] ?? '').trim().length < 3"
              @click="drop(b)"
            >
              Drop
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Beneficiary registry — protected accounts</h2>
        <div class="act">
          <select v-model="typeFilter" class="sel">
            <option value="">All types</option>
            <option v-for="[k, l] in types" :key="k" :value="k">{{ l }}</option>
          </select>
          <select v-model="statusFilter" class="sel">
            <option value="">All statuses</option>
            <option value="VERIFIED">✓ Verified</option>
            <option value="WAITING">⏳ Awaiting 2nd approval</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
      </div>
      <div v-if="!rows.length" class="pad hint">Nobody in the registry yet.</div>
      <div class="tablewrap" v-else>
        <table>
          <tr>
            <th>Beneficiary</th>
            <th>Type</th>
            <th>Bank / MoMo account</th>
            <th>Status</th>
            <th>Last change</th>
            <th></th>
          </tr>
          <template v-for="b in rows" :key="b.id">
            <tr>
              <td>
                <b>{{ b.name }}</b>
                <div v-if="b.holder" class="hint">float of {{ b.holder }}</div>
                <div v-if="b.note" class="hint">{{ b.note }}</div>
              </td>
              <td>{{ b.typeLabel }}</td>
              <td class="mono">
                {{ account(b) }}
                <div v-if="b.pending" class="hint">→ {{ account(b.pending) }}</div>
              </td>
              <td>
                <span v-if="b.status === 'SUSPENDED'" class="st st-grey">suspended</span>
                <span v-else-if="b.status === 'PENDING'" class="st st-warn"
                  >⏳ awaiting 2nd approval</span
                >
                <span v-else-if="b.pending" class="st st-warn"
                  >⏳ change awaiting 2nd approval</span
                >
                <span v-else class="st st-ok">✓ verified</span>
                <div v-if="b.suspendReason" class="hint">{{ b.suspendReason }}</div>
              </td>
              <td class="hint">
                {{
                  b.verifiedBy
                    ? `${fmt(b.verifiedAt)} · approved by ${b.verifiedBy}`
                    : `proposed by ${b.proposedBy}`
                }}
              </td>
              <td style="white-space: nowrap">
                <button
                  v-if="can('write') && b.status !== 'PENDING' && !b.pending"
                  class="btn sm ghost"
                  @click="startChange(b)"
                >
                  Change account
                </button>
                <template v-if="can('beneficiaries')">
                  <input
                    v-model="reasons[b.id]"
                    class="f"
                    style="width: 140px; margin-left: 6px"
                    placeholder="reason"
                  />
                  <button
                    class="btn sm"
                    :class="b.status === 'SUSPENDED' ? '' : 'red'"
                    style="margin-left: 4px"
                    :disabled="busy || (reasons[b.id] ?? '').trim().length < 3"
                    @click="suspend(b)"
                  >
                    {{ b.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend' }}
                  </button>
                </template>
              </td>
            </tr>
            <tr v-if="changing === b.id">
              <td colspan="6" style="background: #fafbfd">
                <form
                  style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
                  @submit.prevent="proposeChange(b)"
                >
                  <span class="hint"
                    >New account for <b>{{ b.name }}</b
                    >:</span
                  >
                  <select v-model="change.accountKind" class="f" style="width: 100px">
                    <option v-for="k in PAYEE_ACCOUNT_KINDS" :key="k" :value="k">
                      {{ k === 'BANK' ? 'Bank' : 'MoMo' }}
                    </option>
                  </select>
                  <input
                    v-model="change.bank"
                    class="f"
                    style="width: 160px"
                    placeholder="bank or network"
                    required
                  />
                  <input
                    v-model="change.number"
                    class="f mono"
                    style="width: 180px"
                    placeholder="account / phone number"
                    required
                  />
                  <select v-model="change.currency" class="f" style="width: 90px">
                    <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <input
                    v-model="change.reason"
                    class="f"
                    style="width: 220px"
                    placeholder="why — e.g. their letter of 21 Aug"
                    required
                  />
                  <button
                    class="btn sm"
                    :disabled="busy || change.number.length < 4 || change.reason.length < 3"
                  >
                    Propose the change
                  </button>
                </form>
              </td>
            </tr>
          </template>
        </table>
      </div>
      <div class="pad hint" style="border-top: 1px solid #eef2f7">
        🛡 Four-eyes: an account number is never changed by one person alone. The second approval is
        confirmed with a one-time code to that person's mailbox. Old and new numbers are kept in the
        audit trail forever. The same discipline applies to paying the same box, fee and payee twice
        (Needs payment).
      </div>
    </div>

    <form v-if="can('write')" class="panel" @submit.prevent="add">
      <div class="panel-h"><h2>+ New beneficiary</h2></div>
      <div class="form-grid">
        <div>
          <label class="f">Name</label
          ><input v-model="form.name" class="f" maxlength="120" required />
        </div>
        <div>
          <label class="f">Type</label
          ><select v-model="form.type" class="f">
            <option v-for="[k, l] in types" :key="k" :value="k">{{ l }}</option>
          </select>
        </div>
        <div v-if="form.type === 'STAFF'">
          <label class="f">Who holds the float</label
          ><select v-model="form.userId" class="f" required>
            <option value="" disabled>choose…</option>
            <option v-for="p in data?.people ?? []" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.companyName || 'all companies' }}
            </option>
          </select>
        </div>
        <div>
          <label class="f">Account</label>
          <div style="display: flex; gap: 8px">
            <select v-model="form.accountKind" class="f" style="width: 100px">
              <option v-for="k in PAYEE_ACCOUNT_KINDS" :key="k" :value="k">
                {{ k === 'BANK' ? 'Bank' : 'MoMo' }}
              </option></select
            ><input v-model="form.bank" class="f" placeholder="bank or network" required />
          </div>
        </div>
        <div>
          <label class="f">Account / phone number</label
          ><input v-model="form.number" class="f mono" maxlength="40" required />
        </div>
        <div>
          <label class="f">Currency</label
          ><select v-model="form.currency" class="f">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="full">
          <label class="f">Note (optional)</label
          ><input v-model="form.note" class="f" maxlength="300" />
        </div>
        <div class="full" style="margin-top: 10px">
          <button
            class="btn"
            :disabled="
              busy ||
              form.name.trim().length < 2 ||
              form.number.length < 4 ||
              form.bank.length < 2 ||
              (form.type === 'STAFF' && !form.userId)
            "
          >
            {{
              me?.user.role === 'MD'
                ? 'Add — verified at once'
                : 'Propose — a second person verifies'
            }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>
