import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('company profile management UI acceptance', () => {
  it('keeps company management pages while porting /companies to the prototype company area', async () => {
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')
    const profile = await readFile('pages/account/profile.vue', 'utf8')
    const companies = await readFile('pages/companies/index.vue', 'utf8')
    const detail = await readFile('pages/companies/[id].vue', 'utf8')

    expect(drawer).toContain('/account/profile')
    expect(drawer).toContain('/subscription')
    expect(drawer).toContain('/admin')
    expect(drawer).not.toContain('/companies')
    expect(profile).toContain('Perfil')
    expect(profile).toContain('/api/account/active-company')

    expect(companies).toContain('data-screen-label="Empresa — Acesso negado"')
    expect(companies).toContain('data-screen-label="Empresa — Especialistas"')
    expect(companies).toContain('Gestão de especialistas da empresa')
    expect(companies).toContain('Reservados a')
    expect(companies).toContain('class="adm-list"')
    expect(companies).toContain('class="adm-spec-main"')
    expect(companies).not.toContain('companies-shell')
    expect(companies).not.toContain('companies-hero')
    expect(companies).not.toContain('companies-card')

    expect(detail).toContain('/api/companies/')
    expect(detail).toContain('/quota')
    expect(detail).toContain('data-screen-label="Subscrição — Gestão da Empresa"')
    expect(detail).toContain('Quota e utilização da empresa')
    expect(detail).toContain('Utilizadores da Empresa')
    expect(detail).toContain('class="adm-statrow"')
    expect(detail).toContain('class="sub-manage"')
    expect(detail).not.toContain('company-shell')
    expect(detail).not.toContain('company-hero')
    expect(detail).not.toContain('company-card')
  })
})
