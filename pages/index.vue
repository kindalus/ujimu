<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface PublicSpecialist {
  id: string
  name: string
  description: string
  wiki_type: string
  citations_required: boolean
  streaming_enabled: boolean
}

interface SpecialistsResponse {
  specialists: PublicSpecialist[]
}

interface AuthSessionResponse {
  authenticated: boolean
  user?: {
    id: string
    displayContact: string
  }
  authMethod?: 'otp' | 'passkey' | 'unknown'
  recentOtpAuthenticated?: boolean
  passkeys?: {
    passkeysEnabled: boolean
    passkeysConfigured: boolean
  }
}

interface AdminSessionResponse extends AuthSessionResponse {
  admin: boolean
}

interface BillingStatusResponse {
  authenticated: boolean
  subscribed: boolean
  plan: {
    amount: {
      value: string
      currency: 'AOA'
    }
  }
  subscription: {
    active: boolean
    expiresAt: string
  } | null
  expiryWarning: {
    message: string
    expiresAt: string
    daysRemaining: number
  } | null
  ads: {
    visible: boolean
  }
}

interface HistoryConversationSummary {
  id: string
  specialistId: string
  title: string
  titleStatus: 'generated' | 'pending'
  createdAt: string
  updatedAt: string
}

interface HistoryMessagePayload {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: ChatCitation[]
  grounded?: boolean
}

interface HistoryConversationPayload extends HistoryConversationSummary {
  messages: HistoryMessagePayload[]
}

interface HistoryListResponse {
  conversations: HistoryConversationSummary[]
}

interface HistoryConversationResponse {
  conversation: HistoryConversationPayload
}

interface ChatCitation {
  sourceTitle: string
  sourceFile?: string
  articleRefs: string[]
}

type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | {
      type: 'history'
      conversationId: string
      userMessageId: string
      assistantMessageId: string
      title: string
      titleStatus: 'generated' | 'pending'
    }
  | { type: 'done'; grounded: boolean }
  | { type: 'error'; code: string; message: string }

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations: ChatCitation[]
  grounded?: boolean
  historyMessageId?: string
  status: 'streaming' | 'done' | 'error'
}

interface ChatUiTextPart {
  type: 'text'
  text: string
}

interface ChatUiMessage extends ChatMessage {
  parts: ChatUiTextPart[]
}

interface SpecialistSelectItem {
  label: string
  value: string
  description: string
}

interface QueuedQuestion {
  id: string
  text: string
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

const quotaLimitMessage = 'Atingiu o limite de perguntas gratuitas. Crie uma conta para continuar.'
const defaultBillingStatus: BillingStatusResponse = {
  authenticated: false,
  subscribed: false,
  plan: { amount: { value: '50000.00', currency: 'AOA' } },
  subscription: null,
  expiryWarning: null,
  ads: { visible: true }
}
const queueLimit = 3
let idCounter = 0

const specialists = ref<PublicSpecialist[]>([])
const specialistsPending = ref(true)
const specialistsError = ref(false)
const selectedSpecialistId = ref('')
const question = ref('')
const messages = ref<ChatMessage[]>([])
const queuedQuestions = ref<QueuedQuestion[]>([])
const activeConversationId = ref('')
const activeConversationTitle = ref('')
const historyConversations = ref<HistoryConversationSummary[]>([])
const historyPending = ref(false)
const historyError = ref('')
const editingMessageId = ref('')
const isStreaming = ref(false)
const quotaError = ref('')
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const adminAvailable = ref(false)
const authPanelOpen = ref(false)
const billingStatus = ref<BillingStatusResponse>({ ...defaultBillingStatus })

onMounted(() => {
  void recordVisit()
  void loadSpecialists()
  void loadAuthSession()
})

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value)
)
const specialistSelectItems = computed<SpecialistSelectItem[]>(() =>
  specialists.value.map((specialist) => ({
    label: specialist.name,
    value: specialist.id,
    description: specialist.description
  }))
)
const chatUiMessages = computed<ChatUiMessage[]>(() =>
  messages.value.map((message) => ({
    ...message,
    parts: [{ type: 'text', text: message.text || (message.status === 'streaming' ? 'A preparar resposta...' : '') }]
  }))
)
const chatStatus = computed(() => {
  if (messages.value.some((message) => message.status === 'error')) return 'error'
  if (isStreaming.value) return 'streaming'
  return 'ready'
})
const hasSpecialists = computed(() => specialists.value.length > 0)
const isAuthenticated = computed(() => authSession.value.authenticated)
const canWriteQuestion = computed(
  () => Boolean(selectedSpecialist.value) && queuedQuestions.value.length < queueLimit
)
const canSubmitQuestion = computed(() => canWriteQuestion.value && question.value.trim().length > 0)
const canUseHistory = computed(() => isAuthenticated.value && Boolean(selectedSpecialistId.value))
const statusLabel = computed(() => {
  if (isStreaming.value) return 'A responder'
  if (selectedSpecialist.value) return 'Preparado'
  return 'Seleccione'
})
const composerHelp = computed(() => {
  if (!hasSpecialists.value) return 'Ainda não há especialidades disponíveis. Volte mais tarde.'
  if (!selectedSpecialist.value) return 'Seleccione uma especialidade antes de escrever.'
  if (queuedQuestions.value.length >= queueLimit) return 'A fila de perguntas está cheia.'
  if (isStreaming.value) return 'A pergunta será adicionada à fila.'
  return 'A resposta será apresentada por partes e com fontes no fim.'
})

async function recordVisit(): Promise<void> {
  await fetch('/api/analytics/visit', { method: 'POST' }).catch(() => undefined)
}

async function loadAuthSession(): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    authSession.value = response.ok
      ? ((await response.json()) as AuthSessionResponse)
      : { authenticated: false }
    if (authSession.value.authenticated) {
      void loadHistory()
    }
  } catch {
    authSession.value = { authenticated: false }
  }
  void loadAdminSession()
  void loadBillingStatus()
}

async function loadBillingStatus(): Promise<void> {
  try {
    const response = await fetch('/api/billing/status')
    billingStatus.value = response.ok
      ? ((await response.json()) as BillingStatusResponse)
      : { ...defaultBillingStatus }
  } catch {
    billingStatus.value = { ...defaultBillingStatus }
  }
}

async function loadAdminSession(): Promise<void> {
  try {
    const response = await fetch('/api/admin/session')
    const session = response.ok
      ? ((await response.json()) as AdminSessionResponse)
      : { authenticated: false, admin: false }
    adminAvailable.value = Boolean(session.authenticated && session.admin)
  } catch {
    adminAvailable.value = false
  }
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
  void loadHistory()
  void loadAdminSession()
  void loadBillingStatus()
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  authSession.value = { authenticated: false }
  adminAvailable.value = false
  historyConversations.value = []
  activeConversationId.value = ''
  activeConversationTitle.value = ''
  authPanelOpen.value = false
  billingStatus.value = { ...defaultBillingStatus }
  void loadBillingStatus()
}

async function loadHistory(): Promise<void> {
  if (!canUseHistory.value) {
    historyConversations.value = []
    return
  }

  historyPending.value = true
  historyError.value = ''

  try {
    const response = await fetch(`/api/history?specialistId=${encodeURIComponent(selectedSpecialistId.value)}`)
    if (!response.ok) {
      throw new Error('Failed to load history.')
    }
    const payload = (await response.json()) as HistoryListResponse
    historyConversations.value = payload.conversations
  } catch {
    historyError.value = 'Não foi possível carregar o histórico.'
  } finally {
    historyPending.value = false
  }
}

async function openConversation(conversationId: string): Promise<boolean> {
  if (isStreaming.value) return false

  try {
    const response = await fetch(`/api/history/${encodeURIComponent(conversationId)}`)
    if (!response.ok) {
      throw new Error('Failed to open conversation.')
    }
    const payload = (await response.json()) as HistoryConversationResponse
    const conversation = payload.conversation

    selectedSpecialistId.value = conversation.specialistId
    activeConversationId.value = conversation.id
    activeConversationTitle.value = conversation.title
    messages.value = conversation.messages.map((message) => ({
      id: message.id,
      historyMessageId: message.id,
      role: message.role,
      text: message.content,
      citations: message.citations,
      grounded: message.grounded,
      status: 'done'
    }))
    queuedQuestions.value = []
    question.value = ''
    editingMessageId.value = ''
    quotaError.value = ''
    void loadHistory()
    return true
  } catch {
    historyError.value = 'Não foi possível retomar a conversa.'
    return false
  }
}

async function openConversationFromDrawer(conversationId: string, close: () => void): Promise<void> {
  const opened = await openConversation(conversationId)
  if (opened) {
    close()
  }
}

async function deleteHistoryConversation(conversationId: string): Promise<void> {
  if (isStreaming.value) return
  const confirmed = window.confirm('Apagar esta conversa de forma permanente?')
  if (!confirmed) return

  try {
    const response = await fetch(`/api/history/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
    if (!response.ok) {
      throw new Error('Failed to delete conversation.')
    }
    if (activeConversationId.value === conversationId) {
      activeConversationId.value = ''
      activeConversationTitle.value = ''
      messages.value = []
      editingMessageId.value = ''
    }
    void loadHistory()
  } catch {
    historyError.value = 'Não foi possível apagar a conversa.'
  }
}

function startEditingQuestion(message: ChatMessage): void {
  if (isStreaming.value || message.role !== 'user' || !message.historyMessageId) return
  editingMessageId.value = message.historyMessageId
  question.value = message.text
}

function cancelEditing(): void {
  editingMessageId.value = ''
  question.value = ''
}

async function loadSpecialists(): Promise<void> {
  specialistsPending.value = true
  specialistsError.value = false

  try {
    const response = await fetch('/api/specialists')
    if (!response.ok) {
      throw new Error('Failed to load specialists.')
    }

    const payload = (await response.json()) as SpecialistsResponse
    specialists.value = payload.specialists
  } catch {
    specialistsError.value = true
  } finally {
    specialistsPending.value = false
  }
}

function selectSpecialist(specialistId: string): void {
  if (isStreaming.value) return

  selectedSpecialistId.value = specialistId
  question.value = ''
  messages.value = []
  queuedQuestions.value = []
  activeConversationId.value = ''
  activeConversationTitle.value = ''
  editingMessageId.value = ''
  quotaError.value = ''
  void loadHistory()
}

function selectSpecialistFromPrompt(value: unknown): void {
  if (typeof value !== 'string') return
  selectSpecialist(value)
}

function submitQuestion(): void {
  const text = question.value.trim()
  if (!canSubmitQuestion.value || !text) return

  const replaceFromMessageId = editingMessageId.value || undefined
  question.value = ''
  quotaError.value = ''

  if (isStreaming.value) {
    if (!replaceFromMessageId) {
      queuedQuestions.value.push({ id: createId('queued'), text })
    }
    return
  }

  void startQuestion(text, { replaceFromMessageId })
}

function cancelQueuedQuestion(id: string): void {
  queuedQuestions.value = queuedQuestions.value.filter((queuedQuestion) => queuedQuestion.id !== id)
}

function moveQueuedQuestion(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= queuedQuestions.value.length) return

  const reordered = [...queuedQuestions.value]
  const [item] = reordered.splice(index, 1)
  if (!item) return
  reordered.splice(nextIndex, 0, item)
  queuedQuestions.value = reordered
}

async function startQuestion(
  text: string,
  options: { replaceFromMessageId?: string } = {}
): Promise<void> {
  const specialistId = selectedSpecialistId.value
  if (!specialistId) return

  const userMessage: ChatMessage = {
    id: createId('user'),
    role: 'user',
    text,
    citations: [],
    status: 'done'
  }
  let continueQueue = true
  const previousMessages = options.replaceFromMessageId ? [...messages.value] : undefined

  if (options.replaceFromMessageId) {
    const editIndex = messages.value.findIndex(
      (message) => message.historyMessageId === options.replaceFromMessageId
    )
    if (editIndex >= 0) {
      messages.value = messages.value.slice(0, editIndex)
    }
  }

  messages.value.push(userMessage)
  isStreaming.value = true

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specialistId,
        question: text,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(activeConversationId.value ? { conversationId: activeConversationId.value } : {}),
        ...(options.replaceFromMessageId ? { replaceFromMessageId: options.replaceFromMessageId } : {})
      })
    })

    if (!response.ok) {
      if (response.status === 429) {
        quotaError.value = await readQuotaErrorMessage(response)
        if (previousMessages) {
          messages.value = previousMessages
        }
        continueQueue = false
        return
      }

      if (previousMessages) {
        messages.value = previousMessages
      } else {
        messages.value.push({
          id: createId('assistant'),
          role: 'assistant',
          text: 'Não foi possível enviar a pergunta. Verifique a especialidade seleccionada e tente novamente.',
          citations: [],
          status: 'error',
          grounded: false
        })
      }
      return
    }

    const assistantMessage: ChatMessage = {
      id: createId('assistant'),
      role: 'assistant',
      text: '',
      citations: [],
      status: 'streaming'
    }
    messages.value.push(assistantMessage)

    await readChatStream(response, assistantMessage, userMessage)

    if (previousMessages && assistantMessage.status === 'error') {
      messages.value = previousMessages
      return
    }

    if (assistantMessage.status === 'streaming') {
      assistantMessage.status = 'done'
    }
  } catch {
    if (previousMessages) {
      messages.value = previousMessages
    } else {
      messages.value.push({
        id: createId('assistant'),
        role: 'assistant',
        text: 'Não foi possível receber a resposta. Tente novamente dentro de alguns minutos.',
        citations: [],
        status: 'error',
        grounded: false
      })
    }
  } finally {
    isStreaming.value = false
    const nextQuestion = continueQueue ? queuedQuestions.value.shift() : undefined
    if (nextQuestion) {
      void startQuestion(nextQuestion.text)
    }
  }
}

async function readQuotaErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload
    return payload.error?.message || quotaLimitMessage
  } catch {
    return quotaLimitMessage
  }
}

async function readChatStream(
  response: Response,
  assistantMessage: ChatMessage,
  userMessage: ChatMessage
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response body is not readable.')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      handleChatEventLine(line, assistantMessage, userMessage)
    }

    if (done) break
  }

  if (buffer.trim()) {
    handleChatEventLine(buffer, assistantMessage, userMessage)
  }
}

function handleChatEventLine(
  line: string,
  assistantMessage: ChatMessage,
  userMessage: ChatMessage
): void {
  const event = parseChatEvent(line)
  if (!event) return

  if (event.type === 'delta') {
    assistantMessage.text += event.text
    return
  }

  if (event.type === 'citation') {
    assistantMessage.citations.push(event.citation)
    return
  }

  if (event.type === 'history') {
    activeConversationId.value = event.conversationId
    activeConversationTitle.value = event.title
    userMessage.historyMessageId = event.userMessageId
    assistantMessage.historyMessageId = event.assistantMessageId
    editingMessageId.value = ''
    void loadHistory()
    return
  }

  if (event.type === 'done') {
    assistantMessage.grounded = event.grounded
    if (assistantMessage.status !== 'error') {
      assistantMessage.status = 'done'
    }
    return
  }

  assistantMessage.text ||= event.message
  assistantMessage.status = 'error'
  assistantMessage.grounded = false
}

function parseChatEvent(line: string): ChatStreamEvent | undefined {
  if (!line.trim()) return undefined

  try {
    const parsed = JSON.parse(line) as ChatStreamEvent
    if (['delta', 'citation', 'history', 'done', 'error'].includes(parsed.type)) {
      return parsed
    }
  } catch {
    return undefined
  }

  return undefined
}

function createId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

</script>

<template>
  <main class="home-shell" aria-labelledby="page-title">
    <div class="app-shell-bar">
      <AppDrawer
        :is-authenticated="isAuthenticated"
        :admin-available="adminAvailable"
        :user-label="authSession.user?.displayContact"
        open-label="Abrir navegação"
        @open-auth="authPanelOpen = true"
        @logout="logout"
      >
        <template #history="{ close }">
          <section class="drawer-history-panel" aria-labelledby="drawer-history-title">
            <div class="drawer-history-heading">
              <h2 id="drawer-history-title">Histórico</h2>
              <small v-if="selectedSpecialistId && isAuthenticated">20 últimas</small>
            </div>
            <p v-if="!isAuthenticated" class="panel-note">Entre para ver o histórico.</p>
            <p v-else-if="!selectedSpecialistId" class="panel-note">Seleccione uma especialidade.</p>
            <p v-else-if="historyPending" class="panel-note">A carregar histórico...</p>
            <p v-else-if="historyError" class="panel-note error">{{ historyError }}</p>
            <p v-else-if="historyConversations.length === 0" class="panel-note">Sem conversas guardadas.</p>
            <ol v-else class="history-list">
              <li
                v-for="conversation in historyConversations"
                :key="conversation.id"
                :class="{ active: conversation.id === activeConversationId }"
              >
                <strong>{{ conversation.title }}</strong>
                <small>{{ conversation.titleStatus === 'pending' ? 'Título pendente' : 'Título gerado' }}</small>
                <div class="history-actions">
                  <UButton
                    type="button"
                    size="xs"
                    color="primary"
                    variant="ghost"
                    :disabled="isStreaming"
                    @click="openConversationFromDrawer(conversation.id, close)"
                  >
                    Retomar
                  </UButton>
                  <UButton
                    type="button"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="isStreaming"
                    @click="deleteHistoryConversation(conversation.id)"
                  >
                    Apagar
                  </UButton>
                </div>
              </li>
            </ol>
          </section>
        </template>
      </AppDrawer>
      <span>Ujimu</span>
    </div>


    <section class="workspace" :class="{ 'workspace-chat-only': !billingStatus.ads.visible }" aria-label="Área de consulta">
      <section class="chat-panel" aria-labelledby="page-title">
        <div class="chat-header">
          <div>
            <p class="section-label">Consulta</p>
            <h1 id="page-title">
              {{ activeConversationTitle || selectedSpecialist?.name || 'Faça uma pergunta' }}
            </h1>
          </div>
          <UBadge color="primary" variant="soft" size="lg">{{ statusLabel }}</UBadge>
        </div>

        <div class="notice" role="note">
          Conteúdo gerado por IA. Pode conter erros. Confirme sempre a resposta nas fontes citadas. As respostas não substituem aconselhamento profissional.
        </div>

        <div class="messages" aria-live="polite">
          <div v-if="messages.length === 0" class="empty-chat">
            <template v-if="selectedSpecialist">
              <p>{{ selectedSpecialist?.name }}</p>
              <small>{{ selectedSpecialist?.description }}</small>
              <small>As citações serão apresentadas no fim da resposta.</small>
            </template>
            <template v-else>
              <p>Escolha uma especialidade</p>
              <small>A resposta aparecerá aqui quando o chat estiver activo.</small>
            </template>
          </div>

          <UChatMessages
            v-else
            :messages="chatUiMessages"
            :status="chatStatus"
            should-auto-scroll
            class="ujimu-chat-messages"
          >
            <UChatMessage
              v-for="message in chatUiMessages"
              :id="message.id"
              :key="message.id"
              :role="message.role"
              :parts="message.parts"
              :side="message.role === 'user' ? 'right' : 'left'"
              :variant="message.role === 'user' ? 'soft' : 'naked'"
              class="message"
              :class="`message-${message.role}`"
            >
              <template #content>
                <p class="message-label">{{ message.role === 'user' ? 'Pergunta' : 'Resposta' }}</p>
                <p class="message-text">{{ message.parts[0]?.text }}</p>

                <div v-if="message.role === 'user' && message.historyMessageId" class="message-actions">
                  <UButton
                    type="button"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="isStreaming"
                    @click="startEditingQuestion(message)"
                  >
                    Editar
                  </UButton>
                </div>

                <section
                  v-if="message.role === 'assistant' && message.citations.length > 0"
                  class="citations"
                  aria-label="Fontes"
                >
                  <h3>Fontes</h3>
                  <ol>
                    <li v-for="citation in message.citations" :key="`${message.id}-${citation.sourceTitle}`">
                      <strong>{{ citation.sourceTitle }}</strong>
                      <span>{{ citation.articleRefs.join(', ') }}</span>
                      <small v-if="citation.sourceFile">{{ citation.sourceFile }}</small>
                    </li>
                  </ol>
                </section>
              </template>
            </UChatMessage>
          </UChatMessages>
        </div>

        <p v-if="quotaError" class="quota-error" role="alert">
          {{ quotaError }}
        </p>

        <section v-if="queuedQuestions.length > 0" class="queue-panel" aria-labelledby="queue-title">
          <div>
            <h3 id="queue-title">Fila de perguntas</h3>
            <p>Até {{ queueLimit }} perguntas em espera.</p>
          </div>
          <ol>
            <li v-for="(queuedQuestion, index) in queuedQuestions" :key="queuedQuestion.id">
              <span>{{ queuedQuestion.text }}</span>
              <div class="queue-actions">
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="index === 0"
                  @click="moveQueuedQuestion(index, -1)"
                >
                  Subir
                </UButton>
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="index === queuedQuestions.length - 1"
                  @click="moveQueuedQuestion(index, 1)"
                >
                  Descer
                </UButton>
                <UButton
                  type="button"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="cancelQueuedQuestion(queuedQuestion.id)"
                >
                  Remover
                </UButton>
              </div>
            </li>
          </ol>
        </section>

        <div v-if="editingMessageId" class="editing-banner">
          <span>A editar pergunta anterior. A continuação posterior será substituída se a nova resposta terminar.</span>
          <UButton type="button" size="xs" color="neutral" variant="ghost" @click="cancelEditing">
            Cancelar edição
          </UButton>
        </div>

        <div v-if="billingStatus.expiryWarning" class="subscription-alert" role="alert">
          <span>A sua subscrição termina em menos de uma semana.</span>
          <UButton to="/subscription" size="xs" color="primary" variant="ghost">
            Gerir subscrição
          </UButton>
        </div>

        <UChatPrompt
          id="question"
          v-model="question"
          name="question"
          class="composer gemini-prompt"
          variant="soft"
          :rows="1"
          :maxrows="6"
          autoresize
          :placeholder="'Pergunte ao Ujimu.'"
          :disabled="!canWriteQuestion"
          @submit="submitQuestion"
        >
          <template #header>
            <div class="prompt-specialist-row">
              <span class="sr-only">{{ composerHelp }}</span>
              <USelect
                id="specialist-select"
                v-model="selectedSpecialistId"
                name="specialist-select"
                class="prompt-specialist-control"
                :items="specialistSelectItems"
                placeholder="Especialidade"
                aria-label="Especialidade"
                :disabled="isStreaming || specialistsPending"
                @update:model-value="selectSpecialistFromPrompt"
              />
            </div>
          </template>

          <template #footer>
            <div class="prompt-toolbar">
              <span class="prompt-plus-button" aria-hidden="true">
                <UIcon name="i-lucide-plus" />
              </span>
              <div class="prompt-action-group">
                <span class="prompt-mic-button" aria-hidden="true">
                  <UIcon name="i-lucide-mic" />
                </span>
                <UChatPromptSubmit
                  class="prompt-submit"
                  :status="'ready'"
                  :disabled="!canSubmitQuestion"
                  :aria-label="editingMessageId ? 'Enviar edição' : isStreaming ? 'Adicionar à fila' : 'Enviar pergunta'"
                />
              </div>
            </div>
          </template>
        </UChatPrompt>
      </section>

      <aside v-if="billingStatus.ads.visible" class="ad-panel" aria-label="Publicidade">
        <section aria-label="Publicidade" class="ads-section">
          <p class="section-label">Publicidade</p>
          <div class="ad-slot">300 × 250</div>
          <div class="ad-slot wide">728 × 90</div>
        </section>
      </aside>
    </section>
  </main>

  <AuthModal
    v-model:open="authPanelOpen"
    :auth-session="authSession"
    @authenticated="handleAuthenticatedSession"
  />
</template>

<style scoped>
.home-shell {
  width: min(1280px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 0;
}

.app-shell-bar {
  position: sticky;
  top: 16px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  margin-bottom: 18px;
  border: 1px solid var(--ujimu-line);
  border-radius: 999px;
  padding: 6px 12px 6px 6px;
  color: var(--ujimu-muted);
  background: rgba(10, 10, 10, 0.78);
  backdrop-filter: blur(18px);
  font-weight: 800;
}

.workspace > * {
  border: 1px solid var(--ujimu-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.section-label {
  margin: 0 0 10px;
  color: var(--ujimu-yellow);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  letter-spacing: -0.045em;
  line-height: 0.98;
}

h1 {
  max-width: 780px;
  font-size: clamp(2rem, 4vw, 3.6rem);
}

h2 {
  font-size: clamp(1.6rem, 3vw, 2.35rem);
}

h3 {
  font-size: 1rem;
}

.workspace {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 18px;
  margin-top: 18px;
}

.workspace-chat-only {
  grid-template-columns: 1fr;
}

.chat-panel,
.ad-panel {
  border-radius: 28px;
  padding: 22px;
}

.panel-note {
  margin: 24px 0 0;
  color: var(--ujimu-muted);
  line-height: 1.45;
}

.panel-note.error {
  color: #ffd3d3;
}

.drawer-history-panel {
  display: grid;
  gap: 12px;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 14px;
}

.drawer-history-heading,
.history-actions,
.message-actions,
.editing-banner,
.subscription-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.drawer-history-heading small,
.history-list small {
  color: var(--ujimu-muted);
}

.drawer-history-heading h2 {
  font-size: 1rem;
}

.drawer-history-panel .panel-note {
  margin: 0;
}

.history-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-list li {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.16);
}

.history-list li.active {
  border-color: rgba(249, 214, 22, 0.4);
  background: rgba(249, 214, 22, 0.1);
}

.history-list strong {
  color: #f7f4e8;
  line-height: 1.25;
}

.chat-panel {
  display: grid;
  height: calc(100dvh - 128px);
  min-height: 640px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-auto-rows: auto;
  gap: 18px;
}

.chat-header,
.queue-panel > div:first-child {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.notice {
  border: 1px solid rgba(249, 214, 22, 0.3);
  border-radius: 20px;
  padding: 14px 16px;
  color: #fff8cc;
  background: var(--ujimu-yellow-soft);
  line-height: 1.45;
}

.messages {
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow: auto;
}

.empty-chat {
  display: grid;
  min-height: 260px;
  place-items: center;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 24px;
  padding: 28px;
  color: var(--ujimu-muted);
  text-align: center;
}

.empty-chat p {
  margin: 0 0 8px;
  font-size: 1.1rem;
}

.empty-chat small {
  color: var(--ujimu-faint);
}

.message {
  display: grid;
  gap: 8px;
  max-width: 86%;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 22px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.055);
}

.message-user {
  justify-self: end;
  background: rgba(249, 214, 22, 0.14);
}

.message-assistant {
  justify-self: start;
}

.message-label {
  margin: 0;
  color: var(--ujimu-yellow);
  font-size: 0.75rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.message-text {
  margin: 0;
  color: #f7f4e8;
  line-height: 1.55;
  white-space: pre-wrap;
}

.message-actions {
  justify-content: flex-end;
}

.citations {
  margin-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  padding-top: 12px;
}

.citations h3 {
  color: var(--ujimu-yellow);
}

.citations ol,
.queue-panel ol {
  display: grid;
  gap: 10px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.citations li,
.queue-panel li {
  display: grid;
  gap: 4px;
  border-radius: 16px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.18);
}

.citations span,
.citations small,
.queue-panel p,
.composer small {
  color: var(--ujimu-muted);
}

.quota-error {
  margin: 0;
  border: 1px solid rgba(249, 214, 22, 0.32);
  border-radius: 18px;
  padding: 12px 14px;
  color: #fff8cc;
  background: rgba(249, 214, 22, 0.12);
  line-height: 1.45;
  font-weight: 700;
}

.queue-panel {
  border: 1px solid rgba(249, 214, 22, 0.24);
  border-radius: 20px;
  padding: 14px;
  background: rgba(249, 214, 22, 0.08);
}

.queue-panel p {
  margin: 4px 0 0;
}

.queue-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.composer {
  color: var(--ujimu-muted);
  font-weight: 700;
}

.gemini-prompt {
  align-self: end;
  display: grid;
  width: min(860px, 100%);
  margin: 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  padding: 12px 14px 14px;
  background: rgba(36, 36, 36, 0.96);
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.32);
}

.gemini-prompt :deep([data-slot="header"]),
.gemini-prompt :deep([data-slot="footer"]) {
  padding: 0;
}

.gemini-prompt :deep([data-slot="body"]) {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.gemini-prompt :deep(textarea) {
  min-height: 44px;
  padding: 7px 8px 9px;
  color: #f7f4e8;
  background: transparent;
  line-height: 1.45;
  resize: none;
}

.gemini-prompt :deep(textarea::placeholder) {
  color: #c7c4bb;
}

.editing-banner,
.subscription-alert {
  border: 1px solid rgba(249, 214, 22, 0.24);
  border-radius: 16px;
  padding: 10px;
  color: #fff8cc;
  background: rgba(249, 214, 22, 0.1);
  line-height: 1.35;
}

.prompt-specialist-row {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  justify-content: flex-end;
}

.prompt-toolbar,
.prompt-action-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prompt-toolbar {
  width: 100%;
  justify-content: space-between;
}

.prompt-plus-button,
.prompt-mic-button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 999px;
  color: #f7f4e8;
}

.prompt-mic-button {
  color: #ddd9cf;
}

.prompt-specialist-control {
  width: min(260px, 100%);
  max-width: 260px;
  border-radius: 999px;
  color: #f7f4e8;
}

.prompt-submit {
  width: 42px;
  height: 42px;
  border-radius: 999px;
}

.ad-panel,
.ads-section {
  display: grid;
  align-content: start;
  gap: 14px;
}

.ads-section {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.14);
}

.ad-slot {
  display: grid;
  min-height: 250px;
  place-items: center;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 22px;
  color: var(--ujimu-faint);
  background: rgba(255, 255, 255, 0.035);
  font-weight: 800;
}

.ad-slot.wide {
  min-height: 90px;
}

@media (max-width: 1040px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .chat-panel {
    height: calc(100dvh - 104px);
    min-height: 560px;
  }

  .message {
    max-width: 100%;
  }
}

@media (max-width: 720px) {
  .gemini-prompt {
    border-radius: 28px;
    padding: 12px;
  }

  .gemini-prompt :deep(textarea) {
    min-height: 48px;
    padding: 8px 4px;
  }

}
</style>
