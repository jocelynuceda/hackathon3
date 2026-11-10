import { api, withRetry } from '../api/client'
import { config } from '../config'
import type { Media, MediaTicket, PreparedImage } from './types'

export function requestTicket(image: PreparedImage, signal: AbortSignal): Promise<MediaTicket> {
  return withRetry(
    () =>
      api<MediaTicket>('/media/tickets', {
        method: 'POST',
        signal,
        body: {
          purpose: image.purpose,
          contentType: 'image/webp',
          bytes: image.blob.size,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
        },
      }),
    signal,
  )
}

function publicUrl(bucket: string, objectPath: string) {
  return `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

function storageTarget(ticket: MediaTicket) {
  if (ticket.provider !== 'SUPABASE' || !ticket.objectPath) {
    throw new Error('El equipo no tiene Supabase Storage configurado.')
  }
  return { bucket: ticket.bucket ?? config.supabaseBucket, objectPath: ticket.objectPath }
}

/** Sube con XMLHttpRequest porque fetch no informa el progreso de subida. */
export function uploadToStorage(
  ticket: MediaTicket,
  blob: Blob,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { bucket, objectPath } = storageTarget(ticket)

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`)
    request.setRequestHeader('apikey', config.supabasePublishableKey)
    request.setRequestHeader('Authorization', `Bearer ${config.supabasePublishableKey}`)
    request.setRequestHeader('Content-Type', 'image/webp')
    request.setRequestHeader('x-upsert', 'false')

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      // Si se perdió la respuesta de un intento anterior, el archivo ya está en esa ruta.
      const alreadyThere = /duplicate|already exists/i.test(request.responseText)
      if ((request.status >= 200 && request.status < 300) || alreadyThere) {
        resolve()
      } else {
        reject(new Error(`El storage rechazó la imagen (HTTP ${request.status}).`))
      }
    }
    request.onerror = () => reject(new Error('Se cortó la conexión con el storage.'))
    request.onabort = () => reject(new DOMException('Aborted', 'AbortError'))

    if (signal.aborted) {
      request.abort()
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal.addEventListener('abort', () => request.abort(), { once: true })
    request.send(blob)
  })
}

export function confirmUpload(ticket: MediaTicket, signal: AbortSignal): Promise<Media> {
  const { bucket, objectPath } = storageTarget(ticket)
  return withRetry(
    () =>
      api<Media>(`/media/tickets/${ticket.ticketId}/confirm`, {
        method: 'POST',
        signal,
        body: { url: publicUrl(bucket, objectPath) },
      }),
    signal,
  )
}
