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

const props = defineProps<{
  open: boolean
  authSession: AuthSessionResponse
}>()

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

onMounted(() => {
  void detectPasskeySupport()
})

const modalOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value)
})
const passkeySignInAvailable = computed(
  () => passkeysSupported.value && Boolean(props.authSession.passkeys?.passkeysEnabled && props.authSession.passkeys.passkeysConfigured)
)

async function detectPasskeySupport(): Promise<void> {
  try {
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser')
    passkeysSupported.value = browserSupportsWebAuthn()
  } catch {
    passkeysSupported.value = false
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
      authError.value = 'Código inválido ou expirado.'
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

function resetAndClose(): void {
  modalOpen.value = false
  authStep.value = 'request'
  authContact.value = ''
  authCode.value = ''
  authMessage.value = ''
  authError.value = ''
  passkeyError.value = ''
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="Entrar"
    description="Receba um código por email ou telemóvel para continuar."
    class="auth-modal"
  >
    <template #body>
      <div class="auth-entry">
        <div class="auth-actions">
          <UButton
            v-if="passkeySignInAvailable"
            type="button"
            color="neutral"
            variant="soft"
            size="sm"
            :disabled="!passkeysSupported"
            :loading="passkeyPending"
            @click="signInWithPasskey"
          >
            Entrar com passkey
          </UButton>
        </div>
        <p v-if="passkeyError" class="auth-error" role="alert">{{ passkeyError }}</p>

        <form class="auth-form" @submit.prevent="authStep === 'request' ? requestOtpCode() : verifyOtpCode()">
          <div class="auth-channel" role="group" aria-label="Canal de autenticação">
            <UButton
              type="button"
              size="xs"
              :color="authChannel === 'email' ? 'primary' : 'neutral'"
              :variant="authChannel === 'email' ? 'soft' : 'ghost'"
              @click="authChannel = 'email'"
            >
              Email
            </UButton>
            <UButton
              type="button"
              size="xs"
              :color="authChannel === 'phone' ? 'primary' : 'neutral'"
              :variant="authChannel === 'phone' ? 'soft' : 'ghost'"
              @click="authChannel = 'phone'"
            >
              Telemóvel
            </UButton>
          </div>

          <label class="auth-field" for="auth-contact">
            <span>{{ authChannel === 'email' ? 'Email' : 'Telemóvel' }}</span>
            <UInput
              id="auth-contact"
              v-model="authContact"
              :placeholder="authChannel === 'email' ? 'nome@exemplo.com' : '+244923000000'"
              :disabled="authPending || authStep === 'verify'"
            />
          </label>

          <label v-if="authStep === 'verify'" class="auth-field" for="auth-code">
            <span>Código</span>
            <UInput id="auth-code" v-model="authCode" placeholder="123456" :disabled="authPending" />
          </label>

          <p v-if="authMessage" class="auth-message">{{ authMessage }}</p>
          <p v-if="authError" class="auth-error" role="alert">{{ authError }}</p>

          <UButton type="submit" color="primary" size="sm" :loading="authPending">
            {{ authStep === 'request' ? 'Enviar código' : 'Verificar código' }}
          </UButton>
        </form>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.auth-entry,
.auth-channel,
.auth-form,
.auth-field {
  display: grid;
  gap: 10px;
}

.auth-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.auth-channel {
  grid-template-columns: repeat(2, max-content);
}

.auth-field {
  color: var(--ujimu-muted);
  font-size: 0.9rem;
  font-weight: 800;
}

.auth-message,
.auth-error {
  margin: 0;
  line-height: 1.4;
  font-size: 0.9rem;
}

.auth-message {
  color: #fff8cc;
}

.auth-error {
  color: #ffd3d3;
}
</style>
