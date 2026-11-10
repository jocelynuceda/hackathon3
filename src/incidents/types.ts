export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'CRITICAL', label: 'Crítica' },
]

export interface Incident {
  id: number
  title: string
  description: string
  severity: Severity
  fileId: number | null
  file: { id: number; name: string } | null
  photos: Array<{ mediaId: number; url: string; width: number; height: number }>
  createdBy: { id: number; displayName: string }
  createdAt: string
}
