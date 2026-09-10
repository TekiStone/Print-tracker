import crypto from 'node:crypto'
import type { Request, Response } from 'express'

export type OidcProfile = {
  subject: string
  username: string
  email?: string
  name?: string
  picture?: string
}

declare module 'express-session' {
  interface SessionData {
    oauthState?: string
    oauthVerifier?: string
  }
}

type OidcConfiguration = {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string
}

const oidc: OidcConfiguration | null = process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID &&
  process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI
  ? {
      issuer: process.env.OIDC_ISSUER.replace(/\/$/, ''),
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      redirectUri: process.env.OIDC_REDIRECT_URI,
      authorizationEndpoint: '',
      tokenEndpoint: '',
      userinfoEndpoint: '',
    }
  : null

let discoveryPromise: Promise<OidcConfiguration> | undefined

async function getConfiguration(): Promise<OidcConfiguration> {
  if (!oidc) throw new Error('OIDC is not configured')
  if (!discoveryPromise) {
    discoveryPromise = fetch(`${oidc.issuer}/.well-known/openid-configuration`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}`)
        const document = await response.json() as Record<string, unknown>
        if (typeof document.authorization_endpoint !== 'string' ||
            typeof document.token_endpoint !== 'string' ||
            typeof document.userinfo_endpoint !== 'string') {
          throw new Error('OIDC discovery document is incomplete')
        }
        return { ...oidc, authorizationEndpoint: document.authorization_endpoint, tokenEndpoint: document.token_endpoint, userinfoEndpoint: document.userinfo_endpoint }
      })
  }
  return discoveryPromise
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32))
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function authConfigured() {
  return oidc !== null
}

export async function startLogin(request: Request, response: Response) {
  const configuration = await getConfiguration()
  const state = base64Url(crypto.randomBytes(32))
  const { verifier, challenge } = createPkce()
  request.session.oauthState = state
  request.session.oauthVerifier = verifier
  const url = new URL(configuration.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  response.redirect(url.toString())
}

export async function completeLogin(request: Request, response: Response): Promise<OidcProfile | null> {
  const configuration = await getConfiguration()
  const { code, state } = request.query
  if (typeof code !== 'string' || typeof state !== 'string' || state !== request.session.oauthState || !request.session.oauthVerifier) {
    response.status(400).send('Invalid OIDC callback state')
    return null
  }
  const tokenResponse = await fetch(configuration.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: configuration.redirectUri,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code_verifier: request.session.oauthVerifier,
    }),
  })
  if (!tokenResponse.ok) {
    response.status(502).send('OIDC token exchange failed')
    return null
  }
  const tokens = await tokenResponse.json() as { access_token?: string }
  if (!tokens.access_token) {
    response.status(502).send('OIDC response did not contain an access token')
    return null
  }
  const userResponse = await fetch(configuration.userinfoEndpoint, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userResponse.ok) {
    response.status(502).send('OIDC userinfo request failed')
    return null
  }
  const profile = await userResponse.json() as Record<string, unknown>
  if (typeof profile.sub !== 'string') {
    response.status(502).send('OIDC profile has no subject')
    return null
  }
  const user: OidcProfile = {
    subject: profile.sub,
    username: typeof profile.preferred_username === 'string' ? profile.preferred_username : typeof profile.email === 'string' ? profile.email : profile.sub,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    picture: typeof profile.picture === 'string' ? profile.picture : undefined,
  }
  delete request.session.oauthState
  delete request.session.oauthVerifier
  return user
}
