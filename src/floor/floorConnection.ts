import { api, backoffDelay } from '../api/client'
import { ApiError, errorMessage } from '../api/errors'
import { config } from '../config'
import type { Cell } from '../refine/types'

export interface Member {
  userId: number
  displayName: string
  r: number | null
  c: number | null
}

export interface Claim {
  claimId: string
  userId: number
  displayName: string
  cells: Cell[]
  expiresAt: string
}

type ServerMessage =
  | { type: 'snapshot'; seq: number; members: Member[]; claims: Claim[] }
  | { type: 'member.joined'; seq: number; userId: number; displayName: string }
  | { type: 'member.left'; seq: number; userId: number }
  | ({ type: 'cursor'; userId: number } & Cell)
  | ({ type: 'claim.granted'; seq: number; requestId: string } & Claim)
  | { type: 'claim.denied'; requestId: string; reason: 'HELD' | 'NOT_A_GROUP'; holder: Pick<Member, 'userId' | 'displayName'> | null }
  | ({ type: 'claim.updated'; seq: number } & Claim)
  | { type: 'claim.released'; seq?: number; claimId: string }
  | { type: 'pong'; t: number }

type ClientMessage =
  | ({ type: 'cursor' } & Cell)
  | ({ type: 'claim'; requestId: string } & Cell)
  | { type: 'renew' | 'release'; claimId: string }
  | { type: 'ping'; t: number }
  | { type: 'resync' }

export type Reservation =
  | { kind: 'reserved' | 'offline' | 'cancelled' }
  | { kind: 'blocked'; message: string }

interface PendingClaim {
  id: string
  cell: Cell
  promise: Promise<Reservation>
  finish: (value: Reservation) => void
  timer: ReturnType<typeof setTimeout>
}

interface FloorState {
  status: 'connecting' | 'connected' | 'syncing' | 'reconnecting' | 'unavailable'
  message: string
  claims: readonly Claim[]
}

const sameCell = (left: Cell, right: Cell) => left.r === right.r && left.c === right.c
const terminalMessages: Record<number, string> = {
  4400: 'Lumon rechazó un mensaje del piso.',
  4403: 'El origen o la cuenta no tiene permiso para conectarse al piso.',
  4404: 'El archivo ya no está disponible en el piso.',
  4423: 'El Piso de Pruebas sigue cerrado.',
}

export class FloorConnection {
  private readonly fileId: number
  private state: FloorState = { status: 'connecting', message: 'Conectando con el piso…', claims: [] }
  private members: readonly Member[] = []
  private listeners = new Set<() => void>()
  private presenceListeners = new Set<() => void>()
  private socket: WebSocket | undefined
  private ticketAbort: AbortController | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private renewal: ReturnType<typeof setInterval> | undefined
  private active = false
  private failures = 0
  private retriedTicket = false
  private seq: number | null = null
  private pings = new Set<number>()
  private ownClaim: Claim | undefined
  private pending: PendingClaim | undefined
  private lastCursorAt = -Infinity
  private lastCursor: Cell | undefined

  constructor(fileId: number) {
    this.fileId = fileId
  }

  getState = () => this.state
  getMembers = () => this.members

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  subscribePresence = (listener: () => void) => {
    this.presenceListeners.add(listener)
    return () => { this.presenceListeners.delete(listener) }
  }

  private update(state: FloorState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  private updateMembers(members: readonly Member[]) {
    this.members = members
    for (const listener of this.presenceListeners) listener()
  }

  start() {
    if (this.active) return
    if (typeof WebSocket === 'undefined') {
      this.unavailable('Este navegador no permite la conexión al piso.')
      return
    }
    this.active = true
    this.failures = 0
    this.retriedTicket = false
    void this.connect()
  }

  stop() {
    this.active = false
    this.ticketAbort?.abort()
    clearTimeout(this.retryTimer)
    this.release()
    const socket = this.socket
    this.disconnect()
    socket?.close(1000)
  }

  private async connect() {
    const controller = new AbortController()
    this.ticketAbort = controller
    try {
      const { ticket } = await api<{ ticket: string }>('/floor/tickets', {
        method: 'POST',
        body: { fileId: this.fileId },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      })
      if (!this.active || controller.signal.aborted) return
      const socket = new WebSocket(`${config.wsBaseUrl.replace(/\/$/, '')}/floor/ws?ticket=${encodeURIComponent(ticket)}`)
      this.socket = socket
      this.snapshotTimer = setTimeout(() => socket.close(4000), 10_000)
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return
        this.ping()
        this.heartbeat = setInterval(() => this.ping(), 15_000)
      })
      socket.addEventListener('message', (event) => {
        if (this.socket !== socket || typeof event.data !== 'string') return
        let message: ServerMessage
        try {
          message = JSON.parse(event.data) as ServerMessage
        } catch {
          return
        }
        if (message && typeof message === 'object') this.receive(message)
      })
      socket.addEventListener('close', (event) => {
        if (this.socket !== socket) return
        this.disconnect()
        this.handleClose(event.code)
      })
    } catch (error) {
      if (controller.signal.aborted || !this.active) return
      if (error instanceof ApiError && [400, 401, 403, 404, 423].includes(error.status)) {
        this.unavailable(error.status === 423 ? terminalMessages[4423] : errorMessage(error))
      } else {
        const wait = error instanceof ApiError ? (error.retryAfter ?? 0) * 1000 : 0
        this.retry(wait)
      }
    } finally {
      if (this.ticketAbort === controller) this.ticketAbort = undefined
    }
  }

  private disconnect() {
    this.socket = undefined
    clearTimeout(this.snapshotTimer)
    clearInterval(this.heartbeat)
    this.pings.clear()
    this.seq = null
    this.lastCursor = undefined
    this.lastCursorAt = -Infinity
    this.clearOwnClaim()
    this.finishPending({ kind: this.active ? 'offline' : 'cancelled' })
    this.updateMembers([])
  }

  private handleClose(code: number) {
    if (terminalMessages[code]) {
      this.unavailable(terminalMessages[code])
    } else if (code === 4401) {
      if (this.retriedTicket) this.unavailable('Lumon rechazó el nuevo ticket del piso.')
      else {
        this.retriedTicket = true
        this.retry(0, true)
      }
    } else if (code === 4408) {
      this.retry(0, true)
    } else {
      this.retry(code === 4429 ? 10_000 : 0)
    }
  }

  private unavailable(message: string) {
    this.update({ status: 'unavailable', message: `${message} Puedes seguir refinando.`, claims: [] })
  }

  private retry(minimum: number, immediate = false) {
    if (!this.active) return
    const wait = immediate ? minimum : Math.max(minimum, backoffDelay(this.failures++))
    this.update({ status: 'reconnecting', message: 'Reconectando con el piso… Puedes seguir refinando.', claims: [] })
    this.retryTimer = setTimeout(() => void this.connect(), wait)
  }

  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  private ping() {
    if (this.pings.size >= 2) {
      this.socket?.close(4000)
      return
    }
    const t = Date.now()
    if (this.send({ type: 'ping', t })) this.pings.add(t)
  }

  private receive(message: ServerMessage) {
    if (message.type === 'pong') {
      if (this.pings.has(message.t)) {
        for (const time of this.pings) if (time <= message.t) this.pings.delete(time)
      }
      return
    }
    if (message.type === 'snapshot') {
      if (!Number.isSafeInteger(message.seq) || !Array.isArray(message.members) || !Array.isArray(message.claims)) return
      clearTimeout(this.snapshotTimer)
      this.seq = message.seq
      this.failures = 0
      this.retriedTicket = false
      this.updateMembers([...new Map(message.members.map((member) => [member.userId, member])).values()])
      this.update({ status: 'connected', message: 'Piso conectado', claims: message.claims })
      return
    }
    if ('seq' in message && message.seq !== undefined) {
      if (this.seq === null || message.seq <= this.seq) {
        if (this.seq === null && message.type === 'claim.granted') this.send({ type: 'release', claimId: message.claimId })
        return
      }
      if (message.seq !== this.seq + 1) {
        this.resync()
        if (message.type === 'claim.granted') this.send({ type: 'release', claimId: message.claimId })
        return
      }
      this.seq = message.seq
    }
    if (this.seq === null) return

    switch (message.type) {
      case 'member.joined':
        if (!this.members.some((member) => member.userId === message.userId)) {
          this.updateMembers([...this.members, { userId: message.userId, displayName: message.displayName, r: null, c: null }])
        }
        break
      case 'member.left':
        this.updateMembers(this.members.filter((member) => member.userId !== message.userId))
        break
      case 'cursor':
        if (this.members.some((member) => member.userId === message.userId && (member.r !== message.r || member.c !== message.c))) {
          this.updateMembers(this.members.map((member) => member.userId === message.userId ? { ...member, r: message.r, c: message.c } : member))
        }
        break
      case 'claim.granted':
        this.updateClaim(message)
        if (message.requestId === this.pending?.id) {
          this.ownClaim = message
          this.renewal = setInterval(() => this.send({ type: 'renew', claimId: message.claimId }), 7_000)
          this.finishPending({ kind: 'reserved' })
        } else {
          this.send({ type: 'release', claimId: message.claimId })
        }
        break
      case 'claim.updated':
        this.updateClaim(message)
        break
      case 'claim.released':
        if (message.claimId === this.ownClaim?.claimId) this.clearOwnClaim()
        if (this.state.claims.some((claim) => claim.claimId === message.claimId)) {
          this.update({ ...this.state, claims: this.state.claims.filter((claim) => claim.claimId !== message.claimId) })
        }
        break
      case 'claim.denied':
        if (message.requestId === this.pending?.id) {
          this.finishPending({
            kind: 'blocked',
            message: message.reason === 'HELD'
              ? `Grupo reservado por ${message.holder?.displayName ?? 'otro refinador'}. Elige otro o espera a que se libere.`
              : 'El grupo ya no está disponible para reservar. Vuelve a seleccionarlo.',
          })
        }
    }
  }

  private resync() {
    this.seq = null
    this.release()
    this.updateMembers([])
    this.update({ status: 'syncing', message: 'Sincronizando el piso…', claims: [] })
    this.send({ type: 'resync' })
    clearTimeout(this.snapshotTimer)
    this.snapshotTimer = setTimeout(() => this.socket?.close(4000), 6_000)
  }

  private updateClaim(claim: Claim) {
    this.update({ ...this.state, claims: [...this.state.claims.filter((item) => item.claimId !== claim.claimId), claim] })
  }

  private finishPending(result: Reservation) {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    clearTimeout(pending.timer)
    pending.finish(result)
  }

  private clearOwnClaim() {
    clearInterval(this.renewal)
    this.ownClaim = undefined
  }

  release() {
    this.finishPending({ kind: 'cancelled' })
    const claim = this.ownClaim
    this.clearOwnClaim()
    if (claim) this.send({ type: 'release', claimId: claim.claimId })
  }

  reserve(cell: Cell): Promise<Reservation> {
    if (this.state.status === 'syncing') {
      return Promise.resolve({ kind: 'blocked', message: 'Espera a que el piso se sincronice e inténtalo de nuevo.' })
    }
    if (!this.active || this.state.status !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ kind: 'offline' })
    }
    if (this.ownClaim?.cells.some((item) => sameCell(item, cell))) return Promise.resolve({ kind: 'reserved' })
    if (this.pending && sameCell(this.pending.cell, cell)) return this.pending.promise
    this.release()
    const id = crypto.randomUUID()
    let finish!: PendingClaim['finish']
    const promise = new Promise<Reservation>((resolve) => { finish = resolve })
    const timer = setTimeout(() => this.finishPending({
      kind: 'blocked', message: 'Lumon no confirmó la reserva. Intenta de nuevo.',
    }), 5_000)
    this.pending = { id, cell, promise, finish, timer }
    this.send({ type: 'claim', requestId: id, ...cell })
    return promise
  }

  cursor(cell: Cell) {
    if (this.state.status !== 'connected' || document.hidden) return
    const now = performance.now()
    if (now - this.lastCursorAt < 100 || (this.lastCursor && sameCell(this.lastCursor, cell))) return
    if (this.send({ type: 'cursor', ...cell })) {
      this.lastCursorAt = now
      this.lastCursor = cell
    }
  }
}
