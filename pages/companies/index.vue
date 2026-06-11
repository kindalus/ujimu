<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { IngestionSource } from '../../utils/admin-ui'

interface AuthSessionResponse {
  authenticated: boolean
  user?: { id: string; displayContact: string }
  authMethod?: 'otp' | 'passkey' | 'unknown'
  recentOtpAuthenticated?: boolean
  passkeys?: {
    passkeysEnabled: boolean
    passkeysConfigured: boolean
  }
}

interface UserCompany {
  id: string
  name: string
  nif: string
  role: 'admin' | 'member'
  active: boolean
  seats: number
}

interface CompanySpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  status: 'active' | 'suspended'
  sources: IngestionSource[]
}

const authSession = ref<AuthSessionResponse>({ authenticated: false })
const companies = ref<UserCompany[]>([])
const activeCompany = ref<UserCompany | null>(null)
const specialists = ref<CompanySpecialist[]>([])
const loading = ref(true)
const specialistsLoading = ref(false)
const authPanelOpen = ref(false)
const errorMessage = ref('')

const canManageActiveCompany = computed(() => Boolean(activeCompany.value?.active && activeCompany.value.role === 'admin'))
const gateReason = computed(() => {
  if (!authSession.value.authenticated) {
    return 'Inicie sessão com uma conta de administrador corporativo para gerir os especialistas da sua empresa.'
  }
  return 'A sua conta não tem permissões de administrador na empresa activa. Mude de empresa no menu lateral ou contacte o administrador da sua empresa.'
})

onMounted(() => {
  void loadCompanies()
})

async function loadCompanies(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  specialists.value = []
  try {
    const response = await fetch('/api/companies')
    if (response.status === 401) {
      authSession.value = { authenticated: false }
      activeCompany.value = null
      companies.value = []
      return
    }
    if (!response.ok) throw new Error('failed')

    const payload = (await response.json()) as { companies: UserCompany[]; activeCompany: UserCompany | null }
    authSession.value = { authenticated: true }
    companies.value = payload.companies
    activeCompany.value = payload.activeCompany
    if (canManageActiveCompany.value && activeCompany.value) await loadSpecialists(activeCompany.value.id)
  } catch {
    errorMessage.value = 'Não foi possível carregar a área da empresa.'
  } finally {
    loading.value = false
  }
}

async function loadSpecialists(companyId: string): Promise<void> {
  specialistsLoading.value = true
  try {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/specialists`)
    if (!response.ok) throw new Error('failed')

    const payload = (await response.json()) as { specialists: CompanySpecialist[] }
    specialists.value = payload.specialists
  } catch {
    errorMessage.value = 'Não foi possível carregar os especialistas da empresa.'
  } finally {
    specialistsLoading.value = false
  }
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
  void loadCompanies()
}

function specialistLetter(specialist: CompanySpecialist): string {
  return (specialist.name || specialist.id).trim().slice(0, 1).toUpperCase() || 'E'
}

function pendingSourceCount(specialist: CompanySpecialist): number {
  return specialist.sources.filter((source) => source.status !== 'ingested').length
}
</script>

<template>
  <main v-if="loading" class="adm-page" aria-labelledby="company-title">
    <section class="adm-card"><p class="adm-sub">A carregar área da empresa...</p></section>
  </main>

  <main v-else-if="!canManageActiveCompany" class="adm-page adm-gate" aria-labelledby="company-title" data-screen-label="Empresa — Acesso negado">
    <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
    <h1 id="company-title" class="adm-title">Gestão de especialistas da empresa</h1>
    <p class="adm-sub">{{ errorMessage || gateReason }}</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
      <button v-if="!authSession.authenticated" class="btn btn--primary" type="button" @click="authPanelOpen = true">Entrar por OTP</button>
    </div>
  </main>

  <main v-else class="adm-page" aria-labelledby="company-title" data-screen-label="Empresa — Especialistas">
    <NuxtLink class="btn btn--ghost btn--back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>
    <div class="adm-pagehead">
      <div>
        <h1 id="company-title" class="adm-title">Especialistas da empresa</h1>
        <p class="adm-sub">Reservados a <strong>{{ activeCompany?.name }}</strong>. Pode ajustar o prompt e adicionar fontes; a ingestão é executada pela equipa Ujimu.</p>
      </div>
    </div>

    <section v-if="specialistsLoading" class="adm-card">
      <p class="adm-sub">A carregar especialistas...</p>
    </section>

    <section v-else class="adm-list" aria-label="Especialistas da empresa">
      <div v-if="specialists.length === 0" class="adm-card">
        <p class="adm-sub">Ainda não há especialistas reservados à sua empresa. Contacte a equipa Ujimu para criar um.</p>
      </div>
      <template v-else>
        <div v-for="specialist in specialists" :key="specialist.id" class="adm-card adm-spec">
          <NuxtLink class="adm-spec-main" :to="`/companies/${activeCompany?.id}/specialists?specialist=${specialist.id}`">
            <span class="spec-chip-letter">{{ specialistLetter(specialist) }}</span>
            <span class="adm-spec-meta">
              <span class="adm-spec-name">{{ specialist.name }}</span>
              <span class="adm-spec-desc">{{ specialist.description }}</span>
            </span>
            <span class="adm-spec-stats">
              <span class="adm-stat">{{ specialist.sources.length }} fontes</span>
              <span v-if="pendingSourceCount(specialist) > 0" class="badge badge--warn"><span class="badge-dot" />{{ pendingSourceCount(specialist) }} por ingerir</span>
              <span v-else class="badge badge--ok"><span class="badge-dot" />Tudo ingerido</span>
            </span>
          </NuxtLink>
        </div>
      </template>
    </section>

    <p class="adm-foot-note">Para criar ou remover especialistas, alterar metadados ou comportamento, contacte a equipa Ujimu.</p>
    <p v-if="errorMessage" class="adm-src-error" role="alert">{{ errorMessage }}</p>
  </main>

  <AuthModal v-model:open="authPanelOpen" :auth-session="authSession" @authenticated="handleAuthenticatedSession" />
</template>

<style scoped>
a.btn, a.adm-spec-main { text-decoration: none; }
</style>
