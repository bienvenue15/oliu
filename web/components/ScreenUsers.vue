<script setup lang="ts">
/** Settings → User management. The MD invites, suspends, reactivates and re-invites; others see their colleagues. */
import { ROLES, ROLE_LABEL, ROLES_SPANNING_ALL_COMPANIES } from '@oliu/shared';
const api = useApi();
const { me, can } = useSession();
interface U { id: string; name: string; email: string; role: string; companyId: string | null; otpMailbox: string; status: string }
const users = ref<U[]>([]);
const error = ref('');
const msg = ref('');
const showForm = ref(false);
const form = ref({ name: '', email: '', role: 'FIELD_OFFICER', companyId: me.value?.companies[0]?.id ?? null as string | null, otpMailbox: '' });
const spansAll = computed(() => ROLES_SPANNING_ALL_COMPANIES.includes(form.value.role as never));
const companyName = (id: string | null) => (id ? me.value?.companies.find((c) => c.id === id)?.legalName ?? 'other company' : 'All companies');

async function reload() {
  users.value = await api<U[]>('/api/users');
}
await reload();

async function invite() {
  error.value = msg.value = '';
  try {
    await api('/api/users', { method: 'POST', body: { ...form.value, companyId: spansAll.value ? null : form.value.companyId, otpMailbox: form.value.otpMailbox || undefined } });
    msg.value = `Invitation sent to ${form.value.email}.`;
    showForm.value = false;
    form.value = { name: '', email: '', role: 'FIELD_OFFICER', companyId: me.value?.companies[0]?.id ?? null, otpMailbox: '' };
    await reload();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function act(u: U, action: 'suspend' | 'reactivate' | 'reinvite') {
  error.value = msg.value = '';
  try {
    await api(`/api/users/${u.id}/${action}`, { method: 'POST' });
    msg.value = action === 'reinvite' ? `New invitation sent to ${u.email}.` : `${u.name} ${action === 'suspend' ? 'suspended' : 'reactivated'}.`;
    await reload();
  } catch (e) {
    error.value = errorText(e);
  }
}
const statusClass: Record<string, string> = { ACTIVE: 'st-ok', INVITED: 'st-info', SUSPENDED: 'st-bad' };
</script>

<template>
  <div>
    <div class="cards">
      <div class="card"><div class="lbl">People</div><div class="val">{{ users.length }}</div><div class="subt">{{ users.filter((u) => u.status === 'ACTIVE').length }} active · {{ users.filter((u) => u.status === 'INVITED').length }} invited · {{ users.filter((u) => u.status === 'SUSPENDED').length }} suspended</div></div>
      <div class="card"><div class="lbl">Roles</div><div class="val">6</div><div class="subt">fixed; nothing else to configure</div></div>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="msg" class="okmsg">{{ msg }}</div>

    <div v-if="can('users')" class="panel">
      <div class="panel-h"><h2>Invite someone</h2><div class="act"><button class="btn sm" @click="showForm = !showForm">{{ showForm ? 'Close' : '+ Invite by e-mail' }}</button></div></div>
      <form v-if="showForm" class="form-grid" @submit.prevent="invite">
        <div><label class="f">Name</label><input v-model="form.name" class="f" required /></div>
        <div><label class="f">Work e-mail</label><input v-model="form.email" class="f" type="email" required /></div>
        <div><label class="f">Role</label><select v-model="form.role" class="f"><option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option></select></div>
        <div><label class="f">Company</label>
          <select v-if="!spansAll" v-model="form.companyId" class="f"><option v-for="c in me!.companies" :key="c.id" :value="c.id">{{ c.legalName }}</option></select>
          <input v-else class="f" value="All companies (this role spans the account)" disabled />
        </div>
        <div class="full"><label class="f">Department mailbox for one-time codes (optional)</label><input v-model="form.otpMailbox" class="f" type="email" placeholder="e.g. finance@oliulogistics.rw — the person's own e-mail if empty" /></div>
        <div class="full" style="margin-top:10px"><button class="btn">Send invitation</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-h"><h2>People — one role, one company each</h2></div>
      <div class="tablewrap"><table>
        <tr><th>Person</th><th>Role</th><th>Company</th><th>Code mailbox</th><th>Status</th><th v-if="can('users')"></th></tr>
        <tr v-for="u in users" :key="u.id">
          <td><b>{{ u.name }}</b><br /><span class="hint">{{ u.email }}</span></td>
          <td>{{ ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] }}</td>
          <td>{{ companyName(u.companyId) }}</td>
          <td class="mono">{{ u.otpMailbox }}</td>
          <td><span class="st" :class="statusClass[u.status]">{{ u.status.toLowerCase() }}</span></td>
          <td v-if="can('users')" style="white-space:nowrap">
            <template v-if="u.id !== me!.user.id">
              <button v-if="u.status === 'SUSPENDED'" class="btn sm" @click="act(u, 'reactivate')">Reactivate</button>
              <button v-else class="btn sm red" @click="act(u, 'suspend')">Suspend</button>
              <button v-if="u.status === 'INVITED'" class="btn sm ghost" style="margin-left:6px" @click="act(u, 'reinvite')">Re-send invitation</button>
            </template>
            <span v-else class="hint">you</span>
          </td>
        </tr>
      </table></div>
    </div>
    <div class="note">ⓘ A suspended person is refused at the next sign-in and the attempt is kept in the audit trail. Only the Managing Director can reactivate. Nobody can change their own access.</div>
  </div>
</template>
