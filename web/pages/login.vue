<script setup lang="ts">
/** Two steps: e-mail and password, then the six-digit code that went to the department mailbox. */
const step = ref<1 | 2>(1);
const email = ref('');
const password = ref('');
const challengeId = ref('');
const mailbox = ref('');
const digits = ref(['', '', '', '', '', '']);
const error = ref('');
const busy = ref(false);
const boxes = ref<HTMLInputElement[]>([]);
const { load } = useSession();

async function signIn() {
  error.value = '';
  busy.value = true;
  try {
    const r = await $fetch<{ challengeId: string; mailbox: string }>('/api/auth/login', {
      method: 'POST', body: { email: email.value, password: password.value }, credentials: 'include',
    });
    challengeId.value = r.challengeId;
    mailbox.value = r.mailbox;
    step.value = 2;
    await nextTick();
    boxes.value[0]?.focus();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

function onDigit(i: number, ev: Event) {
  const el = ev.target as HTMLInputElement;
  el.value = el.value.replace(/\D/g, '').slice(-1);
  digits.value[i] = el.value;
  if (el.value && boxes.value[i + 1]) boxes.value[i + 1]!.focus();
  if (digits.value.every((d) => d)) void verify();
}
function onKey(i: number, ev: KeyboardEvent) {
  if (ev.key === 'Backspace' && !digits.value[i] && boxes.value[i - 1]) boxes.value[i - 1]!.focus();
}
function onPaste(ev: ClipboardEvent) {
  const text = (ev.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6);
  if (text.length === 6) {
    ev.preventDefault();
    digits.value = text.split('');
    void verify();
  }
}

async function verify() {
  error.value = '';
  busy.value = true;
  try {
    await $fetch('/api/auth/otp', { method: 'POST', body: { challengeId: challengeId.value, code: digits.value.join('') }, credentials: 'include' });
    await load();
    await navigateTo('/app');
  } catch (e) {
    error.value = errorText(e);
    digits.value = ['', '', '', '', '', ''];
    boxes.value[0]?.focus();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="lgbox">
      <div class="wordmark">OLIU</div>
      <div class="lg-sub">One login per person · the one-time code goes to your department mailbox</div>

      <form v-if="step === 1" @submit.prevent="signIn">
        <div v-if="error" class="err">{{ error }}</div>
        <div class="fld"><label for="email">Work e-mail</label><input id="email" v-model="email" type="email" autocomplete="username" required /></div>
        <div class="fld"><label for="password">Password</label><input id="password" v-model="password" type="password" autocomplete="current-password" required /></div>
        <button class="btn blok" :disabled="busy">Sign in →</button>
        <p class="hint" style="text-align:center;margin-top:10px"><NuxtLink to="/forgot">Forgot password?</NuxtLink> · <NuxtLink to="/setup">Create a new company account</NuxtLink></p>
      </form>

      <div v-else>
        <div style="text-align:center;font-size:32px;margin:2px 0">📧</div>
        <div style="text-align:center;font-weight:800;color:var(--navy);margin-bottom:4px">Check the department mailbox</div>
        <div style="text-align:center;font-size:12.5px;color:var(--muted);margin-bottom:16px">A six-digit code was sent to <span class="mono">{{ mailbox }}</span>. It expires in 10 minutes.</div>
        <div v-if="error" class="err">{{ error }}</div>
        <div class="otp" role="group" aria-label="One-time code">
          <input v-for="i in 6" :key="i" :ref="(el) => (boxes[i - 1] = el as HTMLInputElement)" inputmode="numeric" maxlength="1" :aria-label="`Digit ${i}`" :value="digits[i - 1]" @input="onDigit(i - 1, $event)" @keydown="onKey(i - 1, $event)" @paste="onPaste" />
        </div>
        <button class="btn blok" :disabled="busy" @click="verify">Verify &amp; sign in →</button>
        <p class="hint" style="text-align:center;margin-top:12px"><a href="#" @click.prevent="step = 1">Back</a></p>
      </div>

      <div class="lg-foot">🔒 Individual login · one-time code to the department e-mail · every sign-in is in the audit trail<br />Data hosted in Rwanda · Law 058/2021 · Tanzania PDPA 2022</div>
    </div>
  </div>
</template>
