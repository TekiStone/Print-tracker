async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf-token', {
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await parseJson(response)
    throw new Error(body?.error ?? 'Impossible de récupérer le jeton CSRF')
  }

  const body = await response.json() as { token?: string }
  if (!body.token) {
    throw new Error('Jeton CSRF manquant')
  }

  return body.token
}
