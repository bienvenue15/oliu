<script setup lang="ts">
/**
 * Payments → Pay (the Finance Officer). Approved orders only: pay, record the bank or MoMo reference, lock.
 * No changing the amount, no raising a new order here. Below: what was just locked, and the cash in staff hands.
 */
import type { Board, Payment } from './ScreenPayQueue.vue';
const api = useApi();
const { can } = useSession();

const board = ref<Board | null>(null);
const error = ref('');
const msg = ref('');
const busy = ref(false);
const refs = ref<Record<string, string>>({});
const banks = ref<Record<string, string>>({});

async function reload() {
  error.value = '';
  try {
    board.value = await api<Board>('/api/payments');
    for (const p of toPay.value)
      if (banks.value[p.id] === undefined)
        banks.value[p.id] = board.value.banks.find((b) => b.currency === p.currency)?.id ?? '';
  } catch (e) {
    error.value = errorText(e);
  }
}
const toPay = computed(() => board.value?.open.filter((p) => p.status === 'APPROVED') ?? []);
const locked = computed(() => board.value?.done.filter((p) => p.status === 'PAID') ?? []);
await reload();
useLive().onChange(['payments'], reload);

async function pay(p: Payment) {
  error.value = msg.value = '';
  busy.value = true;
  try {
    await api(`/api/payments/${p.id}/pay`, {
      method: 'POST',
      body: { reference: refs.value[p.id], bankAccountId: banks.value[p.id] || null },
    });
    msg.value = `${p.number} paid and locked. Nothing on it changes again.`;
    await reload();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
</script>

<template>
  <div>
    <div class="cards">
      <div class="card">
        <div class="lbl">Ready to pay</div>
        <div class="val">{{ toPay.length }}</div>
        <div class="subt">approved orders only</div>
      </div>
      <div class="card">
        <div class="lbl">Locked this month</div>
        <div class="val">{{ board?.totals.paidThisMonth ?? 0 }}</div>
        <div class="subt">USD {{ board?.totals.paidUsd ?? '0.00' }}</div>
      </div>
      <div class="card">
        <div class="lbl">Cash in staff hands</div>
        <div class="val">{{ board?.floats.length ?? 0 }}</div>
        <div class="subt">floats, advanced minus settled</div>
      </div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div class="panel">
      <div class="panel-h">
        <h2>Approved — ready to pay</h2>
        <span class="hint" style="margin-left: auto">pay, type the reference, lock</span>
      </div>
      <div v-if="!toPay.length" class="pad hint">Nothing approved waits for payment.</div>
      <div v-for="p in toPay" :key="p.id" class="pad" style="border-bottom: 1px solid #eef2f7">
        <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline">
          <b class="mono">{{ p.number }}</b>
          <span class="st st-grey">{{ p.kindLabel }}</span>
          <span>{{ p.purpose }}</span>
          <span class="hint"
            >approved by {{ p.approvedBy }}<span v-if="p.approvedWithCode"> with their code</span> ·
            requested by {{ p.requestedBy }}</span
          >
        </div>
        <div
          style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 4px"
        >
          <span
            >{{ p.beneficiary.name }}
            <span class="hint">{{ p.beneficiary.bank }} {{ p.beneficiary.number }}</span></span
          >
          <b class="mono">{{ p.currency }} {{ p.amount }}</b>
          <span class="hint mono">≈ USD {{ p.usd }}</span>
          <span v-if="p.beneficiary.hold" class="st st-bad">{{ p.beneficiary.hold }}</span>
        </div>
        <form
          v-if="can('pay')"
          style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px"
          @submit.prevent="pay(p)"
        >
          <select v-model="banks[p.id]" class="f" style="width: 260px">
            <option value="">cash / MoMo wallet</option>
            <option v-for="b in board!.banks" :key="b.id" :value="b.id">{{ b.label }}</option>
          </select>
          <input
            v-model="refs[p.id]"
            class="f mono"
            style="width: 200px"
            maxlength="80"
            placeholder="bank / MoMo reference"
            required
          />
          <button
            class="btn sm"
            :disabled="busy || (refs[p.id] ?? '').trim().length < 2 || !!p.beneficiary.hold"
          >
            Mark paid &amp; lock
          </button>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>Just locked — this month</h2></div>
      <div v-if="!locked.length" class="pad hint">Nothing paid yet this month.</div>
      <div class="tablewrap" v-else>
        <table>
          <tr>
            <th>Ref</th>
            <th>Beneficiary</th>
            <th>Amount</th>
            <th>Bank / MoMo ref</th>
            <th>Locked</th>
          </tr>
          <tr v-for="p in locked" :key="p.id">
            <td class="mono">
              {{ p.number }}
              <div class="hint">{{ p.purpose }}</div>
            </td>
            <td>{{ p.beneficiary.name }}</td>
            <td class="mono">{{ p.currency }} {{ p.amount }}</td>
            <td class="mono">
              {{ p.paidRef }}
              <div v-if="p.paidFrom" class="hint">{{ p.paidFrom }}</div>
            </td>
            <td>{{ p.paidBy }} · {{ fmt(p.lockedAt) }} <span class="st st-ok">🔒 locked</span></td>
          </tr>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-h">
        <h2>Cash in staff hands — floats</h2>
        <span class="hint" style="margin-left: auto"
          >drops the moment a settlement is approved</span
        >
      </div>
      <div v-if="!board?.floats.length" class="pad hint">No float advanced yet.</div>
      <div class="tablewrap" v-else>
        <table>
          <tr>
            <th>Holder</th>
            <th>Currency</th>
            <th>Advanced</th>
            <th>Settled</th>
            <th>In hands</th>
            <th>≈ USD</th>
          </tr>
          <tr v-for="f in board!.floats" :key="f.beneficiaryId + f.currency">
            <td>{{ f.holder }}</td>
            <td>{{ f.currency }}</td>
            <td class="mono">{{ f.advanced }}</td>
            <td class="mono">{{ f.settled }}</td>
            <td class="mono">
              <b>{{ f.inHand }}</b>
            </td>
            <td class="mono">{{ f.inHandUsd }}</td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>
