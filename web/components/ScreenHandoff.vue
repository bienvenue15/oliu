<script setup lang="ts">
/**
 * Shipments → Handoff to Finance. A box closes for Operations: invoice, payment and reporting take over. It
 * appears in one month's P&L — the month it closed — even if collected later. Payments do not exist yet
 * (slice 6), so "ready to invoice" is a tick by hand; the gate becomes automatic with slices 6 and 8.
 */
import { checkContainerNumber } from '@oliu/shared';
import type { BoardBox } from './JourneyBoard.vue';
const api = useApi();
const { me, can } = useSession();

interface ClosedBox extends BoardBox {
  closedOn: string | null;
  closedAt: string | null;
  plMonth: string;
  readyToInvoice: boolean;
  closed: boolean;
  costUsd: string;
  costUsdCents: number;
  delayUsd: string;
  closedBy: string;
  departedOn: string | null;
}
interface Closed {
  month: string;
  closed: ClosedBox[];
  candidates: ClosedBox[];
  totals: { boxes: number; costUsd: string };
}
interface Found {
  id: string;
  number: string;
  stage: string;
  closedAt: string | null;
  responsibleCompanyName: string;
  booking: { reference: string; client: string };
}

const months = (() => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++)
    out.push(
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  return out;
})();
const month = ref(months[0]!);
const data = ref<Closed | null>(null);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const q = ref('');
const found = ref<Found[]>([]);
const picked = ref<Found | null>(null);
const form = reactive({ closedOn: '', plMonth: '', readyToInvoice: false, note: '' });
const reopenReason = ref('');

async function reload() {
  error.value = '';
  try {
    data.value = await api<Closed>(`/api/closed?month=${month.value}`);
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
useLive().onChange(['journey', 'costs', 'shipments'], reload);
watch(month, reload);

async function search() {
  error.value = msg.value = '';
  picked.value = null;
  const text = q.value.trim();
  if (!text) return;
  try {
    found.value = await api<Found[]>(`/api/containers?q=${encodeURIComponent(text)}`);
    const exact = checkContainerNumber(text);
    const one = exact.ok ? found.value.find((f) => f.number === exact.number) : undefined;
    picked.value = one ?? (found.value.length === 1 ? found.value[0]! : null);
  } catch (e) {
    error.value = errorText(e);
  }
}
function pick(c: {
  id: string;
  number: string;
  stage: string;
  closed?: boolean;
  responsibleCompanyName: string;
  booking: { reference: string; client: string };
}) {
  picked.value = {
    id: c.id,
    number: c.number,
    stage: c.stage,
    closedAt: c.closed ? 'yes' : null,
    responsibleCompanyName: c.responsibleCompanyName,
    booking: c.booking,
  };
  found.value = [];
}

async function run(job: () => Promise<unknown>, done: string) {
  error.value = msg.value = '';
  busy.value = true;
  try {
    await job();
    msg.value = done;
    picked.value = null;
    Object.assign(form, { closedOn: '', plMonth: '', readyToInvoice: false, note: '' });
    reopenReason.value = '';
    await reload();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const close = () =>
  run(
    () =>
      api(`/api/containers/${picked.value!.id}/close`, {
        method: 'POST',
        body: {
          closedOn: form.closedOn,
          plMonth: form.plMonth || undefined,
          readyToInvoice: form.readyToInvoice,
          note: form.note,
        },
      }),
    `${picked.value!.number} closed to Finance.`,
  );
const reopen = (id: string, number: string) =>
  run(
    () =>
      api(`/api/containers/${id}/reopen`, { method: 'POST', body: { reason: reopenReason.value } }),
    `${number} is back with Operations.`,
  );

const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const day = (d: string | null) => (d ? d.slice(0, 10) : '—');
const isMd = computed(() => me.value?.user.role === 'MD');
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div v-if="data" class="cards">
      <div class="card">
        <div class="lbl">Closed — P&amp;L {{ data.month }}</div>
        <div class="val">{{ data.totals.boxes }}</div>
        <div class="subt">boxes in this month's P&amp;L</div>
      </div>
      <div class="card">
        <div class="lbl">Their cost, your book</div>
        <div class="val">$ {{ data.totals.costUsd }}</div>
        <div class="subt">sum of cost lines, USD at each cost's own date</div>
      </div>
      <div class="card">
        <div class="lbl">Ready to close</div>
        <div class="val">{{ data.candidates.length }}</div>
        <div class="subt">on the vessel, still open with Operations</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Close a container — Operations is done with it</h2>
        <form class="act" style="display: flex; gap: 6px" @submit.prevent="search">
          <input v-model="q" class="f mono" style="width: 220px" placeholder="container number" />
          <button class="btn sm ghost">Find</button>
        </form>
      </div>
      <div v-if="found.length > 1 && !picked" class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>Booking</th>
            <th>Client</th>
            <th>With</th>
          </tr>
          <tr
            v-for="f in found"
            :key="f.id"
            style="cursor: pointer"
            @click="pick({ ...f, closed: !!f.closedAt })"
          >
            <td class="mono">
              <b>{{ pretty(f.number) }}</b>
            </td>
            <td class="mono">{{ f.booking.reference }}</td>
            <td>{{ f.booking.client }}</td>
            <td>{{ f.responsibleCompanyName }}</td>
          </tr>
        </table>
      </div>
      <div v-if="data?.candidates.length && !picked" class="tablewrap">
        <table>
          <tr>
            <th>Ready — on the vessel</th>
            <th>Booking</th>
            <th>Client</th>
            <th>Departed</th>
            <th>Cost so far</th>
            <th>With</th>
            <th></th>
          </tr>
          <tr v-for="c in data.candidates" :key="c.id" style="cursor: pointer" @click="pick(c)">
            <td class="mono">
              <b>{{ pretty(c.number) }}</b>
            </td>
            <td class="mono">{{ c.booking.reference }}</td>
            <td>{{ c.booking.client }}</td>
            <td class="mono">{{ day(c.departedOn) }}</td>
            <td class="mono">
              $ {{ c.costUsd
              }}<span v-if="c.delayUsd !== '0.00'" class="hint"> · delay $ {{ c.delayUsd }}</span>
            </td>
            <td>{{ c.responsibleCompanyName }}</td>
            <td class="hint">close →</td>
          </tr>
        </table>
      </div>
      <form
        v-if="picked && !picked.closedAt && can('write')"
        class="pad"
        style="display: grid; gap: 8px; max-width: 560px"
        @submit.prevent="close"
      >
        <div>
          <b class="mono">{{ pretty(picked.number) }}</b> · booking {{ picked.booking.reference }} ·
          {{ picked.booking.client }} · with {{ picked.responsibleCompanyName }}
          <a class="hint" style="cursor: pointer; margin-left: 8px" @click="picked = null"
            >change</a
          >
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
          <label class="hint"
            >closed on <input v-model="form.closedOn" class="f" type="date"
          /></label>
          <label class="hint"
            >P&amp;L month <input v-model="form.plMonth" class="f" type="month"
          /></label>
          <span class="hint">empty = today, and its month</span>
        </div>
        <label class="hint" style="display: flex; gap: 6px; align-items: center">
          <input v-model="form.readyToInvoice" type="checkbox" /> all own costs are in — the client
          invoice can be built (by hand until slice 8)
        </label>
        <input v-model="form.note" class="f" maxlength="300" placeholder="note, if any" />
        <button class="btn" :disabled="busy">Close container &amp; open Accounting</button>
        <div class="hint">
          A cost typed after closing still lands on the box, and goes to the Managing Director's
          queue because the P&amp;L month was settled.
        </div>
      </form>
      <div v-else-if="picked && picked.closedAt" class="pad hint">
        {{ pretty(picked.number) }} is already closed. The Managing Director reopens from the list
        below.
      </div>
      <div v-else-if="!picked && !data?.candidates.length && found.length < 2" class="pad hint">
        No box on the vessel is waiting to be closed. Find any box by number to close it, even a
        local-only box at the warehouse.
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Closed this month — P&amp;L {{ data?.month }}</h2>
        <div class="act">
          <select v-model="month" class="f">
            <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Closed</th>
            <th>Container №</th>
            <th>Client · booking</th>
            <th>Cost</th>
            <th>Delay-related</th>
            <th>Shipped?</th>
            <th>Ready to invoice</th>
            <th>Closed by</th>
            <th v-if="isMd"></th>
          </tr>
          <tr v-for="c in data?.closed ?? []" :key="c.id">
            <td class="mono">{{ day(c.closedOn) }}</td>
            <td class="mono">
              <b>{{ pretty(c.number) }}</b
              ><span v-if="c.localOnly" class="hint"> · local only</span>
            </td>
            <td>
              {{ c.booking.client }} · <span class="mono">{{ c.booking.reference }}</span>
            </td>
            <td class="mono">
              <b>$ {{ c.costUsd }}</b>
            </td>
            <td class="mono">{{ c.delayUsd === '0.00' ? '—' : '$ ' + c.delayUsd }}</td>
            <td>
              <span class="st" :class="c.departedOn ? 'st-ok' : 'st-grey'">{{
                c.departedOn ? 'departed ' + day(c.departedOn) : c.stageLabel.toLowerCase()
              }}</span>
            </td>
            <td>
              <span class="st" :class="c.readyToInvoice ? 'st-ok' : 'st-warn'">{{
                c.readyToInvoice ? 'yes' : 'not yet'
              }}</span>
            </td>
            <td>{{ c.closedBy }}</td>
            <td v-if="isMd" style="white-space: nowrap">
              <input
                v-model="reopenReason"
                class="f"
                style="width: 150px"
                placeholder="reason to reopen"
              />
              <button
                class="btn sm red"
                style="margin-left: 4px"
                :disabled="busy || reopenReason.trim().length < 3"
                @click="reopen(c.id, c.number)"
              >
                Reopen
              </button>
            </td>
          </tr>
          <tr v-if="!data?.closed.length">
            <td :colspan="isMd ? 9 : 8" class="hint">
              Nothing closed in this month, on your side.
            </td>
          </tr>
        </table>
      </div>
    </div>
    <div class="note">
      ⓘ A container only ever appears in one month's P&amp;L — the month it closed — even if the
      client pays three months later. Revenue arrives with the invoice of slice 8; "earned" stays
      empty until then.
    </div>
  </div>
</template>
