import { useSyncExternalStore } from 'react'
import type { Cell } from '../refine/types'
import type { FloorConnection, Member } from './floorConnection'

export interface VisibleCells {
  firstRow: number
  endRow: number
  firstCol: number
  endCol: number
}

type PositionedMember = Member & Cell

function hasPosition(member: Member): member is PositionedMember {
  return member.r !== null && member.c !== null
}

function isVisible(member: PositionedMember, area: VisibleCells) {
  return member.r >= area.firstRow && member.r < area.endRow &&
    member.c >= area.firstCol && member.c < area.endCol
}

interface PresenceProps {
  floor: FloorConnection
  self?: number
  area: VisibleCells
}

export function FloorCursors({ floor, self, area, cellSize }: PresenceProps & { cellSize: number }) {
  const members = useSyncExternalStore(floor.subscribePresence, floor.getMembers)
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {members.filter(hasPosition).filter((member) => member.userId !== self && isVisible(member, area)).map((member) => (
        <div
          key={member.userId}
          className="absolute rounded-sm border-2 border-sky-300"
          style={{ top: member.r * cellSize, left: member.c * cellSize, width: cellSize, height: cellSize }}
        >
          <span className="absolute top-0 left-full max-w-36 truncate rounded bg-sky-300 px-1 text-xs font-semibold text-slate-950">
            {member.displayName}
          </span>
        </div>
      ))}
    </div>
  )
}

export function FloorMembers({ floor, self, area, onJump }: PresenceProps & { onJump: (cell: Cell) => void }) {
  const members = useSyncExternalStore(floor.subscribePresence, floor.getMembers)
  if (members.length === 0) return null

  return (
    <section aria-label="Presentes en el piso" className="mt-2 text-sm text-slate-300">
      <h3 className="font-semibold">Presentes en el piso</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {members.map((member) => (
          <li key={member.userId}>
            {member.displayName}
            {member.userId === self ? ' (tú)' : hasPosition(member) && !isVisible(member, area) && (
              <button type="button" className="ml-2 text-teal-300 underline" onClick={() => onJump(member)}>
                Ir a su posición
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
