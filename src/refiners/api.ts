import { api, apiRequest, withRetry } from '../api/client'
import { ApiError } from '../api/errors'
import type { Department, Refiner, RefinerPatch } from './types'

export interface VersionedRefiner {
  refiner: Refiner
  etag: string
}

const etagOf = (headers: Headers | null, version: number) => headers?.get('ETag') ?? `"${version}"`

export function fetchRefiner(id: number, signal?: AbortSignal): Promise<VersionedRefiner> {
  return withRetry(async () => {
    const { data, headers } = await apiRequest<Refiner>(`/refiners/${id}`, { signal })
    return { refiner: data, etag: etagOf(headers, data.version) }
  }, signal)
}

export async function patchRefiner(id: number, etag: string, patch: RefinerPatch): Promise<VersionedRefiner> {
  const { data, headers } = await apiRequest<Refiner>(`/refiners/${id}`, {
    method: 'PATCH',
    headers: { 'If-Match': etag },
    body: patch,
  })
  return { refiner: data, etag: etagOf(headers, data.version) }
}

export function fetchDepartments(signal?: AbortSignal): Promise<Department[]> {
  return withRetry(() => api<Department[]>('/departments', { signal }), signal)
}

/** Datos del 412 VERSION_CONFLICT: la versión actual y su ETag. */
export function versionConflict(error: unknown): VersionedRefiner | null {
  if (!(error instanceof ApiError) || error.code !== 'VERSION_CONFLICT') return null
  const { current } = error.details as { current: Refiner }
  return { refiner: current, etag: etagOf(error.headers, current.version) }
}

export function safeProfileUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
