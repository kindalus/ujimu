import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('admin specialists layout acceptance', () => {
  it('keeps the create-specialist form on the same vertical spacing rhythm as edit metadata cards', async () => {
    const page = await readFile('pages/admin/specialists/index.vue', 'utf8')
    const css = await readFile('assets/css/main.css', 'utf8')

    expect(page).toContain('<form class="adm-create" @submit.prevent="createSpecialist">')
    expect(css).toMatch(/\.adm-create\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*12px;[^}]*\}/s)
  })
})
