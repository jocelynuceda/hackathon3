import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, withRetry } from '../api/client'
import { errorMessage, fieldErrors } from '../api/errors'
import { Field } from '../components/Field'
import { ImagePicker } from '../media/ImagePicker'
import { PhotoSlot } from './PhotoSlot'
import { SEVERITIES } from './types'
import type { Incident, Severity } from './types'

const MAX_PHOTOS = 3

interface Photo {
  key: number
  file: File
  mediaId: number | null
}

export function NewIncidentPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('LOW')
  const [fileId, setFileId] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const nextKey = useRef(0)

  function addFiles(files: File[]) {
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length
      const added = files.slice(0, room).map((file) => {
        nextKey.current += 1
        return { key: nextKey.current, file, mediaId: null }
      })
      return [...current, ...added]
    })
  }

  const allConfirmed = photos.length > 0 && photos.every((photo) => photo.mediaId !== null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!allConfirmed || sending) return
    setSending(true)
    setErrors({})
    setFormError(null)
    try {
      await withRetry(() =>
        api<Incident>('/incidents', {
          method: 'POST',
          body: {
            title,
            description,
            severity,
            fileId: fileId === '' ? null : Number(fileId),
            mediaIds: photos.map((photo) => photo.mediaId),
          },
        }),
      )
      navigate('/incidents')
    } catch (failure) {
      setErrors(fieldErrors(failure))
      setFormError(errorMessage(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Nueva incidencia</h1>
      <Link className="text-teal-300 underline" to="/incidents">
        Volver a incidencias
      </Link>

      <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
        <Field label="Título" type="text" value={title} onChange={setTitle} error={errors.title} required />
        <label className="block text-sm font-medium text-slate-200">
          Descripción
          <textarea
            required
            maxLength={4000}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
        </label>
        {errors.description && <p className="text-sm text-rose-300">{errors.description}</p>}
        <label className="block text-sm font-medium text-slate-200">
          Severidad
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as Severity)}
            className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 px-3 py-2"
          >
            {SEVERITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Archivo relacionado (opcional)
          <input
            type="number"
            min={1}
            value={fileId}
            onChange={(event) => setFileId(event.target.value)}
            className="mt-1 block w-40 rounded border border-slate-600 bg-slate-900 px-3 py-2"
          />
        </label>
        {errors.fileId && <p className="text-sm text-rose-300">{errors.fileId}</p>}

        <ImagePicker
          label={`Fotos (de 1 a ${MAX_PHOTOS})`}
          multiple
          disabled={photos.length >= MAX_PHOTOS}
          onFiles={addFiles}
        />
        {errors.mediaIds && <p className="text-sm text-rose-300">{errors.mediaIds}</p>}

        <ul className="space-y-2">
          {photos.map((photo) => (
            <PhotoSlot
              key={photo.key}
              file={photo.file}
              onConfirmed={(mediaId) =>
                setPhotos((current) =>
                  current.map((item) => (item.key === photo.key ? { ...item, mediaId } : item)),
                )
              }
              onRemove={() => setPhotos((current) => current.filter((item) => item.key !== photo.key))}
            />
          ))}
        </ul>

        <button
          type="submit"
          disabled={!allConfirmed || sending}
          className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:opacity-50"
        >
          {sending ? 'Enviando…' : 'Enviar reporte'}
        </button>
        {!allConfirmed && <p className="text-sm text-slate-300">Se podrá enviar cuando todas las fotos estén confirmadas.</p>}
        {formError && (
          <p role="alert" className="text-rose-300">
            {formError}
          </p>
        )}
      </form>
    </main>
  )
}
