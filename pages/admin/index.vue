<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AdminSessionResponse } from '../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)

onMounted(() => {
  void loadAdminSession()
})

async function loadAdminSession(): Promise<void> {
  sessionPending.value = true
  try {
    const response = await fetch('/api/admin/session')
    session.value = response.ok
      ? ((await response.json()) as AdminSessionResponse)
      : { authenticated: false, admin: false }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}
</script>

<template>
  <main class="admin-shell" aria-labelledby="admin-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="admin-title">Painel administrativo</h1>
        <p>Escolha a área operacional que quer gerir.</p>
      </div>
      <UButton to="/" color="neutral" variant="ghost">Voltar ao chat</UButton>
    </header>

    <section v-if="sessionPending" class="admin-card">
      <p>A verificar permissões...</p>
    </section>

    <section v-else-if="!session.authenticated" class="admin-card" role="alert">
      <h2>Tem de iniciar sessão para aceder à administração.</h2>
      <p>Volte à página principal e entre com o código de acesso.</p>
    </section>

    <section v-else-if="!session.admin" class="admin-card" role="alert">
      <h2>Não tem permissões de administração.</h2>
      <p>Esta área está reservada a contactos autorizados.</p>
    </section>

    <section v-else class="dashboard-grid" aria-label="Áreas administrativas">
      <section class="admin-card route-card">
        <p class="section-label">Operação</p>
        <h2>Especialidades e fontes</h2>
        <p class="muted">Crie especialistas, edite prompts, carregue fontes e acompanhe o pipeline de conversão e ingestão.</p>
        <UButton to="/admin/specialists" color="primary" variant="soft">Abrir especialidades</UButton>
      </section>

      <section class="admin-card route-card">
        <p class="section-label">Empresas</p>
        <h2>Empresas corporativas</h2>
        <p class="muted">Veja subscrições, membros, quota agregada e especialidades privadas associadas.</p>
        <UButton to="/admin/companies" color="primary" variant="soft">Abrir empresas</UButton>
      </section>

      <section class="admin-card route-card">
        <p class="section-label">Analytics</p>
        <h2>Visitantes e lacunas</h2>
        <p class="muted">Veja visitantes mensais, perguntas recentes e candidatos editoriais a lacunas de conteúdo.</p>
        <UButton to="/admin/analytics" color="primary" variant="soft">Abrir analytics</UButton>
      </section>

      <section class="admin-card route-card">
        <p class="section-label">Operações</p>
        <h2>Readiness seguro</h2>
        <p class="muted">Confirme checks operacionais seguros sem expor caminhos, segredos ou valores de ambiente.</p>
        <UButton to="/admin/ops" color="primary" variant="soft">Abrir operações</UButton>
      </section>
    </section>
  </main>
</template>

<style scoped>
.admin-shell {
  width: min(1180px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 0;
}

.admin-hero,
.admin-card {
  border: 1px solid var(--ujimu-line);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.028));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
}

.admin-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: clamp(24px, 4vw, 42px);
}

.admin-hero h1,
.admin-card h2 {
  margin: 0;
  letter-spacing: -0.045em;
}

.section-label {
  margin: 0 0 10px;
  color: var(--ujimu-yellow);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.admin-hero p:not(.section-label),
.muted {
  color: var(--ujimu-muted);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.route-card p {
  margin: 0;
}

@media (max-width: 1040px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .admin-hero {
    display: grid;
  }
}
</style>
