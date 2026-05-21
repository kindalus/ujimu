import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Nuxt UI integration', () => {
  it('registers Nuxt UI as the component and theme module', async () => {
    const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }

    expect(packageJson.dependencies).toHaveProperty('@nuxt/ui')
    expect(packageJson.dependencies).toHaveProperty('tailwindcss')
    expect(nuxtConfig).toContain("modules: ['@nuxt/ui']")
  })

  it('imports Tailwind CSS and Nuxt UI theme layers from the global stylesheet', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(css).toContain('@import "tailwindcss";')
    expect(css).toContain('@import "@nuxt/ui";')
    expect(css).toContain('@theme')
  })

  it('defines the Ujimu Nuxt UI semantic theme colors', async () => {
    const appConfig = await readFile('app.config.ts', 'utf8')

    expect(appConfig).toContain('defineAppConfig')
    expect(appConfig).toContain("primary: 'ujimu'")
    expect(appConfig).toContain("neutral: 'zinc'")
  })

  it('uses Nuxt UI components in the app shell', async () => {
    const app = await readFile('app.vue', 'utf8')
    const page = await readFile('pages/index.vue', 'utf8')

    expect(app).toContain('<UApp>')
    expect(page).toContain('<UButton')
    expect(page).toContain('<UChatPrompt')
    expect(page).toContain('<UBadge')
  })
})
