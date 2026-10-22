<script setup lang="ts">
import type { Component } from 'vue';
/**
 * One route for every screen key of the mockup. Slice 1 builds three of them (adm, sub, aud);
 * every other key shows which slice brings it, so nobody wonders whether a menu is broken.
 */
import ScreenUsers from '~/components/ScreenUsers.vue';
import ScreenCompany from '~/components/ScreenCompany.vue';
import ScreenAudit from '~/components/ScreenAudit.vue';
definePageMeta({ layout: 'app', middleware: 'auth' });
const route = useRoute();
const { me } = useSession();
const key = computed(() => String(route.params.screen));
const screen = computed(() => {
  for (const m of me.value?.menus ?? []) for (const s of m.screens) if (s.key === key.value) return { ...s, menu: m };
  return null;
});
const built: Record<string, Component> = { adm: ScreenUsers, sub: ScreenCompany, aud: ScreenAudit };
</script>

<template>
  <div>
    <div v-if="!screen" class="soon">
      <div style="font-size:40px">🚫</div>
      <h2>This screen is not visible to your role</h2>
      <p>Signed in as {{ me?.user.name }} · {{ me?.user.roleLabel }}.</p>
    </div>
    <template v-else>
      <div v-if="screen.menu.screens.length > 1" class="sub">
        <NuxtLink v-for="s in screen.menu.screens" :key="s.key" :to="`/app/${s.key}`" :class="{ on: s.key === key }">{{ s.label }}</NuxtLink>
      </div>
      <component :is="built[key]" v-if="built[key]" />
      <div v-else class="soon">
        <div style="font-size:40px">🚧</div>
        <h2>{{ screen.label }}</h2>
        <p>{{ screen.slice === 99 ? 'Comes as its own slice after the import.' : `Switched on by slice ${screen.slice} of the build road.` }} Nothing to do here yet.</p>
      </div>
    </template>
  </div>
</template>
