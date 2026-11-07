<script setup lang="ts">
/**
 * Field payments → Complete tip. The calmer screen: yesterday's tips with what is still missing — who was paid,
 * the stop, the receipt photo — and the tip ledger by person and by box, with the month's cap. A wrong tip is
 * voided with a reason; its lines leave every total and its row stays.
 */
const api = useApi();
const { me, can, canOpen } = useSession();

interface Tip {
  id: string;
  companyName: string;
  booking: { id: string; reference: string };
  date: string;
  currency: string;
  amount: string;
  usd: string;
  reason: string;
  payeeType: string | null;
  payeeTypeLabel: string;
  payeeId: string;
  checkpoint: string;
  stageLabel: string;
  note: string;
  hasPhoto: boolean;
  mdOverride: boolean;
  pendingMd: boolean;
  void: boolean;
  delayRelated: boolean;
  missing: string[];
  boxes: { id: string; number: string; amount: string; status: string }[];
  paidBy: string;
  paidById: string;
}
interface Ledger {
  month: string;
  tips: Tip[];
  byPerson: { id: string; name: string; count: number; usd: string; payeePct: number }[];
  byBox: { id: string; number: string; count: number; usd: string }[];
  totals: { count: number; usd: string };
  cap: { usedUsd: string; capUsd: string; pct: number };
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
const onlyIncomplete = ref(true);
const data = ref<Ledger | null>(null);
const payeeTypes = ref<{ key: string; label: string }[]>([]);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const open = ref<string | null>(null);
const form = reactive({ payeeType: '', payeeId: '', checkpoint: '', note: '' });
const voidReason = ref('');

async function reload() {
  error.value = '';
  try {
    data.value = await api<Ledger>(
      `/api/tips?month=${month.value}${onlyIncomplete.value ? '&incomplete=1' : ''}`,
    );
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
useLive().onChange(['tips', 'costs'], reload);
try {
  payeeTypes.value = (
    await api<{ payeeTypes: { key: string; label: string }[] }>('/api/tips/setup')
  ).payeeTypes;
} catch {
  payeeTypes.value = [
    { key: 'OFFICIAL', label: 'Official at a stop' },
    { key: 'AGENT', label: 'Agent / clearing' },
    { key: 'DRIVER', label: 'Driver' },
    { key: 'OTHER', label: 'Other' },
  ];
}
watch([month, onlyIncomplete], reload);

function edit(t: Tip) {
  open.value = open.value === t.id ? null : t.id;
  Object.assign(form, {
    payeeType: t.payeeType ?? '',
    payeeId: t.payeeId,
    checkpoint: t.checkpoint,
    note: t.note,
  });
  voidReason.value = '';
}
async function run(job: () => Promise<unknown>, done: string) {
  error.value = msg.value = '';
  busy.value = true;
  try {
    await job();
    msg.value = done;
    await reload();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const save = (t: Tip) =>
  run(
    () =>
      api(`/api/tips/${t.id}`, {
        method: 'PATCH',
        body: {
          payeeType: form.payeeType || null,
          payeeId: form.payeeId,
          checkpoint: form.checkpoint,
          note: form.note,
        },
      }),
    'Kept.',
  );
const voidTip = (t: Tip) =>
  run(
    () => api(`/api/tips/${t.id}/void`, { method: 'POST', body: { reason: voidReason.value } }),
    `${t.currency} ${t.amount} voided; its lines leave every total.`,
  ).then(() => (open.value = null));

/** A phone photo is often 4 MB; it is shrunk to at most 1600 px on the phone before it travels. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
async function attach(t: Tip, ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await run(async () => {
    const dataUrl =
      file.size > 1_500_000 || !/^image\/(jpeg|png|webp)$/.test(file.type)
        ? await shrink(file)
        : await new Promise<string>((ok, no) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.onerror = () => no(r.error);
            r.readAsDataURL(file);
          });
    await api(`/api/tips/${t.id}/photo`, { method: 'POST', body: { dataUrl } });
  }, 'Photo attached.');
}
const pretty = (n: string) => [n.slice(0, 4), n.slice(4, 10), n.slice(10)].join(' ');
const mayEdit = (t: Tip) =>
  can('write') && (me.value?.user.role !== 'FIELD_OFFICER' || t.paidById === me.value?.user.id);
</script>

<template>
  <div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div v-if="data" class="cards">
      <div class="card">
        <div class="lbl">Tips · {{ data.month }}</div>
        <div class="val">{{ data.totals.count }}</div>
        <div class="subt">USD {{ data.totals.usd }} · at each tip's own rate</div>
      </div>
      <div class="card">
        <div class="lbl">Monthly cap</div>
        <div class="val" :style="data.cap.pct >= 80 ? 'color: var(--bad)' : ''">
          {{ data.cap.pct }} %
        </div>
        <div class="subt">USD {{ data.cap.usedUsd }} of {{ data.cap.capUsd }}</div>
      </div>
      <div class="card">
        <div class="lbl">Still to complete</div>
        <div class="val">{{ data.tips.filter((t) => t.missing.length && !t.void).length }}</div>
        <div class="subt">missing a payee, a stop or the photo</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>{{ onlyIncomplete ? 'Tips still to complete' : 'Every tip of the month' }}</h2>
        <div class="act">
          <label class="hint" style="display: flex; gap: 4px; align-items: center"
            ><input v-model="onlyIncomplete" type="checkbox" /> only incomplete</label
          >
          <select v-model="month" class="f">
            <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
          </select>
          <NuxtLink v-if="canOpen('tip')" to="/app/tip" class="btn sm">+ Tip</NuxtLink>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Reason · stop</th>
            <th>Boxes</th>
            <th>Paid to</th>
            <th>By</th>
            <th>Missing</th>
            <th></th>
          </tr>
          <template v-for="t in data?.tips ?? []" :key="t.id">
            <tr :style="t.void ? 'opacity: .55' : ''">
              <td class="mono">{{ t.date }}</td>
              <td class="mono">
                <b>{{ t.currency }} {{ t.amount }}</b>
                <div class="hint">
                  ≈ USD {{ t.usd }}<span v-if="t.mdOverride"> · MD code</span
                  ><span v-if="t.delayRelated"> · delay</span>
                </div>
              </td>
              <td>
                {{ t.reason }}
                <div v-if="t.checkpoint" class="hint">{{ t.checkpoint }}</div>
                <div v-else class="hint">{{ t.stageLabel }}</div>
              </td>
              <td>
                <span v-for="b in t.boxes" :key="b.id" class="mono" style="display: block"
                  >{{ pretty(b.number) }} <span class="hint">{{ b.amount }}</span></span
                >
              </td>
              <td>
                {{ t.payeeId || '—' }}
                <div v-if="t.payeeTypeLabel" class="hint">{{ t.payeeTypeLabel }}</div>
              </td>
              <td>
                {{ t.paidBy }}
                <div class="hint">{{ t.companyName.split(' ')[0] }}</div>
              </td>
              <td>
                <span v-if="t.void" class="st st-grey">void</span>
                <span v-else-if="t.pendingMd" class="st st-warn">waiting for the MD</span>
                <template v-else>
                  <span
                    v-for="m in t.missing"
                    :key="m"
                    class="st st-warn"
                    style="margin-right: 3px"
                    >{{ m }}</span
                  >
                  <span v-if="!t.missing.length" class="st st-ok">complete</span>
                </template>
              </td>
              <td style="white-space: nowrap">
                <a
                  v-if="t.hasPhoto"
                  :href="`/api/tips/${t.id}/photo`"
                  target="_blank"
                  class="hint"
                  style="margin-right: 8px"
                  >photo</a
                >
                <button v-if="mayEdit(t) && !t.void" class="btn sm ghost" @click="edit(t)">
                  {{ open === t.id ? 'close' : 'complete' }}
                </button>
              </td>
            </tr>
            <tr v-if="open === t.id">
              <td colspan="8" style="background: #f6f8fa">
                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
                  <select v-model="form.payeeType" class="f">
                    <option value="">who was paid?</option>
                    <option v-for="p in payeeTypes" :key="p.key" :value="p.key">
                      {{ p.label }}
                    </option>
                  </select>
                  <input
                    v-model="form.payeeId"
                    class="f"
                    inputmode="tel"
                    style="width: 190px"
                    placeholder="MoMo / M-Pesa number or name"
                  />
                  <input
                    v-model="form.checkpoint"
                    class="f"
                    style="width: 190px"
                    placeholder="stop — e.g. TRA Nyakanazi"
                  />
                  <input
                    v-model="form.note"
                    class="f"
                    style="flex: 1; min-width: 160px"
                    maxlength="300"
                    placeholder="note"
                  />
                  <button class="btn sm" :disabled="busy" @click="save(t)">Keep</button>
                  <label class="btn sm ghost" style="cursor: pointer">
                    {{ t.hasPhoto ? 'replace photo' : 'attach the receipt photo' }}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style="display: none"
                      @change="attach(t, $event)"
                    />
                  </label>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px">
                  <input
                    v-model="voidReason"
                    class="f"
                    style="width: 280px"
                    maxlength="300"
                    placeholder="wrong tip? why — then void it"
                  />
                  <button
                    class="btn sm red"
                    :disabled="busy || voidReason.trim().length < 3"
                    @click="voidTip(t)"
                  >
                    Void
                  </button>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!data?.tips.length">
            <td colspan="8" class="hint">
              {{ onlyIncomplete ? 'Nothing to complete.' : 'No tip this month.' }}
            </td>
          </tr>
        </table>
      </div>
    </div>

    <div v-if="data && !onlyIncomplete" class="cards" style="grid-template-columns: 1fr 1fr">
      <div class="panel" style="margin: 0">
        <div class="panel-h"><h2>By person — cash paid out of pocket this month</h2></div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Who</th>
              <th>Tips</th>
              <th>USD</th>
              <th>With a payee ID</th>
            </tr>
            <tr v-for="p in data.byPerson" :key="p.id">
              <td>{{ p.name }}</td>
              <td>{{ p.count }}</td>
              <td class="mono">
                <b>{{ p.usd }}</b>
              </td>
              <td>
                <span class="st" :class="p.payeePct >= 95 ? 'st-ok' : 'st-warn'"
                  >{{ p.payeePct }} %</span
                >
              </td>
            </tr>
            <tr v-if="!data.byPerson.length">
              <td colspan="4" class="hint">—</td>
            </tr>
          </table>
        </div>
      </div>
      <div class="panel" style="margin: 0">
        <div class="panel-h"><h2>By box</h2></div>
        <div class="tablewrap">
          <table>
            <tr>
              <th>Container №</th>
              <th>Tips</th>
              <th>USD</th>
            </tr>
            <tr v-for="b in data.byBox" :key="b.id">
              <td class="mono">{{ pretty(b.number) }}</td>
              <td>{{ b.count }}</td>
              <td class="mono">
                <b>{{ b.usd }}</b>
              </td>
            </tr>
            <tr v-if="!data.byBox.length">
              <td colspan="3" class="hint">—</td>
            </tr>
          </table>
        </div>
      </div>
    </div>
    <div class="note">
      ⓘ A tip is a cost line on its box in the "tip" category, at the rate of its own day; the
      container record and the booking total already include it. "Cash in staff hands" as money owed
      to a person arrives with floats in slice 6.
    </div>
  </div>
</template>
