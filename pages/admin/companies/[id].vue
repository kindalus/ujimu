<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminSessionResponse, AdminSpecialist } from '../../../utils/admin-ui'

interface AdminCompanyDetail {
  company: { id: string; nif: string; name: string; phone: string; address: string; status: 'active' | 'suspended' }
  subscription: { seats: number; currentPeriodStart: string; currentPeriodEnd: string; active: boolean } | null
  admins: Array<{ email: string; userId: string | null }>
  members: Array<{ email: string; userId: string | null }>
  quota: { weekly: { limit: number; used: number; resetAt: string } }
  specialists: AdminSpecialist[]
}

const companyId = ref('')
const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const detail = ref<AdminCompanyDetail | null>(null)
const errorMessage = ref('')

onMounted(() => {
  companyId.value = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? '')
  void loadAdminSession()
})

async function loadAdminSession(): Promise<void> {
  sessionPending.value = true
  try {
    const response = await fetch('/api/admin/session')
    session.value = response.ok
      ? ((await response.json()) as AdminSessionResponse)
      : { authenticated: false, admin: false }
    if (session.value.admin) {
      await loadCompany()
    }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadCompany(): Promise<void> {
  const response = await fetch(`/api/admin/companies/${encodeURIComponent(companyId.value)}`)
  if (!response.ok) {
    errorMessage.value = response.status === 404 ? 'Empresa não encontrada.' : 'Não foi possível carregar a empresa.'
    return
  }
  detail.value = (await response.json()) as AdminCompanyDetail
}
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-company-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-company-title">Empresa</h1>
        <p>Veja subscrição, quota, membros e especialidades privadas desta empresa.</p>
      </div>

    </header>

    <section v-if="sessionPending" class="admin-card">
      <p>A verificar permissões...</p>
    </section>

    <section v-else-if="!session.authenticated" class="admin-card" role="alert">
      <h2>Tem de iniciar sessão para aceder à administração.</h2>
      <p>Volte à página principal e entre com o código de acesso.</p>
    </section>

    <section v-else-if="!session.admin" class="admin-card" role="alert">
      <h2>Não tem permissões de administração.</h2>
      <p>Esta área está reservada a contactos autorizados.</p>
    </section>

    <section v-else-if="errorMessage" class="admin-card" role="alert">
      <h2>{{ errorMessage }}</h2>
    </section>

    <section v-else-if="detail" class="detail-grid">
      <section class="admin-card">
        <p class="section-label">Dados</p>
        <h2>{{ detail.company.name }}</h2>
        <p class="muted">NIF {{ detail.company.nif }}</p>
        <p>{{ detail.company.phone }}</p>
        <p>{{ detail.company.address }}</p>
      </section>

      <section class="admin-card">
        <p class="section-label">Subscrição</p>
        <h2>{{ detail.subscription?.active ? 'Activa' : 'Sem subscrição activa' }}</h2>
        <p v-if="detail.subscription" class="muted">{{ detail.subscription.seats }} lugares até {{ detail.subscription.currentPeriodEnd }}</p>
        <p v-else class="muted">Sem subscrição corporate registada.</p>
      </section>

      <section class="admin-card">
        <p class="section-label">Quota</p>
        <h2>{{ detail.quota.weekly.used }} / {{ detail.quota.weekly.limit }}</h2>
        <p class="muted">Uso semanal agregado. Reinicia em {{ detail.quota.weekly.resetAt }}.</p>
      </section>

      <section class="admin-card">
        <p class="section-label">Admins</p>
        <h2>{{ detail.admins.length }} administrador(es)</h2>
        <ul class="plain-list"><li v-for="admin in detail.admins" :key="admin.email">{{ admin.email }}</li></ul>
      </section>

      <section class="admin-card">
        <p class="section-label">Membros</p>
        <h2>{{ detail.members.length }} membro(s)</h2>
        <ul class="plain-list"><li v-for="member in detail.members" :key="member.email">{{ member.email }}</li></ul>
      </section>

      <section class="admin-card wide-card">
        <p class="section-label">Especialidades associadas</p>
        <h2>{{ detail.specialists.length }} especialidade(s)</h2>
        <p v-if="detail.specialists.length === 0" class="muted">Nenhuma especialidade privada associada.</p>
        <ol v-else class="specialist-list">
          <li v-for="specialist in detail.specialists" :key="specialist.id">
            <span>{{ specialist.name }}</span>
            <UButton :to="`/admin/specialists/${specialist.id}`" color="primary" variant="soft" size="sm">Abrir</UButton>
          </li>
        </ol>
      </section>
    </section>
  </main>
</template>


