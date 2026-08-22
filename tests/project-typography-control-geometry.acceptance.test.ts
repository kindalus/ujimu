import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function vueStyleSources(root: string): Promise<Array<{ path: string, css: string }>> {
  const entries = await readdir(root, { withFileTypes: true })
  const sources: Array<{ path: string, css: string }> = []

  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      sources.push(...await vueStyleSources(path))
      continue
    }
    if (!entry.name.endsWith('.vue')) continue

    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      sources.push({ path, css: match[1] ?? '' })
    }
  }

  return sources
}

describe('project typography and control geometry acceptance', () => {
  it('defines the approved four-size typography contract without pixel font sizes', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')
    const styleSources = [
      { path: 'assets/css/main.css', css },
      ...await vueStyleSources('components'),
      ...await vueStyleSources('pages')
    ]

    expect(css).toMatch(/html\s*\{[^}]*font-size:\s*100%/)
    expect(css).toContain('--fs-micro: 0.75rem;')
    expect(css).toContain('--fs-ui: 0.875rem;')
    expect(css).toContain('--fs-read: 1.0625rem;')
    expect(css).toContain('--fs-title: 1.5rem;')

    const pixelFontSizes = styleSources.flatMap(({ path, css: source }) =>
      [...source.matchAll(/font-size\s*:\s*[^;{}]*\bpx\b/g)].map(match => `${path}: ${match[0]}`)
    )
    expect(pixelFontSizes).toEqual([])
  })

  it('assigns Inter to UI, Literata to assistant reading, and JetBrains Mono to code', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(css).toContain('--font-ui: "Inter Variable"')
    expect(css).toContain('--font-read: "Literata Variable"')
    expect(css).toContain('--font-code: "JetBrains Mono Variable"')
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-ui\)/)
    expect(css).toMatch(/\.assistant-markdown\s*\{[^}]*font-family:\s*var\(--font-read\)[^}]*font-size:\s*var\(--fs-read\)[^}]*font-weight:\s*400[^}]*line-height:\s*var\(--lh-read\)[^}]*max-width:\s*34em/)
    expect(css).toMatch(/\.assistant-markdown\s+code\s*\{[^}]*font-family:\s*var\(--font-code\)/)
    expect(css).toMatch(/\.msg--user[^}]*\.bubble|\.bubble\s*\{[^}]*font-size:\s*var\(--fs-read\)/)
  })

  it('keeps source typography and citation markers inside the approved scale', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(css).toMatch(/\.cite-mark\s*\{[^}]*font-size:\s*0\.75em[^}]*vertical-align:\s*0\.35em[^}]*line-height:\s*0[^}]*font-variant-numeric:\s*tabular-nums/)
    expect(css).toMatch(/\.source-name\s*\{[^}]*font-size:\s*var\(--fs-ui\)[^}]*font-weight:\s*600/)
    expect(css).toMatch(/\.source-ref\s*\{[^}]*font-size:\s*var\(--fs-micro\)[^}]*font-weight:\s*400[^}]*letter-spacing:\s*0\.01em/)
    expect(css).toMatch(/\.sources-label\s*\{[^}]*font-size:\s*var\(--fs-micro\)/)
    expect(css).not.toMatch(/\.sources-label\s*\{[^}]*text-transform:\s*uppercase/)
  })

  it('defines the approved control geometry, focus ring, and safe-area contract', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')

    for (const token of [
      '--h-input: 3rem;', '--h-btn: 3rem;', '--h-btn-sm: 2.25rem;', '--h-btn-icon: 2.75rem;',
      '--px-input: 1rem;', '--px-btn: 1.25rem;', '--px-btn-sm: 0.75rem;',
      '--r-sm: 0.5rem;', '--r-md: 0.75rem;', '--r-pill: 1.5rem;',
      '--gap-inline: 0.5rem;', '--gap-stack: 0.75rem;', '--tap-min: 2.75rem;'
    ]) expect(css).toContain(token)

    expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--h-btn\)[^}]*padding-inline:\s*var\(--px-btn\)[^}]*font-size:\s*var\(--fs-read\)[^}]*font-weight:\s*500/)
    expect(css).toMatch(/\.iconbtn\s*\{[^}]*width:\s*var\(--h-btn-icon\)[^}]*height:\s*var\(--h-btn-icon\)/)
    expect(css).toMatch(/\.field\s*\{[^}]*min-height:\s*var\(--h-input\)[^}]*padding-inline:\s*var\(--px-input\)/)
    expect(css).toMatch(/:focus-visible[^}]*outline:\s*2px solid[^}]*outline-offset:\s*2px/)
    expect(css).toContain('padding-bottom: calc(var(--gap-stack) + env(safe-area-inset-bottom));')
  })

  it('preserves the five-line chat input while expanding compact pointer targets', async () => {
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(css).toMatch(/\.prompt-ta\s*\{[^}]*min-height:\s*var\(--h-input\)[^}]*max-height:\s*8\.75rem[^}]*font-size:\s*var\(--fs-read\)[^}]*line-height:\s*var\(--lh-ui\)/)
    expect(css).toMatch(/\.sendbtn\s*\{[^}]*width:\s*var\(--h-btn-sm\)[^}]*height:\s*var\(--h-btn-sm\)/)
    expect(css).toMatch(/\.sendbtn::before[^}]*inset:\s*-0\.25rem/)
    expect(css).toMatch(/\.sendbtn\s+\.iconify|\.sendbtn\s*>\s*\.iconify/)
    expect(css).toMatch(/\.ai-actions\s*\{[^}]*gap:\s*var\(--gap-inline\)/)
  })

  it('removes the assistant marker but preserves responsive thread padding', async () => {
    const page = await readFile('pages/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).not.toContain('class="ai-mark"')
    expect(css).not.toContain('.ai-mark')
    expect(css).toMatch(/\.thread\s*\{[^}]*padding-inline:\s*1\.25rem/)
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*\.thread[^}]*padding-inline:\s*1rem/)
  })

  it('configures Nuxt Fonts for same-origin variable Latin assets', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies?: Record<string, string> }
    const config = await readFile('nuxt.config.ts', 'utf8')

    expect(packageJson.dependencies?.['@nuxt/fonts']).toBeTruthy()
    expect(config).toContain("modules: ['@nuxt/ui', '@nuxt/fonts']")
    expect(config).toContain("weights: ['400 600']")
    expect(config).toContain("subsets: ['latin']")
    expect(config).toContain("styles: ['normal']")
    expect(config).toContain("display: 'swap'")
    for (const family of ['Inter', 'Literata', 'JetBrains Mono']) {
      expect(config).toContain(`name: '${family}'`)
    }
  })
})
