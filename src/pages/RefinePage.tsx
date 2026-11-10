/**
 * /files/:id/refine — PROVISIONAL.
 * Ya conecta el archivo, las reglas, el TileLoader y los eventos. La grilla virtualizada
 * (celdas, selección de grupos, arrastre a las cajas y refinamiento) va en <RefineGrid />,
 * que construye otra persona del equipo usando `loader` (ver src/grid/tileLoader.ts).
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorMessage } from '../api/errors'
import type { Bin } from '../api/types'
import { useLumonEvent } from '../events/hooks'
import { useFile } from '../grid/useFile'

const BINS: Bin[] = ['WO', 'FC', 'DR', 'MA']

export default function RefinePage() {
  const { id } = useParams()
  const fileId = Number(id)
  const { file, rules, loader, error, loading, tileRows, tileCols, setFile, reload } = useFile(fileId)
  const [loadedTiles, setLoadedTiles] = useState(0)

  // Cuenta los bloques que van llegando (solo informativo mientras no esté la grilla).
  useEffect(() => {
    if (!loader) return
    setLoadedTiles(0)
    return loader.subscribe(() => setLoadedTiles((n) => n + 1))
  }, [loader])

  // Otros refinadores: marca las celdas y actualiza las barras sin recargar.
  useLumonEvent('refinement.created', (e) => {
    const ev = e.data as { fileId: number; cells: Array<{ r: number; c: number }>; bin: Bin; progress: NonNullable<typeof file>['progress'] }
    if (ev.fileId !== fileId || !file) return
    loader?.applyBins(ev.cells, ev.bin)
    setFile({ ...file, progress: ev.progress })
  })
  useLumonEvent('stream.reset', () => reload())

  if (!Number.isInteger(fileId) || fileId < 1) {
    return (
      <main className="p-6">
        <p>El identificador de archivo no es válido.</p>
        <Link className="text-teal-300 underline" to="/files">Volver a los archivos</Link>
      </main>
    )
  }
  if (loading && !file) return <main className="p-6" role="status">Cargando archivo…</main>
  if (error !== null || !file || !rules) {
    return (
      <main className="p-6" role="alert">
        <p>No se pudo cargar el archivo: {errorMessage(error)}</p>
        <button type="button" className="mt-2 underline" onClick={reload}>Reintentar</button>
      </main>
    )
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{file.name}</h1>
      <p className="text-sm text-slate-400">
        {file.rows} × {file.cols} celdas · {tileRows} × {tileCols} bloques de {file.tileSize} · umbral {rules.tremorThreshold} ·
        conectividad {rules.connectivity} · grupos de {rules.minGroupSize} a {rules.maxGroupSize}
      </p>
      <div className="mt-4 grid max-w-xl grid-cols-4 gap-3">
        {BINS.map((b) => (
          <div key={b}>
            <div className="text-sm font-semibold">{b}</div>
            <progress className="w-full" max={1} value={file.progress[b]} aria-label={`Progreso de la caja ${b}`} />
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-400" role="status">Bloques recibidos: {loadedTiles}</p>
    </main>
  )
}
