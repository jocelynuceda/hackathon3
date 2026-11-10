import { config } from '../config'

export function EstadoPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Estado</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-slate-400">Build</dt>
        <dd className="font-mono">{config.build}</dd>
        <dt className="text-slate-400">API</dt>
        <dd className="font-mono break-all">{config.apiBaseUrl}</dd>
      </dl>
    </main>
  )
}
