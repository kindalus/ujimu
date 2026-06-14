<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminCompaniesResponse, AdminCompanySummary, AdminSessionResponse, AdminSpecialist, AdminSpecialistsResponse, IngestionRunResponse, IngestionSource } from '../../../utils/admin-ui'
import { readAdminApiError } from '../../../utils/admin-ui'

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

type SourceDisplayStatus = 'pending' | 'processing' | 'ingested' | 'failed' | 'blocked' | 'converted' | 'not_required'

const specialistId = ref('')
const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const companies = ref<AdminCompanySummary[]>([])
const editForm = ref({
  name: '',
  description: '',
  system_prompt: '',
  citations_required: true,
  streaming_enabled: true,
  status: 'active' as AdminSpecialist['status'],
  company_id: ''
})
const fileInput = ref<HTMLInputElement | null>(null)
const confirmDeleteOpen = ref(false)
const pending = ref(false)
const feedback = ref('')
const ingestionNote = ref('')
const errorMessage = ref('')

const specialist = computed(() =>
  specialists.value.find((item) => item.id === specialistId.value)
)

const canUploadSources = computed(() => {
  const status = specialist.value?.status
  return status === 'awaiting_sources' || status === 'active' || status === 'suspended'
})

const canRunIngestion = computed(() =>
  canUploadSources.value && (specialist.value?.sources.some((source) => canIngestSource(source)) ?? false)
)

const agentLogs = computed(() => specialist.value?.agent_logs ?? [])

onMounted(() => {
  specialistId.value = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? '')
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
  syncEditForm()
}

async function loadCompanies(): Promise<void> {
  const response = await fetch('/api/admin/companies')
  if (!response.ok) throw new Error('Failed to load companies.')
  const payload = (await response.json()) as AdminCompaniesResponse
  companies.value = payload.companies
}

function syncEditForm(): void {
  if (!specialist.value) return

  editForm.value = {
    name: specialist.value.name,
    description: specialist.value.description,
    system_prompt: specialist.value.system_prompt,
    citations_required: specialist.value.citations_required,
    streaming_enabled: specialist.value.streaming_enabled,
    status: specialist.value.status,
    company_id: specialist.value.company_id ?? ''
  }
}

async function updateSpecialist(): Promise<void> {
  if (!specialist.value || pending.value) return

  await runAdminAction(async () => {
    const { status, ...editableFields } = editForm.value
    const body = status === 'active' || status === 'suspended'
      ? editForm.value
      : editableFields
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    const payload = (await response.json()) as { specialist: AdminSpecialist }
    replaceSpecialist(payload.specialist)
    feedback.value = 'Especialidade actualizada.'
  })
}

function setCitationsRequired(value: boolean): void {
  editForm.value.citations_required = value
  void updateSpecialist()
}

function setStreamingEnabled(value: boolean): void {
  editForm.value.streaming_enabled = value
  void updateSpecialist()
}

function toggleSuspended(): void {
  editForm.value.status = specialist.value?.status === 'suspended' ? 'active' : 'suspended'
  void updateSpecialist()
}

function openFilePicker(): void {
  if (!canUploadSources.value) return
  fileInput.value?.click()
}

function rememberUploadFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void uploadRawSource(file)
}

async function uploadRawSource(file: File): Promise<void> {
  if (!specialist.value) return

  await runAdminAction(async () => {
    const form = new FormData()
    form.set('file', file)
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}/raw`, {
      method: 'POST',
      body: form
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))
    const payload = (await response.json()) as { replaced: boolean; source?: IngestionSource }
    if (payload.source) {
      replaceOneSource(payload.source)
    }
    feedback.value = payload.replaced ? 'Fonte substituída. Execute a ingestão para actualizar a wiki.' : 'Fonte carregada. Execute a ingestão para actualizar a wiki.'
  })
}

async function refreshSources(): Promise<void> {
  if (!specialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}/sources/reload`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    const payload = (await response.json()) as { sources: IngestionSource[] }
    replaceSelectedSources(payload.sources)
    if (!payload.sources.some((source) => canIngestSource(source) || source.status === 'processing')) ingestionNote.value = ''
    feedback.value = 'Estado actualizado.'
  })
}

async function runIngestion(): Promise<void> {
  if (!specialist.value || !canRunIngestion.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}/ingestion/run`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    const payload = (await response.json()) as IngestionRunResponse
    replaceSelectedSources(payload.sources)
    ingestionNote.value = 'Comando enviado. A conversão e a ingestão decorrem em background — use Actualizar para acompanhar o estado.'
    feedback.value = formatIngestionFeedback(payload)
  })
}

async function deleteSpecialist(): Promise<void> {
  const selected = specialist.value
  if (!selected) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selected.id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmationId: selected.id })
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    confirmDeleteOpen.value = false
    feedback.value = 'Especialidade apagada.'
    window.location.href = '/admin/specialists'
  })
}

function formatIngestionFeedback(payload: IngestionRunResponse): string {
  if (payload.job?.status === 'queued' || payload.job?.status === 'running') {
    return 'Ingestão agendada. Actualize o estado para acompanhar o processamento.'
  }

  const counts = payload.counts
  if (!counts) return 'Ingestão concluída.'

  if (counts.failed > 0) {
    return `Ingestão terminou com erro: ${counts.ingested} fonte(s) ingerida(s), ${counts.failed} com erro.`
  }

  return `Ingestão concluída: ${counts.ingested} fonte(s) ingerida(s), ${counts.pending} pendente(s), ${counts.blocked} bloqueada(s).`
}

function replaceSpecialist(updated: AdminSpecialist): void {
  specialists.value = specialists.value
    .map((item) => item.id === updated.id ? updated : item)
    .sort((left, right) => left.id.localeCompare(right.id))
  syncEditForm()
}

function replaceSelectedSources(sources: IngestionSource[]): void {
  if (!specialist.value) return
  replaceSpecialist({ ...specialist.value, sources })
}

function replaceOneSource(source: IngestionSource): void {
  if (!specialist.value) return
  const sources = [
    ...specialist.value.sources.filter((item) => item.raw_path !== source.raw_path),
    source
  ].sort((left, right) => left.raw_path.localeCompare(right.raw_path))
  replaceSelectedSources(sources)
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

function specialistLetter(item: AdminSpecialist): string {
  return item.name.trim().slice(0, 1).toUpperCase() || 'E'
}

function specialistStatusLabel(status: AdminSpecialist['status']): string {
  const labels: Record<AdminSpecialist['status'], string> = {
    initializing: 'A inicializar',
    awaiting_sources: 'A aguardar fontes',
    ingesting: 'Em ingestão',
    active: 'Activa',
    suspended: 'Suspensa',
    failed: 'Falhada'
  }
  return labels[status]
}

function specialistStatusClass(status: AdminSpecialist['status']): string {
  if (status === 'active') return 'badge--ok'
  if (status === 'initializing' || status === 'awaiting_sources' || status === 'ingesting') return 'badge--warn'
  if (status === 'failed') return 'badge--err'
  return 'badge--mute'
}

function workflowStatusMessage(status: AdminSpecialist['status']): string {
  const messages: Record<AdminSpecialist['status'], string> = {
    initializing: 'Inicialização da wiki em curso. O carregamento de fontes fica disponível quando o agente criar AGENTS.md e a estrutura inicial da wiki.',
    awaiting_sources: 'A wiki foi inicializada. Carregue fontes oficiais e execute a ingestão.',
    ingesting: 'Ingestão em curso. Use Actualizar para acompanhar o estado antes de carregar novas fontes.',
    active: 'Especialidade activa. Pode carregar novas fontes ou tentar novamente fontes falhadas.',
    suspended: 'Especialidade suspensa. A gestão de fontes continua disponível para administradores.',
    failed: 'Fluxo do agente falhou. Consulte os registos do agente antes de tentar novamente.'
  }
  return messages[status]
}

function agentLogTaskLabel(task: AdminSpecialist['agent_logs'][number]['task']): string {
  const labels: Record<AdminSpecialist['agent_logs'][number]['task'], string> = {
    initialization: 'Inicialização',
    conversion: 'Conversão',
    ingestion: 'Ingestão'
  }
  return labels[task]
}

function agentLogStartedLabel(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'data desconhecida'

  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

function companyName(companyId: string | null): string {
  if (!companyId) return ''
  return companies.value.find((company) => company.id === companyId)?.name || companyId
}

function sourceName(source: IngestionSource): string {
  return source.raw_path.split('/').filter(Boolean).at(-1) || source.raw_path
}

function sourceSub(source: IngestionSource): string {
  const pieces: string[] = []
  if (source.article_refs.length > 0) pieces.push(`${source.article_refs.length} fragmentos na wiki`)
  pieces.push(`actualizada ${sourceUpdatedLabel(source)}`)
  return pieces.join(' · ')
}

function sourceUpdatedLabel(source: IngestionSource): string {
  const timestamp = source.updated_at ?? source.ingestion?.updated_at ?? source.conversion?.updated_at ?? source.replaced_at ?? source.ingested_at ?? source.detected_at
  if (!timestamp) return 'recentemente'

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'recentemente'

  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

function effectiveSourceStatus(source: IngestionSource): SourceDisplayStatus {
  if (source.status !== 'ingested' && source.conversion?.status === 'converted') return 'converted'
  return source.status
}

function statusLabel(status: SourceDisplayStatus): string {
  const labels: Record<SourceDisplayStatus, string> = {
    pending: 'Pendente',
    processing: 'Em processamento',
    ingested: 'Ingerido',
    failed: 'Falhado',
    blocked: 'Bloqueado',
    converted: 'Convertido',
    not_required: 'Não requerido'
  }
  return labels[status]
}

function badgeClass(status: SourceDisplayStatus): string {
  if (['ingested', 'not_required'].includes(status)) return 'badge--ok'
  if (['pending', 'processing'].includes(status)) return 'badge--warn'
  if (['failed', 'blocked'].includes(status)) return 'badge--err'
  if (status === 'converted') return 'badge--mid'
  return 'badge--mute'
}

function canIngestSource(source: IngestionSource): boolean {
  return ['pending', 'failed', 'blocked'].includes(source.status)
}
</script>

<template>
  <main v-if="sessionPending" class="adm-page" aria-labelledby="admin-specialist-title">
    <section class="adm-card"><p class="adm-sub">A verificar permissões...</p></section>
  </main>

  <main v-else-if="!session.authenticated || !session.admin" class="adm-page adm-gate" aria-labelledby="admin-specialist-gate-title" data-screen-label="Admin — Acesso negado">
    <span class="adm-gate-icon"><UjimuIcon name="user" :size="26" /></span>
    <h1 id="admin-specialist-gate-title" class="adm-title">Área reservada</h1>
    <p class="adm-sub">{{ !session.authenticated ? 'Inicie sessão com uma conta de administrador para aceder a /admin.' : 'A sua conta não tem permissões de administrador.' }}</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
    </div>
    <p class="adm-foot-note">Esta área está reservada a contactos autorizados.</p>
  </main>

  <main v-else-if="!specialist" class="adm-page adm-gate" aria-labelledby="admin-specialist-missing-title" data-screen-label="Admin — Especialidade não encontrada">
    <span class="adm-gate-icon"><UjimuIcon name="doc" :size="26" /></span>
    <h1 id="admin-specialist-missing-title" class="adm-title">Especialidade não encontrada.</h1>
    <p class="adm-sub">A ficha pedida não existe ou já foi apagada.</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/admin/specialists"><UjimuIcon name="chevLeft" :size="16" /> Especialidades</NuxtLink>
    </div>
  </main>

  <main v-else class="adm-page" aria-labelledby="admin-specialist-title" data-screen-label="Admin — Ficha de especialidade">
    <NuxtLink class="btn btn--ghost btn--back" to="/admin/specialists"><UjimuIcon name="chevLeft" :size="16" /> Especialidades</NuxtLink>
    <div class="adm-pagehead">
      <div class="adm-detail-head">
        <span class="spec-chip-letter spec-chip-letter--lg">{{ specialistLetter(specialist) }}</span>
        <div>
          <h1 id="admin-specialist-title" class="adm-title">
            {{ specialist.name }}
            <span class="badge" :class="specialistStatusClass(specialist.status)"><span class="badge-dot" />{{ specialistStatusLabel(specialist.status) }}</span>
          </h1>
          <p class="adm-sub mono-field">/admin/specialists/{{ specialist.id }}</p>
        </div>
      </div>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Metadados</h2>
      <label class="adm-field">
        <span class="adm-field-label">Nome</span>
        <input v-model="editForm.name" class="field" :disabled="pending" @change="updateSpecialist" />
      </label>
      <label class="adm-field">
        <span class="adm-field-label">Descrição</span>
        <input v-model="editForm.description" class="field" :disabled="pending" @change="updateSpecialist" />
      </label>
      <label class="adm-field">
        <span class="adm-field-label">Preset da wiki</span>
        <select :value="specialist.wiki_type" class="field readonly-field" disabled>
          <option v-for="preset in wikiPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option>
        </select>
        <span class="adm-preset-id">{{ specialist.wiki_type }}</span>
      </label>
      <label class="adm-field">
        <span class="adm-field-label">Prompt do especialista</span>
        <textarea v-model="editForm.system_prompt" class="field adm-prompt" rows="4" :disabled="pending" @change="updateSpecialist"></textarea>
      </label>
      <div class="adm-togglerow">
        <button class="adm-toggle" type="button" role="switch" :aria-checked="editForm.citations_required" :disabled="pending" @click="setCitationsRequired(!editForm.citations_required)">
          <span class="adm-toggle-meta">
            <span class="adm-toggle-label">Exige citações</span>
            <span class="adm-toggle-hint">Respostas devem citar as fontes da wiki</span>
          </span>
          <span class="switch" :class="{ 'switch--on': editForm.citations_required }"><span class="switch-knob" /></span>
        </button>
        <button class="adm-toggle" type="button" role="switch" :aria-checked="editForm.streaming_enabled" :disabled="pending" @click="setStreamingEnabled(!editForm.streaming_enabled)">
          <span class="adm-toggle-meta">
            <span class="adm-toggle-label">Responde em fluxo</span>
            <span class="adm-toggle-hint">Streaming de tokens no chat</span>
          </span>
          <span class="switch" :class="{ 'switch--on': editForm.streaming_enabled }"><span class="switch-knob" /></span>
        </button>
      </div>
    </div>

    <div class="adm-card">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">Fontes oficiais</h2>
          <p class="adm-card-note">{{ workflowStatusMessage(specialist.status) }}</p>
        </div>
        <div class="adm-row-actions">
          <button class="btn btn--ghost btn--xs" type="button" :class="{ 'btn--off': !canUploadSources }" :disabled="pending || !canUploadSources" @click="openFilePicker"><UjimuIcon name="upload" :size="13" /> Carregar fonte</button>
          <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="refreshSources"><UjimuIcon name="refresh" :size="13" /> Actualizar</button>
          <button class="btn btn--primary btn--xs" :class="{ 'btn--off': !canRunIngestion || pending }" type="button" :disabled="!canRunIngestion || pending" @click="runIngestion">Executar ingestão</button>
        </div>
      </div>
      <input ref="fileInput" type="file" style="display: none" accept=".pdf,.docx,.xlsx,.html,.txt,.htm,.csv,.md,.markdown" :disabled="pending || !canUploadSources" @change="rememberUploadFile" />
      <p v-if="!canUploadSources" class="adm-ingest-note"><UjimuIcon name="info" :size="14" /> {{ workflowStatusMessage(specialist.status) }}</p>
      <p v-if="ingestionNote" class="adm-ingest-note"><UjimuIcon name="info" :size="14" /> {{ ingestionNote }}</p>
      <div class="adm-srcs">
        <div v-for="source in specialist.sources" :key="source.raw_path" class="adm-src" :class="{ 'adm-src--err': source.error_message || source.conversion?.error_message || source.ingestion?.error_message }">
          <div class="adm-src-row">
            <UjimuIcon name="doc" :size="16" />
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ sourceName(source) }}</span>
              <span class="adm-src-sub">{{ sourceSub(source) }}</span>
            </div>
            <span class="badge" :class="badgeClass(effectiveSourceStatus(source))"><span class="badge-dot" />{{ statusLabel(effectiveSourceStatus(source)) }}</span>
            <button v-if="canIngestSource(source)" class="btn btn--ghost btn--xs" type="button" :disabled="pending || !canRunIngestion" @click="runIngestion">Tentar novamente</button>
            <button class="btn btn--ghost btn--xs" type="button" title="Substituir esta fonte por um novo ficheiro" :disabled="pending || !canUploadSources" @click="openFilePicker">Recarregar</button>
          </div>
          <p v-if="source.error_message" class="adm-src-error">{{ source.error_message }}</p>
          <p v-if="source.conversion?.error_message" class="adm-src-error">{{ source.conversion.error_message }}</p>
          <p v-if="source.ingestion?.error_message" class="adm-src-error">{{ source.ingestion.error_message }}</p>
        </div>
        <p v-if="specialist.sources.length === 0" class="adm-sub">Ainda não há fontes carregadas para esta especialidade.</p>
      </div>
      <p class="adm-foot-note">A conversão dos ficheiros é automática e acontece durante a ingestão. «Recarregar» substitui o ficheiro de uma fonte; a fonte fica marcada como substituída até à próxima ingestão.</p>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Registos do agente</h2>
      <p class="adm-card-note">Sessões de inicialização, conversão e ingestão guardadas em <code>logs/agents/</code>.</p>
      <div class="adm-srcs">
        <div v-for="log in agentLogs" :key="log.relative_path" class="adm-src">
          <div class="adm-src-row">
            <UjimuIcon name="doc" :size="16" />
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ agentLogTaskLabel(log.task) }}</span>
              <span class="adm-src-sub mono-field">{{ log.file_name }} · {{ agentLogStartedLabel(log.started_at) }}</span>
            </div>
            <span class="badge badge--mute"><span class="badge-dot" />{{ log.task }}</span>
          </div>
        </div>
        <p v-if="agentLogs.length === 0" class="adm-sub">Ainda não há registos do agente para esta especialidade.</p>
      </div>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Acesso restrito por empresa</h2>
      <p class="adm-card-note">Reserve este especialista a uma única empresa com conta corporativa. Com «Todos», fica disponível ao público.</p>
      <label class="adm-field">
        <span class="adm-field-label">Empresa com acesso</span>
        <select v-model="editForm.company_id" class="field" :disabled="pending" @change="updateSpecialist">
          <option value="">Todos — disponível ao público</option>
          <option v-for="company in companies" :key="company.id" :value="company.id">{{ company.name }} · {{ company.seats }} utilizadores</option>
        </select>
      </label>
      <p class="adm-foot-note">{{ editForm.company_id ? 'Apenas as contas especificadas pela ' + companyName(editForm.company_id) + ' vêem e consultam este especialista.' : 'Disponível para todos os utilizadores.' }}</p>
    </div>

    <div class="adm-card adm-dangerzone">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">{{ specialist.status === 'suspended' ? 'Especialidade suspensa' : 'Suspender especialidade' }}</h2>
          <p class="adm-card-note">{{ specialist.status === 'suspended' ? 'Não aparece aos utilizadores. A wiki e o histórico mantêm-se intactos.' : 'Retira a especialidade do selector dos utilizadores, sem apagar dados.' }}</p>
        </div>
        <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="toggleSuspended">
          <UjimuIcon :name="specialist.status === 'suspended' ? 'check' : 'pause'" :size="13" /> {{ specialist.status === 'suspended' ? 'Reactivar' : 'Suspender' }}
        </button>
      </div>
      <div class="adm-card-toprow" style="border-top: 1px solid var(--line); padding-top: 12px">
        <div>
          <h2 class="adm-card-title">Apagar especialidade</h2>
          <p class="adm-card-note">Apaga a wiki e todo o histórico de clientes associado, permanentemente.</p>
        </div>
        <button class="btn btn--danger btn--xs" type="button" :disabled="pending" @click="confirmDeleteOpen = true">Apagar</button>
      </div>
    </div>

    <p v-if="feedback" class="plan-current--on"><UjimuIcon name="check" :size="11" /> {{ feedback }}</p>
    <p v-if="errorMessage" class="adm-src-error" role="alert">{{ errorMessage }}</p>

    <div v-if="confirmDeleteOpen" class="modal-scrim" @click="confirmDeleteOpen = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-specialist-title" @click.stop>
        <div class="modal-body" style="padding-top: 18px; padding-bottom: 6px">
          <h2 id="delete-specialist-title" class="modal-title">Apagar «{{ specialist.name }}»?</h2>
          <p class="modal-sub">Esta acção apaga a especialidade, a respectiva wiki e <strong>todo o histórico de conversas dos clientes</strong> associado, de forma permanente.</p>
          <div class="adm-row-actions">
            <button class="btn btn--ghost" type="button" :disabled="pending" @click="confirmDeleteOpen = false">Cancelar</button>
            <button class="btn btn--danger" type="button" :disabled="pending" @click="deleteSpecialist">Apagar permanentemente</button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
a.btn { text-decoration: none; }
.readonly-field:disabled { opacity: 1; color: var(--ink); -webkit-text-fill-color: var(--ink); cursor: default; }
.adm-toggle:disabled { opacity: 0.6; cursor: default; }
</style>
