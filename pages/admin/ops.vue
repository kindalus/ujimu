<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminReadinessResponse, AdminSessionResponse } from '../../utils/admin-ui'
import { booleanStatusColor } from '../../utils/admin-ui'

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const readiness = ref<AdminReadinessResponse | undefined>()
const readinessPending = ref(false)
const readinessError = ref('')

const checkRows = computed(() => {
  const checks = readiness.value?.checks
  return [
    { key: 'database', label: 'Base de dados', value: checks?.database, kind: 'boolean' },
    { key: 'dataDirectoryWritable', label: 'Directoria de dados gravável', value: checks?.dataDirectoryWritable, kind: 'boolean' },
    { key: 'operationalLogsWritable', label: 'Logs operacionais graváveis', value: checks?.operationalLogsWritable, kind: 'boolean' },
    { key: 'migrationsApplied', label: 'Migrações aplicadas', value: checks?.migrationsApplied, kind: 'number' },
    { key: 'billingWebhookSecretConfigured', label: 'Segredo de billing configurado', value: checks?.billingWebhookSecretConfigured, kind: 'boolean' },
    { key: 'sessionSecretConfigured', label: 'Segredo de sessão configurado', value: checks?.sessionSecretConfigured, kind: 'boolean' },
    { key: 'otpPepperConfigured', label: 'Pepper OTP configurada', value: checks?.otpPepperConfigured, kind: 'boolean' },
    { key: 'passkeysEnabled', label: 'Passkeys activas', value: checks?.passkeysEnabled, kind: 'boolean' },
    { key: 'passkeysConfigured', label: 'Passkeys configuradas', value: checks?.passkeysConfigured, kind: 'boolean' }
  ]
})

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
    if (session.value.admin) {
      await loadReadiness()
    }
  } catch {
    session.value = { authenticated: false, admin: false }
  } finally {
    sessionPending.value = false
  }
}

async function loadReadiness(): Promise<void> {
  readinessPending.value = true
  readinessError.value = ''
  try {
    const response = await fetch('/api/admin/ops/readyz')
    if (!response.ok) throw new Error('Failed to load readiness.')
    readiness.value = (await response.json()) as AdminReadinessResponse
  } catch {
    readinessError.value = 'Não foi possível carregar o readiness.'
    readiness.value = undefined
  } finally {
    readinessPending.value = false
  }
}

function formatCheckValue(value: boolean | number | undefined, kind: string): string {
  if (kind === 'number') return String(value ?? '—')
  if (value === true) return 'OK'
  if (value === false) return 'Falha'
  return '—'
}
</script>

<template>
  <main class="admin-shell" aria-labelledby="ops-title">
    <header class="admin-hero">
      <div>
        <p class="section-label">Administração</p>
        <h1 id="ops-title">Operações</h1>
        <p>Readiness administrativo com checks seguros, sem caminhos, segredos ou valores de ambiente.</p>
      </div>
      <div class="header-actions">
        <UButton to="/admin" color="neutral" variant="ghost">Painel</UButton>
        <UButton to="/admin/analytics" color="neutral" variant="ghost">Analytics</UButton>
      </div>
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

    <section v-else class="ops-grid">
      <section class="admin-card readiness-card" aria-labelledby="readiness-title">
        <div class="card-heading">
          <div>
            <p class="section-label">Readiness</p>
            <h2 id="readiness-title">Estado geral</h2>
          </div>
          <UBadge :color="booleanStatusColor(readiness?.ok)" variant="soft">
            {{ readiness?.ok ? 'OK' : 'Atenção' }}
          </UBadge>
        </div>
        <p class="muted">A resposta contém apenas booleans, contagens e nomes de checks seguros.</p>
        <UButton type="button" color="primary" variant="soft" :loading="readinessPending" @click="loadReadiness">
          Actualizar readiness
        </UButton>
      </section>

      <section class="admin-card secrets-card" aria-labelledby="secrets-title">
        <p class="section-label">Segurança</p>
        <h2 id="secrets-title">Segredos configurados</h2>
        <p class="muted">Esta página mostra apenas se os segredos obrigatórios existem; os valores nunca são apresentados.</p>
      </section>

      <section class="admin-card checks-card" aria-labelledby="checks-title">
        <div class="card-heading">
          <h2 id="checks-title">Checks seguros</h2>
          <UBadge color="neutral" variant="soft">{{ checkRows.length }}</UBadge>
        </div>
        <p v-if="readinessPending" class="muted">A carregar readiness...</p>
        <p v-else-if="readinessError" class="admin-error" role="alert">{{ readinessError }}</p>
        <ol v-else class="checks-list">
          <li v-for="check in checkRows" :key="check.key" :data-check-key="check.key">
            <div>
              <strong>{{ check.label }}</strong>
              <small>{{ check.key }}</small>
            </div>
            <UBadge
              :color="check.kind === 'number' ? 'neutral' : booleanStatusColor(check.value as boolean | undefined)"
              variant="soft"
            >
              {{ formatCheckValue(check.value, check.kind) }}
            </UBadge>
          </li>
        </ol>
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

.header-actions,
.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-actions {
  flex-wrap: wrap;
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
.muted,
.checks-list small {
  color: var(--ujimu-muted);
}

.ops-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(280px, 1fr);
  gap: 18px;
  margin-top: 18px;
}

.admin-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 22px;
}

.checks-card {
  grid-column: 1 / -1;
}

.checks-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.checks-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.admin-error {
  color: #ffd3d3;
  font-weight: 800;
}

@media (max-width: 900px) {
  .admin-hero,
  .ops-grid,
  .checks-list li {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
