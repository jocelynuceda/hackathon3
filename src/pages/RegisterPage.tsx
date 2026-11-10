import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { errorMessage, fieldErrors } from '../api/errors'
import { useAuth } from '../auth/AuthContext'
import { useReturnTo } from '../auth/returnTo'
import { Field } from '../components/Field'
import { StatusScreen } from '../components/StatusScreen'

export function RegisterPage() {
  const { status, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = useReturnTo('/estado')
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'checking') return <StatusScreen live title="Verificando sesión…" />
  if (status === 'authenticated') return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      await register(teamName.trim(), email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      const fields = fieldErrors(err)
      setErrors(fields)
      // Si el error ya se muestra junto a un campo, no se repite arriba.
      setFormError(Object.keys(fields).length > 0 && !fields._ ? null : (fields._ ?? errorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Registrar la cuadrilla</h1>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Nombre del equipo" value={teamName} onChange={setTeamName} error={errors.teamName} minLength={3} maxLength={40} required />
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} maxLength={120} required />
        <Field
          label="Contraseña (mínimo 8 caracteres)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          minLength={8}
          maxLength={72}
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
          {submitting ? 'Registrando…' : 'Registrar y entrar'}
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-400">
        ¿Ya tienes cuenta?{' '}
        <Link className="text-teal-300 underline" to="/login" state={location.state}>
          Entrar
        </Link>
      </p>
    </main>
  )
}
