import { useEffect, useRef, useState } from 'react'
import { onLumonEvent, onStreamStatus, type LumonEvent, type StreamStatus } from './eventStream'

/** Suscribe un handler a un tipo de evento ("*" para todos). El handler puede cambiar sin resuscribir. */
export function useLumonEvent(type: string, handler: (event: LumonEvent) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => onLumonEvent(type, (e) => ref.current(e)), [type])
}

export function useStreamStatus(): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('idle')
  useEffect(() => onStreamStatus(setStatus), [])
  return status
}
