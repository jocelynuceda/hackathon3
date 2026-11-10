/**
 * Carga de bloques de la grilla.
 *
 * - Caché por archivo: un bloque ya cargado no se vuelve a pedir (salvo invalidate()).
 * - Nunca dos requests en vuelo para el mismo bloque: las llamadas repetidas comparten la promesa.
 * - Cancelación: setWanted() aborta las requests de bloques que salieron de la vista.
 * - 429: se pausa TODA carga de bloques hasta que pase Retry-After (el límite es por sesión).
 * - 503 / red: reintento con espera creciente, respetando Retry-After.
 * - Limitador propio (36 cada 10 s, el backend permite 40) para no llegar al 429.
 */
import { apiRequest, backoffDelay, sleep as abortableSleep } from '../api/client'
import { ApiError, NetworkError, isAbortError } from '../api/errors'
import type { Bin, TileResponse } from '../api/types'

export interface Tile {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  /** Dígito 0-9 por celda, por filas. */
  values: Uint8Array
  /** Temblor 0-100 por celda (decodificado de base64). */
  tremor: Uint8Array
  /** "." sin refinar, o W/F/D/M. */
  bins: string[]
  version: number
}

export const BIN_CHAR: Record<Bin, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' }

type Listener = (tile: Tile) => void

const RATE_WINDOW_MS = 10000
const RATE_MAX = 36
const MAX_CONCURRENT = 6
const MAX_503_ATTEMPTS = 6

// El límite y la pausa por 429 son por sesión, así que se comparten entre archivos.
let pausedUntil = 0
const sentAt: number[] = []

export const tileKey = (tileRow: number, tileCol: number) => `${tileRow}:${tileCol}`

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function decodeTile(t: TileResponse): Tile {
  const values = new Uint8Array(t.values.length)
  for (let i = 0; i < t.values.length; i++) values[i] = t.values.charCodeAt(i) - 48
  return {
    tileRow: t.tileRow,
    tileCol: t.tileCol,
    originRow: t.originRow,
    originCol: t.originCol,
    rows: t.rows,
    cols: t.cols,
    values,
    tremor: decodeBase64(t.tremor),
    bins: t.bins.split(''),
    version: t.version,
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Pending {
  tileRow: number
  tileCol: number
  controller: AbortController
  promise: Promise<Tile>
}

export class TileLoader {
  readonly fileId: number
  private cache = new Map<string, Tile>()
  private inflight = new Map<string, Pending>()
  private wanted: Set<string> | null = null
  private listeners = new Set<Listener>()
  private active = 0
  private slotWaiters: Array<() => void> = []
  private disposed = false

  constructor(fileId: number) {
    this.fileId = fileId
  }

  get(tileRow: number, tileCol: number): Tile | undefined {
    return this.cache.get(tileKey(tileRow, tileCol))
  }

  isLoading(tileRow: number, tileCol: number): boolean {
    return this.inflight.has(tileKey(tileRow, tileCol))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Pide un bloque (desde caché si ya está). Llamadas repetidas comparten la misma request. */
  load(tileRow: number, tileCol: number): Promise<Tile> {
    const key = tileKey(tileRow, tileCol)
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)
    const pending = this.inflight.get(key)
    if (pending) return pending.promise

    const controller = new AbortController()
    const promise = this.fetchWithRetry(tileRow, tileCol, controller.signal).finally(() => {
      if (this.inflight.get(key)?.controller === controller) this.inflight.delete(key)
    })
    this.inflight.set(key, { tileRow, tileCol, controller, promise })
    promise.catch(() => undefined) // evitar "unhandled rejection" si nadie espera
    return promise
  }

  /**
   * Indica qué bloques se necesitan ahora (los visibles + margen): los pide y cancela las
   * requests en vuelo de bloques que ya no hacen falta.
   */
  setWanted(keys: Array<[number, number]>) {
    this.wanted = new Set(keys.map(([r, c]) => tileKey(r, c)))
    for (const [key, p] of this.inflight) {
      if (!this.wanted.has(key)) {
        p.controller.abort()
        this.inflight.delete(key)
      }
    }
    for (const [r, c] of keys) void this.load(r, c).catch(() => undefined)
  }

  /** Olvida bloques (por ejemplo tras un 409) para volver a pedirlos. */
  invalidate(keys: Array<[number, number]>) {
    for (const [r, c] of keys) {
      const key = tileKey(r, c)
      this.cache.delete(key)
      this.inflight.get(key)?.controller.abort()
      this.inflight.delete(key)
    }
    for (const [r, c] of keys) void this.load(r, c).catch(() => undefined)
  }

  /** Marca celdas como refinadas sin volver a pedir la grilla. */
  applyBins(cells: Array<{ r: number; c: number }>, bin: Bin) {
    const ch = BIN_CHAR[bin]
    const touched = new Map<string, Tile>()
    for (const { r, c } of cells) {
      for (const tile of this.cache.values()) {
        if (r >= tile.originRow && r < tile.originRow + tile.rows && c >= tile.originCol && c < tile.originCol + tile.cols) {
          const idx = (r - tile.originRow) * tile.cols + (c - tile.originCol)
          if (tile.bins[idx] !== ch) {
            const copy = touched.get(tileKey(tile.tileRow, tile.tileCol)) ?? { ...tile, bins: [...tile.bins] }
            copy.bins[idx] = ch
            touched.set(tileKey(tile.tileRow, tile.tileCol), copy)
          }
          break
        }
      }
    }
    for (const [key, tile] of touched) {
      this.cache.set(key, tile)
      this.notify(tile)
    }
  }

  dispose() {
    this.disposed = true
    for (const p of this.inflight.values()) p.controller.abort()
    this.inflight.clear()
    this.listeners.clear()
  }

  private notify(tile: Tile) {
    for (const l of this.listeners) l(tile)
  }

  private async acquireSlot(signal: AbortSignal) {
    while (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve))
      if (signal.aborted) {
        this.slotWaiters.shift()?.() // ceder el turno al siguiente
        throw new DOMException('Aborted', 'AbortError')
      }
    }
    this.active++
  }

  private releaseSlot() {
    this.active--
    this.slotWaiters.shift()?.()
  }

  /** Espera la pausa por 429 y el limitador propio antes de mandar la request. */
  private async waitForBudget(signal: AbortSignal) {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const now = Date.now()
      if (now < pausedUntil) {
        await sleep(pausedUntil - now + 50)
        continue
      }
      while (sentAt.length > 0 && now - sentAt[0] > RATE_WINDOW_MS) sentAt.shift()
      if (sentAt.length >= RATE_MAX) {
        await sleep(RATE_WINDOW_MS - (now - sentAt[0]) + 50)
        continue
      }
      sentAt.push(now)
      return
    }
  }

  private async fetchWithRetry(tileRow: number, tileCol: number, signal: AbortSignal): Promise<Tile> {
    let attempt503 = 0
    for (;;) {
      let retryDelay = 0
      await this.acquireSlot(signal)
      try {
        await this.waitForBudget(signal)
        const { data } = await apiRequest<TileResponse>(`/files/${this.fileId}/tiles/${tileRow}/${tileCol}`, { signal })
        const tile = decodeTile(data)
        if (!this.disposed) {
          this.cache.set(tileKey(tileRow, tileCol), tile)
          this.notify(tile)
        }
        return tile
      } catch (err) {
        if (isAbortError(err) || signal.aborted) throw err
        if (err instanceof ApiError && err.status === 429) {
          // Mientras dure la espera, cualquier bloque también daría 429: se pausa todo.
          pausedUntil = Math.max(pausedUntil, Date.now() + (err.retryAfter ?? 2) * 1000)
          continue
        }
        const retriable = (err instanceof ApiError && err.status === 503) || err instanceof NetworkError
        if (!retriable || attempt503 >= MAX_503_ATTEMPTS) throw err
        retryDelay = Math.max(err instanceof ApiError && err.retryAfter !== null ? err.retryAfter * 1000 : 0, backoffDelay(attempt503++))
      } finally {
        this.releaseSlot()
      }
      // La espera del 503 se hace sin ocupar un turno de concurrencia, y se cancela si el bloque sale de vista.
      await abortableSleep(retryDelay, signal)
    }
  }
}
