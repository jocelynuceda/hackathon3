import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { DataFile } from '../api/types'
import type { Cell } from '../refine/types'
import type { TileLoader } from './tileLoader'

const CELL = 32
const MAX_VISIBLE_AXIS = 48
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

export function RefineGrid({ file, loader, threshold, selected, onSelect, onDragStart }: RefineGridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState(emptyView)
  const [, redraw] = useState(0)
  const { rows, cols, tileSize } = file
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

  return (
    <div
      ref={scroller}
      aria-label="Grilla de refinamiento"
      onScroll={measure}
      className="h-[min(56vh,36rem)] max-w-[90rem] overflow-auto rounded border border-slate-700 bg-slate-950"
    >
      <div className="relative" style={{ width: cols * CELL, height: rows * CELL }}>
        {hasViewport && Array.from({ length: endRow - firstRow }, (_, rowOffset) => {
          const r = firstRow + rowOffset
          return (
            <div key={r} className="absolute left-0 flex" style={{ top: r * CELL, paddingLeft: firstCol * CELL }}>
              {Array.from({ length: endCol - firstCol }, (_, colOffset) => {
                const c = firstCol + colOffset
                const tile = loader.get(Math.floor(r / tileSize), Math.floor(c / tileSize))
                const index = tile ? (r - tile.originRow) * tile.cols + c - tile.originCol : 0
                const scary = tile !== undefined && tile.tremor[index] >= threshold
                const active = selected.has(cellKey({ r, c }))
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={tile ? `Fila ${r + 1}, columna ${c + 1}: ${tile.values[index]}` : `Fila ${r + 1}, columna ${c + 1}: cargando`}
                    onClick={scary ? () => onSelect({ r, c }) : undefined}
                    onPointerDown={active ? onDragStart : undefined}
                    className={`shrink-0 border-r border-b border-slate-800 font-mono ${active ? 'bg-teal-300 text-slate-950' : scary ? 'bg-rose-950 text-rose-200' : tile ? 'text-slate-300' : 'bg-slate-900'}`}
                    style={{ width: CELL, height: CELL }}
                  >
                    {tile ? tile.values[index] : '·'}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
