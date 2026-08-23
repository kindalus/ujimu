import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function styles(): Promise<string> {
  return `${await readFile('assets/css/main.css', 'utf8')}\n${await readFile('assets/css/typography.css', 'utf8')}`
}

describe('control language and profile polish acceptance', () => {
  it('renders action buttons as pills and icon buttons as circles without reshaping structural buttons', async () => {
    const css = await styles()

    expect(css).toMatch(/\.btn\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s)
    expect(css).toMatch(/\.iconbtn\s*\{[^}]*border-radius:\s*50%/s)
    expect(css).toMatch(/\.btn--xs,[\s\S]*\.spec-chip,[\s\S]*\.ad-cta,[\s\S]*\{[^}]*border-radius:\s*var\(--r-pill\)/)
    expect(css).toMatch(/button:not\(:disabled\)[^}]*cursor:\s*pointer/)
    expect(css).not.toMatch(/\.spec-card\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s)
    expect(css).not.toMatch(/\.spec-opt\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s)
    expect(css).not.toMatch(/\.adm-toggle\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s)
  })

  it('uses underlined input and textarea fields while preserving selects, OTP, and the composer', async () => {
    const css = await styles()

    expect(css).toContain(':where(input.field, textarea.field)')
    expect(css).toMatch(/:where\(input\.field, textarea\.field\)\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid var\(--line-strong\)[^}]*border-radius:\s*0/s)
    expect(css).toMatch(/:where\(input\.field, textarea\.field\):focus-visible\s*\{[^}]*border-bottom:\s*2px solid var\(--yellow\)[^}]*outline:\s*none/s)
    expect(css).toMatch(/\.otp-cell\s*\{[^}]*border:\s*1px solid/s)
    expect(css).toMatch(/\.prompt\s*\{[^}]*border:\s*1px solid/s)
    expect(css).toMatch(/select\.field\s*\{[^}]*appearance:\s*none/s)
  })

  it('uses link actions for response cancellation and profile navigation with corrected profile spacing', async () => {
    const [page, profile, css] = await Promise.all([
      readFile('pages/index.vue', 'utf8'),
      readFile('pages/account/profile.vue', 'utf8'),
      styles()
    ])

    expect(page).toContain('class="btn-link cancel-response"')
    expect(profile).toContain('class="btn-link profile-back"')
    expect(css).toMatch(/\.btn-link\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\.prof-head \.subpage-sub\s*\{[^}]*margin-top:\s*0/s)
    expect(css).toMatch(/\.prof-head\s*>\s*div\s*\{[^}]*gap:\s*var\(--gap-inline\)/s)
    expect(css).toMatch(/\.profile-back\s*\{[^}]*align-self:\s*flex-start/s)
  })
})
