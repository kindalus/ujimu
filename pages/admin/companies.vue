<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminSessionResponse } from '../../utils/admin-ui'

interface AdminCompanySummary {
  id: string
  nif: string
  name: string
  status: 'active' | 'suspended'
  seats: number
  active: boolean
  current_period_end: string | null
  admin_count: number
  member_count: number
  assigned_specialist_count: number
}

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const companies = ref<AdminCompanySummary[]>([])
const errorMessage = ref('')

onMounted(() => {
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
      await loadCompanies()
    }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadCompanies(): Promise<void> {
  const response = await fetch('/api/admin/companies')
  if (!response.ok) {
    errorMessage.value = 'Não foi possível carregar as empresas.'
    return
  }
  const payload = (await response.json()) as { companies: AdminCompanySummary[] }
  companies.value = payload.companies
}
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-companies-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-companies-title">Empresas</h1>
        <p>Consulte empresas corporativas, subscrições, membros e especialistas associados.</p>
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

    <section v-else class="admin-card">
      <div class="card-heading">
        <h2>Empresas corporativas</h2>
        <UBadge color="primary" variant="soft">{{ companies.length }}</UBadge>
      </div>
      <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
      <p v-else-if="companies.length === 0" class="muted">Ainda não há empresas corporativas.</p>
      <ol v-else class="company-list">
        <li v-for="company in companies" :key="company.id">
          <div>
            <strong>{{ company.name }}</strong>
            <small>{{ company.nif }} · {{ company.seats }} lugares · {{ company.admin_count }} admin(s) · {{ company.member_count }} membro(s)</small>
            <div class="status-badges">
              <UBadge :color="company.active ? 'success' : 'warning'" variant="soft">
                {{ company.active ? 'Subscrição activa' : 'Sem subscrição activa' }}
              </UBadge>
              <UBadge color="primary" variant="soft">{{ company.assigned_specialist_count }} especialidade(s)</UBadge>
            </div>
          </div>
          <UButton :to="`/admin/companies/${company.id}`" color="primary" variant="soft" size="sm">
            Abrir empresa
          </UButton>
        </li>
      </ol>
    </section>
  </main>
</template>


