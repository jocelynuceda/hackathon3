export type Bin = 'WO' | 'FC' | 'DR' | 'MA'

/** Respuesta de GET /files/{id}/rules. Cambia por archivo: nunca se fija en el código. */
export interface Rules {
  tremorThreshold: number
  connectivity: 4 | 8
  minGroupSize: number
  maxGroupSize: number
  binning: {
    strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'
    order: Bin[]
  }
}

export interface Cell {
  r: number
  c: number
}

export interface Progress {
  WO: number
  FC: number
  DR: number
  MA: number
  overall: number
}

/** Respuesta 201 de POST /files/{id}/refinements. */
export interface RefineResult {
  refinementId: number
  bin: Bin
  size: number
  file: {
    progress: Progress
    refinedGroups: number
    totalGroups: number
    mistakes: number
    status: 'ACTIVE' | 'COMPLETE'
  }
}
