import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPassword, requireAuth, verifyPassword } from '../server/auth.js'

describe('authentification', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

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

  it('laisse passer une route publique ou une session déjà authentifiée', () => {
    const next = vi.fn()
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Parameters<typeof requireAuth>[1]

    requireAuth({ session: {} } as Parameters<typeof requireAuth>[0], response, next, false)
    requireAuth({ session: { user: { subject: 'user-1', username: 'atelier' } } } as Parameters<typeof requireAuth>[0], response, next, true)

    expect(next).toHaveBeenCalledTimes(2)
    expect(response.status).not.toHaveBeenCalled()
  })

  it('refuse OIDC sans secret de session robuste', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/callback')
    vi.stubEnv('SESSION_SECRET', 'trop-court')
    const { authConfigured, sessionMiddleware } = await import('../server/auth.js?oidc-short-secret')

    expect(authConfigured()).toBe(true)
    expect(() => sessionMiddleware()).toThrow('SESSION_SECRET must contain at least 32 characters when OIDC is enabled')
  })

  it('démarre puis complète un flux OIDC avec PKCE', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test/')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/auth/callback')
    vi.stubEnv('SESSION_SECRET', '01234567890123456789012345678901')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        userinfo_endpoint: 'https://auth.example.test/userinfo',
      }))
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
      .mockResolvedValueOnce(Response.json({
        sub: 'authentik-user-1',
        preferred_username: 'atelier',
        email: 'atelier@example.test',
        name: 'Atelier',
        picture: 'https://auth.example.test/avatar.png',
      })))
    const { completeLogin, startLogin } = await import('../server/auth.js?oidc-flow')
    const request = { session: {}, query: {} } as Parameters<typeof startLogin>[0] & Parameters<typeof completeLogin>[0]
    const response = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Parameters<typeof startLogin>[1] & Parameters<typeof completeLogin>[1]

    await startLogin(request, response)
    const redirectUrl = new URL(vi.mocked(response.redirect).mock.calls[0][0])
    request.query = { code: 'auth-code', state: request.session.oauthState }
    const user = await completeLogin(request, response)

    expect(redirectUrl.origin).toBe('https://auth.example.test')
    expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(user).toEqual({
      subject: 'authentik-user-1',
      username: 'atelier',
      email: 'atelier@example.test',
      name: 'Atelier',
      picture: 'https://auth.example.test/avatar.png',
    })
    expect(request.session.user).toEqual(user)
    expect(request.session.oauthState).toBeUndefined()
  })

  it('rejette un callback OIDC dont l’état ne correspond pas', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/auth/callback')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({
      authorization_endpoint: 'https://auth.example.test/authorize',
      token_endpoint: 'https://auth.example.test/token',
      userinfo_endpoint: 'https://auth.example.test/userinfo',
    })))
    const { completeLogin } = await import('../server/auth.js?oidc-invalid-state')
    const response = { status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Parameters<typeof completeLogin>[1]

    const user = await completeLogin({ session: { oauthState: 'expected', oauthVerifier: 'verifier' }, query: { code: 'code', state: 'bad' } } as Parameters<typeof completeLogin>[0], response)

    expect(user).toBeNull()
    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.send).toHaveBeenCalledWith('Invalid OIDC callback state')
  })

  it('rejette un discovery OIDC incomplet', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/auth/callback')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ authorization_endpoint: 'https://auth.example.test/authorize' })))
    const { startLogin } = await import('../server/auth.js?oidc-incomplete-discovery')

    await expect(startLogin({ session: {} } as Parameters<typeof startLogin>[0], { redirect: vi.fn() } as unknown as Parameters<typeof startLogin>[1])).rejects.toThrow('OIDC discovery document is incomplete')
  })

  it.each([
    ['token absent', Response.json({}), 'OIDC response did not contain an access token'],
    ['userinfo refusé', Response.json({ access_token: 'access-token' }), 'OIDC userinfo request failed', Response.json({}, { status: 502 })],
    ['profil sans sujet', Response.json({ access_token: 'access-token' }), 'OIDC profile has no subject', Response.json({ email: 'atelier@example.test' })],
  ])('rejette un callback OIDC quand %s', async (_label, tokenResponse, expectedMessage, userinfoResponse) => {
    vi.resetModules()
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/auth/callback')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        userinfo_endpoint: 'https://auth.example.test/userinfo',
      }))
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(userinfoResponse ?? Response.json({ sub: 'user-1' })))
    const { completeLogin } = await import('../server/auth.js')
    const response = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Parameters<typeof completeLogin>[1]

    const user = await completeLogin({ session: { oauthState: 'expected', oauthVerifier: 'verifier' }, query: { code: 'code', state: 'expected' } } as Parameters<typeof completeLogin>[0], response)

    expect(user).toBeNull()
    expect(response.status).toHaveBeenCalledWith(502)
    expect(response.send).toHaveBeenCalledWith(expectedMessage)
  })
})
