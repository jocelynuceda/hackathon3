/**
 * contingency.activated dirigido al usuario actual: modal que interrumpe en TODAS las pestañas
 * (el stream compartido reparte el evento a cada una), con el foco atrapado y anunciado a lectores
 * de pantalla. Solo se cierra al confirmar con POST /contingency/{id}/ack; si falla, sigue abierto
 * con el error. contingency.resolved (confirmado desde otra pestaña) lo cierra en todas.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { api } from '../api/client'
import { errorMessage } from '../api/errors'
import { useAuth } from '../auth/AuthContext'
import { useLumonEvent } from './hooks'

interface Contingency {
  id: number | string
  userId: number
  message?: string
  createdAt?: string
}

export function ContingencyModal() {
  const { me } = useAuth()
  const [active, setActive] = useState<Contingency | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useLumonEvent('contingency.activated', (e) => {
    const data = e.data as Contingency
    if (me && data.userId === me.id) {
      setError(null)
      setActive(data)
    }
  })
  useLumonEvent('contingency.resolved', (e) => {
    const data = e.data as { id: number | string }
    setActive((cur) => (cur && String(cur.id) === String(data.id) ? null : cur))
  })

  useEffect(() => {
    if (!active) return
    previousFocus.current = document.activeElement as HTMLElement | null
    buttonRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [active])

  if (!active) return null

  async function ack() {
    if (!active || sending) return
    setSending(true)
    setError(null)
    try {
      await api<void>(`/contingency/${encodeURIComponent(String(active.id))}/ack`, { method: 'POST' })
      setActive(null)
    } catch (err) {
      setError(`No se pudo confirmar: ${errorMessage(err)} Vuelve a intentarlo.`)
    } finally {
      setSending(false)
    }
  }

  // Foco atrapado: Tab y Shift+Tab ciclan dentro del modal; Escape no lo cierra.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      return
    }
    if (e.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contingency-title"
        aria-describedby="contingency-desc"
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-rose-400 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 id="contingency-title" className="text-xl font-semibold text-rose-200">
          Protocolo de contingencia de horas extra
        </h2>
        <p id="contingency-desc" className="mt-3 text-slate-200">
          {active.message ?? 'Se activó una contingencia para ti. Confírmala para continuar.'}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => void ack()}
          disabled={sending}
          className="mt-5 w-full rounded bg-rose-300 px-4 py-2 font-medium text-slate-950 hover:bg-rose-200 disabled:opacity-60"
        >
          {sending ? 'Confirmando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}
