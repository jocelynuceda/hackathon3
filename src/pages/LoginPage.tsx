import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, errorMessage, fieldErrors } from '../api/errors'
import type { SessionEndReason } from '../api/session'
import { useAuth } from '../auth/AuthContext'
import { useReturnTo } from '../auth/returnTo'
import { Field } from '../components/Field'

const END_MESSAGES: Record<SessionEndReason, string | null> = {
  LOGOUT: null,
  REFRESH_REUSED:
    'Tu sesión se cerró por seguridad: se detectó un uso repetido del token de sesión. Vuelve a iniciar sesión.',
  SESSION_REVOKED: 'Tu sesión fue revocada. Vuelve a iniciar sesión.',
  REFRESH_INVALID: 'Tu sesión expiró. Vuelve a iniciar sesión.',
}

export function LoginPage() {
  const { status, login, endReason } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = useReturnTo('/files')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      await login(email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setErrors(fieldErrors(err))
      setFormError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? 'Email o contraseña incorrectos.' : errorMessage(err),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const endMessage = endReason ? END_MESSAGES[endReason] : null

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Entrar al piso</h1>
      <p className="mt-1 text-slate-400">Lumon Industries · Macrodata Refinement</p>
      {endMessage && (
        <p role="alert" className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
          {endMessage}
        </p>
      )}
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} required />
        <Field
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          required
        />
        {formError && (
          <p role="alert" className="text-sm text-rose-300">
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-teal-400 px-4 py-2 font-medium text-slate-950 hover:bg-teal-300 disabled:opacity-60"
        >
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-400">
        ¿Primera vez?{' '}
        <Link className="text-teal-300 underline" to="/register" state={location.state}>
          Registrar la cuadrilla
        </Link>
      </p>
    </main>
  )
}
