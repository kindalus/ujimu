<script setup lang="ts">
import { onMounted, ref } from 'vue'

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
const selectedCompanyId = ref('')
const loading = ref(true)
const pending = ref(false)
const feedback = ref('')
const errorMessage = ref('')

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
    selectedCompanyId.value = profile.value.activeCompany?.id ?? ''
  } catch {
    errorMessage.value = 'Não foi possível carregar o perfil.'
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
</script>

<template>
  <main class="profile-shell" aria-labelledby="profile-title">
    <header class="profile-hero">
      <div>
        <p class="section-label">Conta</p>
        <h1 id="profile-title">Perfil</h1>
        <p>Gira os seus contactos verificados e a empresa activa usada na Ujimu.</p>
      </div>
      <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
    </header>

    <section class="profile-card">
      <p v-if="loading">A carregar perfil...</p>
      <div v-else-if="!profile.authenticated" role="alert">
        <h2>Tem de iniciar sessão.</h2>
        <p>Volte ao chat e entre antes de gerir o perfil.</p>
      </div>
      <div v-else class="profile-stack">
        <section>
          <h2>Ligado como {{ profile.user?.displayContact }}</h2>
          <p class="muted">Contactos de correio electrónico verificados:</p>
          <ul>
            <li v-for="email in profile.verifiedEmails" :key="email">{{ email }}</li>
          </ul>
        </section>

        <section>
          <h2>Empresa activa</h2>
          <p class="muted">Só pode ter uma empresa activa de cada vez.</p>
          <select v-model="selectedCompanyId" :disabled="pending">
            <option value="">Contexto individual</option>
            <option v-for="company in profile.companies" :key="company.id" :value="company.id">
              {{ company.name }} — {{ company.role === 'admin' ? 'admin' : 'membro' }}
            </option>
          </select>
          <UButton type="button" color="primary" :loading="pending" @click="saveActiveCompany">
            Guardar empresa activa
          </UButton>
        </section>
      </div>
    </section>

    <p v-if="feedback" class="feedback">{{ feedback }}</p>
    <p v-if="errorMessage" class="profile-error" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.profile-shell { width: min(920px, calc(100% - 32px)); min-height: 100vh; margin: 0 auto; padding: 32px 0; }
.profile-hero, .profile-card { border: 1px solid var(--ujimu-line); border-radius: 28px; background: rgba(255,255,255,.06); padding: 24px; }
.profile-hero { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.profile-stack { display: grid; gap: 22px; }
.section-label { color: var(--ujimu-yellow); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.muted { color: var(--ujimu-muted); }
.feedback, .profile-error { margin-top: 12px; font-weight: 800; }
.profile-error { color: #ffd3d3; }
select { width: 100%; margin: 8px 0 12px; border-radius: 12px; padding: 10px; color: #111; }
</style>
