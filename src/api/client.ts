import { config } from '../config'
import { ApiError, NetworkError, type ApiErrorBody } from './errors'
import { endSession, getAccessToken, refreshAccessToken } from './session'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** false para las rutas públicas (login, registro, health). */
  auth?: boolean
}

export interface ApiResponse<T> {
  data: T
  status: number
  headers: Headers
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'X-Lumon-Build': config.build, ...opts.headers }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    return await fetch(`${config.apiBaseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new NetworkError()
  }
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null
  return new ApiError(
    res.status,
    body ?? { error: `HTTP_${res.status}`, message: res.statusText || `Error ${res.status}`, details: null },
    res.headers,
  )
}

/**
 * Request a la API con X-Lumon-Build y Authorization.
 * Ante `401 TOKEN_EXPIRED` hace (o espera) un único refresh compartido y reintenta UNA sola vez.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const useAuth = opts.auth !== false
  let token = useAuth ? getAccessToken() : null
  if (useAuth && token === null) token = await refreshAccessToken(null)

  let res = await send(path, opts, token)

  if (useAuth && res.status === 401) {
    const err = await toError(res)
    if (err.code !== 'TOKEN_EXPIRED') {
      if (err.code === 'SESSION_REVOKED') endSession('SESSION_REVOKED')
      throw err
    }
    token = await refreshAccessToken(token)
    res = await send(path, opts, token)
    if (res.status === 401) {
      const retryErr = await toError(res)
      if (retryErr.code === 'SESSION_REVOKED') endSession('SESSION_REVOKED')
      throw retryErr
    }
  }

  if (!res.ok) throw await toError(res)
  const data = res.status === 204 ? (undefined as T) : ((await res.json().catch(() => undefined)) as T)
  return { data, status: res.status, headers: res.headers }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await apiRequest<T>(path, opts)).data
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

export { sleep }

/** Espera creciente con jitter: 0.5s, 1s, 2s, 4s… hasta `max`. */
export function backoffDelay(attempt: number, max = 15000): number {
  const base = Math.min(max, 500 * 2 ** attempt)
  return base / 2 + Math.random() * (base / 2)
}

/** Reintenta `503` (respetando Retry-After) y errores de red con espera creciente. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, attempts = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retriable = (err instanceof ApiError && err.status === 503) || err instanceof NetworkError
      if (!retriable || attempt >= attempts - 1) throw err
      const hinted = err instanceof ApiError && err.retryAfter !== null ? err.retryAfter * 1000 : 0
      await sleep(Math.max(hinted, backoffDelay(attempt)), signal)
    }
  }
}
