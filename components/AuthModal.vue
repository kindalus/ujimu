<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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

interface PasskeyAuthenticationOptionsResponse {
  options: Record<string, unknown>
}

interface DevAuthStatusResponse {
  enabled: boolean
}

interface FeaturesResponse {
  otpChannels: Array<'email' | 'phone'>
}

const props = withDefaults(defineProps<{
  open: boolean
  authSession: AuthSessionResponse
  purpose?: 'login' | 'add-contact' | 'verify'
}>(), { purpose: 'login' })

const emit = defineEmits<{
  'update:open': [value: boolean]
  authenticated: [session: AuthSessionResponse]
}>()

const otpRequestSuccessMessage = 'Se o contacto estiver correcto, enviaremos um código de acesso.'

const authChannel = ref<'email' | 'phone'>('email')
const authContact = ref('')
const authCode = ref('')
const authStep = ref<'request' | 'verify'>('request')
const authMessage = ref('')
const authError = ref('')
const authPending = ref(false)
const passkeysSupported = ref(false)
const passkeyPending = ref(false)
const passkeyError = ref('')
const devAuthAvailable = ref(false)
const devAuthPending = ref(false)
const otpChannels = ref<Array<'email' | 'phone'>>([])

onMounted(() => {
  void detectPasskeySupport()
  void loadDevAuthStatus()
  void loadFeatures()
})

const modalOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    emit('update:open', value)
    if (!value) resetAuthState()
  }
})
const accountLoginAvailable = computed(() => otpChannels.value.length > 0)
const passkeySignInAvailable = computed(
  () => props.purpose === 'login' && accountLoginAvailable.value && passkeysSupported.value && Boolean(props.authSession.passkeys?.passkeysEnabled && props.authSession.passkeys.passkeysConfigured)
)
const authTitle = computed(() => {
  if (props.purpose === 'add-contact') return 'Adicionar contacto'
  if (props.purpose === 'verify') return 'Confirmar identidade'
  return 'Entrar na Ujimu'
})
const authSubtitle = computed(() => props.purpose === 'login'
  ? 'Sem palavra-passe — enviamos-lhe um código de utilização única.'
  : 'Enviaremos um código de utilização única para confirmar o contacto.'
)

async function detectPasskeySupport(): Promise<void> {
  try {
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser')
    passkeysSupported.value = browserSupportsWebAuthn()
  } catch {
    passkeysSupported.value = false
  }
}

async function loadFeatures(): Promise<void> {
  try {
    const response = await fetch('/api/features')
    const payload = response.ok ? (await response.json()) as FeaturesResponse : { otpChannels: [] }
    otpChannels.value = payload.otpChannels.filter((channel) => channel === 'email' || channel === 'phone')
    authChannel.value = otpChannels.value[0] ?? 'email'
  } catch {
    otpChannels.value = []
  }
}

async function loadDevAuthStatus(): Promise<void> {
  try {
    const response = await fetch('/api/auth/dev-login')
    if (!response.ok) return
    const payload = (await response.json()) as DevAuthStatusResponse
    devAuthAvailable.value = payload.enabled
  } catch {
    devAuthAvailable.value = false
  }
}

async function requestOtpCode(): Promise<void> {
  authPending.value = true
  authError.value = ''
  authMessage.value = ''

  try {
    const response = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: authChannel.value, contact: authContact.value })
    })

    if (!response.ok) {
      authError.value = response.status === 503
        ? 'Não foi possível enviar o código neste momento. Tente novamente mais tarde.'
        : 'Verifique o contacto e tente novamente.'
      return
    }

    authStep.value = 'verify'
    authMessage.value = otpRequestSuccessMessage
  } catch {
    authError.value = 'Não foi possível enviar o código neste momento. Tente novamente mais tarde.'
  } finally {
    authPending.value = false
  }
}

async function verifyOtpCode(): Promise<void> {
  authPending.value = true
  authError.value = ''

  try {
    const response = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: authChannel.value,
        contact: authContact.value,
        code: authCode.value
      })
    })

    if (!response.ok) {
      authError.value = response.status === 409
        ? 'Este contacto já pertence a outra conta.'
        : 'Código inválido ou expirado.'
      return
    }

    emit('authenticated', (await response.json()) as AuthSessionResponse)
    resetAndClose()
  } catch {
    authError.value = 'Não foi possível verificar o código. Tente novamente.'
  } finally {
    authPending.value = false
  }
}

async function signInWithDevContact(): Promise<void> {
  if (!authContact.value.trim()) {
    authError.value = 'Indique o contacto autorizado para desenvolvimento.'
    return
  }

  devAuthPending.value = true
  authError.value = ''
  authMessage.value = ''

  try {
    const response = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: authChannel.value, contact: authContact.value })
    })

    if (!response.ok) {
      authError.value = response.status === 403
        ? 'Contacto não autorizado para modo de desenvolvimento.'
        : 'O modo de desenvolvimento não está disponível.'
      return
    }

    emit('authenticated', (await response.json()) as AuthSessionResponse)
    resetAndClose()
  } catch {
    authError.value = 'Não foi possível entrar em modo de desenvolvimento.'
  } finally {
    devAuthPending.value = false
  }
}

async function signInWithPasskey(): Promise<void> {
  if (!passkeysSupported.value) {
    passkeyError.value = 'Este dispositivo ou navegador não suporta passkeys. Use o código por email ou telemóvel.'
    return
  }

  passkeyPending.value = true
  passkeyError.value = ''

  try {
    const optionsResponse = await fetch('/api/auth/passkeys/authentication/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    if (!optionsResponse.ok) {
      passkeyError.value = 'Não foi possível confirmar a passkey. Tente novamente ou use o código de acesso.'
      return
    }

    const { startAuthentication } = await import('@simplewebauthn/browser')
    const payload = (await optionsResponse.json()) as PasskeyAuthenticationOptionsResponse
    const credential = await startAuthentication({
      optionsJSON: payload.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON']
    })
    const verifyResponse = await fetch('/api/auth/passkeys/authentication/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credential)
    })

    if (!verifyResponse.ok) {
      passkeyError.value = 'Não foi possível confirmar a passkey. Tente novamente ou use o código de acesso.'
      return
    }

    emit('authenticated', (await verifyResponse.json()) as AuthSessionResponse)
    resetAndClose()
  } catch {
    passkeyError.value = 'Não foi possível confirmar a passkey. Tente novamente ou use o código de acesso.'
  } finally {
    passkeyPending.value = false
  }
}

function handleOtpInput(index: number, event: Event): void {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  if (!input) return
  const digit = input.value.replace(/\D/g, '').slice(-1)
  const digits = authCode.value.padEnd(6, ' ').split('')
  digits[index] = digit || ' '
  authCode.value = digits.join('').replace(/\s/g, '')
  input.value = digit
  if (digit && index < 5) {
    const next = input.parentElement?.querySelectorAll<HTMLInputElement>('.otp-cell')[index + 1]
    next?.focus()
  }
}

function handleOtpKeydown(index: number, event: KeyboardEvent): void {
  if (event.key !== 'Backspace') return
  const input = event.target instanceof HTMLInputElement ? event.target : null
  if (!input || input.value || index === 0) return
  const previous = input.parentElement?.querySelectorAll<HTMLInputElement>('.otp-cell')[index - 1]
  previous?.focus()
}

function resetAuthState(): void {
  authStep.value = 'request'
  authContact.value = ''
  authCode.value = ''
  authMessage.value = ''
  authError.value = ''
  passkeyError.value = ''
}

function resetAndClose(): void {
  resetAuthState()
  emit('update:open', false)
}
</script>

<template>
  <UModal v-model:open="modalOpen" :close="false" class="auth-modal" :ui="{ content: 'modal auth-modal-content' }">
    <template #content>
      <div class="modal-head">
        <button v-if="authStep === 'verify'" class="iconbtn" type="button" aria-label="Voltar" @click="authStep = 'request'"><UjimuIcon name="chevLeft" /></button>
        <span v-else />
        <button class="iconbtn" type="button" aria-label="Fechar" @click="resetAndClose"><UjimuIcon name="close" /></button>
      </div>

      <form v-if="authStep === 'request' && accountLoginAvailable" class="auth-form" @submit.prevent="requestOtpCode">
        <h2 id="auth-title" class="modal-title">{{ authTitle }}</h2>
        <p class="modal-sub">{{ authSubtitle }}</p>

        <div v-if="passkeySignInAvailable" class="auth-actions">
          <button class="btn btn--ghost" type="button" :disabled="!passkeysSupported || passkeyPending" @click="signInWithPasskey">
            {{ passkeyPending ? 'A confirmar…' : 'Entrar com passkey' }}
          </button>
        </div>
        <p v-if="passkeyError" class="auth-error" role="alert">{{ passkeyError }}</p>

        <div class="seg" role="group" aria-label="Canal de autenticação">
          <button v-if="otpChannels.includes('email')" class="seg-opt" :class="{ 'seg-opt--on': authChannel === 'email' }" type="button" @click="authChannel = 'email'"><UjimuIcon name="mail" /> Email</button>
          <button v-if="otpChannels.includes('phone')" class="seg-opt" :class="{ 'seg-opt--on': authChannel === 'phone' }" type="button" @click="authChannel = 'phone'"><UjimuIcon name="phone" /> Telemóvel</button>
        </div>

        <input id="auth-contact" v-model="authContact" name="contact" class="field" :type="authChannel === 'email' ? 'email' : 'tel'" :placeholder="authChannel === 'email' ? 'o.seu@email.com' : '+244 9XX XXX XXX'" :disabled="authPending" />

        <p v-if="authMessage" class="auth-message">{{ authMessage }}</p>
        <p v-if="authError" class="auth-error" role="alert">{{ authError }}</p>

        <div v-if="purpose === 'login' && devAuthAvailable && authContact.trim()" class="dev-auth-panel" aria-label="Modo de desenvolvimento">
          <p><strong>Modo de desenvolvimento</strong></p>
          <p>Activo apenas em desenvolvimento com UJIMU_DEV_AUTH_ENABLED.</p>
          <button class="btn btn--ghost" type="button" :disabled="authPending || devAuthPending" @click="signInWithDevContact">
            {{ devAuthPending ? 'A entrar…' : 'Entrar em modo desenvolvimento' }}
          </button>
        </div>

        <button class="btn btn--primary btn--block" type="submit" :disabled="authPending">{{ authPending ? 'A enviar…' : 'Enviar código' }}</button>
      </form>

      <div v-else-if="authStep === 'request'" class="auth-form">
        <h2 id="auth-title" class="modal-title">Contas temporariamente indisponíveis</h2>
        <p class="modal-sub">Pode continuar a consultar como visitante.</p>
      </div>

      <form v-else class="auth-form" @submit.prevent="verifyOtpCode">
        <h2 id="auth-title" class="modal-title">Introduza o código</h2>
        <p class="modal-sub">Enviámos um código de 6 dígitos para <strong>{{ authContact }}</strong>.</p>
        <div class="otp-row">
          <input
            v-for="index in 6"
            :key="index"
            class="otp-cell"
            :name="`otp-digit-${index}`"
            inputmode="numeric"
            maxlength="1"
            :value="authCode[index - 1] || ''"
            :disabled="authPending"
            :autofocus="index === 1"
            @input="handleOtpInput(index - 1, $event)"
            @keydown="handleOtpKeydown(index - 1, $event)"
          />
        </div>
        <p class="modal-hint">Introduza o código recebido para continuar.</p>
        <p v-if="authError" class="auth-error" role="alert">{{ authError }}</p>
        <button class="btn btn--primary btn--block" type="submit" :disabled="authPending">{{ authPending ? 'A verificar…' : 'Verificar código' }}</button>
      </form>
    </template>
  </UModal>
</template>

<style scoped>
.auth-form { display: flex; flex-direction: column; gap: 14px; padding: 4px 18px 0; align-items: stretch; }
.auth-actions, .auth-field { display: grid; gap: 8px; }
.auth-field span { color: var(--muted); font-size: var(--fs-micro); letter-spacing: .08em; text-transform: uppercase; }
.dev-auth-panel { display: grid; gap: 8px; border: 1px solid var(--line); border-radius: 14px; padding: 10px; background: var(--yellow-soft); }
.dev-auth-panel p { margin: 0; color: var(--muted); font-size: var(--fs-ui); line-height: 1.35; }
.dev-auth-panel strong { color: var(--ink); }
.auth-message, .auth-error { margin: 0; line-height: 1.4; font-size: var(--fs-ui); }
.auth-message { color: var(--ink); }
.auth-error { color: var(--danger); }
</style>
