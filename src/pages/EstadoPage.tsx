import { Link, useLocation } from 'react-router-dom'
import { useSession } from '../auth/session'
import type { LoginRedirectState } from '../auth/returnTo'
import { config } from '../config'
import { EstadoDetails } from './EstadoDetails'

export function EstadoPage() {
  const session = useSession()
  const location = useLocation()
  const returnState: LoginRedirectState = { from: location.pathname + location.search + location.hash }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Estado</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-slate-400">Build</dt>
        <dd className="font-mono">{config.build}</dd>
        <dt className="text-slate-400">API</dt>
        <dd className="font-mono break-all">{config.apiBaseUrl}</dd>
      </dl>
      <div className="mt-6">
        {session.status === 'restoring' && <p role="status">Verificando sesión…</p>}
        {session.status === 'anonymous' && (
          <Link className="b-link" to="/login" state={returnState}>Iniciar sesión para gestionar la cuadrilla</Link>
        )}
        {session.status === 'authenticated' && (
          <EstadoDetails team={session.me.team} canManage={session.me.permissions.includes('team:manage')} />
        )}
      </div>
    </main>
  )
}
