import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, isAbortError } from '../api/errors'
import type { DataFile } from '../api/types'
import type { TileLoader } from '../grid/tileLoader'
import { findGroup } from './group'
import type { Group, LoadTile } from './group'
import { affectedTiles, mistakesOf, rejectionMessage } from './messages'
import { refine } from './refine'
import type { RefineOutcome } from './refiner'
import type { Bin, Cell, Rules } from './types'

export type Selection =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; group: Group }

export interface Notice {
  tone: 'info' | 'error'
  text: string
}

interface RefineSessionOptions {
  file: DataFile
  rules: Rules
  loader: TileLoader
  setFile: (file: DataFile) => void
}

const IDLE: Selection = { status: 'idle' }
const MAX_ABORT_RETRIES = 5

export function useRefineSession({ file, rules, loader, setFile }: RefineSessionOptions) {
  const [selection, setSelection] = useState<Selection>(IDLE)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [refiningBin, setRefiningBin] = useState<Bin | null>(null)

  const latestFile = useRef(file)
  useEffect(() => {
    latestFile.current = file
  })
  const selectionRequest = useRef(0)
  const busy = useRef(false)

  const selectCell = useCallback(
    async (cell: Cell) => {
      selectionRequest.current += 1
      const request = selectionRequest.current
      setSelection({ status: 'loading' })
      setNotice(null)

      // La grilla cancela los bloques que salen de la vista, y un grupo puede cruzar a esos bloques.
      const loadTile: LoadTile = async (tileRow, tileCol) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await loader.load(tileRow, tileCol)
          } catch (error) {
            if (!isAbortError(error) || attempt >= MAX_ABORT_RETRIES) throw error
          }
        }
      }

      const { rows, cols, tileSize } = latestFile.current
      try {
        const group = await findGroup(cell, { rows, cols, tileSize }, rules, loadTile)
        if (request !== selectionRequest.current) return
        if (group) {
          setSelection({ status: 'ready', group })
        } else {
          setSelection(IDLE)
          setNotice({ tone: 'info', text: 'Esa celda no da miedo. Elige otra.' })
        }
      } catch (error) {
        if (request !== selectionRequest.current) return
        setSelection(IDLE)
        setNotice({ tone: 'error', text: `No se pudo cargar el grupo: ${errorMessage(error)}` })
      }
    },
    [loader, rules],
  )

  const clearSelection = useCallback(() => {
    selectionRequest.current += 1
    setSelection(IDLE)
  }, [])

  function applyOutcome(outcome: RefineOutcome, group: Group, bin: Bin) {
    if (outcome.status === 'unavailable') {
      setNotice({
        tone: 'error',
        text: 'Lumon no respondió. Intenta de nuevo: el grupo no se refinará dos veces.',
      })
      return
    }

    if (outcome.status === 'refined') {
      const { progress, refinedGroups, totalGroups, mistakes, status } = outcome.result.file
      loader.applyBins(group.cells, bin)
      setFile({ ...latestFile.current, progress, refinedGroups, totalGroups, mistakes, status })
      clearSelection()
      setNotice({ tone: 'info', text: `Grupo de ${group.cells.length} celdas enviado a ${bin}.` })
      return
    }

    const { rejection } = outcome
    setNotice({ tone: 'error', text: rejectionMessage(rejection) })

    if (rejection.code === 'WRONG_BIN') {
      const mistakes = mistakesOf(rejection.details)
      if (mistakes !== null) setFile({ ...latestFile.current, mistakes })
    } else if (rejection.code === 'ALREADY_REFINED') {
      loader.invalidate(affectedTiles(rejection.details))
      clearSelection()
    } else if (rejection.code === 'GROUP_INVALID') {
      clearSelection()
    }
  }

  async function refineTo(bin: Bin) {
    if (selection.status !== 'ready' || busy.current) return
    const { group } = selection

    if (group.classification.kind === 'noise') {
      setNotice({ tone: 'error', text: 'Este grupo es ruido: no se puede refinar.' })
      return
    }
    if (group.alreadyRefined) {
      setNotice({ tone: 'error', text: 'Este grupo ya está en una caja.' })
      return
    }

    busy.current = true
    setRefiningBin(bin)
    setNotice(null)
    try {
      applyOutcome(await refine(latestFile.current.id, bin, group.cells), group, bin)
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) })
    } finally {
      busy.current = false
      setRefiningBin(null)
    }
  }

  return { selection, notice, refiningBin, selectCell, clearSelection, refineTo }
}
