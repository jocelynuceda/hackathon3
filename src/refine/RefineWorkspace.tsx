import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DataFile } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useCan } from '../auth/session'
import { FloorPanel } from '../floor/FloorPanel'
import { useFloorClient, useFloorState } from '../floor/useFloor'
import type { TileLoader } from '../grid/tileLoader'
import { BinTray } from './BinTray'
import { RefineGrid } from './RefineGrid'
import type { Rules } from './types'
import { useGroupDrag } from './useGroupDrag'
import { useRefineSession } from './useRefineSession'

interface RefineWorkspaceProps {
  file: DataFile
  rules: Rules
  loader: TileLoader
  setFile: (file: DataFile) => void
}

type ClaimState =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'granted' }
  | { status: 'denied'; text: string }

function FileCompleted({ file }: { file: DataFile }) {
  return (
    <section className="mt-6 rounded border border-teal-300 bg-slate-900 p-6" role="status">
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
  const { me } = useAuth()
  const floor = useFloorClient(file.id, true)
  const floorState = useFloorState(floor)
  const { selection, notice, refiningBin, selectCell, clearSelection, refineTo } = useRefineSession({
    file,
    rules,
    loader,
    setFile,
  })
  const [claim, setClaim] = useState<ClaimState>({ status: 'none' })
  const [jumpTo, setJumpTo] = useState<{ r: number; c: number; nonce: number } | null>(null)

  const group = selection.status === 'ready' ? selection.group : null
  const classification = group?.classification
  const suggestedBin = classification?.kind === 'refinable' ? classification.bin : null

  const selected = useMemo(() => new Set(group?.cells.map(({ r, c }) => `${r}:${c}`) ?? []), [group])

  // ¿Otro usuario tiene reservada alguna celda del grupo seleccionado?
  const heldByOther = useMemo(() => {
    if (!group) return null
    for (const cl of floorState.claims) {
      if (cl.userId === me?.id) continue
      if (cl.cells.some((cell) => selected.has(`${cell.r}:${cell.c}`))) return cl.displayName
    }
    return null
  }, [floorState.claims, group, selected, me])

  // Antes de llevar un grupo a una caja se reserva. Sin WebSocket se puede seguir refinando igual.
  const claimRequest = useRef(0)
  useEffect(() => {
    const request = ++claimRequest.current
    if (!group || !floor || floorState.status !== 'open' || !canRefine || suggestedBin === null || group.alreadyRefined) {
      setClaim({ status: 'none' })
      return
    }
    setClaim({ status: 'pending' })
    void floor.claim(group.cells[0]).then((result) => {
      if (request !== claimRequest.current) return
      if (result.ok) setClaim({ status: 'granted' })
      else if (result.reason === 'HELD')
        setClaim({ status: 'denied', text: `${result.holder?.displayName ?? 'Otro refinador'} tiene reservado este grupo. Elige otro o espera.` })
      else if (result.reason === 'NOT_A_GROUP')
        setClaim({ status: 'denied', text: 'Lumon dice que esa celda ya no forma un grupo refinable. Vuelve a seleccionar.' })
      else setClaim({ status: 'none' }) // sin respuesta del piso: se permite refinar por HTTP
    })
    // Al cambiar de grupo o cancelar, se libera la reserva.
    return () => floor.release()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, floor, floorState.status === 'open', canRefine])

  const blockedByClaim = claim.status === 'denied' || heldByOther !== null || claim.status === 'pending'
  const canDrop =
    canRefine && suggestedBin !== null && group !== null && !group.alreadyRefined && refiningBin === null && !blockedByClaim

  async function onRefine(bin: Parameters<typeof refineTo>[0]) {
    await refineTo(bin)
    floor?.forgetClaim()
  }

  const { dragging, hoverBin, ghostRef, beginDrag } = useGroupDrag((bin) => {
    if (canDrop) void onRefine(bin)
  })

  if (file.status === 'COMPLETE' || file.progress.overall >= 1) return <FileCompleted file={file} />

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0 space-y-4">
        <RefineGrid
          file={file}
          rules={rules}
          loader={loader}
          floor={floor}
          myUserId={me?.id ?? null}
          selected={selected}
          canDrag={canDrop}
          onSelectCell={(cell) => void selectCell(cell)}
          onBeginDrag={beginDrag}
          jumpTo={jumpTo}
        />

        <section aria-label="Grupo seleccionado" className="min-h-20 rounded border border-slate-700 p-4">
          {selection.status === 'idle' && <p className="text-slate-300">Elige una celda que dé miedo (clic o Enter).</p>}
          {selection.status === 'loading' && <p className="text-slate-300">Buscando el grupo completo…</p>}
          {group && (
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="font-semibold">Grupo de {group.cells.length} celdas</p>
                <p className="text-sm text-slate-300">
                  {suggestedBin ? `Caja que corresponde: ${suggestedBin}` : 'Es ruido: no se puede refinar.'}
                  {group.alreadyRefined && ' Ya está en una caja.'}
                </p>
                {heldByOther && <p className="text-sm text-fuchsia-300">Reservado por {heldByOther}.</p>}
                {claim.status === 'pending' && <p className="text-sm text-slate-400">Reservando el grupo…</p>}
                {claim.status === 'denied' && <p className="text-sm text-fuchsia-300">{claim.text}</p>}
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
          onSelectBin={(bin) => void onRefine(bin)}
        />

        <p className="text-sm text-slate-300">
          {canRefine
            ? 'Teclado: flechas, Re Pág/Av Pág, Inicio/Fin para moverte; Enter selecciona el grupo; Tab hasta una caja y Enter la refina. También puedes arrastrar el grupo.'
            : 'Tu cuenta puede ver este archivo, pero no refinarlo.'}
        </p>

        <div role="status" aria-live="polite" className={`min-h-6 ${notice?.tone === 'error' ? 'text-rose-300' : 'text-teal-200'}`}>
          {notice?.text}
        </div>
      </div>

      <FloorPanel floor={floor} myUserId={me?.id ?? null} onGoTo={(r, c) => setJumpTo({ r, c, nonce: Date.now() })} />

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
