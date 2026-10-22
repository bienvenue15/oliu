<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });
const { me } = useSession();
await navigateTo(`/app/${me.value?.home ?? 'dash'}`, { replace: true });
</script>
<template><div /></template>
