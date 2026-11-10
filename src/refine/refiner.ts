import type { Bin, Cell, RefineResult } from './types'

export interface RefineRequest {
  fileId: number
  bin: Bin
  cells: Cell[]
  idempotencyKey: string
}

export interface RefineRejection {
  httpStatus: number
  code: string
  message: string
  details: unknown
}

/** Resultado de un intento: creado, rechazado de forma definitiva o conviene reintentar. */
export type SendResult =
  | { kind: 'created'; result: RefineResult; replayed: boolean }
  | { kind: 'rejected'; rejection: RefineRejection }
  | { kind: 'retry'; retryAfterSeconds: number | null }

export type SendRefinement = (request: RefineRequest) => Promise<SendResult>

export type RefineOutcome =
  | { status: 'refined'; result: RefineResult; replayed: boolean }
  | { status: 'rejected'; rejection: RefineRejection }
  | { status: 'unavailable' }

const MAX_ATTEMPTS = 6
const BASE_DELAY_MS = 500

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function intentOf(fileId: number, bin: Bin, cells: readonly Cell[]): string {
  const sorted = cells.map(({ r, c }) => `${r}:${c}`).sort()
  return `${fileId}|${bin}|${sorted.join(',')}`
}

/**
 * Regla de Kier: la misma intención (archivo, caja y celdas) usa siempre la misma Idempotency-Key.
 * Un doble clic comparte la request en curso, y un reintento nunca refina ni cuenta un error dos veces.
 */
export function createRefiner(send: SendRefinement) {
  const keys = new Map<string, string>()
  const inFlight = new Map<string, Promise<RefineOutcome>>()

  async function attempt(request: RefineRequest): Promise<RefineOutcome> {
    for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
      const sent = await send(request)
      if (sent.kind === 'created') {
        return { status: 'refined', result: sent.result, replayed: sent.replayed }
      }
      if (sent.kind === 'rejected') {
        return { status: 'rejected', rejection: sent.rejection }
      }
      const backoff = BASE_DELAY_MS * 2 ** index
      await wait(Math.max(backoff, (sent.retryAfterSeconds ?? 0) * 1_000))
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
