import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('development authentication UI acceptance', () => {
  it('exposes development login from the shared auth modal without revealing allowlisted contacts', async () => {
    const authModal = await readFile('components/AuthModal.vue', 'utf8')

    expect(authModal).toContain('/api/auth/dev-login')
    expect(authModal).toContain('devAuthAvailable')
    expect(authModal).toContain('Entrar em modo desenvolvimento')
    expect(authModal).toContain('Modo de desenvolvimento')
    expect(authModal).toContain('UJIMU_DEV_AUTH_ENABLED')
    expect(authModal).not.toContain('UJIMU_DEV_USER_CONTACTS')
  })
})
