import { useEffect, useState, useSyncExternalStore } from 'react'
import { FloorClient, type FloorState } from './floorClient'

const EMPTY: FloorState = { status: 'unavailable', message: null, members: [], claims: [] }
const noopSubscribe = () => () => undefined

/** Un FloorClient por pestaña y archivo; se cierra al salir de la grilla. */
export function useFloorClient(fileId: number, enabled: boolean): FloorClient | null {
  const [client, setClient] = useState<FloorClient | null>(null)
  useEffect(() => {
    if (!enabled) return
    const instance = new FloorClient(fileId)
    setClient(instance)
    return () => {
      instance.close()
      setClient(null)
    }
  }, [fileId, enabled])
  return client
}

/** Suscribe un componente al estado del piso (solo ese componente se re-renderiza). */
export function useFloorState(client: FloorClient | null): FloorState {
  return useSyncExternalStore(client?.subscribe ?? noopSubscribe, client?.getState ?? (() => EMPTY))
}
