<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface AuthSessionResponse {
  authenticated: boolean
  user?: { id: string; displayName?: string | null; displayContact: string }
  authMethod?: 'otp' | 'passkey' | 'unknown'
  recentOtpAuthenticated?: boolean
  passkeys?: {
    passkeysEnabled: boolean
    passkeysConfigured: boolean
  }
}

interface FeaturesResponse {
  otpChannels: Array<'email' | 'phone'>
  subscriptionsEnabled: boolean
  companiesEnabled: boolean
}

interface UserCompany {
  id: string
  name: string
  nif: string
  role: 'admin' | 'member'
  active: boolean
}

interface ProfileContact {
  id: string
  channel: 'email' | 'phone'
  contact: string
  primary: boolean
  verifiedAt: string
}

interface ProfileResponse {
  authenticated: boolean
  user?: { id: string; displayName?: string | null; displayContact: string }
  contacts: ProfileContact[]
  verifiedEmails: string[]
  companies: UserCompany[]
  activeCompany: UserCompany | null
}

const emptyProfile = (): ProfileResponse => ({ authenticated: false, contacts: [], verifiedEmails: [], companies: [], activeCompany: null })
const profile = ref<ProfileResponse>(emptyProfile())
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const authPanelOpen = ref(false)
const authPanelPurpose = ref<'login' | 'add-contact' | 'verify'>('login')
const otpChannels = ref<Array<'email' | 'phone'>>([])
const subscriptionsEnabled = ref(false)
const companiesEnabled = ref(false)
const selectedCompanyId = ref('')
const displayName = ref('')
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const displayContact = computed(() => profile.value.user?.displayContact ?? '')
const accountLoginAvailable = computed(() => otpChannels.value.length > 0)
const userInitial = computed(() => (profile.value.user?.displayName || displayContact.value).slice(0, 1).toUpperCase() || 'U')
const isEmailContact = computed(() => displayContact.value.includes('@'))
const planLabel = computed(() => {
  if (companiesEnabled.value && profile.value.activeCompany) return `Empresa — ${profile.value.activeCompany.name}`
  return 'Gratuito'
})
onMounted(() => {
  void loadProfile()
  void loadFeatures()
})

async function loadFeatures(): Promise<void> {
  try {
    const response = await fetch('/api/features')
    const payload = response.ok
      ? (await response.json()) as FeaturesResponse
      : { otpChannels: [], subscriptionsEnabled: false, companiesEnabled: false }
    otpChannels.value = payload.otpChannels.filter((channel) => channel === 'email' || channel === 'phone')
    subscriptionsEnabled.value = payload.subscriptionsEnabled === true
    companiesEnabled.value = payload.companiesEnabled === true
  } catch {
    otpChannels.value = []
    subscriptionsEnabled.value = false
    companiesEnabled.value = false
  }
}

async function loadProfile(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [profileResponse, sessionResponse] = await Promise.all([
      fetch('/api/account/profile'),
      fetch('/api/auth/session')
    ])
    profile.value = profileResponse.ok ? ((await profileResponse.json()) as ProfileResponse) : emptyProfile()
    authSession.value = sessionResponse.ok
      ? ((await sessionResponse.json()) as AuthSessionResponse)
      : { authenticated: profile.value.authenticated, user: profile.value.user }
    selectedCompanyId.value = profile.value.activeCompany?.id ?? ''
    displayName.value = profile.value.user?.displayName ?? ''
  } catch {
    errorMessage.value = 'Não foi possível carregar o perfil.'
    authSession.value = { authenticated: false }
  } finally {
    loading.value = false
  }
}

async function saveDisplayName(): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: displayName.value })
    })
    if (!response.ok) {
      errorMessage.value = 'Indique um nome válido com até 100 caracteres.'
      return
    }
    feedback.value = 'Nome actualizado.'
    notifySessionChanged()
    await loadProfile()
  } catch {
    errorMessage.value = 'Não foi possível actualizar o nome.'
  } finally {
    pending.value = false
  }
}

function openAuth(purpose: 'login' | 'add-contact' | 'verify'): void {
  authPanelPurpose.value = purpose
  authPanelOpen.value = true
}

async function makePrimary(contact: ProfileContact): Promise<void> {
  await mutateContact(`/api/account/contacts/${encodeURIComponent(contact.id)}/primary`, 'PUT', 'Contacto principal actualizado.')
}

async function deleteContact(contact: ProfileContact): Promise<void> {
  if (!window.confirm(`Remover o contacto ${contact.contact}?`)) return
  await mutateContact(`/api/account/contacts/${encodeURIComponent(contact.id)}`, 'DELETE', 'Contacto removido.')
}

async function mutateContact(path: string, method: 'PUT' | 'DELETE', successMessage: string): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch(path, { method })
    if (response.status === 403) {
      errorMessage.value = 'Confirme primeiro a sua identidade com um código OTP recente.'
      openAuth('verify')
      return
    }
    if (!response.ok) {
      errorMessage.value = response.status === 409
        ? 'Esta operação deixaria a conta sem um contacto de entrada válido.'
        : 'Não foi possível actualizar o contacto.'
      return
    }
    feedback.value = successMessage
    notifySessionChanged()
    await loadProfile()
  } catch {
    errorMessage.value = 'Não foi possível actualizar o contacto.'
  } finally {
    pending.value = false
  }
}

async function saveActiveCompany(): Promise<void> {
  pending.value = true
  feedback.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch('/api/account/active-company', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: selectedCompanyId.value || null })
    })
    if (!response.ok) {
      errorMessage.value = 'Não foi possível seleccionar a empresa activa.'
      return
    }
    feedback.value = selectedCompanyId.value ? 'Empresa activa actualizada.' : 'Contexto individual seleccionado.'
    await loadProfile()
  } catch {
    errorMessage.value = 'Não foi possível seleccionar a empresa activa.'
  } finally {
    pending.value = false
  }
}

function notifySessionChanged(): void {
  window.dispatchEvent(new CustomEvent('ujimu:session-changed'))
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
  notifySessionChanged()
  feedback.value = authPanelPurpose.value === 'add-contact'
    ? 'Contacto verificado e adicionado.'
    : authPanelPurpose.value === 'verify'
      ? 'Identidade confirmada. Pode repetir a operação.'
      : ''
  void loadProfile()
}
</script>

<template>
  <main v-if="loading" class="subpage" aria-labelledby="profile-title">
    <section class="adm-card"><p class="adm-sub">A carregar perfil...</p></section>
  </main>

  <main v-else-if="!profile.authenticated" class="subpage adm-gate" aria-labelledby="profile-title" data-screen-label="Perfil — sem sessão">
    <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
    <h1 id="profile-title" class="subpage-title">O meu perfil</h1>
    <p class="subpage-sub" style="margin-top: 0">Inicie sessão para gerir o seu perfil.</p>
    <div class="adm-row-actions" style="justify-content: center">
      <NuxtLink class="btn-link profile-back" to="/">Voltar à consulta</NuxtLink>
      <button v-if="accountLoginAvailable" class="btn btn--primary" type="button" @click="openAuth('login')">Entrar por OTP</button>
    </div>
  </main>

  <main v-else class="subpage" aria-labelledby="profile-title" data-screen-label="Perfil">
    <NuxtLink class="btn-link profile-back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>

    <div class="prof-head">
      <span class="avatar prof-avatar">{{ userInitial }}</span>
      <div>
        <h1 id="profile-title" class="subpage-title">O meu perfil</h1>
        <p class="subpage-sub">{{ displayContact }}</p>
      </div>
    </div>

    <form class="adm-card" @submit.prevent="saveDisplayName">
      <h2 class="adm-card-title">Dados pessoais</h2>
      <label class="adm-field">
        <span class="adm-field-label">Nome</span>
        <input id="profile-display-name" v-model="displayName" name="displayName" class="field" maxlength="100" placeholder="O seu nome" :disabled="pending" />
      </label>
      <div class="adm-row-actions">
        <button class="btn btn--primary btn--xs" type="submit" :disabled="pending">Guardar nome</button>
      </div>
      <p class="adm-foot-note">O nome serve apenas para personalizar a conta; não altera a autenticação nem os privilégios.</p>
    </form>

    <div v-if="subscriptionsEnabled || companiesEnabled" class="adm-card">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">{{ subscriptionsEnabled ? 'Subscrição' : 'Empresa' }}</h2>
          <p class="adm-card-note">Plano actual: <strong>{{ planLabel }}</strong></p>
        </div>
        <NuxtLink v-if="subscriptionsEnabled" class="btn btn--ghost btn--xs" to="/subscription">Gerir</NuxtLink>
      </div>
      <div v-if="companiesEnabled && profile.companies.length > 0" class="adm-srcs">
        <div v-for="company in profile.companies" :key="company.id" class="adm-src">
          <div class="adm-src-row">
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ company.name }}</span>
              <span class="adm-src-sub">{{ company.role === 'admin' ? 'Administrador da Empresa · membro' : 'Membro' }}</span>
            </div>
            <span class="badge" :class="company.active ? 'badge--ok' : 'badge--mute'"><span class="badge-dot" />{{ company.active ? 'Activa' : 'Inactiva' }}</span>
          </div>
        </div>
      </div>
      <label v-if="companiesEnabled && profile.companies.length > 0" class="adm-field">
        <span class="adm-field-label">Empresa activa</span>
        <select v-model="selectedCompanyId" class="field" :disabled="pending">
          <option value="">Contexto individual</option>
          <option v-for="company in profile.companies" :key="company.id" :value="company.id">
            {{ company.name }} — {{ company.role === 'admin' ? 'admin' : 'membro' }}
          </option>
        </select>
      </label>
      <div v-if="companiesEnabled && profile.companies.length > 0" class="adm-row-actions">
        <button class="btn btn--primary btn--xs" type="button" :disabled="pending" @click="saveActiveCompany">Guardar empresa activa</button>
      </div>
      <p v-if="companiesEnabled && profile.companies.length > 1" class="adm-foot-note">Pertence a {{ profile.companies.length }} empresas — só uma pode estar activa de cada vez. Escolha a empresa activa no menu lateral.</p>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Segurança</h2>
      <div class="adm-srcs">
        <div class="adm-src">
          <div class="adm-src-row">
            <div class="adm-src-meta">
              <span class="adm-src-name">Entrada por código OTP</span>
              <span class="adm-src-sub">Cada início de sessão exige um código enviado por {{ isEmailContact ? 'email' : 'SMS' }}. Não há palavra-passe a memorizar.</span>
            </div>
            <span class="badge badge--ok"><span class="badge-dot" />Activo</span>
          </div>
        </div>
        <div v-for="contact in profile.contacts" :key="contact.id" class="adm-src">
          <div class="adm-src-row">
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ contact.contact }}</span>
              <span class="adm-src-sub">{{ contact.channel === 'email' ? 'Email verificado' : 'Telemóvel verificado' }}</span>
            </div>
            <span v-if="contact.primary" class="badge badge--ok"><span class="badge-dot" />Principal</span>
            <div v-else class="adm-row-actions">
              <button class="btn btn--ghost btn--xs" type="button" :disabled="pending" @click="makePrimary(contact)">Tornar principal</button>
              <button class="btn btn--danger btn--xs" type="button" :disabled="pending" @click="deleteContact(contact)">Remover</button>
            </div>
          </div>
        </div>
      </div>
      <div class="adm-row-actions">
        <button v-if="accountLoginAvailable" class="btn btn--ghost btn--xs" type="button" @click="openAuth('add-contact')">Adicionar contacto</button>
        <NuxtLink class="btn btn--ghost btn--xs" to="/account/security">Gerir passkeys</NuxtLink>
      </div>
      <p class="adm-foot-note">
        Mudar o contacto principal ou remover um contacto exige OTP nos últimos 15 minutos.
        <span v-if="authSession.recentOtpAuthenticated"> A confirmação recente está activa.</span>
      </p>
    </div>

    <div class="adm-card adm-dangerzone">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">Apagar conta</h2>
          <p class="adm-card-note">Apaga a conta e todo o histórico de conversas, permanentemente.</p>
        </div>
        <button class="btn btn--danger btn--xs" type="button" disabled>Apagar</button>
      </div>
    </div>

    <p v-if="feedback" class="plan-current--on"><UjimuIcon name="check" /> {{ feedback }}</p>
    <p v-if="errorMessage" class="adm-src-error" role="alert">{{ errorMessage }}</p>
  </main>

  <AuthModal v-model:open="authPanelOpen" :auth-session="authSession" :purpose="authPanelPurpose" @authenticated="handleAuthenticatedSession" />
</template>

<style scoped>
a.btn { text-decoration: none; }
</style>
