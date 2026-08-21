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
    status: 'pending'
    instructions: string
  }
}

const billingCheckoutSuccessMessage = 'Pedido de subscrição criado. A subscrição será activada depois da confirmação operacional.'
const fallbackBillingPriceLabel = '50 000,00 AOA'
const defaultBillingStatus: BillingStatusResponse = {
  authenticated: false,
  subscribed: false,
  plan: { amount: { value: '50000.00', currency: 'AOA' } },
  subscription: null,
  expiryWarning: null,
  ads: { visible: true }
}
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const adminAvailable = ref(false)
const authPanelOpen = ref(false)
const billingStatus = ref<BillingStatusResponse>({ ...defaultBillingStatus })
const billingPending = ref(false)
const billingError = ref('')
const billingMessage = ref('')
const billingCheckoutPending = ref(false)

onMounted(() => {
  void loadAuthSession()
})

const isAuthenticated = computed(() => authSession.value.authenticated)
const billingPriceLabel = computed(() => {
  const formatted = formatBillingAmount(billingStatus.value.plan.amount.value)
  return formatted ? `${formatted} AOA` : fallbackBillingPriceLabel
})
const billingExpiryLabel = computed(() => formatDisplayDate(billingStatus.value.subscription?.expiresAt))

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

async function startBillingCheckout(): Promise<void> {
  if (!isAuthenticated.value) {
    billingError.value = 'Entre para subscrever.'
    authPanelOpen.value = true
    return
  }

  billingCheckoutPending.value = true
  billingError.value = ''
  billingMessage.value = ''

  try {
    const response = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'appy_pay', method: 'multicaixa_express' })
    })

    if (response.status === 401) {
      authPanelOpen.value = true
      billingError.value = 'Entre para subscrever.'
      return
    }

    if (!response.ok) {
      billingError.value = 'Não foi possível registar o pedido de subscrição.'
      return
    }

    await response.json() as BillingCheckoutResponse
    billingMessage.value = billingCheckoutSuccessMessage
    void loadBillingStatus()
  } catch {
    billingError.value = 'Não foi possível registar o pedido de subscrição.'
  } finally {
    billingCheckoutPending.value = false
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
  <main class="subpage" aria-labelledby="subscription-title" data-screen-label="Subscrição — Planos">
    <NuxtLink class="btn btn--ghost btn--back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>
    <h1 id="subscription-title" class="subpage-title">Subscrição</h1>
    <p class="subpage-sub">Consulte sem limite diário e sem publicidade.</p>

    <div v-if="billingStatus.expiryWarning" class="warnbar" role="alert">
      <UjimuIcon name="info" />
      <span>A sua subscrição termina em menos de uma semana. Renove para manter o acesso sem publicidade.</span>
      <button class="btn btn--primary btn--xs" type="button" :disabled="billingCheckoutPending" @click="startBillingCheckout">Renovar agora</button>
    </div>

    <p v-if="billingPending" class="adm-foot-note">A carregar subscrição...</p>
    <p v-if="billingMessage" class="plan-current--on"><UjimuIcon name="check" /> {{ billingMessage }}</p>
    <p v-if="billingError" class="errbar" role="alert"><UjimuIcon name="info" /><span>{{ billingError }}</span></p>

    <div class="plans plans--three">
      <div class="plan">
        <span class="plan-name">Gratuito</span>
        <span class="plan-price">0 AOA</span>
        <ul class="plan-list">
          <li>10 pedidos/dia · 40/semana (anónimo)</li>
          <li>40 pedidos/dia · 200/semana (com sessão)</li>
          <li>Publicidade no fluxo da conversa</li>
          <li>Histórico por especialidade (com sessão)</li>
        </ul>
        <span v-if="!billingStatus.subscribed" class="plan-current">Plano actual</span>
      </div>

      <div class="plan plan--featured" :class="{ 'plan--active': billingStatus.subscribed }">
        <span class="plan-name">Subscritor</span>
        <span class="plan-price">{{ billingPriceLabel }}<span class="plan-per">/trimestre</span></span>
        <ul class="plan-list">
          <li>Sem limite diário</li>
          <li>Limite semanal configurável para subscritores</li>
          <li>Sem publicidade</li>
          <li>Tudo o que tem o plano gratuito</li>
        </ul>
        <span v-if="billingStatus.subscribed" class="plan-current plan-current--on"><UjimuIcon name="check" /> Subscrição activa</span>
        <button v-else class="btn btn--primary btn--block" type="button" :disabled="billingCheckoutPending" @click="startBillingCheckout">
          {{ isAuthenticated ? (billingCheckoutPending ? 'A preparar subscrição…' : 'Subscrever') : 'Entrar para subscrever' }}
        </button>
      </div>

      <div class="plan">
        <span class="plan-name">Empresa</span>
        <span class="plan-price">Sob consulta<span class="plan-per">/trimestre</span></span>
        <ul class="plan-list">
          <li>Tudo o que tem o plano Subscritor</li>
          <li>Lugares para toda a equipa</li>
          <li>Gestão centralizada de contas e administradores</li>
          <li>Acesso a especialistas reservados à empresa</li>
        </ul>
        <button v-if="!isAuthenticated" class="btn btn--primary btn--block" type="button" @click="authPanelOpen = true">Entrar para configurar</button>
        <NuxtLink v-else class="btn btn--primary btn--block" to="/companies">Configurar empresa</NuxtLink>
      </div>
    </div>

    <div v-if="billingStatus.subscribed" class="sub-manage">
      <h2 class="sub-manage-title">Gerir subscrição</h2>
      <div class="sub-manage-row">
        <span>Subscrição activa até <strong>{{ billingExpiryLabel }}</strong></span>
      </div>
      <div class="sub-manage-row">
        <span>Limite semanal: <strong>configurado para subscritores</strong></span>
      </div>
      <div class="sub-manage-row">
        <span>Publicidade: <strong>removida enquanto a subscrição estiver activa</strong></span>
      </div>
    </div>
  </main>

  <AuthModal
    v-model:open="authPanelOpen"
    :auth-session="authSession"
    @authenticated="handleAuthenticatedSession"
  />
</template>

<style scoped>
a.btn { text-decoration: none; }
</style>
