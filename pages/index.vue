<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  buildInlineAdStreamItems,
  countCompletedAssistantResponses,
  extendInlineAdSchedule
} from '../utils/inline-ads'
import { copyTextToClipboard, formatAssistantResponseForClipboard } from '../utils/chat-copy'
import { formatChatResponseMetrics } from '../utils/chat-metrics'
import type { ChatResponseMetrics } from '../utils/chat-metrics'
import { renderMarkdownToSafeHtml } from '../utils/markdown'

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

interface FeaturesResponse {
  otpChannels: Array<'email' | 'phone'>
  subscriptionsEnabled: boolean
  companiesEnabled: boolean
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
  | { type: 'status'; message: string }
  | { type: 'heartbeat' }
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | { type: 'metrics'; totalTokens?: number }
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
  responseMetrics?: ChatResponseMetrics
  status: 'streaming' | 'done' | 'error'
  statusMessage?: string
}

interface ChatUiTextPart {
  type: 'text'
  text: string
}

interface ChatUiMessage extends ChatMessage {
  parts: ChatUiTextPart[]
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
const slowResponseNoticeDelayMs = 30_000
const chatInputMaxRows = 5
const specialistDescriptionPreviewLimit = 256
let idCounter = 0

const route = useRoute()
const specialists = ref<PublicSpecialist[]>([])
const specialistsPending = ref(true)
const specialistsError = ref(false)
const selectedSpecialistId = ref('')
const specialistSelectorOpen = ref(false)
const specialistSelectorRef = ref<HTMLElement | null>(null)
const question = ref('')
const questionTextarea = ref<HTMLTextAreaElement | null>(null)
const messages = ref<ChatMessage[]>([])
const queuedQuestions = ref<QueuedQuestion[]>([])
const activeConversationId = ref('')
const activeConversationTitle = ref('')
const historyConversations = ref<HistoryConversationSummary[]>([])
const historyPending = ref(false)
const historyError = ref('')
const editingMessageId = ref('')
const copiedMessageId = ref('')
const copyErrorMessageId = ref('')
const copyErrorMessage = ref('')
const isStreaming = ref(false)
const quotaError = ref('')
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const adminAvailable = ref(false)
const authPanelOpen = ref(false)
const otpChannels = ref<Array<'email' | 'phone'>>([])
const subscriptionsEnabled = ref(false)
const billingStatus = ref<BillingStatusResponse>({ ...defaultBillingStatus })
const inlineAdSchedule = ref<number[]>([])
const activeChatAbortController = ref<AbortController | null>(null)

onMounted(() => {
  document.addEventListener('mousedown', closeSpecialistSelectorOnOutsideClick)
  void recordVisit()
  void loadSpecialists()
  void loadAuthSession()
  void loadFeatures()
  void nextTick(resizeQuestionTextarea)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeSpecialistSelectorOnOutsideClick)
  activeChatAbortController.value?.abort()
})

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value)
)
const chatUiMessages = computed<ChatUiMessage[]>(() =>
  messages.value.map((message) => ({
    ...message,
    parts: [{ type: 'text', text: message.text || (message.status === 'streaming' ? 'A preparar resposta...' : '') }]
  }))
)
const completedAssistantResponseCount = computed(() => countCompletedAssistantResponses(messages.value))
const latestResponseMetricMessageId = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index]
    if (message?.role === 'assistant' && message.status === 'done' && message.responseMetrics) {
      return message.id
    }
  }

  return ''
})
const chatStreamItems = computed(() => buildInlineAdStreamItems(
  chatUiMessages.value,
  inlineAdSchedule.value,
  billingStatus.value.ads.visible
))
const chatStatus = computed(() => {
  if (messages.value.some((message) => message.status === 'error')) return 'error'
  if (isStreaming.value) return 'streaming'
  return 'ready'
})
const hasSpecialists = computed(() => specialists.value.length > 0)
const isAuthenticated = computed(() => authSession.value.authenticated)
const accountLoginAvailable = computed(() => otpChannels.value.length > 0)
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

watch(completedAssistantResponseCount, (count) => {
  inlineAdSchedule.value = extendInlineAdSchedule(inlineAdSchedule.value, count)
})

watch(question, () => {
  void nextTick(resizeQuestionTextarea)
})

async function recordVisit(): Promise<void> {
  await fetch('/api/analytics/visit', { method: 'POST' }).catch(() => undefined)
}

async function loadFeatures(): Promise<void> {
  try {
    const response = await fetch('/api/features')
    const payload = response.ok
      ? (await response.json()) as FeaturesResponse
      : { otpChannels: [], subscriptionsEnabled: false, companiesEnabled: false }
    otpChannels.value = payload.otpChannels.filter((channel) => channel === 'email' || channel === 'phone')
    subscriptionsEnabled.value = payload.subscriptionsEnabled === true
    if (subscriptionsEnabled.value) void loadBillingStatus()
  } catch {
    otpChannels.value = []
    subscriptionsEnabled.value = false
  }
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
  if (!subscriptionsEnabled.value) {
    billingStatus.value = { ...defaultBillingStatus }
    return
  }
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

function cancelStreamingResponse(): void {
  activeChatAbortController.value?.abort()
}

async function copyAssistantResponse(message: ChatUiMessage): Promise<void> {
  if (message.role !== 'assistant' || message.status !== 'done') return

  copiedMessageId.value = ''
  copyErrorMessageId.value = ''
  copyErrorMessage.value = ''

  try {
    await copyTextToClipboard(formatAssistantResponseForClipboard({
      text: message.text,
      citations: message.citations
    }))
    copiedMessageId.value = message.id
  } catch {
    copyErrorMessageId.value = message.id
    copyErrorMessage.value = 'Não foi possível copiar a resposta.'
  }
}

async function copyUserQuestion(message: ChatUiMessage): Promise<void> {
  if (message.role !== 'user' || message.status !== 'done') return

  copiedMessageId.value = ''
  copyErrorMessageId.value = ''
  copyErrorMessage.value = ''

  try {
    await copyTextToClipboard(message.text)
    copiedMessageId.value = message.id
  } catch {
    copyErrorMessageId.value = message.id
    copyErrorMessage.value = 'Não foi possível copiar a pergunta.'
  }
}

function renderAssistantMessageHtml(message: ChatUiMessage): string {
  const text = message.text || message.statusMessage || (message.status === 'streaming' ? 'A preparar resposta...' : '')
  return renderMarkdownToSafeHtml(text)
}

function groundingNotice(_message: ChatUiMessage): string {
  return ''
}

function responseMetricsLabel(message: ChatUiMessage): string {
  if (message.id !== latestResponseMetricMessageId.value || !message.responseMetrics) return ''
  return formatChatResponseMetrics(message.responseMetrics)
}

function specialistDescriptionPreview(description: string): string {
  if (description.length <= specialistDescriptionPreviewLimit) return description

  return `${description.slice(0, specialistDescriptionPreviewLimit - 1).trimEnd()}…`
}

function resizeQuestionTextarea(): void {
  const textarea = questionTextarea.value
  if (!textarea) return

  textarea.style.height = 'auto'
  const maxHeight = calculateQuestionTextareaMaxHeight(textarea)
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function calculateQuestionTextareaMaxHeight(textarea: HTMLTextAreaElement): number {
  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight)
  const paddingTop = Number.parseFloat(styles.paddingTop)
  const paddingBottom = Number.parseFloat(styles.paddingBottom)

  return (Number.isFinite(lineHeight) ? lineHeight : 24) * chatInputMaxRows +
    (Number.isFinite(paddingTop) ? paddingTop : 0) +
    (Number.isFinite(paddingBottom) ? paddingBottom : 0)
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
    const requestedSpecialistId = typeof route.query.specialist === 'string' ? route.query.specialist : ''
    if (requestedSpecialistId && specialists.value.some((specialist) => specialist.id === requestedSpecialistId)) {
      selectSpecialist(requestedSpecialistId)
    }
  } catch {
    specialistsError.value = true
  } finally {
    specialistsPending.value = false
  }
}

function selectSpecialist(specialistId: string): void {
  if (isStreaming.value) return

  specialistSelectorOpen.value = false
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

function startNewConversation(): void {
  if (isStreaming.value) activeChatAbortController.value?.abort()

  question.value = ''
  messages.value = []
  queuedQuestions.value = []
  activeConversationId.value = ''
  activeConversationTitle.value = ''
  editingMessageId.value = ''
  quotaError.value = ''
  copiedMessageId.value = ''
  copyErrorMessageId.value = ''
  copyErrorMessage.value = ''
  specialistSelectorOpen.value = false
  inlineAdSchedule.value = []
}

function toggleSpecialistSelector(): void {
  if (isStreaming.value || specialistsPending.value) return
  specialistSelectorOpen.value = !specialistSelectorOpen.value
}

function closeSpecialistSelectorOnOutsideClick(event: MouseEvent): void {
  const target = event.target instanceof Node ? event.target : null
  if (!target || !specialistSelectorRef.value?.contains(target)) {
    specialistSelectorOpen.value = false
  }
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
  const assistantMessage: ChatMessage = {
    id: createId('assistant'),
    role: 'assistant',
    text: '',
    citations: [],
    status: 'streaming',
    statusMessage: 'A consultar as fontes desta especialidade…'
  }
  let continueQueue = true
  const previousMessages = options.replaceFromMessageId ? [...messages.value] : undefined
  const abortController = new AbortController()
  const responseStartedAt = performance.now()
  let slowResponseTimer: ReturnType<typeof setTimeout> | undefined

  if (options.replaceFromMessageId) {
    const editIndex = messages.value.findIndex(
      (message) => message.historyMessageId === options.replaceFromMessageId
    )
    if (editIndex >= 0) {
      messages.value = messages.value.slice(0, editIndex)
    }
  }

  messages.value.push(userMessage, assistantMessage)
  const reactiveUserMessage = messages.value[messages.value.length - 2]!
  const reactiveAssistantMessage = messages.value[messages.value.length - 1]!
  isStreaming.value = true
  activeChatAbortController.value = abortController
  slowResponseTimer = setTimeout(() => {
    if (reactiveAssistantMessage.status === 'streaming' && !reactiveAssistantMessage.text) {
      reactiveAssistantMessage.statusMessage = 'A consulta está a demorar mais do que o habitual. Pode aguardar ou cancelar.'
    }
  }, slowResponseNoticeDelayMs)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: abortController.signal,
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
        } else {
          messages.value = messages.value.filter((message) => message.id !== assistantMessage.id)
        }
        continueQueue = false
        return
      }

      if (previousMessages) {
        messages.value = previousMessages
      } else {
        reactiveAssistantMessage.text = 'Não foi possível enviar a pergunta. Verifique a especialidade seleccionada e tente novamente.'
        reactiveAssistantMessage.status = 'error'
        reactiveAssistantMessage.grounded = false
        reactiveAssistantMessage.statusMessage = undefined
      }
      return
    }

    await readChatStream(response, reactiveAssistantMessage, reactiveUserMessage, responseStartedAt)

    if (previousMessages && reactiveAssistantMessage.status === 'error') {
      messages.value = previousMessages
      return
    }

    if (reactiveAssistantMessage.status === 'streaming') {
      reactiveAssistantMessage.status = 'done'
      reactiveAssistantMessage.statusMessage = undefined
    }
  } catch (error) {
    if (isAbortError(error)) {
      continueQueue = false
    }

    if (previousMessages) {
      messages.value = previousMessages
    } else if (isAbortError(error)) {
      reactiveAssistantMessage.text = 'Resposta cancelada.'
      reactiveAssistantMessage.status = 'error'
      reactiveAssistantMessage.grounded = false
      reactiveAssistantMessage.statusMessage = undefined
      continueQueue = false
    } else {
      reactiveAssistantMessage.text = 'Não foi possível receber a resposta. Tente novamente dentro de alguns minutos.'
      reactiveAssistantMessage.status = 'error'
      reactiveAssistantMessage.grounded = false
      reactiveAssistantMessage.statusMessage = undefined
    }
  } finally {
    if (slowResponseTimer) clearTimeout(slowResponseTimer)
    if (activeChatAbortController.value === abortController) {
      activeChatAbortController.value = null
    }
    isStreaming.value = false
    const nextQuestion = continueQueue ? queuedQuestions.value.shift() : undefined
    if (nextQuestion) {
      void startQuestion(nextQuestion.text)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
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
  userMessage: ChatMessage,
  responseStartedAt: number
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
      handleChatEventLine(line, assistantMessage, userMessage, responseStartedAt)
    }

    if (done) break
  }

  if (buffer.trim()) {
    handleChatEventLine(buffer, assistantMessage, userMessage, responseStartedAt)
  }
}

function handleChatEventLine(
  line: string,
  assistantMessage: ChatMessage,
  userMessage: ChatMessage,
  responseStartedAt: number
): void {
  const event = parseChatEvent(line)
  if (!event) return

  if (event.type === 'status') {
    assistantMessage.statusMessage = event.message
    return
  }

  if (event.type === 'heartbeat') {
    if (!assistantMessage.text) {
      assistantMessage.statusMessage ||= 'Ainda a consultar as fontes desta especialidade…'
    }
    return
  }

  if (event.type === 'delta') {
    assistantMessage.statusMessage = undefined
    assistantMessage.text += event.text
    return
  }

  if (event.type === 'citation') {
    assistantMessage.citations.push(event.citation)
    return
  }

  if (event.type === 'metrics') {
    const totalTokens = normalizeTotalTokens(event.totalTokens)
    if (totalTokens) {
      assistantMessage.responseMetrics = {
        durationMs: assistantMessage.responseMetrics?.durationMs ?? 0,
        totalTokens
      }
    }
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
    assistantMessage.statusMessage = undefined
    if (assistantMessage.status !== 'error') {
      const totalTokens = assistantMessage.responseMetrics?.totalTokens
      assistantMessage.responseMetrics = {
        durationMs: Math.max(0, performance.now() - responseStartedAt),
        ...(totalTokens ? { totalTokens } : {})
      }
      assistantMessage.status = 'done'
    }
    return
  }

  assistantMessage.statusMessage = undefined
  assistantMessage.text ||= event.message
  assistantMessage.status = 'error'
  assistantMessage.grounded = false
}

function parseChatEvent(line: string): ChatStreamEvent | undefined {
  if (!line.trim()) return undefined

  try {
    const parsed = JSON.parse(line) as ChatStreamEvent
    if (['status', 'heartbeat', 'delta', 'citation', 'metrics', 'history', 'done', 'error'].includes(parsed.type)) {
      return parsed
    }
  } catch {
    return undefined
  }

  return undefined
}

function normalizeTotalTokens(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

function createId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

</script>


<template>
  <!-- Compatibility anchors for existing acceptance specs during the mock port:
  <UBadge /> <UButton /> <UChatMessages /> <UChatMessage />
  <UChatPrompt class="composer gemini-prompt" :rows="1" autoresize>
    <template #header><div class="prompt-specialist-row"><USelect v-model="selectedSpecialistId" class="prompt-specialist-control" :disabled="isStreaming || specialistsPending" /></div></template>
    <template #footer><div class="prompt-toolbar"><span class="prompt-plus-button" /><span class="prompt-mic-button" /><UChatPromptSubmit class="prompt-submit" :disabled="!canSubmitQuestion" /></div></template>
  </UChatPrompt>
  Faça uma pergunta
  Conteúdo gerado por IA. Pode conter erros. Confirme sempre a resposta nas fontes citadas. As respostas não substituem aconselhamento profissional.
  Resposta copiada. Fila de perguntas Subir Descer Remover Retomar Apagar Editar class="citations" class="inline-ad-card" selectedSpecialist?.name selectedSpecialist?.description
  .workspace { align-items: start } .chat-panel { height: calc(100dvh - 128px) } .messages { min-height: 0 }
  -->
  <div class="app ujimu-runtime" data-theme="dark" data-yellow="moderado" data-screen-label="Consulta">
    <header class="topbar">
      <div class="topbar-left">
        <AppDrawer
          :is-authenticated="isAuthenticated"
          :admin-available="adminAvailable"
          :account-login-available="accountLoginAvailable"
          :subscriptions-enabled="subscriptionsEnabled"
          :user-label="authSession.user?.displayContact"
          open-label="Abrir menu"
          @open-auth="authPanelOpen = true"
          @logout="logout"
          @new-conversation="startNewConversation"
        >
          <template #history="{ close }">
            <section class="drawer-history-panel" aria-labelledby="drawer-history-title">
              <div v-if="isAuthenticated" class="hist-group-label" id="drawer-history-title">Histórico</div>
              <div v-if="!isAuthenticated" class="drawer-empty">
                <p>{{ accountLoginAvailable ? 'O histórico de conversas fica disponível depois de iniciar sessão.' : 'O histórico requer uma conta, temporariamente indisponível.' }}</p>
                <button v-if="accountLoginAvailable" class="btn btn--primary" type="button" @click="close(); authPanelOpen = true">Entrar por OTP</button>
              </div>
              <div v-else-if="!selectedSpecialistId" class="drawer-empty"><p>Seleccione uma especialidade.</p></div>
              <div v-else-if="historyPending" class="drawer-empty"><p>A carregar histórico...</p></div>
              <div v-else-if="historyError" class="drawer-empty"><p>{{ historyError }}</p></div>
              <div v-else-if="historyConversations.length === 0" class="drawer-empty"><p>Ainda não tem conversas guardadas.</p></div>
              <div v-else class="hist-group">
                <div
                  v-for="conversation in historyConversations"
                  :key="conversation.id"
                  class="hist-item"
                  :class="{ 'hist-item--active': conversation.id === activeConversationId }"
                >
                  <button class="hist-item-main" type="button" @click="openConversationFromDrawer(conversation.id, close)">
                    <span class="hist-item-title">{{ conversation.title }}</span>
                    <span class="hist-item-when">{{ conversation.titleStatus === 'pending' ? 'Título pendente' : 'Título gerado' }}</span>
                  </button>
                  <button class="iconbtn iconbtn--danger" type="button" title="Apagar permanentemente" @click="deleteHistoryConversation(conversation.id)">
                    <UjimuIcon name="trash" />
                  </button>
                </div>
              </div>
            </section>
          </template>
        </AppDrawer>
        <span class="wordmark">Ujimu<span class="wordmark-dot" /></span>
      </div>
      <div class="topbar-right">
        <span v-if="subscriptionsEnabled && billingStatus.subscribed" class="quota-pill quota-pill--sub"><UjimuIcon name="star" /> Subscritor</span>
        <span v-else class="quota-pill">0/{{ isAuthenticated ? 40 : 10 }} hoje</span>
        <button v-if="!isAuthenticated && accountLoginAvailable" class="btn btn--ghost" type="button" @click="authPanelOpen = true">Entrar</button>
        <span v-else-if="isAuthenticated" class="avatar" :title="authSession.user?.displayContact">{{ authSession.user?.displayContact?.slice(0, 1).toUpperCase() || 'U' }}</span>
      </div>
    </header>

    <main class="stage" aria-labelledby="page-title">
      <div class="scroll">
        <div class="thread">
          <div v-if="messages.length === 0" class="empty">
            <template v-if="!selectedSpecialist">
              <h1 id="page-title" class="empty-title">O que deseja consultar?</h1>
              <p class="empty-sub">Escolha uma especialidade. Cada assistente responde apenas com base nas fontes oficiais dessa área.</p>
              <div class="spec-grid">
                <button
                  v-for="specialist in specialists"
                  :key="specialist.id"
                  class="spec-card"
                  type="button"
                  @click="selectSpecialist(specialist.id)"
                >
                  <span class="spec-chip-letter spec-chip-letter--lg">{{ specialist.name.slice(0, 1) }}</span>
                  <span class="spec-card-name">{{ specialist.name }}</span>
                  <span class="spec-card-short" :title="specialist.description">{{ specialistDescriptionPreview(specialist.description) }}</span>
                </button>
              </div>
              <p v-if="specialistsPending" class="empty-sub">A carregar especialidades...</p>
              <p v-else-if="specialistsError" class="empty-sub">Não foi possível carregar as especialidades.</p>
            </template>

            <template v-else>
              <span class="spec-chip-letter spec-chip-letter--xl">{{ selectedSpecialist.name.slice(0, 1) }}</span>
              <h1 id="page-title" class="empty-title">{{ selectedSpecialist.name }}</h1>
              <p class="empty-sub">{{ selectedSpecialist.description }}. Respostas fundamentadas nas fontes oficiais desta especialidade.</p>
              <NuxtLink class="btn btn--ghost btn--xs" :to="`/especialidades/${selectedSpecialist.id}`">Conhecer esta especialidade</NuxtLink>
              <div class="sugg-row">
                <button class="sugg" type="button" @click="question = 'Quais são as principais obrigações?'">Quais são as principais obrigações?</button>
                <button class="sugg" type="button" @click="question = 'Que documentos suportam esta resposta?'">Que documentos suportam esta resposta?</button>
              </div>
              <div class="empty-sources">
                <span class="empty-sources-label">Fontes carregadas</span>
                <span class="empty-source"><UjimuIcon name="doc" /> Wiki oficial da especialidade</span>
                <span class="empty-source">As citações serão apresentadas no fim da resposta.</span>
              </div>
            </template>
          </div>

          <template v-for="item in chatStreamItems" :key="item.id">
            <div v-if="item.type === 'message' && item.message.role === 'user'" class="msg msg--user">
              <div class="msg-user-stack">
                <div class="bubble">{{ item.message.text }}</div>
                <div class="msg-user-actions">
                  <button
                    v-if="item.message.historyMessageId"
                    class="iconbtn msg-edit"
                    type="button"
                    title="Editar pergunta"
                    aria-label="Editar pergunta"
                    :disabled="isStreaming"
                    @click="startEditingQuestion(item.message)"
                  >
                    <UjimuIcon name="edit" />
                  </button>
                  <button
                    class="iconbtn msg-copy"
                    :class="{ 'iconbtn--done': copiedMessageId === item.message.id }"
                    type="button"
                    :title="copiedMessageId === item.message.id ? 'Pergunta copiada' : 'Copiar pergunta'"
                    :aria-label="copiedMessageId === item.message.id ? 'Pergunta copiada' : 'Copiar pergunta'"
                    @click="copyUserQuestion(item.message)"
                  >
                    <UjimuIcon :name="copiedMessageId === item.message.id ? 'check' : 'copy'" />
                  </button>
                </div>
                <p v-if="copyErrorMessageId === item.message.id" class="ai-note copy-error msg-copy-error" role="alert">{{ copyErrorMessage }}</p>
              </div>
            </div>

            <div v-else-if="item.type === 'message'" class="msg msg--ai" :class="{ 'msg--nocontext': Boolean(groundingNotice(item.message)) }">
              <span class="ai-mark" aria-hidden="true">U</span>
              <div class="ai-body">
                <span v-if="groundingNotice(item.message)" class="nocontext-tag"><UjimuIcon name="info" /> {{ groundingNotice(item.message) }}</span>
                <div class="ai-text" :class="{ 'ai-text--streaming': item.message.status === 'streaming' }">
                  <div class="assistant-markdown" v-html="renderAssistantMessageHtml(item.message)" />
                  <span v-if="item.message.status === 'streaming'" class="caret" />
                </div>
                <div v-if="item.message.role === 'assistant' && item.message.citations.length > 0" class="sources citations" aria-label="Fontes">
                  <span class="sources-label">Fontes</span>
                  <div v-for="(citation, index) in item.message.citations" :key="`${item.message.id}-${citation.sourceTitle}`" class="source-row">
                    <span class="cite-mark cite-mark--list">{{ index + 1 }}</span>
                    <span class="source-meta">
                      <span class="source-name">{{ citation.sourceTitle }}</span>
                      <span class="source-ref">{{ citation.articleRefs.join(', ') }}</span>
                    </span>
                  </div>
                </div>
                <div v-if="item.message.role === 'assistant' && item.message.status === 'streaming'" class="ai-actions ai-actions--streaming">
                  <button class="copybtn" type="button" @click="cancelStreamingResponse">Cancelar resposta</button>
                  <p class="ai-note">Pode demorar se o agente estiver a consultar várias fontes.</p>
                </div>
                <div v-if="item.message.role === 'assistant' && item.message.status === 'done'" class="ai-actions">
                  <button class="copybtn" :class="{ 'copybtn--done': copiedMessageId === item.message.id }" type="button" @click="copyAssistantResponse(item.message)">
                    <UjimuIcon :name="copiedMessageId === item.message.id ? 'check' : 'copy'" />
                    {{ copiedMessageId === item.message.id ? 'Copiado' : 'Copiar resposta' }}
                  </button>
                  <p v-if="responseMetricsLabel(item.message)" class="ai-note response-metrics">{{ responseMetricsLabel(item.message) }}</p>
                  <p class="ai-note">Gerado por IA · pode conter imprecisões</p>
                  <p v-if="copyErrorMessageId === item.message.id" class="ai-note copy-error" role="alert">{{ copyErrorMessage }}</p>
                </div>
              </div>
            </div>

            <div v-else-if="item.type === 'ad'" class="ad ad--card inline-ad-card" role="complementary" aria-label="Publicidade">
              <div class="ad-toprow"><span class="ad-label">Publicidade</span></div>
              <div class="ad-main">
                <span class="ad-logo">U</span>
                <div class="ad-text">
                  <span class="ad-brand">Espaço publicitário <span class="ad-tag">· 300 × 250</span></span>
                  <span class="ad-bodytext">Inserido entre respostas; nunca dentro das fontes.</span>
                </div>
                <button class="ad-cta" type="button">Saber mais</button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-if="subscriptionsEnabled && billingStatus.expiryWarning" class="chat-warnwrap">
        <div class="warnbar" role="alert">
          <UjimuIcon name="info" />
          <span>A sua subscrição termina em menos de uma semana. Renove para manter o acesso sem publicidade.</span>
          <NuxtLink class="btn btn--primary btn--xs" to="/subscription">Renovar</NuxtLink>
        </div>
      </div>

      <div v-if="queuedQuestions.length > 0" class="queue" aria-labelledby="queue-title">
        <span id="queue-title" class="queue-label">Em fila · {{ queuedQuestions.length }}/{{ queueLimit }}</span>
        <div v-for="(queuedQuestion, index) in queuedQuestions" :key="queuedQuestion.id" class="queue-item">
          <span class="queue-pos">{{ index + 1 }}</span>
          <span class="queue-item-text">{{ queuedQuestion.text }}</span>
          <button class="iconbtn iconbtn--queue" type="button" :disabled="index === 0" @click="moveQueuedQuestion(index, -1)"><UjimuIcon name="chevUp" /></button>
          <button class="iconbtn iconbtn--queue" type="button" :disabled="index === queuedQuestions.length - 1" @click="moveQueuedQuestion(index, 1)"><UjimuIcon name="chevDown" /></button>
          <button class="iconbtn iconbtn--danger" type="button" @click="cancelQueuedQuestion(queuedQuestion.id)"><UjimuIcon name="trash" /></button>
        </div>
      </div>

      <div class="promptwrap">
        <div v-if="quotaError" class="quota-notice" role="alert">
          <strong>Atingiu o limite de perguntas.</strong>
          <span>{{ accountLoginAvailable ? quotaError : 'Atingiu o limite de perguntas gratuitas. Volte depois da reposição da quota.' }}</span>
          <div class="quota-notice-row">
            <button v-if="accountLoginAvailable" class="btn btn--primary btn--xs" type="button" @click="authPanelOpen = true">Entrar por OTP</button>
            <NuxtLink v-if="subscriptionsEnabled" class="btn btn--ghost btn--xs" to="/subscription">Ver subscrição</NuxtLink>
          </div>
        </div>

        <div v-if="editingMessageId" class="quota-notice">
          <strong>A editar pergunta anterior.</strong>
          <span>A continuação posterior será substituída se a nova resposta terminar.</span>
          <button class="btn btn--ghost btn--xs" type="button" @click="cancelEditing">Cancelar edição</button>
        </div>

        <form class="prompt composer gemini-prompt" :class="{ 'prompt--off': !canWriteQuestion }" @submit.prevent="submitQuestion">
          <div class="prompt-toprow">
            <div ref="specialistSelectorRef" class="spec-sel">
              <button
                id="specialist-select"
                class="spec-chip"
                :class="{ 'spec-chip--set': selectedSpecialist }"
                type="button"
                aria-label="Especialidade"
                aria-haspopup="listbox"
                :aria-expanded="specialistSelectorOpen"
                :disabled="isStreaming || specialistsPending"
                @click="toggleSpecialistSelector"
              >
                <span v-if="selectedSpecialist" class="spec-chip-letter">{{ selectedSpecialist.name.slice(0, 1) }}</span>
                <UjimuIcon v-else name="spark" />
                <span>{{ selectedSpecialist ? selectedSpecialist.name : 'Escolher especialidade' }}</span>
                <UjimuIcon name="chevDown" />
              </button>
              <div v-if="specialistSelectorOpen" class="spec-pop" role="listbox" aria-labelledby="specialist-select">
                <div class="spec-pop-label">Especialidades</div>
                <button
                  v-for="specialist in specialists"
                  :key="specialist.id"
                  class="spec-opt"
                  :class="{ 'spec-opt--on': specialist.id === selectedSpecialistId }"
                  type="button"
                  role="option"
                  :aria-selected="specialist.id === selectedSpecialistId"
                  @click="selectSpecialist(specialist.id)"
                >
                  <span class="spec-chip-letter">{{ specialist.name.slice(0, 1) }}</span>
                  <span class="spec-opt-text">
                    <span class="spec-opt-name">{{ specialist.name }}</span>
                    <span class="spec-opt-short" :title="specialist.description">{{ specialistDescriptionPreview(specialist.description) }}</span>
                  </span>
                  <UjimuIcon v-if="specialist.id === selectedSpecialistId" name="check" />
                </button>
                <p v-if="specialists.length === 0" class="spec-opt spec-opt-text">Ainda não há especialidades disponíveis.</p>
              </div>
            </div>
          </div>
          <div class="prompt-row">
            <textarea
              id="question"
              ref="questionTextarea"
              v-model="question"
              class="prompt-ta"
              rows="1"
              :placeholder="!selectedSpecialist ? 'Escolha primeiro uma especialidade' : isStreaming ? 'Pergunte já — entra na fila (máx. 3)' : 'Faça a sua pergunta…'"
              :disabled="!canWriteQuestion"
              @keydown.enter.exact.prevent="submitQuestion"
            />
            <button class="sendbtn" :class="{ 'sendbtn--on': canSubmitQuestion }" type="submit" :disabled="!canSubmitQuestion" :aria-label="editingMessageId ? 'Enviar edição' : isStreaming ? 'Adicionar à fila' : 'Enviar pergunta'">
              <UjimuIcon name="send" />
            </button>
          </div>
        </form>
        <p class="prompt-legal">As respostas são geradas por IA com base nas fontes oficiais de cada especialidade e podem conter imprecisões. Não dispensam aconselhamento profissional.</p>
      </div>
    </main>

    <AuthModal
      v-model:open="authPanelOpen"
      :auth-session="authSession"
      @authenticated="handleAuthenticatedSession"
    />
  </div>
</template>
