import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, withRetry } from '../api/client'
import { errorMessage, isAbortError } from '../api/errors'
import type { Page } from '../api/types'
import { useCan } from '../auth/session'
import { Pagination } from '../components/Pagination'
import { SEVERITIES } from './types'
import type { Incident } from './types'

const PAGE_SIZE = 10

export function IncidentsPage() {
  const [params, setParams] = useSearchParams()
  const canCreate = useCan('incidents:create')
  const rawPage = Number(params.get('page'))
  const page = Number.isInteger(rawPage) && rawPage >= 0 ? rawPage : 0

  const [data, setData] = useState<Page<Incident> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    requestSeq.current += 1
    const sequence = requestSeq.current
    setLoading(true)
    setError(null)
    withRetry(
      () => api<Page<Incident>>(`/incidents?page=${page}&size=${PAGE_SIZE}`, { signal: controller.signal }),
      controller.signal,
    )
      .then((result) => {
        if (sequence === requestSeq.current) setData(result)
      })
      .catch((failure: unknown) => {
        if (sequence === requestSeq.current && !isAbortError(failure)) setError(failure)
      })
      .finally(() => {
        if (sequence === requestSeq.current) setLoading(false)
      })
    return () => controller.abort()
  }, [page, nonce])

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Incidencias</h1>
        {canCreate && (
          <Link className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950" to="/incidents/new">
            Nueva incidencia
          </Link>
        )}
      </div>

      {error !== null && (
        <div role="alert" className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200">
          No se pudieron cargar las incidencias: {errorMessage(error)}{' '}
          <button type="button" className="underline" onClick={() => setNonce((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-3" aria-busy={loading}>
        {data?.content.map((incident) => (
          <li key={incident.id} className="rounded border border-slate-700 p-4">
            <h2 className="font-semibold break-words">{incident.title}</h2>
            <p className="text-sm text-slate-300">
              Severidad {SEVERITIES.find((option) => option.value === incident.severity)?.label ?? incident.severity} ·{' '}
              {incident.createdBy.displayName} · {new Date(incident.createdAt).toLocaleString('es-PE')}
              {incident.file && ` · Archivo ${incident.file.name}`}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words">{incident.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {incident.photos.map((photo) => (
                <img
                  key={photo.mediaId}
                  src={photo.url}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  alt={`Foto de la incidencia ${incident.title}`}
                  className="h-32 w-auto rounded"
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {data && data.content.length === 0 && !loading && <p className="mt-6 text-center text-slate-300">No hay reportes.</p>}
      {loading && (
        <p className="mt-2 text-sm text-slate-300" role="status">
          Cargando…
        </p>
      )}
      {data && (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          totalElements={data.totalElements}
          onPage={(next) => setParams(next > 0 ? { page: String(next) } : {})}
        />
      )}
    </main>
  )
}
