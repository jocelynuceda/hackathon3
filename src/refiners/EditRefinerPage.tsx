import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorMessage, fieldErrors } from '../api/errors'
import { Field } from '../components/Field'
import { useLumonEvent } from '../events/hooks'
import { fetchDepartments, patchRefiner, versionConflict } from './api'
import type { VersionedRefiner } from './api'
import type { Department, Refiner, RefinerPatch, RefinerUpdate } from './types'
import { useRefiner } from './useRefiner'

interface FormValues {
  title: string
  extension: string
  bio: string
  departmentId: number
}

type FieldName = keyof FormValues
const FIELD_NAMES: FieldName[] = ['title', 'extension', 'bio', 'departmentId']
const FIELD_LABELS: Record<FieldName, string> = {
  title: 'Título',
  extension: 'Anexo',
  bio: 'Biografía',
  departmentId: 'Departamento',
}

function valuesOf(refiner: Refiner): FormValues {
  const { title, extension, bio, department } = refiner
  return { title, extension, bio, departmentId: department.id }
}

function patchBetween(base: FormValues, wanted: FormValues): RefinerPatch {
  const patch: RefinerPatch = {}
  if (wanted.title !== base.title) patch.title = wanted.title
  if (wanted.extension !== base.extension) patch.extension = wanted.extension
  if (wanted.bio !== base.bio) patch.bio = wanted.bio
  if (wanted.departmentId !== base.departmentId) patch.departmentId = wanted.departmentId
  return patch
}

export function EditRefinerPage() {
  const refinerId = Number(useParams().id)
  const { loaded, setLoaded, error, reload } = useRefiner(refinerId)

  const [departments, setDepartments] = useState<Department[]>([])
  const [form, setForm] = useState<FormValues | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changedRemotely, setChangedRemotely] = useState(false)
  const [conflict, setConflict] = useState<VersionedRefiner | null>(null)
  const [choices, setChoices] = useState<Partial<Record<FieldName, 'mine' | 'server'>>>({})

  useEffect(() => {
    const controller = new AbortController()
    fetchDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  // El formulario se llena una sola vez: un cambio remoto nunca borra lo que se está escribiendo.
  useEffect(() => {
    if (loaded && !form) setForm(valuesOf(loaded.refiner))
  }, [loaded, form])

  useLumonEvent('refiner.updated', (event) => {
    const change = event.data as RefinerUpdate
    if (loaded && change.id === refinerId && change.version > loaded.refiner.version) setChangedRemotely(true)
  })

  async function save(target: VersionedRefiner, wanted: FormValues) {
    const patch = patchBetween(valuesOf(target.refiner), wanted)
    setMessage(null)
    setErrors({})
    setSaved(false)
    if (Object.keys(patch).length === 0) {
      setLoaded(target)
      setForm(wanted)
      setConflict(null)
      setChangedRemotely(false)
      setMessage('No hay cambios para guardar.')
      return
    }

    setSaving(true)
    try {
      const result = await patchRefiner(refinerId, target.etag, patch)
      setLoaded(result)
      setForm(valuesOf(result.refiner))
      setConflict(null)
      setChoices({})
      setChangedRemotely(false)
      setSaved(true)
    } catch (failure) {
      const current = versionConflict(failure)
      if (current) {
        setConflict(current)
        setChoices({})
        return
      }
      setConflict(null)
      setErrors(fieldErrors(failure))
      setMessage(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  if (error !== null && !loaded) {
    return (
      <main className="p-6" role="alert">
        <p>No se pudo cargar el expediente: {errorMessage(error)}</p>
        <button type="button" className="mt-2 underline" onClick={reload}>
          Reintentar
        </button>
      </main>
    )
  }
  if (!loaded || !form) {
    return (
      <main className="p-6" role="status">
        Cargando expediente…
      </main>
    )
  }

  const departmentName = (id: number) => departments.find((department) => department.id === id)?.name ?? `#${id}`
  const display = (name: FieldName, values: FormValues) =>
    name === 'departmentId' ? departmentName(values.departmentId) : values[name]

  if (conflict) {
    const server = valuesOf(conflict.refiner)
    const differing = FIELD_NAMES.filter((name) => form[name] !== server[name])
    const allChosen = differing.every((name) => choices[name])
    const merged = differing.reduce<FormValues>(
      (result, name) => (choices[name] === 'mine' ? { ...result, [name]: form[name] } : result),
      server,
    )

    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Conflicto de versiones</h1>
        <p role="alert" className="text-amber-200">
          Alguien cambió este expediente mientras lo editabas. Elige qué conservar en cada campo.
        </p>
        {differing.length === 0 && <p className="text-slate-300">Tus valores ya coinciden con los del servidor.</p>}
        {differing.map((name) => (
          <fieldset key={name} className="rounded border border-slate-700 p-3">
            <legend className="px-1 font-medium">{FIELD_LABELS[name]}</legend>
            <label className="flex gap-2 py-1">
              <input
                type="radio"
                name={name}
                checked={choices[name] === 'mine'}
                onChange={() => setChoices({ ...choices, [name]: 'mine' })}
              />
              <span className="min-w-0 break-words whitespace-pre-wrap">
                <strong>Lo que escribiste:</strong> {display(name, form)}
              </span>
            </label>
            <label className="flex gap-2 py-1">
              <input
                type="radio"
                name={name}
                checked={choices[name] === 'server'}
                onChange={() => setChoices({ ...choices, [name]: 'server' })}
              />
              <span className="min-w-0 break-words whitespace-pre-wrap">
                <strong>Lo que hay ahora:</strong> {display(name, server)}
              </span>
            </label>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={!allChosen || saving}
          onClick={() => void save(conflict, merged)}
          className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar mi selección'}
        </button>
      </main>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (loaded && form) void save(loaded, form)
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold break-words">Editar a {loaded.refiner.fullName}</h1>
      <Link className="text-teal-300 underline" to="/refiners">
        Volver a expedientes
      </Link>

      {changedRemotely && (
        <p role="alert" className="mt-4 rounded border border-amber-400/50 p-3 text-amber-200">
          Alguien acaba de cambiar este expediente. Si guardas, podrás comparar ambas versiones antes de confirmar.
        </p>
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Título" type="text" value={form.title} onChange={(title) => setForm({ ...form, title })} error={errors.title} required />
        <Field label="Anexo" type="text" value={form.extension} onChange={(extension) => setForm({ ...form, extension })} error={errors.extension} required />
        <label className="block text-sm font-medium text-slate-200">
          Departamento
          <select
            value={form.departmentId}
            onChange={(event) => setForm({ ...form, departmentId: Number(event.target.value) })}
            className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {!departments.some((department) => department.id === form.departmentId) && (
              <option value={form.departmentId}>{loaded.refiner.department.name}</option>
            )}
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Biografía
          <textarea
            value={form.bio}
            maxLength={2000}
            rows={5}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
            className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
        </label>
        {errors.bio && <p className="text-sm text-rose-300">{errors.bio}</p>}

        <button type="submit" disabled={saving} className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>

      <div role="status" className="mt-3 text-teal-200">
        {saved ? 'Expediente guardado.' : ''}
      </div>
      {message && <p className="mt-2 text-rose-300">{message}</p>}
    </main>
  )
}
