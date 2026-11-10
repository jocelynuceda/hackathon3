import type { Bin, Cell, Rules } from './types'

export interface GridSize {
  rows: number
  cols: number
  tileSize: number
}

export type GroupClassification = { kind: 'noise' } | { kind: 'refinable'; bin: Bin }

export interface Group {
  cells: Cell[]
  classification: GroupClassification
  /** true si alguna celda ya está en una caja: el servidor respondería 409. */
  alreadyRefined: boolean
}

/** Lo que la búsqueda necesita de un bloque ya decodificado. */
export interface GroupTile {
  originRow: number
  originCol: number
  cols: number
  values: ArrayLike<number>
  tremor: ArrayLike<number>
  bins: ArrayLike<string>
}

/** Debe compartir la caché de bloques de la grilla para no repetir requests. */
export type LoadTile = (tileRow: number, tileCol: number) => Promise<GroupTile>

const ORTHOGONAL = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const

const DIAGONAL = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const

export function binIndex(digits: readonly number[], rules: Rules): number {
  const value =
    rules.binning.strategy === 'DIGIT_SUM_MOD'
      ? digits.reduce((sum, digit) => sum + digit, 0)
      : Math.max(...digits)
  return value % 4
}

export function classifyGroup(digits: readonly number[], rules: Rules): GroupClassification {
  if (digits.length < rules.minGroupSize || digits.length > rules.maxGroupSize) {
    return { kind: 'noise' }
  }
  return { kind: 'refinable', bin: rules.binning.order[binIndex(digits, rules)] }
}

/**
 * Recorre en anchura desde `start` y devuelve el grupo máximo, pidiendo los bloques que hagan falta.
 * Devuelve null si la celda está fuera de la grilla o no da miedo.
 */
export async function findGroup(
  start: Cell,
  grid: GridSize,
  rules: Rules,
  loadTile: LoadTile,
): Promise<Group | null> {
  const inGrid = ({ r, c }: Cell) => r >= 0 && c >= 0 && r < grid.rows && c < grid.cols
  if (!inGrid(start)) return null

  const offsets = rules.connectivity === 8 ? [...ORTHOGONAL, ...DIAGONAL] : ORTHOGONAL
  const keyOf = ({ r, c }: Cell) => r * grid.cols + c
  const tiles = new Map<string, GroupTile>()

  async function read({ r, c }: Cell) {
    const tileRow = Math.floor(r / grid.tileSize)
    const tileCol = Math.floor(c / grid.tileSize)
    const tileKey = `${tileRow}:${tileCol}`
    let tile = tiles.get(tileKey)
    if (!tile) {
      tile = await loadTile(tileRow, tileCol)
      tiles.set(tileKey, tile)
    }
    const index = (r - tile.originRow) * tile.cols + (c - tile.originCol)
    return {
      scary: tile.tremor[index] >= rules.tremorThreshold,
      digit: tile.values[index],
      refined: tile.bins[index] !== '.',
    }
  }

  const first = await read(start)
  if (!first.scary) return null

  const seen = new Set([keyOf(start)])
  const cells: Cell[] = [start]
  const digits = [first.digit]
  let alreadyRefined = first.refined

  // `cells` funciona también como cola: crece mientras se recorre.
  for (let index = 0; index < cells.length; index += 1) {
    const { r, c } = cells[index]
    for (const [dr, dc] of offsets) {
      const next = { r: r + dr, c: c + dc }
      if (!inGrid(next) || seen.has(keyOf(next))) continue
      seen.add(keyOf(next))

      const cell = await read(next)
      if (!cell.scary) continue
      cells.push(next)
      digits.push(cell.digit)
      alreadyRefined ||= cell.refined
    }
  }

  return { cells, classification: classifyGroup(digits, rules), alreadyRefined }
}
