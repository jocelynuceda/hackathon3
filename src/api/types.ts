import type { Progress } from '../refine/types'

export type { Me, Permission } from '../auth/types'
export type { Bin, Progress, Rules } from '../refine/types'

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: { id: number; email: string; displayName: string }
}

export type FileStatus = 'ACTIVE' | 'COMPLETE'

export interface DataFile {
  id: number
  name: string
  rows: number
  cols: number
  tileSize: number
  status: FileStatus
  progress: Progress
  refinedGroups: number
  totalGroups: number
  mistakes: number
  updatedAt: string
}

export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface TileResponse {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: string
  bins: string
  version: number
}

export interface Check {
  name: string
  passed: boolean
  detail: string
}

export interface ClearanceResult {
  granted: boolean
  grantedAt: string | null
  checks: Check[]
  checkedAt?: string
  workspace?: { kind: string; chaosLevel: number }
}

export interface IntegrationStatus {
  deploy: {
    origin: string | null
    verifiedAt: string | null
    lastBuildSeen: string | null
    lastBuildSeenAt: string | null
  } | null
  storage: { provider: string; verifiedAt: string | null; checks: Check[] } | null
  clearance: { granted: boolean; grantedAt: string | null }
}

export const PERMISSIONS = {
  filesRead: 'files:read',
  filesRefine: 'files:refine',
  refinersRead: 'refiners:read',
  refinersWrite: 'refiners:write',
  mediaUpload: 'media:upload',
  incidentsRead: 'incidents:read',
  incidentsCreate: 'incidents:create',
  teamManage: 'team:manage',
} as const
