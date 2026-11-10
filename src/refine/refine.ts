import { apiRequest } from '../api/client'
import { ApiError, NetworkError } from '../api/errors'
import { createRefiner } from './refiner'
import type { SendRefinement } from './refiner'
import type { RefineResult } from './types'

const sendRefinement: SendRefinement = async ({ fileId, bin, cells, idempotencyKey }) => {
  try {
    const { data, headers } = await apiRequest<RefineResult>(`/files/${fileId}/refinements`, {
      method: 'POST',
      body: { bin, cells },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return { kind: 'created', result: data, replayed: headers.get('Idempotent-Replayed') === 'true' }
  } catch (error) {
    if (error instanceof NetworkError) return { kind: 'retry', retryAfterSeconds: null }
    if (error instanceof ApiError) {
      if (error.status === 429 || error.status >= 500) {
        return { kind: 'retry', retryAfterSeconds: error.retryAfter }
      }
      return {
        kind: 'rejected',
        rejection: {
          httpStatus: error.status,
          code: error.code,
          message: error.message,
          details: error.details,
        },
      }
    }
    throw error
  }
}

/** Único en la pestaña: las keys sobreviven aunque se cambie de página y se vuelva. */
export const refine = createRefiner(sendRefinement)
