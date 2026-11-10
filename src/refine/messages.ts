import type { RefineRejection } from './refiner'

const INVALID_GROUP_MESSAGES: Record<string, string> = {
  BELOW_THRESHOLD: 'Alguna celda ya no da miedo. Vuelve a seleccionar el grupo.',
  NOT_CONNECTED: 'Las celdas no forman un solo grupo. Vuelve a seleccionarlo.',
  SIZE_OUT_OF_RANGE: 'Este grupo es ruido por su tamaño: no se puede refinar.',
}

function asRecord(details: unknown): Record<string, unknown> {
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {}
}

/** Bloques afectados de un 409 ALREADY_REFINED, listos para volver a pedirlos. */
export function affectedTiles(details: unknown): Array<[number, number]> {
  const { tiles } = asRecord(details)
  if (!Array.isArray(tiles)) return []
  return tiles.filter(
    (tile): tile is [number, number] =>
      Array.isArray(tile) && tile.length === 2 && tile.every((value) => typeof value === 'number'),
  )
}

export function mistakesOf(details: unknown): number | null {
  const { mistakes } = asRecord(details)
  return typeof mistakes === 'number' ? mistakes : null
}

export function rejectionMessage({ code, message, details }: RefineRejection): string {
  const data = asRecord(details)
  switch (code) {
    case 'WRONG_BIN':
      return 'Esa no es la caja correcta para este grupo y Lumon lo anotó. Prueba con la caja indicada.'
    case 'ALREADY_REFINED':
      return 'Alguien ya refinó parte de este grupo. Actualizamos esa zona: elige otro grupo.'
    case 'GROUP_CLAIMED': {
      const holder = asRecord(data.holder).displayName
      const who = typeof holder === 'string' ? holder : 'Otro refinador'
      return `${who} tiene reservado este grupo. Espera a que lo libere o elige otro.`
    }
    case 'GROUP_INVALID': {
      if (data.reason === 'INCOMPLETE') {
        const missing = typeof data.missing === 'number' ? ` Faltan ${data.missing} celdas.` : ''
        return `El grupo está incompleto.${missing} Vuelve a seleccionarlo.`
      }
      return typeof data.reason === 'string' && INVALID_GROUP_MESSAGES[data.reason]
        ? INVALID_GROUP_MESSAGES[data.reason]
        : message
    }
    case 'FORBIDDEN':
      return 'Tu cuenta no tiene permiso para refinar.'
    default:
      return message
  }
}
