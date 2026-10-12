// One entry point for "what is the right answer here, and what does it look like".

import { playMark, resolveMark, type MarkResolution } from './marks'
import { playout, resolve, safeSep, simulate, type Pose, type Resolution } from './motion'
import type { Action, Scenario } from './types'

export type Solved =
  | { kind: 'encounter'; acceptable: Action[]; best: Action; res: Resolution }
  | { kind: 'mark'; acceptable: Action[]; best: Action; res: MarkResolution }

export function solve(s: Scenario): Solved {
  if (s.kind === 'encounter') {
    const res = resolve(s)
    return { kind: 'encounter', acceptable: res.acceptable, best: res.best, res }
  }
  const res = resolveMark(s)
  return { kind: 'mark', acceptable: res.acceptable, best: res.best, res }
}

export interface Playback {
  dt: number
  you: Pose[]
  other?: Pose[]
  end: number
  /** What happened, for the caption under a wrong answer. */
  result: 'clear' | 'close' | 'collision' | 'crossed-ahead' | 'stuck' | 'wrong-side' | 'hit-mark'
  minSep: number
}

export function play(s: Scenario, solved: Solved, answer: Action): Playback {
  if (s.kind === 'encounter' && solved.kind === 'encounter') {
    const tr = playout(s, solved.res, answer)
    const o = tr.outcome
    const safe = o.minSep >= safeFor(s)
    const result = o.collided ? 'collision' : !safe ? 'close' : o.youCrossedAhead && answer !== 'stand-on' ? 'crossed-ahead' : !o.resumed ? 'stuck' : 'clear'
    return { dt: tr.dt, you: tr.you, other: tr.other, end: tr.end, result, minSep: o.minSep }
  }
  if (s.kind === 'mark' && solved.kind === 'mark') {
    const tr = playMark(s, answer)
    const result = tr.hit ? 'hit-mark' : tr.passedSide !== solved.res.required ? 'wrong-side' : 'clear'
    return { dt: tr.dt, you: tr.you, end: tr.end, result, minSep: tr.clearance }
  }
  throw new Error('scenario and solution do not match')
}

const safeFor = (s: Extract<Scenario, { kind: 'encounter' }>) => safeSep(s.you.model, s.other.model)

/** Both vessels carry straight on: used to show what "no risk of collision" looks like. */
export function playHold(s: Scenario): Playback {
  if (s.kind !== 'encounter') throw new Error('only encounters can be held')
  const tr = simulate(s, null, null)
  return { dt: tr.dt, you: tr.you, other: tr.other, end: Math.min(tr.end, 60), result: tr.outcome.collided ? 'collision' : 'clear', minSep: tr.outcome.minSep }
}

export * from './types'
