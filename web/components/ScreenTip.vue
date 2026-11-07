<script setup lang="ts">
/**
 * Field payments → Tip entry. Three taps: the box (or boxes), a reason, the amount. Save. Nothing else is
 * required; payee, checkpoint and the photo follow from Complete tip. The booking is remembered from the last
 * entry. With no signal the tip waits in the outbox and goes when a connection appears. Used standing up:
 * big buttons, few words. The same screen is the installable phone page at /tip.
 */
import { CURRENCIES, formatMoney, parseMoney, type Currency } from '@oliu/shared';
const api = useApi();
const outbox = useTipOutbox();

interface Box {
  id: string;
  number: string;
  size: string;
  stage: string;
  stageLabel: string;
  place: string;
}
interface Bk {
  id: string;
  reference: string;
  fileNumber: string;
  client: string;
  containers: Box[];
}
interface Setup {
  bookings: Bk[];
  reasons: { id: string; label: string }[];
  payeeTypes: { key: string; label: string }[];
  currency: string;
  companyName: string;
  figures: { tipCeilingUsdCents: number; tipCapUsdCents: number };
  cap: { month: string; usedUsdCents: number; usedUsd: string; capUsd: string; pct: number };
  ceilingUsd: string;
}
interface Saved {
  id: string;
  amount: string;
  currency: string;
  usd: string;
  reason: string;
  boxes: { number: string; amount: string }[];
  cap: Setup['cap'];
  pendingMd: boolean;
  repeated?: boolean;
}

const SETUP_KEY = 'oliu.tip.setup';
const BOOKING_KEY = 'oliu.tip.booking';
const setup = ref<Setup | null>(null);
const fromCache = ref(false);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const saved = ref<Saved | null>(null);
const needCode = ref<{ message: string } | null>(null);
const codeSent = ref('');

const bookingId = ref('');
const picked = ref<Set<string>>(new Set());
const reasonId = ref('');
const amount = ref('');
const currency = ref<Currency>('RWF');
const more = reactive({ open: false, payeeType: '', payeeId: '', checkpoint: '' });
const mdCode = ref('');

async function loadSetup() {
  try {
    setup.value = await api<Setup>('/api/tips/setup');
    fromCache.value = false;
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(setup.value));
    } catch {
      /* no storage: fine */
    }
  } catch {
    try {
      const cached = localStorage.getItem(SETUP_KEY);
      if (cached) {
        setup.value = JSON.parse(cached) as Setup;
        fromCache.value = true;
      }
    } catch {
      /* nothing cached */
    }
    if (!setup.value)
      error.value =
        'No connection and nothing kept on this phone yet. Open this screen once with signal.';
  }
  if (setup.value) {
    currency.value = (setup.value.currency as Currency) ?? 'RWF';
    const remembered = localStorage.getItem(BOOKING_KEY) ?? '';
    bookingId.value = setup.value.bookings.some((b) => b.id === remembered)
      ? remembered
      : (setup.value.bookings[0]?.id ?? '');
  }
}
useLive().onChange(['tips', 'shipments', 'journey'], loadSetup);
onMounted(async () => {
  outbox.load();
  await loadSetup();
  if (outbox.online.value && outbox.items.value.length) await syncNow();
  window.addEventListener('online', () => syncNow());
});

const booking = computed(() => setup.value?.bookings.find((b) => b.id === bookingId.value) ?? null);
watch(bookingId, (id) => {
  picked.value = new Set();
  try {
    localStorage.setItem(BOOKING_KEY, id);
  } catch {
    /* fine */
  }
});
function toggle(id: string) {
  const s = new Set(picked.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  picked.value = s;
}
const totalMinor = computed(() => (amount.value ? parseMoney(amount.value, currency.value) : null));
const taps = computed(
  () => (picked.value.size ? 1 : 0) + (reasonId.value ? 1 : 0) + (totalMinor.value ? 1 : 0),
);
const share = computed(() =>
  totalMinor.value && picked.value.size > 1
    ? formatMoney(Math.floor(totalMinor.value / picked.value.size), currency.value)
    : '',
);
const reasonLabel = computed(
  () => setup.value?.reasons.find((r) => r.id === reasonId.value)?.label ?? '',
);
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

function body(clientId: string, withCode?: string) {
  return {
    clientId,
    containerIds: [...picked.value],
    reasonId: reasonId.value,
    currency: currency.value,
    totalMinor: totalMinor.value,
    date: today(),
    ...(more.payeeType ? { payeeType: more.payeeType } : {}),
    payeeId: more.payeeId,
    checkpoint: more.checkpoint,
    ...(withCode ? { mdCode: withCode } : {}),
  };
}
function reset() {
  picked.value = new Set();
  reasonId.value = '';
  amount.value = '';
  Object.assign(more, { open: false, payeeType: '', payeeId: '', checkpoint: '' });
  mdCode.value = '';
  needCode.value = null;
  codeSent.value = '';
}
const pendingClientId = ref('');

async function save(withCode?: string) {
  if (taps.value < 3 || !totalMinor.value) return;
  error.value = msg.value = '';
  busy.value = true;
  const clientId = pendingClientId.value || crypto.randomUUID();
  pendingClientId.value = clientId;
  const payload = body(clientId, withCode);
  const label = `${currency.value} ${formatMoney(totalMinor.value, currency.value)} · ${reasonLabel.value} · ${[...picked.value].map((id) => pretty(booking.value?.containers.find((c) => c.id === id)?.number ?? '')).join(', ')}`;
  try {
    if (!outbox.online.value) throw Object.assign(new Error('offline'), { offline: true });
    saved.value = await api<Saved>('/api/tips', { method: 'POST', body: payload });
    if (setup.value) setup.value.cap = saved.value.cap;
    msg.value = saved.value.pendingMd
      ? 'Saved, but the box is on the other side: the tip waits for the Managing Director before it counts.'
      : `Saved. ${saved.value.boxes.length > 1 ? `${saved.value.boxes.length} lines, one per box.` : ''}`;
    pendingClientId.value = '';
    reset();
  } catch (e) {
    const err = e as { data?: { needsMdCode?: boolean; error?: string }; offline?: boolean };
    if (err.data?.needsMdCode) {
      needCode.value = {
        message: err.data.error ?? 'The Managing Director must agree to this tip.',
      };
    } else if (err.offline || outbox.isNetworkFailure(e)) {
      outbox.add({ clientId, body: payload, label, queuedAt: new Date().toISOString() });
      msg.value = 'No signal: saved on this phone. It goes by itself when the connection is back.';
      pendingClientId.value = '';
      reset();
    } else error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function askCode() {
  error.value = '';
  try {
    const r = await api<{ sentTo: string; expiresInMinutes: number }>('/api/tips/md-code', {
      method: 'POST',
      body: { amount: `${currency.value} ${amount.value}`, reason: reasonLabel.value },
    });
    codeSent.value = `A code went to ${r.sentTo}; it works for ${r.expiresInMinutes} minutes. Ask for it by voice.`;
  } catch (e) {
    error.value = errorText(e);
  }
}
async function syncNow() {
  const r = await outbox.sync(api);
  if (r.sent) {
    msg.value = `${r.sent} waiting tip${r.sent === 1 ? '' : 's'} sent.`;
    await loadSetup();
  }
}
</script>

<template>
  <div class="tip">
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="bar">
      <span :class="['st', outbox.online.value ? 'st-ok' : 'st-warn']">{{
        outbox.online.value ? 'online' : 'offline · saves on the phone'
      }}</span>
      <span v-if="setup" class="hint">
        cap {{ setup.cap.pct }} % used · {{ setup.cap.usedUsd }} of {{ setup.cap.capUsd }} USD this
        month
        <span v-if="fromCache"> · list kept from the last visit</span>
      </span>
      <span
        v-if="outbox.items.value.length"
        class="st st-warn"
        style="cursor: pointer"
        @click="syncNow"
        >{{ outbox.items.value.length }} waiting · send</span
      >
    </div>

    <template v-if="setup">
      <div v-if="setup.bookings.length > 1" class="row">
        <button
          v-for="b in setup.bookings"
          :key="b.id"
          class="chip"
          :class="{ on: b.id === bookingId }"
          @click="bookingId = b.id"
        >
          {{ b.reference }} <small>{{ b.client }}</small>
        </button>
      </div>
      <div v-else-if="booking" class="hint">
        Booking {{ booking.reference }} · {{ booking.client }}
      </div>

      <div class="step">
        <b>1</b> Tap the box{{ booking && booking.containers.length > 1 ? 'es' : '' }}
        <span class="hint">several if they clear together — the amount is split</span>
      </div>
      <div class="grid">
        <button
          v-for="c in booking?.containers ?? []"
          :key="c.id"
          class="tile"
          :class="{ on: picked.has(c.id) }"
          @click="toggle(c.id)"
        >
          <span class="mono big">{{ pretty(c.number) }}</span>
          <small>{{ c.place || c.stageLabel }}</small>
        </button>
        <div v-if="!booking?.containers.length" class="hint">
          No live box on your side. Open this screen with signal once a booking has boxes.
        </div>
      </div>

      <div class="step"><b>2</b> Why</div>
      <div class="row">
        <button
          v-for="r in setup.reasons"
          :key="r.id"
          class="chip"
          :class="{ on: r.id === reasonId }"
          @click="reasonId = r.id"
        >
          {{ r.label }}
        </button>
      </div>

      <div class="step"><b>3</b> How much</div>
      <div class="row" style="align-items: stretch">
        <select v-model="currency" class="f" style="width: 90px; font-size: 18px">
          <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <input
          v-model="amount"
          class="f mono"
          inputmode="decimal"
          style="flex: 1; min-width: 0; font-size: 26px; font-weight: 700"
          placeholder="20,000"
        />
      </div>
      <div v-if="amount && totalMinor === null" class="st st-bad">
        not an amount in {{ currency }}
      </div>
      <div v-else-if="share" class="hint">
        {{ picked.size }} boxes · about {{ currency }} {{ share }} each
      </div>

      <button class="btn blok save" :disabled="busy || taps < 3" @click="save()">
        Save · {{ taps }} of 3
      </button>

      <details :open="more.open" @toggle="more.open = ($event.target as HTMLDetailsElement).open">
        <summary class="hint">Add now, or later from Complete tip: who was paid, where</summary>
        <div class="row" style="margin-top: 8px">
          <button
            v-for="p in setup.payeeTypes"
            :key="p.key"
            class="chip"
            :class="{ on: more.payeeType === p.key }"
            @click="more.payeeType = more.payeeType === p.key ? '' : p.key"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="row">
          <input
            v-model="more.payeeId"
            class="f"
            inputmode="tel"
            style="flex: 1"
            placeholder="MoMo / M-Pesa number or name"
          />
          <input
            v-model="more.checkpoint"
            class="f"
            style="flex: 1"
            placeholder="stop — e.g. TRA Nyakanazi"
          />
        </div>
      </details>

      <div v-if="needCode" class="panel code">
        <div class="pad">
          <b>{{ needCode.message }}</b>
          <div class="row" style="margin-top: 8px">
            <button class="btn ghost" :disabled="busy" @click="askCode">
              Ask the Managing Director for a code
            </button>
            <input
              v-model="mdCode"
              class="f mono"
              inputmode="numeric"
              maxlength="6"
              style="width: 120px; font-size: 20px"
              placeholder="6 digits"
            />
            <button class="btn" :disabled="busy || !/^\d{6}$/.test(mdCode)" @click="save(mdCode)">
              Save with the code
            </button>
          </div>
          <div v-if="codeSent" class="hint">{{ codeSent }}</div>
        </div>
      </div>

      <div v-if="saved" class="panel">
        <div class="pad">
          <b>Last saved:</b> {{ saved.currency }} {{ saved.amount }} · {{ saved.reason }}
          <span v-for="b in saved.boxes" :key="b.number" class="mono hint" style="margin-left: 8px"
            >{{ pretty(b.number) }} {{ b.amount }}</span
          >
          <div class="hint">
            ≈ USD {{ saved.usd }} · cap now {{ saved.cap.pct }} % ·
            <NuxtLink to="/app/tiplat">complete it later</NuxtLink>
          </div>
        </div>
      </div>

      <div v-if="outbox.items.value.length" class="panel">
        <div class="panel-h">
          <h2>Waiting on this phone — {{ outbox.items.value.length }}</h2>
          <div class="act">
            <button class="btn sm ghost" :disabled="outbox.syncing.value" @click="syncNow">
              Send now
            </button>
          </div>
        </div>
        <div
          v-for="q in outbox.items.value"
          :key="q.clientId"
          class="pad"
          style="border-top: 1px solid #eef2f7; font-size: 13px"
        >
          {{ q.label }}
          <span class="hint"
            >· typed
            {{
              new Date(q.queuedAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })
            }}</span
          >
          <div v-if="q.error" class="st st-bad" style="margin-top: 4px">
            refused: {{ q.error }}
            <a style="cursor: pointer; margin-left: 6px" @click="outbox.remove(q.clientId)"
              >drop it</a
            >
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tip {
  max-width: 560px;
}
.bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.step {
  font-size: 13px;
  font-weight: 800;
  color: var(--navy);
  margin: 14px 0 6px;
}
.step b {
  display: inline-block;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--navy);
  color: #fff;
  text-align: center;
  line-height: 22px;
  margin-right: 6px;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.chip {
  border: 1.5px solid var(--line);
  background: #fff;
  border-radius: 99px;
  padding: 10px 16px;
  font-size: 15px;
  font-weight: 700;
  color: var(--navy);
  cursor: pointer;
}
.chip small {
  display: block;
  font-weight: 500;
  color: var(--muted);
  font-size: 11px;
}
.chip.on {
  background: var(--navy);
  border-color: var(--navy);
  color: #fff;
}
.chip.on small {
  color: #d8e0ea;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.tile {
  border: 2px solid var(--line);
  background: #fff;
  border-radius: 12px;
  padding: 12px 10px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tile .big {
  font-size: 15px;
  font-weight: 800;
}
.tile small {
  color: var(--muted);
  font-size: 11.5px;
}
.tile.on {
  border-color: var(--copper);
  background: var(--copper-bg);
}
.save {
  margin-top: 14px;
  font-size: 18px;
  padding: 16px;
}
.code {
  border-color: var(--warn);
  margin-top: 12px;
}
</style>
