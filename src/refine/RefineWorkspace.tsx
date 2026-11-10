import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import type { DataFile } from '../api/types'
import { useCan, useSession } from '../auth/session'
import { FloorConnection } from '../floor/floorConnection'
import { cellKey, RefineGrid } from '../grid/RefineGrid'
import type { TileLoader } from '../grid/tileLoader'
import { BinTray } from './BinTray'
import type { Bin, Cell, Rules } from './types'
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
  const userId = useSession().me?.id
  const complete = file.status === 'COMPLETE' || file.progress.overall >= 1
  const floor = useMemo(() => new FloorConnection(file.id), [file.id])
  const floorState = useSyncExternalStore(floor.subscribe, floor.getState)
  const [floorNotice, setFloorNotice] = useState('')
  const [placingBin, setPlacingBin] = useState<Bin | null>(null)
  const placing = useRef(false)
  const { selection, notice, refiningBin, selectCell, clearSelection, refineTo } = useRefineSession({
    file,
    rules,
    loader,
    setFile,
  })
  const group = selection.status === 'ready' ? selection.group : null
  const classification = group?.classification
  const suggestedBin = classification?.kind === 'refinable' ? classification.bin : null
  const reservedBy = useMemo(() => {
    const cells = new Map<string, string>()
    for (const claim of floorState.claims) {
      if (claim.userId === userId) continue
      for (const cell of claim.cells) cells.set(cellKey(cell), claim.displayName)
    }
    return cells
  }, [floorState.claims, userId])
  const selected = useMemo(() => new Set(group?.cells.map(cellKey)), [group])
  const holder = group?.cells.map((cell) => reservedBy.get(cellKey(cell))).find(Boolean)
  const anchor = canRefine && suggestedBin !== null && group && !group.alreadyRefined ? group.cells[0] : undefined
  const canDrop = Boolean(anchor && !holder && !refiningBin && !placingBin)

  useEffect(() => {
    if (complete) return
    floor.start()
    return () => floor.stop()
  }, [floor, complete])

  useEffect(() => {
    if (!anchor || holder || floorState.status !== 'connected' || placing.current) return
    let current = true
    void floor.reserve(anchor).then((result) => {
      if (current && result.kind === 'blocked') setFloorNotice(result.message)
      if (current && result.kind === 'reserved') setFloorNotice('')
    })
    return () => {
      current = false
      if (!placing.current) floor.release()
    }
  }, [anchor, floor, holder, floorState.status])

  function cancelSelection() {
    if (placing.current) return
    floor.release()
    setFloorNotice('')
    clearSelection()
  }

  function chooseCell(cell: Cell) {
    if (placing.current || selected.has(cellKey(cell))) return
    floor.release()
    setFloorNotice('')
    void selectCell(cell)
  }

  async function placeGroup(bin: Bin) {
    if (!anchor || !canDrop || placing.current) return
    placing.current = true
    setPlacingBin(bin)
    setFloorNotice('')
    try {
      const reservation = await floor.reserve(anchor)
      if (reservation.kind === 'blocked') setFloorNotice(reservation.message)
      else if (reservation.kind !== 'cancelled') await refineTo(bin)
    } finally {
      floor.release()
      placing.current = false
      setPlacingBin(null)
    }
  }

  const { dragging, hoverBin, ghostRef, beginDrag } = useGroupDrag((bin) => void placeGroup(bin), cancelSelection)

  if (complete) return <FileCompleted file={file} />

  return (
    <div className="mt-4 space-y-4" onKeyDown={(event) => { if (event.key === 'Escape') cancelSelection() }}>
      <p role="status" className="text-sm text-slate-300">{floorState.message}</p>
      <RefineGrid
        file={file}
        loader={loader}
        threshold={rules.tremorThreshold}
        selected={selected}
        reservedBy={reservedBy}
        floor={floor}
        userId={userId}
        onSelect={chooseCell}
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
              {holder && <p className="text-sm text-indigo-200">Reservado por {holder}. Espera o elige otro grupo.</p>}
            </div>
            {canDrop && (
              <div
                onPointerDown={beginDrag}
                className="cursor-grab touch-none rounded bg-teal-300 px-3 py-2 font-medium text-slate-950 select-none"
              >
                Arrastrar a una caja
              </div>
            )}
            <button type="button" onClick={cancelSelection} disabled={placingBin !== null} className="text-sm underline">
              Cancelar
            </button>
          </div>
        )}
      </section>

      <BinTray
        progress={file.progress}
        suggestedBin={suggestedBin}
        hoverBin={hoverBin}
        refiningBin={refiningBin ?? placingBin}
        canDrop={canDrop}
        onSelectBin={(bin) => void placeGroup(bin)}
      />

      <p className="text-sm text-slate-300">
        {canRefine
          ? 'Con el teclado: selecciona el grupo, pasa con Tab a una caja y pulsa Enter. Escape cancela el arrastre.'
          : 'Tu cuenta puede ver este archivo, pero no refinarlo.'}
      </p>

      <div role="status" className={`min-h-6 ${notice?.tone === 'error' ? 'text-rose-300' : 'text-teal-200'}`}>
        {notice?.text}
      </div>
      {floorNotice && <p role="status" className="text-sm text-amber-200">{floorNotice}</p>}

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
