<script setup lang="ts">
const { me, load } = useSession();
if (!me.value) await load();
await navigateTo(me.value ? '/app' : '/login', { replace: true });
</script>
<template><div /></template>
