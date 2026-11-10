import { useCallback, useEffect, useState } from 'react'
import { fetchRefiner } from './api'
import type { VersionedRefiner } from './api'

export function useRefiner(id: number) {
  const [loaded, setLoaded] = useState<VersionedRefiner | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    fetchRefiner(id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded(result)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure)
      })
    return () => controller.abort()
  }, [id, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { loaded, setLoaded, error, reload }
}
