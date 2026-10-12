// Random practice scenarios, generated rule-first: pick the rule to drill,
// build a geometry that puts the two vessels on a collision course under
// that rule, then VERIFY it with the classifier and the simulator and throw
// it away if anything is off (wrong rule, in a doubt band between two rules,
// no real risk of collision, or more than one turn that works).

import { add, coin, dirVec, dist, norm360, pick, range, scale, type Rng } from './geometry'
import { cpa, resolve } from './motion'
import { markOffset, MARK_CLEAR, requiredSide, resolveMark } from './marks'
import { NO_GO, RUN_DOUBT, windAngle, type Role, type RuleId } from './rules'
import type { Encounter, Mark, MarkKind, MarkScenario, Model, Scenario, Status, Vessel } from './types'

export type Topic =
  | 'sail-opposite-tack'
  | 'sail-same-tack'
  | 'overtaking'
  | 'head-on'
  | 'crossing'
  | 'sail-vs-power'
  | 'hierarchy'
  | 'narrow-channel'
  | 'lateral-marks'
  | 'preferred-marks'

export const TOPICS: Topic[] = [
  'sail-opposite-tack',
  'sail-same-tack',
  'overtaking',
  'head-on',
  'crossing',
  'sail-vs-power',
  'hierarchy',
  'narrow-channel',
  'lateral-marks',
  'preferred-marks',
]

export const isMarkTopic = (t: Topic): boolean => t === 'lateral-marks' || t === 'preferred-marks'

/** Risk of collision: on present courses the centres pass within this, metres. */
export const RISK_CPA = 12
export const MIN_RANGE = 50
export const MAX_RANGE = 420
export const MIN_TCPA = 12
export const MAX_TCPA = 60
/** Sailboats are kept this far inside the sailable arc so their tack is obvious. */
const SAIL_MIN = NO_GO + 4
const SAIL_MAX = RUN_DOUBT - 6

const vessel = (status: Status, model: Model, heading: number, speed: number): Vessel => ({
  status,
  model,
  heading: norm360(heading),
  speed,
  pos: { x: 0, y: 0 },
})

/** Place both vessels so that, holding course, they reach the origin together after T seconds. */
export function meet(you: Vessel, other: Vessel, T: number, miss = 0): { you: Vessel; other: Vessel } {
  const back = (v: Vessel) => scale(dirVec(v.heading), -v.speed * T)
  return {
    you: { ...you, pos: back(you) },
    other: { ...other, pos: add(back(other), scale(dirVec(other.heading + 90), miss)) },
  }
}

export interface Want {
  rule: RuleId
  you: Role
}

/** Everything that would make an encounter a bad example of `want`. Empty = good. */
export function checkEncounter(e: Encounter, want: Want): string[] {
  const res = resolve(e)
  const problems = [...res.problems]
  const v = res.verdict
  if (v.rule !== want.rule) problems.push(`classified as ${v.rule}, wanted ${want.rule}`)
  if (v.rule !== 'head-on' && v.you !== want.you) problems.push(`you are ${v.you}, wanted ${want.you}`)
  const c = cpa(e.you, e.other)
  if (c.d > RISK_CPA) problems.push('no risk of collision')
  if (c.t < MIN_TCPA || c.t > MAX_TCPA) problems.push('collision too soon or too far off')
  const r = dist(e.you.pos, e.other.pos)
  if (r < MIN_RANGE || r > MAX_RANGE) problems.push('range out of bounds')
  for (const b of [e.you, e.other]) {
    if (b.status !== 'sail') continue
    const twa = Math.abs(windAngle(b, e.wind))
    if (twa < SAIL_MIN || twa > SAIL_MAX) problems.push('sailboat outside the clearly sailable arc')
  }
  if (res.acceptable.length === 0) problems.push('no acceptable answer')
  return problems
}

export function checkMark(s: MarkScenario): string[] {
  return [...resolveMark(s).problems]
}

const sailSpeed = (rng: Rng) => range(rng, 2.6, 3.4)
const sailing = (rng: Rng, heading: number, speed = sailSpeed(rng)) => vessel('sail', 'sloop', heading, speed)
/** You, under engine with the sails down. */
const motoring = (rng: Rng, heading: number) => vessel('power', 'sloop', heading, range(rng, 2.8, 3.3))
const powerBoat = (rng: Rng, heading: number): Vessel =>
  coin(rng, 0.7) ? vessel('power', 'motorboat', heading, range(rng, 4.5, 7.5)) : motoring(rng, heading)
/** Heading for a sailboat with the given true wind angle (+ = starboard tack). */
const onTack = (wind: number, twa: number) => wind - twa
const sign = (rng: Rng) => (coin(rng) ? 1 : -1)

type Build = (rng: Rng, wind: number, role: Role) => Omit<Encounter, 'id' | 'kind' | 'wind'>

const builders: Record<Exclude<Topic, 'lateral-marks' | 'preferred-marks'>, Build> = {
  'sail-opposite-tack': (rng, wind, role) => {
    // Port tack = wind over the port side = negative wind angle.
    const yourSide = role === 'give-way' ? -1 : 1
    const you = sailing(rng, onTack(wind, yourSide * range(rng, SAIL_MIN, SAIL_MAX)))
    const other = sailing(rng, onTack(wind, -yourSide * range(rng, SAIL_MIN, SAIL_MAX)))
    return meet(you, other, range(rng, 18, 28), range(rng, -5, 5))
  },

  'sail-same-tack': (rng, wind, role) => {
    const side = sign(rng)
    // The boat sailing lower (wider wind angle) arrives from upwind, so she is the windward boat.
    const low = range(rng, SAIL_MIN + 40, SAIL_MAX)
    const high = range(rng, SAIL_MIN, low - 35)
    const [mine, hers] = role === 'give-way' ? [low, high] : [high, low]
    const you = sailing(rng, onTack(wind, side * mine))
    const other = sailing(rng, onTack(wind, side * hers))
    // Boats on the same tack converge slowly, so start them further out in time.
    return meet(you, other, range(rng, 24, 38), range(rng, -5, 5))
  },

  overtaking: (rng, _wind, role) => {
    // Mix the vessel types on purpose: overtaking beats the sail-over-power rule.
    const kind = pick(rng, ['sail>sail', 'sail>power', 'power>sail', 'power>power'] as const)
    const h = range(rng, 0, 360)
    const delta = sign(rng) * range(rng, 6, 32)
    const fastFirst = role === 'give-way'
    let slow: Vessel
    let fast: Vessel
    if (kind === 'sail>sail') {
      slow = sailing(rng, h, range(rng, 1.9, 2.3))
      fast = sailing(rng, h + delta, range(rng, 3.3, 3.9))
    } else if (kind === 'sail>power') {
      slow = vessel('power', 'sloop', h, range(rng, 1.6, 2.0))
      fast = sailing(rng, h + delta, range(rng, 3.1, 3.8))
    } else if (kind === 'power>sail') {
      slow = sailing(rng, h, range(rng, 2.3, 2.9))
      fast = fastFirst ? vessel('power', 'sloop', h + delta, range(rng, 4.0, 4.6)) : vessel('power', 'motorboat', h + delta, range(rng, 5, 7))
    } else {
      slow = vessel('power', 'sloop', h, range(rng, 2.0, 2.6))
      fast = fastFirst ? vessel('power', 'sloop', h + delta, range(rng, 3.6, 4.2)) : vessel('power', 'motorboat', h + delta, range(rng, 5, 7))
    }
    const [you, other] = fastFirst ? [fast, slow] : [slow, fast]
    return meet(you, other, range(rng, 34, 50), range(rng, -4, 4))
  },

  'head-on': (rng) => {
    const h = range(rng, 0, 360)
    const you = motoring(rng, h)
    const other = powerBoat(rng, h + 180 + range(rng, -4, 4))
    return meet(you, other, range(rng, 16, 24), range(rng, -5, 5))
  },

  crossing: (rng, _wind, role) => {
    const h = range(rng, 0, 360)
    // She comes from your starboard side when her course points to your port, and vice versa.
    const side = role === 'give-way' ? -1 : 1
    const you = motoring(rng, h)
    const other = powerBoat(rng, h + side * range(rng, 45, 130))
    return meet(you, other, range(rng, 18, 28), range(rng, -5, 5))
  },

  'sail-vs-power': (rng, wind, role) => {
    const sailTwa = sign(rng) * range(rng, SAIL_MIN, SAIL_MAX)
    const powerHeading = range(rng, 0, 360)
    if (role === 'stand-on') {
      return meet(sailing(rng, onTack(wind, sailTwa)), powerBoat(rng, powerHeading), range(rng, 18, 28), range(rng, -5, 5))
    }
    return meet(motoring(rng, powerHeading), sailing(rng, onTack(wind, sailTwa)), range(rng, 18, 28), range(rng, -5, 5))
  },

  hierarchy: (rng, wind) => {
    const h = range(rng, 0, 360)
    const other = pick(rng, [
      () => vessel('fishing', 'trawler', h, range(rng, 1.4, 2.0)),
      () => vessel('ram', 'dredger', h, range(rng, 0.3, 0.7)),
      () => vessel('nuc', 'ship', h, range(rng, 0.4, 0.9)),
    ])()
    const you = coin(rng) ? sailing(rng, onTack(wind, sign(rng) * range(rng, SAIL_MIN, SAIL_MAX))) : motoring(rng, range(rng, 0, 360))
    return meet(you, other, range(rng, other.model === 'trawler' ? 22 : 34, other.model === 'trawler' ? 32 : 46), range(rng, -6, 6))
  },

  'narrow-channel': (rng) => {
    const h = range(rng, 0, 360)
    const ship: Vessel = { ...vessel('power', 'ship', h, range(rng, 4.2, 5.4)), confined: true }
    const side = sign(rng)
    const cross = h + side * range(rng, 55, 125)
    const you = coin(rng, 0.6) ? sailing(rng, cross) : motoring(rng, cross)
    const placed = meet(you, ship, range(rng, 34, 46), range(rng, -8, 8))
    // The ship is following the buoyed channel; show its edges.
    const inbound = coin(rng)
    const up = inbound ? h : h + 180
    const marks: Mark[] = []
    for (let along = -360; along <= 480; along += 210) {
      for (const hand of ['port-hand', 'starboard-hand'] as const) {
        const lateral = (hand === 'port-hand' ? -1 : 1) * 55
        marks.push({
          kind: hand,
          pos: add(scale(dirVec(up), along), scale(dirVec(up + 90), lateral)),
        })
      }
    }
    return { ...placed, scenery: { marks, shoreBearing: norm360(up) } }
  },
}

const WANT: Record<keyof typeof builders, RuleId> = {
  'sail-opposite-tack': 'sail-opposite-tack',
  'sail-same-tack': 'sail-same-tack',
  overtaking: 'overtaking',
  'head-on': 'head-on',
  crossing: 'crossing',
  'sail-vs-power': 'sail-vs-power',
  hierarchy: 'hierarchy',
  'narrow-channel': 'narrow-channel',
}

/** Topics where you are only ever the give-way vessel. */
const ALWAYS_GIVE_WAY: Topic[] = ['hierarchy', 'narrow-channel', 'head-on']

function buildMark(rng: Rng, topic: Topic): Omit<MarkScenario, 'id'> {
  const kinds: MarkKind[] = topic === 'preferred-marks' ? ['pref-starboard', 'pref-port'] : ['port-hand', 'starboard-hand']
  const kind = pick(rng, kinds)
  const direction = coin(rng, 0.65) ? 'returning' : 'leaving'
  const wind = range(rng, 0, 360)
  const heading = range(rng, 0, 360)
  const underSail = coin(rng, 0.6)
  // On a reach, so a sailing boat is free to alter either way.
  const h = underSail ? wind - sign(rng) * range(rng, 70, 125) : heading
  const you: Vessel = underSail ? sailing(rng, h) : motoring(rng, h)
  const required = requiredSide({ mark: { kind, pos: { x: 0, y: 0 } }, direction })
  const want = required === 'starboard' ? 1 : -1
  // 40%: already on the correct side, well clear. Otherwise dead ahead or on the wrong side.
  const lateral = coin(rng, 0.4) ? want * range(rng, MARK_CLEAR + 4, 30) : -want * range(rng, -1.5, 20)
  const ahead = range(rng, 70, 100)
  const pos = add(scale(dirVec(you.heading), ahead), scale(dirVec(you.heading + 90), lateral))
  const number = String(Math.floor(range(rng, 1, 9)))
  return {
    kind: 'mark',
    wind,
    you,
    mark: { kind, pos, label: topic === 'preferred-marks' ? undefined : number },
    direction,
    scenery: { shoreBearing: norm360(direction === 'returning' ? you.heading : you.heading + 180) },
  }
}

export interface GenOptions {
  night?: boolean
  role?: Role
  /** Reported back for diagnostics and tests. */
  stats?: { attempts: number; rejected: Record<string, number> }
}

let counter = 0
export const MAX_ATTEMPTS = 2000

/** Generate one verified scenario for a topic. */
export function generate(topic: Topic, rng: Rng, opts: GenOptions = {}): Scenario {
  const id = `${topic}-${++counter}`
  if (isMarkTopic(topic)) {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const s: MarkScenario = { ...buildMark(rng, topic), id }
      // Marks are lit at night too, but reading buoy lights is its own subject; keep these in daylight.
      const problems = checkMark(s)
      if (opts.stats) opts.stats.attempts++
      if (!problems.length && Math.abs(markOffset(s)) < 40) return s
    }
    throw new Error(`could not generate ${topic}`)
  }
  const build = builders[topic as keyof typeof builders]
  const rule = WANT[topic as keyof typeof builders]
  const role: Role = ALWAYS_GIVE_WAY.includes(topic) ? 'give-way' : (opts.role ?? (coin(rng) ? 'give-way' : 'stand-on'))
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const wind = range(rng, 0, 360)
    const e: Encounter = { ...build(rng, wind, role), id, kind: 'encounter', wind, night: opts.night && topic !== 'narrow-channel' }
    const problems = checkEncounter(e, { rule, you: role })
    if (opts.stats) {
      opts.stats.attempts++
      for (const p of problems) opts.stats.rejected[p] = (opts.stats.rejected[p] ?? 0) + 1
    }
    if (!problems.length) return e
  }
  throw new Error(`could not generate ${topic}`)
}
