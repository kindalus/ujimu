<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminSessionResponse,
  AdminSpecialist,
  AdminSpecialistsResponse,
  ContentGapCandidate,
  MonthlyVisitorsResponse,
  MultiSourceQuestion,
  QuestionAnalyticsResponse,
  RecentQuestionAnalytics
} from '../../utils/admin-ui'
import { readAdminApiError } from '../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const specialists = ref<AdminSpecialist[]>([])
const selectedSpecialistId = ref('all')
const monthlyVisitors = ref<MonthlyVisitorsResponse | undefined>()
const analyticsCandidates = ref<ContentGapCandidate[]>([])
const recentQuestions = ref<RecentQuestionAnalytics[]>([])
const multiSourceQuestions = ref<MultiSourceQuestion[]>([])
const analyticsPending = ref(false)
const analyticsError = ref('')
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')
const currentMonth = new Date().toISOString().slice(0, 7)

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value)
)
const noContextRecentCount = computed(() => recentQuestions.value.filter((question) => question.outcome === 'insufficient_context').length)
const unreviewedGapCount = computed(() => analyticsCandidates.value.filter((candidate) => !candidate.reviewedAt).length)
const visitorBars = computed(() => {
  const value = monthlyVisitors.value?.distinctVisitors ?? 0
  return [{ label: monthlyVisitors.value?.month ?? currentMonth, value, height: value > 0 ? 120 : 12 }]
})

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
      await Promise.all([loadMonthlyVisitors(), loadQuestionAnalytics()])
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
  if (specialists.value.length === 0) {
    analyticsCandidates.value = []
    recentQuestions.value = []
    multiSourceQuestions.value = []
    return
  }

  analyticsPending.value = true
  analyticsError.value = ''
  try {
    const ids = selectedSpecialistId.value === 'all'
      ? specialists.value.map((specialist) => specialist.id)
      : [selectedSpecialistId.value]
    const results = await Promise.all(ids.map(async (specialistId) => {
      const response = await fetch(`/api/admin/analytics/questions?specialistId=${encodeURIComponent(specialistId)}`)
      if (!response.ok) throw new Error('Failed to load analytics.')
      return (await response.json()) as QuestionAnalyticsResponse
    }))
    analyticsCandidates.value = results
      .flatMap((result) => result.candidates)
      .sort((left, right) => right.countLast30Days - left.countLast30Days)
    recentQuestions.value = results
      .flatMap((result) => result.recentQuestions)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 12)
    multiSourceQuestions.value = results
      .flatMap((result) => result.multiSourceQuestions)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  } catch {
    analyticsError.value = 'Não foi possível carregar as lacunas de conteúdo.'
    analyticsCandidates.value = []
    recentQuestions.value = []
    multiSourceQuestions.value = []
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

async function curateMultiSourceQuestion(question: MultiSourceQuestion, decision: 'ignored' | 'derived'): Promise<void> {
  if (decision === 'derived' && !window.confirm('Criar uma síntese derivada e validada para esta pergunta?')) return
  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/analytics/questions/${encodeURIComponent(question.id)}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision })
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))
    feedback.value = decision === 'ignored' ? 'Pergunta ignorada.' : 'Derivação agendada.'
    await loadQuestionAnalytics()
  })
}

async function retryDerivation(question: MultiSourceQuestion): Promise<void> {
  await runAdminAction(async () => {
    const response = await fetch(`/api/admin/analytics/questions/${encodeURIComponent(question.id)}/retry`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error(await readAdminApiError(response))
    feedback.value = 'Derivação novamente agendada.'
    await loadQuestionAnalytics()
  })
}

function derivationStatus(question: MultiSourceQuestion): string {
  if (question.decision === 'ignored') return 'Ignorada'
  if (question.job?.status === 'queued') return 'Na fila'
  if (question.job?.status === 'running') return 'Em processamento'
  if (question.job?.status === 'succeeded') return 'Derivada'
  if (question.job?.status === 'failed') return 'Falhou'
  return question.decision === 'derived' ? 'Derivação registada' : ''
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

function specialistName(specialistId: string): string {
  return specialists.value.find((specialist) => specialist.id === specialistId)?.name || specialistId
}

function questionWhen(value: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <main class="adm-page" aria-labelledby="analytics-title" data-screen-label="Admin — Analytics">
    <div class="adm-pagehead">
      <div>
        <h1 id="analytics-title" class="adm-title">Analytics</h1>
        <p class="adm-sub">Sinais de produto e conteúdo, para revisão editorial. <strong>Não são usados como fonte de respostas do chat.</strong></p>
      </div>
      <select v-if="session.admin" class="field adm-filter" :value="selectedSpecialistId" :disabled="analyticsPending" @change="selectSpecialist(($event.target as HTMLSelectElement).value)">
        <option value="all">Todas as especialidades</option>
        <option v-for="specialist in specialists" :key="specialist.id" :value="specialist.id">{{ specialist.name }}</option>
      </select>
    </div>

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
      <div class="adm-statrow">
        <div class="adm-card adm-statcard">
          <span class="adm-stat-big">{{ monthlyVisitors?.distinctVisitors?.toLocaleString('pt-PT') ?? '—' }}</span>
          <span class="adm-stat-label">Visitantes distintos este mês</span>
        </div>
        <div class="adm-card adm-statcard">
          <span class="adm-stat-big">{{ noContextRecentCount }}</span>
          <span class="adm-stat-label">Perguntas recentes sem contexto suficiente</span>
        </div>
        <div class="adm-card adm-statcard">
          <span class="adm-stat-big">{{ unreviewedGapCount }}</span>
          <span class="adm-stat-label">Lacunas por rever</span>
        </div>
      </div>

      <div class="adm-card">
        <h2 class="adm-card-title">Visitantes distintos por mês</h2>
        <div class="chart">
          <div v-for="bar in visitorBars" :key="bar.label" class="chart-col">
            <span class="chart-val">{{ bar.value.toLocaleString('pt-PT') }}</span>
            <div class="chart-bar chart-bar--now" :style="{ height: `${bar.height}px` }" />
            <span class="chart-lbl">{{ bar.label }}</span>
          </div>
        </div>
        <p class="adm-foot-note">{{ currentMonth }} em curso. Os visitantes sem conta são estimados por browser.</p>
      </div>

      <p v-if="analyticsPending" class="adm-card adm-sub">A carregar analytics...</p>
      <p v-else-if="analyticsError" class="adm-src-error" role="alert">{{ analyticsError }}</p>

      <section class="adm-card" aria-labelledby="multisource-title">
        <h2 id="multisource-title" class="adm-card-title">Perguntas com várias fontes</h2>
        <p class="adm-card-note">Respostas que exigiram mais de três páginas da wiki. A decisão é final por pergunta.</p>
        <div class="adm-feed">
          <div v-for="question in multiSourceQuestions" :key="question.id" class="adm-feed-row adm-gap">
            <div class="adm-gap-main">
              <span class="adm-feed-q">{{ question.questionText }}</span>
              <span class="adm-feed-meta">
                {{ specialistName(question.specialistId) }} · {{ question.consultedDocumentCount }} documentos · {{ questionWhen(question.occurredAt) }}
              </span>
              <span v-if="question.decision" class="adm-feed-meta">{{ derivationStatus(question) }}</span>
              <span v-if="question.job?.status === 'failed'" class="adm-src-error" role="alert">
                A derivação não foi concluída.
              </span>
            </div>
            <div v-if="!question.decision" class="adm-row-actions">
              <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="curateMultiSourceQuestion(question, 'ignored')">Ignorar</button>
              <button class="btn btn--primary btn--xs" type="button" :disabled="pending" @click="curateMultiSourceQuestion(question, 'derived')">Derivar</button>
            </div>
            <button v-else-if="question.job?.status === 'failed'" class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="retryDerivation(question)">
              Tentar novamente
            </button>
          </div>
          <p v-if="multiSourceQuestions.length === 0" class="adm-sub">Sem perguntas multi-fonte nesta especialidade.</p>
        </div>
      </section>

      <div class="adm-twocol">
        <div class="adm-card">
          <h2 class="adm-card-title">Perguntas recentes</h2>
          <div class="adm-feed">
            <div v-for="question in recentQuestions" :key="question.id" class="adm-feed-row">
              <span class="adm-feed-q">
                {{ question.questionText }}
                <span v-if="question.outcome === 'insufficient_context'" class="nocontext-tag nocontext-tag--inline">sem contexto</span>
              </span>
              <span class="adm-feed-meta">{{ specialistName(question.specialistId) }} · {{ questionWhen(question.occurredAt) }}</span>
            </div>
            <p v-if="recentQuestions.length === 0" class="adm-sub">Sem perguntas recentes nesta especialidade.</p>
          </div>
        </div>

        <div class="adm-card">
          <h2 class="adm-card-title">Lacunas de conteúdo repetidas</h2>
          <p class="adm-card-note">Perguntas sem contexto suficiente, agrupadas por tema.</p>
          <div class="adm-feed">
            <div v-for="candidate in analyticsCandidates" :key="candidate.fingerprint" class="adm-feed-row adm-gap" :class="{ 'adm-gap--done': candidate.reviewedAt }">
              <div class="adm-gap-main">
                <span class="adm-feed-q">{{ candidate.latestQuestion }}</span>
                <span class="adm-feed-meta">{{ specialistName(candidate.specialistId) }} · {{ candidate.countLast30Days }}× em 30 dias</span>
              </div>
              <button class="btn btn--ghost btn--xs" :class="{ 'btn--off': Boolean(candidate.reviewedAt) }" type="button" :disabled="pending || Boolean(candidate.reviewedAt)" @click="reviewCandidate(candidate)">
                <template v-if="candidate.reviewedAt"><UjimuIcon name="check" /> Revista</template>
                <template v-else>Marcar como revista</template>
              </button>
            </div>
            <p v-if="analyticsCandidates.length === 0" class="adm-sub">Sem lacunas registadas nesta especialidade.</p>
          </div>
        </div>
      </div>
    </template>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>
