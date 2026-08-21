import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const approvedTitle = 'Ujimu — Consulte especialistas com fontes oficiais'
const approvedDescription = 'Consulte especialistas de IA sobre legislação angolana. Receba respostas fundamentadas em fontes oficiais, com citações verificáveis.'

function readProjectFile(path: string): string {
  const absolutePath = resolve(root, path)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

describe('public SEO identity acceptance', () => {
  it('renders the approved identity and social metadata in the server head', () => {
    const app = readProjectFile('app.vue')
    const config = readProjectFile('nuxt.config.ts')

    expect(config).toContain("siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'https://ujimu.com'")
    expect(app).toContain(approvedTitle)
    expect(app).toContain(approvedDescription)
    expect(app).toContain("ogType: 'website'")
    expect(app).toContain("ogLocale: 'pt_AO'")
    expect(app).toContain("twitterCard: 'summary_large_image'")
    expect(app).toContain("'/ujimu-social.png'")
    expect(app).toContain("lang: 'pt-AO'")
    expect(app).toContain("type: 'application/ld+json'")
    expect(app).toContain("rel: 'canonical'")
  })

  it('ships browser and social assets with the required dimensions', () => {
    const socialPath = resolve(root, 'public/ujimu-social.png')
    expect(existsSync(socialPath)).toBe(true)

    const socialImage = existsSync(socialPath) ? readFileSync(socialPath) : Buffer.alloc(24)
    expect(socialImage.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(socialImage.readUInt32BE(16)).toBe(1200)
    expect(socialImage.readUInt32BE(20)).toBe(630)

    expect(readProjectFile('public/favicon.svg')).toContain('<svg')
    expect(readProjectFile('public/site.webmanifest')).toContain('"name": "Ujimu"')
    expect(existsSync(resolve(root, 'public/apple-touch-icon.png'))).toBe(true)
  })

  it('publishes crawl discovery while excluding private and operational routes', () => {
    const robots = readProjectFile('server/routes/robots.txt.get.ts')
    const sitemap = readProjectFile('server/routes/sitemap.xml.get.ts')
    const config = readProjectFile('nuxt.config.ts')

    expect(robots).toContain('Sitemap: https://ujimu.com/sitemap.xml')
    expect(robots).toContain('Disallow: /admin/')
    expect(robots).toContain('Disallow: /account/')
    expect(robots).toContain('Disallow: /api/')
    expect(sitemap).toContain('<loc>https://ujimu.com/</loc>')
    expect(config).toContain("'X-Robots-Tag': 'noindex, nofollow'")
    expect(config).toContain("'/api/**'")
    expect(config).toContain("'/admin/**'")
    expect(config).toContain("'/account/**'")
  })
})
