/**
 * Stream de eventos (SSE) compartido por todas las pestañas.
 *
 * - Una sola conexión por navegador: la pestaña que obtiene el Web Lock "lumon-events-leader" es la
 *   líder y abre el stream; las demás reciben los eventos por BroadcastChannel. Si se cierra la
 *   pestaña líder, el lock se libera y otra pestaña lo toma y reconecta.
 * - Ticket nuevo (POST /events/tickets) en cada conexión; nunca se manda el access token en la URL.
 * - Se lee con fetch + ReadableStream (no EventSource) para ver también los comentarios de heartbeat
 *   y detectar una conexión muerta: sin datos ni heartbeat por 45 s se cierra y se reconecta.
 * - `lastEventId` (compartido en localStorage) para que el backend reenvíe lo perdido.
 * - Ningún evento se aplica dos veces: se descartan ids ya vistos.
 */
import { config } from '../config'
import { api, backoffDelay } from '../api/client'
import { ApiError } from '../api/errors'
import { endSession } from '../api/session'

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'locked' | 'follower'

export interface LumonEvent {
  id: number
  type: string
  data: unknown
}

type ChannelMessage =
  | { kind: 'event'; event: LumonEvent }
  | { kind: 'status'; status: StreamStatus }
  | { kind: 'status-request' }

const LAST_ID_KEY = 'lumon.lastEventId'
const DEAD_AFTER_MS = 45000
const LOCKED_RETRY_MS = 30000

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lumon-events')

const handlers = new Map<string, Set<(event: LumonEvent) => void>>()
const statusListeners = new Set<(status: StreamStatus) => void>()
const seen = new Set<number>()
const seenOrder: number[] = []

let status: StreamStatus = 'idle'
let isLeader = false
let running = false
let releaseLeadership: (() => void) | null = null
let abort: AbortController | null = null

function setStatus(next: StreamStatus, broadcast = true) {
  status = next
  for (const l of statusListeners) l(next)
  if (broadcast && isLeader) channel?.postMessage({ kind: 'status', status: next } satisfies ChannelMessage)
}

function readLastId(): number | null {
  try {
    const v = localStorage.getItem(LAST_ID_KEY)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
}

function writeLastId(id: number) {
  try {
    const prev = readLastId()
    if (prev === null || id > prev) localStorage.setItem(LAST_ID_KEY, String(id))
  } catch {
    // ignorar
  }
}

function markSeen(id: number): boolean {
  if (seen.has(id)) return false
  seen.add(id)
  seenOrder.push(id)
  if (seenOrder.length > 2000) seen.delete(seenOrder.shift() as number)
  return true
}

function dispatch(event: LumonEvent) {
  if (event.id > 0 && !markSeen(event.id)) return
  if (event.type === 'session.revoked') endSession('SESSION_REVOKED')
  for (const h of handlers.get(event.type) ?? []) h(event)
  for (const h of handlers.get('*') ?? []) h(event)
}

channel?.addEventListener('message', (e: MessageEvent<ChannelMessage>) => {
  const msg = e.data
  if (msg.kind === 'event') dispatch(msg.event)
  else if (msg.kind === 'status' && !isLeader) {
    status = msg.status
    for (const l of statusListeners) l(msg.status)
  } else if (msg.kind === 'status-request' && isLeader) {
    channel?.postMessage({ kind: 'status', status } satisfies ChannelMessage)
  }
})

function emitFromLeader(event: LumonEvent) {
  if (event.id > 0) writeLastId(event.id)
  if (event.id > 0 && seen.has(event.id)) return
  channel?.postMessage({ kind: 'event', event } satisfies ChannelMessage)
  dispatch(event)
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(id)
      resolve()
    }, { once: true })
  })

/** Parser mínimo de text/event-stream. */
function createParser(onEvent: (e: LumonEvent) => void) {
  let buffer = ''
  let id = 0
  let type = 'message'
  let data: string[] = []
  return (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + (buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1))
      if (line === '') {
        if (data.length > 0) {
          const raw = data.join('\n')
          let parsed: unknown = raw
          try {
            parsed = JSON.parse(raw)
          } catch {
            // texto plano
          }
          onEvent({ id, type, data: parsed })
        }
        type = 'message'
        data = []
        continue
      }
      if (line.startsWith(':')) continue // comentario / heartbeat
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'id') id = Number(value) || 0
      else if (field === 'event') type = value
      else if (field === 'data') data.push(value)
    }
  }
}

async function connectOnce(signal: AbortSignal): Promise<'retry' | 'superseded'> {
  const { ticket } = await api<{ ticket: string; expiresIn: number }>('/events/tickets', { method: 'POST', signal })
  const params = new URLSearchParams({ ticket })
  const lastId = readLastId()
  if (lastId !== null) params.set('lastEventId', String(lastId))

  const conn = new AbortController()
  const onAbort = () => conn.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const kick = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => conn.abort(), DEAD_AFTER_MS)
  }

  let result: 'retry' | 'superseded' = 'retry'
  try {
    kick()
    // Sin cabeceras propias: es una request simple (sin preflight) y el ticket la autentica.
    const res = await fetch(`${config.apiBaseUrl}/events/stream?${params}`, { signal: conn.signal })
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
      if (body?.error === 'SESSION_REVOKED') endSession('SESSION_REVOKED')
      throw new ApiError(res.status, { error: body?.error ?? `HTTP_${res.status}`, message: body?.message ?? '', details: null }, res.headers)
    }
    setStatus('open')
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    const parse = createParser((event) => {
      if (event.type === 'stream.superseded') {
        result = 'superseded'
        conn.abort()
        return
      }
      emitFromLeader(event)
    })
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      kick()
      parse(value)
    }
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
  } finally {
    clearTimeout(watchdog)
    signal.removeEventListener('abort', onAbort)
  }
  return result
}

async function leaderLoop(signal: AbortSignal) {
  let attempt = 0
  while (!signal.aborted) {
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    try {
      const outcome = await connectOnce(signal)
      if (signal.aborted) break
      // El backend cierra la conexión cada tanto a propósito: se reconecta con un ticket nuevo.
      attempt = outcome === 'superseded' ? attempt + 2 : 0
      setStatus('reconnecting')
      await wait(outcome === 'superseded' ? 5000 : backoffDelay(0, 2000), signal)
    } catch (err) {
      if (signal.aborted) break
      if (err instanceof ApiError && (err.code === 'CLEARANCE_REQUIRED' || err.status === 423)) {
        setStatus('locked')
        await wait(LOCKED_RETRY_MS, signal)
        continue
      }
      if (err instanceof ApiError && err.status === 401 && err.code !== 'TICKET_INVALID') {
        // Sesión terminada: el AuthProvider detiene el stream.
        setStatus('idle')
        return
      }
      setStatus('reconnecting')
      await wait(backoffDelay(attempt++, 30000), signal)
    }
  }
}

/** Inicia el stream (si hay sesión). Idempotente. */
export function startEventStream() {
  if (running) return
  running = true
  abort = new AbortController()
  const signal = abort.signal

  if (typeof navigator === 'undefined' || !navigator.locks) {
    isLeader = true
    void leaderLoop(signal)
    return
  }

  setStatus('follower', false)
  channel?.postMessage({ kind: 'status-request' } satisfies ChannelMessage)
  void navigator.locks
    .request('lumon-events-leader', { mode: 'exclusive', signal }, async () => {
      isLeader = true
      const done = new Promise<void>((resolve) => {
        releaseLeadership = resolve
      })
      void leaderLoop(signal).finally(() => releaseLeadership?.())
      await done
      isLeader = false
    })
    .catch(() => undefined)
}

export function stopEventStream() {
  if (!running) return
  running = false
  abort?.abort()
  abort = null
  releaseLeadership?.()
  releaseLeadership = null
  isLeader = false
  setStatus('idle', false)
}

export function onLumonEvent(type: string, handler: (event: LumonEvent) => void): () => void {
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(handler)
  return () => set.delete(handler)
}

export function onStreamStatus(listener: (status: StreamStatus) => void): () => void {
  statusListeners.add(listener)
  listener(status)
  return () => statusListeners.delete(listener)
}

export function getStreamStatus(): StreamStatus {
  return status
}
