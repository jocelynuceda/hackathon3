import type { Bin, Cell, RefineResult } from './types'

export interface RefineRequest {
  fileId: number
  bin: Bin
  cells: Cell[]
  idempotencyKey: string
}

/** Hace el POST /files/{id}/refinements con el cliente de la API y entrega la respuesta. */
export type SendRefinement = (request: RefineRequest) => Promise<Response>

export interface RefineRejection {
  httpStatus: number
  error: string
  message: string
  details: unknown
}

export type RefineOutcome =
  | { status: 'refined'; result: RefineResult; replayed: boolean }
  | { status: 'rejected'; rejection: RefineRejection }
  | { status: 'unavailable' }

const MAX_ATTEMPTS = 6
const BASE_DELAY_MS = 500

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const backoff = BASE_DELAY_MS * 2 ** attempt
  const seconds = Number(retryAfter)
  return retryAfter !== null && Number.isFinite(seconds) ? Math.max(backoff, seconds * 1_000) : backoff
}

function intentOf(fileId: number, bin: Bin, cells: readonly Cell[]): string {
  const sorted = cells.map(({ r, c }) => `${r}:${c}`).sort()
  return `${fileId}|${bin}|${sorted.join(',')}`
}

async function toRejection(response: Response): Promise<RefineRejection> {
  const fallback = { error: 'UNKNOWN', message: 'El servidor rechazó la solicitud.', details: null }
  const body = (await response.json().catch(() => fallback)) as typeof fallback
  return { httpStatus: response.status, error: body.error, message: body.message, details: body.details }
}

/**
 * Regla de Kier: la misma intención (archivo, caja y celdas) usa siempre la misma Idempotency-Key.
 * Un doble clic comparte la request en curso, y un reintento nunca refina ni cuenta un error dos veces.
 */
export function createRefiner(send: SendRefinement) {
  const keys = new Map<string, string>()
  const inFlight = new Map<string, Promise<RefineOutcome>>()

  async function attempt(request: RefineRequest): Promise<RefineOutcome> {
    for (let attemptIndex = 0; attemptIndex < MAX_ATTEMPTS; attemptIndex += 1) {
      let response: Response
      try {
        response = await send(request)
      } catch {
        await wait(retryDelayMs(attemptIndex, null))
        continue
      }

      if (response.status === 429 || response.status >= 500) {
        await wait(retryDelayMs(attemptIndex, response.headers.get('Retry-After')))
        continue
      }

      if (response.status === 201) {
        const result = (await response.json()) as RefineResult
        return {
          status: 'refined',
          result,
          replayed: response.headers.get('Idempotent-Replayed') === 'true',
        }
      }

      return { status: 'rejected', rejection: await toRejection(response) }
    }
    return { status: 'unavailable' }
  }

  return function refine(fileId: number, bin: Bin, cells: Cell[]): Promise<RefineOutcome> {
    const intent = intentOf(fileId, bin, cells)

    const running = inFlight.get(intent)
    if (running) return running

    let idempotencyKey = keys.get(intent)
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID()
      keys.set(intent, idempotencyKey)
    }

    const outcome = attempt({ fileId, bin, cells, idempotencyKey }).finally(() => {
      inFlight.delete(intent)
    })
    inFlight.set(intent, outcome)
    return outcome
  }
}
