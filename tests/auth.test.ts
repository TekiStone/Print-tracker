import { describe, expect, it } from 'vitest'
import { hashPassword, requireAuth, verifyPassword } from '../server/auth.js'

describe('authentification', () => {
  it('hash les mots de passe sans conserver le secret en clair', async () => {
    const hash = await hashPassword('mot-de-passe-de-test')

    expect(hash).toMatch(/^scrypt:[^:]+:[^:]+$/)
    expect(hash).not.toContain('mot-de-passe-de-test')
    expect(await verifyPassword('mot-de-passe-de-test', hash)).toBe(true)
    expect(await verifyPassword('mauvais-mot-de-passe', hash)).toBe(false)
  })

  it('refuse les hashes invalides', async () => {
    await expect(verifyPassword('secret', 'not-a-scrypt-hash')).resolves.toBe(false)
    await expect(verifyPassword('secret', 'scrypt::hash')).resolves.toBe(false)
  })

  it('protège une route quand l’authentification est activée', () => {
    const next = vi.fn()
    const request = { session: {} } as Parameters<typeof requireAuth>[0]
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Parameters<typeof requireAuth>[1]

    requireAuth(request, response, next, true)

    expect(response.status).toHaveBeenCalledWith(401)
    expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required' })
    expect(next).not.toHaveBeenCalled()
  })
})
