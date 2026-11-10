import type { FloorClient, FloorStatus } from './floorClient'
import { useFloorState } from './useFloor'

const STATUS: Record<FloorStatus, { text: string; dot: string }> = {
  connecting: { text: 'Piso: conectando…', dot: 'bg-amber-400' },
  open: { text: 'Piso: conectado', dot: 'bg-emerald-400' },
  reconnecting: { text: 'Piso: reconectando…', dot: 'bg-amber-400' },
  closed: { text: 'Piso: desconectado', dot: 'bg-rose-400' },
  unavailable: { text: 'Piso: no disponible', dot: 'bg-slate-500' },
}

/** Estado de la conexión y lista de presentes (sin duplicados), con opción de ir a su posición. */
export function FloorPanel({
  floor,
  myUserId,
  onGoTo,
}: {
  floor: FloorClient | null
  myUserId: number | null
  onGoTo: (r: number, c: number) => void
}) {
  const { status, message, members } = useFloorState(floor)
  const { text, dot } = STATUS[status]
  return (
    <aside className="h-fit rounded border border-slate-700 p-4" aria-label="Piso compartido">
      <p className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
        {text}
      </p>
      {message && <p className="mt-2 text-sm text-slate-400">{message}</p>}
      {status !== 'open' && status !== 'connecting' && (
        <p className="mt-2 text-xs text-slate-500">Puedes seguir refinando con normalidad.</p>
      )}
      <h2 className="mt-4 text-sm font-semibold">Presentes ({members.length})</h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {m.displayName}
              {m.userId === myUserId && <span className="text-slate-500"> (tú)</span>}
            </span>
            {m.userId !== myUserId && m.r !== null && m.c !== null && (
              <button
                type="button"
                className="shrink-0 text-xs text-teal-300 underline"
                onClick={() => onGoTo(m.r as number, m.c as number)}
              >
                Ir a {m.r + 1},{m.c + 1}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
