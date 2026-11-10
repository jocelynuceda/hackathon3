import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ApiError, errorMessage } from '../auth/api'
import { useReturnTo } from '../auth/returnTo'
import { useSession } from '../auth/session'
import { signIn } from '../auth/sessionStore'
import { primaryActionClass, StatusScreen } from '../components/StatusScreen'

export function AuthPage({ register }: { register: boolean }) {
  const location = useLocation()
  const returnTo = useReturnTo('/estado')
  const session = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    setError('')
    setFields({})
    setPending(true)
    try {
      await signIn(register ? { email, password, teamName: String(form.get('teamName')).trim() } : { email, password })
    } catch (failure) {
      if (failure instanceof ApiError) {
        const fieldErrors = { ...failure.fields }
        if (register && failure.code === 'EMAIL_TAKEN') fieldErrors.email = failure.message
        if (register && failure.code === 'TEAM_NAME_TAKEN') fieldErrors.teamName = failure.message
        setFields(fieldErrors)
        if (fieldErrors._ || !Object.keys(fieldErrors).some((field) => ['teamName', 'email', 'password'].includes(field))) {
          setError(fieldErrors._ ?? failure.message)
        }
      } else {
        setError(errorMessage(failure))
      }
    } finally {
      setPending(false)
    }
  }

  if (session.status === 'restoring') return <StatusScreen live title="Verificando sesión…" />
  if (session.status === 'authenticated') return <Navigate to={returnTo} replace />

  return (
    <main className="b-panel mx-auto my-8 max-w-md">
      <h1 className="mb-2 text-2xl font-bold">{register ? 'Registrar cuadrilla' : 'Iniciar sesión'}</h1>
      <p className="mb-6 text-slate-300">{register ? 'Una cuenta de supervisión por equipo.' : 'Entra con tu cuenta de Lumon.'}</p>
      {session.message && <p role="status" className="mb-4 text-slate-300">{session.message}</p>}
      <form onSubmit={submit} className="space-y-4">
        {register && (
          <div>
            <label htmlFor="teamName">Nombre de la cuadrilla</label>
            <input className="b-field" id="teamName" name="teamName" required minLength={3} maxLength={40}
              aria-invalid={Boolean(fields.teamName)} aria-describedby={fields.teamName ? 'teamName-error' : undefined} />
            {fields.teamName && <p id="teamName-error" role="alert" className="text-rose-300">{fields.teamName}</p>}
          </div>
        )}
        <div>
          <label htmlFor="email">Correo electrónico</label>
          <input className="b-field" id="email" name="email" type="email" autoComplete="username" required maxLength={120}
            aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? 'email-error' : undefined} />
          {fields.email && <p id="email-error" role="alert" className="text-rose-300">{fields.email}</p>}
        </div>
        <div>
          <label htmlFor="password">Contraseña</label>
          <input className="b-field" id="password" name="password" type="password" required
            autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined}
            maxLength={register ? 72 : undefined} aria-invalid={Boolean(fields.password)}
            aria-describedby={fields.password ? 'password-error' : undefined} />
          {fields.password && <p id="password-error" role="alert" className="text-rose-300">{fields.password}</p>}
        </div>
        {error && <p role="alert" className="text-rose-300">{error}</p>}
        <button className={`${primaryActionClass} w-full disabled:opacity-60`} disabled={pending}>{pending ? 'Enviando…' : register ? 'Crear cuadrilla' : 'Entrar'}</button>
      </form>
      <Link className="b-link mt-5 inline-block" to={register ? '/login' : '/registro'} state={location.state}>
        {register ? 'Ya tengo una cuenta' : 'Registrar una cuadrilla'}
      </Link>
    </main>
  )
}
