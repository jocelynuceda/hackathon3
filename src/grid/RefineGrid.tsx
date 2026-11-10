import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DataFile } from '../api/types'
import type { Cell } from '../refine/types'
import type { TileLoader } from './tileLoader'
import './refine-grid.css'

const CELL = 32
const MAX_VISIBLE_AXIS = 48
const binNames: Record<string, string> = { W: 'WO', F: 'FC', D: 'DR', M: 'MA' }
const binColors: Record<string, string> = {
  W: 'bg-amber-950 text-amber-200',
  F: 'bg-violet-950 text-violet-200',
  D: 'bg-sky-950 text-sky-200',
  M: 'bg-lime-950 text-lime-200',
}
export const cellKey = ({ r, c }: Cell) => `${r}:${c}`

interface RefineGridProps {
  file: DataFile
  loader: TileLoader
  threshold: number
  selected: ReadonlySet<string>
  onSelect: (cell: Cell) => void
  onDragStart?: (event: PointerEvent<HTMLElement>) => void
}

interface Viewport {
  top: number
  left: number
  width: number
  height: number
}

const emptyView: Viewport = { top: 0, left: 0, width: 0, height: 0 }

function axis(offset: number, size: number, count: number) {
  const first = Math.floor(offset / CELL)
  const end = Math.min(count, first + MAX_VISIBLE_AXIS, Math.ceil((offset + size) / CELL))
  return [first, end] as const
}

function coordinate(value: string | number | null, count: number) {
  const n = Number(value)
  return Number.isSafeInteger(n) ? Math.max(0, Math.min(count - 1, n)) : 0
}

function includeFocused(first: number, end: number, focused: number) {
  const visible = Array.from({ length: end - first }, (_, i) => first + i)
  if (focused < first) visible.unshift(focused)
  else if (focused >= end) visible.push(focused)
  return visible
}

export function RefineGrid({ file, loader, threshold, selected, onSelect, onDragStart }: RefineGridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)
  const positionWritten = useRef<string | null>(null)
  const positionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState(emptyView)
  const [, redraw] = useState(0)
  const { rows, cols, tileSize } = file
  const urlRow = params.get('r')
  const urlCol = params.get('c')
  const [focused, setFocused] = useState<Cell>(() => ({
    r: coordinate(urlRow, rows), c: coordinate(urlCol, cols),
  }))
  const [firstRow, endRow] = axis(view.top, view.height, rows)
  const [firstCol, endCol] = axis(view.left, view.width, cols)
  const firstTileRow = Math.floor(firstRow / tileSize)
  const lastTileRow = Math.floor((endRow - 1) / tileSize)
  const firstTileCol = Math.floor(firstCol / tileSize)
  const lastTileCol = Math.floor((endCol - 1) / tileSize)
  const hasViewport = view.width > 0 && view.height > 0

  function measure() {
    const el = scroller.current
    if (!el) return
    const next = { top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight }
    setView((current) => current.top === next.top && current.left === next.left &&
      current.width === next.width && current.height === next.height ? current : next)
  }

  function onScroll() {
    measure()
    clearTimeout(positionTimer.current)
    positionTimer.current = setTimeout(() => {
      const el = scroller.current
      if (!el) return
      const r = String(Math.floor(el.scrollTop / CELL))
      const c = String(Math.floor(el.scrollLeft / CELL))
      if (urlRow === r && urlCol === c) return
      positionWritten.current = `${r}:${c}`
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set('r', r)
        next.set('c', c)
        return next
      }, { replace: true })
    }, 140)
  }

  useLayoutEffect(() => {
    clearTimeout(positionTimer.current)
    const el = scroller.current
    if (!el) return
    const position = `${urlRow}:${urlCol}`
    if (positionWritten.current === position) {
      positionWritten.current = null
      return
    }
    positionWritten.current = null
    const target = { r: coordinate(urlRow, rows), c: coordinate(urlCol, cols) }
    el.scrollTo(target.c * CELL, target.r * CELL)
    if (!el.contains(document.activeElement)) setFocused(target)
    measure()
  }, [urlRow, urlCol, rows, cols])
  useEffect(() => () => clearTimeout(positionTimer.current), [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => loader.subscribe(() => redraw((current) => current + 1)), [loader])

  useEffect(() => {
    if (!hasViewport) return
    const wanted: Array<[number, number]> = []
    for (let r = firstTileRow; r <= lastTileRow; r++) {
      for (let c = firstTileCol; c <= lastTileCol; c++) wanted.push([r, c])
    }
    loader.setWanted(wanted)
  }, [loader, hasViewport, firstTileRow, lastTileRow, firstTileCol, lastTileCol])
  useEffect(() => () => loader.setWanted([]), [loader])

  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    scroller.current?.querySelector<HTMLButtonElement>(`[data-cell="${cellKey(focused)}"]`)?.focus({ preventScroll: true })
  }, [focused])

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    const el = scroller.current
    if (!el) return
    const page = Math.max(1, Math.floor(el.clientHeight / CELL) - 1)
    switch (event.key) {
      case 'ArrowUp': r--; break
      case 'ArrowDown': r++; break
      case 'ArrowLeft': c--; break
      case 'ArrowRight': c++; break
      case 'PageUp': r -= page; break
      case 'PageDown': r += page; break
      case 'Home': c = 0; if (event.ctrlKey) r = 0; break
      case 'End': c = cols - 1; if (event.ctrlKey) r = rows - 1; break
      default: return
    }
    event.preventDefault()
    r = coordinate(r, rows)
    c = coordinate(c, cols)
    if (r === focused.r && c === focused.c) return
    const top = r * CELL
    const left = c * CELL
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth
    pendingFocus.current = true
    setFocused({ r, c })
    measure()
  }

  return (
    <div
      ref={scroller}
      role="grid"
      aria-label="Grilla de refinamiento"
      aria-rowcount={rows}
      aria-colcount={cols}
      onScroll={onScroll}
      className="h-[min(56vh,36rem)] max-w-[90rem] overflow-auto rounded border border-slate-700 bg-slate-950"
    >
      <div role="presentation" className="relative" style={{ width: cols * CELL, height: rows * CELL }}>
        {hasViewport && includeFocused(firstRow, endRow, focused.r).map((r) => (
          <div key={r} role="row" aria-rowindex={r + 1} className="absolute left-0" style={{ top: r * CELL }}>
              {(r < firstRow || r >= endRow ? [focused.c]
                : r === focused.r ? includeFocused(firstCol, endCol, focused.c)
                : Array.from({ length: endCol - firstCol }, (_, i) => firstCol + i)).map((c) => {
                const tile = loader.get(Math.floor(r / tileSize), Math.floor(c / tileSize))
                const index = tile ? (r - tile.originRow) * tile.cols + c - tile.originCol : 0
                const tremor = tile?.tremor[index]
                const scary = tremor !== undefined && tremor >= threshold
                const bin = tile ? binNames[tile.bins[index]] : undefined
                const active = selected.has(cellKey({ r, c }))
                const label = tile
                  ? `${tile.values[index]}${scary ? ', da miedo' : ''}${bin ? `, caja ${bin}` : ''}`
                  : 'cargando'
                return (
                  <button
                    key={c}
                    type="button"
                    role="gridcell"
                    aria-rowindex={r + 1}
                    aria-colindex={c + 1}
                    aria-selected={active}
                    aria-label={label}
                    data-cell={cellKey({ r, c })}
                    tabIndex={r === focused.r && c === focused.c ? 0 : -1}
                    onFocus={() => setFocused({ r, c })}
                    onKeyDown={(event) => moveFocus(event, r, c)}
                    onClick={scary ? () => onSelect({ r, c }) : undefined}
                    onPointerDown={active ? onDragStart : undefined}
                    className={`absolute border-r border-b border-slate-800 font-mono focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white ${active ? 'bg-teal-300 text-slate-950' : bin ? binColors[tile!.bins[index]] : scary ? 'bg-rose-950 text-rose-200' : tile ? 'text-slate-300' : 'bg-slate-900'} ${active && onDragStart ? 'touch-none cursor-grab' : ''}`}
                    style={{ left: c * CELL, width: CELL, height: CELL }}
                  >
                    <span
                      className={scary && !bin ? 'refine-tremor' : undefined}
                      style={scary ? { '--refine-tremor': `${Math.max(0.4, (tremor / 100) * 2.5)}px` } as CSSProperties : undefined}
                    >{tile ? tile.values[index] : '·'}</span>
                    {bin && <span aria-hidden="true" className="absolute right-0.5 bottom-0 text-[8px]">{bin}</span>}
                  </button>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}
