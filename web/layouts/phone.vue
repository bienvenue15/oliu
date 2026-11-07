<script setup lang="ts">
/**
 * The phone shell for the installable tip page: no sidebar, big type, the person's name and a way back to
 * the full app. Registers the service worker that keeps the page usable with no signal.
 */
const { me, logout } = useSession();
onMounted(() => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
});
</script>

<template>
  <div class="phone">
    <header class="top">
      <b>OLIU · tips</b>
      <span v-if="me" class="who">{{ me.user.name }}</span>
      <NuxtLink to="/app/tiplat" class="lnk">Complete</NuxtLink>
      <NuxtLink to="/app" class="lnk">App</NuxtLink>
      <a class="lnk" @click="logout">Out</a>
    </header>
    <main class="body"><slot /></main>
  </div>
</template>

<style scoped>
.phone {
  min-height: 100vh;
  background: var(--bg, #f3f5f8);
}
.top {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  background: var(--navy);
  color: #fff;
  font-size: 14px;
  position: sticky;
  top: 0;
  z-index: 2;
}
.who {
  flex: 1;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lnk {
  color: #fff;
  text-decoration: none;
  opacity: 0.85;
  font-weight: 700;
  cursor: pointer;
}
.body {
  padding: 12px 14px 40px;
}
</style>
