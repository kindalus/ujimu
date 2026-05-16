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

interface PublicPasskeyCredential {
  id: string
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
}

interface PasskeyListResponse {
  passkeys: PublicPasskeyCredential[]
}

interface PasskeyRegistrationOptionsResponse {
  options: Record<string, unknown>
}

const session = ref<AuthSessionResponse>({ authenticated: false })
const passkeys = ref<PublicPasskeyCredential[]>([])
const pending = ref(false)
const loading = ref(true)
const passkeysSupported = ref(false)
const feedback = ref('')
const errorMessage = ref('')

onMounted(() => {
  void detectPasskeySupport()
  void loadSecurityState()
})

const passkeysAvailable = computed(
  () => Boolean(session.value.passkeys?.passkeysEnabled && session.value.passkeys.passkeysConfigured)
)
const canAddPasskey = computed(
  () => session.value.authenticated && session.value.recentOtpAuthenticated && passkeysSupported.value && passkeysAvailable.value
)

async function detectPasskeySupport(): Promise<void> {
  try {
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser')
    passkeysSupported.value = browserSupportsWebAuthn()
  } catch {
    passkeysSupported.value = false
  }
}

async function loadSecurityState(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const sessionResponse = await fetch('/api/auth/session')
    session.value = sessionResponse.ok
      ? ((await sessionResponse.json()) as AuthSessionResponse)
      : { authenticated: false }

    if (session.value.authenticated) {
      const passkeysResponse = await fetch('/api/auth/passkeys')
      if (passkeysResponse.ok) {
        const payload = (await passkeysResponse.json()) as PasskeyListResponse
        passkeys.value = payload.passkeys
      }
    }
  } catch {
    errorMessage.value = 'Não foi possível carregar a segurança da conta.'
  } finally {
    loading.value = false
  }
}

async function addPasskey(): Promise<void> {
  if (!canAddPasskey.value) return
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''

  try {
    const optionsResponse = await fetch('/api/auth/passkeys/registration/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    if (!optionsResponse.ok) {
      errorMessage.value = optionsResponse.status === 403
        ? 'Volte a entrar por código para adicionar uma passkey.'
        : 'Não foi possível iniciar a criação da passkey.'
      return
    }

    const { startRegistration } = await import('@simplewebauthn/browser')
    const payload = (await optionsResponse.json()) as PasskeyRegistrationOptionsResponse
    const credential = await startRegistration({
      optionsJSON: payload.options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON']
    })
    const verifyResponse = await fetch('/api/auth/passkeys/registration/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credential)
    })

    if (!verifyResponse.ok) {
      errorMessage.value = 'Não foi possível guardar a passkey.'
      return
    }

    feedback.value = 'Passkey adicionada.'
    await loadSecurityState()
  } catch {
    errorMessage.value = 'Não foi possível guardar a passkey.'
  } finally {
    pending.value = false
  }
}

async function removePasskey(credentialId: string): Promise<void> {
  const confirmed = window.confirm('Remover esta passkey? Poderá continuar a entrar com código por email ou telemóvel.')
  if (!confirmed) return

  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
    if (!response.ok) {
      errorMessage.value = 'Não foi possível remover a passkey.'
      return
    }

    feedback.value = 'Passkey removida. Pode continuar a entrar com código por email ou telemóvel.'
    await loadSecurityState()
  } catch {
    errorMessage.value = 'Não foi possível remover a passkey.'
  } finally {
    pending.value = false
  }
}

function formatDate(value: string | null): string {
  if (!value) return 'Nunca usada'
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <main class="security-shell" aria-labelledby="security-title">
    <header class="security-hero">
      <div>
        <p class="section-label">Conta</p>
        <h1 id="security-title">Segurança da conta</h1>
        <p>Gira as passkeys da sua conta. Pode continuar a entrar com código por email ou telemóvel.</p>
      </div>
      <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
    </header>

    <section class="security-card">
      <p v-if="loading" class="muted">A carregar segurança da conta...</p>
      <div v-else-if="!session.authenticated" role="alert" class="state-box">
        <h2>Tem de iniciar sessão.</h2>
        <p>Volte ao chat e entre com código antes de gerir passkeys.</p>
      </div>

      <div v-else class="security-stack">
        <div class="state-box">
          <h2>Ligado como {{ session.user?.displayContact }}</h2>
          <p v-if="!passkeysAvailable">As passkeys não estão activas neste ambiente.</p>
          <p v-else-if="session.recentOtpAuthenticated">Pode adicionar uma passkey nesta sessão.</p>
          <p v-else>Volte a entrar por código para adicionar uma passkey.</p>
          <p v-if="!passkeysSupported">Este dispositivo ou navegador não suporta passkeys. Use o código por email ou telemóvel.</p>
        </div>

        <div class="actions-row">
          <UButton type="button" color="primary" :loading="pending" :disabled="!canAddPasskey" @click="addPasskey">
            Adicionar passkey
          </UButton>
        </div>

        <section aria-labelledby="passkeys-title" class="passkeys-list">
          <h2 id="passkeys-title">Passkeys activas</h2>
          <p v-if="passkeys.length === 0" class="muted">Ainda não tem passkeys registadas.</p>
          <ol v-else>
            <li v-for="credential in passkeys" :key="credential.id">
              <div>
                <strong>Passkey criada em {{ formatDate(credential.createdAt) }}</strong>
                <small>Última utilização: {{ formatDate(credential.lastUsedAt) }}</small>
              </div>
              <UButton type="button" color="error" variant="soft" size="sm" :loading="pending" @click="removePasskey(credential.id)">
                Remover
              </UButton>
            </li>
          </ol>
        </section>
      </div>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="security-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.security-shell {
  width: min(920px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 0;
}

.security-hero,
.security-card {
  border: 1px solid var(--ujimu-line);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.security-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: clamp(24px, 4vw, 42px);
}

.security-card {
  display: grid;
  gap: 18px;
  margin-top: 18px;
  padding: 22px;
}

.security-hero h1,
.security-card h2 {
  margin: 0;
  letter-spacing: -0.045em;
}

.security-hero p:not(.section-label),
.muted,
.state-box p,
.passkeys-list small {
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

.security-stack,
.passkeys-list,
.passkeys-list ol,
.state-box {
  display: grid;
  gap: 12px;
}

.state-box,
.passkeys-list li {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.18);
}

.actions-row,
.passkeys-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.passkeys-list ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.passkeys-list strong,
.feedback {
  color: #fff8cc;
  font-weight: 800;
}

.security-error {
  color: #ffd3d3;
  font-weight: 800;
}

.feedback,
.security-error {
  margin: 18px 0 0;
  border-radius: 18px;
  padding: 12px 14px;
  background: rgba(249, 214, 22, 0.1);
}

@media (max-width: 760px) {
  .security-hero,
  .actions-row,
  .passkeys-list li {
    display: grid;
  }
}
</style>
