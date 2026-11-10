import { Link } from 'react-router-dom'
import type { DataFile } from '../api/types'
import { useCan } from '../auth/session'
import { cellKey, RefineGrid } from '../grid/RefineGrid'
import type { TileLoader } from '../grid/tileLoader'
import { BinTray } from './BinTray'
import type { Rules } from './types'
import { useGroupDrag } from './useGroupDrag'
import { useRefineSession } from './useRefineSession'

interface RefineWorkspaceProps {
  file: DataFile
  rules: Rules
  loader: TileLoader
  setFile: (file: DataFile) => void
}

function FileCompleted({ file }: { file: DataFile }) {
  return (
    <section className="mt-6 rounded border border-teal-300 bg-slate-900 p-6">
      <h2 className="text-xl font-semibold">Archivo completado</h2>
      <p className="mt-2 text-slate-300">
        Refinaste {file.refinedGroups} de {file.totalGroups} grupos, con {file.mistakes} errores anotados.
      </p>
      <Link className="mt-4 inline-block text-teal-300 underline" to="/files">
        Volver a los archivos
      </Link>
    </section>
  )
}

export function RefineWorkspace({ file, rules, loader, setFile }: RefineWorkspaceProps) {
  const canRefine = useCan('files:refine')
  const { selection, notice, refiningBin, selectCell, clearSelection, refineTo } = useRefineSession({
    file,
    rules,
    loader,
    setFile,
  })
  const { dragging, hoverBin, ghostRef, beginDrag } = useGroupDrag((bin) => void refineTo(bin))

  if (file.status === 'COMPLETE' || file.progress.overall >= 1) return <FileCompleted file={file} />

  const group = selection.status === 'ready' ? selection.group : null
  const classification = group?.classification
  const suggestedBin = classification?.kind === 'refinable' ? classification.bin : null
  const canDrop =
    canRefine && suggestedBin !== null && group !== null && !group.alreadyRefined && refiningBin === null

  return (
    <div className="mt-4 space-y-4">
      <RefineGrid
        file={file}
        loader={loader}
        threshold={rules.tremorThreshold}
        selected={new Set(group?.cells.map(cellKey))}
        onSelect={(cell) => void selectCell(cell)}
        onDragStart={canDrop ? beginDrag : undefined}
      />

      <section aria-label="Grupo seleccionado" className="min-h-24 rounded border border-slate-700 p-4">
        {selection.status === 'idle' && <p className="text-slate-300">Elige una celda que dé miedo.</p>}
        {selection.status === 'loading' && <p className="text-slate-300">Buscando el grupo completo…</p>}
        {group && (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="font-semibold">Grupo de {group.cells.length} celdas</p>
              <p className="text-sm text-slate-300">
                {suggestedBin ? `Caja que corresponde: ${suggestedBin}` : 'Es ruido: no se puede refinar.'}
                {group.alreadyRefined && ' Ya está en una caja.'}
              </p>
            </div>
            {canDrop && (
              <div
                onPointerDown={beginDrag}
                className="cursor-grab touch-none rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 select-none"
              >
                Arrastrar a una caja
              </div>
            )}
            <button type="button" onClick={clearSelection} className="text-sm underline">
              Cancelar
            </button>
          </div>
        )}
      </section>

      <BinTray
        progress={file.progress}
        suggestedBin={suggestedBin}
        hoverBin={hoverBin}
        refiningBin={refiningBin}
        canDrop={canDrop}
        onSelectBin={(bin) => void refineTo(bin)}
      />

      <p className="text-sm text-slate-300">
        {canRefine
          ? 'Con el teclado: selecciona el grupo, pasa con Tab a una caja y pulsa Enter. Escape cancela el arrastre.'
          : 'Tu cuenta puede ver este archivo, pero no refinarlo.'}
      </p>

      <div role="status" className={`min-h-6 ${notice?.tone === 'error' ? 'text-rose-300' : 'text-teal-200'}`}>
        {notice?.text}
      </div>

      {dragging && group && (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-50 rounded bg-teal-300 px-3 py-1 text-sm font-medium text-slate-950"
        >
          {group.cells.length} celdas
        </div>
      )}
    </div>
  )
}
