import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('company profile management UI acceptance', () => {
  it('exposes authenticated navigation and Nuxt pages for profile and company management', async () => {
    const drawer = await readFile('components/AppDrawer.vue', 'utf8')
    const profile = await readFile('pages/account/profile.vue', 'utf8')
    const companies = await readFile('pages/companies/index.vue', 'utf8')
    const detail = await readFile('pages/companies/[id].vue', 'utf8')

    expect(drawer).toContain('/account/profile')
    expect(drawer).toContain('/companies')
    expect(profile).toContain('Perfil')
    expect(profile).toContain('/api/account/active-company')
    expect(companies).toContain('Empresas')
    expect(detail).toContain('/api/companies/')
    expect(detail).toContain('Gerir membros')
  })
})
