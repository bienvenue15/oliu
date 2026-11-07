<script setup lang="ts">
/**
 * Settings → Configuration (the MD). Slice 3 brings three things: what money is spent on (cost categories),
 * the day's rate per currency (local units per US dollar), and the company's one margin figure.
 * Shipping lines and clients are added from the booking form (slice 2).
 */
import { CURRENCIES } from '@oliu/shared';
const api = useApi();
const { can } = useSession();

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  isTip: boolean;
}
interface Reason {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
}
interface Rate {
  id: string;
  currency: string;
  date: string;
  perUsd: string;
}
interface Settings {
  marginType: 'PERCENT' | 'FIXED_USD';
  marginValue: number;
  icdFreeDays: number;
  trackingHours: number;
  tipCeilingUsdCents: number;
  tipCapUsdCents: number;
  approvalThresholdUsdCents: number;
}

const categories = ref<Category[]>([]);
const latest = ref<Rate[]>([]);
const history = ref<Rate[]>([]);
const settings = ref<Settings>({
  marginType: 'PERCENT',
  marginValue: 0,
  icdFreeDays: 4,
  trackingHours: 12,
  tipCeilingUsdCents: 5000,
  tipCapUsdCents: 100000,
  approvalThresholdUsdCents: 50000,
});
const reasons = ref<Reason[]>([]);
/** The tip figures (slice 5), typed in dollars. */
const tips = reactive({ ceiling: '50', cap: '1000' });
/** The journey figures (slice 4): free days at the ICD before a box is at risk, hours between position updates. */
const journey = reactive({ icdFreeDays: '4', trackingHours: '12' });
/** Slice 6: above this many US dollars an approval needs the approver's one-time code. */
const payments = reactive({ threshold: '500' });
const error = ref('');
const msg = ref('');
const today = new Date().toISOString().slice(0, 10);
/** The margin form, filled from the settings on every load: basis points or cents → a figure the MD reads. */
const margin = reactive({ type: 'PERCENT' as Settings['marginType'], value: '0' });

async function reload() {
  [categories.value, latest.value, history.value, settings.value, reasons.value] =
    await Promise.all([
      api<Category[]>('/api/cost-categories'),
      api<Rate[]>('/api/rates/latest'),
      api<Rate[]>('/api/rates?limit=30'),
      api<Settings>('/api/settings'),
      api<Reason[]>('/api/tip-reasons'),
    ]);
  tips.ceiling = String(settings.value.tipCeilingUsdCents / 100);
  tips.cap = String(settings.value.tipCapUsdCents / 100);
  payments.threshold = String(settings.value.approvalThresholdUsdCents / 100);
  journey.icdFreeDays = String(settings.value.icdFreeDays);
  journey.trackingHours = String(settings.value.trackingHours);
  margin.type = settings.value.marginType;
  margin.value =
    settings.value.marginType === 'PERCENT'
      ? String(settings.value.marginValue / 100)
      : String(settings.value.marginValue / 100);
}
await reload();
useLive().onChange(['costs', 'tips', 'accounts'], reload);

async function run(job: () => Promise<unknown>, done: string) {
  error.value = msg.value = '';
  try {
    await job();
    msg.value = done;
    await reload();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ---- categories
const newCategory = ref('');
const addCategory = () =>
  run(
    () =>
      api('/api/cost-categories', {
        method: 'POST',
        body: { name: newCategory.value, sortOrder: categories.value.length },
      }),
    `Category "${newCategory.value}" added.`,
  ).then(() => (newCategory.value = ''));
const toggleCategory = (c: Category) =>
  run(
    () => api(`/api/cost-categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } }),
    `"${c.name}" is now ${c.active ? 'off' : 'on'}.`,
  );
const renaming = ref<Record<string, string>>({});
const rename = (c: Category) =>
  run(
    () =>
      api(`/api/cost-categories/${c.id}`, {
        method: 'PATCH',
        body: { name: renaming.value[c.id] },
      }),
    'Renamed.',
  ).then(() => delete renaming.value[c.id]);

// ---- rates
const rate = reactive({ currency: 'RWF', date: today, perUsd: '' });
const addRate = () =>
  run(
    () => api('/api/rates', { method: 'POST', body: { ...rate } }),
    `${rate.currency} ${rate.perUsd} per USD kept for ${rate.date}.`,
  ).then(() => (rate.perUsd = ''));
const rateCurrencies = CURRENCIES.filter((c) => c !== 'USD');

// ---- tips (slice 5): the reason buttons, the tip category, the two figures
const newReason = ref('');
const addReason = () =>
  run(
    () =>
      api('/api/tip-reasons', {
        method: 'POST',
        body: { label: newReason.value, sortOrder: reasons.value.length },
      }),
    `Reason "${newReason.value}" added.`,
  ).then(() => (newReason.value = ''));
const toggleReason = (r: Reason) =>
  run(
    () => api(`/api/tip-reasons/${r.id}`, { method: 'PATCH', body: { active: !r.active } }),
    `"${r.label}" is now ${r.active ? 'off' : 'on'}.`,
  );
const markTipCategory = (c: Category) =>
  run(async () => {
    for (const other of categories.value.filter((x) => x.isTip && x.id !== c.id))
      await api(`/api/cost-categories/${other.id}`, { method: 'PATCH', body: { isTip: false } });
    await api(`/api/cost-categories/${c.id}`, { method: 'PATCH', body: { isTip: true } });
  }, `Tips now land in "${c.name}".`);
const saveTips = () =>
  run(
    () =>
      api('/api/settings', {
        method: 'PATCH',
        body: {
          tipCeilingUsdCents: Math.round(Number(tips.ceiling) * 100),
          tipCapUsdCents: Math.round(Number(tips.cap) * 100),
        },
      }),
    'Tip figures saved.',
  );

// ---- payments
const savePayments = () =>
  run(
    () =>
      api('/api/settings', {
        method: 'PATCH',
        body: { approvalThresholdUsdCents: Math.round(Number(payments.threshold) * 100) },
      }),
    'Approval threshold saved.',
  );

// ---- the journey figures
const saveJourney = () =>
  run(
    () =>
      api('/api/settings', {
        method: 'PATCH',
        body: {
          icdFreeDays: Number(journey.icdFreeDays),
          trackingHours: Number(journey.trackingHours),
        },
      }),
    'Journey figures saved.',
  );

// ---- margin
const saveMargin = () =>
  run(
    () =>
      api('/api/settings', {
        method: 'PATCH',
        body: {
          marginType: margin.type,
          marginValue: Math.round(Number(margin.value) * 100),
        },
      }),
    'Margin saved.',
  );
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="panel">
      <div class="panel-h"><h2>Cost categories — what money is spent on</h2></div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Category</th>
            <th>In use</th>
            <th></th>
          </tr>
          <tr v-for="c in categories" :key="c.id">
            <td>
              <template v-if="renaming[c.id] !== undefined">
                <input v-model="renaming[c.id]" class="f" style="width: 260px" />
                <button class="btn sm" style="margin-left: 6px" @click="rename(c)">Save</button>
                <button class="btn sm ghost" @click="delete renaming[c.id]">Cancel</button>
              </template>
              <template v-else>
                <b :class="{ hint: !c.active }">{{ c.name }}</b>
                <span v-if="c.isTip" class="st st-cop" style="margin-left: 6px"
                  >tips land here</span
                >
                <a
                  v-else-if="can('users') && c.active"
                  class="hint"
                  style="cursor: pointer; margin-left: 8px"
                  @click="markTipCategory(c)"
                  >use for tips</a
                >
                <a
                  v-if="can('users')"
                  class="hint"
                  style="cursor: pointer; margin-left: 8px"
                  @click="renaming[c.id] = c.name"
                  >rename</a
                >
              </template>
            </td>
            <td>
              <span class="st" :class="c.active ? 'st-ok' : 'st-grey'">{{
                c.active ? 'on' : 'off'
              }}</span>
            </td>
            <td>
              <button v-if="can('users')" class="btn sm ghost" @click="toggleCategory(c)">
                {{ c.active ? 'Switch off' : 'Switch on' }}
              </button>
            </td>
          </tr>
        </table>
      </div>
      <form
        v-if="can('users')"
        class="pad"
        style="display: flex; gap: 8px"
        @submit.prevent="addCategory"
      >
        <input
          v-model="newCategory"
          class="f"
          style="width: 300px"
          maxlength="60"
          placeholder="new category, e.g. Weighbridge"
        />
        <button class="btn sm" :disabled="newCategory.trim().length < 2">Add category</button>
      </form>
      <div class="pad hint">
        A category that is switched off stays on the lines that already use it and leaves the list
        for new ones. Nothing is deleted.
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Currencies and the day's rate — local units per one US dollar</h2>
      </div>
      <div class="pad" style="display: flex; gap: 18px; flex-wrap: wrap">
        <div v-for="r in latest" :key="r.id" style="min-width: 160px">
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            {{ r.currency }}
          </div>
          <div class="mono" style="font-size: 22px">
            <b>{{ r.perUsd }}</b>
          </div>
          <div class="hint">per USD · {{ r.date }}</div>
        </div>
        <div v-if="!latest.length" class="hint">
          No rate yet. Costs in RWF or TZS cannot be entered until a rate exists.
        </div>
      </div>
      <form
        v-if="can('pay')"
        class="pad"
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
        @submit.prevent="addRate"
      >
        <select v-model="rate.currency" class="f" style="width: 100px">
          <option v-for="c in rateCurrencies" :key="c" :value="c">{{ c }}</option>
        </select>
        <input v-model="rate.date" class="f mono" type="date" style="width: 170px" />
        <input
          v-model="rate.perUsd"
          class="f mono"
          style="width: 140px"
          inputmode="decimal"
          placeholder="e.g. 1452"
        />
        <button class="btn sm" :disabled="!/^\d+(\.\d{1,3})?$/.test(rate.perUsd)">
          Keep this rate
        </button>
        <span class="hint"
          >A cost takes the rate of its own date, or the most recent one before it. Typing a day's
          rate again replaces it, on the record.</span
        >
      </form>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Date</th>
            <th>Currency</th>
            <th>Per USD</th>
          </tr>
          <tr v-for="r in history" :key="r.id">
            <td class="mono">{{ r.date }}</td>
            <td>{{ r.currency }}</td>
            <td class="mono">{{ r.perUsd }}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>The margin — one figure, from booking up to ocean freight</h2></div>
      <form
        class="pad"
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
        @submit.prevent="saveMargin"
      >
        <select v-model="margin.type" class="f" style="width: 260px" :disabled="!can('users')">
          <option value="PERCENT">A percentage on top of the costs</option>
          <option value="FIXED_USD">A fixed US dollar amount per box</option>
        </select>
        <input
          v-model="margin.value"
          class="f mono"
          style="width: 140px"
          inputmode="decimal"
          :disabled="!can('users')"
        />
        <span class="hint">{{ margin.type === 'PERCENT' ? '%' : 'USD per box' }}</span>
        <button
          v-if="can('users')"
          class="btn sm"
          :disabled="!/^\d+(\.\d{1,2})?$/.test(margin.value)"
        >
          Save margin
        </button>
      </form>
      <div class="pad hint">
        Used by the automatic invoice of slice 8: the boxes' costs plus this margin. Set once by the
        Managing Director; every change is in the audit trail.
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>The journey — free days at the ICD, hours between position updates</h2>
      </div>
      <form
        class="pad"
        style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap"
        @submit.prevent="saveJourney"
      >
        <div>
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            Free days at the ICD
          </div>
          <input
            v-model="journey.icdFreeDays"
            class="f mono"
            type="number"
            min="0"
            max="365"
            style="width: 110px"
            :disabled="!can('users')"
          />
        </div>
        <div>
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            Position update every (hours)
          </div>
          <input
            v-model="journey.trackingHours"
            class="f mono"
            type="number"
            min="1"
            max="168"
            style="width: 110px"
            :disabled="!can('users')"
          />
        </div>
        <button
          v-if="can('users')"
          class="btn sm"
          :disabled="journey.icdFreeDays === '' || journey.trackingHours === ''"
        >
          Save
        </button>
      </form>
      <div class="pad hint" style="border-top: 1px solid #eef2f7">
        A box at the ICD past its free days is flagged at risk by itself, and every cost dated from
        then on is delay-related. A box on the road not heard of for this many hours shows "position
        overdue" on the board.
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Tips — the reason buttons, the ceiling per tip, the monthly cap</h2>
      </div>
      <div class="pad" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <span
          v-for="r in reasons"
          :key="r.id"
          class="st"
          :class="r.active ? 'st-ok' : 'st-grey'"
          style="font-size: 12.5px; padding: 6px 12px"
        >
          {{ r.label }}
          <a
            v-if="can('users')"
            style="cursor: pointer; margin-left: 6px; opacity: 0.7"
            @click="toggleReason(r)"
            >{{ r.active ? 'off' : 'on' }}</a
          >
        </span>
        <form v-if="can('users')" style="display: flex; gap: 6px" @submit.prevent="addReason">
          <input
            v-model="newReason"
            class="f"
            maxlength="40"
            style="width: 200px"
            placeholder="new reason, e.g. Parking"
          />
          <button class="btn sm" :disabled="newReason.trim().length < 2">Add reason</button>
        </form>
      </div>
      <form
        class="pad"
        style="
          display: flex;
          gap: 10px;
          align-items: flex-end;
          flex-wrap: wrap;
          border-top: 1px solid #eef2f7;
        "
        @submit.prevent="saveTips"
      >
        <div>
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            Ceiling per tip, USD
          </div>
          <input
            v-model="tips.ceiling"
            class="f mono"
            type="number"
            min="0"
            step="1"
            style="width: 120px"
            :disabled="!can('users')"
          />
        </div>
        <div>
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            Monthly cap per company, USD
          </div>
          <input
            v-model="tips.cap"
            class="f mono"
            type="number"
            min="0"
            step="1"
            style="width: 140px"
            :disabled="!can('users')"
          />
        </div>
        <button
          v-if="can('users')"
          class="btn sm"
          :disabled="tips.ceiling === '' || tips.cap === ''"
        >
          Save
        </button>
        <div class="hint" style="width: 100%">
          A tip above the ceiling, or a month going past the cap, needs your six-digit code, mailed
          to you on request. At 80 % of the cap an item lands in your rulings. Zero switches a
          figure off.
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Payments — the approval threshold</h2></div>
      <form
        class="pad"
        style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap"
        @submit.prevent="savePayments"
      >
        <div>
          <div class="hint" style="font-size: 11px; text-transform: uppercase">
            One click up to, USD
          </div>
          <input
            v-model="payments.threshold"
            class="f mono"
            type="number"
            min="0"
            step="1"
            style="width: 140px"
            :disabled="!can('users')"
          />
        </div>
        <button v-if="can('users')" class="btn sm" :disabled="payments.threshold === ''">
          Save
        </button>
        <div class="hint" style="width: 100%">
          Below this figure the Operations Manager or you approve a payment with one click. Above
          it, the approver asks for a six-digit code, mailed to their own mailbox, and types it. A
          beneficiary's account change always needs the code. Zero means every approval needs one.
        </div>
      </form>
    </div>

    <div class="note">
      ⓘ Shipping lines and clients are added from Shipments → New booking. The invoice prefix
      arrives with slice 8.
    </div>
  </div>
</template>
