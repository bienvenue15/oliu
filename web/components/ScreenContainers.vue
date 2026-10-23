<script setup lang="ts">
/**
 * Shipments → Containers. One record per box. This company's bookings and boxes by month; any box of the
 * account found by number, read-only; and, for the MD, the duplicates waiting for a ruling, side by side.
 */
import { CONTAINER_SIZES, checkContainerNumber } from '@oliu/shared';
const api = useApi();
const { can } = useSession();

interface Box {
  id: string;
  number: string;
  size: string;
  lot: string;
  stage: string;
  status: string;
  createdAt: string;
  duplicateOf: { bookingReference: string } | null;
  booking: {
    id: string;
    reference: string;
    cargo: string;
    vessel: string;
    companyName: string;
    client: string;
    line: string;
  };
}
interface Bk {
  id: string;
  reference: string;
  cargo: string;
  destination: string;
  vessel: string;
  voyage: string;
  companyName: string;
  createdAt: string;
  shippingLine: { name: string };
  client: { name: string };
  containerCount: number;
  duplicateCount: number;
}
interface Side {
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
interface QueueItem {
  id: string;
  status: string;
  createdAt: string;
  newBox: Side | null;
  existingBox: Side | null;
}
interface Detail extends Bk {
  mayEdit: boolean;
  client: { name: string; legalName: string };
  containers: Box[];
}

const months = (() => {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({
      value: m.toISOString().slice(0, 7),
      label: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  return out;
})();
const month = ref(months[0]!.value);
/** A link can carry the search: /app/cont?q=PCIU9084297 opens straight on that box. */
const initialQ = String(useRoute().query.q ?? '').trim();
const q = ref(initialQ);
const searched = ref(initialQ);
const boxes = ref<Box[]>([]);
const bookings = ref<Bk[]>([]);
const queue = ref<QueueItem[]>([]);
const detail = ref<Detail | null>(null);
const error = ref('');
const msg = ref('');

async function reload() {
  error.value = '';
  const params = searched.value
    ? `q=${encodeURIComponent(searched.value)}`
    : month.value
      ? `month=${month.value}`
      : '';
  const jobs: Promise<unknown>[] = [
    api<Box[]>(`/api/containers?${params}`).then((r) => (boxes.value = r)),
  ];
  if (!searched.value)
    jobs.push(
      api<Bk[]>(`/api/bookings?${month.value ? `month=${month.value}` : ''}`).then(
        (r) => (bookings.value = r),
      ),
    );
  if (can('reconcile')) jobs.push(api<QueueItem[]>('/api/md-queue').then((r) => (queue.value = r)));
  await Promise.all(jobs);
}
await reload();
watch(month, () => {
  searched.value = '';
  q.value = '';
  reload();
});
function search() {
  searched.value = q.value.trim();
  reload();
}
function clearSearch() {
  q.value = '';
  searched.value = '';
  reload();
}

async function openBooking(id: string) {
  error.value = msg.value = '';
  try {
    detail.value = await api<Detail>(`/api/bookings/${id}`);
    Object.assign(patch, {
      cargo: detail.value.cargo,
      destination: detail.value.destination,
      vessel: detail.value.vessel,
      voyage: detail.value.voyage,
    });
    added.value = { number: '', size: '40FT', lot: '' };
  } catch (e) {
    error.value = errorText(e);
  }
}
const patch = reactive({ cargo: '', destination: '', vessel: '', voyage: '' });
async function savePatch() {
  if (!detail.value) return;
  error.value = msg.value = '';
  try {
    await api(`/api/bookings/${detail.value.id}`, { method: 'PATCH', body: patch });
    msg.value = `Booking ${detail.value.reference} updated.`;
    await Promise.all([openBooking(detail.value.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  }
}
const added = ref({ number: '', size: '40FT', lot: '' });
const addedCheck = computed(() =>
  added.value.number.trim() ? checkContainerNumber(added.value.number) : null,
);
async function addBox() {
  if (!detail.value) return;
  error.value = msg.value = '';
  try {
    const r = await api<{
      duplicates: { number: string; existingBooking: string }[];
      notes: string[];
    }>(`/api/bookings/${detail.value.id}/containers`, {
      method: 'POST',
      body: { containers: [added.value] },
    });
    msg.value = r.duplicates.length
      ? `${r.duplicates[0]!.number} already exists on booking ${r.duplicates[0]!.existingBooking} — both entries are with the Managing Director.`
      : `Box added to ${detail.value.reference}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}`;
    await Promise.all([openBooking(detail.value.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  }
}

const corrected = ref<Record<string, string>>({});
async function resolve(
  item: QueueItem,
  resolution: 'KEEP_NEW' | 'WITHDRAW_NEW' | 'CORRECT_NUMBER',
) {
  error.value = msg.value = '';
  try {
    await api(`/api/md-queue/${item.id}/resolve`, {
      method: 'POST',
      body: {
        resolution,
        number: resolution === 'CORRECT_NUMBER' ? corrected.value[item.id] : undefined,
      },
    });
    msg.value =
      resolution === 'KEEP_NEW'
        ? 'The new entry is kept; the older one is withdrawn.'
        : resolution === 'WITHDRAW_NEW'
          ? 'The new entry is withdrawn.'
          : 'Number corrected; the entry is now its own box.';
    await reload();
    if (detail.value) await openBooking(detail.value.id);
  } catch (e) {
    error.value = errorText(e);
  }
}

const statusChip = (b: { status: string }) =>
  b.status === 'ACTIVE' ? 'st-ok' : b.status === 'DUPLICATE' ? 'st-bad' : 'st-grey';
const statusText = (b: { status: string; stage?: string }) =>
  b.status === 'ACTIVE'
    ? (b.stage ?? 'booked').toLowerCase()
    : b.status === 'DUPLICATE'
      ? 'duplicate — waiting for the MD'
      : 'withdrawn';
const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
/** PCIU 908429 7, with spaces that never let the number wrap. */
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
</script>

<template>
  <div>
    <div class="cards">
      <div class="card">
        <div class="lbl">Bookings · {{ months.find((m) => m.value === month)?.label }}</div>
        <div class="val">{{ bookings.length }}</div>
        <div class="subt">{{ bookings.reduce((n, b) => n + b.containerCount, 0) }} boxes</div>
      </div>
      <div class="card">
        <div class="lbl">Boxes listed</div>
        <div class="val">{{ boxes.length }}</div>
        <div class="subt">
          {{ boxes.filter((b) => b.status === 'DUPLICATE').length }} waiting for the MD
        </div>
      </div>
      <div v-if="can('reconcile')" class="card">
        <div class="lbl">Your rulings</div>
        <div class="val">{{ queue.length }}</div>
        <div class="subt">duplicate container entries</div>
      </div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div v-if="can('reconcile') && queue.length" class="panel">
      <div class="panel-h"><h2>Waiting for you — the same number typed twice</h2></div>
      <div
        v-for="item in queue"
        :key="item.id"
        class="pad"
        style="border-bottom: 1px solid #eef2f7"
      >
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
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px">
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
            :disabled="!corrected[item.id] || !checkContainerNumber(corrected[item.id]!).ok"
            @click="resolve(item, 'CORRECT_NUMBER')"
          >
            Correct the number
          </button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Find a box anywhere in the account</h2>
        <div class="act" style="display: flex; gap: 6px">
          <form style="display: flex; gap: 6px" @submit.prevent="search">
            <input
              v-model="q"
              class="f mono"
              placeholder="container number or part of it"
              style="width: 240px"
            /><button class="btn sm">Search</button>
          </form>
          <button v-if="searched" class="btn sm ghost" @click="clearSearch">Clear</button>
          <select v-else v-model="month" class="sel">
            <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
            <option value="">All months</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="!searched" class="panel">
      <div class="panel-h"><h2>Bookings — click one to open it</h2></div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Booking №</th>
            <th>Line</th>
            <th>Client</th>
            <th>Cargo</th>
            <th>Vessel</th>
            <th>Boxes</th>
            <th>Company</th>
            <th>Opened</th>
          </tr>
          <tr v-for="b in bookings" :key="b.id" style="cursor: pointer" @click="openBooking(b.id)">
            <td class="mono">
              <b>{{ b.reference }}</b>
            </td>
            <td>{{ b.shippingLine.name }}</td>
            <td>{{ b.client.name }}</td>
            <td>{{ b.cargo }}</td>
            <td>{{ b.vessel || '—' }}</td>
            <td>
              {{ b.containerCount
              }}<span v-if="b.duplicateCount" class="st st-bad" style="margin-left: 6px"
                >{{ b.duplicateCount }} with the MD</span
              >
            </td>
            <td>{{ b.companyName }}</td>
            <td class="mono">{{ fmt(b.createdAt) }}</td>
          </tr>
          <tr v-if="!bookings.length">
            <td colspan="8" class="hint">
              No bookings this month on your side. Shipments → New booking starts one.
            </td>
          </tr>
        </table>
      </div>
    </div>

    <div v-if="detail" class="panel">
      <div class="panel-h">
        <h2>
          Booking {{ detail.reference }} — {{ detail.shippingLine.name }} ·
          {{ detail.client.name }} · made by {{ detail.companyName }}
        </h2>
        <div class="act"><button class="btn sm ghost" @click="detail = null">Close</button></div>
      </div>
      <form v-if="detail.mayEdit" class="form-grid" @submit.prevent="savePatch">
        <div>
          <label class="f">Cargo</label
          ><input v-model="patch.cargo" class="f" style="text-transform: uppercase" />
        </div>
        <div>
          <label class="f">Destination</label><input v-model="patch.destination" class="f" />
        </div>
        <div>
          <label class="f">Vessel</label
          ><input v-model="patch.vessel" class="f" style="text-transform: uppercase" />
        </div>
        <div>
          <label class="f">Voyage</label
          ><input v-model="patch.voyage" class="f" style="text-transform: uppercase" />
        </div>
        <div class="full"><button class="btn sm">Save these details</button></div>
      </form>
      <div v-else class="pad hint">
        Read-only: this booking belongs to {{ detail.companyName }}. Cargo {{ detail.cargo }} ·
        destination {{ detail.destination || '—' }} · vessel {{ detail.vessel || '—' }} · voyage
        {{ detail.voyage || '—' }}.
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>Size</th>
            <th>Lot №</th>
            <th>Status</th>
          </tr>
          <tr v-for="c in detail.containers" :key="c.id">
            <td class="mono">{{ pretty(c.number) }}</td>
            <td>{{ c.size }}</td>
            <td class="mono">{{ c.lot || '—' }}</td>
            <td>
              <span class="st" :class="statusChip(c)">{{ statusText(c) }}</span
              ><span v-if="c.duplicateOf" class="hint">
                · also on {{ c.duplicateOf.bookingReference }}</span
              >
            </td>
          </tr>
        </table>
      </div>
      <form
        v-if="detail.mayEdit"
        class="pad"
        style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
        @submit.prevent="addBox"
      >
        <input
          v-model="added.number"
          class="f mono"
          style="width: 180px"
          placeholder="add a container №"
        />
        <select v-model="added.size" class="f" style="width: 100px">
          <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
        <input v-model="added.lot" class="f mono" style="width: 200px" placeholder="lot №" />
        <button class="btn sm" :disabled="!addedCheck?.ok">Add box</button>
        <span v-if="addedCheck && !addedCheck.ok" class="st st-bad">✗ {{ addedCheck.reason }}</span>
      </form>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>
          {{
            searched
              ? `Boxes matching “${searched}” — anywhere in the account, read-only`
              : 'Containers — one record per box, no duplicates'
          }}
        </h2>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>Booking №</th>
            <th>Client · cargo</th>
            <th>Vessel / line</th>
            <th>Size · lot</th>
            <th>Status</th>
            <th>Company</th>
          </tr>
          <tr v-for="c in boxes" :key="c.id">
            <td class="mono">
              <b>{{ pretty(c.number) }}</b>
            </td>
            <td class="mono">
              <a style="cursor: pointer" @click="openBooking(c.booking.id)">{{
                c.booking.reference
              }}</a>
            </td>
            <td>{{ c.booking.client }} · {{ c.booking.cargo }}</td>
            <td>{{ c.booking.vessel || '—' }} / {{ c.booking.line }}</td>
            <td>
              {{ c.size }} · <span class="mono">{{ c.lot || '—' }}</span>
            </td>
            <td>
              <span class="st" :class="statusChip(c)">{{ statusText(c) }}</span
              ><span v-if="c.duplicateOf" class="hint">
                · also on {{ c.duplicateOf.bookingReference }}</span
              >
            </td>
            <td>{{ c.booking.companyName }}</td>
          </tr>
          <tr v-if="!boxes.length">
            <td colspan="7" class="hint">
              {{
                searched
                  ? 'No box with that number in the account.'
                  : 'No boxes this month on your side.'
              }}
            </td>
          </tr>
        </table>
      </div>
    </div>
    <div class="note">
      ⓘ A container number is checked (ISO 6346) before it is saved, and the account never holds two
      live records of one number: the second entry waits here, beside the first, for the Managing
      Director. Costs and stages come with the next slices.
    </div>
  </div>
</template>
