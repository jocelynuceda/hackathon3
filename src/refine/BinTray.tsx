import type { Bin, Progress } from './types'

const BINS: Bin[] = ['WO', 'FC', 'DR', 'MA']

interface BinTrayProps {
  progress: Progress
  /** Caja que corresponde al grupo seleccionado, si lo hay. */
  suggestedBin: Bin | null
  hoverBin: Bin | null
  refiningBin: Bin | null
  canDrop: boolean
  onSelectBin: (bin: Bin) => void
}

export function BinTray({ progress, suggestedBin, hoverBin, refiningBin, canDrop, onSelectBin }: BinTrayProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Cajas">
      {BINS.map((bin) => {
        const percent = Math.round(progress[bin] * 100)
        const hovering = hoverBin === bin
        return (
          <li key={bin}>
            <button
              type="button"
              data-bin={bin}
              aria-disabled={!canDrop}
              onClick={() => {
                if (canDrop) onSelectBin(bin)
              }}
              className={`w-full rounded border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 ${
                hovering ? 'border-teal-300 bg-teal-950' : 'border-slate-600 bg-slate-900'
              } ${canDrop ? 'hover:border-teal-300' : 'cursor-not-allowed'}`}
            >
              <span className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{bin}</span>
                <span className="text-sm text-slate-300">{percent} %</span>
              </span>
              <progress className="mt-2 w-full" max={1} value={progress[bin]} aria-label={`Progreso de la caja ${bin}`} />
              <span className="mt-1 block min-h-5 text-sm text-teal-200">
                {refiningBin === bin ? 'Enviando…' : suggestedBin === bin ? 'Caja que corresponde' : ''}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
