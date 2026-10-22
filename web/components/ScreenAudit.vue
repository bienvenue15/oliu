<script setup lang="ts">
/** Checks → Audit trail. Read-only, newest first, filter by module. */
const api = useApi();
interface Ev { id: number; at: string; userName: string; module: string; action: string; entity: string; entityId: string | null; before: unknown; after: unknown; ip: string }
const rows = ref<Ev[]>([]);
const moduleFilter = ref('');
const open = ref<number | null>(null);
async function reload(before?: number) {
  const q = new URLSearchParams();
  if (moduleFilter.value) q.set('module', moduleFilter.value);
  if (before) q.set('before', String(before));
  const page = await api<Ev[]>(`/api/audit?${q}`);
  rows.value = before ? [...rows.value, ...page] : page;
}
await reload();
watch(moduleFilter, () => reload());
const fmt = (d: string) => new Date(d).toLocaleString();
</script>

<template>
  <div>
    <div class="panel">
      <div class="panel-h"><h2>Audit trail — who did what; cannot be edited or deleted by anyone</h2>
        <div class="act"><select v-model="moduleFilter" class="sel"><option value="">All modules</option><option value="identity">Logins</option><option value="accounts">Accounts &amp; people</option></select></div></div>
      <div class="tablewrap"><table>
        <tr><th>When</th><th>Who</th><th>Module</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
        <template v-for="r in rows" :key="r.id">
          <tr @click="open = open === r.id ? null : r.id" style="cursor:pointer">
            <td class="mono">{{ fmt(r.at) }}</td><td>{{ r.userName }}</td><td>{{ r.module }}</td><td><span class="st st-info">{{ r.action.replaceAll('_', ' ') }}</span></td>
            <td class="mono">{{ r.entity }}<span v-if="r.entityId" class="hint"> · {{ r.entityId.slice(0, 8) }}</span></td>
            <td class="hint">{{ r.before || r.after ? 'click to see' : '' }}</td>
          </tr>
          <tr v-if="open === r.id"><td colspan="6"><div class="pad" style="background:#f6f8fa;border-radius:8px"><div v-if="r.before"><b>Before</b><pre class="mono">{{ JSON.stringify(r.before, null, 2) }}</pre></div><div v-if="r.after"><b>After</b><pre class="mono">{{ JSON.stringify(r.after, null, 2) }}</pre></div><div class="hint">from {{ r.ip || 'unknown address' }}</div></div></td></tr>
        </template>
        <tr v-if="!rows.length"><td colspan="6" class="hint">Nothing recorded yet.</td></tr>
      </table></div>
      <div class="pad" v-if="rows.length >= 50"><button class="btn ghost sm" @click="reload(rows[rows.length - 1]!.id)">Older</button></div>
    </div>
  </div>
</template>
