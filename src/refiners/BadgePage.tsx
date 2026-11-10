import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { errorMessage } from '../api/errors'
import { decodeImage, ImagePreparationError, initialCrop, prepareBadge } from '../media/image'
import type { Crop } from '../media/image'
import { ImagePicker } from '../media/ImagePicker'
import { UploadStatus } from '../media/UploadStatus'
import { useImageUpload } from '../media/useImageUpload'
import { patchRefiner, versionConflict } from './api'
import type { VersionedRefiner } from './api'
import { BadgeCropper } from './BadgeCropper'
import { useRefiner } from './useRefiner'

export function BadgePage() {
  const refinerId = Number(useParams().id)
  const { loaded, setLoaded, error, reload } = useRefiner(refinerId)
  const { state: upload, start, cancel, retry } = useImageUpload()

  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState<VersionedRefiner | null>(null)
  const [appliedMediaId, setAppliedMediaId] = useState<number | null>(null)

  async function pick(files: File[]) {
    setMessage(null)
    setSaved(false)
    try {
      const bitmap = await decodeImage(files[0])
      setImage(bitmap)
      setCrop(initialCrop(bitmap))
    } catch (failure) {
      setMessage(errorMessage(failure))
    }
  }

  async function uploadCrop() {
    if (!image || !crop) return
    setMessage(null)
    try {
      start(await prepareBadge(image, crop))
    } catch (failure) {
      setMessage(failure instanceof ImagePreparationError ? failure.message : errorMessage(failure))
    }
  }

  async function applyBadge(target: VersionedRefiner, mediaId: number) {
    setSaving(true)
    setMessage(null)
    setConflict(null)
    try {
      setLoaded(await patchRefiner(target.refiner.id, target.etag, { badgeMediaId: mediaId }))
      setAppliedMediaId(mediaId)
      setSaved(true)
      setImage(null)
      setCrop(null)
    } catch (failure) {
      const current = versionConflict(failure)
      if (current) {
        setConflict(current)
      } else {
        setMessage(errorMessage(failure))
      }
    } finally {
      setSaving(false)
    }
  }

  // Al confirmarse la imagen, se asigna al expediente con el ETag que se leyó.
  const confirmedMediaId = upload.phase === 'done' ? upload.media.mediaId : null
  useEffect(() => {
    if (confirmedMediaId === null || !loaded || confirmedMediaId === appliedMediaId || saving || conflict || message) return
    void applyBadge(loaded, confirmedMediaId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedMediaId])

  if (error !== null && !loaded) {
    return (
      <main className="p-6" role="alert">
        <p>No se pudo cargar el expediente: {errorMessage(error)}</p>
        <button type="button" className="mt-2 underline" onClick={reload}>
          Reintentar
        </button>
      </main>
    )
  }
  if (!loaded) {
    return (
      <main className="p-6" role="status">
        Cargando expediente…
      </main>
    )
  }

  const { refiner } = loaded
  const busy = upload.phase === 'uploading' || upload.phase === 'confirming' || saving

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold break-words">Fotocheck de {refiner.fullName}</h1>
      <Link className="text-teal-300 underline" to="/refiners">
        Volver a expedientes
      </Link>

      {refiner.badge && (
        <img
          src={refiner.badge.url}
          width={160}
          height={160}
          alt={`Fotocheck actual de ${refiner.fullName}`}
          className="rounded border border-slate-700"
        />
      )}

      <ImagePicker label="Elige una imagen" disabled={busy} onFiles={(files) => void pick(files)} />

      {image && crop && (
        <>
          <BadgeCropper image={image} crop={crop} onChange={setCrop} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void uploadCrop()}
            className="rounded bg-teal-300 px-4 py-2 font-medium text-slate-950 disabled:opacity-50"
          >
            Guardar fotocheck
          </button>
        </>
      )}

      <UploadStatus state={upload} onCancel={cancel} onRetry={retry} />

      {conflict && confirmedMediaId !== null && (
        <section role="alert" className="rounded border border-amber-400/50 p-4">
          <h2 className="font-semibold">El expediente cambió mientras subías</h2>
          <p className="mt-1 text-sm text-slate-300">
            Ahora su título es {conflict.refiner.title} y su departamento {conflict.refiner.department.name}. Solo se
            cambiará el fotocheck.
          </p>
          <button
            type="button"
            onClick={() => void applyBadge(conflict, confirmedMediaId)}
            className="mt-3 rounded bg-teal-300 px-4 py-2 font-medium text-slate-950"
          >
            Asignar sobre la versión nueva
          </button>
        </section>
      )}

      <div role="status" className="text-teal-200">
        {saving ? 'Asignando el fotocheck…' : saved ? 'Fotocheck actualizado.' : ''}
      </div>
      {message && (
        <p role="alert" className="text-rose-300">
          {message}
        </p>
      )}
      {message && confirmedMediaId !== null && confirmedMediaId !== appliedMediaId && (
        <button type="button" className="underline" onClick={() => void applyBadge(loaded, confirmedMediaId)}>
          Reintentar asignación
        </button>
      )}
    </main>
  )
}
