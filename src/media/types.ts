export type MediaPurpose = 'BADGE' | 'INCIDENT'

export interface PreparedImage {
  purpose: MediaPurpose
  blob: Blob
  width: number
  height: number
  sha256: string
}

export interface MediaTicket {
  ticketId: string
  expiresAt: string
  provider: 'SUPABASE' | 'CLOUDINARY'
  objectPath?: string
  bucket?: string
}

export interface Media {
  mediaId: number
  url: string
  width: number
  height: number
  purpose: MediaPurpose
}
