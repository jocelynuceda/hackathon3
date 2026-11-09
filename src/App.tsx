import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { config } from './config'

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Lumon MDR</h1>
      <p className="mt-2 text-slate-400">El trabajo es misterioso e importante.</p>
      <nav className="mt-6">
        <Link className="text-teal-300 underline" to="/estado">
          Estado
        </Link>
      </nav>
    </main>
  )
}

function Estado() {
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

function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-slate-400">Esta página no existe.</p>
      <Link className="mt-4 inline-block text-teal-300 underline" to="/">
        Volver al inicio
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/estado" element={<Estado />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
