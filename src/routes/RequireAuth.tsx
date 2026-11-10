import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { LoginRedirectState } from '../auth/returnTo'
import { useSession } from '../auth/session'
import { StatusScreen } from '../components/StatusScreen'

export function RequireAuth() {
  const { status } = useSession()
  const location = useLocation()

  if (status === 'restoring') {
    return <StatusScreen live title="Verificando sesión…" />
  }

  if (status === 'anonymous') {
    const state: LoginRedirectState = {
      from: location.pathname + location.search + location.hash,
    }
    return <Navigate to="/login" replace state={state} />
  }

  return <Outlet />
}
