<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminCompaniesResponse, AdminCompanySummary, AdminFailedInitialization, AdminSessionResponse, AdminSpecialist, AdminSpecialistsResponse } from '../../../utils/admin-ui'
import { createEmptySpecialistForm, readAdminApiError } from '../../../utils/admin-ui'

const wikiPresets = [
  { value: 'research-project', label: 'Projecto de investigação' },
  { value: 'book-companion', label: 'Companheiro de livro' },
  { value: 'personal-journal-backed', label: 'Diário pessoal' },
  { value: 'business-team-knowledge', label: 'Conhecimento de equipa' },
  { value: 'help-desk-faq-customer-support', label: 'Apoio ao cliente / FAQ' },
  { value: 'engineering-internal-technical-documentation', label: 'Documentação técnica interna' },
  { value: 'legislation-regulatory', label: 'Legislação e regulação' },
  { value: 'custom-domain', label: 'Domínio personalizado' }
]

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const failedInitializations = ref<AdminFailedInitialization[]>([])
const companies = ref<AdminCompanySummary[]>([])
const pending = ref(false)
const creating = ref(false)
const idTouched = ref(false)
const feedback = ref('')
const errorMessage = ref('')
const createForm = ref(createEmptySpecialistForm())

const canCreateSpecialist = computed(() => Boolean(createForm.value.id.trim() && createForm.value.name.trim()))

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
      await Promise.all([loadSpecialists(), loadCompanies()])
    }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadSpecialists(): Promise<void> {
  const response = await fetch('/api/admin/specialists')
  if (!response.ok) throw new Error('Failed to load specialists.')

  const payload = (await response.json()) as AdminSpecialistsResponse
  specialists.value = payload.specialists
  failedInitializations.value = payload.failed_initializations ?? []
}

async function loadCompanies(): Promise<void> {
  const response = await fetch('/api/admin/companies')
  if (!response.ok) throw new Error('Failed to load companies.')
  const payload = (await response.json()) as AdminCompaniesResponse
  companies.value = payload.companies
}

async function createSpecialist(): Promise<void> {
  if (!canCreateSpecialist.value) return

  await runAdminAction(async () => {
    const response = await fetch('/api/admin/specialists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createForm.value)
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    const payload = (await response.json()) as { specialist: AdminSpecialist }
    specialists.value = [...specialists.value, payload.specialist].sort((left, right) => left.id.localeCompare(right.id))
    createForm.value = createEmptySpecialistForm()
    idTouched.value = false
    creating.value = false
    feedback.value = 'Especialidade criada. A inicialização da wiki decorre em background; actualize a lista para confirmar o resultado.'
  })
}

async function runAdminAction(action: () => Promise<void>): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    await action()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  } finally {
    pending.value = false
  }
}

function setCreateName(event: Event): void {
  const target = event.target instanceof HTMLInputElement ? event.target : null
  if (!target) return
  createForm.value.name = target.value
  if (!idTouched.value) createForm.value.id = slugify(target.value)
}

function setCreateId(event: Event): void {
  const target = event.target instanceof HTMLInputElement ? event.target : null
  if (!target) return
  idTouched.value = true
  createForm.value.id = slugify(target.value)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function specialistLetter(specialist: AdminSpecialist): string {
  return specialist.name.trim().slice(0, 1).toUpperCase() || 'E'
}

function presetLabel(value: string): string {
  return wikiPresets.find((preset) => preset.value === value)?.label || value
}

function companyName(companyId: string | null): string {
  if (!companyId) return ''
  return companies.value.find((company) => company.id === companyId)?.name || companyId
}

function accessLabel(specialist: AdminSpecialist): string {
  return specialist.company_id ? `empresa: ${companyName(specialist.company_id)}` : 'público'
}

function failedInitializationLabel(failure: AdminFailedInitialization): string {
  const message = failure.error_message?.trim()
  return message || 'A inicialização falhou e a especialidade não foi persistida em disco.'
}

function sourceStatusFor(specialist: AdminSpecialist): string {
  const issue = specialist.sources.find((source) => ['failed', 'blocked'].includes(source.status))
  if (issue) return issue.status
  const working = specialist.sources.find((source) => ['processing', 'pending'].includes(source.status))
  if (working) return working.status
  return specialist.sources.length > 0 ? 'ingested' : 'no-sources'
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    initializing: 'A inicializar',
    awaiting_sources: 'A aguardar fontes',
    ingesting: 'A ingerir',
    active: 'Activo',
    suspended: 'Suspenso',
    pending: 'Pendente',
    processing: 'Em processamento',
    ingested: 'Ingerido',
    failed: 'Falhado',
    blocked: 'Bloqueado',
    'no-sources': 'Sem fontes'
  }
  return labels[status] || status
}

function badgeClass(status: string): string {
  if (['active', 'ingested'].includes(status)) return 'badge--ok'
  if (['initializing', 'awaiting_sources', 'ingesting', 'pending', 'processing'].includes(status)) return 'badge--warn'
  if (['failed', 'blocked'].includes(status)) return 'badge--err'
  return 'badge--mute'
}
</script>

<template>
  <main class="adm-page" aria-labelledby="admin-specialists-title">
    <header class="adm-pagehead">
      <div>
        <h1 id="admin-specialists-title" class="adm-title">Especialidades</h1>
        <p class="adm-sub">Crie especialistas e abra cada ficha para gerir fontes, acesso e ingestão.</p>
      </div>
      <div class="adm-row-actions">
        <button v-if="session.admin" class="btn btn--primary btn--xs" type="button" @click="creating = !creating">
          <UjimuIcon name="plus" /> Criar especialidade
        </button>
      </div>
    </header>

    <section v-if="sessionPending" class="adm-card">
      <p class="adm-sub">A verificar permissões...</p>
    </section>

    <section v-else-if="!session.authenticated" class="adm-card adm-gate" role="alert">
      <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
      <h2 class="adm-title">Tem de iniciar sessão para aceder à administração.</h2>
      <p class="adm-sub">Volte à página principal e entre com o código de acesso.</p>
    </section>

    <section v-else-if="!session.admin" class="adm-card adm-gate" role="alert">
      <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
      <h2 class="adm-title">Não tem permissões de administração.</h2>
      <p class="adm-sub">Esta área está reservada a contactos autorizados.</p>
    </section>

    <template v-else>
      <section v-if="creating" class="adm-card adm-create" aria-labelledby="create-specialist-title">
        <h2 id="create-specialist-title" class="adm-card-title">Nova especialidade</h2>
        <form class="adm-create" @submit.prevent="createSpecialist">
          <div class="adm-formgrid">
            <label class="adm-field">
              <span class="adm-field-label">Nome</span>
              <input class="field" :value="createForm.name" placeholder="ex: Imposto Industrial" :disabled="pending" autofocus @input="setCreateName" />
            </label>
            <label class="adm-field">
              <span class="adm-field-label">ID</span>
              <input class="field mono-field" :value="createForm.id" placeholder="imposto-industrial" :disabled="pending" @input="setCreateId" />
            </label>
          </div>

          <label class="adm-field">
            <span class="adm-field-label">Descrição</span>
            <input v-model="createForm.description" class="field" placeholder="Descrição curta apresentada aos utilizadores" :disabled="pending" />
          </label>

          <div class="adm-formgrid">
            <label class="adm-field">
              <span class="adm-field-label">Preset da wiki</span>
              <select v-model="createForm.wiki_type" class="field" :disabled="pending">
                <option v-for="preset in wikiPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
              </select>
              <span class="adm-preset-id">{{ createForm.wiki_type }}</span>
            </label>
            <label class="adm-field">
              <span class="adm-field-label">Estado</span>
              <select v-model="createForm.status" class="field" :disabled="pending">
                <option value="active">Activo</option>
                <option value="suspended">Suspenso</option>
              </select>
            </label>
          </div>

          <label class="adm-field">
            <span class="adm-field-label">Empresa</span>
            <select v-model="createForm.company_id" class="field" :disabled="pending">
              <option value="">Todos — disponível ao público</option>
              <option v-for="company in companies" :key="company.id" :value="company.id">
                {{ company.name }} · {{ company.nif }}
              </option>
            </select>
          </label>

          <label class="adm-field">
            <span class="adm-field-label">Prompt do especialista</span>
            <textarea v-model="createForm.system_prompt" class="field adm-prompt" rows="4" :disabled="pending" />
          </label>

          <div class="adm-togglerow">
            <button class="adm-toggle" type="button" role="switch" :aria-checked="createForm.citations_required" @click="createForm.citations_required = !createForm.citations_required">
              <span class="adm-toggle-meta">
                <span class="adm-toggle-label">Exige citações</span>
                <span class="adm-toggle-hint">Respostas devem citar as fontes da wiki</span>
              </span>
              <span class="switch" :class="{ 'switch--on': createForm.citations_required }"><span class="switch-knob" /></span>
            </button>
            <button class="adm-toggle" type="button" role="switch" :aria-checked="createForm.streaming_enabled" @click="createForm.streaming_enabled = !createForm.streaming_enabled">
              <span class="adm-toggle-meta">
                <span class="adm-toggle-label">Responde em fluxo</span>
                <span class="adm-toggle-hint">Streaming de tokens no chat</span>
              </span>
              <span class="switch" :class="{ 'switch--on': createForm.streaming_enabled }"><span class="switch-knob" /></span>
            </button>
          </div>

          <div class="adm-row-actions">
            <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="creating = false">Cancelar</button>
            <button class="btn btn--primary btn--xs" :class="{ 'btn--off': !canCreateSpecialist || pending }" type="submit" :disabled="!canCreateSpecialist || pending">
              Criar especialidade
            </button>
          </div>
        </form>
      </section>

      <section v-if="failedInitializations.length > 0" class="adm-card adm-failures" role="alert" aria-labelledby="failed-initializations-title">
        <h2 id="failed-initializations-title" class="adm-card-title">Falhas de inicialização recentes</h2>
        <p class="adm-card-note">Quando a inicialização da wiki falha, a especialidade é removida para evitar um estado parcial.</p>
        <ul class="adm-failure-list">
          <li v-for="failure in failedInitializations" :key="failure.job_id" class="adm-failure-item">
            <strong class="mono-field">{{ failure.specialist_id }}</strong>
            <span>{{ failedInitializationLabel(failure) }}</span>
            <span class="adm-src-sub mono-field">{{ failure.failed_at }}</span>
            <span v-if="failure.agent_logs.length > 0" class="adm-src-sub mono-field">Registo: {{ failure.agent_logs[0].file_name }}</span>
          </li>
        </ul>
      </section>

      <section class="adm-list" aria-label="Especialidades existentes">
        <div v-if="specialists.length === 0" class="adm-card">
          <p class="adm-sub">Ainda não há especialidades.</p>
        </div>
        <template v-else>
          <div v-for="specialist in specialists" :key="specialist.id" class="adm-card adm-spec">
            <NuxtLink class="adm-spec-main" :to="`/admin/specialists/${specialist.id}`">
              <span class="spec-chip-letter">{{ specialistLetter(specialist) }}</span>
              <span class="adm-spec-meta">
                <span class="adm-spec-name">{{ specialist.name }} <span class="adm-spec-id">/{{ specialist.id }}</span></span>
                <span class="adm-spec-desc">{{ specialist.description }}</span>
              </span>
              <span class="adm-spec-stats">
                <span class="badge" :class="badgeClass(specialist.status)"><span class="badge-dot" />{{ statusLabel(specialist.status) }}</span>
                <span class="adm-stat">{{ accessLabel(specialist) }}</span>
                <span class="adm-stat">{{ presetLabel(specialist.wiki_type) }}</span>
                <span class="adm-stat">{{ specialist.sources.length }} fontes</span>
                <span class="badge" :class="badgeClass(sourceStatusFor(specialist))"><span class="badge-dot" />{{ statusLabel(sourceStatusFor(specialist)) }}</span>
              </span>
            </NuxtLink>
          </div>
        </template>
      </section>
    </template>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>
