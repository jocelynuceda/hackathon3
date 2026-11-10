import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { PERMISSIONS } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { startEventStream, stopEventStream } from '../events/eventStream'
import { StreamIndicator } from '../events/StreamIndicator'
import { ErrorBoundary } from './ErrorBoundary'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 ${isActive ? 'bg-slate-800 text-teal-300' : 'text-slate-300 hover:text-white'}`

export function Layout() {
  const { me, can, logout } = useAuth()
  const location = useLocation()

  // Una sola conexión al stream por navegador (ver eventStream.ts); se corta al cerrar sesión.
  useEffect(() => {
    startEventStream()
    return () => stopEventStream()
  }, [])

  return (
    <div className="min-h-screen">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-slate-900 focus:p-2">
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-800 px-6 py-3">
        <span className="font-semibold tracking-wide">LUMON · MDR</span>
        <nav aria-label="Principal" className="flex gap-2 text-sm">
          {can(PERMISSIONS.filesRead) && (
            <NavLink to="/files" className={linkClass}>
              Archivos
            </NavLink>
          )}
          {can(PERMISSIONS.refinersRead) && (
            <NavLink to="/refiners" className={linkClass}>
              Expedientes
            </NavLink>
          )}
          {can(PERMISSIONS.incidentsRead) && (
            <NavLink to="/incidents" className={linkClass}>
              Incidencias
            </NavLink>
          )}
          <NavLink to="/estado" className={linkClass}>
            Estado
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <StreamIndicator />
          <span className="text-sm text-slate-400">{me ? `${me.displayName} · ${me.team.code}` : ''}</span>
          <button type="button" onClick={() => void logout()} className="rounded border border-slate-600 px-3 py-1 text-sm">
            Salir
          </button>
        </div>
      </header>
      <div id="contenido">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
    </div>
  )
}
