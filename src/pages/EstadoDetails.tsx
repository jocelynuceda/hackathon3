import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import { ApiError, errorMessage } from '../api/errors'
import { primaryActionClass } from '../components/StatusScreen'

type Member = { name: string; code: string }
type Roster = { members: Member[]; complete: boolean; locked: boolean }

function RosterForm({ roster }: { roster: Roster }) {
  const [saved, setSaved] = useState(roster)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>()

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || saved.locked) return

    const form = new FormData(event.currentTarget)
    const members = [0, 1, 2].map((index) => ({
      name: String(form.get(`name-${index}`)).trim(),
      code: String(form.get(`code-${index}`)).trim(),
    }))
    if (members.some((member) => member.name.length < 3) ||
      new Set(members.map((member) => member.code.toLowerCase())).size !== 3) {
      setFeedback({ message: 'Ingresa tres nombres válidos y tres códigos distintos.', error: true })
      return
    }

    setPending(true)
    setFeedback(undefined)
    try {
      const result = await api<Roster>('/team/roster', { method: 'PUT', body: { members } })
      setSaved(result)
      setFeedback({ message: 'Los tres integrantes quedaron inscritos.', error: false })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ROSTER_LOCKED') {
        setSaved((previous) => ({ ...previous, locked: true }))
      }
      setFeedback({ message: errorMessage(error), error: true })
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-slate-300">
        {saved.locked ? 'La lista quedó cerrada por el sorteo.' : saved.complete ? 'Cuadrilla inscrita.' : 'Inscriban a los tres integrantes para las rondas.'}
      </p>
      {[0, 1, 2].map((index) => (
        <fieldset key={index} disabled={pending || saved.locked} className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 font-semibold">Integrante {index + 1}</legend>
          <label>
            Nombre completo
            <input className="b-field" name={`name-${index}`} defaultValue={saved.members[index]?.name} minLength={3} maxLength={80} required />
          </label>
          <label>
            Código de estudiante
            <input className="b-field" name={`code-${index}`} defaultValue={saved.members[index]?.code}
              pattern={'[A-Za-z0-9\\-]+'} title="Letras, números o guiones" maxLength={20} required />
          </label>
        </fieldset>
      ))}
      {feedback && (
        <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-rose-300' : 'text-emerald-300'}>
          {feedback.message}
        </p>
      )}
      {!saved.locked && <button className={`${primaryActionClass} disabled:opacity-60`} disabled={pending}>{pending ? 'Guardando…' : 'Guardar integrantes'}</button>}
    </form>
  )
}


export function EstadoRoster() {
  const [roster, setRoster] = useState<Roster>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<Roster>('/team/roster', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setRoster(data) })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
    return () => controller.abort()
  }, [revision])

  return (
    <section className="mt-4 rounded border border-slate-700 p-4" aria-labelledby="roster-heading">
      <h2 id="roster-heading" className="mb-3 font-semibold">Integrantes</h2>
      {roster ? <RosterForm roster={roster} /> : error ? (
        <p role="alert" className="text-rose-300">
          {error}{' '}
          <button type="button" className="underline" onClick={() => {
            setError('')
            setRevision((value) => value + 1)
          }}>Reintentar</button>
        </p>
      ) : <p role="status">Consultando integrantes…</p>}
    </section>
  )
}
