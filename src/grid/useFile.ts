import { useEffect, useState } from 'react'
import { api, withRetry } from '../api/client'
import type { DataFile, Rules } from '../api/types'
import { TileLoader } from './tileLoader'

interface FileData {
  file: DataFile | null
  rules: Rules | null
  loader: TileLoader | null
  error: unknown
  loading: boolean
  /** Filas y columnas de bloques. */
  tileRows: number
  tileCols: number
  setFile: (file: DataFile) => void
  reload: () => void
}

/** Detalle del archivo + reglas + un TileLoader propio de ese archivo. */
export function useFile(fileId: number): FileData {
  const [file, setFile] = useState<DataFile | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const [loader, setLoader] = useState<TileLoader | null>(null)
  useEffect(() => {
    if (!Number.isFinite(fileId)) return
    const instance = new TileLoader(fileId)
    setLoader(instance)
    return () => instance.dispose()
  }, [fileId])

  useEffect(() => {
    if (!Number.isFinite(fileId)) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([
      withRetry(() => api<DataFile>(`/files/${fileId}`, { signal: controller.signal }), controller.signal),
      withRetry(() => api<Rules>(`/files/${fileId}/rules`, { signal: controller.signal }), controller.signal),
    ])
      .then(([f, r]) => {
        if (controller.signal.aborted) return
        setFile(f)
        setRules(r)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [fileId, nonce])

  const tileRows = file ? Math.ceil(file.rows / file.tileSize) : 0
  const tileCols = file ? Math.ceil(file.cols / file.tileSize) : 0

  return { file, rules, loader, error, loading, tileRows, tileCols, setFile, reload: () => setNonce((n) => n + 1) }
}
