<script setup lang="ts">
/**
 * Checks → MD queue. Everything that needs the Managing Director's ruling, in one place: duplicate containers,
 * repeated payments, costs typed after closing or from the other side, the tip cap. What was ruled stays readable.
 */
import type { QueueItem } from './MdQueue.vue';
const api = useApi();
const { can } = useSession();

const showResolved = ref(false);
const items = ref<QueueItem[]>([]);
const error = ref('');

async function reload() {
  error.value = '';
  try {
    items.value = await api<QueueItem[]>(
      `/api/md-queue${showResolved.value ? '?status=RESOLVED' : ''}`,
    );
  } catch (e) {
    error.value = errorText(e);
  }
}
await reload();
watch(showResolved, reload);
useLive().onChange(['shipments', 'costs', 'tips', 'payments'], reload);

const count = (kind: string) => items.value.filter((i) => i.kind === kind).length;
</script>

<template>
  <div>
    <div v-if="!can('reconcile')" class="soon">
      <div style="font-size: 40px">🚫</div>
      <h2>Only the Managing Director rules here</h2>
    </div>
    <template v-else>
      <div v-if="error" class="err">{{ error }}</div>
      <div class="cards">
        <div class="card">
          <div class="lbl">Duplicate containers</div>
          <div class="val">{{ count('DUPLICATE_CONTAINER') }}</div>
          <div class="subt">the same number typed twice</div>
        </div>
        <div class="card">
          <div class="lbl">Repeat payments</div>
          <div class="val">{{ count('REPEAT_PAYMENT') }}</div>
          <div class="subt">same box, fee and payee — blocked before the bank</div>
        </div>
        <div class="card">
          <div class="lbl">Money to rule on</div>
          <div class="val">{{ count('COST_OTHER_SIDE') }}</div>
          <div class="subt">costs and tips typed from the other side</div>
        </div>
        <div class="card">
          <div class="lbl">To note</div>
          <div class="val">{{ count('COST_AFTER_CLOSE') + count('TIP_CAP_80') }}</div>
          <div class="subt">costs after closing, the tip cap at 80 %</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px">
        <label style="font-size: 12.5px">
          <input v-model="showResolved" type="checkbox" /> show what was ruled before
        </label>
      </div>
      <MdQueue
        :items="items"
        :title="showResolved ? 'Ruled — the record, newest first' : undefined"
        @changed="reload"
      />
    </template>
  </div>
</template>
