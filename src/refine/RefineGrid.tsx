/**
 * Grilla del archivo, virtualizada con elementos del DOM (sin librería ni <canvas>).
 *
 * - Solo se montan las celdas visibles + un margen, con tope de MAX_CELLS (2 500).
 * - Pide al TileLoader solo los bloques que cubren lo visible; los que salen de la vista se cancelan.
 * - Los bloques sin cargar muestran un placeholder del mismo tamaño: el layout no salta.
 * - La URL guarda la posición (?r=&c=) con replace: el scroll no llena el historial.
 * - Teclado: flechas, PageUp/PageDown, Home/End (Ctrl para ir al inicio/fin de la grilla) y Enter.
 *   La celda con foco siempre está en el DOM aunque quede fuera del rango visible.
 * - Patrón ARIA grid con los índices reales de fila y columna.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DataFile } from '../api/types'
import type { TileLoader } from '../grid/tileLoader'
import type { FloorClient } from '../floor/floorClient'
import { useFloorState } from '../floor/useFloor'
import type { Cell, Rules } from './types'

export const CELL = 28
const MAX_CELLS = 2500
const BIN_CLASS: Record<string, string> = {
  W: 'bg-sky-900/70 text-sky-200',
  F: 'bg-amber-900/70 text-amber-200',
  D: 'bg-violet-900/70 text-violet-200',
  M: 'bg-rose-900/70 text-rose-200',
}
const BIN_NAME: Record<string, string> = { W: 'WO', F: 'FC', D: 'DR', M: 'MA' }

interface Range {
  r0: number
  r1: number
  c0: number
  c1: number
}

interface RefineGridProps {
  file: DataFile
  rules: Rules
  loader: TileLoader
  floor: FloorClient | null
  myUserId: number | null
  selected: ReadonlySet<string>
  /** Si hay grupo seleccionado y se puede arrastrar. */
  canDrag: boolean
  onSelectCell: (cell: Cell) => void
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>) => void
  /** Saltar a una posición (por ejemplo al cursor de otro refinador). */
  jumpTo: { r: number; c: number; nonce: number } | null
}

const key = (r: number, c: number) => `${r}:${c}`
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function readPosition(params: URLSearchParams, rows: number, cols: number): Cell {
  const r = Number(params.get('r'))
  const c = Number(params.get('c'))
  return {
    r: Number.isInteger(r) ? clamp(r, 0, rows - 1) : 0,
    c: Number.isInteger(c) ? clamp(c, 0, cols - 1) : 0,
  }
}

export function RefineGrid(props: RefineGridProps) {
  const { file, rules, loader, floor, myUserId, selected, canDrag, onSelectCell, onBeginDrag, jumpTo } = props
  const { rows, cols, tileSize } = file
  const [params, setParams] = useSearchParams()
  const initial = useMemo(() => readPosition(params, rows, cols), []) // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: initial.r * CELL, left: initial.c * CELL, width: 800, height: 520 })
  const [focus, setFocus] = useState<Cell>(initial)
  const [, setTick] = useState(0)
  const focusFromKeyboard = useRef(false)

  // Re-render cuando llegan bloques (agrupado por frame).
  useEffect(() => {
    let frame = 0
    const off = loader.subscribe(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setTick((t) => t + 1)
      })
    })
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [loader])

  // Posición inicial desde la URL.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = initial.r * CELL
    el.scrollLeft = initial.c * CELL
  }, [initial])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () =>
      setViewport({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // La URL refleja la posición, con replace y con espera para no escribir en cada frame de scroll.
  const urlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setViewport({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight })
    clearTimeout(urlTimer.current)
    urlTimer.current = setTimeout(() => {
      const r = Math.floor(el.scrollTop / CELL)
      const c = Math.floor(el.scrollLeft / CELL)
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('r', String(r))
          next.set('c', String(c))
          return next
        },
        { replace: true },
      )
    }, 300)
  }, [setParams])
  useEffect(() => () => clearTimeout(urlTimer.current), [])

  // Rango visible + margen, recortado para no pasar de MAX_CELLS.
  const range: Range = useMemo(() => {
    const visRows = Math.ceil(viewport.height / CELL) + 1
    const visCols = Math.ceil(viewport.width / CELL) + 1
    let overscan = 3
    while (overscan > 0 && (visRows + 2 * overscan) * (visCols + 2 * overscan) > MAX_CELLS - 1) overscan--
    const firstRow = Math.floor(viewport.top / CELL)
    const firstCol = Math.floor(viewport.left / CELL)
    let r1 = Math.min(rows - 1, firstRow + visRows + overscan)
    let c1 = Math.min(cols - 1, firstCol + visCols + overscan)
    const r0 = Math.max(0, firstRow - overscan)
    const c0 = Math.max(0, firstCol - overscan)
    // Pantallas enormes: se recorta el ancho/alto para respetar el tope.
    while ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_CELLS - 1) {
      if (c1 - c0 > r1 - r0) c1--
      else r1--
    }
    return { r0, r1, c0, c1 }
  }, [viewport, rows, cols])

  // Pedir solo los bloques que cubren lo visible (y cancelar los demás).
  useEffect(() => {
    const t0r = Math.floor(range.r0 / tileSize)
    const t1r = Math.floor(range.r1 / tileSize)
    const t0c = Math.floor(range.c0 / tileSize)
    const t1c = Math.floor(range.c1 / tileSize)
    const wanted: Array<[number, number]> = []
    for (let tr = t0r; tr <= t1r; tr++) for (let tc = t0c; tc <= t1c; tc++) wanted.push([tr, tc])
    loader.setWanted(wanted)
  }, [range, tileSize, loader])

  // Mover el foco con el teclado: desplazar la vista para que la celda quede visible y enfocarla.
  useEffect(() => {
    const el = scroller.current
    if (!el || !focusFromKeyboard.current) return
    focusFromKeyboard.current = false
    const top = focus.r * CELL
    const left = focus.c * CELL
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth
    el.querySelector<HTMLElement>(`[data-cell="${key(focus.r, focus.c)}"]`)?.focus({ preventScroll: true })
    floor?.moveCursor(focus)
  }, [focus, floor])

  useEffect(() => {
    if (!jumpTo) return
    focusFromKeyboard.current = true
    setFocus({ r: clamp(jumpTo.r, 0, rows - 1), c: clamp(jumpTo.c, 0, cols - 1) })
    const el = scroller.current
    if (el) {
      el.scrollTop = Math.max(0, jumpTo.r * CELL - el.clientHeight / 2)
      el.scrollLeft = Math.max(0, jumpTo.c * CELL - el.clientWidth / 2)
    }
  }, [jumpTo, rows, cols])

  const pageRows = Math.max(1, Math.floor(viewport.height / CELL) - 1)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let { r, c } = focus
    switch (e.key) {
      case 'ArrowUp': r--; break
      case 'ArrowDown': r++; break
      case 'ArrowLeft': c--; break
      case 'ArrowRight': c++; break
      case 'PageUp': r -= pageRows; break
      case 'PageDown': r += pageRows; break
      case 'Home': c = 0; if (e.ctrlKey || e.metaKey) r = 0; break
      case 'End': c = cols - 1; if (e.ctrlKey || e.metaKey) r = rows - 1; break
      case 'Enter':
      case ' ':
        e.preventDefault()
        onSelectCell(focus)
        return
      default:
        return
    }
    e.preventDefault()
    focusFromKeyboard.current = true
    setFocus({ r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) })
  }

  // Filas a renderizar: las del rango + la fila de la celda con foco si quedó fuera.
  const rowIndexes: number[] = []
  for (let r = range.r0; r <= range.r1; r++) rowIndexes.push(r)
  const focusOutside = focus.r < range.r0 || focus.r > range.r1 || focus.c < range.c0 || focus.c > range.c1

  const claimsLayer = useClaimedCells(floor, myUserId)

  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative h-[60vh] min-h-72 overflow-auto rounded border border-slate-700 bg-slate-950"
      >
        <div
          role="grid"
          aria-label={`Grilla de ${file.name}`}
          aria-rowcount={rows}
          aria-colcount={cols}
          onKeyDown={onKeyDown}
          className="relative"
          style={{ width: cols * CELL, height: rows * CELL }}
        >
          {rowIndexes.map((r) => (
            <GridRow
              key={r}
              r={r}
              c0={range.c0}
              c1={range.c1}
              extraCol={focusOutside && focus.r === r ? focus.c : null}
              loader={loader}
              rules={rules}
              tileSize={tileSize}
              focus={focus}
              selected={selected}
              canDrag={canDrag}
              claimed={claimsLayer}
              onSelect={(cell) => {
                setFocus(cell)
                floor?.moveCursor(cell)
                onSelectCell(cell)
              }}
              onBeginDrag={onBeginDrag}
            />
          ))}
          {focusOutside && (focus.r < range.r0 || focus.r > range.r1) && (
            <GridRow
              r={focus.r}
              c0={focus.c}
              c1={focus.c - 1}
              extraCol={focus.c}
              loader={loader}
              rules={rules}
              tileSize={tileSize}
              focus={focus}
              selected={selected}
              canDrag={canDrag}
              claimed={claimsLayer}
              onSelect={onSelectCell}
              onBeginDrag={onBeginDrag}
            />
          )}
          <CursorLayer floor={floor} myUserId={myUserId} range={range} />
        </div>
      </div>
    </div>
  )
}

/** Celdas reservadas por OTROS usuarios (para dibujarlas distinto y no permitir soltarlas). */
function useClaimedCells(floor: FloorClient | null, myUserId: number | null): ReadonlyMap<string, string> {
  const { claims } = useFloorState(floor)
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const claim of claims) {
      if (claim.userId === myUserId && claim.claimId === floor?.ownClaimId) continue
      if (claim.userId === myUserId) continue
      for (const cell of claim.cells) map.set(key(cell.r, cell.c), claim.displayName)
    }
    return map
  }, [claims, myUserId, floor])
}

interface GridRowProps {
  r: number
  c0: number
  c1: number
  extraCol: number | null
  loader: TileLoader
  rules: Rules
  tileSize: number
  focus: Cell
  selected: ReadonlySet<string>
  canDrag: boolean
  claimed: ReadonlyMap<string, string>
  onSelect: (cell: Cell) => void
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>) => void
}

function GridRow({ r, c0, c1, extraCol, ...rest }: GridRowProps) {
  const cells: number[] = []
  for (let c = c0; c <= c1; c++) cells.push(c)
  if (extraCol !== null && (extraCol < c0 || extraCol > c1)) cells.push(extraCol)
  return (
    <div role="row" aria-rowindex={r + 1} className="contents">
      {cells.map((c) => (
        <GridCell key={c} r={r} c={c} {...rest} />
      ))}
    </div>
  )
}

interface GridCellProps extends Omit<GridRowProps, 'c0' | 'c1' | 'extraCol'> {
  c: number
}

const GridCell = memo(function GridCell({ r, c, loader, rules, tileSize, focus, selected, canDrag, claimed, onSelect, onBeginDrag }: GridCellProps) {
  const tile = loader.get(Math.floor(r / tileSize), Math.floor(c / tileSize))
  const isFocus = focus.r === r && focus.c === c
  const style = { top: r * CELL, left: c * CELL, width: CELL, height: CELL }
  const common = {
    role: 'gridcell',
    'aria-colindex': c + 1,
    'data-cell': key(r, c),
    tabIndex: isFocus ? 0 : -1,
  } as const

  if (!tile) {
    return (
      <div {...common} aria-busy="true" aria-label={`Fila ${r + 1}, columna ${c + 1}: cargando`} className="absolute p-0.5" style={style}>
        <span className="block h-full w-full rounded-sm bg-slate-800/60" />
      </div>
    )
  }

  const idx = (r - tile.originRow) * tile.cols + (c - tile.originCol)
  const digit = tile.values[idx]
  const tremor = tile.tremor[idx]
  const bin = tile.bins[idx]
  const scary = tremor >= rules.tremorThreshold && bin === '.'
  const isSelected = selected.has(key(r, c))
  const holder = claimed.get(key(r, c))

  const classes = [
    'absolute flex items-center justify-center font-mono text-sm select-none outline-none',
    'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white',
    bin !== '.' ? BIN_CLASS[bin] : scary ? 'cell-scary' : 'text-slate-500',
    isSelected ? 'z-[5] bg-teal-400/30 ring-2 ring-teal-300 ring-inset' : '',
    holder ? 'cell-claimed' : '',
    isSelected && canDrag ? 'cursor-grab touch-none' : 'cursor-pointer',
  ].join(' ')

  const label = [
    `Fila ${r + 1}, columna ${c + 1}: ${digit}`,
    bin !== '.' ? `en ${BIN_NAME[bin]}` : scary ? 'da miedo' : '',
    holder ? `reservado por ${holder}` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      {...common}
      aria-selected={isSelected}
      aria-label={label}
      title={holder ? `Reservado por ${holder}` : undefined}
      className={classes}
      style={{ ...style, ['--tremor' as string]: String(tremor / 100) }}
      onClick={() => onSelect({ r, c })}
      onPointerDown={isSelected && canDrag ? onBeginDrag : undefined}
    >
      {digit}
    </div>
  )
})

/** Cursores de los demás: capa aparte que se re-renderiza sola, sin tocar las celdas. */
function CursorLayer({ floor, myUserId, range }: { floor: FloorClient | null; myUserId: number | null; range: Range }) {
  const { members } = useFloorState(floor)
  return (
    <>
      {members
        .filter((m) => m.userId !== myUserId && m.r !== null && m.c !== null)
        .filter((m) => (m.r as number) >= range.r0 && (m.r as number) <= range.r1 && (m.c as number) >= range.c0 && (m.c as number) <= range.c1)
        .map((m) => (
          <div
            key={m.userId}
            aria-hidden="true"
            className="pointer-events-none absolute z-20 rounded-sm ring-2 ring-fuchsia-400 transition-[top,left] duration-100 motion-reduce:transition-none"
            style={{ top: (m.r as number) * CELL, left: (m.c as number) * CELL, width: CELL, height: CELL }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-fuchsia-500 px-1 text-[10px] text-white">
              {m.displayName}
            </span>
          </div>
        ))}
    </>
  )
}
