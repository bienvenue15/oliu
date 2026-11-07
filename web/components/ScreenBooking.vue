<script setup lang="ts">
/**
 * Shipments → New booking. The person who makes the booking types the shipping line's number and the boxes.
 * Four fields are required: line, booking №, client, cargo. The boxes may follow later ("6 x 40FT expected");
 * everything the line tells you afterwards (vessel, ETD, BL …) is a fill-later field.
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
  fileNumber: string;
  reference: string;
  count: number;
  expected: number;
  duplicates: { number: string; existingBooking: string }[];
  notes: string[];
}

const lines = ref<Line[]>([]);
const clients = ref<Client[]>([]);
const blankForm = () => ({
  shippingLineId: '',
  reference: '',
  clientId: '',
  cargo: '',
  status: 'CONFIRMED' as 'CONFIRMED' | 'PENDING',
  confirmedOn: new Date().toISOString().slice(0, 10),
  expectedCount: 0,
  expectedSize: '40FT',
  destination: '',
  vessel: '',
  voyage: '',
  pol: '',
  pod: '',
  etd: '',
  eta: '',
  blNumber: '',
});
const form = reactive(blankForm());
const later = ref(false);
const blank = (): Row => ({ number: '', size: '40FT', lot: '', existing: null });
const rows = ref<Row[]>([blank()]);
const error = ref('');
const saved = ref<Saved | null>(null);
const busy = ref(false);

const line = computed(() => lines.value.find((l) => l.id === form.shippingLineId));
const check = (r: Row) => (r.number.trim() ? checkContainerNumber(r.number) : null);
const filled = computed(() => rows.value.filter((r) => r.number.trim()));
const numbersValid = computed(() => filled.value.every((r) => check(r)?.ok));
const allValid = computed(
  () => numbersValid.value && (filled.value.length > 0 || Number(form.expectedCount) > 0),
);
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
useLive().onChange(['shipments'], load);

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
      booking: { fileNumber: string; reference: string; expectedCount: number };
      containers: unknown[];
      duplicates: Saved['duplicates'];
      notes: string[];
    }>('/api/bookings', {
      method: 'POST',
      body: {
        ...form,
        expectedCount: Number(form.expectedCount) || 0,
        confirmedOn: form.status === 'CONFIRMED' ? form.confirmedOn : '',
        containers: filled.value.map((r) => ({ number: r.number, size: r.size, lot: r.lot })),
      },
    });
    saved.value = {
      fileNumber: res.booking.fileNumber,
      reference: res.booking.reference,
      count: res.containers.length,
      expected: res.booking.expectedCount,
      duplicates: res.duplicates,
      notes: res.notes,
    };
    rows.value = [blank()];
    const keep = another ? { shippingLineId: form.shippingLineId, clientId: form.clientId } : {};
    Object.assign(form, blankForm(), keep);
    if (!form.shippingLineId && lines.value[0]) form.shippingLineId = lines.value[0].id;
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
        >File {{ saved.fileNumber }} · booking {{ saved.reference }} saved with {{ saved.count }}
        {{ saved.count === 1 ? 'box' : 'boxes'
        }}<template v-if="saved.expected > saved.count">
          · {{ saved.expected }} expected, add the numbers as they arrive</template
        >.</b
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
          <div class="act hint">the file number is given when you save</div>
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
              maxlength="20"
              pattern="[A-Za-z0-9]{6,20}"
              title="6 to 20 letters and digits, no spaces or symbols"
              placeholder="as the line gave it"
              style="text-transform: uppercase"
            />
            <span v-if="line?.referenceHint" class="hint"
              >{{ line.name }}: {{ line.referenceHint }}</span
            >
            <span v-else class="hint"
              >letters and digits only, 6 to 20, exactly as the line gave it</span
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
            <label class="f">Status with the line</label>
            <select v-model="form.status" class="f">
              <option value="CONFIRMED">Confirmed — typed from the confirmation</option>
              <option value="PENDING">Pending — asked, not yet confirmed</option>
            </select>
          </div>
          <div v-if="form.status === 'CONFIRMED'">
            <label class="f">Confirmed on</label>
            <input v-model="form.confirmedOn" class="f mono" type="date" />
          </div>
          <div>
            <label class="f">Boxes agreed with the line (if the numbers are not known yet)</label>
            <div style="display: flex; gap: 8px">
              <input
                v-model="form.expectedCount"
                class="f mono"
                type="number"
                min="0"
                max="100"
                style="width: 90px"
              />
              <select v-model="form.expectedSize" class="f" style="width: 110px">
                <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <span class="hint">leave 0 when you type the numbers below</span>
          </div>
        </div>

        <div class="pad" style="padding-bottom: 0">
          <a class="hint" style="cursor: pointer" @click="later = !later"
            >{{ later ? '▾' : '▸' }} What the line tells you later — vessel, voyage, ports, dates,
            BL № (all optional, can be filled from the Containers list)</a
          >
        </div>
        <div v-if="later" class="form-grid" style="padding-top: 8px">
          <div>
            <label class="f">Vessel</label
            ><input
              v-model="form.vessel"
              class="f"
              maxlength="80"
              placeholder="e.g. KOTA SETIA"
              style="text-transform: uppercase"
            />
          </div>
          <div>
            <label class="f">Voyage</label
            ><input
              v-model="form.voyage"
              class="f"
              maxlength="40"
              style="text-transform: uppercase"
            />
          </div>
          <div>
            <label class="f">Port of loading</label
            ><input v-model="form.pol" class="f" maxlength="80" placeholder="e.g. Dar es Salaam" />
          </div>
          <div>
            <label class="f">Port of discharge</label
            ><input v-model="form.pod" class="f" maxlength="80" placeholder="e.g. Ningbo" />
          </div>
          <div>
            <label class="f">Destination</label
            ><input
              v-model="form.destination"
              class="f"
              maxlength="120"
              placeholder="e.g. Ningbo, China"
            />
          </div>
          <div>
            <label class="f">BL №</label
            ><input
              v-model="form.blNumber"
              class="f mono"
              maxlength="40"
              style="text-transform: uppercase"
            />
          </div>
          <div>
            <label class="f">ETD — estimated departure</label
            ><input v-model="form.etd" class="f mono" type="date" />
          </div>
          <div>
            <label class="f">ETA — estimated arrival</label
            ><input v-model="form.eta" class="f mono" type="date" />
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
          Numbers not known yet? Leave the rows empty and say how many boxes were agreed above; add
          each number from the Containers list when it arrives. Paste a whole column of numbers into
          a box to fill one row each. A number that already exists anywhere in the account is never
          silently accepted: both entries go side by side to the Managing Director.
        </div>
        <div class="pad" style="display: flex; gap: 8px">
          <button class="btn" :disabled="!allValid || busy">Save booking</button>
          <button type="button" class="btn ghost" :disabled="!allValid || busy" @click="save(true)">
            Save &amp; add another
          </button>
          <span class="hint" style="align-self: center"
            >{{ filled.length }} {{ filled.length === 1 ? 'box' : 'boxes' }} typed<template
              v-if="Number(form.expectedCount) > filled.length"
            >
              · {{ form.expectedCount }} agreed</template
            >
            ·
            {{
              !numbersValid
                ? 'fix the numbers marked ✗'
                : allValid
                  ? 'ready'
                  : 'type the numbers, or how many boxes were agreed'
            }}</span
          >
        </div>
      </div>
    </form>
    <div class="note">
      ⓘ Everything after the four required fields can be filled in later from the Containers list.
      Costs, stages and legs come in the next slices.
    </div>
  </div>
</template>
