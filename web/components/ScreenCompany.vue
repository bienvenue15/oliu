<script setup lang="ts">
/** Settings → Company & subscription (slice 1: the companies and their bank accounts). */
import { CURRENCIES } from '@oliu/shared';
const api = useApi();
const { me, can } = useSession();
interface Bank { id: string; bank: string; number: string; currency: string; swift: string }
interface Co { id: string; legalName: string; country: string; currency: string; tin: string; address: string; kind: string; billsClient: boolean; parent: { legalName: string } | null; bankAccounts: Bank[] }
interface Acct { id: string; name: string; package: string; handoverStage: string | null; status: string; companies: Co[] }
const account = ref<Acct | null>(null);
const error = ref('');
const msg = ref('');
const editing = ref<string | null>(null);
const edit = ref({ legalName: '', tin: '', address: '' });
const addingBank = ref<string | null>(null);
const bank = ref({ bank: '', number: '', currency: 'RWF', swift: '' });

async function reload() { account.value = await api<Acct>('/api/account'); }
await reload();

function startEdit(c: Co) { editing.value = c.id; edit.value = { legalName: c.legalName, tin: c.tin, address: c.address }; }
async function saveEdit(c: Co) {
  error.value = msg.value = '';
  try { await api(`/api/companies/${c.id}`, { method: 'PATCH', body: edit.value }); editing.value = null; msg.value = 'Saved.'; await reload(); }
  catch (e) { error.value = errorText(e); }
}
async function saveBank(c: Co) {
  error.value = msg.value = '';
  try { await api(`/api/companies/${c.id}/banks`, { method: 'POST', body: bank.value }); addingBank.value = null; bank.value = { bank: '', number: '', currency: c.currency, swift: '' }; msg.value = 'Bank account added.'; await reload(); }
  catch (e) { error.value = errorText(e); }
}
const kindLabel: Record<string, string> = { MAIN: 'Main company', BRANCH: 'Branch', PARTNER: 'Partnering company' };
const stageLabel: Record<string, string> = { BOOKED: 'Booked', TRANSPORT: 'Transport', FIELD_RELEASE: 'Field release', RUSUMO: 'Rusumo border', CHECKPOINTS: 'Checkpoints', ICD: 'ICD', PORT: 'Port', OCEAN_FREIGHT: 'Ocean freight' };
</script>

<template>
  <div v-if="account">
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>
    <div class="panel">
      <div class="panel-h"><h2>Account — structure chosen at set-up</h2></div>
      <div class="pad kv">
        <b>Name</b><span>{{ account.name }}</span>
        <b>Package</b><span>{{ account.package === 'GROUP' ? 'Group — companies working as one, each with its own book' : 'Single company' }}</span>
        <b v-if="account.handoverStage">Hand-over</b><span v-if="account.handoverStage">{{ stageLabel[account.handoverStage] }} — the responsible company flips here</span>
        <b>Status</b><span class="st st-ok">{{ account.status.toLowerCase() }}</span>
      </div>
    </div>

    <div v-for="c in account.companies" :key="c.id" class="panel">
      <div class="panel-h">
        <h2>{{ c.legalName }} <span class="st st-cop" style="margin-left:6px">{{ kindLabel[c.kind] }}</span> <span v-if="c.billsClient" class="st st-ok" style="margin-left:4px">bills the client</span> <span v-if="c.parent" class="hint" style="margin-left:6px">branch of {{ c.parent.legalName }}</span></h2>
        <div class="act" v-if="can('users')"><button v-if="editing !== c.id" class="btn ghost sm" @click="startEdit(c)">Edit</button></div>
      </div>
      <form v-if="editing === c.id" class="form-grid" @submit.prevent="saveEdit(c)">
        <div><label class="f">Legal name</label><input v-model="edit.legalName" class="f" required /></div>
        <div><label class="f">TIN</label><input v-model="edit.tin" class="f" /></div>
        <div class="full"><label class="f">Address</label><input v-model="edit.address" class="f" /></div>
        <div class="full" style="margin-top:10px"><button class="btn">Save</button> <button type="button" class="btn ghost" @click="editing = null">Cancel</button></div>
      </form>
      <div v-else class="pad kv">
        <b>Country · currency</b><span>{{ c.country }} · {{ c.currency }}</span>
        <b>TIN</b><span>{{ c.tin || '—' }}</span>
        <b>Address</b><span>{{ c.address || '—' }}</span>
      </div>
      <template v-if="c.kind !== 'BRANCH'">
        <div class="panel-h" style="border-top:1px solid var(--line)"><h2>Bank accounts — print on invoices</h2><div class="act" v-if="can('users')"><button class="btn ghost sm" @click="addingBank = addingBank === c.id ? null : c.id; bank.currency = c.currency">+ Bank account</button></div></div>
        <form v-if="addingBank === c.id" class="form-grid" @submit.prevent="saveBank(c)">
          <div><label class="f">Bank</label><input v-model="bank.bank" class="f" required /></div>
          <div><label class="f">Account number</label><input v-model="bank.number" class="f" required /></div>
          <div><label class="f">Currency</label><select v-model="bank.currency" class="f"><option v-for="k in CURRENCIES" :key="k" :value="k">{{ k }}</option></select></div>
          <div><label class="f">SWIFT</label><input v-model="bank.swift" class="f" /></div>
          <div class="full" style="margin-top:10px"><button class="btn">Add</button></div>
        </form>
        <div class="tablewrap"><table>
          <tr><th>Bank</th><th>Number</th><th>Currency</th><th>SWIFT</th></tr>
          <tr v-for="b in c.bankAccounts" :key="b.id"><td>{{ b.bank }}</td><td class="mono">{{ b.number }}</td><td>{{ b.currency }}</td><td class="mono">{{ b.swift || '—' }}</td></tr>
          <tr v-if="!c.bankAccounts.length"><td colspan="4" class="hint">No bank account yet.</td></tr>
        </table></div>
      </template>
      <div v-else class="pad hint">A branch keeps the same book and bank accounts as {{ c.parent?.legalName }}.</div>
    </div>
    <div class="note">ⓘ Changing a bank account will need a second person's approval (four-eyes) from the Payments slice onward. Subscription details come with the owner portal.</div>
  </div>
</template>
