<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface AuthSessionResponse {
  authenticated: boolean
  user?: { id: string; displayContact: string }
  authMethod?: 'otp' | 'passkey' | 'unknown'
  recentOtpAuthenticated?: boolean
  passkeys?: {
    passkeysEnabled: boolean
    passkeysConfigured: boolean
  }
}

interface UserCompany {
  id: string
  name: string
  nif: string
  role: 'admin' | 'member'
  active: boolean
}

interface ProfileResponse {
  authenticated: boolean
  user?: { id: string; displayContact: string }
  verifiedEmails: string[]
  companies: UserCompany[]
  activeCompany: UserCompany | null
}

const profile = ref<ProfileResponse>({ authenticated: false, verifiedEmails: [], companies: [], activeCompany: null })
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const authPanelOpen = ref(false)
const selectedCompanyId = ref('')
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

const displayContact = computed(() => profile.value.user?.displayContact ?? '')
const userInitial = computed(() => displayContact.value.slice(0, 1).toUpperCase() || 'U')
const isEmailContact = computed(() => displayContact.value.includes('@'))
const planLabel = computed(() => {
  if (profile.value.activeCompany) return `Empresa — ${profile.value.activeCompany.name}`
  return 'Gratuito'
})
const verifiedContactList = computed(() => {
  if (profile.value.verifiedEmails.length > 0) return profile.value.verifiedEmails
  return displayContact.value ? [displayContact.value] : []
})

onMounted(() => {
  void loadProfile()
})

async function loadProfile(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/account/profile')
    profile.value = response.ok
      ? ((await response.json()) as ProfileResponse)
      : { authenticated: false, verifiedEmails: [], companies: [], activeCompany: null }
    authSession.value = { authenticated: profile.value.authenticated, user: profile.value.user }
    selectedCompanyId.value = profile.value.activeCompany?.id ?? ''
  } catch {
    errorMessage.value = 'Não foi possível carregar o perfil.'
    authSession.value = { authenticated: false }
  } finally {
    loading.value = false
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

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
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
      <NuxtLink class="btn btn--ghost" to="/">Voltar à consulta</NuxtLink>
      <button class="btn btn--primary" type="button" @click="authPanelOpen = true">Entrar por OTP</button>
    </div>
  </main>

  <main v-else class="subpage" aria-labelledby="profile-title" data-screen-label="Perfil">
    <NuxtLink class="btn btn--ghost btn--back" to="/"><UjimuIcon name="chevLeft" /> Voltar à consulta</NuxtLink>

    <div class="prof-head">
      <span class="avatar prof-avatar">{{ userInitial }}</span>
      <div>
        <h1 id="profile-title" class="subpage-title">O meu perfil</h1>
        <p class="subpage-sub">{{ displayContact }}</p>
      </div>
    </div>

    <div class="adm-card">
      <h2 class="adm-card-title">Dados pessoais</h2>
      <div class="adm-formgrid">
        <label class="adm-field">
          <span class="adm-field-label">Nome</span>
          <input class="field" value="" placeholder="O seu nome" readonly />
        </label>
        <label class="adm-field">
          <span class="adm-field-label">{{ isEmailContact ? 'Email' : 'Telemóvel' }}</span>
          <input class="field" :value="displayContact" readonly />
        </label>
      </div>
      <label class="adm-field">
        <span class="adm-field-label">{{ isEmailContact ? 'Telemóvel · opcional' : 'Email · opcional' }}</span>
        <input class="field" :type="isEmailContact ? 'tel' : 'email'" :placeholder="isEmailContact ? '9XX XXX XXX' : 'nome@exemplo.co.ao'" readonly />
      </label>
      <p class="adm-foot-note">Para alterar o contacto de entrada será pedido um código OTP enviado para o novo contacto. O contacto alternativo é opcional e pode ser usado para OTP.</p>
    </div>

    <div class="adm-card">
      <div class="adm-card-toprow">
        <div>
          <h2 class="adm-card-title">Subscrição</h2>
          <p class="adm-card-note">Plano actual: <strong>{{ planLabel }}</strong></p>
        </div>
        <NuxtLink class="btn btn--ghost btn--xs" to="/subscription">Gerir</NuxtLink>
      </div>
      <div v-if="profile.companies.length > 0" class="adm-srcs">
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
      <label v-if="profile.companies.length > 0" class="adm-field">
        <span class="adm-field-label">Empresa activa</span>
        <select v-model="selectedCompanyId" class="field" :disabled="pending">
          <option value="">Contexto individual</option>
          <option v-for="company in profile.companies" :key="company.id" :value="company.id">
            {{ company.name }} — {{ company.role === 'admin' ? 'admin' : 'membro' }}
          </option>
        </select>
      </label>
      <div v-if="profile.companies.length > 0" class="adm-row-actions">
        <button class="btn btn--primary btn--xs" type="button" :disabled="pending" @click="saveActiveCompany">Guardar empresa activa</button>
      </div>
      <p v-if="profile.companies.length > 1" class="adm-foot-note">Pertence a {{ profile.companies.length }} empresas — só uma pode estar activa de cada vez. Escolha a empresa activa no menu lateral.</p>
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
        <div class="adm-src">
          <div class="adm-src-row">
            <div class="adm-src-meta">
              <span class="adm-src-name">Contactos verificados</span>
              <span class="adm-src-sub">{{ verifiedContactList.join(' · ') }}</span>
            </div>
            <NuxtLink class="btn btn--ghost btn--xs" to="/account/security">Gerir passkeys</NuxtLink>
          </div>
        </div>
      </div>
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

  <AuthModal v-model:open="authPanelOpen" :auth-session="authSession" @authenticated="handleAuthenticatedSession" />
</template>

<style scoped>
a.btn { text-decoration: none; }
</style>
