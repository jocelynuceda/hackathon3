import type { PreparedImage } from './types'

export const BADGE_SIZE = 512
export const BADGE_MAX_BYTES = 122_880
export const INCIDENT_MAX_BYTES = 307_200
export const INCIDENT_MIN_LONG_SIDE = 800
export const INCIDENT_MAX_LONG_SIDE = 1600

const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]

export class ImagePreparationError extends Error {}

export interface Crop {
  /** Centro del recorte, en píxeles de la imagen. */
  centerX: number
  centerY: number
  zoom: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImagePreparationError('No se pudo leer ese archivo como imagen.')
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function initialCrop(image: ImageBitmap): Crop {
  return { centerX: image.width / 2, centerY: image.height / 2, zoom: MIN_ZOOM }
}

/** Lado del recorte y esquina superior izquierda, siempre dentro de la imagen. */
export function cropRect(image: ImageBitmap, crop: Crop) {
  const side = Math.min(image.width, image.height) / crop.zoom
  return {
    side,
    x: clamp(crop.centerX - side / 2, 0, image.width - side),
    y: clamp(crop.centerY - side / 2, 0, image.height - side),
  }
}

/** Devuelve el recorte con el centro ajustado para no salirse de la imagen. */
export function clampCrop(image: ImageBitmap, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM)
  const { side, x, y } = cropRect(image, { ...crop, zoom })
  return { zoom, centerX: x + side / 2, centerY: y + side / 2 }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

/** Codifica como WebP. Pasar por canvas descarta EXIF, XMP y ubicación. */
async function encodeWebp(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob | null> {
  for (const quality of QUALITIES) {
    const blob = await toBlob(canvas, quality)
    if (!blob || blob.type !== 'image/webp') {
      throw new ImagePreparationError('Tu navegador no puede generar imágenes WebP. Prueba con Chrome, Edge o Firefox.')
    }
    if (blob.size <= maxBytes) return blob
  }
  return null
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new ImagePreparationError('Tu navegador no pudo procesar la imagen.')
  return { canvas, context }
}

export async function prepareBadge(image: ImageBitmap, crop: Crop): Promise<PreparedImage> {
  const { x, y, side } = cropRect(image, crop)
  const { canvas, context } = createCanvas(BADGE_SIZE, BADGE_SIZE)
  context.drawImage(image, x, y, side, side, 0, 0, BADGE_SIZE, BADGE_SIZE)

  const blob = await encodeWebp(canvas, BADGE_MAX_BYTES)
  if (!blob) throw new ImagePreparationError('No se pudo dejar el fotocheck por debajo de 120 KB.')
  return { purpose: 'BADGE', blob, width: BADGE_SIZE, height: BADGE_SIZE, sha256: await sha256Hex(blob) }
}

export async function prepareIncidentPhoto(file: Blob): Promise<PreparedImage> {
  const image = await decodeImage(file)
  try {
    const longSide = Math.max(image.width, image.height)
    // Si no entra en el peso máximo, se reduce el lado mayor hasta el mínimo permitido.
    let target = clamp(longSide, INCIDENT_MIN_LONG_SIDE, INCIDENT_MAX_LONG_SIDE)
    for (;;) {
      const scale = target / longSide
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const { canvas, context } = createCanvas(width, height)
      context.drawImage(image, 0, 0, width, height)

      const blob = await encodeWebp(canvas, INCIDENT_MAX_BYTES)
      if (blob) return { purpose: 'INCIDENT', blob, width, height, sha256: await sha256Hex(blob) }
      if (target === INCIDENT_MIN_LONG_SIDE) {
        throw new ImagePreparationError('No se pudo dejar la foto por debajo de 300 KB.')
      }
      target = Math.max(INCIDENT_MIN_LONG_SIDE, Math.round(target * 0.75))
    }
  } finally {
    image.close()
  }
}
