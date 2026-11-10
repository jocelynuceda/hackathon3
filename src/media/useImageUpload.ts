import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage, isAbortError } from '../api/errors'
import { confirmUpload, requestTicket, uploadToStorage } from './upload'
import type { Media, MediaTicket, PreparedImage } from './types'

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; progress: number }
  | { phase: 'confirming' }
  | { phase: 'done'; media: Media }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string }

interface UploadRun {
  image: PreparedImage
  ticket: MediaTicket | null
  uploaded: boolean
}

const TICKET_MARGIN_MS = 5_000

function isExpired(ticket: MediaTicket) {
  return Date.parse(ticket.expiresAt) <= Date.now() + TICKET_MARGIN_MS
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiError && error.code === 'MEDIA_VERIFICATION_FAILED') {
    return `Lumon no aceptó la imagen: ${error.message}`
  }
  return errorMessage(error)
}

/** Ticket, subida con progreso y confirmación. Reintentar continúa desde el paso que falló. */
export function useImageUpload() {
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const runRef = useRef<UploadRun | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const execute = useCallback(async () => {
    const run = runRef.current
    if (!run) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const { signal } = controller

    try {
      setState({ phase: 'uploading', progress: 0 })
      if (!run.ticket || isExpired(run.ticket)) {
        run.ticket = await requestTicket(run.image, signal)
        run.uploaded = false
      }
      if (!run.uploaded) {
        await uploadToStorage(run.ticket, run.image.blob, signal, (progress) => {
          if (!signal.aborted) setState({ phase: 'uploading', progress })
        })
        run.uploaded = true
      }
      if (signal.aborted) return
      setState({ phase: 'confirming' })
      const media = await confirmUpload(run.ticket, signal)
      if (!signal.aborted) setState({ phase: 'done', media })
    } catch (error) {
      if (controllerRef.current !== controller) return
      if (isAbortError(error) || signal.aborted) {
        setState({ phase: 'cancelled' })
        return
      }
      if (error instanceof ApiError && error.code === 'TICKET_EXPIRED') run.ticket = null
      setState({ phase: 'error', message: describeFailure(error) })
    }
  }, [])

  const start = useCallback(
    (image: PreparedImage) => {
      runRef.current = { image, ticket: null, uploaded: false }
      void execute()
    },
    [execute],
  )

  const cancel = useCallback(() => controllerRef.current?.abort(), [])
  const retry = useCallback(() => void execute(), [execute])

  useEffect(() => () => controllerRef.current?.abort(), [])

  return { state, start, cancel, retry }
}
