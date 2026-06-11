<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminSessionResponse, AdminSpecialist, AdminSpecialistsResponse, IngestionRunResponse, IngestionSource } from '../../../utils/admin-ui'
import { pipelineStatusColor, readAdminApiError } from '../../../utils/admin-ui'

const specialistId = ref('')
const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const editForm = ref({
  name: '',
  description: '',
  system_prompt: '',
  citations_required: true,
  streaming_enabled: true,
  status: 'active' as 'active' | 'suspended',
  allowed_emails: ''
})
const uploadFile = ref<File | undefined>()
const confirmationId = ref('')
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const specialist = computed(() =>
  specialists.value.find((item) => item.id === specialistId.value)
)

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
  if (!response.ok) throw new Error('Failed to load specialists.')

  const payload = (await response.json()) as AdminSpecialistsResponse
  specialists.value = payload.specialists
  syncEditForm()
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
    allowed_emails: specialist.value.allowed_emails.join('\n')
  }
}

async function updateSpecialist(): Promise<void> {
  if (!specialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editForm.value)
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

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
  if (!specialist.value || !uploadFile.value) {
    errorMessage.value = 'Seleccione um ficheiro para carregar.'
    return
  }

  await runAdminAction(async () => {
    const form = new FormData()
    form.set('file', uploadFile.value as File)
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
    feedback.value = 'Estado actualizado.'
  })
}

async function runIngestion(): Promise<void> {
  if (!specialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}/ingestion/run`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

    const payload = (await response.json()) as IngestionRunResponse
    replaceSelectedSources(payload.sources)
    feedback.value = formatIngestionFeedback(payload)
  })
}

async function deleteSpecialist(): Promise<void> {
  if (!specialist.value) return

  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/specialists/${encodeURIComponent(specialist.value!.id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmationId: confirmationId.value })
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))

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
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-specialist-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-specialist-title">Ficha da especialidade</h1>
        <p>Edite metadados, acesso, fontes e acompanhe o pipeline desta especialidade.</p>
      </div>
      <div class="header-actions">
        <UButton to="/admin/specialists" color="neutral" variant="ghost">Especialidades</UButton>
        <UButton to="/admin" color="neutral" variant="ghost">Painel</UButton>
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

    <section v-else-if="!specialist" class="admin-card" role="alert">
      <h2>Especialidade não encontrada.</h2>
      <p>A ficha pedida não existe ou já foi apagada.</p>
      <UButton to="/admin/specialists" color="primary" variant="soft">Voltar às especialidades</UButton>
    </section>

    <section v-else class="detail-grid">
      <section class="admin-card edit-card">
        <div class="card-heading">
          <div>
            <p class="section-label">{{ specialist.id }}</p>
            <h2>Editar especialidade</h2>
          </div>
          <div class="status-badges">
            <UBadge color="neutral" variant="soft">{{ specialist.wiki_type }}</UBadge>
            <UBadge :color="specialist.status === 'active' ? 'success' : 'warning'" variant="soft">
              {{ specialist.status === 'active' ? 'Activo' : 'Suspenso' }}
            </UBadge>
            <UBadge :color="specialist.allowed_emails.length === 0 ? 'neutral' : 'primary'" variant="soft">
              {{ specialist.allowed_emails.length === 0 ? 'Público' : 'Restricto' }}
            </UBadge>
          </div>
        </div>

        <form class="admin-form" @submit.prevent="updateSpecialist">
          <label>Nome<UInput v-model="editForm.name" :disabled="pending" /></label>
          <label>Descrição<UTextarea v-model="editForm.description" :rows="2" :disabled="pending" /></label>
          <label>Prompt do especialista<UTextarea v-model="editForm.system_prompt" :rows="5" :disabled="pending" /></label>
          <label>Estado
            <select v-model="editForm.status" :disabled="pending">
              <option value="active">Activo</option>
              <option value="suspended">Suspenso</option>
            </select>
          </label>
          <label>Emails com acesso<UTextarea v-model="editForm.allowed_emails" :rows="4" placeholder="um email por linha; vazio significa público" :disabled="pending" /></label>
          <label class="checkbox-line"><input v-model="editForm.citations_required" type="checkbox" /> Exigir citações</label>
          <label class="checkbox-line"><input v-model="editForm.streaming_enabled" type="checkbox" /> Respostas em fluxo</label>
          <UButton type="submit" color="primary" :loading="pending">Guardar alterações</UButton>
        </form>
      </section>

      <section class="admin-card source-card" aria-labelledby="upload-title">
        <div class="card-heading">
          <div>
            <p class="section-label">Fontes</p>
            <h2 id="upload-title">Carregar fonte</h2>
          </div>
          <UBadge color="primary" variant="soft">{{ specialist.sources.length }}</UBadge>
        </div>
        <input type="file" accept=".pdf,.txt,.docx,.html,.htm,.csv,.xlsx,.md,.markdown" :disabled="pending" @change="rememberUploadFile" />
        <div class="tool-actions">
          <UButton type="button" color="primary" variant="soft" :loading="pending" @click="uploadRawSource">
            Carregar fonte
          </UButton>
          <UButton type="button" color="neutral" variant="soft" :loading="pending" @click="refreshSources">
            Actualizar estado
          </UButton>
          <UButton type="button" color="neutral" variant="soft" :loading="pending" @click="runIngestion">
            Executar ingestão
          </UButton>
        </div>
      </section>

      <section class="admin-card sources-card" aria-labelledby="sources-title">
        <h2 id="sources-title">Estado das fontes</h2>
        <p v-if="specialist.sources.length === 0" class="muted">Sem fontes detectadas.</p>
        <ol v-else class="sources-list">
          <li v-for="source in specialist.sources" :key="source.raw_path">
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
            <small v-if="source.replaced_at">Fonte substituída; aguarda nova ingestão.</small>
            <small v-if="source.error_message" class="source-error">{{ source.error_message }}</small>
            <small v-if="source.conversion?.error_message" class="source-error">{{ source.conversion.error_message }}</small>
            <small v-if="source.ingestion?.error_message" class="source-error">{{ source.ingestion.error_message }}</small>
          </li>
        </ol>
      </section>

      <section class="admin-card danger-zone" aria-labelledby="delete-title">
        <h2 id="delete-title">Apagar especialidade</h2>
        <p>Escreva o ID <strong>{{ specialist.id }}</strong> para confirmar. A pasta será movida para trash e o histórico dos clientes desta especialidade será apagado.</p>
        <UInput v-model="confirmationId" placeholder="confirmationId" :disabled="pending" />
        <UButton type="button" color="error" variant="soft" :loading="pending" @click="deleteSpecialist">
          Apagar especialidade
        </UButton>
      </section>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.admin-shell {
  width: min(1180px, calc(100% - 32px));
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

.header-actions,
.card-heading,
.tool-actions,
.source-main-line,
.status-badges {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-actions,
.tool-actions,
.status-badges {
  flex-wrap: wrap;
}

.status-badges {
  justify-content: flex-end;
}

.admin-hero h1,
.admin-card h2 {
  margin: 0;
  letter-spacing: -0.045em;
}

.section-label {
  margin: 0 0 10px;
  color: var(--ujimu-yellow);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.admin-hero p:not(.section-label),
.muted,
.sources-list small,
.danger-zone p {
  color: var(--ujimu-muted);
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.sources-card,
.danger-zone {
  grid-column: 1 / -1;
}

.admin-form {
  display: grid;
  gap: 12px;
}

.admin-form label {
  display: grid;
  gap: 6px;
  color: var(--ujimu-muted);
  font-weight: 800;
}

.checkbox-line {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  gap: 8px !important;
}

.sources-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sources-list li,
.danger-zone {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.sources-list li {
  display: grid;
  gap: 6px;
}

.source-error {
  color: #ffd3d3 !important;
  font-weight: 800;
}

.feedback,
.admin-error {
  margin: 18px 0 0;
  border-radius: 18px;
  padding: 12px 14px;
  background: rgba(249, 214, 22, 0.1);
}

.feedback {
  color: #fff8cc;
  font-weight: 800;
}

.admin-error {
  color: #ffd3d3;
  font-weight: 800;
}

@media (max-width: 900px) {
  .admin-hero,
  .detail-grid {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
