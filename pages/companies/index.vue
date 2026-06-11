<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface UserCompany {
  id: string
  name: string
  nif: string
  role: 'admin' | 'member'
  active: boolean
  seats: number
}

const companies = ref<UserCompany[]>([])
const loading = ref(true)
const errorMessage = ref('')

onMounted(() => {
  void loadCompanies()
})

async function loadCompanies(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/companies')
    if (response.status === 401) {
      errorMessage.value = 'Tem de iniciar sessão para ver as empresas.'
      return
    }
    if (!response.ok) throw new Error('failed')
    const payload = (await response.json()) as { companies: UserCompany[] }
    companies.value = payload.companies
  } catch {
    errorMessage.value = 'Não foi possível carregar as empresas.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="companies-shell" aria-labelledby="companies-title">
    <header class="companies-hero">
      <div>
        <p class="section-label">Empresas</p>
        <h1 id="companies-title">Empresas</h1>
        <p>Veja as empresas de que faz parte e aceda à gestão quando for administrador.</p>
      </div>
      <UButton to="/account/profile" color="neutral" variant="ghost">Perfil</UButton>
    </header>

    <section class="companies-card">
      <p v-if="loading">A carregar empresas...</p>
      <p v-else-if="errorMessage" role="alert" class="companies-error">{{ errorMessage }}</p>
      <p v-else-if="companies.length === 0" class="muted">Ainda não pertence a nenhuma empresa.</p>
      <ol v-else>
        <li v-for="company in companies" :key="company.id">
          <div>
            <strong>{{ company.name }}</strong>
            <small>NIF {{ company.nif }} · {{ company.role === 'admin' ? 'Administrador' : 'Membro' }} · {{ company.seats }} lugares</small>
          </div>
          <UButton :to="`/companies/${company.id}`" color="primary" variant="soft">Abrir</UButton>
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped>
.companies-shell { width: min(960px, calc(100% - 32px)); min-height: 100vh; margin: 0 auto; padding: 32px 0; }
.companies-hero, .companies-card { border: 1px solid var(--ujimu-line); border-radius: 28px; background: rgba(255,255,255,.06); padding: 24px; }
.companies-hero { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.section-label { color: var(--ujimu-yellow); font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
ol { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
li { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--ujimu-line); border-radius: 18px; padding: 14px; }
small, .muted { color: var(--ujimu-muted); }
.companies-error { color: #ffd3d3; font-weight: 800; }
</style>
