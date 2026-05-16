<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface AdminSessionResponse {
  authenticated: boolean
  admin: boolean
  user?: {
    id: string
    displayContact: string
  }
}

interface IngestionSource {
  raw_path: string
  status: 'pending' | 'processing' | 'ingested' | 'failed'
  title: string
  article_refs: string[]
  error_code?: string
  error_message?: string
}

interface AdminSpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  system_prompt: string
  citations_required: boolean
  streaming_enabled: boolean
  sources: IngestionSource[]
}

interface AdminSpecialistsResponse {
  specialists: AdminSpecialist[]
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
  message?: string
  statusMessage?: string
}

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const selectedSpecialistId = ref('')
const feedback = ref('')
const errorMessage = ref('')
const pending = ref(false)
const uploadFile = ref<File | undefined>()
const confirmationId = ref('')

const createForm = ref({
  id: '',
  name: '',
  description: '',
  wiki_type: 'legislation-regulatory',
  system_prompt: '',
  citations_required: true,
  streaming_enabled: true
})

const editForm = ref({
  name: '',
  description: '',
  system_prompt: '',
  citations_required: true,
  streaming_enabled: true
})

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value)
)

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
      await loadSpecialists()
    }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadSpecialists(): Promise<void> {
  const response = await fetch('/api/admin/specialists')
  if (!response.ok) {
    throw new Error('Failed to load specialists.')
  }

  const payload = (await response.json()) as AdminSpecialistsResponse
  specialists.value = payload.specialists
  if (!selectedSpecialistId.value && specialists.value.length > 0) {
    selectSpecialist(specialists.value[0].id)
  } else if (selectedSpecialist.value) {
    selectSpecialist(selectedSpecialist.value.id)
  }
}

function selectSpecialist(specialistId: string): void {
  selectedSpecialistId.value = specialistId
  const specialist = selectedSpecialist.value
  if (!specialist) return

  editForm.value = {
    name: specialist.name,
    description: specialist.description,
    system_prompt: specialist.system_prompt,
    citations_required: specialist.citations_required,
    streaming_enabled: specialist.streaming_enabled
  }
  confirmationId.value = ''
}

async function createSpecialist(): Promise<void> {
  await runAdminAction(async () => {
    const response = await fetch('/api/admin/specialists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createForm.value)
    })
    if (!response.ok) throw new Error(await readApiError(response))

    const payload = (await response.json()) as { specialist: AdminSpecialist }
    specialists.value = [...specialists.value, payload.specialist].sort((left, right) => left.id.localeCompare(right.id))
    selectSpecialist(payload.specialist.id)
    createForm.value = {
      id: '',
      name: '',
      description: '',
      wiki_type: 'legislation-regulatory',
      system_prompt: '',
      citations_required: true,
      streaming_enabled: true
    }
    feedback.value = 'Especialidade criada.'
  })
}

async function updateSpecialist(): Promise<void> {
  if (!selectedSpecialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editForm.value)
    })
    if (!response.ok) throw new Error(await readApiError(response))

    const payload = (await response.json()) as { specialist: AdminSpecialist }
    replaceSpecialist(payload.specialist)
    feedback.value = 'Especialidade actualizada.'
  })
}

function rememberUploadFile(event: Event): void {
  const input = event.target as HTMLInputElement
  uploadFile.value = input.files?.[0]
}

async function uploadRawSource(): Promise<void> {
  if (!selectedSpecialist.value || !uploadFile.value) {
    errorMessage.value = 'Seleccione um ficheiro para carregar.'
    return
  }

  await runAdminAction(async () => {
    const form = new FormData()
    form.set('file', uploadFile.value as File)
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}/raw`, {
      method: 'POST',
      body: form
    })
    if (!response.ok) throw new Error(await readApiError(response))
    feedback.value = 'Fonte carregada. Recarregue as fontes para actualizar o estado.'
  })
}

async function reloadSources(): Promise<void> {
  if (!selectedSpecialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}/sources/reload`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readApiError(response))

    const payload = (await response.json()) as { sources: IngestionSource[] }
    replaceSelectedSources(payload.sources)
    feedback.value = 'Fontes recarregadas.'
  })
}

async function runIngestion(): Promise<void> {
  if (!selectedSpecialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}/ingestion/run`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readApiError(response))

    const payload = (await response.json()) as { sources: IngestionSource[] }
    replaceSelectedSources(payload.sources)
    feedback.value = 'Ingestão concluída.'
  })
}

async function deleteSpecialist(): Promise<void> {
  if (!selectedSpecialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(selectedSpecialist.value!.id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmationId: confirmationId.value })
    })
    if (!response.ok) throw new Error(await readApiError(response))

    specialists.value = specialists.value.filter((specialist) => specialist.id !== selectedSpecialist.value?.id)
    selectedSpecialistId.value = specialists.value[0]?.id ?? ''
    if (selectedSpecialistId.value) {
      selectSpecialist(selectedSpecialistId.value)
    }
    feedback.value = 'Especialidade apagada.'
  })
}

function replaceSpecialist(updated: AdminSpecialist): void {
  specialists.value = specialists.value
    .map((specialist) => specialist.id === updated.id ? updated : specialist)
    .sort((left, right) => left.id.localeCompare(right.id))
  selectSpecialist(updated.id)
}

function replaceSelectedSources(sources: IngestionSource[]): void {
  if (!selectedSpecialist.value) return
  replaceSpecialist({ ...selectedSpecialist.value, sources })
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

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload
    return payload.error?.message || payload.statusMessage || payload.message || 'Operação rejeitada.'
  } catch {
    return 'Operação rejeitada.'
  }
}
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-title">Gestão de especialidades</h1>
        <p>Crie, edite, carregue fontes e acompanhe a ingestão das wikis públicas.</p>
      </div>
      <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
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

    <section v-else class="admin-grid">
      <aside class="admin-card specialist-list-card">
        <div class="card-heading">
          <h2>Especialidades</h2>
          <UBadge color="primary" variant="soft">{{ specialists.length }}</UBadge>
        </div>
        <p v-if="specialists.length === 0" class="muted">Ainda não há especialidades.</p>
        <UButton
          v-for="specialist in specialists"
          :key="specialist.id"
          type="button"
          block
          :color="specialist.id === selectedSpecialistId ? 'primary' : 'neutral'"
          :variant="specialist.id === selectedSpecialistId ? 'soft' : 'ghost'"
          @click="selectSpecialist(specialist.id)"
        >
          {{ specialist.name }}
        </UButton>
      </aside>

      <section class="admin-card create-card">
        <h2>Criar especialidade</h2>
        <form class="admin-form" @submit.prevent="createSpecialist">
          <label>ID<UInput v-model="createForm.id" placeholder="iva" :disabled="pending" /></label>
          <label>Nome<UInput v-model="createForm.name" placeholder="Legislação de IVA" :disabled="pending" /></label>
          <label>Descrição<UTextarea v-model="createForm.description" :rows="2" :disabled="pending" /></label>
          <label>Preset
            <select v-model="createForm.wiki_type" :disabled="pending">
              <option value="legislation-regulatory">legislation-regulatory</option>
              <option value="custom-domain">custom-domain</option>
              <option value="research-project">research-project</option>
            </select>
          </label>
          <label>Prompt do especialista<UTextarea v-model="createForm.system_prompt" :rows="4" :disabled="pending" /></label>
          <label class="checkbox-line"><input v-model="createForm.citations_required" type="checkbox" /> Exigir citações</label>
          <label class="checkbox-line"><input v-model="createForm.streaming_enabled" type="checkbox" /> Respostas em fluxo</label>
          <UButton type="submit" color="primary" :loading="pending">Criar especialidade</UButton>
        </form>
      </section>

      <section class="admin-card detail-card">
        <div v-if="!selectedSpecialist" class="muted">Seleccione uma especialidade para gerir.</div>
        <div v-else class="detail-stack">
          <div class="card-heading">
            <div>
              <p class="section-label">{{ selectedSpecialist.id }}</p>
              <h2>Editar especialidade</h2>
            </div>
            <UBadge color="neutral" variant="soft">{{ selectedSpecialist.wiki_type }}</UBadge>
          </div>

          <form class="admin-form" @submit.prevent="updateSpecialist">
            <label>Nome<UInput v-model="editForm.name" :disabled="pending" /></label>
            <label>Descrição<UTextarea v-model="editForm.description" :rows="2" :disabled="pending" /></label>
            <label>Prompt do especialista<UTextarea v-model="editForm.system_prompt" :rows="5" :disabled="pending" /></label>
            <label class="checkbox-line"><input v-model="editForm.citations_required" type="checkbox" /> Exigir citações</label>
            <label class="checkbox-line"><input v-model="editForm.streaming_enabled" type="checkbox" /> Respostas em fluxo</label>
            <UButton type="submit" color="primary" :loading="pending">Guardar alterações</UButton>
          </form>

          <section class="source-tools" aria-labelledby="upload-title">
            <h3 id="upload-title">Carregar fonte</h3>
            <input type="file" accept=".txt,.md,.markdown,.pdf" :disabled="pending" @change="rememberUploadFile" />
            <div class="tool-actions">
              <UButton type="button" color="primary" variant="soft" :loading="pending" @click="uploadRawSource">
                Carregar fonte
              </UButton>
              <UButton type="button" color="neutral" variant="soft" :loading="pending" @click="reloadSources">
                Recarregar fontes
              </UButton>
              <UButton type="button" color="neutral" variant="soft" :loading="pending" @click="runIngestion">
                Executar ingestão
              </UButton>
            </div>
          </section>

          <section class="sources" aria-labelledby="sources-title">
            <h3 id="sources-title">Estado das fontes</h3>
            <p v-if="selectedSpecialist.sources.length === 0" class="muted">Sem fontes detectadas.</p>
            <ol v-else>
              <li v-for="source in selectedSpecialist.sources" :key="source.raw_path">
                <strong>{{ source.raw_path }}</strong>
                <span>{{ source.status }}</span>
                <small v-if="source.error_message">{{ source.error_message }}</small>
              </li>
            </ol>
          </section>

          <section class="danger-zone" aria-labelledby="delete-title">
            <h3 id="delete-title">Apagar especialidade</h3>
            <p>Escreva o ID <strong>{{ selectedSpecialist.id }}</strong> para confirmar. A pasta será movida para trash.</p>
            <UInput v-model="confirmationId" placeholder="confirmationId" :disabled="pending" />
            <UButton type="button" color="error" variant="soft" :loading="pending" @click="deleteSpecialist">
              Apagar especialidade
            </UButton>
          </section>
        </div>
      </section>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.admin-shell {
  width: min(1280px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 0;
}

.admin-hero,
.admin-card {
  border: 1px solid var(--ujimu-line);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.admin-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: clamp(24px, 4vw, 42px);
}

.admin-hero h1,
.admin-card h2 {
  margin: 0;
  letter-spacing: -0.045em;
}

.admin-hero p:not(.section-label),
.muted,
.sources small,
.danger-zone p {
  color: var(--ujimu-muted);
}

.section-label {
  margin: 0 0 10px;
  color: var(--ujimu-yellow);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.admin-grid {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(280px, 360px) minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.card-heading,
.tool-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.admin-form,
.detail-stack,
.source-tools,
.sources,
.danger-zone {
  display: grid;
  gap: 12px;
}

.admin-form label {
  display: grid;
  gap: 6px;
  color: var(--ujimu-muted);
  font-weight: 800;
}

.admin-form select {
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  padding: 10px;
  color: #f7f4e8;
  background: #111;
}

.checkbox-line {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  gap: 8px !important;
}

.tool-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.sources ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sources li,
.danger-zone {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.sources li {
  display: grid;
  gap: 4px;
}

.sources span,
.feedback {
  color: #fff8cc;
  font-weight: 800;
}

.admin-error {
  color: #ffd3d3;
  font-weight: 800;
}

.feedback,
.admin-error {
  margin: 18px 0 0;
  border-radius: 18px;
  padding: 12px 14px;
  background: rgba(249, 214, 22, 0.1);
}

@media (max-width: 1040px) {
  .admin-grid,
  .admin-hero {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
