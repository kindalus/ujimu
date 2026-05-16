import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('initial UI shell', () => {
  it('contains the required placeholder regions and pt-PT pre-1990 copy', async () => {
    const page = await readFile('pages/index.vue', 'utf8')

    expect(page).toContain('Escolha uma especialidade')
    expect(page).toContain('Faça uma pergunta')
    expect(page).toContain('Conteúdo gerado por IA')
    expect(page).toContain('Publicidade')
  })
})
