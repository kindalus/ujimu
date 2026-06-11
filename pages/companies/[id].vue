<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface CompanyMembership {
  email: string
  role: 'admin' | 'member'
}

interface CompanyDetail {
  company: { id: string; nif: string; name: string; phone: string; address: string }
  role: 'admin' | 'member'
  subscription?: { seats: number; currentPeriodEnd: string }
  memberships: CompanyMembership[]
}

interface CompanyQuota {
  weekly: { limit: number; used: number; resetAt: string }
}

const route = useRoute()
const companyId = ref('')
const detail = ref<CompanyDetail | null>(null)
const quota = ref<CompanyQuota | null>(null)
const memberships = ref<CompanyMembership[]>([])
const newEmail = ref('')
const newRole = ref<'admin' | 'member'>('member')
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const seats = computed(() => detail.value?.subscription?.seats ?? 0)
const memberLimit = computed(() => seats.value + Math.floor(seats.value * 0.10))
const weeklyLimit = computed(() => quota.value?.weekly.limit ?? seats.value * 5000)
const weeklyUsed = computed(() => quota.value?.weekly.used ?? 0)
const usagePercent = computed(() => {
  if (weeklyLimit.value <= 0) return '0%'
  return `${Math.min(100, (weeklyUsed.value / weeklyLimit.value) * 100).toFixed(1)}%`
})
const usageLabel = computed(() => usagePercent.value.replace('.', ','))
const periodEndLabel = computed(() => formatDisplayDate(detail.value?.subscription?.currentPeriodEnd))

onMounted(() => {
  companyId.value = readRouteCompanyId()
  void loadCompany()
})

async function loadCompany(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}`)
    if (!response.ok) {
      errorMessage.value = response.status === 401 ? 'Tem de iniciar sessão.' : 'Empresa não encontrada.'
      return
    }
    detail.value = (await response.json()) as CompanyDetail
    memberships.value = [...detail.value.memberships]
    quota.value = detail.value.role === 'admin' ? await loadCompanyQuota() : null
    if (detail.value.role !== 'admin') {
      errorMessage.value = 'A sua conta não tem permissões de administrador na empresa activa. Mude de empresa no menu lateral ou contacte o administrador da sua empresa.'
    }
  } catch {
    errorMessage.value = 'Não foi possível carregar a empresa.'
  } finally {
    loading.value = false
  }
}

async function loadCompanyQuota(): Promise<CompanyQuota | null> {
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/quota`)
  return response.ok ? ((await response.json()) as CompanyQuota) : null
}

async function addAccount(): Promise<void> {
  const email = newEmail.value.trim().toLowerCase()
  if (!email) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorMessage.value = `«${email}» não é um email válido.`
    return
  }
  if (memberships.value.some((membership) => membership.email === email)) {
    errorMessage.value = `A conta ${email} já está especificada.`
    return
  }
  if (memberships.value.length + 1 > memberLimit.value) {
    errorMessage.value = `Limite atingido: a subscrição de ${seats.value} utilizadores permite especificar no máximo ${memberLimit.value} contas (lugares + 10%, contando com administradores). Aumente o número de utilizadores para adicionar mais.`
    return
  }

  await saveMemberships([...memberships.value, { email, role: newRole.value }], 'Conta adicionada.')
  newEmail.value = ''
  newRole.value = 'member'
}

async function removeAccount(email: string): Promise<void> {
  await saveMemberships(memberships.value.filter((membership) => membership.email !== email), 'Conta removida.')
}

async function toggleRole(email: string): Promise<void> {
  await saveMemberships(
    memberships.value.map((membership) => membership.email === email
      ? { ...membership, role: membership.role === 'admin' ? 'member' : 'admin' }
      : membership),
    'Permissões actualizadas.'
  )
}

async function saveMemberships(nextMemberships: CompanyMembership[], message: string): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        admins: nextMemberships.filter((membership) => membership.role === 'admin').map((membership) => membership.email),
        members: nextMemberships.filter((membership) => membership.role === 'member').map((membership) => membership.email)
      })
    })
    if (!response.ok) throw new Error('Não foi possível guardar os utilizadores da Empresa.')

    const payload = (await response.json()) as { memberships: CompanyMembership[] }
    memberships.value = payload.memberships
    feedback.value = message
    void loadCompany()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Operação rejeitada.'
  } finally {
    pending.value = false
  }
}

function readRouteCompanyId(): string {
  const raw = route.params.id
  return decodeURIComponent(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '')
}

function formatDisplayDate(value: string | undefined): string {
  if (!value) return 'data a confirmar'
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long' }).format(new Date(value))
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-PT').format(value)
}
</script>

<template>
  <main v-if="loading" class="subpage" aria-labelledby="company-title">
    <section class="adm-card"><p class="adm-sub">A carregar empresa...</p></section>
  </main>

  <main v-else-if="!detail || detail.role !== 'admin'" class="subpage adm-gate" aria-labelledby="company-title" data-screen-label="Empresa — Acesso negado">
    <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
    <h1 id="company-title" class="subpage-title">Gestão da Empresa</h1>
    <p class="subpage-sub" style="margin-top: 0">{{ errorMessage }}</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
      <NuxtLink class="btn btn--primary" to="/account/profile">O meu perfil</NuxtLink>
    </div>
  </main>

  <main v-else class="subpage" aria-labelledby="company-title" data-screen-label="Subscrição — Gestão da Empresa">
    <NuxtLink class="btn btn--ghost btn--back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>
    <h1 id="company-title" class="subpage-title">{{ detail.company.name }}</h1>
    <p class="subpage-sub">Conta corporativa · <span class="plan-current--on" style="font-size: 13px"><UjimuIcon name="check" /> Subscrição activa</span></p>

    <div class="adm-statrow">
      <div class="adm-card adm-statcard">
        <span class="adm-stat-big">{{ seats }}</span>
        <span class="adm-stat-label">Utilizadores subscritos</span>
      </div>
      <div class="adm-card adm-statcard">
        <span class="adm-stat-big">{{ memberships.length }}</span>
        <span class="adm-stat-label">Contas especificadas</span>
      </div>
      <div class="adm-card adm-statcard">
        <span class="adm-stat-big">{{ memberLimit }}</span>
        <span class="adm-stat-label">Máximo permitido (+10%)</span>
      </div>
    </div>

    <div v-if="errorMessage" class="errbar" role="alert">
      <UjimuIcon name="info" />
      <span>{{ errorMessage }}</span>
    </div>
    <p v-if="feedback" class="plan-current--on"><UjimuIcon name="check" /> {{ feedback }}</p>

    <div class="adm-card">
      <h2 class="adm-card-title">Quota e utilização da empresa</h2>
      <div class="pay-row"><span>Limite semanal partilhado</span><strong>{{ formatNumber(weeklyLimit) }} pedidos</strong></div>
      <div class="usage-bar" role="img" aria-label="Utilização semanal"><div class="usage-bar-fill" :style="{ width: usagePercent }" /></div>
      <div class="pay-row"><span>Usados esta semana</span><strong>{{ formatNumber(weeklyUsed) }} pedidos · {{ usageLabel }}</strong></div>
      <div class="pay-row"><span>Limite diário</span><strong>Sem limite</strong></div>
      <p class="adm-foot-note">Visível apenas para administradores da Empresa. A semana renova à segunda-feira, 00:00 (hora de Luanda).</p>
    </div>

    <div class="adm-card">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">Utilizadores da Empresa</h2>
          <p class="adm-card-note">Um administrador da Empresa é automaticamente membro: conta para o limite de lugares e pode consultar como qualquer outro utilizador. Além disso, gere contas e a subscrição.</p>
        </div>
      </div>
      <div class="member-add">
        <input v-model="newEmail" class="field" placeholder="email@empresa.co.ao" :disabled="pending" @keydown.enter.prevent="addAccount" />
        <select v-model="newRole" class="field member-add-role" :disabled="pending">
          <option value="member">Membro</option>
          <option value="admin">Administrador</option>
        </select>
        <button class="btn btn--primary" type="button" :disabled="pending" @click="addAccount">Adicionar</button>
      </div>
      <div class="adm-srcs">
        <div v-for="membership in memberships" :key="membership.email" class="adm-src">
          <div class="adm-src-row">
            <span class="avatar avatar--sm">{{ membership.email.charAt(0).toUpperCase() }}</span>
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ membership.email }}</span>
              <span class="adm-src-sub">{{ membership.role === 'admin' ? 'Administrador da Empresa · membro' : 'Membro' }}</span>
            </div>
            <span v-if="membership.role === 'admin'" class="badge badge--mid"><span class="badge-dot" />Admin</span>
            <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="toggleRole(membership.email)">{{ membership.role === 'admin' ? 'Tornar membro' : 'Tornar admin' }}</button>
            <button class="iconbtn iconbtn--danger" type="button" title="Remover conta" :disabled="pending" @click="removeAccount(membership.email)"><UjimuIcon name="trash" /></button>
          </div>
        </div>
        <p v-if="memberships.length === 0" class="adm-sub">Nenhuma conta especificada — qualquer pessoa da empresa pode ser adicionada até {{ memberLimit }} contas.</p>
      </div>
    </div>

    <div class="sub-manage">
      <h2 class="sub-manage-title">Subscrição</h2>
      <div class="sub-manage-row">
        <span>Plano Empresa · {{ seats }} utilizadores · <strong>Sob consulta/trimestre</strong></span>
      </div>
      <div class="sub-manage-row">
        <span>Renovação automática a <strong>{{ periodEndLabel }}</strong></span>
        <button class="btn btn--ghost btn--xs" type="button" disabled>Cancelar subscrição</button>
      </div>
      <div class="sub-manage-row">
        <span>Sem limite diário · limite semanal partilhado: <strong>{{ formatNumber(weeklyLimit) }} pedidos</strong></span>
      </div>
      <div class="sub-manage-row">
        <NuxtLink class="btn btn--ghost btn--xs" :to="`/companies/${companyId}/specialists`">Gerir especialistas da empresa</NuxtLink>
      </div>
    </div>
  </main>
</template>

<style scoped>
a.btn { text-decoration: none; }
</style>
