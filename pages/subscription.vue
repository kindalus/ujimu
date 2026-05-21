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

interface BillingCheckoutResponse {
  checkout: {
    id: string
    provider: BillingProvider
    method: BillingPaymentMethod
    status: 'pending'
    instructions: string
  }
}

type BillingProvider = 'appy_pay' | 'stripe'
type BillingPaymentMethod = 'multicaixa_express' | 'multicaixa_reference' | 'qr_code' | 'visa'

interface BillingMethodOption {
  label: string
  provider: BillingProvider
  method: BillingPaymentMethod
}

const billingCheckoutSuccessMessage = 'Pagamento criado. A subscrição será activada depois da confirmação do pagamento.'
const defaultBillingStatus: BillingStatusResponse = {
  authenticated: false,
  subscribed: false,
  plan: { amount: { value: '50000.00', currency: 'AOA' } },
  subscription: null,
  expiryWarning: null,
  ads: { visible: true }
}
const billingMethodOptions: BillingMethodOption[] = [
  { label: 'Multicaixa Express', provider: 'appy_pay', method: 'multicaixa_express' },
  { label: 'Referência Multicaixa', provider: 'appy_pay', method: 'multicaixa_reference' },
  { label: 'QR Code', provider: 'appy_pay', method: 'qr_code' },
  { label: 'VISA', provider: 'stripe', method: 'visa' }
]

const authSession = ref<AuthSessionResponse>({ authenticated: false })
const adminAvailable = ref(false)
const authPanelOpen = ref(false)
const billingStatus = ref<BillingStatusResponse>({ ...defaultBillingStatus })
const billingPending = ref(false)
const billingError = ref('')
const billingMessage = ref('')
const billingCheckoutPendingMethod = ref<BillingPaymentMethod | ''>('')

onMounted(() => {
  void loadAuthSession()
})

const isAuthenticated = computed(() => authSession.value.authenticated)
const billingPriceLabel = computed(() => `${formatBillingAmount(billingStatus.value.plan.amount.value)} AOA`)
const billingExpiryLabel = computed(() => formatDisplayDate(billingStatus.value.subscription?.expiresAt))
const subscriptionStateLabel = computed(() => billingStatus.value.subscribed ? 'Activa' : 'Por activar')

async function loadAuthSession(): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    authSession.value = response.ok
      ? ((await response.json()) as AuthSessionResponse)
      : { authenticated: false }
  } catch {
    authSession.value = { authenticated: false }
  }
  void loadAdminSession()
  void loadBillingStatus()
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

async function loadBillingStatus(): Promise<void> {
  billingPending.value = true
  billingError.value = ''

  try {
    const response = await fetch('/api/billing/status')
    billingStatus.value = response.ok
      ? ((await response.json()) as BillingStatusResponse)
      : { ...defaultBillingStatus }
  } catch {
    billingStatus.value = { ...defaultBillingStatus }
    billingError.value = 'Não foi possível carregar o estado da subscrição.'
  } finally {
    billingPending.value = false
  }
}

async function startBillingCheckout(provider: BillingProvider, method: BillingPaymentMethod): Promise<void> {
  if (!isAuthenticated.value) {
    billingError.value = 'Entre para subscrever.'
    authPanelOpen.value = true
    return
  }

  billingCheckoutPendingMethod.value = method
  billingError.value = ''
  billingMessage.value = ''

  try {
    const response = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, method })
    })

    if (response.status === 401) {
      authPanelOpen.value = true
      billingError.value = 'Entre para subscrever.'
      return
    }

    if (!response.ok) {
      billingError.value = 'Não foi possível iniciar o pagamento.'
      return
    }

    const payload = (await response.json()) as BillingCheckoutResponse
    billingMessage.value = payload.checkout.instructions || billingCheckoutSuccessMessage
    void loadBillingStatus()
  } catch {
    billingError.value = 'Não foi possível iniciar o pagamento.'
  } finally {
    billingCheckoutPendingMethod.value = ''
  }
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
  void loadAdminSession()
  void loadBillingStatus()
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  authSession.value = { authenticated: false }
  adminAvailable.value = false
  authPanelOpen.value = false
  billingStatus.value = { ...defaultBillingStatus }
  billingMessage.value = ''
  billingError.value = ''
  void loadBillingStatus()
}

function formatBillingAmount(value: string): string {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return '50 000,00'
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(parsed)
}

function formatDisplayDate(value: string | undefined): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(value))
}
</script>

<template>
  <main class="subscription-shell" aria-labelledby="subscription-title">
    <div class="app-shell-bar">
      <AppDrawer
        :is-authenticated="isAuthenticated"
        :admin-available="adminAvailable"
        :user-label="authSession.user?.displayContact"
        open-label="Abrir navegação"
        @open-auth="authPanelOpen = true"
        @logout="logout"
      />
      <span>Ujimu</span>
    </div>

    <header class="subscription-hero">
      <div>
        <p class="section-label">Subscrição</p>
        <h1 id="subscription-title">Plano trimestral — 50 000,00 AOA</h1>
        <p>Remova publicidade e use os limites de subscritor durante três meses.</p>
      </div>
      <div class="hero-actions">
        <UBadge color="primary" variant="soft" size="lg">{{ subscriptionStateLabel }}</UBadge>
        <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
      </div>
    </header>

    <section class="subscription-grid" aria-label="Gestão da subscrição">
      <section class="subscription-card" aria-labelledby="plan-title">
        <p class="section-label">Plano</p>
        <h2 id="plan-title">{{ billingPriceLabel }} <span>por trimestre</span></h2>

        <p v-if="billingPending" class="muted">A carregar subscrição...</p>
        <template v-else>
          <p v-if="billingStatus.subscribed" class="state-text">
            Subscrição activa até {{ billingExpiryLabel }}. Não verá publicidade enquanto a subscrição estiver activa.
          </p>
          <p v-else class="state-text">
            Entre para subscrever, remover publicidade e usar os limites de subscritor.
          </p>
          <p v-if="billingStatus.expiryWarning" class="state-warning" role="alert">
            A sua subscrição termina em menos de uma semana.
          </p>
        </template>

        <p v-if="billingMessage" class="state-message">{{ billingMessage }}</p>
        <p v-if="billingError" class="state-error" role="alert">{{ billingError }}</p>

        <div class="billing-actions" aria-label="Métodos de pagamento">
          <UButton
            v-for="option in billingMethodOptions"
            :key="option.method"
            type="button"
            color="primary"
            variant="soft"
            :loading="billingCheckoutPendingMethod === option.method"
            @click="startBillingCheckout(option.provider, option.method)"
          >
            {{ option.label }}
          </UButton>
        </div>
      </section>

      <aside class="subscription-card support-card" aria-labelledby="support-title">
        <p class="section-label">Lançamento</p>
        <h2 id="support-title">Pagamento em modo de preparação</h2>
        <p class="muted">Os métodos listados validam o fluxo de checkout. A activação automática por pagamento real será ligada depois do lançamento.</p>
        <ul>
          <li>Appy Pay: Multicaixa Express, Referência Multicaixa e QR Code.</li>
          <li>VISA: integração prevista por Stripe.</li>
          <li>Sem período de graça depois do fim da subscrição.</li>
        </ul>
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
.subscription-shell {
  width: min(1100px, calc(100% - 32px));
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

.subscription-hero,
.subscription-card {
  border: 1px solid var(--ujimu-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.subscription-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  border-radius: 28px;
  padding: clamp(24px, 4vw, 42px);
}

.subscription-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 18px;
  margin-top: 18px;
}

.subscription-card {
  display: grid;
  align-content: start;
  gap: 16px;
  border-radius: 24px;
  padding: 22px;
}

.hero-actions,
.billing-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
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
h2 {
  margin: 0;
  letter-spacing: -0.045em;
  line-height: 0.98;
}

h1 {
  max-width: 780px;
  font-size: clamp(2.2rem, 5vw, 4.8rem);
}

h2 {
  font-size: clamp(1.6rem, 3vw, 2.35rem);
}

h2 span,
.subscription-hero p:not(.section-label),
.muted,
.state-text,
.support-card li {
  color: var(--ujimu-muted);
  line-height: 1.45;
}

.subscription-hero p:not(.section-label),
.state-text,
.muted,
.state-warning,
.state-message,
.state-error {
  margin: 0;
}

.state-warning,
.state-message,
.state-error {
  border-radius: 16px;
  padding: 10px;
  line-height: 1.35;
  font-size: 0.9rem;
  font-weight: 800;
}

.state-warning,
.state-message {
  color: #fff8cc;
  background: rgba(249, 214, 22, 0.11);
}

.state-error {
  color: #ffd3d3;
  background: rgba(210, 16, 52, 0.16);
}

.support-card ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 20px;
}

@media (max-width: 860px) {
  .subscription-hero,
  .subscription-grid {
    grid-template-columns: 1fr;
  }

  .subscription-hero {
    display: grid;
  }

  .hero-actions {
    justify-content: flex-start;
  }
}
</style>
