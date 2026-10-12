// The steering and sailing rules (COLREGS Part B, Rules 9 and 12–18) as a
// pure classifier: given two vessels and the wind, which rule governs and
// who must keep out of the way.
//
// Order of precedence, as the rules state it:
//   1. Rule 13  Overtaking — "notwithstanding anything contained in the Rules
//               of Part B", the overtaking vessel keeps clear. This beats the
//               pecking order: a sailboat overtaking a motorboat gives way.
//   2. Rule 9   A small or sailing vessel shall not impede a vessel that can
//               only navigate inside a narrow channel.
//   3. Rule 18  Pecking order between different kinds of vessel.
//   4. Rule 12  Two sailing vessels.
//      Rule 14  Two power-driven vessels meeting head-on.
//      Rule 15  Two power-driven vessels crossing.

import { dirVec, dist, dot, norm180, relBearing, scale, sub } from './geometry'
import type { Encounter, Side, Status, Vessel } from './types'

export type RuleId =
  | 'overtaking'
  | 'narrow-channel'
  | 'hierarchy'
  | 'sail-vs-power'
  | 'sail-opposite-tack'
  | 'sail-same-tack'
  | 'head-on'
  | 'crossing'

export type Role = 'stand-on' | 'give-way'

/** A vessel is overtaking when she comes up from more than 22.5° abaft the beam. */
export const STERN_SECTOR = 112.5
/** Within this many degrees of the stern-sector boundary the picture is doubtful. */
export const SECTOR_DOUBT = 10
/** "Ahead or nearly ahead" for Rule 14. */
export const HEAD_ON_LIMIT = 10
export const HEAD_ON_SURE = 6
export const HEAD_ON_DOUBT = 20
/** A sailboat cannot sail closer to the wind than this. */
export const NO_GO = 40
/** Beyond this the wind is so far aft that the tack is not obvious from outside. */
export const RUN_DOUBT = 168
/** Windward/leeward is doubtful when the upwind separation is below this fraction of the range. */
export const WINDWARD_DOUBT = 0.3

/** Rule 18 order: lower number = more privileged. */
export const RANK: Record<Status, number> = { nuc: 0, ram: 1, fishing: 2, sail: 3, power: 4 }

/** True wind angle: 0 = head to wind; positive = wind over the starboard side. */
export const windAngle = (v: Vessel, wind: number): number => norm180(wind - v.heading)

/** The tack is named for the side the wind is on (opposite the mainsail, Rule 12(b)). */
export const tackOf = (v: Vessel, wind: number): Side => (windAngle(v, wind) >= 0 ? 'starboard' : 'port')

/** How far upwind a vessel is: larger = more to windward. */
export const upwindCoord = (v: Vessel, wind: number): number => dot(v.pos, dirVec(wind))

export const isClosing = (a: Vessel, b: Vessel): boolean => {
  const r = sub(a.pos, b.pos)
  const vRel = sub(scale(dirVec(a.heading), a.speed), scale(dirVec(b.heading), b.speed))
  return dot(r, vRel) < 0
}

/** Is `a` overtaking `b`? (Rule 13(b)) */
export const isOvertaking = (a: Vessel, b: Vessel): boolean =>
  Math.abs(relBearing(b.pos, b.heading, a.pos)) > STERN_SECTOR && isClosing(a, b)

export interface Facts {
  /** Bearing of the other vessel relative to your bow (+ = starboard). */
  otherFromYou: number
  /** Bearing of you relative to the other vessel's bow. */
  youFromOther: number
  range: number
  youTack?: Side
  otherTack?: Side
  windward?: 'you' | 'other'
  overtaker?: 'you' | 'other'
}

export interface Verdict {
  rule: RuleId
  you: Role
  other: Role
  /**
   * Reasons the situation is near a boundary between rules. An empty list
   * means the classification is clear-cut. The classifier still returns the
   * answer the rules give "in case of doubt" (13(c), 14(c)).
   */
  doubts: string[]
  facts: Facts
}

const youGiveWay = { you: 'give-way', other: 'stand-on' } as const
const youStandOn = { you: 'stand-on', other: 'give-way' } as const

export function classify(s: Pick<Encounter, 'wind' | 'you' | 'other'>): Verdict {
  const { you, other, wind } = s
  const otherFromYou = relBearing(you.pos, you.heading, other.pos)
  const youFromOther = relBearing(other.pos, other.heading, you.pos)
  const facts: Facts = { otherFromYou, youFromOther, range: dist(you.pos, other.pos) }
  const doubts: string[] = []

  // Any bearing close to the edge of a stern sector could be read either way.
  for (const b of [otherFromYou, youFromOther]) {
    if (Math.abs(Math.abs(b) - STERN_SECTOR) < SECTOR_DOUBT) doubts.push('near the 22.5° abaft-the-beam line')
  }

  // 1. Overtaking.
  const youOvertake = isOvertaking(you, other)
  const otherOvertakes = isOvertaking(other, you)
  if (youOvertake || otherOvertakes) {
    if (other.confined || you.confined) doubts.push('overtaking inside a narrow channel')
    facts.overtaker = youOvertake ? 'you' : 'other'
    return { rule: 'overtaking', ...(youOvertake ? youGiveWay : youStandOn), doubts, facts }
  }

  // 2. Narrow channel: do not impede a vessel confined to it.
  if (other.confined !== you.confined) {
    return { rule: 'narrow-channel', ...(other.confined ? youGiveWay : youStandOn), doubts, facts }
  }

  // 3. Pecking order.
  const ry = RANK[you.status]
  const ro = RANK[other.status]
  if (ry !== ro) {
    const sailPower = Math.min(ry, ro) === RANK.sail
    return {
      rule: sailPower ? 'sail-vs-power' : 'hierarchy',
      ...(ry > ro ? youGiveWay : youStandOn),
      doubts,
      facts,
    }
  }

  // 4a. Two sailing vessels.
  if (you.status === 'sail') {
    for (const v of [you, other]) {
      const twa = Math.abs(windAngle(v, wind))
      if (twa < NO_GO) doubts.push('a sailboat pointing inside the no-go zone')
      if (twa > RUN_DOUBT) doubts.push('running dead downwind, tack unclear')
    }
    const yt = tackOf(you, wind)
    const ot = tackOf(other, wind)
    facts.youTack = yt
    facts.otherTack = ot
    if (yt !== ot) {
      return { rule: 'sail-opposite-tack', ...(yt === 'port' ? youGiveWay : youStandOn), doubts, facts }
    }
    const up = upwindCoord(you, wind) - upwindCoord(other, wind)
    if (Math.abs(up) < WINDWARD_DOUBT * facts.range) doubts.push('neither boat clearly to windward')
    facts.windward = up > 0 ? 'you' : 'other'
    return { rule: 'sail-same-tack', ...(up > 0 ? youGiveWay : youStandOn), doubts, facts }
  }

  // 4b. Two power-driven vessels.
  if (you.status === 'power') {
    const worst = Math.max(Math.abs(otherFromYou), Math.abs(youFromOther))
    if (worst > HEAD_ON_SURE && worst < HEAD_ON_DOUBT) doubts.push('between head-on and crossing')
    if (worst <= HEAD_ON_LIMIT) {
      return { rule: 'head-on', you: 'give-way', other: 'give-way', doubts, facts }
    }
    // On a true crossing one vessel has the other to starboard and the other
    // has her to port. Anything else is a fine-angle case the rules leave to doubt.
    if (otherFromYou > 0 === youFromOther > 0) doubts.push('each vessel has the other on the same side')
    return { rule: 'crossing', ...(otherFromYou > 0 ? youGiveWay : youStandOn), doubts, facts }
  }

  // Two vessels of the same privileged class (two trawlers, say): the rules
  // give no simple answer, and the trainer never builds these.
  doubts.push('two vessels of the same special status')
  return { rule: 'hierarchy', ...youGiveWay, doubts, facts }
}
