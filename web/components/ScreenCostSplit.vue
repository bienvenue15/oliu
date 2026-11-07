<script setup lang="ts">
/**
 * Shipments → Cost & split. Money is never entered as a bare number: booking first, then its boxes appear;
 * one bill across several boxes is typed once and the system divides it — equally, by weight, or by hand.
 * Below, this company's cost lines of the month, where a line is corrected or voided with a reason.
 */
import {
  CURRENCIES,
  CURRENCY_EXPONENT,
  SPLIT_METHODS,
  formatMoney,
  parseMoney,
  splitByWeight,
  splitEqual,
  toUsdCents,
  type Currency,
} from '@oliu/shared';
const api = useApi();
const { me, activeCompany } = useSession();
const route = useRoute();

interface Bk {
  id: string;
  fileNumber: string;
  reference: string;
  status: string;
  client: { name: string };
  cargo: string;
  containerCount: number;
}
interface Box {
  id: string;
  number: string;
  size: string;
  weightKg: number | null;
  status: string;
  usd: string;
}
interface Category {
  id: string;
  name: string;
  active: boolean;
}
interface Rate {
  currency: string;
  date: string;
  perUsd: string;
}
interface Line {
  id: string;
  containerNumber: string;
  bookingId: string;
  category: string;
  date: string;
  currency: string;
  amount: string;
  amountMinor: number;
  perUsd: string;
  usd: string;
  paidTo: string;
  reference: string;
  status: string;
  voidReason: string;
  split: { method: string } | null;
  delayRelated: boolean;
  enteredBy: string;
}

const months = (() => {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      value: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
      label: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
})();
const month = ref(months[0]!.value);
const bookings = ref<Bk[]>([]);
const categories = ref<Category[]>([]);
const rates = ref<Rate[]>([]);
const lines = ref<Line[]>([]);
const boxes = ref<Box[]>([]);
const error = ref('');
const msg = ref('');
const busy = ref(false);

const companyCurrency = computed<Currency>(() => {
  const c = me.value?.companies.find(
    (x) => x.id === (me.value?.user.companyId ?? activeCompany.value),
  ) as { currency?: string } | undefined;
  return (CURRENCIES as readonly string[]).includes(c?.currency ?? '')
    ? (c!.currency as Currency)
    : 'USD';
});

const form = reactive({
  bookingId: String(route.query.booking ?? ''),
  categoryId: '',
  date: new Date().toISOString().slice(0, 10),
  currency: 'USD' as Currency,
  amount: '',
  paidTo: '',
  reference: '',
  note: '',
  method: 'EQUAL' as (typeof SPLIT_METHODS)[number],
});
const ticked = ref<Set<string>>(new Set());
const manual = ref<Record<string, string>>({});

async function loadLists() {
  [bookings.value, categories.value, rates.value, lines.value] = await Promise.all([
    api<Bk[]>('/api/bookings'),
    api<Category[]>('/api/cost-categories'),
    api<Rate[]>('/api/rates/latest'),
    api<Line[]>(`/api/costs?month=${month.value}&all=true`),
  ]);
  categories.value = categories.value.filter((c) => c.active);
  if (!form.categoryId && categories.value[0]) form.categoryId = categories.value[0].id;
  if (!form.currency) form.currency = companyCurrency.value;
}
await loadLists();
form.currency = companyCurrency.value;
watch(month, () => loadLists());
useLive().onChange(['costs', 'shipments', 'journey'], loadLists);

async function loadBoxes() {
  boxes.value = [];
  ticked.value = new Set();
  if (!form.bookingId) return;
  const r = await api<{ containers: Box[] }>(`/api/bookings/${form.bookingId}/costs`);
  boxes.value = r.containers.filter((c) => c.status === 'ACTIVE');
  const wanted = String(route.query.container ?? '');
  if (wanted && boxes.value.some((b) => b.id === wanted)) ticked.value = new Set([wanted]);
}
watch(() => form.bookingId, loadBoxes, { immediate: true });

const tickedBoxes = computed(() => boxes.value.filter((b) => ticked.value.has(b.id)));
function toggle(id: string) {
  const s = new Set(ticked.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  ticked.value = s;
}
const tickAll = () => (ticked.value = new Set(boxes.value.map((b) => b.id)));

const totalMinor = computed(() => parseMoney(form.amount, form.currency));
const latestRate = computed(() =>
  form.currency === 'USD' ? '1' : rates.value.find((r) => r.currency === form.currency)?.perUsd,
);
const weightsMissing = computed(() =>
  tickedBoxes.value.filter((b) => !b.weightKg || b.weightKg <= 0).map((b) => b.number),
);
/** The split as the system will make it, shown before saving. */
const preview = computed(() => {
  const n = tickedBoxes.value.length;
  const total = totalMinor.value;
  if (!total || n === 0) return [];
  let parts: number[];
  if (n === 1) parts = [total];
  else if (form.method === 'EQUAL') parts = splitEqual(total, n);
  else if (form.method === 'WEIGHT')
    parts = weightsMissing.value.length
      ? []
      : splitByWeight(
          total,
          tickedBoxes.value.map((b) => b.weightKg!),
        );
  else
    parts = tickedBoxes.value.map((b) => parseMoney(manual.value[b.id] ?? '', form.currency) ?? 0);
  return tickedBoxes.value.map((b, i) => ({
    box: b,
    minor: parts[i] ?? 0,
    amount: formatMoney(parts[i] ?? 0, form.currency),
    usd: latestRate.value
      ? formatMoney(toUsdCents(parts[i] ?? 0, form.currency, latestRate.value), 'USD')
      : '—',
  }));
});
const manualSum = computed(() => preview.value.reduce((a, p) => a + p.minor, 0));
const ready = computed(
  () =>
    !!form.bookingId &&
    !!form.categoryId &&
    tickedBoxes.value.length > 0 &&
    !!totalMinor.value &&
    (tickedBoxes.value.length === 1 ||
      form.method === 'EQUAL' ||
      (form.method === 'WEIGHT' && weightsMissing.value.length === 0) ||
      (form.method === 'MANUAL' && manualSum.value === totalMinor.value)),
);

async function save() {
  if (!ready.value) return;
  error.value = msg.value = '';
  busy.value = true;
  try {
    const ids = tickedBoxes.value.map((b) => b.id);
    const r = await api<{ lines: Line[] }>('/api/costs', {
      method: 'POST',
      body: {
        containerIds: ids,
        categoryId: form.categoryId,
        date: form.date,
        currency: form.currency,
        totalMinor: totalMinor.value,
        paidTo: form.paidTo,
        reference: form.reference,
        note: form.note,
        method: ids.length === 1 ? 'EQUAL' : form.method,
        manualMinor:
          ids.length > 1 && form.method === 'MANUAL'
            ? preview.value.map((p) => p.minor)
            : undefined,
      },
    });
    msg.value =
      r.lines.length === 1
        ? `Cost saved on ${r.lines[0]!.containerNumber}: ${form.currency} ${r.lines[0]!.amount} = USD ${r.lines[0]!.usd} at ${r.lines[0]!.perUsd}.`
        : `${form.currency} ${formatMoney(totalMinor.value!, form.currency)} divided across ${r.lines.length} boxes, one line each.`;
    form.amount = '';
    form.reference = '';
    form.note = '';
    manual.value = {};
    await Promise.all([loadLists(), loadBoxes()]);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

// ---- correcting and voiding
const editing = ref<Record<string, { amount: string; reason: string }>>({});
const voiding = ref<Record<string, string>>({});
async function correct(l: Line) {
  const e = editing.value[l.id];
  if (!e) return;
  const minor = parseMoney(e.amount, l.currency as Currency);
  if (!minor) {
    error.value = `Type the amount in ${l.currency}`;
    return;
  }
  error.value = msg.value = '';
  try {
    await api(`/api/costs/${l.id}`, {
      method: 'PATCH',
      body: { amountMinor: minor, reason: e.reason },
    });
    delete editing.value[l.id];
    msg.value = `Line corrected; the totals changed with it.`;
    await loadLists();
    await loadBoxes();
  } catch (err) {
    error.value = errorText(err);
  }
}
async function voidLine(l: Line) {
  error.value = msg.value = '';
  try {
    await api(`/api/costs/${l.id}/void`, { method: 'POST', body: { reason: voiding.value[l.id] } });
    delete voiding.value[l.id];
    msg.value = 'Line voided; it stays in the record, out of the totals.';
    await loadLists();
    await loadBoxes();
  } catch (err) {
    error.value = errorText(err);
  }
}
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const decimals = computed(() => CURRENCY_EXPONENT[form.currency]);
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <form class="panel" @submit.prevent="save">
      <div class="panel-h"><h2>Enter a cost — booking first, then its boxes</h2></div>
      <div class="form-grid">
        <div>
          <label class="f">1 · Booking</label>
          <select v-model="form.bookingId" class="f" required>
            <option value="" disabled>choose…</option>
            <option
              v-for="b in bookings"
              :key="b.id"
              :value="b.id"
              :disabled="b.status === 'CANCELLED'"
            >
              {{ b.fileNumber }} · {{ b.reference }} · {{ b.client.name }} · {{ b.cargo }} ·
              {{ b.containerCount }} {{ b.containerCount === 1 ? 'box' : 'boxes' }}
            </option>
          </select>
        </div>
        <div>
          <label class="f">2 · What for</label>
          <select v-model="form.categoryId" class="f" required>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="f">3 · Date of the cost</label>
          <input v-model="form.date" class="f mono" type="date" required />
        </div>
        <div>
          <label class="f">4 · Amount — the bill's total, typed once</label>
          <div style="display: flex; gap: 8px">
            <select v-model="form.currency" class="f" style="width: 100px">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <input
              v-model="form.amount"
              class="f mono"
              inputmode="decimal"
              required
              :placeholder="decimals ? 'e.g. 2,140.00' : 'e.g. 1,909,000'"
            />
          </div>
          <span v-if="form.amount && totalMinor === null" class="st st-bad"
            >✗ a {{ form.currency }} amount has
            {{ decimals ? `up to ${decimals} decimals` : 'no decimals' }}</span
          >
          <span v-else-if="form.currency !== 'USD' && !latestRate" class="st st-bad"
            >✗ no {{ form.currency }} rate yet — the MD or Finance types it in Settings →
            Configuration</span
          >
          <span v-else-if="form.currency !== 'USD'" class="hint"
            >latest rate {{ latestRate }} per USD; the line takes the rate of its own date</span
          >
        </div>
        <div>
          <label class="f">Paid to (optional until Payments, slice 6)</label>
          <input v-model="form.paidTo" class="f" maxlength="120" placeholder="e.g. Simba Haulage" />
        </div>
        <div>
          <label class="f">Their invoice or receipt № (optional)</label>
          <input v-model="form.reference" class="f mono" maxlength="60" />
        </div>
        <div class="full">
          <label class="f">Note (optional)</label>
          <input v-model="form.note" class="f" maxlength="300" />
        </div>
      </div>

      <div v-if="form.bookingId" class="pad" style="padding-top: 0">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px">
          <b style="font-size: 13px">5 · Tick the boxes this bill covers</b>
          <a class="hint" style="cursor: pointer" @click="tickAll">all</a>
          <a class="hint" style="cursor: pointer" @click="ticked = new Set()">none</a>
          <span v-if="!boxes.length" class="hint">no live box on this booking yet</span>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <label
            v-for="b in boxes"
            :key="b.id"
            class="st"
            :class="ticked.has(b.id) ? 'st-ok' : 'st-grey'"
            style="cursor: pointer; padding: 6px 10px"
          >
            <input
              type="checkbox"
              :checked="ticked.has(b.id)"
              style="margin-right: 6px"
              @change="toggle(b.id)"
            />
            <span class="mono">{{ pretty(b.number) }}</span> · {{ b.size
            }}<span v-if="b.weightKg"> · {{ b.weightKg.toLocaleString() }} kg</span>
            <span class="hint"> · so far $ {{ b.usd }}</span>
          </label>
        </div>
      </div>

      <div v-if="tickedBoxes.length > 1" class="pad" style="padding-top: 0">
        <b style="font-size: 13px"
          >6 · How to divide {{ form.currency }}
          {{ totalMinor ? formatMoney(totalMinor, form.currency) : '…' }} across
          {{ tickedBoxes.length }} boxes</b
        >
        <div style="display: flex; gap: 14px; margin: 6px 0; flex-wrap: wrap">
          <label
            ><input v-model="form.method" type="radio" value="EQUAL" /> equally, remainder on the
            last box</label
          >
          <label><input v-model="form.method" type="radio" value="WEIGHT" /> by weight</label>
          <label
            ><input v-model="form.method" type="radio" value="MANUAL" /> by hand, must add up</label
          >
        </div>
        <div v-if="form.method === 'WEIGHT' && weightsMissing.length" class="st st-bad">
          ✗ weight missing on {{ weightsMissing.join(', ') }} — type it on the Container record, or
          split equally
        </div>
        <div
          v-if="form.method === 'MANUAL'"
          style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px"
        >
          <div v-for="b in tickedBoxes" :key="b.id">
            <label class="f mono">{{ pretty(b.number) }}</label>
            <input v-model="manual[b.id]" class="f mono" style="width: 150px" inputmode="decimal" />
          </div>
          <div
            style="align-self: flex-end"
            :class="manualSum === totalMinor ? 'hint' : 'st st-bad'"
          >
            {{
              manualSum === totalMinor
                ? '✓ adds up'
                : `✗ adds up to ${formatMoney(manualSum, form.currency)}`
            }}
          </div>
        </div>
      </div>

      <div v-if="preview.length" class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>This bill's share</th>
            <th>≈ USD at the latest rate</th>
          </tr>
          <tr v-for="p in preview" :key="p.box.id">
            <td class="mono">{{ pretty(p.box.number) }}</td>
            <td class="mono">{{ form.currency }} {{ p.amount }}</td>
            <td class="mono">{{ p.usd }}</td>
          </tr>
        </table>
      </div>

      <div class="pad" style="display: flex; gap: 8px; align-items: center">
        <button class="btn" :disabled="!ready || busy">
          Save {{ tickedBoxes.length > 1 ? `${tickedBoxes.length} cost lines` : 'cost' }}
        </button>
        <span class="hint">{{
          !form.bookingId
            ? 'pick the booking'
            : !tickedBoxes.length
              ? 'tick at least one box'
              : !totalMinor
                ? 'type the amount'
                : ready
                  ? "ready — one line per box, in your company's book"
                  : 'fix what is marked ✗'
        }}</span>
      </div>
    </form>

    <div class="panel">
      <div class="panel-h">
        <h2>Cost lines — your book</h2>
        <div class="act">
          <select v-model="month" class="f" style="width: 170px">
            <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Date</th>
            <th>Container №</th>
            <th>Category</th>
            <th>Paid to</th>
            <th>Original</th>
            <th>Rate</th>
            <th>USD</th>
            <th>By</th>
            <th></th>
          </tr>
          <tr v-for="l in lines" :key="l.id" :class="{ hint: l.status === 'VOID' }">
            <td class="mono">{{ l.date }}</td>
            <td class="mono">
              <NuxtLink :to="`/app/cost?number=${l.containerNumber}`">{{
                pretty(l.containerNumber)
              }}</NuxtLink>
            </td>
            <td>
              {{ l.category
              }}<span v-if="l.split" class="hint"> · split {{ l.split.method.toLowerCase() }}</span
              ><span v-if="l.delayRelated" class="st st-bad" style="margin-left: 6px">delay</span>
              <div v-if="l.status === 'VOID'" class="st st-grey">void — {{ l.voidReason }}</div>
              <div v-else-if="l.status === 'PENDING_MD'" class="st st-warn">
                waiting for the MD — the box is on the other side
              </div>
            </td>
            <td>
              {{ l.paidTo || '—' }}
              <div v-if="l.reference" class="hint mono">{{ l.reference }}</div>
            </td>
            <td class="mono">
              <template v-if="editing[l.id]">
                <input
                  v-model="editing[l.id]!.amount"
                  class="f mono"
                  style="width: 130px"
                  inputmode="decimal"
                />
                <input
                  v-model="editing[l.id]!.reason"
                  class="f"
                  style="width: 200px; margin-top: 4px"
                  placeholder="why (kept in the trail)"
                />
              </template>
              <template v-else>{{ l.currency }} {{ l.amount }}</template>
            </td>
            <td class="mono">{{ l.perUsd }}</td>
            <td class="mono">
              <b>{{ l.usd }}</b>
            </td>
            <td>{{ l.enteredBy }}</td>
            <td style="white-space: nowrap">
              <template v-if="l.status === 'ACTIVE'">
                <template v-if="editing[l.id]">
                  <button
                    class="btn sm"
                    :disabled="(editing[l.id]?.reason.trim().length ?? 0) < 3"
                    @click="correct(l)"
                  >
                    Save
                  </button>
                  <button class="btn sm ghost" @click="delete editing[l.id]">Cancel</button>
                </template>
                <template v-else-if="voiding[l.id] !== undefined">
                  <input v-model="voiding[l.id]" class="f" style="width: 180px" placeholder="why" />
                  <button
                    class="btn sm"
                    :disabled="voiding[l.id]!.trim().length < 3"
                    @click="voidLine(l)"
                  >
                    Void
                  </button>
                  <button class="btn sm ghost" @click="delete voiding[l.id]">Keep</button>
                </template>
                <template v-else>
                  <a
                    class="hint"
                    style="cursor: pointer"
                    @click="editing[l.id] = { amount: l.amount, reason: '' }"
                    >correct</a
                  >
                  ·
                  <a class="hint" style="cursor: pointer" @click="voiding[l.id] = ''">void</a>
                </template>
              </template>
            </td>
          </tr>
          <tr v-if="!lines.length">
            <td colspan="9" class="hint">No cost line this month in your book.</td>
          </tr>
        </table>
      </div>
    </div>
    <div class="note">
      ⓘ A line's amount can be corrected with a reason; its date and currency cannot — void it and
      enter it again. Nothing is deleted. Payments, approvals and who actually paid come with slice
      6.
    </div>
  </div>
</template>
