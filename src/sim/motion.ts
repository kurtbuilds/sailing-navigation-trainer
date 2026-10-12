// Kinematics: play an encounter forward in time, with either vessel making a
// course alteration, and judge whether the alteration actually works.
//
// "Works" is defined strictly so the quiz never marks a sloppy answer right:
// a turn is EFFECTIVE iff the vessel can make it, the two hulls stay a safe
// distance apart throughout, she never crosses close ahead of the other
// vessel, and she is able to return to her original course afterwards.

import { add, clamp, dirVec, dot, lerp, norm180, scale, sub, type Vec } from './geometry'
import { classify, NO_GO, windAngle, type Verdict } from './rules'
import { LENGTH, type Action, type Encounter, type Model, type Vessel } from './types'

export const BEAM: Record<Model, number> = { sloop: 3.2, motorboat: 2.8, trawler: 6.5, dredger: 14, ship: 19 }
/** Degrees per second a vessel can swing her bow. */
export const TURN_RATE: Record<Model, number> = { sloop: 14, motorboat: 18, trawler: 6, dredger: 2, ship: 2 }

/** Widest angle off the wind we let a sailboat alter to without calling it a gybe. */
export const MAX_RUN = 170
/** Course alterations tried, smallest first. "Early and substantial" (Rule 16). */
export const TURN_SIZES = [30, 45, 60]
const MIN_TURN = 15
export const HORIZON = 90

export interface Pose {
  pos: Vec
  heading: number
}

export interface Plan {
  /** Signed course alteration in degrees; positive = to starboard. */
  turn: number
  startAt: number
}

export interface Outcome {
  /** Smallest hull-to-hull separation reached, metres. */
  minSep: number
  tMin: number
  collided: boolean
  tCollide: number
  /** `you` crossed the other's course line close ahead of her bow. */
  youCrossedAhead: boolean
  otherCrossedAhead: boolean
  /** Every vessel that altered course got back onto its original heading. */
  resumed: boolean
}

export interface Track {
  dt: number
  you: Pose[]
  other: Pose[]
  /** Time at which the playback can stop (encounter resolved, or collision). */
  end: number
  outcome: Outcome
}

const halfSeg = (p: Pose, model: Model): [Vec, Vec] => {
  const d = scale(dirVec(p.heading), LENGTH[model] / 2)
  return [sub(p.pos, d), add(p.pos, d)]
}

const pointSeg = (p: Vec, a: Vec, b: Vec): number => {
  const ab = sub(b, a)
  const t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1)
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t))
}

const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x
const segsIntersect = (a: Vec, b: Vec, c: Vec, d: Vec): boolean => {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Distance between the two vessels' centrelines. */
export const separation = (a: Pose, am: Model, b: Pose, bm: Model): number => {
  const [a1, a2] = halfSeg(a, am)
  const [b1, b2] = halfSeg(b, bm)
  if (segsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(pointSeg(a1, b1, b2), pointSeg(a2, b1, b2), pointSeg(b1, a1, a2), pointSeg(b2, a1, a2))
}

const isBig = (m: Model) => m === 'ship' || m === 'dredger'
export const safeSep = (a: Model, b: Model): number =>
  18 + (BEAM[a] + BEAM[b]) / 2 + (isBig(a) || isBig(b) ? 20 : 0)
export const hitSep = (a: Model, b: Model): number => (BEAM[a] + BEAM[b]) / 2 + 1.5
/** How far in front of a vessel counts as "crossing ahead" of her. */
export const aheadLimit = (m: Model): number => clamp(8 * LENGTH[m], 80, 300)

/** Closest point of approach if both hold course and speed (centre to centre). */
export const cpa = (a: Vessel, b: Vessel): { t: number; d: number } => {
  const r = sub(b.pos, a.pos)
  const v = sub(scale(dirVec(b.heading), b.speed), scale(dirVec(a.heading), a.speed))
  const vv = dot(v, v)
  const t = vv < 1e-9 ? 0 : -dot(r, v) / vv
  const p = add(r, scale(v, Math.max(t, 0)))
  return { t, d: Math.hypot(p.x, p.y) }
}

type Phase = 'before' | 'turning' | 'holding' | 'returning' | 'done' | 'idle'

interface Mover {
  v: Vessel
  plan: Plan | null
  pos: Vec
  heading: number
  phase: Phase
  holdSince: number
}

const mover = (v: Vessel, plan: Plan | null): Mover => ({
  v,
  plan: plan && Math.abs(plan.turn) > 0.01 ? plan : null,
  pos: v.pos,
  heading: v.heading,
  phase: plan && Math.abs(plan.turn) > 0.01 ? 'before' : 'idle',
  holdSince: 0,
})

/** Would it be safe for `m` to swing back to her original course right now? */
const clearToResume = (m: Mover, o: Mover): boolean => {
  const need = safeSep(m.v.model, o.v.model) * 1.15
  const mv = scale(dirVec(m.v.heading), m.v.speed)
  const ov = scale(dirVec(o.heading), o.v.speed)
  for (let tau = 0; tau <= 60; tau += 1.5) {
    const a: Pose = { pos: add(m.pos, scale(mv, tau)), heading: m.v.heading }
    const b: Pose = { pos: add(o.pos, scale(ov, tau)), heading: o.heading }
    if (separation(a, m.v.model, b, o.v.model) < need) return false
    // Resuming must not carry her close across the other's bow either.
    const rel = sub(a.pos, b.pos)
    const fwd = dot(rel, dirVec(b.heading)) - LENGTH[o.v.model] / 2
    const lat = dot(rel, dirVec(b.heading + 90))
    if (fwd > 0 && fwd < aheadLimit(o.v.model) && Math.abs(lat) < need) return false
  }
  return true
}

const advance = (m: Mover, o: Mover, t: number, dt: number) => {
  const rate = TURN_RATE[m.v.model]
  if (m.plan) {
    const sign = Math.sign(m.plan.turn)
    const off = norm180(m.heading - m.v.heading)
    if (m.phase === 'before' && t >= m.plan.startAt) m.phase = 'turning'
    if (m.phase === 'turning') {
      const next = off + sign * rate * dt
      if (Math.abs(next) >= Math.abs(m.plan.turn)) {
        m.heading = m.v.heading + m.plan.turn
        m.phase = 'holding'
        m.holdSince = t
      } else m.heading = m.v.heading + next
    } else if (m.phase === 'holding') {
      if (t - m.holdSince >= 1.5 && clearToResume(m, o)) m.phase = 'returning'
    } else if (m.phase === 'returning') {
      const next = off - sign * rate * dt
      if (Math.sign(next) !== sign || Math.abs(next) < 0.01) {
        m.heading = m.v.heading
        m.phase = 'done'
      } else m.heading = m.v.heading + next
    }
  }
  m.pos = add(m.pos, scale(dirVec(m.heading), m.v.speed * dt))
}

export function simulate(e: Pick<Encounter, 'you' | 'other'>, planYou: Plan | null, planOther: Plan | null, dt = 0.2): Track {
  const a = mover(e.you, planYou)
  const b = mover(e.other, planOther)
  const you: Pose[] = []
  const other: Pose[] = []
  const out: Outcome = {
    minSep: Infinity,
    tMin: 0,
    collided: false,
    tCollide: Infinity,
    youCrossedAhead: false,
    otherCrossedAhead: false,
    resumed: false,
  }
  const hit = hitSep(e.you.model, e.other.model)
  const safe = safeSep(e.you.model, e.other.model)
  let prevLatA = NaN
  let prevLatB = NaN
  let end = HORIZON
  const steps = Math.round(HORIZON / dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * dt
    const pa: Pose = { pos: a.pos, heading: a.heading }
    const pb: Pose = { pos: b.pos, heading: b.heading }
    you.push(pa)
    other.push(pb)
    const sep = separation(pa, e.you.model, pb, e.other.model)
    if (sep < out.minSep) {
      out.minSep = sep
      out.tMin = t
    }
    if (sep < hit && !out.collided) {
      out.collided = true
      out.tCollide = t
      end = t
      break
    }
    // Crossing ahead: lateral offset in the other's frame changes sign while in front of her bow.
    const relA = sub(pa.pos, pb.pos)
    const latA = dot(relA, dirVec(pb.heading + 90))
    const fwdA = dot(relA, dirVec(pb.heading)) - LENGTH[e.other.model] / 2
    if (!Number.isNaN(prevLatA) && latA * prevLatA < 0 && fwdA > 0 && fwdA < aheadLimit(e.other.model)) out.youCrossedAhead = true
    prevLatA = latA
    const relB = sub(pb.pos, pa.pos)
    const latB = dot(relB, dirVec(pa.heading + 90))
    const fwdB = dot(relB, dirVec(pa.heading)) - LENGTH[e.you.model] / 2
    if (!Number.isNaN(prevLatB) && latB * prevLatB < 0 && fwdB > 0 && fwdB < aheadLimit(e.you.model)) out.otherCrossedAhead = true
    prevLatB = latB

    const settled = (m: Mover) => m.phase === 'idle' || m.phase === 'done'
    if (end === HORIZON && settled(a) && settled(b) && t > out.tMin + 6 && sep > safe * 2) end = t
    advance(a, b, t, dt)
    advance(b, a, t, dt)
  }
  const settledEnd = (m: Mover) => m.phase === 'idle' || m.phase === 'done'
  out.resumed = settledEnd(a) && settledEnd(b)
  // A vessel that never gets back on course would sail off the chart; stop watching soon after the closest approach.
  if (!out.resumed && !out.collided) end = Math.min(end, Math.max(out.tMin + 14, 30))
  return { dt, you, other, end, outcome: out }
}

/** Interpolated pose at time t. Negative t extrapolates the approach backwards. */
export function poseAt(track: Pose[], dt: number, v: Vessel, t: number): Pose {
  if (t <= 0) return { pos: add(v.pos, scale(dirVec(v.heading), v.speed * t)), heading: v.heading }
  const f = Math.min(t / dt, track.length - 1)
  const i = Math.min(Math.floor(f), track.length - 2)
  const k = f - i
  const p = track[i]
  const q = track[i + 1]
  return {
    pos: { x: lerp(p.pos.x, q.pos.x, k), y: lerp(p.pos.y, q.pos.y, k) },
    heading: p.heading + norm180(q.heading - p.heading) * k,
  }
}

/**
 * Course alterations a vessel can make to one side, smallest first.
 *
 * A sailboat can only swing so far before she is head to wind or running by
 * the lee. When there is no room at all on a side, the only "turn" that way
 * is a tack (or gybe) through to the mirror-image angle on the other board —
 * a perfectly good way to keep clear, so it is evaluated too.
 */
export function turnSizes(v: Vessel, wind: number, dir: 1 | -1): { sizes: number[]; tack: boolean } {
  if (v.status !== 'sail') return { sizes: TURN_SIZES, tack: false }
  const twa = Math.abs(windAngle(v, wind))
  // Turning toward the side the wind is on = heading up.
  const headingUp = Math.sign(windAngle(v, wind) || 1) === dir
  const room = headingUp ? twa - (NO_GO + 2) : MAX_RUN - twa
  const sizes = [...new Set(TURN_SIZES.map((m) => Math.min(m, room)).filter((m) => m >= MIN_TURN))]
  if (sizes.length) return { sizes, tack: false }
  return { sizes: [headingUp ? 2 * twa : 2 * (180 - twa)], tack: true }
}

export interface TurnResult {
  effective: boolean
  plan: Plan | null
  minSep: number
  /** The turn takes a sailboat through the wind onto the other tack. */
  tack: boolean
}

const DECIDE_AT = 0.5

/** Try turning `you` one way while the other vessel follows `planOther`. */
export function tryTurn(e: Encounter, dir: 1 | -1, planOther: Plan | null = null): TurnResult {
  const safe = safeSep(e.you.model, e.other.model)
  const { sizes, tack } = turnSizes(e.you, e.wind, dir)
  let best: TurnResult = { effective: false, plan: null, minSep: 0, tack }
  for (const size of sizes) {
    const plan: Plan = { turn: dir * size, startAt: DECIDE_AT }
    const { outcome } = simulate(e, plan, planOther)
    const ok = outcome.minSep >= safe && !outcome.youCrossedAhead && outcome.resumed && !outcome.collided
    if (ok) return { effective: true, plan, minSep: outcome.minSep, tack }
    if (outcome.minSep >= best.minSep) best = { effective: false, plan, minSep: outcome.minSep, tack }
  }
  return best
}

export const swap = (e: Encounter): Encounter => ({ ...e, you: e.other, other: e.you })

export interface Resolution {
  verdict: Verdict
  /** Answers the quiz accepts. Usually exactly one. */
  acceptable: Action[]
  /** The answer shown in the demonstration. */
  best: Action
  planYou: Plan | null
  planOther: Plan | null
  /** Your manoeuvre for each turn, right or wrong, so any answer can be played out. */
  plans: { port: Plan | null; starboard: Plan | null }
  /** An accepted answer that is a tack or gybe rather than a simple alteration. */
  tackOption?: Action
  /** Anything that makes this scenario unsuitable as a clean teaching example. */
  problems: string[]
}

const dirAction = (dir: number): Action => (dir > 0 ? 'starboard' : 'port')

/** Pick the give-way vessel's turn. Returns the effective options, best first. */
function giveWayTurns(e: Encounter, forced: 1 | null): { dir: 1 | -1; res: TurnResult }[] {
  const dirs: (1 | -1)[] = forced ? [forced] : [1, -1]
  return dirs
    .map((dir) => ({ dir, res: tryTurn(e, dir) }))
    .filter((o) => o.res.effective)
    .sort(
      (p, q) =>
        Number(p.res.tack) - Number(q.res.tack) ||
        Math.abs(p.res.plan!.turn) - Math.abs(q.res.plan!.turn) ||
        q.res.minSep - p.res.minSep,
    )
}

/**
 * The full answer to an encounter: who gives way, which turn(s) are right,
 * and the manoeuvres to animate.
 */
export function resolve(e: Encounter): Resolution {
  const verdict = classify(e)
  const problems = verdict.doubts.map((d) => `doubt: ${d}`)
  const r: Resolution = {
    verdict,
    acceptable: ['stand-on'],
    best: 'stand-on',
    planYou: null,
    planOther: null,
    plans: { port: tryTurn(e, -1).plan, starboard: tryTurn(e, 1).plan },
    problems,
  }

  if (verdict.rule === 'head-on') {
    // Rule 14: each alters to starboard. Check it works when both do.
    const safe = safeSep(e.you.model, e.other.model)
    for (const size of TURN_SIZES) {
      const py: Plan = { turn: size, startAt: DECIDE_AT }
      const po: Plan = { turn: size, startAt: DECIDE_AT }
      const { outcome } = simulate(e, py, po)
      if (outcome.minSep >= safe && outcome.resumed) {
            // If you wrongly go to port, the other vessel still turns to starboard.
        return { ...r, acceptable: ['starboard'], best: 'starboard', planYou: py, planOther: po, plans: { port: { turn: -45, startAt: DECIDE_AT }, starboard: py } }
      }
    }
    problems.push('turning to starboard does not clear the head-on')
    return { ...r, acceptable: ['starboard'], best: 'starboard' }
  }

  // Rule 15 names the manoeuvre: do not cross ahead, i.e. turn to starboard
  // and go round her stern. For the other rules any effective turn is legal.
  const forced = verdict.rule === 'crossing' ? 1 : null

  if (verdict.you === 'stand-on') {
    const opts = giveWayTurns(swap(e), forced)
    if (!opts.length) problems.push('the give-way vessel has no clean way to keep clear')
    else r.planOther = opts[0].res.plan
    return r
  }

  const opts = giveWayTurns(e, forced)
  if (!opts.length) {
    problems.push('no single turn keeps clear')
    return { ...r, acceptable: [], best: 'starboard' }
  }
  // Either side is fine when overtaking (Rule 13 only says "keep out of the
  // way"); everywhere else we insist that exactly one turn works.
  // A sailboat may also have the option of tacking or gybing away; that is
  // accepted alongside the plain alteration and explained as an alternative.
  const plain = opts.filter((o) => !o.res.tack)
  if (plain.length > 1 && verdict.rule !== 'overtaking') problems.push('either turn keeps clear')
  r.acceptable = opts.map((o) => dirAction(o.dir))
  r.best = r.acceptable[0]
  r.planYou = opts[0].res.plan
  for (const o of opts) r.plans[dirAction(o.dir) as 'port' | 'starboard'] = o.res.plan
  const tack = opts.find((o) => o.res.tack)
  if (tack && opts.length > 1) r.tackOption = dirAction(tack.dir)
  return r
}

/** Play out an answer (right or wrong) for the animation. */
export function playout(e: Encounter, res: Resolution, answer: Action): Track {
  const planYou = answer === 'stand-on' ? null : answer === res.best ? res.planYou : res.plans[answer]
  return simulate(e, planYou, res.planOther)
}
