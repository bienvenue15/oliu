<script setup lang="ts">
/**
 * Create an account — the set-up questions, answered once.
 * Slice 1 asks only what slice 1 stores: how many companies work together, each company's basics,
 * who bills the client, where the container changes hands, and the owner's login.
 */
import { COUNTRIES, CURRENCIES, STAGES } from '@oliu/shared';

interface Co { legalName: string; country: string; currency: string; tin: string; address: string; kind: 'MAIN' | 'BRANCH' | 'PARTNER'; parentIndex?: number; billsClient: boolean }
const accountName = ref('');
const pkg = ref<'SINGLE' | 'GROUP'>('SINGLE');
const handoverStage = ref<string>('RUSUMO');
const companies = ref<Co[]>([{ legalName: '', country: 'RW', currency: 'RWF', tin: '', address: '', kind: 'MAIN', billsClient: true }]);
const owner = ref({ name: '', email: '', password: '' });
const error = ref('');
const busy = ref(false);
const done = ref(false);

const stageLabel: Record<string, string> = { BOOKED: 'Booked', TRANSPORT: 'Transport', FIELD_RELEASE: 'Field release', RUSUMO: 'Rusumo border', CHECKPOINTS: 'Checkpoints', ICD: 'ICD', PORT: 'Port', OCEAN_FREIGHT: 'Ocean freight' };

function addCompany(kind: 'BRANCH' | 'PARTNER') {
  companies.value.push({ legalName: '', country: kind === 'PARTNER' ? 'TZ' : 'RW', currency: kind === 'PARTNER' ? 'TZS' : 'RWF', tin: '', address: '', kind, parentIndex: kind === 'BRANCH' ? 0 : undefined, billsClient: false });
  if (kind === 'PARTNER') pkg.value = 'GROUP';
}
function remove(i: number) {
  companies.value.splice(i, 1);
  if (!companies.value.some((c) => c.kind === 'PARTNER')) pkg.value = 'SINGLE';
}
function setBiller(i: number) {
  companies.value.forEach((c, k) => (c.billsClient = k === i));
}
const parents = computed(() => companies.value.map((c, i) => ({ i, c })).filter((x) => x.c.kind !== 'BRANCH'));

async function create() {
  error.value = '';
  busy.value = true;
  try {
    await $fetch('/api/accounts', {
      method: 'POST',
      body: { accountName: accountName.value, package: pkg.value, handoverStage: pkg.value === 'GROUP' ? handoverStage.value : null, companies: companies.value, owner: owner.value },
    });
    done.value = true;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login" style="align-items:flex-start;padding-top:40px">
    <div class="lgbox" style="width:760px">
      <div class="wordmark">OLIU</div>
      <div class="lg-sub">Set up your company account · answers are settings you can change later</div>
      <div v-if="done" class="okmsg">Account created. <NuxtLink to="/login">Sign in</NuxtLink> as the Managing Director with the e-mail and password you chose.</div>
      <form v-else @submit.prevent="create">
        <div v-if="error" class="err">{{ error }}</div>

        <div class="fld"><label for="an">1 · Name of the account (what you call the business)</label><input id="an" v-model="accountName" required placeholder="e.g. OLIU · JIVAH" /></div>

        <div class="fld">
          <label>2 · The companies that work together</label>
          <div class="hint" style="margin-bottom:8px">One company, or several. An office abroad is either a <b>branch</b> of a company (same book) or a <b>partnering company</b> (its own book and bank accounts). {{ pkg === 'GROUP' ? 'This is a group account.' : 'This is a single-company account.' }}</div>
          <div v-for="(c, i) in companies" :key="i" class="cobox">
            <h4>{{ c.kind === 'MAIN' ? 'Main company' : c.kind === 'BRANCH' ? 'Branch' : 'Partnering company' }} <button v-if="i > 0" type="button" class="btn sm red" style="float:right" @click="remove(i)">Remove</button></h4>
            <div class="form-grid" style="padding:0">
              <div><label class="f">Legal name</label><input v-model="c.legalName" class="f" required /></div>
              <div v-if="c.kind === 'BRANCH'"><label class="f">Branch of</label><select v-model="c.parentIndex" class="f"><option v-for="p in parents" :key="p.i" :value="p.i">{{ p.c.legalName || `company ${p.i + 1}` }}</option></select></div>
              <div><label class="f">Country</label><select v-model="c.country" class="f"><option v-for="k in COUNTRIES" :key="k" :value="k">{{ k }}</option></select></div>
              <div><label class="f">Book currency</label><select v-model="c.currency" class="f"><option v-for="k in CURRENCIES" :key="k" :value="k">{{ k }}</option></select></div>
              <div v-if="c.kind !== 'BRANCH'"><label class="f">TIN</label><input v-model="c.tin" class="f" /></div>
              <div class="full"><label class="f">Address</label><input v-model="c.address" class="f" /></div>
              <div v-if="c.kind !== 'BRANCH'" class="full"><label class="f"><input type="radio" name="biller" :checked="c.billsClient" @change="setBiller(i)" /> This company bills the client</label></div>
            </div>
          </div>
          <button type="button" class="btn ghost sm" @click="addCompany('BRANCH')">+ Add a branch</button>
          <button type="button" class="btn ghost sm" style="margin-left:6px" @click="addCompany('PARTNER')">+ Add a partnering company</button>
        </div>

        <div v-if="pkg === 'GROUP'" class="fld">
          <label for="hs">3 · Where does a container change hands between the companies?</label>
          <select id="hs" v-model="handoverStage"><option v-for="s in STAGES" :key="s" :value="s">{{ stageLabel[s] }}</option></select>
          <div class="hint">At that stage the responsible company flips: the box leaves one side's working list and appears on the other's.</div>
        </div>

        <div class="fld">
          <label>{{ pkg === 'GROUP' ? '4' : '3' }} · You, the owner (Managing Director)</label>
          <div class="form-grid" style="padding:0">
            <div><label class="f">Name</label><input v-model="owner.name" class="f" required /></div>
            <div><label class="f">E-mail</label><input v-model="owner.email" class="f" type="email" required /></div>
            <div class="full"><label class="f">Password</label><input v-model="owner.password" class="f" type="password" autocomplete="new-password" required /><div class="hint">At least 10 characters. Your one-time codes go to this e-mail until you set a management mailbox.</div></div>
          </div>
        </div>

        <button class="btn blok" :disabled="busy">Create the account</button>
        <p class="hint" style="text-align:center;margin-top:12px"><NuxtLink to="/login">Back to sign in</NuxtLink></p>
      </form>
    </div>
  </div>
</template>
