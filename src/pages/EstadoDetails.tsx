import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, errorMessage, request } from '../auth/api'
import { sessionRequest } from '../auth/sessionStore'
import { primaryActionClass } from '../components/StatusScreen'

type Member = { name: string; code: string }
type Roster = { members: Member[]; complete: boolean; locked: boolean }
type Clearance = {
  granted: boolean
  checks: { name: string; passed: boolean; detail: string }[]
}
type Integrations = {
  deploy: { origin: string | null; verifiedAt: string | null }
  storage: { provider: string | null; verifiedAt: string | null }
}

function RosterForm({ roster, onSaving }: { roster: Roster; onSaving: (saving: boolean) => void }) {
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
    onSaving(true)
    setFeedback(undefined)
    try {
      const result = await sessionRequest<Roster>('/team/roster', { method: 'PUT', body: { members } })
      setSaved(result)
      setFeedback({ message: 'Los tres integrantes quedaron inscritos.', error: false })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ROSTER_LOCKED') {
        setSaved((previous) => ({ ...previous, locked: true }))
      }
      setFeedback({ message: errorMessage(error), error: true })
    } finally {
      setPending(false)
      onSaving(false)
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

const checkLabels: Record<string, string> = {
  DEPLOY: 'Despliegue',
  SESSION: 'Sesión',
  GRID: 'Grilla',
  REFINE: 'Refinamiento',
}

export function EstadoDetails({ team, canManage }: { team: { code: string; name: string }; canManage: boolean }) {
  const [health, setHealth] = useState<'loading' | 'ok' | 'unavailable'>('loading')
  const [integrations, setIntegrations] = useState<Integrations>()
  const [clearance, setClearance] = useState<Clearance>()
  const [roster, setRoster] = useState<Roster>()
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [savingRoster, setSavingRoster] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.allSettled([
      request<{ status: 'ok' }>('/meta/health'),
      sessionRequest<Integrations>('/integrations/status'),
      sessionRequest<Clearance>('/clearance'),
      canManage ? sessionRequest<Roster>('/team/roster') : Promise.resolve(undefined),
    ]).then(([api, setup, floor, members]) => {
      if (!current) return
      setHealth(api.status === 'fulfilled' && api.value.status === 'ok' ? 'ok' : 'unavailable')
      if (setup.status === 'fulfilled') setIntegrations(setup.value)
      if (floor.status === 'fulfilled') setClearance(floor.value)
      setRoster(members.status === 'fulfilled' ? members.value : undefined)
      setLoadErrors([...new Set([api, setup, floor, members].flatMap((result) =>
        result.status === 'rejected' ? [errorMessage(result.reason)] : [],
      ))])
      setLoading(false)
    })
    return () => { current = false }
  }, [canManage, revision])

  async function runCheck() {
    if (checking) return
    setChecking(true)
    setCheckError('')
    try {
      setClearance(await sessionRequest<Clearance>('/clearance/check', { method: 'POST' }))
    } catch (error) {
      setCheckError(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Estado de la cuadrilla</h2>
      <p className="text-sm font-semibold text-teal-300">{team.code} · {team.name}</p>
      <section className="b-panel space-y-4" aria-labelledby="status-heading">
        <h2 id="status-heading" className="text-xl font-bold">Conexión e integraciones</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-slate-300">API de Lumon</dt><dd>{health === 'ok' ? 'Disponible' : health === 'unavailable' ? 'Sin respuesta' : 'Consultando…'}</dd></div>
          <div><dt className="text-slate-300">Dominio</dt><dd className="break-all">{integrations ? integrations.deploy.origin ?? 'Pendiente de verificación' : 'Sin datos'}</dd></div>
          <div><dt className="text-slate-300">Almacenamiento</dt><dd>{integrations ? integrations.storage.verifiedAt ? `${integrations.storage.provider} verificado` : 'Pendiente de verificación' : 'Sin datos'}</dd></div>
        </dl>
        {loadErrors.length > 0 && <p role="alert" className="text-rose-300">{loadErrors.join(' ')}</p>}
        <button className="b-link disabled:opacity-60" disabled={loading || checking || savingRoster} onClick={() => {
          setLoading(true)
          setHealth('loading')
          setRevision(revision + 1)
        }}>{loading ? 'Consultando…' : 'Actualizar estado'}</button>
      </section>
      <section className="b-panel space-y-4" aria-labelledby="clearance-heading">
        <h2 id="clearance-heading" className="text-xl font-bold">Piso de Pruebas</h2>
        <p role="status">{clearance ? clearance.granted ? 'Abierto' : 'Cerrado' : 'Estado sin confirmar'}</p>
        {Boolean(clearance?.checks.length) && (
          <ul className="space-y-2">
            {clearance?.checks.map(({ name, passed, detail }) => (
              <li key={name}><strong>{checkLabels[name] ?? name} · {passed ? 'Aprobado' : 'Pendiente'}</strong><p className="text-slate-300">{detail}</p></li>
            ))}
          </ul>
        )}
        {checkError && <p role="alert" className="text-rose-300">{checkError}</p>}
        <button className={`${primaryActionClass} disabled:opacity-60`} disabled={loading || checking || clearance?.granted} onClick={() => void runCheck()}>
          {checking ? 'Ejecutando revisión…' : 'Abrir el Piso de Pruebas'}
        </button>
      </section>
      {canManage && (
        <section className="b-panel space-y-4" aria-labelledby="roster-heading">
          <h2 id="roster-heading" className="text-xl font-bold">Integrantes</h2>
          {loading ? <p>Consultando integrantes…</p> : roster ? <RosterForm roster={roster} onSaving={setSavingRoster} /> : <p>Actualiza el estado para volver a consultar la lista.</p>}
        </section>
      )}
    </div>
  )
}
