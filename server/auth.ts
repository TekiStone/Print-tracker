import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { NextFunction, Request, Response } from 'express'
import session from 'express-session'

export type AuthUser = {
  subject: string
  username: string
  email?: string
  name?: string
  picture?: string
}

declare module 'express-session' {
  interface SessionData {
    user?: AuthUser
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

const scrypt = promisify(crypto.scrypt)
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

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const derivedKey = await scrypt(password, salt, 64) as Buffer
  return `scrypt:${salt.toString('base64url')}:${derivedKey.toString('base64url')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [, saltValue, hashValue] = storedHash.split(':')
  if (!saltValue || !hashValue) return false
  const salt = Buffer.from(saltValue, 'base64url')
  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await scrypt(password, salt, expected.length) as Buffer
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET
  if (oidc && (!secret || secret.length < 32)) {
    throw new Error('SESSION_SECRET must contain at least 32 characters when OIDC is enabled')
  }
  return session({
    secret: secret ?? 'development-only-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
  })
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

export async function completeLogin(request: Request, response: Response): Promise<AuthUser | null> {
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
  const user: AuthUser = {
    subject: profile.sub,
    username: typeof profile.preferred_username === 'string' ? profile.preferred_username : typeof profile.email === 'string' ? profile.email : profile.sub,
    email: typeof profile.email === 'string' ? profile.email : undefined,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    picture: typeof profile.picture === 'string' ? profile.picture : undefined,
  }
  request.session.user = user
  delete request.session.oauthState
  delete request.session.oauthVerifier
  response.redirect('/')
  return user
}

export function requireAuth(request: Request, response: Response, next: NextFunction, enabled = authConfigured()) {
  if (!enabled || request.session.user) {
    next()
    return
  }
  response.status(401).json({ error: 'Authentication required' })
}
