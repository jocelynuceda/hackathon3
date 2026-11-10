import type { UploadState } from './useImageUpload'

interface UploadStatusProps {
  state: UploadState
  onCancel: () => void
  onRetry: () => void
}

export function UploadStatus({ state, onCancel, onRetry }: UploadStatusProps) {
  if (state.phase === 'idle') return null
  const canRetry = state.phase === 'error' || state.phase === 'cancelled'

  return (
    <div className="space-y-1 text-sm">
      {state.phase === 'uploading' && (
        <>
          <progress className="w-full" max={1} value={state.progress} aria-label="Progreso de la subida" />
          <p className="tabular-nums text-slate-300">Subiendo {Math.round(state.progress * 100)} %</p>
        </>
      )}
      <div role="status">
        {state.phase === 'confirming' && <p className="text-slate-300">Verificando con Lumon…</p>}
        {state.phase === 'done' && <p className="text-teal-200">Imagen confirmada.</p>}
        {state.phase === 'cancelled' && <p className="text-slate-300">Subida cancelada.</p>}
      </div>
      {state.phase === 'error' && (
        <p role="alert" className="text-rose-300">
          {state.message}
        </p>
      )}
      <div className="flex gap-3">
        {(state.phase === 'uploading' || state.phase === 'confirming') && (
          <button type="button" className="underline" onClick={onCancel}>
            Cancelar
          </button>
        )}
        {canRetry && (
          <button type="button" className="underline" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  )
}
