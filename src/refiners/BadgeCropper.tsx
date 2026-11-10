import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampCrop, cropRect, MAX_ZOOM, MIN_ZOOM } from '../media/image'
import type { Crop } from '../media/image'

const VIEW_SIZE = 320
const KEY_STEP = 0.05
const ZOOM_STEP = 0.1

interface BadgeCropperProps {
  image: ImageBitmap
  crop: Crop
  onChange: (crop: Crop) => void
}

export function BadgeCropper({ image, crop, onChange }: BadgeCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; crop: Crop } | null>(null)

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const { x, y, side } = cropRect(image, crop)
    context.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE)
    context.drawImage(image, x, y, side, side, 0, 0, VIEW_SIZE, VIEW_SIZE)
  }, [image, crop])

  const update = (next: Crop) => onChange(clampCrop(image, next))

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, crop }
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const { side } = cropRect(image, drag.crop)
    const scale = side / VIEW_SIZE
    update({
      ...drag.crop,
      centerX: drag.crop.centerX - (event.clientX - drag.x) * scale,
      centerY: drag.crop.centerY - (event.clientY - drag.y) * scale,
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const step = cropRect(image, crop).side * KEY_STEP
    const moves: Record<string, Partial<Crop>> = {
      ArrowLeft: { centerX: crop.centerX - step },
      ArrowRight: { centerX: crop.centerX + step },
      ArrowUp: { centerY: crop.centerY - step },
      ArrowDown: { centerY: crop.centerY + step },
      '+': { zoom: crop.zoom + ZOOM_STEP },
      '=': { zoom: crop.zoom + ZOOM_STEP },
      '-': { zoom: crop.zoom - ZOOM_STEP },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    update({ ...crop, ...move })
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        width={VIEW_SIZE}
        height={VIEW_SIZE}
        tabIndex={0}
        role="img"
        aria-label="Recorte del fotocheck. Muévelo con las flechas y cambia el zoom con más y menos."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onKeyDown={onKeyDown}
        className="max-w-full cursor-move touch-none rounded border border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
      />
      <label className="block text-sm text-slate-200">
        Zoom
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={crop.zoom}
          onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })}
          className="mt-1 block w-80 max-w-full"
        />
      </label>
      <p className="text-sm text-slate-300">Arrastra la imagen, o usa las flechas y las teclas + y − con el recorte enfocado.</p>
    </div>
  )
}
