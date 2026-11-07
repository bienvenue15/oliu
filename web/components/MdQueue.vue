<script setup lang="ts">
/**
 * The MD's rulings, one block per item: a duplicate container (slice 2), a cost after closing (slice 4), money
 * typed from the other side and the tip cap (slice 5), a repeated payment (slice 6). Used by Containers (the
 * short list at the top) and by Checks → MD queue (the whole queue, with what was ruled before).
 */
const api = useApi();

export interface Side {
  id: string;
  number: string;
  size: string;
  lot: string;
  status: string;
  createdBy: string;
  createdAt: string;
  booking: {
    id: string;
    reference: string;
    cargo: string;
    vessel: string;
    companyName: string;
    client: string;
  };
}
export interface QueueItem {
  id: string;
  kind: string;
  summary: {
    number?: string;
    numbers?: string[];
    category?: string;
    amount?: string;
    currency?: string;
    paidTo?: string;
    tip?: boolean;
    pct?: number;
    existingNumber?: string;
    beneficiary?: string;
    box?: string;
    purpose?: string;
  };
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  newBox: Side | null;
  existingBox: Side | null;
}

const props = defineProps<{ items: QueueItem[]; title?: string }>();
const emit = defineEmits<{ changed: [] }>();
const msg = ref('');
const error = ref('');
const corrected = ref<Record<string, string>>({});
const reason = ref<Record<string, string>>({});

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const open = computed(() => props.items.filter((i) => i.status === 'OPEN'));

const DONE: Record<string, string> = {
  KEEP_NEW: 'The new entry is kept; the older one is withdrawn.',
  WITHDRAW_NEW: 'The new entry is withdrawn.',
  CORRECT_NUMBER: 'Number corrected; the entry is now its own box.',
  NOTED: 'Noted.',
  APPROVE: 'Approved: the lines count now.',
  REFUSE: 'Refused, with your reason.',
  ALLOW: 'Allowed as genuine: the order goes on to approval.',
};
async function resolve(item: QueueItem, resolution: string) {
  error.value = msg.value = '';
  try {
    await api(`/api/md-queue/${item.id}/resolve`, {
      method: 'POST',
      body: {
        resolution,
        number: resolution === 'CORRECT_NUMBER' ? corrected.value[item.id] : undefined,
        reason: reason.value[item.id] || undefined,
      },
    });
    msg.value = DONE[resolution] ?? 'Done.';
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
  }
}
const hasReason = (item: QueueItem) => (reason.value[item.id] ?? '').trim().length >= 3;
</script>

<template>
  <div class="panel">
    <div class="panel-h">
      <h2>
        {{
          title ?? 'Waiting for you — duplicates, repeats, late costs, money from the other side'
        }}
      </h2>
      <span class="hint" style="margin-left: auto">{{ open.length }} open</span>
    </div>
    <div v-if="error" class="pad err" style="margin: 0">{{ error }}</div>
    <div v-if="msg" class="pad okmsg" style="margin: 0">{{ msg }}</div>
    <div v-if="!items.length" class="pad hint">Nothing waiting.</div>
    <div v-for="item in items" :key="item.id" class="pad" style="border-bottom: 1px solid #eef2f7">
      <!-- a repeated payment: one beneficiary + one box + one category = paid once -->
      <div
        v-if="item.kind === 'REPEAT_PAYMENT'"
        style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap"
      >
        <span class="st st-bad">repeat payment</span>
        <span>
          <b class="mono">{{ item.summary.number }}</b> · {{ item.summary.purpose }} ·
          <span class="mono">{{ item.summary.currency }} {{ item.summary.amount }}</span> to
          {{ item.summary.beneficiary }}
        </span>
        <span class="hint"
          >the same {{ item.summary.box ? `box ${pretty(item.summary.box)}` : 'bill' }}, fee and
          payee are already on <b class="mono">{{ item.summary.existingNumber }}</b> · typed
          {{ fmt(item.createdAt) }} · blocked before the bank</span
        >
        <template v-if="item.status === 'OPEN'">
          <input
            v-model="reason[item.id]"
            class="f"
            style="width: 220px"
            placeholder="why — e.g. paid on 21 Aug, or a second lot"
          />
          <button class="btn sm red" :disabled="!hasReason(item)" @click="resolve(item, 'REFUSE')">
            Refuse
          </button>
          <button class="btn sm ghost" @click="resolve(item, 'ALLOW')">Allow — genuine</button>
        </template>
      </div>
      <!-- money typed from the other side -->
      <div
        v-else-if="item.kind === 'COST_OTHER_SIDE'"
        style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap"
      >
        <span class="st st-warn"
          >{{ item.summary.tip ? 'tip' : 'cost' }} on the other side's box</span
        >
        <span>
          <b class="mono">{{ (item.summary.numbers ?? []).map(pretty).join(', ') }}</b> ·
          {{ item.summary.category }} · <span class="mono">{{ item.summary.amount }}</span>
          <span v-if="item.summary.paidTo" class="hint"> · paid to {{ item.summary.paidTo }}</span>
        </span>
        <span class="hint"
          >typed {{ fmt(item.createdAt) }} by a company whose side the box is not on; it counts
          nowhere until you rule</span
        >
        <template v-if="item.status === 'OPEN'">
          <button class="btn sm" @click="resolve(item, 'APPROVE')">Approve</button>
          <input
            v-model="reason[item.id]"
            class="f"
            style="width: 200px"
            placeholder="reason to refuse"
          />
          <button class="btn sm red" :disabled="!hasReason(item)" @click="resolve(item, 'REFUSE')">
            Refuse
          </button>
        </template>
      </div>
      <!-- the tip cap at 80 % -->
      <div
        v-else-if="item.kind === 'TIP_CAP_80'"
        style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap"
      >
        <span class="st st-warn">tip cap at {{ item.summary.pct ?? 80 }} %</span>
        <span class="hint"
          >the month's tips crossed 80 % of the cap · {{ fmt(item.createdAt) }}</span
        >
        <button v-if="item.status === 'OPEN'" class="btn sm ghost" @click="resolve(item, 'NOTED')">
          Noted
        </button>
      </div>
      <!-- a cost on a box already closed to Finance -->
      <div
        v-else-if="item.kind !== 'DUPLICATE_CONTAINER'"
        style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap"
      >
        <span class="st st-warn">cost after closing</span>
        <span
          ><b class="mono">{{ item.summary.number ? pretty(item.summary.number) : '' }}</b> ·
          {{ item.summary.category }} · <span class="mono">{{ item.summary.amount }}</span></span
        >
        <span class="hint"
          >typed {{ fmt(item.createdAt) }} on a box already closed to Finance; its P&amp;L month was
          settled</span
        >
        <button v-if="item.status === 'OPEN'" class="btn sm ghost" @click="resolve(item, 'NOTED')">
          Noted
        </button>
      </div>
      <!-- a duplicate container: both entries side by side -->
      <template v-else>
        <div class="tablewrap">
          <table>
            <tr>
              <th></th>
              <th>Booking</th>
              <th>Client · cargo</th>
              <th>Vessel</th>
              <th>Size · lot</th>
              <th>Typed by</th>
              <th>Company</th>
            </tr>
            <tr
              v-for="[label, s] in [
                ['Existing', item.existingBox],
                ['New', item.newBox],
              ] as const"
              :key="label"
            >
              <td>
                <b>{{ label }}</b
                ><br /><span class="mono">{{ s ? pretty(s.number) : '—' }}</span>
              </td>
              <td class="mono">{{ s?.booking.reference }}</td>
              <td>{{ s?.booking.client }} · {{ s?.booking.cargo }}</td>
              <td>{{ s?.booking.vessel || '—' }}</td>
              <td>{{ s?.size }} · {{ s?.lot || '—' }}</td>
              <td>{{ s?.createdBy }} · {{ s ? fmt(s.createdAt) : '' }}</td>
              <td>{{ s?.booking.companyName }}</td>
            </tr>
          </table>
        </div>
        <div
          v-if="item.status === 'OPEN'"
          style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px"
        >
          <button class="btn sm red" @click="resolve(item, 'WITHDRAW_NEW')">
            Withdraw the new entry
          </button>
          <button class="btn sm" @click="resolve(item, 'KEEP_NEW')">
            Keep the new, withdraw the existing
          </button>
          <span class="hint">or it was a typo:</span>
          <input
            v-model="corrected[item.id]"
            class="f mono"
            style="width: 180px"
            placeholder="corrected number"
          />
          <button
            class="btn sm ghost"
            :disabled="!corrected[item.id]"
            @click="resolve(item, 'CORRECT_NUMBER')"
          >
            Correct the number
          </button>
        </div>
      </template>
      <div v-if="item.status !== 'OPEN'" class="hint" style="margin-top: 6px">
        Ruled {{ item.resolution?.toLowerCase().replace('_', ' ') }} by {{ item.resolvedBy }} ·
        {{ item.resolvedAt ? fmt(item.resolvedAt) : '' }}
      </div>
    </div>
  </div>
</template>
