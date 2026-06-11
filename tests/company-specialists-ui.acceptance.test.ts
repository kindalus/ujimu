import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const companyDetailPath = 'pages/companies/[id].vue'
const companySpecialistsPath = 'pages/companies/[id]/specialists.vue'

describe('corporate specialist management UI acceptance', () => {
  it('adds a company-admin specialist management page without ingestion operations', async () => {
    expect(existsSync(companySpecialistsPath), 'company specialists route must exist').toBe(true)
    if (!existsSync(companySpecialistsPath)) return

    const companyDetail = await readFile(companyDetailPath, 'utf8')
    const page = await readFile(companySpecialistsPath, 'utf8')

    expect(companyDetail).toContain('/specialists')
    expect(companyDetail).toContain("detail.role === 'admin'")

    expect(page).toContain('/api/companies/${encodeURIComponent(companyId.value)}/specialists')
    expect(page).toContain('/raw')
    expect(page).toContain('system_prompt')
    expect(page).toContain('Aguarda processamento pelo admin Ujimu')
    expect(page).toContain('Estado das fontes')
    expect(page).toContain('Carregar fonte')
    expect(page).toContain('Guardar prompt')
    expect(page).not.toContain('/api/admin')
    expect(page).not.toContain('/ingestion/run')
    expect(page).not.toContain('/conversion/run')
    expect(page).not.toContain('Executar ingestão')
    expect(page).not.toContain('Executar conversão')
    expect(page).not.toContain('Criar especialidade')
    expect(page).not.toContain('Apagar especialidade')
  })
})
