<script setup lang="ts">
/**
 * Shipments → Container record. "How much did this box cost?" — the cost lines of one container, each in its
 * own currency and in USD at the rate of its own date, and the totals as sums. Found by number; a one-company
 * user sees their own book, the MD every book.
 */
import { STAGE_LABEL, checkContainerNumber } from '@oliu/shared';
const api = useApi();
const { can } = useSession();

interface Found {
  id: string;
  number: string;
  size: string;
  status: string;
  booking: { reference: string; client: string; companyName: string };
}
interface Line {
  id: string;
  companyName: string;
  category: string;
  date: string;
  currency: string;
  amount: string;
  perUsd: string;
  usd: string;
  usdCents: number;
  paidTo: string;
  reference: string;
  note: string;
  status: string;
  delayRelated: boolean;
  payment: { number: string; status: string } | null;
  split: { method: string } | null;
  enteredBy: string;
}
interface Totals {
  perCompany: { companyId: string; companyName: string; usd: string }[];
  usd: string;
  usdCents: number;
  delayUsd: string;
  delayUsdCents: number;
}
interface Record {
  container: {
    id: string;
    number: string;
    size: string;
    lot: string;
    weightKg: number | null;
    stage: string;
    status: string;
    responsibleCompanyName: string;
    lastPlace: string;
    closedAt: string | null;
    plMonth: string;
    booking: {
      id: string;
      fileNumber: string;
      reference: string;
      cargo: string;
      vessel: string;
      client: string;
      companyName: string;
    };
  };
  lines: Line[];
  totals: Totals;
  bookingTotals: Totals;
}

const q = ref(String(useRoute().query.number ?? '').trim());
const found = ref<Found[]>([]);
const record = ref<Record | null>(null);
const error = ref('');
const msg = ref('');
const weight = ref('');

async function search() {
  error.value = msg.value = '';
  record.value = null;
  const text = q.value.trim();
  if (!text) return;
  try {
    found.value = await api<Found[]>(`/api/containers?q=${encodeURIComponent(text)}`);
    const exact = checkContainerNumber(text);
    const one = exact.ok
      ? (found.value.find(
          (f) => f.number === exact.number && (f as { status?: string }).status === 'ACTIVE',
        ) ?? found.value.find((f) => f.number === exact.number))
      : undefined;
    if (one) await open(one.id);
    else if (found.value.length === 1) await open(found.value[0]!.id);
  } catch (e) {
    error.value = errorText(e);
  }
}
async function open(id: string) {
  error.value = msg.value = '';
  try {
    record.value = await api<Record>(`/api/containers/${id}/costs`);
    weight.value = record.value.container.weightKg?.toString() ?? '';
  } catch (e) {
    error.value = errorText(e);
  }
}
if (q.value) await search();
useLive().onChange(['costs', 'journey', 'shipments'], async () => {
  if (record.value)
    record.value = await api<Record>(`/api/containers/${record.value.container.id}/costs`);
});

async function saveWeight() {
  if (!record.value) return;
  error.value = msg.value = '';
  try {
    await api(`/api/containers/${record.value.container.id}`, {
      method: 'PATCH',
      body: { weightKg: weight.value === '' ? null : Number(weight.value) },
    });
    msg.value = 'Weight kept.';
    await open(record.value.container.id);
  } catch (e) {
    error.value = errorText(e);
  }
}
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="panel">
      <div class="panel-h">
        <h2>Container record — how much did this box cost?</h2>
        <form class="act" style="display: flex; gap: 8px" @submit.prevent="search">
          <input
            v-model="q"
            class="f mono"
            style="width: 240px"
            placeholder="container number or part of it"
          />
          <button class="btn sm">Open</button>
        </form>
      </div>
      <div v-if="found.length > 1 && !record" class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>Booking №</th>
            <th>Client</th>
            <th>Company</th>
            <th>Status</th>
          </tr>
          <tr v-for="f in found" :key="f.id" style="cursor: pointer" @click="open(f.id)">
            <td class="mono">
              <b>{{ pretty(f.number) }}</b>
            </td>
            <td class="mono">{{ f.booking.reference }}</td>
            <td>{{ f.booking.client }}</td>
            <td>{{ f.booking.companyName }}</td>
            <td>{{ f.status.toLowerCase() }}</td>
          </tr>
        </table>
      </div>
      <div v-else-if="!record" class="pad hint">
        Type a container number. Every box of the account is found; the cost lines shown are those
        of your company's book.
      </div>
    </div>

    <template v-if="record">
      <div class="panel">
        <div class="panel-h">
          <h2>
            {{ pretty(record.container.number) }} · {{ record.container.size }} ·
            {{ record.container.booking.cargo }} — file {{ record.container.booking.fileNumber }} ·
            booking {{ record.container.booking.reference }} ·
            {{ record.container.booking.client }} · made by
            {{ record.container.booking.companyName }}
          </h2>
          <div class="act">
            <NuxtLink :to="`/app/cont?q=${record.container.number}`" class="btn sm ghost"
              >In the Containers list</NuxtLink
            >
          </div>
        </div>
        <div class="pad" style="display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-end">
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">
              This box · USD at each cost's own date
            </div>
            <div class="mono" style="font-size: 26px">
              <b>$ {{ record.totals.usd }}</b>
            </div>
            <div v-if="record.totals.perCompany.length > 1" class="hint">
              <span
                v-for="p in record.totals.perCompany"
                :key="p.companyId"
                style="margin-right: 10px"
                >{{ p.companyName }} $ {{ p.usd }}</span
              >
            </div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">
              Whole booking · a sum, never stored
            </div>
            <div class="mono" style="font-size: 26px">
              <b>$ {{ record.bookingTotals.usd }}</b>
            </div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Delay-related</div>
            <div class="mono" style="font-size: 26px">
              <b>$ {{ record.totals.delayUsd }}</b>
            </div>
            <div class="hint">costs dated while the box was at risk</div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Stage · with</div>
            <div style="font-size: 18px">
              <NuxtLink
                :to="`/app/journey?container=${record.container.id}`"
                class="st"
                :class="record.container.closedAt ? 'st-grey' : 'st-ok'"
                style="text-decoration: none"
                >{{
                  record.container.closedAt
                    ? `closed · P&L ${record.container.plMonth}`
                    : STAGE_LABEL[record.container.stage as keyof typeof STAGE_LABEL].toLowerCase()
                }}</NuxtLink
              >
            </div>
            <div class="hint">
              {{ record.container.responsibleCompanyName
              }}<span v-if="record.container.lastPlace"> · {{ record.container.lastPlace }}</span>
            </div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Lot №</div>
            <div class="mono" style="font-size: 16px">{{ record.container.lot || '—' }}</div>
          </div>
          <form style="display: flex; gap: 6px; align-items: flex-end" @submit.prevent="saveWeight">
            <div>
              <div class="hint" style="font-size: 11px; text-transform: uppercase">Weight, kg</div>
              <input
                v-model="weight"
                class="f mono"
                type="number"
                min="0"
                max="100000"
                style="width: 120px"
                :disabled="!can('write')"
                placeholder="when known"
              />
            </div>
            <button v-if="can('write')" class="btn sm ghost">Keep</button>
          </form>
        </div>
      </div>

      <div class="panel">
        <div class="panel-h">
          <h2>Cost lines — {{ record.lines.length }}</h2>
          <div class="act">
            <NuxtLink
              v-if="can('write')"
              :to="`/app/csplit?booking=${record.container.booking.id}&container=${record.container.id}`"
              class="btn sm"
              >+ Add a cost</NuxtLink
            >
          </div>
        </div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Paid to</th>
              <th>Original</th>
              <th>Rate</th>
              <th>USD</th>
              <th>By</th>
              <th>Book</th>
            </tr>
            <tr v-for="l in record.lines" :key="l.id">
              <td class="mono">{{ l.date }}</td>
              <td>
                {{ l.category
                }}<span v-if="l.split" class="hint">
                  · split {{ l.split.method.toLowerCase() }}</span
                ><span v-if="l.reference" class="hint"> · {{ l.reference }}</span
                ><span v-if="l.delayRelated" class="st st-bad" style="margin-left: 6px">delay</span
                ><span
                  v-if="l.payment"
                  class="st"
                  :class="l.payment.status === 'PAID' ? 'st-ok' : 'st-info'"
                  style="margin-left: 6px"
                  >{{
                    l.payment.status === 'PAID'
                      ? 'paid'
                      : 'payment ' + l.payment.status.toLowerCase()
                  }}
                  · {{ l.payment.number }}</span
                >
                <div v-if="l.note" class="hint">{{ l.note }}</div>
              </td>
              <td>{{ l.paidTo || '—' }}</td>
              <td class="mono">{{ l.currency }} {{ l.amount }}</td>
              <td class="mono">{{ l.perUsd }}</td>
              <td class="mono">
                <b>{{ l.usd }}</b>
              </td>
              <td>{{ l.enteredBy }}</td>
              <td>{{ l.companyName }}</td>
            </tr>
            <tr v-if="!record.lines.length">
              <td colspan="8" class="hint">No cost on this box yet, in your book.</td>
            </tr>
            <tr v-if="record.lines.length">
              <td colspan="5"><b>Total — calculated, USD at each cost's own date</b></td>
              <td class="mono">
                <b>$ {{ record.totals.usd }}</b>
              </td>
              <td colspan="2"></td>
            </tr>
          </table>
        </div>
      </div>
    </template>

    <div class="note">
      ⓘ Every amount converts to USD at the rate of its own date, and that rate is kept on the line
      forever. A month's total is a report, not a stored number. Payments and approvals come with
      slice 6: a cost line records that money was spent, not that the company paid it.
    </div>
  </div>
</template>
