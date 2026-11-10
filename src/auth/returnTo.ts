import { useLocation } from 'react-router-dom'

/** Se guarda en el state de la navegación hacia /login. */
export interface LoginRedirectState {
  from: string
}

function isLoginRedirectState(state: unknown): state is LoginRedirectState {
  if (typeof state !== 'object' || state === null || !('from' in state)) return false
  const { from } = state
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
}

/** Ruta exacta (con query string) a la que hay que volver después de iniciar sesión. */
export function useReturnTo(fallback = '/'): string {
  const state: unknown = useLocation().state
  return isLoginRedirectState(state) ? state.from : fallback
}
