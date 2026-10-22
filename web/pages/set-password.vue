<script setup lang="ts">
/** Reached from the invitation or reset e-mail. The link works once. */
const route = useRoute();
const token = String(route.query.token ?? '');
const password = ref('');
const again = ref('');
const error = ref('');
const done = ref(false);
const busy = ref(false);

async function save() {
  error.value = '';
  if (password.value !== again.value) { error.value = 'The two passwords differ'; return; }
  busy.value = true;
  try {
    await $fetch('/api/auth/set-password', { method: 'POST', body: { token, password: password.value } });
    done.value = true;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="lgbox">
      <div class="wordmark">OLIU</div>
      <div class="lg-sub">Choose your password</div>
      <div v-if="done" class="okmsg">Password saved. <NuxtLink to="/login">Sign in</NuxtLink> with it now.</div>
      <form v-else @submit.prevent="save">
        <div v-if="error" class="err">{{ error }}</div>
        <div class="fld"><label for="p1">New password</label><input id="p1" v-model="password" type="password" autocomplete="new-password" required /><div class="hint">At least 10 characters, mixing lower case with upper case or digits.</div></div>
        <div class="fld"><label for="p2">Again</label><input id="p2" v-model="again" type="password" autocomplete="new-password" required /></div>
        <button class="btn blok" :disabled="busy || !token">Save password</button>
      </form>
    </div>
  </div>
</template>
