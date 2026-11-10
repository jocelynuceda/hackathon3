import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { errorMessage } from '../api/errors'
import type { Check, ClearanceResult, IntegrationStatus } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { config } from '../config'
import { StreamIndicator } from '../events/StreamIndicator'

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm">
      {checks.map((c) => (
        <li key={c.name} className="flex gap-2">
          <span aria-hidden="true">{c.passed ? '✅' : '❌'}</span>
          <span>
            <span className="font-mono">{c.name}</span> <span className="sr-only">{c.passed ? 'aprobada' : 'falla'}</span>
            <span className="text-slate-400"> · {c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function EstadoPage() {
  const { me, reloadMe } = useAuth()
  const [health, setHealth] = useState<'ok' | 'down' | 'checking'>('checking')
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null)
  const [clearance, setClearance] = useState<ClearanceResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [chaos, setChaos] = useState<number | null>(null)
  const [chaosMsg, setChaosMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    api('/meta/health', { auth: false })
      .then(() => setHealth('ok'))
      .catch(() => setHealth('down'))
    try {
      const [i, c] = await Promise.all([api<IntegrationStatus>('/integrations/status'), api<ClearanceResult>('/clearance')])
      setIntegrations(i)
      setClearance(c)
      if (c.workspace) setChaos(c.workspace.chaosLevel)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runCheck() {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      const res = await api<ClearanceResult>('/clearance/check', { method: 'POST' })
      setClearance((prev) => ({ ...prev, ...res }))
      if (res.granted) await reloadMe()
    } catch (err) {
      setCheckError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  async function changeChaos(level: number) {
    setChaosMsg(null)
    try {
      await api('/workspace/chaos', { method: 'PUT', body: { level } })
      setChaos(level)
      setChaosMsg(`Modo caos en nivel ${level}.`)
    } catch (err) {
      setChaosMsg(errorMessage(err))
    }
  }

  const granted = clearance?.granted ?? me?.clearance.granted ?? false

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Estado</h1>

      <section className="mt-4 rounded border border-slate-700 p-4" aria-labelledby="estado-app">
        <h2 id="estado-app" className="font-semibold">App</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-400">Build desplegado</dt>
          <dd className="font-mono">{config.build}</dd>
          <dt className="text-slate-400">API</dt>
          <dd>{health === 'checking' ? 'Comprobando…' : health === 'ok' ? 'Responde' : 'No responde'}</dd>
          <dt className="text-slate-400">Equipo</dt>
          <dd>{me ? `${me.team.code} · ${me.team.name}` : '—'}</dd>
          <dt className="text-slate-400">Eventos</dt>
          <dd><StreamIndicator /></dd>
        </dl>
      </section>

      {loadError && (
        <p role="alert" className="mt-4 text-rose-300">
          No se pudo cargar el estado: {loadError}{' '}
          <button type="button" className="underline" onClick={() => void load()}>Reintentar</button>
        </p>
      )}

      <section className="mt-4 rounded border border-slate-700 p-4" aria-labelledby="estado-int">
        <h2 id="estado-int" className="font-semibold">Integraciones</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-400">Dominio</dt>
          <dd>
            {integrations?.deploy?.verifiedAt ? `Verificado · ${integrations.deploy.origin}` : 'Sin verificar'}
          </dd>
          <dt className="text-slate-400">Último build visto</dt>
          <dd className="font-mono">{integrations?.deploy?.lastBuildSeen ?? '—'}</dd>
          <dt className="text-slate-400">Storage</dt>
          <dd>
            {integrations?.storage?.verifiedAt ? `Verificado · ${integrations.storage.provider}` : 'Sin verificar'}
          </dd>
        </dl>
      </section>

      <section className="mt-4 rounded border border-slate-700 p-4" aria-labelledby="estado-clear">
        <h2 id="estado-clear" className="font-semibold">Piso de Pruebas</h2>
        <p className="mt-1 text-sm">{granted ? 'Abierto ✅' : 'Cerrado: se abre con la revisión automática.'}</p>
        {clearance && clearance.checks.length > 0 && <Checks checks={clearance.checks} />}
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking}
          className="mt-3 rounded bg-teal-400 px-4 py-2 font-medium text-slate-950 hover:bg-teal-300 disabled:opacity-60"
        >
          {checking ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
        </button>
        {checkError && (
          <p role="alert" className="mt-2 text-sm text-rose-300">{checkError}</p>
        )}
      </section>

      <section className="mt-4 rounded border border-slate-700 p-4" aria-labelledby="estado-chaos">
        <h2 id="estado-chaos" className="font-semibold">Modo caos (para probar)</h2>
        <div className="mt-2 flex gap-2" role="group" aria-label="Nivel de caos">
          {[0, 1, 2].map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={chaos === level}
              onClick={() => void changeChaos(level)}
              className="rounded border border-slate-600 px-3 py-1 aria-pressed:bg-teal-400 aria-pressed:text-slate-950"
            >
              Nivel {level}
            </button>
          ))}
        </div>
        {chaosMsg && <p className="mt-2 text-sm text-slate-300" role="status">{chaosMsg}</p>}
      </section>
    </main>
  )
}
