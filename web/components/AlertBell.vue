<script setup lang="ts">
/**
 * The bell in the top bar: one count of everything that waits for this person, from GET /api/alerts.
 * Opens a short list; each line goes to the screen that deals with it. Refreshes on every live notice.
 */
const api = useApi();
interface Alert {
  kind: string;
  severity: 'bad' | 'warn' | 'info';
  count: number;
  text: string;
  to: string;
}
const data = ref<{ total: number; items: Alert[] }>({ total: 0, items: [] });
const open = ref(false);
async function reload() {
  try {
    data.value = await api<{ total: number; items: Alert[] }>('/api/alerts');
  } catch {
    /* the bell stays as it was; the screens show their own errors */
  }
}
await reload();
useLive().onChange('*', reload, 800);
const route = useRoute();
watch(
  () => route.path,
  () => (open.value = false),
);
</script>

<template>
  <div class="bell-wrap">
    <button
      type="button"
      class="bell"
      :class="{ on: data.total > 0 }"
      :title="data.total ? `${data.total} waiting for you` : 'Nothing waits for you'"
      :aria-label="`Notifications: ${data.total}`"
      @click="open = !open"
    >
      🔔<span v-if="data.total" class="badge">{{ data.total > 99 ? '99+' : data.total }}</span>
    </button>
    <div v-if="open" class="panel-drop">
      <div class="head">
        <b>Waiting for you</b>
        <span class="hint">{{ data.total ? `${data.total} in all` : 'nothing right now' }}</span>
      </div>
      <NuxtLink v-for="a in data.items" :key="a.kind" :to="a.to" class="row" @click="open = false">
        <span class="dot" :class="a.severity"></span>
        <span class="n">{{ a.count }}</span>
        <span class="t">{{ a.text }}</span>
      </NuxtLink>
      <div v-if="!data.items.length" class="row empty">All clear.</div>
    </div>
  </div>
</template>

<style scoped>
.bell-wrap {
  position: relative;
  margin-left: auto;
}
.bell {
  position: relative;
  background: none;
  border: 1px solid var(--line);
  border-radius: 99px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  opacity: 0.55;
}
.bell.on {
  opacity: 1;
}
.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #b23a3a;
  color: #fff;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 6px;
  min-width: 18px;
  text-align: center;
}
.panel-drop {
  position: absolute;
  right: 0;
  top: 44px;
  width: 380px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(22, 36, 58, 0.12);
  z-index: 40;
  overflow: hidden;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #eef2f7;
  color: inherit;
  text-decoration: none;
  font-size: 13px;
}
.row:hover {
  background: #f6f8fb;
}
.row.empty {
  color: var(--muted, #5b6b80);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 99px;
  flex: none;
}
.dot.bad {
  background: #b23a3a;
}
.dot.warn {
  background: #c47a2c;
}
.dot.info {
  background: #8fa3bf;
}
.n {
  font-weight: 700;
  min-width: 22px;
  font-family: Consolas, monospace;
}
</style>
