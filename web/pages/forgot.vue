<script setup lang="ts">
const email = ref('');
const sent = ref(false);
const busy = ref(false);
async function send() {
  busy.value = true;
  try {
    await $fetch('/api/auth/forgot', { method: 'POST', body: { email: email.value } });
  } finally {
    sent.value = true;
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="lgbox">
      <div class="wordmark">OLIU</div>
      <div class="lg-sub">Forgot your password</div>
      <div v-if="sent" class="okmsg">If that e-mail has a login, a reset link is on its way. It works once and expires in 3 days.</div>
      <form v-else @submit.prevent="send">
        <div class="fld"><label for="email">Work e-mail</label><input id="email" v-model="email" type="email" required /></div>
        <button class="btn blok" :disabled="busy">Send reset link</button>
      </form>
      <p class="hint" style="text-align:center;margin-top:12px"><NuxtLink to="/login">Back to sign in</NuxtLink></p>
    </div>
  </div>
</template>
