import { afterEach, describe, expect, it, vi } from 'vitest'

describe('authentification OIDC', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('n’est pas configurée sans variables OIDC_*', async () => {
    const { authConfigured } = await import('../server/auth.js?oidc-unconfigured')

    expect(authConfigured()).toBe(false)
  })

  it('démarre puis complète un flux OIDC avec PKCE', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.test/')
    vi.stubEnv('OIDC_CLIENT_ID', 'client-id')
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.test/auth/callback')
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
    const { authConfigured, completeLogin, startLogin } = await import('../server/auth.js?oidc-flow')
    const request = { session: {}, query: {} } as Parameters<typeof startLogin>[0] & Parameters<typeof completeLogin>[0]
    const response = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as unknown as Parameters<typeof startLogin>[1] & Parameters<typeof completeLogin>[1]

    expect(authConfigured()).toBe(true)
    await startLogin(request, response)
    const redirectUrl = new URL(vi.mocked(response.redirect).mock.calls[0][0])
    request.query = { code: 'auth-code', state: request.session.oauthState }
    const profile = await completeLogin(request, response)

    expect(redirectUrl.origin).toBe('https://auth.example.test')
    expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(profile).toEqual({
      subject: 'authentik-user-1',
      username: 'atelier',
      email: 'atelier@example.test',
      name: 'Atelier',
      picture: 'https://auth.example.test/avatar.png',
    })
    expect(request.session.oauthState).toBeUndefined()
    expect(request.session.oauthVerifier).toBeUndefined()
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

    const profile = await completeLogin({ session: { oauthState: 'expected', oauthVerifier: 'verifier' }, query: { code: 'code', state: 'bad' } } as Parameters<typeof completeLogin>[0], response)

    expect(profile).toBeNull()
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

    const profile = await completeLogin({ session: { oauthState: 'expected', oauthVerifier: 'verifier' }, query: { code: 'code', state: 'expected' } } as Parameters<typeof completeLogin>[0], response)

    expect(profile).toBeNull()
    expect(response.status).toHaveBeenCalledWith(502)
    expect(response.send).toHaveBeenCalledWith(expectedMessage)
  })
})
