import { Outlet } from 'react-router-dom'
import { useSession } from '../auth/session'
import type { Permission } from '../auth/types'
import { ForbiddenPage } from '../pages/ForbiddenPage'

/** Va dentro de RequireAuth. Sin todos los permisos muestra "sin permiso" en la misma URL. */
export function RequirePermission({ permissions }: { permissions: readonly Permission[] }) {
  const session = useSession()
  const allowed =
    session.status === 'authenticated' &&
    permissions.every((permission) => session.me.permissions.includes(permission))

  return allowed ? <Outlet /> : <ForbiddenPage />
}
