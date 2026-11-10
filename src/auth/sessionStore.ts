import { ApiError, request, errorMessage } from './api'
import type { Session } from './session'
import type { Me } from './types'

type Tokens = {
  accessToken: string
  refreshToken: string
}

type SessionState = Session | { status: 'error'; message: string }

type Credentials = { email: string; password: string; teamName?: string }

const refreshKey = 'lumon.refresh'
const endedSessionCodes = ['REFRESH_INVALID', 'REFRESH_REUSED', 'SESSION_REVOKED', 'TOKEN_INVALID']
const listeners = new Set<() => void>()
let session: SessionState = { status: 'restoring', me: null }
let restoration: Promise<void> | undefined
let accessToken: string | undefined

function update(next: SessionState) {
  session = next
  listeners.forEach((listener) => listener())
}

export function getSession() {
  return session
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function forgetSession(message?: string) {
  accessToken = undefined
  update({ status: 'anonymous', me: null, message })
}

window.addEventListener('storage', (event) => {
  if (event.key === refreshKey && !event.newValue) forgetSession('La sesión se cerró en otra pestaña.')
})

function withSessionLock<T>(operation: () => Promise<T>) {
  if (!navigator.locks) {
    return Promise.reject(new ApiError('LOCKS_UNAVAILABLE', 'Usa un navegador actualizado desde localhost o HTTPS.'))
  }
  return navigator.locks.request(refreshKey, operation)
}

async function useTokens(tokens: Tokens) {
  localStorage.setItem(refreshKey, tokens.refreshToken)
  try {
    const profile = await request<Me>('/auth/me', { token: tokens.accessToken })
    accessToken = tokens.accessToken
    update({ status: 'authenticated', me: profile })
  } catch (error) {
    if (error instanceof ApiError && endedSessionCodes.includes(error.code)) {
      localStorage.removeItem(refreshKey)
      forgetSession(error.message)
      return
    }
    throw error
  }
}

export function signIn(credentials: Credentials) {
  return withSessionLock(async () => {
    const path = credentials.teamName === undefined ? '/auth/login' : '/auth/register'
    const tokens = await request<Tokens>(path, { method: 'POST', body: credentials })
    try {
      await useTokens(tokens)
    } catch (error) {
      // The account or session already exists. Offer restoration instead of resubmitting the form.
      update({ status: 'error', message: errorMessage(error) })
    }
  })
}

async function restore() {
  update({ status: 'restoring', me: null })
  try {
    await withSessionLock(async () => {
      const refreshToken = localStorage.getItem(refreshKey)
      if (!refreshToken) {
        forgetSession()
        return
      }

      let tokens: Tokens
      try {
        tokens = await request<Tokens>('/auth/refresh', { method: 'POST', body: { refreshToken } })
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'NETWORK' || endedSessionCodes.includes(error.code))) {
          // A lost response might have consumed this single-use token.
          localStorage.removeItem(refreshKey)
          forgetSession(`${error.message} Vuelve a iniciar sesión.`)
          return
        }
        throw error
      }

      await useTokens(tokens)
    })
  } catch (error) {
    update({ status: 'error', message: errorMessage(error) })
  }
}

export function restoreSession() {
  restoration ??= restore().finally(() => { restoration = undefined })
  return restoration
}

export function signOut() {
  return withSessionLock(async () => {
    const refreshToken = localStorage.getItem(refreshKey)
    if (refreshToken) {
      await request<void>('/auth/logout', { method: 'POST', body: { refreshToken } })
      localStorage.removeItem(refreshKey)
    }
    forgetSession()
  })
}

export async function sessionRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: object } = {}) {
  const token = accessToken
  if (!token) throw new ApiError('SESSION_MISSING', 'Inicia sesión para continuar.')

  try {
    return await request<T>(path, { ...options, token })
  } catch (error) {
    if (error instanceof ApiError && endedSessionCodes.includes(error.code)) {
      await withSessionLock(async () => {
        if (token !== accessToken) return
        localStorage.removeItem(refreshKey)
        forgetSession(error.message)
      })
    }
    if (error instanceof ApiError && error.code === 'TOKEN_EXPIRED') {
      throw new ApiError(error.code, 'La sesión caducó. Recarga la página para restaurarla.')
    }
    throw error
  }
}
