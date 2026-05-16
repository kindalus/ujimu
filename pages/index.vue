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

interface ChatCitation {
  sourceTitle: string
  sourceFile?: string
  articleRefs: string[]
}

type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ChatCitation }
  | { type: 'done'; grounded: boolean }
  | { type: 'error'; code: string; message: string }

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations: ChatCitation[]
  grounded?: boolean
  status: 'streaming' | 'done' | 'error'
}

interface QueuedQuestion {
  id: string
  text: string
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
const isStreaming = ref(false)

onMounted(() => {
  void loadSpecialists()
})

const selectedSpecialist = computed(() =>
  specialists.value.find((specialist) => specialist.id === selectedSpecialistId.value)
)
const hasSpecialists = computed(() => specialists.value.length > 0)
const canWriteQuestion = computed(
  () => Boolean(selectedSpecialist.value) && queuedQuestions.value.length < queueLimit
)
const canSubmitQuestion = computed(() => canWriteQuestion.value && question.value.trim().length > 0)
const statusLabel = computed(() => {
  if (isStreaming.value) return 'A responder'
  if (selectedSpecialist.value) return 'Preparado'
  return 'Seleccione'
})
const composerHelp = computed(() => {
  if (!hasSpecialists.value) return 'Ainda não há especialidades disponíveis.'
  if (!selectedSpecialist.value) return 'Seleccione uma especialidade antes de escrever.'
  if (queuedQuestions.value.length >= queueLimit) return 'A fila de perguntas está cheia.'
  if (isStreaming.value) return 'A pergunta será adicionada à fila.'
  return 'A resposta será apresentada por partes e com fontes no fim.'
})

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
}

function submitQuestion(): void {
  const text = question.value.trim()
  if (!canSubmitQuestion.value || !text) return

  question.value = ''

  if (isStreaming.value) {
    queuedQuestions.value.push({ id: createId('queued'), text })
    return
  }

  void startQuestion(text)
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

async function startQuestion(text: string): Promise<void> {
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
    status: 'streaming'
  }

  messages.value.push(userMessage, assistantMessage)
  isStreaming.value = true

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specialistId,
        question: text,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    })

    if (!response.ok) {
      assistantMessage.text = 'Não foi possível enviar a pergunta. Verifique a especialidade seleccionada e tente novamente.'
      assistantMessage.status = 'error'
      assistantMessage.grounded = false
      return
    }

    await readChatStream(response, assistantMessage)
  } catch {
    assistantMessage.text ||= 'Não foi possível receber a resposta. Tente novamente dentro de alguns minutos.'
    assistantMessage.status = 'error'
    assistantMessage.grounded = false
  } finally {
    if (assistantMessage.status === 'streaming') {
      assistantMessage.status = 'done'
    }

    isStreaming.value = false
    const nextQuestion = queuedQuestions.value.shift()
    if (nextQuestion) {
      void startQuestion(nextQuestion.text)
    }
  }
}

async function readChatStream(response: Response, assistantMessage: ChatMessage): Promise<void> {
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
      handleChatEventLine(line, assistantMessage)
    }

    if (done) break
  }

  if (buffer.trim()) {
    handleChatEventLine(buffer, assistantMessage)
  }
}

function handleChatEventLine(line: string, assistantMessage: ChatMessage): void {
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

  if (event.type === 'done') {
    assistantMessage.grounded = event.grounded
    assistantMessage.status = 'done'
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
    if (['delta', 'citation', 'done', 'error'].includes(parsed.type)) {
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
    <section class="hero-panel">
      <div class="brand-mark" aria-hidden="true">U</div>
      <p class="eyebrow">Ujimu</p>
      <h1 id="page-title">Consulte especialistas com respostas citadas.</h1>
      <p class="hero-copy">
        Escolha uma especialidade, faça a sua pergunta e confirme a resposta nas
        fontes apresentadas no fim.
      </p>
    </section>

    <section class="workspace" aria-label="Área de consulta">
      <aside class="specialist-panel" aria-labelledby="specialist-title">
        <p class="section-label">Especialidade</p>
        <h2 id="specialist-title">Escolha uma especialidade</h2>

        <p v-if="specialistsPending" class="panel-note">A carregar especialidades...</p>
        <p v-else-if="specialistsError" class="panel-note error">
          Não foi possível carregar as especialidades.
        </p>
        <p v-else-if="!hasSpecialists" class="panel-note">
          Ainda não há especialidades disponíveis. Volte mais tarde.
        </p>

        <div v-else class="specialist-list" aria-label="Especialidades disponíveis">
          <UButton
            v-for="specialist in specialists"
            :key="specialist.id"
            type="button"
            :color="specialist.id === selectedSpecialistId ? 'primary' : 'neutral'"
            :variant="specialist.id === selectedSpecialistId ? 'soft' : 'ghost'"
            size="lg"
            block
            class="specialist-button"
            :disabled="isStreaming"
            @click="selectSpecialist(specialist.id)"
          >
            <span>{{ specialist.name }}</span>
            <small>{{ specialist.description }}</small>
          </UButton>
        </div>
      </aside>

      <section class="chat-panel" aria-labelledby="chat-title">
        <div class="chat-header">
          <div>
            <p class="section-label">Consulta</p>
            <h2 id="chat-title">
              {{ selectedSpecialist?.name ?? 'Faça uma pergunta' }}
            </h2>
          </div>
          <UBadge color="primary" variant="soft" size="lg">{{ statusLabel }}</UBadge>
        </div>

        <div class="notice" role="note">
          Conteúdo gerado por IA. Pode conter erros. Confirme sempre a resposta nas fontes citadas. As respostas não substituem aconselhamento profissional.
        </div>

        <div class="messages" aria-live="polite">
          <div v-if="messages.length === 0" class="empty-chat">
            <p>A resposta aparecerá aqui quando o chat estiver activo.</p>
            <small>As citações serão apresentadas no fim da resposta.</small>
          </div>

          <article
            v-for="message in messages"
            v-else
            :key="message.id"
            class="message"
            :class="`message-${message.role}`"
          >
            <p class="message-label">{{ message.role === 'user' ? 'Pergunta' : 'Resposta' }}</p>
            <p class="message-text">
              {{ message.text || (message.status === 'streaming' ? 'A preparar resposta...' : '') }}
            </p>

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
          </article>
        </div>

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

        <form class="composer" @submit.prevent="submitQuestion">
          <label for="question">Pergunta</label>
          <UTextarea
            id="question"
            v-model="question"
            :rows="4"
            placeholder="Escreva a sua pergunta depois de seleccionar uma especialidade."
            :disabled="!canWriteQuestion"
          />
          <div class="composer-actions">
            <small>{{ composerHelp }}</small>
            <UButton type="submit" color="primary" :disabled="!canSubmitQuestion">
              {{ isStreaming ? 'Adicionar à fila' : 'Enviar' }}
            </UButton>
          </div>
        </form>
      </section>

      <aside class="ad-panel" aria-label="Publicidade">
        <p class="section-label">Publicidade</p>
        <div class="ad-slot">300 × 250</div>
        <div class="ad-slot wide">728 × 90</div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.home-shell {
  width: min(1280px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 0;
}

.hero-panel,
.workspace > * {
  border: 1px solid var(--ujimu-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.hero-panel {
  position: relative;
  overflow: hidden;
  min-height: 260px;
  padding: clamp(28px, 5vw, 64px);
  border-radius: 32px;
}

.hero-panel::after {
  position: absolute;
  inset: auto -10% -50% 44%;
  height: 260px;
  content: "";
  background: radial-gradient(circle, rgba(249, 214, 22, 0.22), transparent 64%);
}

.brand-mark {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  margin-bottom: 22px;
  border-radius: 18px;
  color: #050505;
  background: var(--ujimu-yellow);
  font-weight: 900;
  box-shadow: 0 0 32px rgba(249, 214, 22, 0.34);
}

.eyebrow,
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
  font-size: clamp(3rem, 7vw, 6.7rem);
}

h2 {
  font-size: clamp(1.6rem, 3vw, 2.35rem);
}

h3 {
  font-size: 1rem;
}

.hero-copy {
  max-width: 720px;
  margin: 22px 0 0;
  color: var(--ujimu-muted);
  font-size: clamp(1.1rem, 2vw, 1.45rem);
  line-height: 1.5;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(180px, 240px);
  gap: 18px;
  margin-top: 18px;
}

.specialist-panel,
.chat-panel,
.ad-panel {
  border-radius: 28px;
  padding: 22px;
}

.specialist-list {
  display: grid;
  gap: 10px;
  margin-top: 24px;
}

.specialist-button {
  justify-content: flex-start;
  border-radius: 18px;
}

.specialist-button span,
.specialist-button small {
  display: block;
  text-align: left;
}

.specialist-button small {
  margin-top: 4px;
  color: var(--ujimu-muted);
  font-weight: 500;
}

.panel-note {
  margin: 24px 0 0;
  color: var(--ujimu-muted);
  line-height: 1.45;
}

.panel-note.error {
  color: #ffd3d3;
}

.chat-panel {
  display: grid;
  min-height: 640px;
  grid-template-rows: auto auto minmax(280px, 1fr) auto auto;
  gap: 18px;
}

.chat-header,
.composer-actions,
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
  display: grid;
  gap: 10px;
  color: var(--ujimu-muted);
  font-weight: 700;
}

.composer :deep(textarea) {
  resize: vertical;
  border-radius: 22px;
}

.ad-panel {
  display: grid;
  align-content: start;
  gap: 14px;
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
    min-height: 560px;
  }

  .message {
    max-width: 100%;
  }
}
</style>
