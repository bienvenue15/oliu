<script setup lang="ts">
/**
 * Shipments → Journey stages. One box at a time: its timeline, and what happens next — a stage reached, a
 * position on the road, held at the border, returned, flagged at risk. Each entry carries the moment it
 * happened and who said so. A cost paid at the stage can be typed in the same breath; it goes through the
 * cost module like any other line.
 */
import {
  CURRENCIES,
  STAGE_LABEL,
  checkContainerNumber,
  parseMoney,
  type Currency,
} from '@oliu/shared';
import type { BoardBox } from './JourneyBoard.vue';
const api = useApi();
const { me, can } = useSession();
const route = useRoute();

interface Found {
  id: string;
  number: string;
  stage: string;
  responsibleCompanyName: string;
  booking: { reference: string; client: string; companyName: string };
}
interface Event {
  id: string;
  kind: string;
  stage: string | null;
  stageLabel: string;
  place: string;
  note: string;
  happenedAt: string;
  typedAt: string;
  by: string;
  companyName: string;
  handedTo: string;
}
interface Journey {
  box: BoardBox & {
    departedOn: string | null;
    arrivedOn: string | null;
    emptyReturnedOn: string | null;
    closed: boolean;
    plMonth: string;
  };
  mayMove: boolean;
  handoverStage: string | null;
  nextStages: { key: string; label: string }[];
  events: Event[];
  riskPeriods: {
    id: string;
    source: string;
    reason: string;
    from: string;
    to: string | null;
    openedBy: string;
    closedBy: string;
  }[];
  releasedBy: string;
  closedBy: string;
}
interface Category {
  id: string;
  name: string;
  active: boolean;
}

const q = ref('');
const found = ref<Found[]>([]);
const j = ref<Journey | null>(null);
const categories = ref<Category[]>([]);
const error = ref('');
const msg = ref('');
const busy = ref(false);

async function open(id: string) {
  error.value = '';
  try {
    j.value = await api<Journey>(`/api/containers/${id}/journey`);
    found.value = [];
    resetForms();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function search() {
  error.value = msg.value = '';
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
    else j.value = null;
  } catch (e) {
    error.value = errorText(e);
  }
}

// ---- the forms
const nowLocal = () =>
  new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
const reached = reactive({
  stage: '',
  place: '',
  happenedAt: '',
  note: '',
  departedOn: '',
  arrivedOn: '',
  emptyReturnedOn: '',
});
const costForm = reactive({
  on: false,
  categoryId: '',
  currency: 'RWF' as Currency,
  amount: '',
  paidTo: '',
});
const update = reactive({ place: '', happenedAt: '', note: '' });
const hold = reactive({ place: '', note: '' });
const lifted = reactive({ note: '' });
const returned = reactive({ note: '' });
const risk = reactive({ reason: '', note: '' });
const correction = reactive({ stage: '', reason: '' });

/** Which category a stage's cost usually is; the person can change it. */
const USUAL_CATEGORY: Record<string, string> = {
  TRANSPORT: 'Inland transport',
  FIELD_RELEASE: 'Clearance — Kigali',
  RUSUMO: 'Border / transit',
  CHECKPOINTS: 'Tip / facilitation',
  ICD: 'Storage / demurrage',
  PORT: 'ICD / port charges',
  OCEAN_FREIGHT: 'Shipping line',
};
function resetForms() {
  Object.assign(reached, {
    stage: j.value?.nextStages[0]?.key ?? '',
    place: '',
    happenedAt: '',
    note: '',
    departedOn: '',
    arrivedOn: '',
    emptyReturnedOn: '',
  });
  Object.assign(costForm, {
    on: false,
    categoryId: '',
    currency: me.value?.companies.find((c) => c.id === me.value?.user.companyId)?.currency ?? 'RWF',
    amount: '',
    paidTo: '',
  });
  Object.assign(update, { place: '', happenedAt: '', note: '' });
  Object.assign(hold, { place: '', note: '' });
  lifted.note = '';
  returned.note = '';
  Object.assign(risk, { reason: '', note: '' });
  Object.assign(correction, { stage: '', reason: '' });
}
watch(
  () => reached.stage,
  (st) => {
    const usual = categories.value.find((c) => c.name === USUAL_CATEGORY[st]);
    if (usual) costForm.categoryId = usual.id;
  },
  { immediate: true },
);
const costMinor = computed(() =>
  costForm.amount ? parseMoney(costForm.amount, costForm.currency) : null,
);

// The forms exist now; a link can carry the box: ?container=<id> from the board, or ?number=PCIU9084297 from anywhere.
if (can('write'))
  categories.value = (await api<Category[]>('/api/cost-categories')).filter((c) => c.active);
const initial = String(route.query.container ?? '');
if (initial) await open(initial);
const initialNumber = String(route.query.number ?? '').trim();
if (initialNumber && !j.value) {
  q.value = initialNumber;
  await search();
}
/** Live: the open box refreshes (timeline, flags, stage) without clearing a half-typed form. */
useLive().onChange(['journey', 'costs', 'shipments'], async () => {
  if (j.value) j.value = await api<Journey>(`/api/containers/${j.value.box.id}/journey`);
});

async function run(job: () => Promise<unknown>, done: string) {
  if (!j.value) return;
  error.value = msg.value = '';
  busy.value = true;
  try {
    await job();
    msg.value = done;
    await open(j.value.box.id);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const post = (path: string, body: Record<string, unknown>) =>
  api(`/api/containers/${j.value!.box.id}${path}`, { method: 'POST', body });

const saveReached = () =>
  run(
    async () => {
      const extra =
        reached.stage === 'OCEAN_FREIGHT'
          ? {
              departedOn: reached.departedOn,
              arrivedOn: reached.arrivedOn,
              emptyReturnedOn: reached.emptyReturnedOn,
            }
          : {};
      await post('/journey', {
        kind: 'REACHED',
        stage: reached.stage,
        place: reached.place,
        happenedAt: reached.happenedAt,
        note: reached.note,
        ...extra,
      });
      if (costForm.on && costMinor.value) {
        await api('/api/costs', {
          method: 'POST',
          body: {
            containerIds: [j.value!.box.id],
            categoryId: costForm.categoryId,
            date: (reached.happenedAt || nowLocal()).slice(0, 10),
            currency: costForm.currency,
            totalMinor: costMinor.value,
            paidTo: costForm.paidTo,
            note: `At ${STAGE_LABEL[reached.stage as keyof typeof STAGE_LABEL].toLowerCase()}`,
          },
        });
      }
    },
    `${STAGE_LABEL[reached.stage as keyof typeof STAGE_LABEL]} — kept.${costForm.on && costMinor.value ? ' The cost line is on the box.' : ''}`,
  );
const saveUpdate = () =>
  run(() => post('/journey', { kind: 'UPDATE', ...update }), 'Position kept.');
const saveHold = () =>
  run(() => post('/journey', { kind: 'HELD', ...hold }), 'Held — on the record.');
const saveHoldLifted = () =>
  run(
    () => post('/journey', { kind: 'HOLD_LIFTED', note: lifted.note }),
    'Hold lifted — the box stays where it is.',
  );
const saveReturned = () =>
  run(
    () => post('/journey', { kind: 'RETURNED', note: returned.note }),
    'Returned to the Kigali side.',
  );
const flag = () =>
  run(
    () => post('/risk', { reason: risk.reason }),
    'Flagged at risk: every cost from now is delay-related.',
  );
const clear = () => run(() => post('/risk/clear', { note: risk.note }), 'Flag lifted.');
const correct = () =>
  run(
    () => post('/journey/correct', { ...correction }),
    'Stage corrected, with your reason on the trail.',
  );

const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const when = (d: string) =>
  new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const day = (d: string | null) => (d ? d.slice(0, 10) : '—');
const KIND_TEXT: Record<string, string> = {
  REACHED: 'reached',
  UPDATE: 'position',
  HELD: 'held',
  HOLD_LIFTED: 'hold lifted',
  RETURNED: 'returned',
  CORRECTED: 'corrected to',
  RELEASED: 'released by the line',
  FLAGGED: 'flagged at risk',
  CLEARED: 'flag lifted',
  CLOSED: 'closed to Finance',
  REOPENED: 'reopened',
};
const kindChip = (k: string) =>
  k === 'REACHED'
    ? 'st-ok'
    : k === 'UPDATE'
      ? 'st-info'
      : k === 'HELD' || k === 'FLAGGED'
        ? 'st-bad'
        : k === 'CORRECTED' || k === 'RETURNED'
          ? 'st-warn'
          : 'st-grey';
const mayCorrect = computed(
  () => j.value?.mayMove && ['MD', 'OPS_MANAGER'].includes(me.value?.user.role ?? ''),
);
const atOrBeforeRusumo = computed(
  () => !!j.value && ['BOOKED', 'TRANSPORT', 'FIELD_RELEASE', 'RUSUMO'].includes(j.value.box.stage),
);
const stages = Object.entries(STAGE_LABEL) as [string, string][];
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="panel">
      <div class="panel-h">
        <h2>Journey stages — where is this box, and what happens next</h2>
        <form class="act" style="display: flex; gap: 8px" @submit.prevent="search">
          <input
            v-model="q"
            class="f mono"
            style="width: 240px"
            placeholder="container number or part of it"
          />
          <button class="btn sm">Open</button>
          <NuxtLink to="/app/cont" class="btn sm ghost">The board</NuxtLink>
        </form>
      </div>
      <div v-if="found.length > 1 && !j" class="tablewrap">
        <table>
          <tr>
            <th>Container №</th>
            <th>Booking №</th>
            <th>Client</th>
            <th>Stage</th>
            <th>With</th>
          </tr>
          <tr v-for="f in found" :key="f.id" style="cursor: pointer" @click="open(f.id)">
            <td class="mono">
              <b>{{ pretty(f.number) }}</b>
            </td>
            <td class="mono">{{ f.booking.reference }}</td>
            <td>{{ f.booking.client }}</td>
            <td>{{ STAGE_LABEL[f.stage as keyof typeof STAGE_LABEL] }}</td>
            <td>{{ f.responsibleCompanyName }}</td>
          </tr>
        </table>
      </div>
      <div v-else-if="!j" class="pad hint">
        Type a container number, or open a box from the board. Every box of the account is found;
        only a box on your side, or one your company booked, can be moved from here.
      </div>
    </div>

    <template v-if="j">
      <div class="panel">
        <div class="panel-h">
          <h2>
            {{ pretty(j.box.number) }} · {{ j.box.size }} · {{ j.box.booking.cargo }} — booking
            {{ j.box.booking.reference }} · {{ j.box.booking.client }} · file
            {{ j.box.booking.fileNumber }}
          </h2>
          <div class="act">
            <NuxtLink :to="`/app/cost?number=${j.box.number}`" class="btn sm ghost"
              >Container record</NuxtLink
            >
          </div>
        </div>
        <div class="pad" style="display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start">
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Stage</div>
            <div style="font-size: 20px">
              <b>{{ j.box.stageLabel }}</b>
            </div>
            <div class="hint">since {{ j.box.stageAt ? when(j.box.stageAt) : 'booking' }}</div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Last position</div>
            <div style="font-size: 16px">{{ j.box.place || '—' }}</div>
            <div class="hint">
              {{ j.box.lastSeenAt ? when(j.box.lastSeenAt) : 'never typed' }}
              <span v-if="j.box.updateOverdue" class="st st-warn">update overdue</span>
            </div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">
              Responsible now
            </div>
            <div style="font-size: 16px">
              <b>{{ j.box.responsibleCompanyName }}</b>
            </div>
            <div class="hint">
              booked by {{ j.box.originCompanyName }} · hand-over at
              {{ (j.handoverStage ?? 'none').toLowerCase() }}
            </div>
          </div>
          <div>
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Flags</div>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px">
              <span v-if="j.box.held" class="st st-bad">held — {{ j.box.holdReason }}</span>
              <span v-if="j.box.atRisk" class="st st-bad"
                >at risk since {{ j.box.risk?.since }} — {{ j.box.risk?.reason }}</span
              >
              <span
                v-if="j.box.daysAtIcd !== null"
                class="st"
                :class="j.box.atRisk ? 'st-bad' : 'st-info'"
                >day {{ j.box.daysAtIcd }} of {{ j.box.icdFreeDays }} free at the ICD</span
              >
              <span v-if="j.box.released" class="st st-ok"
                >released {{ day(j.box.releasedAt) }} by {{ j.releasedBy }}</span
              >
              <span v-if="j.box.closed" class="st st-grey"
                >closed to Finance · P&amp;L {{ j.box.plMonth }} · {{ j.closedBy }}</span
              >
              <span v-if="j.box.localOnly" class="st st-grey">local only</span>
              <span
                v-if="
                  !j.box.held &&
                  !j.box.atRisk &&
                  !j.box.closed &&
                  j.box.daysAtIcd === null &&
                  !j.box.released
                "
                class="hint"
                >none</span
              >
            </div>
          </div>
          <div v-if="j.box.stage === 'OCEAN_FREIGHT' || j.box.departedOn">
            <div class="hint" style="font-size: 11px; text-transform: uppercase">Vessel</div>
            <div class="mono" style="font-size: 13px">
              departed {{ day(j.box.departedOn) }} · arrived {{ day(j.box.arrivedOn) }} · empty back
              {{ day(j.box.emptyReturnedOn) }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="j.mayMove && can('write')"
        class="cards"
        style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))"
      >
        <div class="panel" style="margin: 0">
          <div class="panel-h"><h2>The box reached a stage</h2></div>
          <form class="pad" style="display: grid; gap: 8px" @submit.prevent="saveReached">
            <select v-model="reached.stage" class="f" required>
              <option v-for="s in j.nextStages" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>
            <input
              v-model="reached.place"
              class="f"
              maxlength="120"
              placeholder="where — e.g. Magerwa Gikondo, AZAM ICD, KOTA SETIA"
            />
            <div style="display: flex; gap: 8px; align-items: center">
              <input v-model="reached.happenedAt" class="f" type="datetime-local" style="flex: 1" />
              <span class="hint">when it happened; empty = now</span>
            </div>
            <template v-if="reached.stage === 'OCEAN_FREIGHT'">
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
                <label class="hint"
                  >departed <input v-model="reached.departedOn" class="f" type="date"
                /></label>
                <label class="hint"
                  >arrived <input v-model="reached.arrivedOn" class="f" type="date"
                /></label>
                <label class="hint"
                  >empty returned <input v-model="reached.emptyReturnedOn" class="f" type="date"
                /></label>
              </div>
            </template>
            <input v-model="reached.note" class="f" maxlength="300" placeholder="note, if any" />
            <label class="hint" style="display: flex; gap: 6px; align-items: center">
              <input v-model="costForm.on" type="checkbox" /> money was paid at this stage — type it
              here, it becomes a cost line
            </label>
            <div
              v-if="costForm.on"
              style="display: grid; grid-template-columns: 1fr 80px 1fr; gap: 6px"
            >
              <select v-model="costForm.categoryId" class="f" required>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <select v-model="costForm.currency" class="f">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <input v-model="costForm.amount" class="f mono" placeholder="amount" />
              <input
                v-model="costForm.paidTo"
                class="f"
                style="grid-column: 1 / -1"
                maxlength="120"
                placeholder="paid to"
              />
              <span
                v-if="costForm.amount && costMinor === null"
                class="st st-bad"
                style="grid-column: 1 / -1"
                >not an amount in {{ costForm.currency }}</span
              >
            </div>
            <button
              class="btn"
              :disabled="
                busy || !reached.stage || (costForm.on && (!costMinor || !costForm.categoryId))
              "
            >
              Confirm
              {{
                reached.stage
                  ? STAGE_LABEL[reached.stage as keyof typeof STAGE_LABEL].toLowerCase()
                  : ''
              }}
              <template
                v-if="
                  reached.stage === j.handoverStage &&
                  j.box.responsibleCompanyName === j.box.originCompanyName
                "
              >
                — hands the box over</template
              >
            </button>
          </form>
        </div>

        <div class="panel" style="margin: 0">
          <div class="panel-h"><h2>Where is it now — the tracking update</h2></div>
          <form class="pad" style="display: grid; gap: 8px" @submit.prevent="saveUpdate">
            <input
              v-model="update.place"
              class="f"
              maxlength="120"
              required
              placeholder="place — e.g. Kahama weighbridge, parked at Nyakanazi"
            />
            <div style="display: flex; gap: 8px; align-items: center">
              <input v-model="update.happenedAt" class="f" type="datetime-local" style="flex: 1" />
              <span class="hint">empty = now</span>
            </div>
            <input v-model="update.note" class="f" maxlength="300" placeholder="note, if any" />
            <button class="btn ghost" :disabled="busy || !update.place">Keep position</button>
            <div class="hint">
              On the road a position is expected every few hours (the figure is in Settings →
              Configuration); the board shows who is overdue.
            </div>
          </form>
        </div>

        <div class="panel" style="margin: 0">
          <div class="panel-h"><h2>Held, returned, at risk</h2></div>
          <div class="pad" style="display: grid; gap: 10px">
            <form
              v-if="j.box.held"
              style="display: flex; gap: 6px; flex-wrap: wrap"
              @submit.prevent="saveHoldLifted"
            >
              <input
                v-model="lifted.note"
                class="f"
                style="flex: 1; min-width: 160px"
                maxlength="300"
                placeholder="what cleared it — e.g. stamp received"
              />
              <button class="btn sm" :disabled="busy">Hold lifted</button>
              <div class="hint" style="flex-basis: 100%">
                Held — {{ j.box.holdReason }}. Lifting the hold keeps the stage and the place;
                confirm the next stage when the box moves.
              </div>
            </form>
            <form
              v-else
              style="display: flex; gap: 6px; flex-wrap: wrap"
              @submit.prevent="saveHold"
            >
              <input
                v-model="hold.place"
                class="f"
                style="flex: 1; min-width: 120px"
                maxlength="120"
                placeholder="where held"
              />
              <input
                v-model="hold.note"
                class="f"
                style="flex: 2; min-width: 160px"
                maxlength="300"
                required
                placeholder="why — e.g. papers missing"
              />
              <button class="btn sm red" :disabled="busy || hold.note.length < 3">Held</button>
            </form>
            <form
              v-if="atOrBeforeRusumo"
              style="display: flex; gap: 6px"
              @submit.prevent="saveReturned"
            >
              <input
                v-model="returned.note"
                class="f"
                style="flex: 1"
                maxlength="300"
                placeholder="returned from the border — why"
              />
              <button class="btn sm red" :disabled="busy">Returned</button>
            </form>
            <form v-if="!j.box.atRisk" style="display: flex; gap: 6px" @submit.prevent="flag">
              <input
                v-model="risk.reason"
                class="f"
                style="flex: 1"
                maxlength="300"
                required
                placeholder="flag at risk — e.g. breakdown at Nyakasanza"
              />
              <button class="btn sm red" :disabled="busy || risk.reason.length < 3">Flag</button>
            </form>
            <form v-else style="display: flex; gap: 6px" @submit.prevent="clear">
              <input
                v-model="risk.note"
                class="f"
                style="flex: 1"
                maxlength="300"
                placeholder="lift the flag — what changed"
              />
              <button class="btn sm ghost" :disabled="busy">Lift the flag</button>
            </form>
            <div class="hint">
              While a box is at risk, every cost dated in that spell is delay-related. The ICD flag
              comes by itself after the free days.
            </div>
          </div>
        </div>

        <div v-if="mayCorrect" class="panel" style="margin: 0">
          <div class="panel-h"><h2>Correct a wrong stage — with a reason</h2></div>
          <form class="pad" style="display: grid; gap: 8px" @submit.prevent="correct">
            <select v-model="correction.stage" class="f" required>
              <option value="" disabled>the stage it is really at</option>
              <option
                v-for="[k, label] in stages"
                :key="k"
                :value="k"
                :disabled="k === j.box.stage"
              >
                {{ label }}
              </option>
            </select>
            <input
              v-model="correction.reason"
              class="f"
              maxlength="300"
              required
              placeholder="why — typed too early, wrong box…"
            />
            <button
              class="btn ghost"
              :disabled="busy || !correction.stage || correction.reason.length < 3"
            >
              Correct
            </button>
            <div class="hint">
              The responsible company follows the corrected stage; the trail keeps before, after and
              the reason.
            </div>
          </form>
        </div>
      </div>
      <div v-else-if="j.box.closed" class="note">
        This box is closed to Finance. The Managing Director can reopen it from Handoff to Finance.
      </div>
      <div v-else-if="!j.mayMove" class="note">
        This box is on the other company's side. You can read its journey, not move it.
      </div>

      <div class="panel">
        <div class="panel-h">
          <h2>Timeline — {{ j.events.length }} entries, nothing ever deleted</h2>
        </div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Happened</th>
              <th>What</th>
              <th>Where / note</th>
              <th>By</th>
              <th>Typed</th>
            </tr>
            <tr v-for="e in j.events" :key="e.id">
              <td class="mono">{{ when(e.happenedAt) }}</td>
              <td>
                <span class="st" :class="kindChip(e.kind)">{{ KIND_TEXT[e.kind] }}</span>
                <b v-if="e.stage && e.kind !== 'UPDATE'"> {{ e.stageLabel }}</b>
                <span v-if="e.handedTo" class="hint"> → handed to {{ e.handedTo }}</span>
              </td>
              <td>
                {{ e.place
                }}<span v-if="e.note" class="hint"> {{ e.place ? '·' : '' }} {{ e.note }}</span>
              </td>
              <td>
                {{ e.by
                }}<span v-if="e.companyName" class="hint">
                  · {{ e.companyName.split(' ')[0] }}</span
                >
              </td>
              <td class="hint">{{ when(e.typedAt) }}</td>
            </tr>
            <tr v-if="!j.events.length">
              <td colspan="5" class="hint">Booked; nothing has happened to it yet.</td>
            </tr>
          </table>
        </div>
        <div v-if="j.riskPeriods.length" class="pad" style="border-top: 1px solid #eef2f7">
          <b style="font-size: 13px">At-risk spells</b>
          <div v-for="p in j.riskPeriods" :key="p.id" class="hint" style="margin-top: 4px">
            {{ p.from }} → {{ p.to ?? 'open' }} ·
            {{ p.source === 'ICD' ? 'ICD free days ran out' : p.reason }} · opened by {{ p.openedBy
            }}<span v-if="p.closedBy">, closed by {{ p.closedBy }}</span>
          </div>
        </div>
      </div>
    </template>

    <div class="note">
      ⓘ Each stage is its own entry with the moment it happened, not a note. A box only moves
      forward; a mistake is corrected with a reason. At the hand-over stage the box leaves one
      company's list and appears on the other's; its costs still sit in the book of whoever paid.
      Transport legs, trucks and drivers come later as their own slice.
    </div>
  </div>
</template>
