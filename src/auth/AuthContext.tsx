import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, backoffDelay } from '../api/client'
import { ApiError } from '../api/errors'
import {
  endSession,
  hasStoredSession,
  onSessionEvent,
  refreshAccessToken,
  setSession,
  takeRefreshTokenForLogout,
  type SessionEndReason,
} from '../api/session'
import type { AuthResponse, Me } from '../api/types'
import { SessionContext, type Session } from './session'

type Status = 'checking' | 'authenticated' | 'anonymous'

interface AuthState {
  status: Status
  me: Me | null
  /** Por qué se cerró la sesión (para mostrarlo en el login). */
  endReason: SessionEndReason | null
  login: (email: string, password: string) => Promise<void>
  register: (teamName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (hasStoredSession() ? 'checking' : 'anonymous'))
  const [me, setMe] = useState<Me | null>(null)
  const [endReason, setEndReason] = useState<SessionEndReason | null>(null)

  const reloadMe = useCallback(async () => {
    const data = await api<Me>('/auth/me')
    setMe(data)
    setStatus('authenticated')
  }, [])

  const statusRef = useRef(status)
  statusRef.current = status

  // Restaurar la sesión al recargar, sin mostrar el login mientras se verifica.
  // Si falla la red (no la sesión), se reintenta con espera creciente.
  useEffect(() => {
    if (!hasStoredSession()) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (n: number) => {
      refreshAccessToken(null)
        .then(() => api<Me>('/auth/me'))
        .then((data) => {
          if (cancelled) return
          setMe(data)
          setStatus('authenticated')
        })
        .catch(() => {
          if (cancelled) return
          if (!hasStoredSession()) setStatus('anonymous')
          else timer = setTimeout(() => attempt(n + 1), backoffDelay(n))
        })
    }
    attempt(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Sincronización entre pestañas: login en otra pestaña o cierre de sesión en cualquiera.
  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event.type === 'ended') {
          setMe(null)
          setEndReason(event.reason)
          setStatus('anonymous')
        } else if (event.type === 'tokens' && statusRef.current === 'anonymous') {
          api<Me>('/auth/me')
            .then((data) => {
              setMe(data)
              setEndReason(null)
              setStatus('authenticated')
            })
            .catch(() => undefined)
        }
      }),
    [],
  )

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false })
    setSession(res)
    setEndReason(null)
    await reloadMe()
  }, [reloadMe])

  const register = useCallback(async (teamName: string, email: string, password: string) => {
    const res = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { teamName, email, password },
      auth: false,
    })
    setSession(res)
    setEndReason(null)
    await reloadMe()
  }, [reloadMe])

  const logout = useCallback(async () => {
    const refreshToken = takeRefreshTokenForLogout()
    try {
      if (refreshToken) await api<void>('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false })
    } catch (err) {
      // Aunque falle la red, la sesión local se cierra igual.
      if (!(err instanceof ApiError)) console.warn('Logout sin confirmar en el servidor', err)
    } finally {
      endSession('LOGOUT')
    }
  }, [])

  const can = useCallback((permission: string) => me?.permissions.some((p) => p === permission) ?? false, [me])

  const value = useMemo<AuthState>(
    () => ({ status, me, endReason, login, register, logout, reloadMe, can }),
    [status, me, endReason, login, register, logout, reloadMe, can],
  )

  // Sesión en el formato que consumen RequireAuth / RequirePermission / useCan.
  const session = useMemo<Session>(() => {
    if (status === 'authenticated' && me) return { status: 'authenticated', me }
    if (status === 'checking' || (status === 'authenticated' && !me)) return { status: 'restoring', me: null }
    return { status: 'anonymous', me: null }
  }, [status, me])

  return (
    <AuthContext.Provider value={value}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
