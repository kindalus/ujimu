<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AdminReadinessResponse, AdminSessionResponse } from '../../utils/admin-ui'

interface OpsRow {
  name: string
  value: string
  ok: boolean | undefined
}

const session = ref<AdminSessionResponse>({ authenticated: false, admin: false })
const sessionPending = ref(true)
const readiness = ref<AdminReadinessResponse | undefined>()
const readinessPending = ref(false)
const readinessError = ref('')

const opsRows = computed<OpsRow[]>(() => {
  const checks = readiness.value?.checks
  const configuredSecrets = [checks?.billingWebhookSecretConfigured, checks?.sessionSecretConfigured, checks?.otpPepperConfigured].filter(Boolean).length
  return [
    { name: 'Base de dados', value: checks?.database ? 'Ligada' : 'Falha', ok: checks?.database },
    { name: 'Directoria de dados', value: checks?.dataDirectoryWritable ? 'Gravável' : 'Falha', ok: checks?.dataDirectoryWritable },
    { name: 'Logs operacionais', value: checks?.operationalLogsWritable ? 'Graváveis' : 'Falha', ok: checks?.operationalLogsWritable },
    { name: 'Migrações aplicadas', value: String(checks?.migrationsApplied ?? '—'), ok: checks ? checks.migrationsApplied >= 0 : undefined },
    { name: 'Segredos obrigatórios', value: checks ? `${configuredSecrets} de 3 configurados` : '—', ok: checks ? configuredSecrets === 3 : undefined },
    { name: 'Passkeys', value: checks?.passkeysConfigured ? 'Configurado' : 'Não configurado', ok: checks?.passkeysConfigured }
  ]
})

const issueCount = computed(() => opsRows.value.filter((row) => row.ok === false).length)
const readinessBadgeClass = computed(() => issueCount.value > 0 ? 'badge--warn' : 'badge--ok')
const readinessBadgeLabel = computed(() => issueCount.value > 0 ? `${issueCount.value} item por configurar` : 'Tudo operacional')

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
    if (session.value.admin) await loadReadiness()
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
</script>

<template>
  <main class="adm-page" aria-labelledby="ops-title" data-screen-label="Admin — Ops">
    <div class="adm-pagehead">
      <div>
        <h1 id="ops-title" class="adm-title">Readiness operacional</h1>
        <p class="adm-sub">Apenas booleanos e contagens seguras — sem valores secretos, caminhos internos ou variáveis sensíveis.</p>
      </div>
      <span v-if="session.admin" class="badge" :class="readinessBadgeClass"><span class="badge-dot" />{{ readinessBadgeLabel }}</span>
    </div>

    <section v-if="sessionPending" class="adm-card">
      <p class="adm-sub">A verificar permissões...</p>
    </section>

    <section v-else-if="!session.authenticated" class="adm-card adm-gate" role="alert">
      <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
      <h2 class="adm-title">Tem de iniciar sessão para aceder à administração.</h2>
      <p class="adm-sub">Volte à página principal e entre com o código de acesso.</p>
    </section>

    <section v-else-if="!session.admin" class="adm-card adm-gate" role="alert">
      <span class="adm-gate-icon"><UjimuIcon name="user" /></span>
      <h2 class="adm-title">Não tem permissões de administração.</h2>
      <p class="adm-sub">Esta área está reservada a contactos autorizados.</p>
    </section>

    <section v-else class="adm-card">
      <div class="adm-srcs">
        <div v-for="row in opsRows" :key="row.name" class="adm-src">
          <div class="adm-src-row">
            <span class="ops-dot" :class="row.ok === false ? 'ops-dot--warn' : 'ops-dot--ok'" />
            <div class="adm-src-meta">
              <span class="adm-src-name">{{ row.name }}</span>
            </div>
            <span class="adm-ops-val">{{ row.value }}</span>
          </div>
        </div>
      </div>
      <p v-if="readinessPending" class="adm-foot-note">A carregar readiness...</p>
      <p v-else-if="readinessError" class="adm-src-error" role="alert">{{ readinessError }}</p>
      <p v-else class="adm-foot-note">Última verificação: agora · actualização manual disponível nesta sessão.</p>
      <div class="adm-row-actions">
        <button class="btn btn--ghost btn--xs" type="button" :disabled="readinessPending" @click="loadReadiness">
          <UjimuIcon name="refresh" /> Actualizar
        </button>
      </div>
    </section>
  </main>
</template>
