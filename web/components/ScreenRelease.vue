<script setup lang="ts">
/**
 * Shipments → Release. When a booking's boxes clear at the port together, one sign-off — not a walk through
 * each box. A box is pre-ticked only when its own status says it has reached the port; a straggler at Magerwa
 * is not, and is refused if ticked. The waiting boxes move to a sister booking number from the line.
 */
import type { BoardBox } from './JourneyBoard.vue';
const api = useApi();
const { can, canOpen } = useSession();

interface Bk {
  id: string;
  reference: string;
  fileNumber: string;
  status: string;
  containerCount: number;
  client: { name: string };
  shippingLine: { name: string };
  companyName: string;
}
interface ReleaseBox extends BoardBox {
  preselected: boolean;
  closed: boolean;
}
interface View {
  booking: {
    id: string;
    reference: string;
    fileNumber: string;
    status: string;
    companyName: string;
    line: string;
    client: string;
    isSister: boolean;
    sisters: { id: string; reference: string }[];
  };
  containers: ReleaseBox[];
  mayRelease: boolean;
  maySplit: boolean;
}
interface Released extends BoardBox {
  releasedBy: string;
}

const months = (() => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++)
    out.push(
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  return out;
})();
const month = ref(months[0]!);
const bookings = ref<Bk[]>([]);
const view = ref<View | null>(null);
const released = ref<Released[]>([]);
const ticked = ref<Record<string, boolean>>({});
const form = reactive({ releasedOn: '', note: '' });
const sister = reactive({ reference: '', ids: {} as Record<string, boolean> });
const error = ref('');
const msg = ref('');
const busy = ref(false);
const q = ref('');

/** Bookings of this month on my side, plus the bookings whose boxes are on my list — the other side's bookings after Rusumo. */
async function reload() {
  const jobs: Promise<unknown>[] = [
    api<Released[]>('/api/releases?limit=30').then((r) => (released.value = r)),
  ];
  if (canOpen('cont'))
    jobs.push(
      Promise.all([
        api<Bk[]>(`/api/bookings?month=${month.value}`),
        api<{ boxes: BoardBox[] }>('/api/board').catch(() => ({ boxes: [] as BoardBox[] })),
      ]).then(([mine, board]) => {
        const seen = new Set(mine.map((b) => b.id));
        const theirs: Bk[] = [];
        for (const b of board.boxes)
          if (!seen.has(b.booking.id)) {
            seen.add(b.booking.id);
            theirs.push({
              id: b.booking.id,
              reference: b.booking.reference,
              fileNumber: b.booking.fileNumber,
              status: 'CONFIRMED',
              containerCount: board.boxes.filter((x) => x.booking.id === b.booking.id).length,
              client: { name: b.booking.client },
              shippingLine: { name: '' },
              companyName: '',
            });
          }
        bookings.value = [...mine, ...theirs];
      }),
    );
  await Promise.all(jobs);
}
await reload();
watch(month, reload);

async function open(id: string) {
  error.value = msg.value = '';
  try {
    view.value = await api<View>(`/api/bookings/${id}/release`);
    ticked.value = Object.fromEntries(view.value.containers.map((c) => [c.id, c.preselected]));
    sister.reference = `${view.value.booking.reference}A`;
    sister.ids = Object.fromEntries(
      view.value.containers.filter((c) => !c.released && !c.preselected).map((c) => [c.id, true]),
    );
    form.note = '';
  } catch (e) {
    error.value = errorText(e);
  }
}
const initial = String(useRoute().query.booking ?? '');
if (initial) await open(initial);
useLive().onChange(['journey', 'shipments', 'costs'], async () => {
  await reload();
  if (view.value) view.value = await api<View>(`/api/bookings/${view.value.booking.id}/release`);
});

/** Find a booking by its number when it is not in this month's list (the other side's booking, for instance). */
async function findBooking() {
  error.value = '';
  const text = q.value.trim().toUpperCase();
  if (!text) return;
  try {
    const boxes = await api<{ booking: { id: string; reference: string } }[]>(
      `/api/containers?q=${encodeURIComponent(text)}`,
    );
    const hit = boxes.find((b) => b.booking.reference === text) ?? boxes[0];
    if (hit) await open(hit.booking.id);
    else {
      const all = await api<Bk[]>('/api/bookings');
      const b = all.find((x) => x.reference === text);
      if (b) await open(b.id);
      else
        error.value = `No booking or box matching ${text} on your side; type a container number of it instead.`;
    }
  } catch (e) {
    error.value = errorText(e);
  }
}

const tickedIds = computed(() =>
  Object.entries(ticked.value)
    .filter(([, on]) => on)
    .map(([id]) => id),
);
const waiting = computed(
  () => view.value?.containers.filter((c) => !c.released && !ticked.value[c.id]) ?? [],
);
const untickedPreselected = computed(
  () => view.value?.containers.filter((c) => c.preselected && !ticked.value[c.id]) ?? [],
);

async function run(job: () => Promise<unknown>, done: string) {
  if (!view.value) return;
  error.value = msg.value = '';
  busy.value = true;
  try {
    await job();
    msg.value = done;
    await Promise.all([open(view.value.booking.id), reload()]);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const release = () =>
  run(
    () =>
      api(`/api/bookings/${view.value!.booking.id}/release`, {
        method: 'POST',
        body: { containerIds: tickedIds.value, releasedOn: form.releasedOn, note: form.note },
      }),
    `${tickedIds.value.length} box${tickedIds.value.length === 1 ? '' : 'es'} released on ${view.value!.booking.reference}.`,
  );
const sisterIds = computed(() =>
  Object.entries(sister.ids)
    .filter(([, on]) => on)
    .map(([id]) => id),
);
const split = () =>
  run(
    () =>
      api(`/api/bookings/${view.value!.booking.id}/sister`, {
        method: 'POST',
        body: { reference: sister.reference, containerIds: sisterIds.value },
      }),
    `${sisterIds.value.length} waiting box${sisterIds.value.length === 1 ? '' : 'es'} now follow ${sister.reference.toUpperCase()}.`,
  );

const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const when = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="panel">
      <div class="panel-h">
        <h2>Release — one sign-off for the boxes the line accepted</h2>
        <div class="act" style="display: flex; gap: 6px; align-items: center">
          <select v-model="month" class="f">
            <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
          </select>
          <form style="display: flex; gap: 6px" @submit.prevent="findBooking">
            <input
              v-model="q"
              class="f mono"
              style="width: 200px"
              placeholder="booking or container №"
            />
            <button class="btn sm ghost">Find</button>
          </form>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Booking №</th>
            <th>File</th>
            <th>Line</th>
            <th>Client</th>
            <th>Boxes</th>
            <th>Status</th>
            <th></th>
          </tr>
          <tr
            v-for="b in bookings.filter((x) => x.status !== 'CANCELLED')"
            :key="b.id"
            style="cursor: pointer"
            @click="open(b.id)"
          >
            <td class="mono">
              <b>{{ b.reference }}</b>
            </td>
            <td class="mono">{{ b.fileNumber }}</td>
            <td>{{ b.shippingLine.name || '—' }}</td>
            <td>{{ b.client.name }}</td>
            <td>
              {{ b.containerCount
              }}<span v-if="!b.shippingLine.name" class="hint"> on your side</span>
            </td>
            <td>
              <span class="st st-ok">{{ b.status.toLowerCase() }}</span>
            </td>
            <td class="hint">open →</td>
          </tr>
          <tr v-if="!bookings.length">
            <td colspan="7" class="hint">
              No bookings this month on your side. Find one by its number above.
            </td>
          </tr>
        </table>
      </div>
    </div>

    <div v-if="view" class="panel">
      <div class="panel-h">
        <h2>
          Release — booking {{ view.booking.reference }} · {{ view.booking.line }} ·
          {{ view.booking.client }} · made by {{ view.booking.companyName }}
          <span v-if="view.booking.isSister" class="st st-info" style="margin-left: 6px"
            >sister booking</span
          >
        </h2>
        <div class="act hint">
          {{ view.containers.filter((c) => c.preselected).length }} of
          {{ view.containers.length }} pre-ticked by status
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th></th>
            <th>Container №</th>
            <th>Stage</th>
            <th>Where</th>
            <th>With</th>
            <th>Pre-ticked?</th>
          </tr>
          <tr v-for="c in view.containers" :key="c.id">
            <td>
              <input
                v-model="ticked[c.id]"
                type="checkbox"
                :disabled="c.released || c.closed || !view.mayRelease || !can('write')"
              />
            </td>
            <td class="mono">
              <b>{{ pretty(c.number) }}</b> <span class="hint">{{ c.size }}</span>
            </td>
            <td>
              <span
                class="st"
                :class="c.released ? 'st-ok' : c.preselected ? 'st-info' : 'st-warn'"
                >{{
                  c.released ? 'released ' + when(c.releasedAt) : c.stageLabel.toLowerCase()
                }}</span
              >
            </td>
            <td>{{ c.place || '—' }}</td>
            <td>{{ c.responsibleCompanyName }}</td>
            <td class="hint">
              {{
                c.released
                  ? '—'
                  : c.preselected
                    ? 'yes — status says so'
                    : 'no — not at the port yet'
              }}
            </td>
          </tr>
        </table>
      </div>
      <form
        v-if="view.mayRelease && can('write')"
        class="pad"
        style="
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          border-top: 1px solid #eef2f7;
        "
        @submit.prevent="release"
      >
        <input v-model="form.releasedOn" class="f" type="date" />
        <input
          v-model="form.note"
          class="f"
          style="flex: 1; min-width: 200px"
          maxlength="300"
          placeholder="note — e.g. PIL release at Dar, KOTA SETIA 042E"
        />
        <button class="btn" :disabled="busy || !tickedIds.length">
          Confirm release — {{ tickedIds.length }} container{{ tickedIds.length === 1 ? '' : 's' }}
        </button>
        <div v-if="untickedPreselected.length" class="hint" style="width: 100%">
          Unticking {{ untickedPreselected.map((c) => pretty(c.number)).join(', ') }} is a
          correction to a wrong status, not the way to catch a straggler: correct the stage on
          Journey stages.
        </div>
      </form>
      <div v-else class="pad hint">
        You can read this booking's release; the company responsible for its boxes signs it.
      </div>

      <div v-if="waiting.length" class="pad" style="border-top: 1px solid #eef2f7">
        <b style="font-size: 13px">Waiting boxes → sister booking</b>
        <div class="hint" style="margin-bottom: 6px">
          If some boxes release and others wait, call the line for a sister number (the first plus a
          suffix). The waiting boxes and their cost lines follow the new number; released and
          waiting boxes never mix on one.
        </div>
        <form
          v-if="view.maySplit && can('write')"
          style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center"
          @submit.prevent="split"
        >
          <label
            v-for="c in waiting"
            :key="c.id"
            class="hint"
            style="display: flex; gap: 4px; align-items: center"
          >
            <input v-model="sister.ids[c.id]" type="checkbox" />
            <span class="mono">{{ pretty(c.number) }}</span>
          </label>
          <input
            v-model="sister.reference"
            class="f mono"
            style="width: 200px"
            placeholder="sister booking №"
          />
          <button
            class="btn ghost"
            :disabled="busy || !sisterIds.length || sister.reference.trim().length < 6"
          >
            Move to sister booking
          </button>
        </form>
        <div v-else class="hint">
          The company that made the booking calls the line and moves them.
        </div>
        <div v-if="view.booking.sisters.length" class="hint" style="margin-top: 6px">
          Sister bookings:
          <span v-for="s in view.booking.sisters" :key="s.id" class="mono" style="margin-right: 8px"
            ><a style="cursor: pointer" @click="open(s.id)">{{ s.reference }}</a></span
          >
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Released lately — on your side</h2></div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>When</th>
            <th>Booking</th>
            <th>Container №</th>
            <th>Stage now</th>
            <th>Signed by</th>
          </tr>
          <tr v-for="c in released" :key="c.id">
            <td class="mono">{{ when(c.releasedAt) }}</td>
            <td class="mono">{{ c.booking.reference }}</td>
            <td class="mono">
              <b>{{ pretty(c.number) }}</b>
            </td>
            <td>
              <span class="st st-ok">{{ c.stageLabel.toLowerCase() }}</span>
            </td>
            <td>{{ c.releasedBy }}</td>
          </tr>
          <tr v-if="!released.length">
            <td colspan="5" class="hint">Nothing released yet.</td>
          </tr>
        </table>
      </div>
    </div>
    <div class="note">
      ⓘ Pre-selected only if that container's own status already says it has reached the port.
      Unchecking is a correction to a wrong status, not the normal way to catch a straggler.
    </div>
  </div>
</template>
