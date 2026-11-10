import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/errors'
import { prepareIncidentPhoto } from '../media/image'
import { UploadStatus } from '../media/UploadStatus'
import { useImageUpload } from '../media/useImageUpload'

interface PhotoSlotProps {
  file: File
  onConfirmed: (mediaId: number | null) => void
  onRemove: () => void
}

export function PhotoSlot({ file, onConfirmed, onRemove }: PhotoSlotProps) {
  const { state, start, cancel, retry } = useImageUpload()
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const notify = useRef(onConfirmed)
  useEffect(() => {
    notify.current = onConfirmed
  })

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    let active = true
    setPrepareError(null)
    prepareIncidentPhoto(file)
      .then((image) => {
        if (active) start(image)
      })
      .catch((failure: unknown) => {
        if (active) setPrepareError(errorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [file, start])

  const mediaId = state.phase === 'done' ? state.media.mediaId : null
  useEffect(() => {
    notify.current(mediaId)
  }, [mediaId])

  return (
    <li className="flex gap-3 rounded border border-slate-700 p-3">
      {preview && <img src={preview} width={80} height={80} alt="" className="h-20 w-20 rounded object-cover" />}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm">{file.name}</p>
        {prepareError ? (
          <p role="alert" className="text-sm text-rose-300">
            {prepareError}
          </p>
        ) : (
          <UploadStatus state={state} onCancel={cancel} onRetry={retry} />
        )}
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            cancel()
            onRemove()
          }}
        >
          Quitar<span className="sr-only"> {file.name}</span>
        </button>
      </div>
    </li>
  )
}
