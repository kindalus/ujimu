import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('admin specialist management UI acceptance', () => {
  it('exposes a single-page admin console for specialist CRUD, uploads, ingestion, and delete confirmation', async () => {
    const page = await readFile('pages/admin/index.vue', 'utf8')

    expect(page).toContain('/api/admin/session')
    expect(page).toContain('/api/admin/specialists')
    expect(page).toContain('/raw')
    expect(page).toContain('/sources/reload')
    expect(page).toContain('/ingestion/run')
    expect(page).toContain('Administração')
    expect(page).toContain('Tem de iniciar sessão para aceder à administração.')
    expect(page).toContain('Não tem permissões de administração.')
    expect(page).toContain('Criar especialidade')
    expect(page).toContain('Editar especialidade')
    expect(page).toContain('Carregar fonte')
    expect(page).toContain('Recarregar fontes')
    expect(page).toContain('Executar ingestão')
    expect(page).toContain('Apagar especialidade')
    expect(page).toContain('confirmationId')
  })
})
