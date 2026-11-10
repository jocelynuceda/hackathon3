import { createContext, useContext } from 'react'
import type { Me, Permission } from './types'

/**
 * Estado de sesión que consumen las rutas y la interfaz.
 * El proveedor real debe entregar "restoring" mientras verifica la sesión al recargar.
 */
export type Session =
  | { status: 'restoring'; me: null }
  | { status: 'anonymous'; me: null; message?: string }
  | { status: 'authenticated'; me: Me }

export const SessionContext = createContext<Session>({ status: 'anonymous', me: null })

export function useSession(): Session {
  return useContext(SessionContext)
}

/** Para mostrar, ocultar o deshabilitar acciones. La interfaz se decide por permisos, nunca por rol. */
export function useCan(permission: Permission): boolean {
  const session = useSession()
  return session.status === 'authenticated' && session.me.permissions.includes(permission)
}
