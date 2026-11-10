import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Cambia con la ruta: al navegar se limpia el error. */
  resetKey: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de render', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="mx-auto max-w-xl p-8" role="alert">
        <h1 className="text-2xl font-semibold">Algo falló en esta sección</h1>
        <p className="mt-2 text-slate-400">{this.state.error.message}</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="rounded bg-teal-400 px-4 py-2 font-medium text-slate-950"
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
          <a className="rounded border border-slate-600 px-4 py-2" href="/files">
            Volver a los archivos
          </a>
        </div>
      </main>
    )
  }
}
