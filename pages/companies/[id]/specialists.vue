<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { IngestionSource } from '../../../utils/admin-ui'
import { pipelineStatusColor } from '../../../utils/admin-ui'

interface CompanySpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  status: 'active' | 'suspended'
  sources: IngestionSource[]
}

const companyId = ref('')
const specialists = ref<CompanySpecialist[]>([])
const selectedSpecialistId = ref('')
const promptForm = ref('')
const uploadFile = ref<File | undefined>()
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value) ?? null
)

onMounted(() => {
  companyId.value = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-2) ?? '')
  void loadSpecialists()
})

async function loadSpecialists(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/specialists`)
    if (!response.ok) {
      errorMessage.value = resolveLoadError(response.status)
      return
    }

    const payload = (await response.json()) as { specialists: CompanySpecialist[] }
    specialists.value = payload.specialists
    if (!selectedSpecialistId.value && payload.specialists[0]) {
      selectedSpecialistId.value = payload.specialists[0].id
    }
    syncPromptForm()
  } catch {
    errorMessage.value = 'Não foi possível carregar os especialistas.'
  } finally {
    loading.value = false
  }
}

async function savePrompt(): Promise<void> {
  if (!selectedSpecialist.value) return

  await runAction(async () => {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId.value)}/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system_prompt: promptForm.value })
    })
    if (!response.ok) throw new Error('Não foi possível guardar o prompt.')

    const payload = (await response.json()) as { specialist: CompanySpecialist }
    replaceSpecialist(payload.specialist)
    feedback.value = 'Prompt guardado.'
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
      ? 'Fonte substituída. Aguarda processamento pelo admin Ujimu.'
      : 'Fonte carregada. Aguarda processamento pelo admin Ujimu.'
  })
}

function rememberUploadFile(event: Event): void {
  const input = event.target as HTMLInputElement
  uploadFile.value = input.files?.[0]
}

function selectSpecialist(specialistId: string): void {
  selectedSpecialistId.value = specialistId
  feedback.value = ''
  errorMessage.value = ''
  syncPromptForm()
}

function syncPromptForm(): void {
  promptForm.value = selectedSpecialist.value?.system_prompt ?? ''
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

function resolveLoadError(status: number): string {
  if (status === 401) return 'Tem de iniciar sessão.'
  if (status === 403) return 'Só administradores da empresa podem gerir especialistas.'
  if (status === 404) return 'Empresa não encontrada.'
  return 'Não foi possível carregar os especialistas.'
}
</script>

<template>
  <main class="company-shell" aria-labelledby="company-specialists-title">
    <header class="company-hero">
      <div>
        <p class="section-label">Empresa</p>
        <h1 id="company-specialists-title">Especialistas da empresa</h1>
        <p>Actualize o prompt, carregue fontes e acompanhe o estado. A ingestão continua a cargo do admin Ujimu.</p>
      </div>
      <div class="company-actions">
        <UButton :to="`/companies/${companyId}`" color="neutral" variant="ghost">Empresa</UButton>
        <UButton to="/companies" color="neutral" variant="ghost">Empresas</UButton>
      </div>
    </header>

    <section v-if="loading" class="company-card">
      <p>A carregar especialistas...</p>
    </section>

    <section v-else-if="errorMessage" class="company-card" role="alert">
      <p class="company-error">{{ errorMessage }}</p>
    </section>

    <section v-else-if="specialists.length === 0" class="company-card">
      <h2>Sem especialistas privados</h2>
      <p class="muted">Ainda não existem especialistas associados a esta empresa.</p>
    </section>

    <section v-else class="specialists-grid">
      <section class="company-card list-card" aria-labelledby="specialist-list-title">
        <div class="card-heading">
          <h2 id="specialist-list-title">Especialistas</h2>
          <UBadge color="primary" variant="soft">{{ specialists.length }}</UBadge>
        </div>
        <ol class="specialist-list">
          <li v-for="specialist in specialists" :key="specialist.id" :class="{ selected: specialist.id === selectedSpecialistId }">
            <button type="button" :disabled="pending" @click="selectSpecialist(specialist.id)">
              <strong>{{ specialist.name }}</strong>
              <small>{{ specialist.id }} · {{ specialist.wiki_type }}</small>
              <span>{{ specialist.sources.length }} fonte(s)</span>
            </button>
          </li>
        </ol>
      </section>

      <section v-if="selectedSpecialist" class="company-card management-card">
        <div class="card-heading">
          <div>
            <p class="section-label">{{ selectedSpecialist.id }}</p>
            <h2>{{ selectedSpecialist.name }}</h2>
          </div>
          <UBadge :color="selectedSpecialist.status === 'active' ? 'success' : 'warning'" variant="soft">
            {{ selectedSpecialist.status === 'active' ? 'Activo' : 'Suspenso' }}
          </UBadge>
        </div>
        <p class="muted">{{ selectedSpecialist.description }}</p>

        <form class="company-form" @submit.prevent="savePrompt">
          <label>System prompt<UTextarea v-model="promptForm" :rows="6" :disabled="pending" /></label>
          <UButton type="submit" color="primary" :loading="pending">Guardar prompt</UButton>
        </form>

        <section class="upload-section" aria-labelledby="upload-title">
          <h3 id="upload-title">Carregar fonte</h3>
          <p class="muted">Aguarda processamento pelo admin Ujimu.</p>
          <input type="file" accept=".pdf,.txt,.docx,.html,.htm,.csv,.xlsx,.md,.markdown" :disabled="pending" @change="rememberUploadFile" />
          <UButton type="button" color="primary" variant="soft" :loading="pending" @click="uploadRawSource">Carregar fonte</UButton>
        </section>

        <section aria-labelledby="sources-title">
          <h3 id="sources-title">Estado das fontes</h3>
          <p v-if="selectedSpecialist.sources.length === 0" class="muted">Sem fontes detectadas.</p>
          <ol v-else class="sources-list">
            <li v-for="source in selectedSpecialist.sources" :key="source.raw_path">
              <div class="source-main-line">
                <strong>{{ source.raw_path }}</strong>
                <UBadge :color="pipelineStatusColor(source.status)" variant="soft">{{ source.status }}</UBadge>
              </div>
              <small v-if="source.title">{{ source.title }}</small>
              <small v-if="source.conversion">
                Conversão:
                <UBadge :color="pipelineStatusColor(source.conversion.status)" variant="soft">{{ source.conversion.status }}</UBadge>
                {{ source.conversion.markdown_path }}
              </small>
              <small v-if="source.ingestion">
                Ingestão:
                <UBadge :color="pipelineStatusColor(source.ingestion.status)" variant="soft">{{ source.ingestion.status }}</UBadge>
                {{ source.ingestion.source_path }}
              </small>
              <small v-if="source.replaced_at">Fonte substituída; aguarda processamento.</small>
              <small v-if="source.error_message" class="source-error">{{ source.error_message }}</small>
              <small v-if="source.conversion?.error_message" class="source-error">{{ source.conversion.error_message }}</small>
              <small v-if="source.ingestion?.error_message" class="source-error">{{ source.ingestion.error_message }}</small>
            </li>
          </ol>
        </section>
      </section>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="!loading && !errorMessage" class="muted footnote">As fontes carregadas só entram na base de conhecimento depois de processamento pelo admin Ujimu.</p>
  </main>
</template>

<style scoped>
.company-shell { width: min(1180px, calc(100% - 32px)); min-height: 100vh; margin: 0 auto; padding: 32px 0; }
.company-hero, .company-card { border: 1px solid var(--ujimu-line); border-radius: 28px; background: rgba(255,255,255,.06); padding: 24px; }
.company-hero { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.company-actions, .card-heading, .source-main-line { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.company-actions { flex-wrap: wrap; }
.specialists-grid { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 18px; }
.company-form, .management-card, .upload-section { display: grid; gap: 12px; }
.section-label { color: var(--ujimu-yellow); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.muted, .specialist-list small, .sources-list small { color: var(--ujimu-muted); }
.specialist-list, .sources-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.specialist-list button { width: 100%; border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 12px; background: rgba(0,0,0,.18); color: inherit; text-align: left; cursor: pointer; }
.specialist-list li.selected button { border-color: rgba(249,214,22,.55); background: rgba(249,214,22,.12); }
.specialist-list strong, .specialist-list small, .specialist-list span, .sources-list small { display: block; }
.sources-list li { display: grid; gap: 6px; border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 12px; background: rgba(0,0,0,.18); }
.company-error, .source-error { color: #ffd3d3; font-weight: 800; }
.feedback { margin-top: 12px; font-weight: 800; color: #fff8cc; }
.footnote { margin-top: 12px; }
@media (max-width: 900px) { .company-hero, .specialists-grid { display: grid; grid-template-columns: 1fr; } }
</style>
