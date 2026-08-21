import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import publicSpecialistHandler from '../server/api/public/specialists/[id].get'
import sitemapHandler from '../server/routes/sitemap.xml.get'
import { createSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'

const root = resolve(import.meta.dirname, '..')
const originalDataDir = process.env.UJIMU_DATA_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.UJIMU_DATA_DIR
  else process.env.UJIMU_DATA_DIR = originalDataDir
  resetSpecialistRegistryForTests()
})

function readProjectFile(path: string): string {
  const absolutePath = resolve(root, path)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

describe('public specialist pages acceptance', () => {
  it('serves active public specialists and hides unavailable specialists with the same 404', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-public-specialists-'))
    process.env.UJIMU_DATA_DIR = dataDir
    await createSpecialist(validSpecialist('laboral'))
    await createSpecialist({ ...validSpecialist('suspenso'), status: 'suspended' })
    await createSpecialist({ ...validSpecialist('empresa'), company_id: 'company-private' })

    const app = createApp()
    const router = createRouter()
      .get('/api/public/specialists/:id', publicSpecialistHandler)
      .get('/sitemap.xml', sitemapHandler)
    app.use(router)
    const fetch = toWebHandler(app)

    const visible = await fetch(new Request('http://local/api/public/specialists/laboral'))
    expect(visible.status).toBe(200)
    await expect(visible.json()).resolves.toMatchObject({
      specialist: { id: 'laboral', seo: { title: 'Especialista laboral' } }
    })

    for (const id of ['suspenso', 'empresa', 'inexistente']) {
      expect((await fetch(new Request(`http://local/api/public/specialists/${id}`))).status).toBe(404)
    }

    const sitemap = await fetch(new Request('http://local/sitemap.xml'))
    expect(await sitemap.text()).toContain('https://ujimu.com/especialidades/laboral')
    expect(await (await fetch(new Request('http://local/sitemap.xml'))).text()).not.toMatch(/suspenso|empresa/)
  })

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
    expect(page).toContain("'@type': 'WebPage'")
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

function validSpecialist(id: string) {
  return {
    id,
    name: `Especialista ${id}`,
    description: `Descrição ${id}.`,
    wiki_type: 'legislation-regulatory' as const,
    system_prompt: 'Use apenas a wiki.',
    citations_required: true,
    streaming_enabled: true,
    seo: { title: `Especialista ${id}` }
  }
}
