<script setup lang="ts">
/**
 * Shipments → Containers. One record per box. This company's bookings and boxes by month; any box of the
 * account found by number, read-only; and, for the MD, the duplicates waiting for a ruling, side by side.
 */
import { CONTAINER_SIZES, STAGE_LABEL, checkContainerNumber } from '@oliu/shared';
import type { QueueItem } from './MdQueue.vue';
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
  responsibleCompanyName: string;
  lastPlace: string;
  closedAt: string | null;
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
  fileNumber: string;
  reference: string;
  cargo: string;
  destination: string;
  vessel: string;
  voyage: string;
  pol: string;
  pod: string;
  etd: string | null;
  eta: string | null;
  blNumber: string;
  expectedCount: number;
  expectedSize: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  companyName: string;
  createdAt: string;
  shippingLine: { name: string };
  client: { name: string };
  containerCount: number;
  duplicateCount: number;
}
interface Comment {
  id: string;
  userName: string;
  text: string;
  createdAt: string;
}
interface Detail extends Bk {
  /** Boxes of this booking on the other side: how many, at which stage. */
  elsewhere: { stage: string; label: string; count: number }[];
  mayEdit: boolean;
  createdBy: string;
  client: { name: string; legalName: string };
  containers: Box[];
  comments: Comment[];
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
/** Live: the lists refetch; an open booking refreshes its boxes and comments without touching what is being typed. */
useLive().onChange(['shipments', 'journey'], async () => {
  await reload();
  if (detail.value) {
    const d = await api<Detail>(`/api/bookings/${detail.value.id}`);
    Object.assign(detail.value, {
      containers: d.containers,
      comments: d.comments,
      status: d.status,
      confirmedAt: d.confirmedAt,
      cancelledAt: d.cancelledAt,
      cancelReason: d.cancelReason,
      mayEdit: d.mayEdit,
    });
  }
});
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
    const d = detail.value;
    Object.assign(patch, {
      cargo: d.cargo,
      destination: d.destination,
      vessel: d.vessel,
      voyage: d.voyage,
      pol: d.pol,
      pod: d.pod,
      etd: day(d.etd),
      eta: day(d.eta),
      blNumber: d.blNumber,
      expectedCount: d.expectedCount,
      expectedSize: d.expectedSize,
    });
    added.value = { number: '', size: d.expectedSize || '40FT', lot: '' };
    cancelReason.value = '';
    comment.value = '';
  } catch (e) {
    error.value = errorText(e);
  }
}
/** A date from the API (ISO) as the date field wants it (YYYY-MM-DD). */
const day = (d: string | null) => (d ? d.slice(0, 10) : '');
const patch = reactive({
  cargo: '',
  destination: '',
  vessel: '',
  voyage: '',
  pol: '',
  pod: '',
  etd: '',
  eta: '',
  blNumber: '',
  expectedCount: 0,
  expectedSize: '40FT',
});
async function savePatch() {
  if (!detail.value) return;
  error.value = msg.value = '';
  try {
    await api(`/api/bookings/${detail.value.id}`, {
      method: 'PATCH',
      body: { ...patch, expectedCount: Number(patch.expectedCount) || 0 },
    });
    msg.value = `Booking ${detail.value.reference} updated.`;
    await Promise.all([openBooking(detail.value.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  }
}
async function confirmBooking() {
  if (!detail.value) return;
  error.value = msg.value = '';
  try {
    await api(`/api/bookings/${detail.value.id}/confirm`, { method: 'POST', body: {} });
    msg.value = `Booking ${detail.value.reference} is confirmed.`;
    await Promise.all([openBooking(detail.value.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  }
}
const cancelReason = ref('');
const cancelling = ref(false);
async function cancelBooking() {
  if (!detail.value) return;
  error.value = msg.value = '';
  try {
    await api(`/api/bookings/${detail.value.id}/cancel`, {
      method: 'POST',
      body: { reason: cancelReason.value },
    });
    msg.value = `Booking ${detail.value.reference} is cancelled; its boxes are withdrawn and their numbers are free again.`;
    cancelling.value = false;
    await Promise.all([openBooking(detail.value.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  }
}
const comment = ref('');
async function addComment() {
  if (!detail.value || !comment.value.trim()) return;
  error.value = '';
  try {
    const c = await api<Comment>(`/api/bookings/${detail.value.id}/comments`, {
      method: 'POST',
      body: { text: comment.value },
    });
    detail.value.comments.push(c);
    comment.value = '';
  } catch (e) {
    error.value = errorText(e);
  }
}
const bookingChip = (b: { status: string }) =>
  b.status === 'CONFIRMED' ? 'st-ok' : b.status === 'PENDING' ? 'st-warn' : 'st-grey';
const boxesText = (b: Bk) =>
  b.expectedCount > b.containerCount
    ? `${b.containerCount} of ${b.expectedCount} numbers known`
    : String(b.containerCount);
const when = (d: string) =>
  new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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

const statusChip = (b: { status: string }) =>
  b.status === 'ACTIVE' ? 'st-ok' : b.status === 'DUPLICATE' ? 'st-bad' : 'st-grey';
const statusText = (b: { status: string; stage?: string | null; closedAt?: string | null }) =>
  b.status === 'ACTIVE'
    ? b.closedAt
      ? 'closed to Finance'
      : STAGE_LABEL[(b.stage ?? 'BOOKED') as keyof typeof STAGE_LABEL].toLowerCase()
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
    <JourneyBoard v-if="!searched" />
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
        <div class="subt">duplicates, costs after closing, money typed from the other side</div>
      </div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <MdQueue v-if="can('reconcile') && queue.length" :items="queue" @changed="reload" />

    <div class="panel">
      <div class="panel-h">
        <h2>Find a box on your side</h2>
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
            <th>File №</th>
            <th>Booking №</th>
            <th>Line</th>
            <th>Client</th>
            <th>Cargo</th>
            <th>Vessel · ETD</th>
            <th>Boxes</th>
            <th>Status</th>
            <th>Company</th>
            <th>Opened</th>
          </tr>
          <tr v-for="b in bookings" :key="b.id" style="cursor: pointer" @click="openBooking(b.id)">
            <td class="mono">
              <b>{{ b.fileNumber }}</b>
            </td>
            <td class="mono">{{ b.reference }}</td>
            <td>{{ b.shippingLine.name }}</td>
            <td>{{ b.client.name }}</td>
            <td>{{ b.cargo }}</td>
            <td>
              {{ b.vessel || '—' }}<span v-if="b.etd" class="hint"> · {{ fmt(b.etd) }}</span>
            </td>
            <td>
              {{ boxesText(b)
              }}<span v-if="b.duplicateCount" class="st st-bad" style="margin-left: 6px"
                >{{ b.duplicateCount }} with the MD</span
              >
            </td>
            <td>
              <span class="st" :class="bookingChip(b)">{{ b.status.toLowerCase() }}</span>
            </td>
            <td>{{ b.companyName }}</td>
            <td class="mono">{{ fmt(b.createdAt) }}</td>
          </tr>
          <tr v-if="!bookings.length">
            <td colspan="10" class="hint">
              No bookings this month on your side. Shipments → New booking starts one.
            </td>
          </tr>
        </table>
      </div>
    </div>

    <div v-if="detail" class="panel">
      <div class="panel-h">
        <h2>
          File {{ detail.fileNumber }} · booking {{ detail.reference }} —
          {{ detail.shippingLine.name }} · {{ detail.client.name }} · made by
          {{ detail.companyName }}
          <span class="st" :class="bookingChip(detail)" style="margin-left: 6px">{{
            detail.status.toLowerCase()
          }}</span>
        </h2>
        <div class="act"><button class="btn sm ghost" @click="detail = null">Close</button></div>
      </div>
      <div class="pad hint">
        Opened {{ when(detail.createdAt) }} by {{ detail.createdBy
        }}<template v-if="detail.confirmedAt"> · confirmed {{ fmt(detail.confirmedAt) }}</template
        ><template v-if="detail.status === 'CANCELLED'">
          · <b>cancelled {{ when(detail.cancelledAt!) }}: {{ detail.cancelReason }}</b></template
        ><template v-if="detail.expectedCount > detail.containers.length">
          · {{ detail.containers.length }} of {{ detail.expectedCount }} ×
          {{ detail.expectedSize }} numbers known</template
        >
      </div>
      <form
        v-if="detail.mayEdit && detail.status !== 'CANCELLED'"
        class="form-grid"
        @submit.prevent="savePatch"
      >
        <div>
          <label class="f">Cargo</label
          ><input v-model="patch.cargo" class="f" style="text-transform: uppercase" />
        </div>
        <div>
          <label class="f">Boxes agreed with the line</label>
          <div style="display: flex; gap: 8px">
            <input
              v-model="patch.expectedCount"
              class="f mono"
              type="number"
              min="0"
              max="100"
              style="width: 90px"
            />
            <select v-model="patch.expectedSize" class="f" style="width: 110px">
              <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="f">Vessel</label
          ><input v-model="patch.vessel" class="f" style="text-transform: uppercase" />
        </div>
        <div>
          <label class="f">Voyage</label
          ><input v-model="patch.voyage" class="f" style="text-transform: uppercase" />
        </div>
        <div><label class="f">Port of loading</label><input v-model="patch.pol" class="f" /></div>
        <div><label class="f">Port of discharge</label><input v-model="patch.pod" class="f" /></div>
        <div>
          <label class="f">Destination</label><input v-model="patch.destination" class="f" />
        </div>
        <div>
          <label class="f">BL №</label
          ><input v-model="patch.blNumber" class="f mono" style="text-transform: uppercase" />
        </div>
        <div>
          <label class="f">ETD — estimated departure</label
          ><input v-model="patch.etd" class="f mono" type="date" />
        </div>
        <div>
          <label class="f">ETA — estimated arrival</label
          ><input v-model="patch.eta" class="f mono" type="date" />
        </div>
        <div class="full" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
          <button class="btn sm">Save these details</button>
          <button
            v-if="detail.status === 'PENDING'"
            type="button"
            class="btn sm ghost"
            @click="confirmBooking"
          >
            The line confirmed it
          </button>
          <span style="flex: 1"></span>
          <button
            v-if="!cancelling"
            type="button"
            class="btn sm ghost"
            style="color: #b42318"
            @click="cancelling = true"
          >
            Cancel this booking…
          </button>
          <template v-else>
            <input
              v-model="cancelReason"
              class="f"
              style="width: 320px"
              placeholder="why (kept in the record)"
            />
            <button
              type="button"
              class="btn sm"
              style="background: #b42318"
              :disabled="cancelReason.trim().length < 3"
              @click="cancelBooking"
            >
              Cancel booking
            </button>
            <button type="button" class="btn sm ghost" @click="cancelling = false">Keep it</button>
          </template>
        </div>
      </form>
      <div v-else class="pad hint">
        <template v-if="!detail.mayEdit"
          >Read-only: this booking belongs to {{ detail.companyName }}.
        </template>
        Cargo {{ detail.cargo }} · vessel {{ detail.vessel || '—' }} · voyage
        {{ detail.voyage || '—' }} · {{ detail.pol || '—' }} → {{ detail.pod || '—' }} · destination
        {{ detail.destination || '—' }} · ETD {{ detail.etd ? fmt(detail.etd) : '—' }} · ETA
        {{ detail.eta ? fmt(detail.eta) : '—' }} · BL {{ detail.blNumber || '—' }}.
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
      <div v-if="detail.elsewhere.length" class="pad hint" style="border-top: 1px solid #eef2f7">
        On the other side:
        <span v-for="r in detail.elsewhere" :key="r.stage" style="margin-right: 10px"
          ><b>{{ r.count }}</b> {{ r.label.toLowerCase() }}</span
        >
        — numbers and details stay with the company handling them.
      </div>
      <div class="pad" style="border-top: 1px solid #eef2f7">
        <b style="font-size: 13px">Comments</b>
        <div v-for="c in detail.comments" :key="c.id" style="margin-top: 6px; font-size: 13px">
          <span class="hint">{{ when(c.createdAt) }} · {{ c.userName }}</span
          ><br />{{ c.text }}
        </div>
        <div v-if="!detail.comments.length" class="hint" style="margin-top: 4px">
          Nothing yet. A comment is kept forever, with who wrote it and when.
        </div>
        <form
          v-if="detail.mayEdit"
          style="display: flex; gap: 8px; margin-top: 8px"
          @submit.prevent="addComment"
        >
          <input
            v-model="comment"
            class="f"
            maxlength="1000"
            style="flex: 1"
            placeholder="e.g. line says vessel delayed to 20 Oct"
          />
          <button class="btn sm" :disabled="!comment.trim()">Add comment</button>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>
          {{
            searched
              ? `Boxes matching “${searched}” — on your side`
              : 'Containers — your working list, one record per box'
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
            <th>Stage · where</th>
            <th>With</th>
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
              <NuxtLink
                :to="`/app/journey?container=${c.id}`"
                class="st"
                :class="statusChip(c)"
                style="text-decoration: none"
                >{{ statusText(c) }}</NuxtLink
              ><span v-if="c.lastPlace" class="hint"> · {{ c.lastPlace }}</span
              ><span v-if="c.duplicateOf" class="hint">
                · also on {{ c.duplicateOf.bookingReference }}</span
              >
            </td>
            <td>
              {{ c.responsibleCompanyName
              }}<span v-if="c.responsibleCompanyName !== c.booking.companyName" class="hint">
                · booked by {{ c.booking.companyName }}</span
              >
            </td>
          </tr>
          <tr v-if="!boxes.length">
            <td colspan="7" class="hint">
              {{
                searched
                  ? 'No box with that number on your side. A box on the other side shows only as a count.'
                  : 'No boxes this month on your working list. A box handed over at Rusumo is on the other side\'s list; see "handed over" above.'
              }}
            </td>
          </tr>
        </table>
      </div>
    </div>
    <div class="note">
      ⓘ A container number is checked (ISO 6346) before it is saved, and the account never holds two
      live records of one number: the second entry waits here, beside the first, for the Managing
      Director. A box is on the working list of the company responsible for it; that flips at the
      hand-over stage. Transport legs come later as their own slice.
    </div>
  </div>
</template>
