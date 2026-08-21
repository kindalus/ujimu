import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function readProjectFile(path: string): string {
  const absolutePath = resolve(root, path)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

describe('public specialist pages acceptance', () => {
  it('serves specialist page data only through the anonymous public registry', () => {
    const endpoint = readProjectFile('server/api/public/specialists/[id].get.ts')

    expect(endpoint).toContain('getPublicSpecialists()')
    expect(endpoint).toContain("statusCode: 404")
    expect(endpoint).toContain("statusMessage: 'Specialist not found'")
    expect(endpoint).not.toContain('system_prompt')
    expect(endpoint).not.toContain('paths')
  })

  it('renders approved editorial fields and specialist metadata without raw HTML', () => {
    const page = readProjectFile('pages/especialidades/[id].vue')
    const app = readProjectFile('app.vue')

    expect(page).toContain("useFetch<PublicSpecialistResponse>")
    expect(page).toContain("'/api/public/specialists/'")
    expect(page).toContain('specialist.seo.introduction || specialist.description')
    expect(page).toContain('Temas abrangidos')
    expect(page).toContain('Limites desta especialidade')
    expect(page).toContain('Conteúdo gerado por IA')
    expect(page).toContain("type: 'WebPage'")
    expect(page).toContain("query: { specialist: specialist.id }")
    expect(page).not.toContain('v-html')
    expect(app).toContain("route.path.startsWith('/especialidades/')")
  })

  it('discovers public specialist pages and lets the CTA pre-select consultation', () => {
    const sitemap = readProjectFile('server/routes/sitemap.xml.get.ts')
    const home = readProjectFile('pages/index.vue')

    expect(sitemap).toContain('await getPublicSpecialists()')
    expect(sitemap).toContain('/especialidades/${escapeXml(specialist.id)}')
    expect(sitemap).not.toContain('company_id')
    expect(home).toContain('route.query.specialist')
    expect(home).toContain("`/especialidades/${selectedSpecialist.id}`")
  })
})
