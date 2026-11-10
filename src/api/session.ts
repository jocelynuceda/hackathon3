/**
 * Sesión compartida entre pestañas.
 *
 * - El access token vive SOLO en memoria (variable de módulo). Se comparte entre pestañas por
 *   BroadcastChannel, que no persiste nada.
 * - El refresh token (de un solo uso) se guarda en localStorage para restaurar la sesión.
 * - Un solo refresh a la vez: dentro de la pestaña, todas las requests que reciben TOKEN_EXPIRED
 *   esperan la misma promesa; entre pestañas, el refresh corre dentro de un Web Lock exclusivo,
 *   así dos pestañas nunca presentan el mismo refresh token (eso causaría REFRESH_REUSED).
 */
import { config } from '../config'
import { ApiError, NetworkError, type ApiErrorBody } from './errors'

const RT_KEY = 'lumon.refreshToken'
const LOCK_NAME = 'lumon-refresh'

export type SessionEndReason = 'LOGOUT' | 'REFRESH_REUSED' | 'SESSION_REVOKED' | 'REFRESH_INVALID'

export type SessionEvent =
  | { type: 'tokens' }
  | { type: 'ended'; reason: SessionEndReason }

type ChannelMessage =
  | { type: 'tokens'; accessToken: string }
  | { type: 'ended'; reason: SessionEndReason }

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

let accessToken: string | null = null
let refreshing: Promise<string> | null = null
const listeners = new Set<(event: SessionEvent) => void>()

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lumon-session')

function emit(event: SessionEvent) {
  for (const listener of listeners) listener(event)
}

channel?.addEventListener('message', (e: MessageEvent<ChannelMessage>) => {
  const msg = e.data
  if (msg.type === 'tokens') {
    accessToken = msg.accessToken
    emit({ type: 'tokens' })
  } else if (msg.type === 'ended') {
    accessToken = null
    emit({ type: 'ended', reason: msg.reason })
  }
})

// Respaldo por si BroadcastChannel no llega: si otra pestaña borró el refresh token, la sesión terminó.
window.addEventListener('storage', (e) => {
  if (e.key === RT_KEY && e.newValue === null && accessToken !== null) {
    accessToken = null
    emit({ type: 'ended', reason: 'LOGOUT' })
  }
})

export function onSessionEvent(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAccessToken(): string | null {
  return accessToken
}

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(RT_KEY)
  } catch {
    return null
  }
}

function writeRefreshToken(token: string | null) {
  try {
    if (token === null) localStorage.removeItem(RT_KEY)
    else localStorage.setItem(RT_KEY, token)
  } catch {
    // Sin storage la sesión no sobrevive a la recarga, pero sigue funcionando.
  }
}

export function hasStoredSession(): boolean {
  return readRefreshToken() !== null
}

/** Guarda un par nuevo (login, registro o refresh) y avisa a las demás pestañas. */
export function setSession(pair: TokenPair) {
  accessToken = pair.accessToken
  writeRefreshToken(pair.refreshToken)
  channel?.postMessage({ type: 'tokens', accessToken: pair.accessToken } satisfies ChannelMessage)
  emit({ type: 'tokens' })
}

/** Termina la sesión en esta pestaña y en todas las demás. */
export function endSession(reason: SessionEndReason) {
  const wasActive = accessToken !== null || readRefreshToken() !== null
  accessToken = null
  writeRefreshToken(null)
  if (!wasActive && reason !== 'LOGOUT') return
  channel?.postMessage({ type: 'ended', reason } satisfies ChannelMessage)
  emit({ type: 'ended', reason })
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, fn)
  }
  return fn()
}

async function postRefresh(refreshToken: string): Promise<TokenPair> {
  let res: Response
  try {
    res = await fetch(`${config.apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lumon-Build': config.build },
      body: JSON.stringify({ refreshToken }),
    })
  } catch {
    throw new NetworkError()
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(res.status, body ?? { error: 'HTTP_' + res.status, message: res.statusText, details: null }, res.headers)
  }
  return (await res.json()) as TokenPair
}

/**
 * Devuelve un access token válido haciendo, como mucho, un refresh compartido.
 * `failedToken` es el token con el que la request recibió TOKEN_EXPIRED: si mientras esperábamos
 * el lock otra pestaña ya consiguió uno nuevo, se usa ese y no se hace otro refresh.
 */
export function refreshAccessToken(failedToken: string | null): Promise<string> {
  if (refreshing) return refreshing
  refreshing = withLock(async () => {
    if (accessToken !== null && accessToken !== failedToken) return accessToken
    const refreshToken = readRefreshToken()
    if (!refreshToken) {
      endSession('REFRESH_INVALID')
      throw new ApiError(401, { error: 'REFRESH_INVALID', message: 'No hay sesión.', details: null })
    }
    try {
      const pair = await postRefresh(refreshToken)
      setSession(pair) // se escribe dentro del lock: la siguiente pestaña ya lee el token nuevo
      return pair.accessToken
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const reason: SessionEndReason =
          err.code === 'REFRESH_REUSED' ? 'REFRESH_REUSED' : err.code === 'SESSION_REVOKED' ? 'SESSION_REVOKED' : 'REFRESH_INVALID'
        endSession(reason)
      }
      throw err
    }
  }).finally(() => {
    refreshing = null
  })
  return refreshing
}

export function takeRefreshTokenForLogout(): string | null {
  return readRefreshToken()
}
