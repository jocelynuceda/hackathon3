import { useStreamStatus } from './hooks'
import type { StreamStatus } from './eventStream'

const LABELS: Record<StreamStatus, { text: string; dot: string }> = {
  idle: { text: 'Eventos: sin conexión', dot: 'bg-slate-500' },
  connecting: { text: 'Eventos: conectando…', dot: 'bg-amber-400' },
  open: { text: 'Eventos: en vivo', dot: 'bg-emerald-400' },
  reconnecting: { text: 'Eventos: reconectando…', dot: 'bg-amber-400' },
  locked: { text: 'Eventos: Piso de Pruebas cerrado', dot: 'bg-slate-500' },
  follower: { text: 'Eventos: esperando…', dot: 'bg-slate-400' },
}

export function StreamIndicator() {
  const status = useStreamStatus()
  const { text, dot } = LABELS[status]
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-300" role="status" aria-live="polite">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  )
}
