<script setup lang="ts">
/**
 * Shipments → New booking. The person who makes the booking types the shipping line's number and the boxes.
 * The check digit is verified as you type; a number the account already holds is saved beside its twin and
 * goes to the MD — never silently accepted, never refused.
 */
import { CARGO_SUGGESTIONS, CONTAINER_SIZES, checkContainerNumber } from '@oliu/shared';
const api = useApi();
const { me, activeCompany } = useSession();
interface Line {
  id: string;
  name: string;
  usualPrefixes: string[];
  referenceHint: string;
  referencePattern: string;
}
interface Client {
  id: string;
  name: string;
  legalName: string;
}
interface Row {
  number: string;
  size: string;
  lot: string;
  existing: string | null;
}
interface Saved {
  reference: string;
  count: number;
  duplicates: { number: string; existingBooking: string }[];
  notes: string[];
}

const lines = ref<Line[]>([]);
const clients = ref<Client[]>([]);
const form = reactive({
  shippingLineId: '',
  reference: '',
  clientId: '',
  cargo: '',
  destination: '',
  vessel: '',
  voyage: '',
});
const blank = (): Row => ({ number: '', size: '40FT', lot: '', existing: null });
const rows = ref<Row[]>([blank()]);
const error = ref('');
const saved = ref<Saved | null>(null);
const busy = ref(false);

const line = computed(() => lines.value.find((l) => l.id === form.shippingLineId));
const check = (r: Row) => (r.number.trim() ? checkContainerNumber(r.number) : null);
const filled = computed(() => rows.value.filter((r) => r.number.trim()));
const allValid = computed(() => filled.value.length > 0 && filled.value.every((r) => check(r)?.ok));
const prefixNote = (r: Row) => {
  const c = check(r);
  if (!c?.ok || !line.value?.usualPrefixes.length) return '';
  return line.value.usualPrefixes.includes(c.number.slice(0, 4))
    ? ''
    : `owner code ${c.number.slice(0, 4)} is unusual for ${line.value.name}`;
};
const companyName = computed(
  () =>
    me.value?.companies.find((c) => c.id === (me.value?.user.companyId ?? activeCompany.value))
      ?.legalName ?? '',
);

async function load() {
  [lines.value, clients.value] = await Promise.all([
    api<Line[]>('/api/shipping-lines'),
    api<Client[]>('/api/clients'),
  ]);
  if (!form.shippingLineId && lines.value[0]) form.shippingLineId = lines.value[0].id;
}
await load();

/** Asks the API whether the account already holds this number, so the person knows before saving. */
async function lookUp(r: Row) {
  r.existing = null;
  const c = check(r);
  if (!c?.ok) return;
  try {
    const res = await api<{ existing: { bookingReference: string; companyName: string } | null }>(
      `/api/containers/check?number=${c.number}`,
    );
    r.existing = res.existing
      ? `${res.existing.bookingReference} (${res.existing.companyName})`
      : null;
  } catch {
    /* the save will say */
  }
}

function addRow() {
  rows.value.push(blank());
}
function removeRow(i: number) {
  rows.value.splice(i, 1);
  if (rows.value.length === 0) rows.value.push(blank());
}
/** Pasting a column of numbers from a paper or a sheet fills one row per number. */
function onPaste(e: ClipboardEvent, i: number) {
  const parts = (e.clipboardData?.getData('text') ?? '')
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return;
  e.preventDefault();
  parts.forEach((p, k) => {
    while (rows.value.length <= i + k) rows.value.push(blank());
    const target = rows.value[i + k]!;
    target.number = p;
    void lookUp(target);
  });
}

async function save(another: boolean) {
  error.value = '';
  saved.value = null;
  busy.value = true;
  try {
    const res = await api<{
      booking: { reference: string };
      containers: unknown[];
      duplicates: Saved['duplicates'];
      notes: string[];
    }>('/api/bookings', {
      method: 'POST',
      body: {
        ...form,
        containers: filled.value.map((r) => ({ number: r.number, size: r.size, lot: r.lot })),
      },
    });
    saved.value = {
      reference: res.booking.reference,
      count: res.containers.length,
      duplicates: res.duplicates,
      notes: res.notes,
    };
    rows.value = [blank()];
    form.reference = '';
    if (!another) Object.assign(form, { cargo: '', destination: '', vessel: '', voyage: '' });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

// Adding a shipping line or a client without leaving the form.
const newLine = reactive({
  open: false,
  name: '',
  usualPrefixes: '',
  referenceHint: '',
  referencePattern: '',
});
const newClient = reactive({
  open: false,
  name: '',
  legalName: '',
  tin: '',
  address: '',
  country: '',
});
async function addLine() {
  error.value = '';
  try {
    const { open: _o, ...body } = newLine;
    const l = await api<Line>('/api/shipping-lines', {
      method: 'POST',
      body: { ...body, usualPrefixes: body.usualPrefixes.split(/[\s,]+/).filter(Boolean) },
    });
    await load();
    form.shippingLineId = l.id;
    Object.assign(newLine, {
      open: false,
      name: '',
      usualPrefixes: '',
      referenceHint: '',
      referencePattern: '',
    });
  } catch (e) {
    error.value = errorText(e);
  }
}
async function addClient() {
  error.value = '';
  try {
    const { open: _o, ...body } = newClient;
    const c = await api<Client>('/api/clients', { method: 'POST', body });
    await load();
    form.clientId = c.id;
    Object.assign(newClient, {
      open: false,
      name: '',
      legalName: '',
      tin: '',
      address: '',
      country: '',
    });
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="saved" class="okmsg">
      <b
        >Booking {{ saved.reference }} saved with {{ saved.count }}
        {{ saved.count === 1 ? 'box' : 'boxes' }}.</b
      >
      <div v-for="d in saved.duplicates" :key="d.number" style="margin-top: 4px">
        ⚖ {{ d.number }} already exists on booking {{ d.existingBooking }} — both entries are now
        with the Managing Director.
      </div>
      <div v-for="n in saved.notes" :key="n" class="hint" style="margin-top: 4px">ⓘ {{ n }}</div>
      <div style="margin-top: 6px">
        <NuxtLink to="/app/cont">Open the Containers list →</NuxtLink>
      </div>
    </div>

    <form @submit.prevent="save(false)">
      <div class="panel">
        <div class="panel-h">
          <h2>Booking — made by {{ companyName }}</h2>
        </div>
        <div class="form-grid">
          <div>
            <label class="f"
              >1 · Shipping line — first, because it decides the booking № shape</label
            >
            <select v-model="form.shippingLineId" class="f" required>
              <option v-for="l in lines" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
            <a class="hint" style="cursor: pointer" @click="newLine.open = !newLine.open">{{
              newLine.open ? 'close' : '+ add a shipping line'
            }}</a>
          </div>
          <div>
            <label class="f">2 · Booking №</label>
            <input
              v-model="form.reference"
              class="f mono"
              required
              maxlength="40"
              placeholder="as the line gave it"
              style="text-transform: uppercase"
            />
            <span v-if="line?.referenceHint" class="hint"
              >{{ line.name }}: {{ line.referenceHint }}</span
            >
          </div>
          <div>
            <label class="f">3 · Client</label>
            <select v-model="form.clientId" class="f" required>
              <option value="" disabled>choose…</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">
                {{ c.name }}<template v-if="c.legalName"> — {{ c.legalName }}</template>
              </option>
            </select>
            <a class="hint" style="cursor: pointer" @click="newClient.open = !newClient.open">{{
              newClient.open ? 'close' : '+ new client'
            }}</a>
          </div>
          <div>
            <label class="f">4 · Cargo</label>
            <input
              v-model="form.cargo"
              class="f"
              required
              maxlength="60"
              list="cargo-suggestions"
              placeholder="e.g. TANTALITE"
              style="text-transform: uppercase"
            />
            <datalist id="cargo-suggestions">
              <option v-for="c in CARGO_SUGGESTIONS" :key="c" :value="c" />
            </datalist>
          </div>
          <div>
            <label class="f">Destination (optional)</label
            ><input
              v-model="form.destination"
              class="f"
              maxlength="120"
              placeholder="e.g. Ningbo, China"
            />
          </div>
          <div>
            <label class="f">Vessel (optional, fill later if unknown)</label
            ><input
              v-model="form.vessel"
              class="f"
              maxlength="80"
              placeholder="e.g. KOTA SETIA"
              style="text-transform: uppercase"
            />
          </div>
          <div>
            <label class="f">Voyage (optional)</label
            ><input
              v-model="form.voyage"
              class="f"
              maxlength="40"
              style="text-transform: uppercase"
            />
          </div>
        </div>

        <div
          v-if="newLine.open"
          class="form-grid"
          style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6ebf0"
        >
          <div>
            <label class="f">Shipping line name</label><input v-model="newLine.name" class="f" />
          </div>
          <div>
            <label class="f">Usual owner codes (optional, e.g. PCIU PIDU)</label
            ><input
              v-model="newLine.usualPrefixes"
              class="f mono"
              style="text-transform: uppercase"
            />
          </div>
          <div>
            <label class="f">What its booking numbers look like (optional)</label
            ><input
              v-model="newLine.referenceHint"
              class="f"
              placeholder="e.g. 4 letters + 7 digits"
            />
          </div>
          <div>
            <label class="f">Pattern to enforce (optional, a regular expression)</label
            ><input
              v-model="newLine.referencePattern"
              class="f mono"
              placeholder="e.g. ^[A-Z]{4}\d{7}$"
            />
          </div>
          <div class="full">
            <button type="button" class="btn sm" @click="addLine">Add shipping line</button>
          </div>
        </div>
        <div
          v-if="newClient.open"
          class="form-grid"
          style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6ebf0"
        >
          <div>
            <label class="f">Short name (on screens)</label
            ><input v-model="newClient.name" class="f" placeholder="e.g. Space Mining" />
          </div>
          <div>
            <label class="f">Legal name (on invoices)</label
            ><input v-model="newClient.legalName" class="f" />
          </div>
          <div>
            <label class="f">TIN (optional)</label><input v-model="newClient.tin" class="f mono" />
          </div>
          <div>
            <label class="f">Country (optional, two letters)</label
            ><input
              v-model="newClient.country"
              class="f mono"
              maxlength="2"
              style="text-transform: uppercase"
            />
          </div>
          <div class="full">
            <label class="f">Address (optional)</label
            ><input v-model="newClient.address" class="f" />
          </div>
          <div class="full">
            <button type="button" class="btn sm" @click="addClient">Add client</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-h">
          <h2>Containers on this booking</h2>
          <div class="act">
            <button type="button" class="btn sm ghost" @click="addRow">+ Add container</button>
          </div>
        </div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Container №</th>
              <th>ISO 6346 check</th>
              <th>Size</th>
              <th>Lot № (as on the paper)</th>
              <th></th>
            </tr>
            <tr v-for="(r, i) in rows" :key="i">
              <td style="width: 200px">
                <input
                  v-model="r.number"
                  class="f mono"
                  maxlength="16"
                  placeholder="PCIU 932093 6"
                  style="text-transform: uppercase"
                  @blur="lookUp(r)"
                  @paste="onPaste($event, i)"
                />
              </td>
              <td>
                <template v-if="check(r)">
                  <span v-if="check(r)!.ok" class="st st-ok">✓ check digit valid</span>
                  <span v-else class="st st-bad">✗ {{ check(r)!.reason }}</span>
                  <div v-if="r.existing" class="hint" style="margin-top: 4px">
                    ⚖ already on booking {{ r.existing }} — will go to the MD
                  </div>
                  <div v-else-if="prefixNote(r)" class="hint" style="margin-top: 4px">
                    ⓘ {{ prefixNote(r) }}
                  </div>
                </template>
                <span v-else class="hint">type a number — verified as you type</span>
              </td>
              <td style="width: 110px">
                <select v-model="r.size" class="f">
                  <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>
              <td>
                <input
                  v-model="r.lot"
                  class="f mono"
                  maxlength="60"
                  placeholder="e.g. SM/AB/2026-09B-006"
                />
              </td>
              <td><button type="button" class="btn sm ghost" @click="removeRow(i)">✕</button></td>
            </tr>
          </table>
        </div>
        <div class="pad hint">
          Paste a whole column of numbers into a box to fill one row each. A number that already
          exists anywhere in the account is never silently accepted: both entries go side by side to
          the Managing Director.
        </div>
        <div class="pad" style="display: flex; gap: 8px">
          <button class="btn" :disabled="!allValid || busy">Save booking</button>
          <button type="button" class="btn ghost" :disabled="!allValid || busy" @click="save(true)">
            Save &amp; add another
          </button>
          <span class="hint" style="align-self: center"
            >{{ filled.length }} {{ filled.length === 1 ? 'box' : 'boxes' }} ·
            {{ allValid ? 'ready' : 'fix the numbers marked ✗' }}</span
          >
        </div>
      </div>
    </form>
    <div class="note">
      ⓘ Vessel, voyage and destination may be filled in later from the Containers list. Costs,
      stages and legs come in the next slices; a booking is a list of boxes and nothing more.
    </div>
  </div>
</template>
