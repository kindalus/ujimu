<script setup lang="ts">
import { onMounted, ref } from 'vue'

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

const companyId = ref('')
const detail = ref<CompanyDetail | null>(null)
const quota = ref<CompanyQuota | null>(null)
const form = ref({ nif: '', name: '', phone: '', address: '' })
const membersForm = ref({ admins: '', members: '' })
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

onMounted(() => {
  companyId.value = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? '')
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
    form.value = {
      nif: detail.value.company.nif,
      name: detail.value.company.name,
      phone: detail.value.company.phone,
      address: detail.value.company.address
    }
    membersForm.value = {
      admins: detail.value.memberships.filter((item) => item.role === 'admin').map((item) => item.email).join('\n'),
      members: detail.value.memberships.filter((item) => item.role === 'member').map((item) => item.email).join('\n')
    }
    quota.value = detail.value.role === 'admin' ? await loadCompanyQuota() : null
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

async function saveCompany(): Promise<void> {
  await runAction(async () => {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form.value)
    })
    if (!response.ok) throw new Error('Não foi possível guardar a empresa.')
    feedback.value = 'Empresa actualizada.'
    await loadCompany()
  })
}

async function saveMembers(): Promise<void> {
  await runAction(async () => {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/members`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        admins: splitEmails(membersForm.value.admins),
        members: splitEmails(membersForm.value.members)
      })
    })
    if (!response.ok) throw new Error('Não foi possível guardar os membros.')
    feedback.value = 'Membros actualizados.'
    await loadCompany()
  })
}

async function runAction(action: () => Promise<void>): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    await action()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Operação rejeitada.'
  } finally {
    pending.value = false
  }
}

function splitEmails(value: string): string[] {
  return value.split('\n').map((email) => email.trim()).filter(Boolean)
}
</script>

<template>
  <main class="company-shell" aria-labelledby="company-title">
    <header class="company-hero">
      <div>
        <p class="section-label">Empresa</p>
        <h1 id="company-title">{{ detail?.company.name || 'Empresa' }}</h1>
        <p>Edite dados e membros da empresa quando tiver permissões de administrador.</p>
      </div>
      <UButton to="/companies" color="neutral" variant="ghost">Empresas</UButton>
    </header>

    <section class="company-card">
      <p v-if="loading">A carregar empresa...</p>
      <p v-else-if="errorMessage" role="alert" class="company-error">{{ errorMessage }}</p>
      <div v-else-if="detail" class="company-grid">
        <section>
          <h2>Dados da empresa</h2>
          <form class="company-form" @submit.prevent="saveCompany">
            <label>NIF<UInput v-model="form.nif" :disabled="pending || detail.role !== 'admin'" /></label>
            <label>Nome<UInput v-model="form.name" :disabled="pending || detail.role !== 'admin'" /></label>
            <label>Telefone<UInput v-model="form.phone" :disabled="pending || detail.role !== 'admin'" /></label>
            <label>Morada<UTextarea v-model="form.address" :disabled="pending || detail.role !== 'admin'" /></label>
            <UButton v-if="detail.role === 'admin'" type="submit" color="primary" :loading="pending">Guardar empresa</UButton>
          </form>
        </section>

        <section>
          <h2>Quota corporativa</h2>
          <p v-if="quota" class="quota-summary">Uso semanal: {{ quota.weekly.used }} / {{ quota.weekly.limit }}</p>
          <p v-else class="muted">Só administradores da empresa podem consultar a quota agregada.</p>
        </section>

        <section>
          <h2>Gerir membros</h2>
          <p class="muted">Administradores e membros contam para o limite contratado.</p>
          <form v-if="detail.role === 'admin'" class="company-form" @submit.prevent="saveMembers">
            <label>Administradores<UTextarea v-model="membersForm.admins" :rows="4" :disabled="pending" /></label>
            <label>Membros<UTextarea v-model="membersForm.members" :rows="4" :disabled="pending" /></label>
            <UButton type="submit" color="primary" :loading="pending">Guardar membros</UButton>
          </form>
          <p v-else class="muted">Só administradores da empresa podem gerir membros.</p>
        </section>
      </div>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
  </main>
</template>

<style scoped>
.company-shell { width: min(1080px, calc(100% - 32px)); min-height: 100vh; margin: 0 auto; padding: 32px 0; }
.company-hero, .company-card { border: 1px solid var(--ujimu-line); border-radius: 28px; background: rgba(255,255,255,.06); padding: 24px; }
.company-hero { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.company-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.company-form { display: grid; gap: 12px; }
.section-label { color: var(--ujimu-yellow); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.muted { color: var(--ujimu-muted); }
.company-error { color: #ffd3d3; font-weight: 800; }
.feedback { margin-top: 12px; font-weight: 800; color: #fff8cc; }
@media (max-width: 850px) { .company-grid { grid-template-columns: 1fr; } }
</style>
