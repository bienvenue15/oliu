<script setup lang="ts">
/**
 * The board: every box in motion on this side, by stage, in six columns. Replaces the morning round of calls.
 * A box on the road that has not been heard of for longer than the account's tracking hours is marked;
 * so is a box at risk, or held. Below the columns: boxes coming to this side, and boxes handed over.
 */
const api = useApi();
const { me } = useSession();

export interface BoardBox {
  id: string;
  number: string;
  size: string;
  stage: string;
  stageLabel: string;
  column: string;
  place: string;
  lastSeenAt: string | null;
  seenAt: string;
  hoursSinceSeen: number;
  updateOverdue: boolean;
  held: boolean;
  holdReason: string;
  atRisk: boolean;
  risk: { source: string; reason: string; since: string } | null;
  daysAtIcd: number | null;
  icdFreeDays: number;
  localOnly: boolean;
  responsibleCompanyName: string;
  originCompanyName: string;
  released: boolean;
  booking: {
    id: string;
    reference: string;
    fileNumber: string;
    cargo: string;
    vessel: string;
    client: string;
    isSister: boolean;
  };
}
/** What the other side shows of its boxes: how many, at which stage. Nothing else. */
export interface StageCount {
  stage: string;
  label: string;
  count: number;
}
interface Board {
  columns: { key: string; label: string; stages: string[]; count: number }[];
  boxes: BoardBox[];
  coming: StageCount[];
  handedOver: StageCount[];
  settings: { icdFreeDays: number; trackingHours: number };
  handoverStage: string | null;
}

const board = ref<Board | null>(null);
const error = ref('');
async function reload() {
  try {
    board.value = await api<Board>('/api/board');
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
defineExpose({ reload });
useLive().onChange(['journey', 'shipments', 'costs'], reload);

const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
/** Minutes for the first hour, hours for the first day, days after that (the owner's rule of 30 Oct). */
const clock = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => (ticker = setInterval(() => (clock.value = Date.now()), 60_000)));
onUnmounted(() => clearInterval(ticker));
const ago = (iso: string) => {
  const min = Math.floor((clock.value - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
};
const inColumn = (key: string) => board.value?.boxes.filter((b) => b.column === key) ?? [];
const group = computed(() => me.value?.account.package === 'GROUP');
const total = (rows: StageCount[]) => rows.reduce((n, r) => n + r.count, 0);
const overdue = computed(() => board.value?.boxes.filter((b) => b.updateOverdue).length ?? 0);
const atRisk = computed(() => board.value?.boxes.filter((b) => b.atRisk).length ?? 0);
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="board" class="cards">
      <div class="card">
        <div class="lbl">In motion on your side</div>
        <div class="val">{{ board.boxes.length }}</div>
        <div class="subt">boxes not yet closed to Finance</div>
      </div>
      <div class="card">
        <div class="lbl">Position overdue</div>
        <div class="val" :style="overdue ? 'color: var(--warn)' : ''">{{ overdue }}</div>
        <div class="subt">
          on the road, no update for {{ board.settings.trackingHours }} h or more
        </div>
      </div>
      <div class="card">
        <div class="lbl">At risk</div>
        <div class="val" :style="atRisk ? 'color: var(--bad)' : ''">{{ atRisk }}</div>
        <div class="subt">
          past {{ board.settings.icdFreeDays }} free days at the ICD, or flagged by hand
        </div>
      </div>
      <div v-if="group" class="card">
        <div class="lbl">Coming to your side</div>
        <div class="val">{{ total(board.coming) }}</div>
        <div class="subt">loaded, on their way; the other side's boxes, by count only</div>
      </div>
    </div>

    <div v-if="board" class="panel">
      <div class="panel-h">
        <h2>The board — where every box is, by stage</h2>
        <div class="act hint">
          Hand-over at
          <b>{{ board.handoverStage ? board.handoverStage.toLowerCase() : 'none' }}</b> · open a box
          to confirm its next stage or type its position
        </div>
      </div>
      <div class="board">
        <div v-for="col in board.columns" :key="col.key" class="col">
          <div class="col-h">
            {{ col.label }} <span class="hint">{{ col.count }}</span>
          </div>
          <NuxtLink
            v-for="b in inColumn(col.key)"
            :key="b.id"
            :to="`/app/journey?container=${b.id}`"
            class="box"
            :class="{ warn: b.updateOverdue, bad: b.atRisk || b.held }"
          >
            <div class="mono">
              <b>{{ pretty(b.number) }}</b> <span class="hint">{{ b.size }}</span>
            </div>
            <div class="hint">{{ b.booking.client }} · {{ b.booking.reference }}</div>
            <div style="font-size: 12px">{{ b.place || b.stageLabel }}</div>
            <div class="hint">
              {{ ago(b.seenAt) }}
              <span v-if="b.daysAtIcd !== null"> · day {{ b.daysAtIcd }} at the ICD</span>
            </div>
            <div style="margin-top: 3px; display: flex; gap: 4px; flex-wrap: wrap">
              <span v-if="b.updateOverdue" class="st st-warn">position overdue</span>
              <span v-if="b.atRisk" class="st st-bad">at risk</span>
              <span v-if="b.held" class="st st-bad">held</span>
              <span v-if="b.released" class="st st-ok">released</span>
              <span v-if="group && !me?.user.companyId" class="st st-grey">{{
                b.responsibleCompanyName.split(' ')[0]
              }}</span>
            </div>
          </NuxtLink>
          <div v-if="!inColumn(col.key).length" class="hint" style="padding: 8px 4px">—</div>
        </div>
      </div>
    </div>

    <div
      v-if="board && group && (board.coming.length || board.handedOver.length)"
      class="cards"
      style="grid-template-columns: 1fr 1fr"
    >
      <div class="panel" style="margin: 0">
        <div class="panel-h"><h2>Coming to your side — how many, at which stage</h2></div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Stage</th>
              <th>Boxes</th>
            </tr>
            <tr v-for="r in board.coming" :key="r.stage">
              <td>{{ r.label }}</td>
              <td>
                <b>{{ r.count }}</b>
              </td>
            </tr>
            <tr v-if="!board.coming.length">
              <td colspan="2" class="hint">Nothing on its way yet.</td>
            </tr>
          </table>
        </div>
      </div>
      <div class="panel" style="margin: 0">
        <div class="panel-h"><h2>Handed over — your bookings' boxes on the other side</h2></div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Stage</th>
              <th>Boxes</th>
            </tr>
            <tr v-for="r in board.handedOver" :key="r.stage">
              <td>{{ r.label }}</td>
              <td>
                <b>{{ r.count }}</b>
              </td>
            </tr>
            <tr v-if="!board.handedOver.length">
              <td colspan="2" class="hint">None yet.</td>
            </tr>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(6, minmax(150px, 1fr));
  gap: 8px;
  padding: 12px;
  overflow-x: auto;
}
.col {
  background: #f6f8fa;
  border-radius: 10px;
  padding: 8px;
  min-height: 120px;
}
.col-h {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 800;
  color: var(--navy);
  margin: 2px 4px 8px;
}
.box {
  display: block;
  background: #fff;
  border: 1px solid var(--line);
  border-left: 4px solid var(--ok);
  border-radius: 8px;
  padding: 7px 9px;
  margin-bottom: 7px;
  text-decoration: none;
  color: inherit;
  font-size: 12.5px;
}
.box:hover {
  box-shadow: var(--sh);
}
.box.warn {
  border-left-color: var(--warn);
}
.box.bad {
  border-left-color: var(--bad);
}
@media (max-width: 1100px) {
  .board {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }
}
@media (max-width: 640px) {
  .board {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
