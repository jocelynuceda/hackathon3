/**
 * Piso compartido: WebSocket nativo por pestaña con la grilla abierta.
 *
 * - Ticket nuevo (POST /floor/tickets) en cada conexión.
 * - Latido `ping` cada 15 s; si faltan dos `pong` seguidos la conexión está muerta: se cierra y reconecta.
 * - `seq` crece de uno en uno: ante un salto se pide `resync` y se reconstruye todo desde `snapshot`.
 * - Reconexión según el código de cierre: los definitivos no reconectan y muestran un mensaje.
 * - Cursor: máximo 10 mensajes por segundo y ninguno con la pestaña oculta.
 * - Es un store externo: los cursores que llegan no re-renderizan la grilla, solo la capa de cursores.
 */
import { api, backoffDelay } from '../api/client'
import { ApiError } from '../api/errors'
import { config } from '../config'
import type { Cell } from '../refine/types'

export type FloorStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unavailable'

export interface FloorMember {
  userId: number
  displayName: string
  r: number | null
  c: number | null
}

export interface FloorClaim {
  claimId: string
  userId: number
  displayName: string
  cells: Cell[]
  expiresAt: string
}

export type ClaimResult =
  | { ok: true; claimId: string; cells: Cell[] }
  | { ok: false; reason: 'HELD' | 'NOT_A_GROUP' | 'UNAVAILABLE' | 'TIMEOUT'; holder: { userId: number; displayName: string } | null }

export interface FloorState {
  status: FloorStatus
  /** Mensaje para un cierre definitivo o un problema de conexión. */
  message: string | null
  members: FloorMember[]
  claims: FloorClaim[]
}

type ServerMessage =
  | { type: 'snapshot'; seq: number; members: FloorMember[]; claims: FloorClaim[] }
  | { type: 'member.joined' | 'member.left'; seq: number; userId: number; displayName: string }
  | { type: 'cursor'; userId: number; r: number; c: number }
  | ({ type: 'claim.granted'; seq: number; requestId: string } & FloorClaim)
  | ({ type: 'claim.updated'; seq: number } & FloorClaim)
  | { type: 'claim.released'; seq?: number; claimId: string; userId?: number }
  | { type: 'claim.denied'; requestId: string; reason: 'HELD' | 'NOT_A_GROUP'; holder: { userId: number; displayName: string } | null }
  | { type: 'pong'; t: number }

const PING_EVERY_MS = 15000
const RENEW_EVERY_MS = 8000
const CURSOR_MIN_GAP_MS = 100
const CLAIM_TIMEOUT_MS = 8000

const FINAL_CLOSES: Record<number, string> = {
  4400: 'El piso rechazó un mensaje de la app.',
  4403: 'Sin acceso al piso compartido (origen o permiso).',
  4404: 'El archivo no existe en el piso.',
  4423: 'El Piso de Pruebas aún no está abierto: el piso compartido no está disponible.',
}

export class FloorClient {
  private readonly fileId: number
  private ws: WebSocket | null = null
  private state: FloorState = { status: 'connecting', message: null, members: [], claims: [] }
  private listeners = new Set<() => void>()
  private seq: number | null = null
  private attempt = 0
  private ticketFailures = 0
  private stopped = false
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private renewTimer: ReturnType<typeof setInterval> | undefined
  private missedPongs = 0
  private lastCursorAt = 0
  private pendingCursor: Cell | null = null
  private cursorTimer: ReturnType<typeof setTimeout> | undefined
  private requestCounter = 0
  private pendingClaims = new Map<string, { resolve: (r: ClaimResult) => void; timer: ReturnType<typeof setTimeout> }>()
  /** La reserva propia de esta conexión (como máximo una). */
  private myClaimId: string | null = null

  constructor(fileId: number) {
    this.fileId = fileId
    void this.connect()
  }

  getState = (): FloorState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<FloorState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private async connect() {
    if (this.stopped) return
    this.set({ status: this.attempt === 0 ? 'connecting' : 'reconnecting' })
    let ticket: string
    try {
      ticket = (await api<{ ticket: string }>('/floor/tickets', { method: 'POST', body: { fileId: this.fileId } })).ticket
    } catch (err) {
      if (this.stopped) return
      if (err instanceof ApiError && (err.status === 423 || err.status === 403 || err.status === 404)) {
        this.set({ status: 'unavailable', message: err.status === 423 ? FINAL_CLOSES[4423] : err.message })
        return
      }
      this.scheduleReconnect()
      return
    }
    if (this.stopped) return

    const ws = new WebSocket(`${config.wsBaseUrl}/floor/ws?ticket=${encodeURIComponent(ticket)}`)
    this.ws = ws
    ws.onopen = () => {
      this.missedPongs = 0
      this.ticketFailures = 0
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS)
    }
    ws.onmessage = (e: MessageEvent<string>) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(e.data) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = (e: CloseEvent) => this.onClose(ws, e)
  }

  private onClose(ws: WebSocket, e: CloseEvent) {
    if (this.ws !== ws) return
    this.ws = null
    clearInterval(this.pingTimer)
    this.stopRenew()
    this.myClaimId = null
    this.seq = null
    for (const [, p] of this.pendingClaims) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, reason: 'UNAVAILABLE', holder: null })
    }
    this.pendingClaims.clear()
    // Sin conexión no hay cursores ni reservas fiables: se limpian para no dejar fantasmas.
    this.set({ members: [], claims: [] })
    if (this.stopped) return

    const final = FINAL_CLOSES[e.code]
    if (final) {
      this.set({ status: 'closed', message: final })
      return
    }
    if (e.code === 4401) {
      // Ticket inválido o usado: uno nuevo; si vuelve a fallar, no insistir.
      if (++this.ticketFailures >= 2) {
        this.set({ status: 'closed', message: 'No se pudo autenticar en el piso compartido.' })
        return
      }
      void this.connect()
      return
    }
    if (e.code === 4429) {
      this.scheduleReconnect(10000)
      return
    }
    // 4408 (sin ping), 1006, 1012 (reinicio) u otros: ticket nuevo y espera creciente.
    this.scheduleReconnect()
  }

  private scheduleReconnect(minDelay = 0) {
    if (this.stopped) return
    this.set({ status: 'reconnecting', message: null })
    const delay = Math.max(minDelay, backoffDelay(this.attempt++, 20000))
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }

  private send(msg: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  private ping() {
    if (this.missedPongs >= 2) {
      // Dos pong sin llegar: conexión muerta.
      this.ws?.close(4000, 'DEAD')
      if (this.ws) this.onClose(this.ws, new CloseEvent('close', { code: 1006 }))
      return
    }
    this.missedPongs++
    this.send({ type: 'ping', t: Date.now() })
  }

  private checkSeq(seq: number | undefined): boolean {
    if (seq === undefined) return true
    if (this.seq !== null && seq !== this.seq + 1) {
      this.send({ type: 'resync' })
      return false
    }
    this.seq = seq
    return true
  }

  private handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': {
        this.seq = msg.seq
        this.attempt = 0
        const members = dedupeMembers(msg.members)
        this.set({ status: 'open', message: null, members, claims: msg.claims })
        return
      }
      case 'pong':
        this.missedPongs = 0
        return
      case 'cursor': {
        const members = this.state.members.map((m) => (m.userId === msg.userId ? { ...m, r: msg.r, c: msg.c } : m))
        this.set({ members })
        return
      }
      case 'claim.denied': {
        const p = this.pendingClaims.get(String(msg.requestId))
        if (p) {
          clearTimeout(p.timer)
          this.pendingClaims.delete(String(msg.requestId))
          p.resolve({ ok: false, reason: msg.reason, holder: msg.holder })
        }
        return
      }
      default:
        break
    }

    if (!this.checkSeq(msg.seq)) return

    switch (msg.type) {
      case 'member.joined':
        this.set({
          members: dedupeMembers([...this.state.members, { userId: msg.userId, displayName: msg.displayName, r: null, c: null }]),
        })
        break
      case 'member.left':
        this.set({ members: this.state.members.filter((m) => m.userId !== msg.userId) })
        break
      case 'claim.granted': {
        this.myClaimId = msg.claimId
        this.upsertClaim(msg)
        this.startRenew()
        const p = this.pendingClaims.get(String(msg.requestId))
        if (p) {
          clearTimeout(p.timer)
          this.pendingClaims.delete(String(msg.requestId))
          p.resolve({ ok: true, claimId: msg.claimId, cells: msg.cells })
        }
        break
      }
      case 'claim.updated':
        this.upsertClaim(msg)
        break
      case 'claim.released':
        if (msg.claimId === this.myClaimId) {
          this.myClaimId = null
          this.stopRenew()
        }
        this.set({ claims: this.state.claims.filter((c) => c.claimId !== msg.claimId) })
        break
    }
  }

  private upsertClaim(claim: FloorClaim) {
    const { claimId, userId, displayName, cells, expiresAt } = claim
    const others = this.state.claims.filter((c) => c.claimId !== claimId)
    this.set({ claims: [...others, { claimId, userId, displayName, cells, expiresAt }] })
  }

  private startRenew() {
    this.stopRenew()
    this.renewTimer = setInterval(() => {
      if (this.myClaimId) this.send({ type: 'renew', claimId: this.myClaimId })
    }, RENEW_EVERY_MS)
  }

  private stopRenew() {
    clearInterval(this.renewTimer)
  }

  /** Reserva el grupo de esa celda. Cada conexión tiene una sola reserva: pedir otra libera la anterior. */
  claim(cell: Cell): Promise<ClaimResult> {
    const requestId = `c-${++this.requestCounter}`
    return new Promise((resolve) => {
      if (!this.send({ type: 'claim', requestId, r: cell.r, c: cell.c })) {
        resolve({ ok: false, reason: 'UNAVAILABLE', holder: null })
        return
      }
      const timer = setTimeout(() => {
        this.pendingClaims.delete(requestId)
        resolve({ ok: false, reason: 'TIMEOUT', holder: null })
      }, CLAIM_TIMEOUT_MS)
      this.pendingClaims.set(requestId, { resolve, timer })
    })
  }

  release() {
    if (!this.myClaimId) return
    this.send({ type: 'release', claimId: this.myClaimId })
    this.myClaimId = null
    this.stopRenew()
  }

  /** La reserva quedó liberada por el servidor al refinar: se olvida localmente. */
  forgetClaim() {
    if (!this.myClaimId) return
    const id = this.myClaimId
    this.myClaimId = null
    this.stopRenew()
    this.set({ claims: this.state.claims.filter((c) => c.claimId !== id) })
  }

  get ownClaimId(): string | null {
    return this.myClaimId
  }

  /** Mueve el cursor: como mucho 10 por segundo y nada si la pestaña está oculta. */
  moveCursor(cell: Cell) {
    if (document.hidden) return
    this.pendingCursor = cell
    const wait = CURSOR_MIN_GAP_MS - (Date.now() - this.lastCursorAt)
    if (wait <= 0) this.flushCursor()
    else if (this.cursorTimer === undefined) this.cursorTimer = setTimeout(() => this.flushCursor(), wait)
  }

  private flushCursor() {
    this.cursorTimer = undefined
    if (!this.pendingCursor || document.hidden) return
    if (this.send({ type: 'cursor', r: this.pendingCursor.r, c: this.pendingCursor.c })) this.lastCursorAt = Date.now()
    this.pendingCursor = null
  }

  close() {
    this.stopped = true
    this.release()
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.cursorTimer)
    clearInterval(this.pingTimer)
    this.stopRenew()
    const ws = this.ws
    this.ws = null
    ws?.close(1000, 'LEAVE')
    this.listeners.clear()
  }
}

function dedupeMembers(members: FloorMember[]): FloorMember[] {
  const byId = new Map<number, FloorMember>()
  for (const m of members) byId.set(m.userId, { ...byId.get(m.userId), ...m })
  return [...byId.values()]
}
