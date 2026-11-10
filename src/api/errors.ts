export interface ApiErrorBody {
  error: string
  message: string
  details: unknown
  timestamp?: string
  path?: string
  requestId?: string
}

/** Error de la API con el código de `error` (para decidir) y `message` (solo para mostrar). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  /** Segundos de `Retry-After`, si vino la cabecera. */
  readonly retryAfter: number | null
  readonly headers: Headers | null

  constructor(status: number, body: ApiErrorBody, headers: Headers | null = null) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.error
    this.details = body.details
    this.headers = headers
    this.retryAfter = parseRetryAfter(headers?.get('Retry-After') ?? null)
  }
}

/** Error de red (sin respuesta del servidor). */
export class NetworkError extends Error {
  constructor(message = 'No se pudo conectar con Lumon.') {
    super(message)
    this.name = 'NetworkError'
  }
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, (date - Date.now()) / 1000)
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** Mensajes de campo de `VALIDATION_ERROR` (`details.fields`) o de un `409` (`details.field`). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || typeof err.details !== 'object' || err.details === null) return {}
  const details = err.details as { fields?: Record<string, string>; field?: string }
  if (details.fields) return details.fields
  if (details.field) return { [details.field]: err.message }
  return {}
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message
  if (err instanceof Error) return err.message
  return 'Ocurrió un error inesperado.'
}
