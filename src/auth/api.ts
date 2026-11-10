import { config } from '../config'

export class ApiError extends Error {
  readonly code: string
  readonly fields: Record<string, string>

  constructor(code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.code = code
    this.fields = fields
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT'
  body?: object
  token?: string
}

export async function request<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ 'X-Lumon-Build': config.build })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ApiError('NETWORK', 'No pudimos conectar con Lumon. Comprueba tu conexión e inténtalo de nuevo.')
  }

  if (response.status === 204) return undefined as T

  if (!response.ok) {
    const error: { error?: string; message?: string; details?: { fields?: Record<string, string> } } | null =
      await response.json().catch(() => null)
    const code = error?.error ?? `HTTP_${response.status}`
    const message = code === 'CHECK_FROM_APP_REQUIRED'
      ? 'Ejecuta esta revisión desde la aplicación desplegada en el dominio verificado.'
      : error?.message ?? 'Lumon no pudo completar la solicitud.'
    throw new ApiError(code, message, error?.details?.fields)
  }

  return response.json() as Promise<T>
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.'
}
