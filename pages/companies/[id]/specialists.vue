<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { IngestionSource } from '../../../utils/admin-ui'

interface CompanyMembership {
  email: string
  role: 'admin' | 'member'
}

interface CompanyDetail {
  company: { id: string; nif: string; name: string; phone: string; address: string }
  role: 'admin' | 'member'
  memberships: CompanyMembership[]
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

const route = useRoute()
const companyId = ref('')
const companyName = ref('')
const companyRole = ref<'admin' | 'member' | ''>('')
const specialists = ref<CompanySpecialist[]>([])
const selectedSpecialistId = ref('')
const promptForm = ref('')
const lastSavedPrompt = ref('')
const uploadFile = ref<File | undefined>()
const fileInput = ref<HTMLInputElement | null>(null)
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value) ?? null
)
const selectedPendingCount = computed(() => selectedSpecialist.value ? pendingSourceCount(selectedSpecialist.value) : 0)

onMounted(() => {
  companyId.value = readRouteCompanyId()
  void loadCompanyArea()
})

async function loadCompanyArea(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  feedback.value = ''
  try {
    const detailResponse = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}`)
    if (!detailResponse.ok) {
      errorMessage.value = resolveCompanyError(detailResponse.status)
      return
    }

    const detail = (await detailResponse.json()) as CompanyDetail
    companyName.value = detail.company.name
    companyRole.value = detail.role
    if (detail.role !== 'admin') {
      errorMessage.value = 'A sua conta não tem permissões de administrador na empresa activa. Mude de empresa no menu lateral ou contacte o administrador da sua empresa.'
      return
    }

    await loadSpecialists()
  } catch {
    errorMessage.value = 'Não foi possível carregar os especialistas da empresa.'
  } finally {
    loading.value = false
  }
}

async function loadSpecialists(): Promise<void> {
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/specialists`)
  if (!response.ok) {
    errorMessage.value = resolveSpecialistsError(response.status)
    return
  }

  const payload = (await response.json()) as { specialists: CompanySpecialist[] }
  specialists.value = payload.specialists
  const requestedId = readRequestedSpecialistId()
  selectedSpecialistId.value = payload.specialists.some((specialist) => specialist.id === requestedId) ? requestedId : ''
  syncPromptForm()
}

async function savePrompt(): Promise<void> {
  if (!selectedSpecialist.value || promptForm.value === lastSavedPrompt.value) return

  await runAction(async () => {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system_prompt: promptForm.value })
    })
    if (!response.ok) throw new Error('Não foi possível guardar o prompt.')

    const payload = (await response.json()) as { specialist: CompanySpecialist }
    replaceSpecialist(payload.specialist)
    feedback.value = 'Alterações guardadas automaticamente.'
  })
}

async function uploadRawSource(): Promise<void> {
  if (!selectedSpecialist.value || !uploadFile.value) {
    errorMessage.value = 'Seleccione um ficheiro para carregar.'
    return
  }

  await runAction(async () => {
    const form = new FormData()
    form.set('file', uploadFile.value as File)
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}/raw`, {
      method: 'POST',
      body: form
    })
    if (!response.ok) throw new Error('Não foi possível carregar a fonte.')

    const payload = (await response.json()) as { replaced: boolean; source?: IngestionSource }
    if (payload.source) replaceOneSource(payload.source)
    feedback.value = payload.replaced
      ? 'Fonte substituída; aguarda ingestão pela equipa Ujimu.'
      : 'Fonte carregada; aguarda ingestão pela equipa Ujimu.'
  })
}

function rememberUploadFile(event: Event): void {
  const input = event.target as HTMLInputElement
  uploadFile.value = input.files?.[0]
  input.value = ''
  if (uploadFile.value) void uploadRawSource()
}

function openFilePicker(): void {
  fileInput.value?.click()
}

function selectSpecialist(specialistId: string): void {
  selectedSpecialistId.value = specialistId
  feedback.value = ''
  errorMessage.value = ''
  syncPromptForm()
}

function backToList(): void {
  selectedSpecialistId.value = ''
  feedback.value = ''
  errorMessage.value = ''
  syncPromptForm()
}

function syncPromptForm(): void {
  promptForm.value = selectedSpecialist.value?.system_prompt ?? ''
  lastSavedPrompt.value = promptForm.value
}

function replaceSpecialist(updated: CompanySpecialist): void {
  specialists.value = specialists.value
    .map((specialist) => specialist.id === updated.id ? updated : specialist)
    .sort((left, right) => left.id.localeCompare(right.id))
  selectedSpecialistId.value = updated.id
  syncPromptForm()
}

function replaceOneSource(source: IngestionSource): void {
  if (!selectedSpecialist.value) return
  const sources = [
    ...selectedSpecialist.value.sources.filter((item) => item.raw_path !== source.raw_path),
    source
  ].sort((left, right) => left.raw_path.localeCompare(right.raw_path))
  replaceSpecialist({ ...selectedSpecialist.value, sources })
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

function readRouteCompanyId(): string {
  const raw = route.params.id
  return decodeURIComponent(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '')
}

function readRequestedSpecialistId(): string {
  const raw = route.query.specialist
  return typeof raw === 'string' ? raw : ''
}

function specialistLetter(specialist: CompanySpecialist): string {
  return (specialist.name || specialist.id).trim().slice(0, 1).toUpperCase() || 'E'
}

function pendingSourceCount(specialist: CompanySpecialist): number {
  return specialist.sources.filter((source) => source.status !== 'ingested').length
}

function sourceName(source: IngestionSource): string {
  return source.raw_path.split('/').filter(Boolean).at(-1) || source.raw_path
}

function sourceSub(source: IngestionSource): string {
  const pieces: string[] = []
  if (source.article_refs.length > 0) pieces.push(`${source.article_refs.length} fragmentos na wiki`)
  pieces.push('adicionada pela empresa')
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

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    processing: 'Em processamento',
    ingested: 'Ingerido',
    failed: 'Falhado',
    blocked: 'Bloqueado',
    converted: 'Convertido',
    not_required: 'Não requerido'
  }
  return labels[status] || status
}

function badgeClass(status: string): string {
  if (['ingested', 'not_required'].includes(status)) return 'badge--ok'
  if (['processing'].includes(status)) return 'badge--warn'
  if (['failed', 'blocked'].includes(status)) return 'badge--err'
  if (['converted'].includes(status)) return 'badge--mid'
  return 'badge--mute'
}

function resolveCompanyError(status: number): string {
  if (status === 401) return 'Inicie sessão com uma conta de administrador corporativo para gerir os especialistas da sua empresa.'
  if (status === 404) return 'Empresa não encontrada.'
  return 'Não foi possível carregar a empresa.'
}

function resolveSpecialistsError(status: number): string {
  if (status === 401) return 'Inicie sessão com uma conta de administrador corporativo para gerir os especialistas da sua empresa.'
  if (status === 403) return 'A sua conta não tem permissões de administrador na empresa activa. Mude de empresa no menu lateral ou contacte o administrador da sua empresa.'
  if (status === 404) return 'Empresa não encontrada.'
  return 'Não foi possível carregar os especialistas.'
}
</script>

<template>
  <main v-if="loading" class="adm-page" aria-labelledby="company-specialists-title">
    <section class="adm-card"><p class="adm-sub">A carregar especialistas...</p></section>
  </main>

  <main v-else-if="errorMessage && companyRole !== 'admin'" class="adm-page adm-gate" aria-labelledby="company-specialists-title" data-screen-label="Empresa — Acesso negado">
    <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
    <h1 id="company-specialists-title" class="adm-title">Gestão de especialistas da empresa</h1>
    <p class="adm-sub">{{ errorMessage }}</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
    </div>
  </main>

  <main v-else-if="!selectedSpecialist" class="adm-page" aria-labelledby="company-specialists-title" data-screen-label="Empresa — Especialistas">
    <NuxtLink class="btn btn--ghost btn--back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>
    <div class="adm-pagehead">
      <div>
        <h1 id="company-specialists-title" class="adm-title">Especialistas da empresa</h1>
        <p class="adm-sub">Reservados a <strong>{{ companyName }}</strong>. Pode ajustar o prompt e adicionar fontes; a ingestão é executada pela equipa Ujimu.</p>
      </div>
    </div>

    <div class="adm-list">
      <div v-if="specialists.length === 0" class="adm-card">
        <p class="adm-sub">Ainda não há especialistas reservados à sua empresa. Contacte a equipa Ujimu para criar um.</p>
      </div>
      <template v-else>
        <div v-for="specialist in specialists" :key="specialist.id" class="adm-card adm-spec">
          <button class="adm-spec-main" type="button" @click="selectSpecialist(specialist.id)">
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
          </button>
        </div>
      </template>
    </div>
    <p class="adm-foot-note">Para criar ou remover especialistas, alterar metadados ou comportamento, contacte a equipa Ujimu.</p>
    <p v-if="errorMessage" class="adm-src-error" role="alert">{{ errorMessage }}</p>
  </main>

  <main v-else class="adm-page" aria-labelledby="company-specialist-detail-title" data-screen-label="Empresa — Ficha de especialista">
    <button class="btn btn--ghost btn--back" type="button" @click="backToList"><UjimuIcon name="chevLeft" /> Especialistas da empresa</button>
    <div class="adm-pagehead">
      <div class="adm-detail-head">
        <span class="spec-chip-letter spec-chip-letter--lg">{{ specialistLetter(selectedSpecialist) }}</span>
        <div>
          <h1 id="company-specialist-detail-title" class="adm-title">{{ selectedSpecialist.name }}</h1>
          <p class="adm-sub">Reservado a {{ companyName }} · gestão limitada</p>
        </div>
      </div>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Prompt do especialista</h2>
      <p class="adm-card-note">Define o comportamento das respostas. As alterações aplicam-se de imediato às novas consultas.</p>
      <label class="adm-field">
        <textarea v-model="promptForm" class="field adm-prompt" rows="5" :disabled="pending" @change="savePrompt" />
      </label>
      <p v-if="feedback === 'Alterações guardadas automaticamente.'" class="adm-foot-note"><UjimuIcon name="check" /> {{ feedback }}</p>
    </div>

    <div class="adm-card">
      <div class="adm-card-toprow">
        <h2 class="adm-card-title">Fontes</h2>
        <button class="btn btn--primary btn--xs" type="button" :disabled="pending" @click="openFilePicker"><UjimuIcon name="upload" /> Adicionar fonte</button>
      </div>
      <input ref="fileInput" type="file" style="display: none" accept=".pdf,.txt,.docx,.html,.htm,.csv,.xlsx,.md,.markdown" :disabled="pending" @change="rememberUploadFile" />
      <p v-if="selectedPendingCount > 0" class="adm-ingest-note"><UjimuIcon name="info" /> {{ selectedPendingCount === 1 ? '1 fonte aguarda' : selectedPendingCount + ' fontes aguardam' }} ingestão pela equipa Ujimu.</p>
      <div class="adm-srcs">
        <div v-for="source in selectedSpecialist.sources" :key="source.raw_path" class="adm-src" :class="{ 'adm-src--err': source.error_message || source.conversion?.error_message || source.ingestion?.error_message }">
          <div class="adm-src-row">
            <UjimuIcon name="doc" />
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ sourceName(source) }}</span>
              <span class="adm-src-sub">{{ sourceSub(source) }}</span>
            </div>
            <span class="badge" :class="badgeClass(source.status)"><span class="badge-dot" />{{ statusLabel(source.status) }}</span>
          </div>
          <p v-if="source.error_message" class="adm-src-error">{{ source.error_message }}</p>
          <p v-if="source.conversion?.error_message" class="adm-src-error">{{ source.conversion.error_message }}</p>
          <p v-if="source.ingestion?.error_message" class="adm-src-error">{{ source.ingestion.error_message }}</p>
        </div>
        <p v-if="selectedSpecialist.sources.length === 0" class="adm-sub">Ainda não há fontes carregadas para este especialista.</p>
      </div>
      <p class="adm-foot-note">As fontes adicionadas ficam «Pendentes» até a equipa Ujimu executar a conversão e a ingestão. Não é possível remover nem substituir fontes a partir desta área.</p>
    </div>

    <p v-if="feedback && feedback !== 'Alterações guardadas automaticamente.'" class="plan-current--on"><UjimuIcon name="check" /> {{ feedback }}</p>
    <p v-if="errorMessage" class="adm-src-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
a.btn { text-decoration: none; }
.adm-spec-main { color: inherit; }
</style>
