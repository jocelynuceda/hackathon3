import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorMessage } from '../api/errors'
import type { Bin } from '../api/types'
import { useLumonEvent } from '../events/hooks'
import { useFile } from '../grid/useFile'
import { RefineWorkspace } from '../refine/RefineWorkspace'

export default function RefinePage() {
  const { id } = useParams()
  const fileId = Number(id)
  const { file, rules, loader, error, loading, tileRows, tileCols, setFile, reload } = useFile(fileId)
  const [loadedTiles, setLoadedTiles] = useState(0)

  // Cuenta los bloques recibidos al recorrer el archivo.
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
  useLumonEvent('file.completed', () => reload())

  if (!Number.isInteger(fileId) || fileId < 1) {
    return (
      <main className="p-6">
        <p>El identificador de archivo no es válido.</p>
        <Link className="text-teal-300 underline" to="/files">Volver a los archivos</Link>
      </main>
    )
  }
  if (loading && !file) return <main className="p-6" role="status">Cargando archivo…</main>
  if (error !== null || !file || !rules || !loader) {
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
      <RefineWorkspace key={file.id} file={file} rules={rules} loader={loader} setFile={setFile} />
      <p className="mt-4 text-sm text-slate-400" role="status">Bloques recibidos: {loadedTiles}</p>
    </main>
  )
}
