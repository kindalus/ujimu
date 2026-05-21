<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminSessionResponse,
  AdminSpecialist,
  AdminSpecialistsResponse,
  ContentGapCandidate,
  MonthlyVisitorsResponse,
  QuestionAnalyticsResponse,
  RecentQuestionAnalytics
} from '../../utils/admin-ui'
import { readAdminApiError } from '../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const selectedSpecialistId = ref('')
const monthlyVisitors = ref<MonthlyVisitorsResponse | undefined>()
const analyticsCandidates = ref<ContentGapCandidate[]>([])
const recentQuestions = ref<RecentQuestionAnalytics[]>([])
const analyticsPending = ref(false)
const analyticsError = ref('')
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')
const currentMonth = new Date().toISOString().slice(0, 7)

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
      await loadMonthlyVisitors()
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
  if (!selectedSpecialistId.value && specialists.value.length > 0) {
    selectSpecialist(specialists.value[0]!.id)
  }
}

function selectSpecialist(specialistId: string): void {
  selectedSpecialistId.value = specialistId
  void loadQuestionAnalytics()
}

async function loadMonthlyVisitors(): Promise<void> {
  try {
    const response = await fetch(`/api/admin/analytics/visitors?month=${encodeURIComponent(currentMonth)}`)
    if (!response.ok) throw new Error('Failed to load visitors.')
    monthlyVisitors.value = (await response.json()) as MonthlyVisitorsResponse
  } catch {
    monthlyVisitors.value = undefined
  }
}

async function loadQuestionAnalytics(): Promise<void> {
  if (!selectedSpecialistId.value) {
    analyticsCandidates.value = []
    recentQuestions.value = []
    return
  }

  analyticsPending.value = true
  analyticsError.value = ''
  try {
    const response = await fetch(`/api/admin/analytics/questions?specialistId=${encodeURIComponent(selectedSpecialistId.value)}`)
    if (!response.ok) throw new Error('Failed to load analytics.')
    const payload = (await response.json()) as QuestionAnalyticsResponse
    analyticsCandidates.value = payload.candidates
    recentQuestions.value = payload.recentQuestions
  } catch {
    analyticsError.value = 'Não foi possível carregar as lacunas de conteúdo.'
  } finally {
    analyticsPending.value = false
  }
}

async function reviewCandidate(candidate: ContentGapCandidate): Promise<void> {
  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/analytics/questions/${encodeURIComponent(candidate.fingerprint)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specialistId: candidate.specialistId })
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))
    feedback.value = 'Lacuna marcada como revista.'
    await loadQuestionAnalytics()
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
  <main class="admin-shell" aria-labelledby="analytics-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="analytics-title">Analytics</h1>
        <p>Use estes sinais para orientar revisão editorial; nunca como fonte de respostas do chat.</p>
      </div>
      <div class="header-actions">
        <UButton to="/admin" color="neutral" variant="ghost">Painel</UButton>
        <UButton to="/admin/specialists" color="neutral" variant="ghost">Especialidades</UButton>
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

    <section v-else class="analytics-grid">
      <section class="admin-card visitors-card" aria-labelledby="visitors-title">
        <div class="card-heading">
          <div>
            <p class="section-label">Visitantes</p>
            <h2 id="visitors-title">Visitantes este mês</h2>
          </div>
          <UBadge color="primary" variant="soft">
            {{ monthlyVisitors?.distinctVisitors ?? '—' }}
          </UBadge>
        </div>
        <p class="muted">Visitantes distintos em {{ monthlyVisitors?.month ?? currentMonth }}.</p>
      </section>

      <section class="admin-card specialist-card" aria-labelledby="specialist-filter-title">
        <h2 id="specialist-filter-title">Especialidade analisada</h2>
        <p v-if="specialists.length === 0" class="muted">Ainda não há especialidades para analisar.</p>
        <div v-else class="specialist-switcher" aria-label="Especialidades para análise">
          <UButton
            v-for="specialist in specialists"
            :key="specialist.id"
            type="button"
            size="sm"
            :color="specialist.id === selectedSpecialistId ? 'primary' : 'neutral'"
            :variant="specialist.id === selectedSpecialistId ? 'soft' : 'ghost'"
            @click="selectSpecialist(specialist.id)"
          >
            {{ specialist.name }}
          </UButton>
        </div>
      </section>

      <section class="admin-card gaps-card" aria-labelledby="gaps-title">
        <div class="card-heading">
          <div>
            <p class="section-label">Editorial</p>
            <h2 id="gaps-title">Lacunas de conteúdo</h2>
          </div>
          <UButton type="button" color="neutral" variant="soft" size="sm" :loading="analyticsPending" @click="loadQuestionAnalytics">
            Actualizar
          </UButton>
        </div>

        <p v-if="!selectedSpecialist" class="muted">Seleccione uma especialidade para ver lacunas.</p>
        <p v-else-if="analyticsPending" class="muted">A carregar lacunas de conteúdo...</p>
        <p v-else-if="analyticsError" class="admin-error" role="alert">{{ analyticsError }}</p>
        <p v-else-if="analyticsCandidates.length === 0" class="muted">Sem lacunas repetidas por rever.</p>
        <ol v-else class="analytics-list">
          <li v-for="candidate in analyticsCandidates" :key="candidate.fingerprint">
            <div>
              <strong>{{ candidate.latestQuestion }}</strong>
              <small>
                {{ candidate.countLast30Days }} ocorrências em 30 dias ·
                {{ candidate.insufficientContextCount }} sem contexto suficiente
              </small>
            </div>
            <UButton type="button" color="primary" variant="soft" size="sm" :loading="pending" @click="reviewCandidate(candidate)">
              Marcar como revista
            </UButton>
          </li>
        </ol>
      </section>

      <section class="admin-card recent-questions" aria-labelledby="recent-questions-title">
        <h2 id="recent-questions-title">Perguntas recentes</h2>
        <p v-if="recentQuestions.length === 0" class="muted">Sem perguntas registadas.</p>
        <ol v-else>
          <li v-for="item in recentQuestions" :key="item.id">
            <span>{{ item.questionText }}</span>
            <small>{{ item.outcome === 'insufficient_context' ? 'Sem contexto suficiente' : 'Respondida' }}</small>
          </li>
        </ol>
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
.specialist-switcher {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-actions,
.specialist-switcher {
  flex-wrap: wrap;
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
.analytics-list small,
.recent-questions small {
  color: var(--ujimu-muted);
}

.analytics-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.7fr) minmax(280px, 1fr);
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.gaps-card,
.recent-questions {
  grid-column: 1 / -1;
}

.analytics-list,
.recent-questions ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.analytics-list li,
.recent-questions li {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.analytics-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.recent-questions li {
  display: grid;
  gap: 4px;
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
  .analytics-grid,
  .analytics-list li {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
