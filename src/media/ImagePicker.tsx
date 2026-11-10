import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'

interface ImagePickerProps {
  label: string
  multiple?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
}

const onlyImages = (files: Iterable<File>) => Array.from(files).filter((file) => file.type.startsWith('image/'))

/** Selector de archivos que también acepta arrastrar y pegar desde el portapapeles. */
export function ImagePicker({ label, multiple = false, disabled = false, onFiles }: ImagePickerProps) {
  const id = useId()
  const [over, setOver] = useState(false)
  const latest = useRef({ onFiles, disabled })
  useEffect(() => {
    latest.current = { onFiles, disabled }
  })

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const images = onlyImages(event.clipboardData?.files ?? [])
      if (images.length > 0 && !latest.current.disabled) latest.current.onFiles(images)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const images = onlyImages(event.dataTransfer.files)
    if (images.length > 0 && !disabled) onFiles(images)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded border border-dashed p-4 ${over ? 'border-teal-300 bg-teal-950' : 'border-slate-600'}`}
    >
      <label htmlFor={id} className="block text-sm font-medium text-slate-200">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={disabled}
        className="mt-2 block text-sm text-slate-300"
        onChange={(event) => {
          const images = onlyImages(event.target.files ?? [])
          event.target.value = ''
          if (images.length > 0) onFiles(images)
        }}
      />
      <p className="mt-2 text-sm text-slate-300">También puedes arrastrar la imagen aquí o pegarla.</p>
    </div>
  )
}
