<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminSessionResponse, AdminSpecialist, AdminSpecialistsResponse, MonthlyVisitorsResponse } from '../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const monthlyVisitors = ref<MonthlyVisitorsResponse | undefined>()
const currentMonth = new Date().toISOString().slice(0, 7)

const sourceIssueCount = computed(() =>
  specialists.value.reduce((count, specialist) => count + specialist.sources.filter((source) => ['failed', 'blocked'].includes(source.status)).length, 0)
)

const adminCards = computed(() => [
  {
    to: '/admin/specialists',
    path: '/admin/specialists',
    title: 'Especialidades e fontes',
    desc: `${specialists.value.length} especialidades · ${sourceIssueCount.value > 0 ? `${sourceIssueCount.value} fontes com problemas` : 'fontes sem problemas'}`
  },
  {
    to: '/admin/analytics',
    path: '/admin/analytics',
    title: 'Analytics',
    desc: `${(monthlyVisitors.value?.distinctVisitors ?? 0).toLocaleString('pt-PT')} visitantes distintos este mês · lacunas por rever`
  },
  {
    to: '/admin/ops',
    path: '/admin/ops',
    title: 'Operações / readiness',
    desc: 'Checks seguros de base de dados, dados, logs, migrações e segredos'
  }
])

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
    if (session.value.admin) await Promise.all([loadSpecialists(), loadMonthlyVisitors()])
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadSpecialists(): Promise<void> {
  const response = await fetch('/api/admin/specialists')
  if (!response.ok) return
  const payload = (await response.json()) as AdminSpecialistsResponse
  specialists.value = payload.specialists
}

async function loadMonthlyVisitors(): Promise<void> {
  const response = await fetch(`/api/admin/analytics/visitors?month=${encodeURIComponent(currentMonth)}`)
  if (!response.ok) return
  monthlyVisitors.value = (await response.json()) as MonthlyVisitorsResponse
}
</script>

<template>
  <main v-if="sessionPending" class="adm-page" aria-labelledby="admin-title">
    <section class="adm-card"><p class="adm-sub">A verificar permissões...</p></section>
  </main>

  <main v-else-if="!session.authenticated || !session.admin" class="adm-page adm-gate" aria-labelledby="admin-gate-title">
    <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
    <h1 id="admin-gate-title" class="adm-title">Área reservada</h1>
    <p class="adm-sub">{{ !session.authenticated ? 'Inicie sessão com uma conta de administrador para aceder a /admin.' : 'A sua conta não tem permissões de administrador.' }}</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
    </div>
    <p class="adm-foot-note">Esta área está reservada a contactos autorizados.</p>
  </main>

  <main v-else class="adm-page" aria-labelledby="admin-title" data-screen-label="Admin — Painel">
    <div class="adm-pagehead">
      <div>
        <h1 id="admin-title" class="adm-title">Administração</h1>
        <p class="adm-sub">Sessão de <strong>{{ session.user?.displayContact }}</strong> verificada com permissões de administrador.</p>
      </div>
    </div>

    <div class="adm-homegrid" aria-label="Áreas administrativas">
      <NuxtLink v-for="card in adminCards" :key="card.to" class="adm-card adm-homecard" :to="card.to">
        <span class="adm-homecard-path">{{ card.path }}</span>
        <span class="adm-homecard-title">{{ card.title }}</span>
        <span class="adm-homecard-desc">{{ card.desc }}</span>
      </NuxtLink>
    </div>
  </main>
</template>

<style scoped>
a.adm-homecard { color: inherit; text-decoration: none; }
</style>
