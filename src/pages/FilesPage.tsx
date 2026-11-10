import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, withRetry } from '../api/client'
import { errorMessage, isAbortError } from '../api/errors'
import type { DataFile, FileStatus, Page } from '../api/types'
import { useLumonEvent } from '../events/hooks'

const SIZES = [10, 25, 50] as const
const SORTS = [
  { value: 'updatedAt,desc', label: 'Actualizados recientemente' },
  { value: 'progress,desc', label: 'Mayor progreso' },
  { value: 'name,asc', label: 'Nombre (A-Z)' },
] as const
const STATUSES: Array<{ value: '' | FileStatus; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'COMPLETE', label: 'Completados' },
]

interface Query {
  page: number
  size: (typeof SIZES)[number]
  status: '' | FileStatus
  q: string
  sort: (typeof SORTS)[number]['value']
}

/** Lee y sanea la URL: un valor inválido vuelve a su valor por defecto en vez de romper la vista. */
function parseQuery(params: URLSearchParams): Query {
  const page = Number(params.get('page'))
  const size = Number(params.get('size'))
  const status = params.get('status')
  const sort = params.get('sort')
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: (SIZES as readonly number[]).includes(size) ? (size as Query['size']) : 10,
    status: status === 'ACTIVE' || status === 'COMPLETE' ? status : '',
    q: (params.get('q') ?? '').slice(0, 60),
    sort: SORTS.some((s) => s.value === sort) ? (sort as Query['sort']) : 'updatedAt,desc',
  }
}

function toParams(q: Query): URLSearchParams {
  const p = new URLSearchParams()
  if (q.page > 0) p.set('page', String(q.page))
  if (q.size !== 10) p.set('size', String(q.size))
  if (q.status) p.set('status', q.status)
  if (q.q) p.set('q', q.q)
  if (q.sort !== 'updatedAt,desc') p.set('sort', q.sort)
  return p
}

const pct = (n: number) => `${Math.round(n * 100)} %`

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const queryKey = toParams(query).toString()
  const [data, setData] = useState<Page<DataFile> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(query.q)
  const [nonce, setNonce] = useState(0)
  const requestSeq = useRef(0)

  // Si la URL cambia por atrás/adelante, el campo de búsqueda la sigue.
  useEffect(() => {
    setSearch(query.q)
  }, [query.q])

  function update(patch: Partial<Query>, replace = false) {
    const next = { ...query, ...patch }
    if (!('page' in patch)) next.page = 0
    setParams(toParams(next), { replace })
  }

  // Búsqueda sin una request por tecla: se aplica 350 ms después de dejar de escribir.
  useEffect(() => {
    if (search === query.q) return
    const id = setTimeout(() => update({ q: search.slice(0, 60) }, true), 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Una respuesta vieja nunca pisa a una nueva: se aborta la anterior y se compara el número de request.
  useEffect(() => {
    const controller = new AbortController()
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const apiParams = new URLSearchParams({ page: String(query.page), size: String(query.size), sort: query.sort })
    if (query.status) apiParams.set('status', query.status)
    if (query.q) apiParams.set('q', query.q)
    withRetry(() => api<Page<DataFile>>(`/files?${apiParams}`, { signal: controller.signal }), controller.signal)
      .then((res) => {
        if (seq !== requestSeq.current) return
        setData(res)
        // Página fuera de rango (por ejemplo tras filtrar): se lleva a la última que existe.
        if (res.totalPages > 0 && query.page >= res.totalPages) update({ page: res.totalPages - 1 }, true)
      })
      .catch((err: unknown) => {
        if (seq === requestSeq.current && !isAbortError(err)) setError(err)
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, nonce])

  // Progreso en vivo desde el stream de eventos.
  useLumonEvent('refinement.created', (e) => {
    const ev = e.data as { fileId: number; progress: DataFile['progress'] }
    setData((prev) =>
      prev && { ...prev, content: prev.content.map((f) => (f.id === ev.fileId ? { ...f, progress: ev.progress } : f)) },
    )
  })
  useLumonEvent('file.completed', () => setNonce((n) => n + 1))
  useLumonEvent('stream.reset', () => setNonce((n) => n + 1))

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Archivos de datos</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Buscar
          <input
            type="search"
            value={search}
            maxLength={60}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre del archivo"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Estado
          <select
            value={query.status}
            onChange={(e) => update({ status: e.target.value as Query['status'] })}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Orden
          <select
            value={query.sort}
            onChange={(e) => update({ sort: e.target.value as Query['sort'] })}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Por página
          <select
            value={query.size}
            onChange={(e) => update({ size: Number(e.target.value) as Query['size'] })}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && (
        <div role="alert" className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200">
          No se pudieron cargar los archivos: {errorMessage(error)}{' '}
          <button type="button" className="underline" onClick={() => setNonce((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto" aria-busy={loading}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Archivos de datos</caption>
          <thead className="border-b border-slate-700 text-slate-400">
            <tr>
              <th scope="col" className="py-2 pr-4">Nombre</th>
              <th scope="col" className="py-2 pr-4">Estado</th>
              <th scope="col" className="py-2 pr-4">Tamaño</th>
              <th scope="col" className="py-2 pr-4">Progreso</th>
              <th scope="col" className="py-2 pr-4">Errores</th>
              <th scope="col" className="py-2"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.content.map((f) => (
              <tr key={f.id} className="border-b border-slate-800">
                <td className="py-2 pr-4 font-medium">{f.name}</td>
                <td className="py-2 pr-4">{f.status === 'COMPLETE' ? 'Completado' : 'Activo'}</td>
                <td className="py-2 pr-4 tabular-nums">{f.rows} × {f.cols}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <progress className="h-2 w-24" max={1} value={f.progress.overall} aria-label={`Progreso de ${f.name}`} />
                    <span className="tabular-nums">{pct(f.progress.overall)}</span>
                  </div>
                </td>
                <td className="py-2 pr-4 tabular-nums">{f.mistakes}</td>
                <td className="py-2">
                  <Link className="text-teal-300 underline" to={`/files/${f.id}/refine`}>
                    Refinar<span className="sr-only"> {f.name}</span>
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.content.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">No hay archivos con esos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <p className="mt-2 text-sm text-slate-400" role="status">Cargando…</p>}
      </div>

      {data && data.totalPages > 1 && (
        <nav className="mt-4 flex items-center gap-3" aria-label="Paginación">
          <button
            type="button"
            disabled={query.page === 0}
            onClick={() => update({ page: query.page - 1 })}
            className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm tabular-nums">
            Página {query.page + 1} de {data.totalPages} · {data.totalElements} archivos
          </span>
          <button
            type="button"
            disabled={query.page >= data.totalPages - 1}
            onClick={() => update({ page: query.page + 1 })}
            className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </nav>
      )}
    </main>
  )
}
