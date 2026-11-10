import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { primaryActionClass, StatusScreen } from '../components/StatusScreen'
import { errorMessage } from './api'
import { SessionContext } from './session'
import { getSession, restoreSession, signOut, subscribe } from './sessionStore'

function SessionNavigation() {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  async function logout() {
    if (leaving) return
    setLeaving(true)
    setError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setLeaving(false)
    }
  }

  return (
    <header className="border-b border-slate-800 px-4 py-3">
      <nav aria-label="Cuadrilla" className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3">
        <Link className="b-link" to="/estado">Estado de la cuadrilla</Link>
        <button type="button" className="b-link disabled:opacity-60" disabled={leaving} onClick={() => void logout()}>
          {leaving ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </button>
      </nav>
      {error && <p role="alert" className="mx-auto mt-3 max-w-2xl text-rose-300">{error}</p>}
    </header>
  )
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession)
  useEffect(() => { void restoreSession() }, [])

  if (session.status === 'error') {
    return (
      <StatusScreen title="No se pudo restaurar la sesión" description={session.message}>
        <button type="button" className={primaryActionClass} onClick={() => void restoreSession()}>Reintentar</button>
      </StatusScreen>
    )
  }

  return (
    <SessionContext.Provider value={session}>
      {session.status === 'authenticated' && <SessionNavigation />}
      {children}
    </SessionContext.Provider>
  )
}
