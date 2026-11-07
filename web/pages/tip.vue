<script setup lang="ts">
/** The installable phone page: Field payments → Tip entry without the sidebar. Add it to the home screen from the browser menu. */
definePageMeta({ layout: 'phone', middleware: 'auth' });
useHead({
  title: 'OLIU tips',
  link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
  meta: [
    { name: 'theme-color', content: '#16283c' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
  ],
});
</script>

<template>
  <ScreenTip />
</template>
