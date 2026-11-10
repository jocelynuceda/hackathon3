import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Bin } from './types'

const DRAG_THRESHOLD_PX = 4
const BINS: readonly string[] = ['WO', 'FC', 'DR', 'MA']

function binAt(x: number, y: number): Bin | null {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bin]')
  const bin = target?.dataset.bin
  return bin !== undefined && BINS.includes(bin) ? (bin as Bin) : null
}

/**
 * Arrastre con Pointer Events, sin librería. Escucha en window para sobrevivir aunque la celda
 * de origen salga del DOM por la virtualización. Las cajas se marcan con `data-bin`.
 */
export function useGroupDrag(onDrop: (bin: Bin) => void, onCancel: () => void) {
  const [dragging, setDragging] = useState(false)
  const [hoverBin, setHoverBin] = useState<Bin | null>(null)
  const ghostElement = useRef<HTMLDivElement | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const stopRef = useRef<(() => void) | null>(null)

  const latestOnDrop = useRef(onDrop)
  const latestOnCancel = useRef(onCancel)
  useEffect(() => {
    latestOnDrop.current = onDrop
    latestOnCancel.current = onCancel
  })

  useEffect(() => () => stopRef.current?.(), [])

  const applyPointer = () => {
    const { x, y } = pointer.current
    if (ghostElement.current) ghostElement.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`
  }

  // El fantasma se monta después del primer movimiento: se ubica apenas existe.
  const ghostRef = useCallback((element: HTMLDivElement | null) => {
    ghostElement.current = element
    applyPointer()
  }, [])

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    stopRef.current?.()

    const startX = event.clientX
    const startY = event.clientY
    let active = false

    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      stopRef.current = null
      setDragging(false)
      setHoverBin(null)
    }

    function onMove(move: PointerEvent) {
      if (!active && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return
      active = true
      setDragging(true)
      pointer.current = { x: move.clientX, y: move.clientY }
      applyPointer()
      setHoverBin(binAt(move.clientX, move.clientY))
    }

    function onUp(up: PointerEvent) {
      const bin = active ? binAt(up.clientX, up.clientY) : null
      stop()
      if (bin) latestOnDrop.current(bin)
      else if (active) latestOnCancel.current()
    }

    function cancel() {
      stop()
      latestOnCancel.current()
    }

    function onKey(key: KeyboardEvent) {
      if (key.key === 'Escape') cancel()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    stopRef.current = stop
  }, [])

  return { dragging, hoverBin, ghostRef, beginDrag }
}
