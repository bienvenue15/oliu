<script setup lang="ts">
/** The tenant shell: sidebar built from what the API says this role may open, company switcher for all-company roles. */
const { me, activeCompany, logout, can } = useSession();
const { connected: liveOn, connect: liveConnect } = useLive();
onMounted(liveConnect);
const route = useRoute();
const ICONS: Record<string, string> = {
  home: '▦',
  ship: '▣',
  field: '📱',
  pay: '💵',
  inv: '🧾',
  acc: '📒',
  rep: '📊',
  chk: '⚖',
  ntf: '🔔',
  set: '⚙',
};
const title = computed(() => {
  for (const m of me.value?.menus ?? [])
    for (const s of m.screens) if (route.path === `/app/${s.key}`) return s.label;
  return 'Home';
});
const companyName = computed(
  () =>
    me.value?.companies.find((c) => c.id === activeCompany.value)?.legalName ??
    me.value?.account.name ??
    '',
);
</script>

<template>
  <div class="app" v-if="me">
    <aside class="side">
      <div class="logo">
        <b>{{ me.account.name }}</b
        ><span
          >OLIU · {{ me.account.package === 'GROUP' ? 'GROUP ACCOUNT' : 'SINGLE COMPANY' }}</span
        >
      </div>
      <nav class="nav">
        <NuxtLink
          v-for="m in me.menus"
          :key="m.key"
          :to="`/app/${m.screens[0]!.key}`"
          :class="{ active: m.screens.some((s) => route.path === `/app/${s.key}`) }"
        >
          <span style="width: 18px; text-align: center">{{ ICONS[m.key] }}</span
          >{{ m.label }}
          <span v-if="m.screens.every((s) => s.slice > 1)" class="tag"
            >slice
            {{
              Math.min(...m.screens.map((s) => s.slice)) === 99
                ? 'later'
                : Math.min(...m.screens.map((s) => s.slice))
            }}</span
          >
        </NuxtLink>
      </nav>
      <div class="userbox">
        <b>{{ me.user.name }}</b>
        <span style="display: block; opacity: 0.75; margin-top: 2px">{{ me.user.roleLabel }}</span>
        <span class="rolechip">{{ me.user.companyId ? companyName : 'all companies' }}</span>
        <a @click="logout">⎋ Log out</a>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <h1>{{ title }}</h1>
        <select
          v-if="!me.user.companyId && me.companies.length > 1"
          v-model="activeCompany"
          class="sel"
        >
          <option v-for="c in me.companies" :key="c.id" :value="c.id">{{ c.legalName }}</option>
        </select>
        <span v-else class="pill">{{ companyName }}</span>
        <span v-if="!can('write')" class="pill ro">Read-only role</span>
        <span
          class="pill"
          :class="{ ro: !liveOn }"
          :title="
            liveOn
              ? 'Screens update by themselves'
              : 'Reconnecting; screens update again when the dot is blue'
          "
          >● {{ liveOn ? 'live' : 'offline' }}</span
        >
        <AlertBell />
      </div>
      <div class="content"><slot /></div>
    </div>
  </div>
</template>
