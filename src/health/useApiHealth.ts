import { useCallback, useEffect, useState } from 'react'
import { config } from '../config'

export type ApiHealth =
  | { phase: 'connecting' }
  | { phase: 'waiting'; retryAt: number }
  | { phase: 'up' }

interface ProbeResult {
  ok: boolean
  retryAfterMs: number
}

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
// La primera request puede tardar varios segundos si el servicio estaba dormido.
const PROBE_TIMEOUT_MS = 10_000

function isHealthy(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
}

function parseRetryAfterMs(header: string | null): number {
  const seconds = Number(header)
  return header !== null && Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0
}

async function probe(signal: AbortSignal): Promise<ProbeResult> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/meta/health`, {
      headers: { 'X-Lumon-Build': config.build },
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    })
    if (!response.ok) {
      return { ok: false, retryAfterMs: parseRetryAfterMs(response.headers.get('Retry-After')) }
    }
    const body: unknown = await response.json()
    return { ok: isHealthy(body), retryAfterMs: 0 }
  } catch {
    return { ok: false, retryAfterMs: 0 }
  }
}

function backoffMs(failures: number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures)
  return ceiling * (0.8 + Math.random() * 0.2)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

async function connect(signal: AbortSignal, onChange: (health: ApiHealth) => void) {
  for (let failures = 0; !signal.aborted; failures += 1) {
    onChange({ phase: 'connecting' })
    const result = await probe(signal)
    if (signal.aborted) return
    if (result.ok) {
      onChange({ phase: 'up' })
      return
    }
    const delay = Math.max(backoffMs(failures), result.retryAfterMs)
    onChange({ phase: 'waiting', retryAt: Date.now() + delay })
    await sleep(delay, signal)
  }
}

export function useApiHealth() {
  const [health, setHealth] = useState<ApiHealth>({ phase: 'connecting' })
  const [run, setRun] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void connect(controller.signal, setHealth)
    return () => controller.abort()
  }, [run])

  const retryNow = useCallback(() => setRun((current) => current + 1), [])

  return { health, retryNow }
}
