import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createEmptySpecialistForm } from '../utils/admin-ui'

const adminDashboardPath = 'pages/admin/index.vue'
const adminSpecialistsPath = 'pages/admin/specialists/index.vue'
const adminSpecialistDetailPath = 'pages/admin/specialists/[id].vue'
const adminAnalyticsPath = 'pages/admin/analytics.vue'
const adminOpsPath = 'pages/admin/ops.vue'
const adminCompaniesPath = 'pages/admin/companies.vue'
const adminCompanyDetailPath = 'pages/admin/companies/[id].vue'

async function readAdminPages() {
  return {
    dashboard: await readFile(adminDashboardPath, 'utf8'),
    specialists: await readFile(adminSpecialistsPath, 'utf8'),
    detail: await readFile(adminSpecialistDetailPath, 'utf8'),
    analytics: await readFile(adminAnalyticsPath, 'utf8'),
    ops: await readFile(adminOpsPath, 'utf8'),
    companies: await readFile(adminCompaniesPath, 'utf8'),
    companyDetail: await readFile(adminCompanyDetailPath, 'utf8')
  }
}

describe('admin specialist management UI acceptance', () => {
  it('splits specialist administration into dedicated Nuxt subpages', async () => {
    expect(existsSync(adminDashboardPath), 'admin dashboard route must exist').toBe(true)
    expect(existsSync(adminSpecialistsPath), 'admin specialist list/create route must exist').toBe(true)
    expect(existsSync(adminSpecialistDetailPath), 'admin specialist detail route must exist').toBe(true)
    if (!existsSync(adminSpecialistsPath) || !existsSync(adminSpecialistDetailPath)) return

    const { dashboard, specialists, detail } = await readAdminPages()

    expect(dashboard).toContain('/api/admin/session')
    expect(dashboard).toContain("to: '/admin/specialists'")
    expect(dashboard).toContain('class="adm-homegrid"')
    expect(dashboard).toContain('Administração')
    expect(dashboard).not.toContain('/raw')
    expect(dashboard).not.toContain('/conversion/run')
    expect(dashboard).not.toContain('/ingestion/run')

    expect(specialists).toContain('/api/admin/specialists')
    expect(specialists).toContain('Criar especialidade')
    expect(specialists).toContain('Especialidades')
    expect(specialists).toContain('`/admin/specialists/${specialist.id}`')
    expect(specialists).not.toContain('/raw')
    expect(specialists).not.toContain('/api/admin/analytics/questions')

    expect(detail).toContain('window.location.pathname')
    expect(detail).toContain('/api/admin/specialists')
    expect(detail).toContain('/raw')
    expect(detail).toContain('/sources/reload')
    expect(detail).not.toContain('/conversion/run')
    expect(detail).toContain('/ingestion/run')
    expect(detail).toContain('formatIngestionFeedback')
    expect(detail).toContain('Ingestão terminou com erro')
    expect(detail).toContain('data-screen-label="Admin — Ficha de especialidade"')
    expect(detail).toContain('class="adm-page"')
    expect(detail).toContain('class="adm-detail-head"')
    expect(detail).toContain('Metadados')
    expect(detail).toContain('Fontes oficiais')
    expect(detail).toContain('Carregar fonte')
    expect(detail).toContain('Actualizar')
    expect(detail).toContain('Recarregar')
    expect(detail).not.toContain('Recarregar fontes')
    expect(detail).not.toContain('Executar conversão')
    expect(detail).toContain('Executar ingestão')
    expect(detail).toContain("['pending', 'failed', 'blocked'].includes(source.status)")
    expect(detail).toContain('Ingestão agendada')
    expect(detail).toContain('Acesso restrito por empresa')
    expect(detail).toContain('adm-dangerzone')
    expect(detail).toContain('Apagar especialidade')
    expect(detail).toContain('confirmationId: selected.id')
    expect(detail).toContain('class="modal-scrim"')
    expect(detail).not.toContain('<UBadge')
    expect(detail).not.toContain('class="admin-shell"')
    expect(detail).not.toContain('class="detail-grid"')
    expect(detail).not.toContain('/api/admin/analytics/questions')
  })

  it('moves analytics and safe readiness to dedicated admin subpages', async () => {
    expect(existsSync(adminAnalyticsPath), 'admin analytics route must exist').toBe(true)
    expect(existsSync(adminOpsPath), 'admin operations route must exist').toBe(true)
    if (!existsSync(adminAnalyticsPath) || !existsSync(adminOpsPath)) return

    const { dashboard, analytics, ops } = await readAdminPages()

    expect(dashboard).toContain("to: '/admin/analytics'")
    expect(dashboard).toContain("to: '/admin/ops'")
    expect(dashboard).toContain('class="adm-card adm-homecard"')
    expect(dashboard).not.toContain('/api/admin/analytics/questions')
    expect(dashboard).not.toContain('/api/admin/ops/readyz')

    expect(analytics).toContain('/api/admin/session')
    expect(analytics).toContain('/api/admin/specialists')
    expect(analytics).toContain('/api/admin/analytics/visitors')
    expect(analytics).toContain('/api/admin/analytics/questions')
    expect(analytics).toContain('/review')
    expect(analytics).toContain('Visitantes distintos este mês')
    expect(analytics).toContain('Lacunas de conteúdo')
    expect(analytics).toContain('Perguntas recentes')
    expect(analytics).toContain('Marcar como revista')
    expect(analytics).not.toContain('/api/admin/ops/readyz')

    expect(ops).toContain('/api/admin/session')
    expect(ops).toContain('/api/admin/ops/readyz')
    expect(ops).toContain('Readiness')
    expect(ops).toContain('Base de dados')
    expect(ops).toContain('Segredos obrigatórios')
    expect(ops).toContain('migrationsApplied')
    expect(ops).toContain('class="ops-dot"')
    expect(ops).toContain('class="adm-ops-val"')
    expect(ops).not.toContain('UJIMU_SESSION_SECRET')
    expect(ops).not.toContain('UJIMU_BILLING_WEBHOOK_SECRET')
  })

  it('adds Ujimu admin company pages and specialist company selectors', async () => {
    expect(existsSync(adminCompaniesPath), 'admin companies route must exist').toBe(true)
    expect(existsSync(adminCompanyDetailPath), 'admin company detail route must exist').toBe(true)
    if (!existsSync(adminCompaniesPath) || !existsSync(adminCompanyDetailPath)) return

    const { specialists, detail, companies, companyDetail } = await readAdminPages()

    expect(companies).toContain('/api/admin/session')
    expect(companies).toContain('/api/admin/companies')
    expect(companies).toContain('Empresas')
    expect(companies).toContain('`/admin/companies/${company.id}`')
    expect(companyDetail).toContain('/api/admin/companies')
    expect(companyDetail).toContain('Quota')
    expect(companyDetail).toContain('Especialidades associadas')
    expect(specialists).toContain('/api/admin/companies')
    expect(detail).toContain('/api/admin/companies')
    expect(detail).toContain('Empresa')
    expect(detail).toContain('<select v-model="editForm.company_id"')
  })

  it('pre-fills safe specialist defaults when creating a specialist', () => {
    expect(createEmptySpecialistForm()).toMatchObject({
      system_prompt: 'Responda apenas com base na wiki desta especialidade e cite sempre as fontes relevantes.',
      status: 'active',
      company_id: ''
    })
  })

  it('keeps unauthenticated and non-admin blocking messages on every admin route', async () => {
    if (
      !existsSync(adminSpecialistsPath) ||
      !existsSync(adminSpecialistDetailPath) ||
      !existsSync(adminAnalyticsPath) ||
      !existsSync(adminOpsPath) ||
      !existsSync(adminCompaniesPath) ||
      !existsSync(adminCompanyDetailPath)
    ) return

    const pages = Object.values(await readAdminPages())

    for (const page of pages) {
      expect(page).toContain('/api/admin/session')
      expect(page).toMatch(/Tem de iniciar sessão para aceder à administração\.|Inicie sessão com uma conta de administrador para aceder a \/admin\./)
      expect(page).toMatch(/Não tem permissões de administração\.|A sua conta não tem permissões de administrador\./)
    }
  })
})
