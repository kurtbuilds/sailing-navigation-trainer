// Lateral and preferred-channel marks (IALA Maritime Buoyage System).
//
// The only thing that differs between Region A and Region B is colour:
//   Region A — returning from sea: RED to port, GREEN to starboard.
//   Region B — returning from sea: GREEN to port, RED to starboard
//              ("red, right, returning").
// Shapes are the same everywhere: port-hand marks are cans (flat top),
// starboard-hand marks are cones / nuns (pointed top).

import { add, clamp, DEG, dirVec, dot, norm180, scale, sub } from './geometry'
import { TURN_RATE, type Pose } from './motion'
import type { Action, MarkKind, MarkScenario, Region, Side } from './types'

export type MarkColor = 'red' | 'green'

export interface MarkLook {
  color: MarkColor
  /** Colour of the single broad horizontal band on a preferred-channel mark. */
  band?: MarkColor
  shape: 'can' | 'cone'
}

/** Which plain lateral mark a mark behaves as when you follow the preferred channel. */
export const treatAs = (kind: MarkKind): 'port-hand' | 'starboard-hand' =>
  kind === 'port-hand' || kind === 'pref-starboard' ? 'port-hand' : 'starboard-hand'

export const isPreferred = (kind: MarkKind): boolean => kind === 'pref-starboard' || kind === 'pref-port'

export function markLook(kind: MarkKind, region: Region): MarkLook {
  const hand = treatAs(kind)
  const portColor: MarkColor = region === 'A' ? 'red' : 'green'
  const stbdColor: MarkColor = region === 'A' ? 'green' : 'red'
  const color = hand === 'port-hand' ? portColor : stbdColor
  const look: MarkLook = { color, shape: hand === 'port-hand' ? 'can' : 'cone' }
  if (isPreferred(kind)) look.band = color === 'red' ? 'green' : 'red'
  return look
}

/** Red marks carry even numbers and green marks odd numbers, in both regions. */
export function markNumber(mark: { kind: MarkKind; label?: string }, region: Region): string | undefined {
  if (!mark.label || isPreferred(mark.kind)) return undefined
  const n = parseInt(mark.label, 10)
  return String(markLook(mark.kind, region).color === 'red' ? n * 2 : n * 2 - 1)
}

/** The side of YOUR boat the mark must be on as you pass it. */
export function requiredSide(s: Pick<MarkScenario, 'mark' | 'direction'>): Side {
  const hand = treatAs(s.mark.kind)
  const returning: Side = hand === 'port-hand' ? 'port' : 'starboard'
  if (s.direction === 'returning') return returning
  return returning === 'port' ? 'starboard' : 'port'
}

/** Lateral offset of the mark from your track: positive = to starboard. */
export const markOffset = (s: Pick<MarkScenario, 'mark' | 'you'>): number =>
  dot(sub(s.mark.pos, s.you.pos), dirVec(s.you.heading + 90))

/** Pass at least this far off to count as comfortably clear, metres. */
export const MARK_CLEAR = 12
/** Closer than this on the correct side, or anything on the wrong side, needs a turn. */
export const MARK_TIGHT = 3

export interface MarkResolution {
  required: Side
  offset: number
  acceptable: Action[]
  best: Action
  problems: string[]
}

export function resolveMark(s: MarkScenario): MarkResolution {
  const required = requiredSide(s)
  const offset = markOffset(s)
  // Signed so that positive = mark is on the required side.
  const onCorrect = required === 'starboard' ? offset : -offset
  const problems: string[] = []
  let best: Action
  if (onCorrect >= MARK_CLEAR) best = 'stand-on'
  else {
    if (onCorrect > MARK_TIGHT) problems.push('doubt: mark is on the right side but uncomfortably close')
    // To put the mark on your port side you move to starboard, and vice versa.
    best = required === 'port' ? 'starboard' : 'port'
  }
  return { required, offset, acceptable: [best], best, problems }
}

export interface MarkTrack {
  dt: number
  you: Pose[]
  end: number
  /** Side the mark ended up on, and by how much. */
  passedSide: Side
  clearance: number
  hit: boolean
}

/** Sail past the mark with the given answer. */
export function playMark(s: MarkScenario, answer: Action, dt = 0.1): MarkTrack {
  const { you, mark } = s
  const ahead = dot(sub(mark.pos, you.pos), dirVec(you.heading))
  const offset = markOffset(s)
  const dir = answer === 'starboard' ? 1 : answer === 'port' ? -1 : 0
  // Sidestep until the mark is 16 m off on the far side of the turn.
  const shift = dir === 0 ? 0 : Math.max(0, 16 + dir * offset)
  const angle = dir === 0 || shift === 0 ? 0 : clamp(Math.atan2(shift, ahead * 0.6) / DEG, 14, 50)
  const rate = TURN_RATE[you.model]
  let pos = you.pos
  let heading = you.heading
  let phase: 'out' | 'back' | 'done' = angle ? 'out' : 'done'
  const poses: Pose[] = []
  let passedSide: Side = offset >= 0 ? 'starboard' : 'port'
  let clearance = Infinity
  let minDist = Infinity
  let tAbeam = Infinity
  const total = ahead / you.speed + 14
  for (let t = 0; t <= total + 1e-6; t += dt) {
    poses.push({ pos, heading })
    const rel = sub(mark.pos, pos)
    const d = Math.hypot(rel.x, rel.y)
    minDist = Math.min(minDist, d)
    const fwd = dot(rel, dirVec(heading))
    if (fwd <= 0 && tAbeam === Infinity) {
      tAbeam = t
      const lat = dot(rel, dirVec(heading + 90))
      passedSide = lat >= 0 ? 'starboard' : 'port'
      clearance = Math.abs(lat)
    }
    const off = norm180(heading - you.heading)
    const moved = dir * dot(sub(pos, you.pos), dirVec(you.heading + 90))
    if (phase === 'out') {
      if (t > 0.5 && Math.abs(off) < angle) heading += dir * Math.min(rate * dt, angle - Math.abs(off))
      // Start swinging back early enough that the return turn finishes on the new track.
      if (moved >= shift - 2) phase = 'back'
    } else if (phase === 'back') {
      const next = Math.abs(off) - rate * dt
      heading = next <= 0 ? you.heading : you.heading + dir * next
      if (next <= 0) phase = 'done'
    }
    pos = add(pos, scale(dirVec(heading), you.speed * dt))
  }
  const hit = minDist < 3
  return { dt, you: poses, end: Math.min(total, tAbeam + 9), passedSide, clearance: hit ? 0 : clearance, hit }
}
