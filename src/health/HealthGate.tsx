import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { primaryActionClass, StatusScreen } from '../components/StatusScreen'
import { useApiHealth } from './useApiHealth'

function RetryCountdown({ retryAt }: { retryAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [])

  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1_000))
  // Oculto para lectores de pantalla: anunciar cada segundo sería ruido.
  return (
    <p aria-hidden="true" className="mb-4 text-sm text-slate-300">
      Reintentando en {seconds} s
    </p>
  )
}

/** No monta la app hasta que /meta/health responde. */
export function HealthGate({ children }: { children: ReactNode }) {
  const { health, retryNow } = useApiHealth()

  if (health.phase === 'up') return children

  const waiting = health.phase === 'waiting'
  return (
    <StatusScreen
      live
      title="Conectando con Lumon…"
      description={
        waiting ? 'Lumon no responde. Seguiremos intentando automáticamente.' : 'Comprobando el servicio.'
      }
    >
      {waiting && <RetryCountdown key={health.retryAt} retryAt={health.retryAt} />}
      <button type="button" onClick={retryNow} className={primaryActionClass}>
        Reintentar ahora
      </button>
    </StatusScreen>
  )
}
