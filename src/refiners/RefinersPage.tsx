import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, withRetry } from '../api/client'
import { errorMessage, isAbortError } from '../api/errors'
import type { Page } from '../api/types'
import { useCan } from '../auth/session'
import { Pagination } from '../components/Pagination'
import { useLumonEvent } from '../events/hooks'
import { fetchDepartments, safeProfileUrl } from './api'
import type { Department, Refiner, RefinerUpdate } from './types'

const SIZES = [10, 25, 50] as const

interface Query {
  page: number
  size: number
  departmentId: number | null
  q: string
}

function parseQuery(params: URLSearchParams): Query {
  const page = Number(params.get('page'))
  const size = Number(params.get('size'))
  const departmentId = Number(params.get('departmentId'))
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: (SIZES as readonly number[]).includes(size) ? size : 10,
    departmentId: Number.isInteger(departmentId) && departmentId > 0 ? departmentId : null,
    q: (params.get('q') ?? '').slice(0, 60),
  }
}

function toParams(query: Query): URLSearchParams {
  const params = new URLSearchParams()
  if (query.page > 0) params.set('page', String(query.page))
  if (query.size !== 10) params.set('size', String(query.size))
  if (query.departmentId) params.set('departmentId', String(query.departmentId))
  if (query.q) params.set('q', query.q)
  return params
}

/** Una versión más vieja nunca pisa a una más nueva. */
function applyUpdate(refiner: Refiner, update: RefinerUpdate | undefined): Refiner {
  return update && update.version > refiner.version ? { ...refiner, ...update } : refiner
}

export function RefinersPage() {
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const queryKey = toParams(query).toString()
  const canWrite = useCan('refiners:write')
  const canUpload = useCan('media:upload')

  const [data, setData] = useState<Page<Refiner> | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(query.q)
  const [nonce, setNonce] = useState(0)
  const requestSeq = useRef(0)
  const updates = useRef(new Map<number, RefinerUpdate>())

  useEffect(() => {
    setSearch(query.q)
  }, [query.q])

  function update(patch: Partial<Query>, replace = false) {
    const next = { ...query, ...patch }
    if (!('page' in patch)) next.page = 0
    setParams(toParams(next), { replace })
  }

  useEffect(() => {
    if (search === query.q) return
    const timer = setTimeout(() => update({ q: search.slice(0, 60) }, true), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    fetchDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => undefined)
    return () => controller.abort()
  }, [nonce])

  useEffect(() => {
    const controller = new AbortController()
    requestSeq.current += 1
    const sequence = requestSeq.current
    setLoading(true)
    setError(null)

    const apiParams = new URLSearchParams({ page: String(query.page), size: String(query.size) })
    if (query.departmentId) apiParams.set('departmentId', String(query.departmentId))
    if (query.q) apiParams.set('q', query.q)

    withRetry(() => api<Page<Refiner>>(`/refiners?${apiParams}`, { signal: controller.signal }), controller.signal)
      .then((page) => {
        if (sequence !== requestSeq.current) return
        setData({
          ...page,
          content: page.content.map((refiner) => applyUpdate(refiner, updates.current.get(refiner.id))),
        })
        if (page.totalPages > 0 && query.page >= page.totalPages) update({ page: page.totalPages - 1 }, true)
      })
      .catch((failure: unknown) => {
        if (sequence === requestSeq.current && !isAbortError(failure)) setError(failure)
      })
      .finally(() => {
        if (sequence === requestSeq.current) setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, nonce])

  useLumonEvent('refiner.updated', (event) => {
    const change = event.data as RefinerUpdate
    updates.current.set(change.id, change)
    setData(
      (previous) =>
        previous && {
          ...previous,
          content: previous.content.map((refiner) =>
            refiner.id === change.id ? applyUpdate(refiner, change) : refiner,
          ),
        },
    )
  })
  useLumonEvent('stream.reset', () => setNonce((value) => value + 1))

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Expedientes</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Buscar
          <input
            type="search"
            value={search}
            maxLength={60}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre, título o anexo"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Departamento
          <select
            value={query.departmentId ?? ''}
            onChange={(event) => update({ departmentId: Number(event.target.value) || null })}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            <option value="">Todos</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Por página
          <select
            value={query.size}
            onChange={(event) => update({ size: Number(event.target.value) })}
            className="rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && (
        <div role="alert" className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200">
          No se pudieron cargar los expedientes: {errorMessage(error)}{' '}
          <button type="button" className="underline" onClick={() => setNonce((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy={loading}>
        {data?.content.map((refiner) => {
          const profile = safeProfileUrl(refiner.profileUrl)
          return (
            <li key={refiner.id} className="flex gap-3 rounded border border-slate-700 p-3">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded bg-slate-800">
                {refiner.badge ? (
                  <img
                    src={refiner.badge.url}
                    width={refiner.badge.width}
                    height={refiner.badge.height}
                    loading="lazy"
                    alt={`Fotocheck de ${refiner.fullName}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-300">Sin foto</div>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold break-words">{refiner.fullName}</h2>
                <p className="text-sm text-slate-300 break-words">
                  {refiner.title} · {refiner.department.name} · Anexo {refiner.extension}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-300 break-words">{refiner.bio}</p>
                <p className="mt-2 flex flex-wrap gap-3 text-sm">
                  {profile && (
                    <a className="text-teal-300 underline" href={profile} target="_blank" rel="noopener noreferrer">
                      Perfil<span className="sr-only"> de {refiner.fullName}</span>
                    </a>
                  )}
                  {canWrite && (
                    <Link className="text-teal-300 underline" to={`/refiners/${refiner.id}/edit`}>
                      Editar<span className="sr-only"> {refiner.fullName}</span>
                    </Link>
                  )}
                  {canWrite && canUpload && (
                    <Link className="text-teal-300 underline" to={`/refiners/${refiner.id}/badge`}>
                      Fotocheck<span className="sr-only"> de {refiner.fullName}</span>
                    </Link>
                  )}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      {data && data.content.length === 0 && !loading && (
        <p className="mt-6 text-center text-slate-300">No hay expedientes con esos filtros.</p>
      )}
      {loading && (
        <p className="mt-2 text-sm text-slate-300" role="status">
          Cargando…
        </p>
      )}
      {data && (
        <Pagination
          page={query.page}
          totalPages={data.totalPages}
          totalElements={data.totalElements}
          onPage={(page) => update({ page })}
        />
      )}
    </main>
  )
}
