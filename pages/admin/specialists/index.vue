<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminSessionResponse, AdminSpecialist, AdminSpecialistsResponse } from '../../../utils/admin-ui'
import { createEmptySpecialistForm, readAdminApiError } from '../../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')
const createForm = ref(createEmptySpecialistForm())

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
  if (!response.ok) throw new Error('Failed to load specialists.')

  const payload = (await response.json()) as AdminSpecialistsResponse
  specialists.value = payload.specialists
}

async function createSpecialist(): Promise<void> {
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
    feedback.value = 'Especialidade criada. Abra a ficha para editar fontes e ingestão.'
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
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-specialists-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-specialists-title">Especialidades</h1>
        <p>Crie especialistas e abra cada ficha para gerir fontes, acesso e ingestão.</p>
      </div>
      <div class="header-actions">
        <UButton to="/admin" color="neutral" variant="ghost">Painel</UButton>
        <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
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

    <section v-else class="specialists-grid">
      <section class="admin-card list-card" aria-labelledby="specialist-list-title">
        <div class="card-heading">
          <h2 id="specialist-list-title">Especialidades</h2>
          <UBadge color="primary" variant="soft">{{ specialists.length }}</UBadge>
        </div>
        <p v-if="specialists.length === 0" class="muted">Ainda não há especialidades.</p>
        <ol v-else class="specialist-list">
          <li v-for="specialist in specialists" :key="specialist.id">
            <div>
              <strong>{{ specialist.name }}</strong>
              <small>{{ specialist.id }} · {{ specialist.wiki_type }}</small>
              <div class="status-badges">
                <UBadge :color="specialist.status === 'active' ? 'success' : 'warning'" variant="soft">
                  {{ specialist.status === 'active' ? 'Activo' : 'Suspenso' }}
                </UBadge>
                <UBadge :color="specialist.allowed_emails.length === 0 ? 'neutral' : 'primary'" variant="soft">
                  {{ specialist.allowed_emails.length === 0 ? 'Público' : 'Restricto' }}
                </UBadge>
              </div>
              <p>{{ specialist.description }}</p>
            </div>
            <UButton :to="`/admin/specialists/${specialist.id}`" color="primary" variant="soft" size="sm">
              Gerir ficha
            </UButton>
          </li>
        </ol>
      </section>

      <section class="admin-card create-card" aria-labelledby="create-specialist-title">
        <h2 id="create-specialist-title">Criar especialidade</h2>
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
          <label>Prompt do especialista<UTextarea v-model="createForm.system_prompt" :rows="5" :disabled="pending" /></label>
          <label>Estado
            <select v-model="createForm.status" :disabled="pending">
              <option value="active">Activo</option>
              <option value="suspended">Suspenso</option>
            </select>
          </label>
          <label>Emails com acesso<UTextarea v-model="createForm.allowed_emails" :rows="4" placeholder="um email por linha; vazio significa público" :disabled="pending" /></label>
          <label class="checkbox-line"><input v-model="createForm.citations_required" type="checkbox" /> Exigir citações</label>
          <label class="checkbox-line"><input v-model="createForm.streaming_enabled" type="checkbox" /> Respostas em fluxo</label>
          <UButton type="submit" color="primary" :loading="pending">Criar especialidade</UButton>
        </form>
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
.status-badges {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-actions,
.status-badges {
  flex-wrap: wrap;
}

.status-badges {
  justify-content: flex-start;
  margin-top: 8px;
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
.specialist-list small,
.specialist-list p {
  color: var(--ujimu-muted);
}

.specialists-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.specialist-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.specialist-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.specialist-list p {
  margin: 6px 0 0;
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
  .specialists-grid,
  .specialist-list li {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
