import { describe, expect, test } from 'vitest'
import { mulberry32, norm360, range, relBearing } from './geometry'
import { checkEncounter, generate, isMarkTopic, MAX_RANGE, MIN_RANGE, RISK_CPA, TOPICS, type Topic } from './generate'
import { play, solve } from './index'
import { markOffset, MARK_CLEAR, playMark, requiredSide, resolveMark } from './marks'
import { cpa, safeSep } from './motion'
import { classify, HEAD_ON_DOUBT, HEAD_ON_LIMIT, HEAD_ON_SURE, NO_GO, RUN_DOUBT, SECTOR_DOUBT, STERN_SECTOR, windAngle, type RuleId } from './rules'
import type { Action, Encounter, MarkScenario, Vessel } from './types'

const N = 250
const encounterTopics = TOPICS.filter((t) => !isMarkTopic(t))
const many = (topic: Topic, seed = 7, n = N) => {
  const rng = mulberry32(seed)
  return Array.from({ length: n }, () => generate(topic, rng))
}
const encounters = (topic: Topic, seed = 7, n = N) => many(topic, seed, n) as Encounter[]
const TIMEOUT = 120_000

describe.each(encounterTopics)('generated %s scenarios', (topic) => {
  const list = encounters(topic)

  test('demonstrate exactly the intended rule, with no doubt and a real risk of collision', () => {
    for (const e of list) {
      const v = classify(e)
      expect(v.rule).toBe(topic as RuleId)
      expect(v.doubts).toEqual([])
      const c = cpa(e.you, e.other)
      expect(c.d).toBeLessThanOrEqual(RISK_CPA)
      expect(c.t).toBeGreaterThan(0)
      const r = Math.hypot(e.you.pos.x - e.other.pos.x, e.you.pos.y - e.other.pos.y)
      expect(r).toBeGreaterThanOrEqual(MIN_RANGE)
      expect(r).toBeLessThanOrEqual(MAX_RANGE)
      expect(checkEncounter(e, { rule: v.rule, you: v.you })).toEqual([])
    }
  }, TIMEOUT)

  test('stay well inside the bounds that separate this rule from its neighbours', () => {
    for (const e of list) {
      const v = classify(e)
      const bearings = [v.facts.otherFromYou, v.facts.youFromOther].map(Math.abs)
      // Never near the overtaking boundary, from either boat's point of view.
      for (const b of bearings) expect(Math.abs(b - STERN_SECTOR)).toBeGreaterThanOrEqual(SECTOR_DOUBT)
      // Sailboats are clearly on one tack, and actually able to sail their course.
      for (const b of [e.you, e.other]) {
        if (b.status !== 'sail') continue
        const twa = Math.abs(windAngle(b, e.wind))
        expect(twa).toBeGreaterThan(NO_GO + 3)
        expect(twa).toBeLessThan(RUN_DOUBT - 5)
      }
      if (topic === 'overtaking') {
        const [fast, slow] = v.you === 'give-way' ? [e.you, e.other] : [e.other, e.you]
        expect(Math.abs(relBearing(slow.pos, slow.heading, fast.pos))).toBeGreaterThan(STERN_SECTOR + SECTOR_DOUBT)
        expect(fast.speed).toBeGreaterThan(slow.speed)
      } else {
        for (const b of bearings) expect(b).toBeLessThan(STERN_SECTOR - SECTOR_DOUBT)
      }
      if (topic === 'head-on') for (const b of bearings) expect(b).toBeLessThanOrEqual(HEAD_ON_SURE)
      if (topic === 'crossing') {
        // Nowhere near head-on: at least one vessel sees the other well off the bow.
        expect(Math.max(...bearings)).toBeGreaterThan(HEAD_ON_DOUBT)
        expect(Math.min(...bearings)).toBeGreaterThan(HEAD_ON_LIMIT)
        expect(v.facts.otherFromYou > 0).toBe(v.you === 'give-way')
      }
      if (topic === 'sail-opposite-tack') expect(v.facts.youTack).not.toBe(v.facts.otherTack)
      if (topic === 'sail-same-tack') expect(v.facts.youTack).toBe(v.facts.otherTack)
      if (topic === 'sail-vs-power' || topic === 'sail-opposite-tack' || topic === 'sail-same-tack') {
        expect([e.you.status, e.other.status].every((s) => s === 'sail' || s === 'power')).toBe(true)
      }
    }
  })

  test('keep the same answer when the picture is nudged (no knife-edge cases)', () => {
    const rng = mulberry32(99)
    const nudge = (b: Vessel): Vessel => ({
      ...b,
      heading: norm360(b.heading + range(rng, -3, 3)),
      pos: { x: b.pos.x + range(rng, -3, 3), y: b.pos.y + range(rng, -3, 3) },
    })
    for (const e of list) {
      const v = classify(e)
      for (let k = 0; k < 8; k++) {
        const n = classify({ wind: e.wind + range(rng, -3, 3), you: nudge(e.you), other: nudge(e.other) })
        expect([n.rule, n.you]).toEqual([v.rule, v.you])
      }
    }
  })

  test('the accepted answer resolves the encounter; every other answer does not', () => {
    for (const e of list) {
      const solved = solve(e)
      const v = classify(e)
      expect(solved.acceptable.length).toBeGreaterThan(0)
      if (v.you === 'stand-on') expect(solved.acceptable).toEqual(['stand-on'])
      else expect(solved.acceptable).not.toContain('stand-on')
      // Only overtaking may accept a plain turn either way. Elsewhere a second
      // accepted answer has to be a sailboat tacking or gybing away.
      if (topic !== 'overtaking' && solved.kind === 'encounter') {
        const extra = solved.acceptable.filter((a) => a !== solved.res.tackOption)
        expect(extra).toHaveLength(1)
        if (solved.res.tackOption) expect(e.you.status).toBe('sail')
      }
      if (topic === 'head-on' || (topic === 'crossing' && v.you === 'give-way')) expect(solved.best).toBe('starboard')

      for (const a of solved.acceptable) {
        const p = play(e, solved, a)
        expect(p.result, `${e.id} answering ${a}`).toBe('clear')
        expect(p.minSep).toBeGreaterThanOrEqual(safeSep(e.you.model, e.other.model) * 0.99)
      }
      if (v.you === 'give-way') {
        // Holding on when you should give way must end badly.
        // (Head-on is the exception: the other vessel's turn alone may be enough.)
        if (topic !== 'head-on') expect(['collision', 'close']).toContain(play(e, solved, 'stand-on').result)
        // A turn the quiz rejects must really be worse than the accepted one.
        for (const a of ['port', 'starboard'] as Action[]) {
          if (solved.acceptable.includes(a) || topic === 'head-on' || topic === 'crossing') continue
          expect(play(e, solved, a).result, `${e.id} answering ${a}`).not.toBe('clear')
        }
      }
    }
  }, TIMEOUT)

  test('generation is efficient', () => {
    const stats = { attempts: 0, rejected: {} }
    const rng = mulberry32(5)
    for (let i = 0; i < 100; i++) generate(topic, rng, { stats })
    expect(stats.attempts / 100).toBeLessThan(8)
  }, TIMEOUT)
})

describe('variety', () => {
  test('two-sided rules produce both roles, and give-way cases produce both turns', () => {
    for (const topic of encounterTopics) {
      const answers = new Set(encounters(topic, 11, 120).map((e) => solve(e).best))
      if (topic === 'head-on' || topic === 'crossing') expect(answers.has('starboard')).toBe(true)
      else expect(answers.has('port') && answers.has('starboard'), topic).toBe(true)
      const twoSided = !['head-on', 'hierarchy', 'narrow-channel'].includes(topic)
      expect(answers.has('stand-on'), topic).toBe(twoSided)
    }
  }, TIMEOUT)

  test('night scenarios are the same encounters with the lights on', () => {
    const rng = mulberry32(3)
    for (const topic of encounterTopics) {
      const e = generate(topic, rng, { night: true }) as Encounter
      expect(!!e.night).toBe(topic !== 'narrow-channel')
    }
  })
})

describe.each(['lateral-marks', 'preferred-marks'] as Topic[])('generated %s scenarios', (topic) => {
  const list = many(topic, 21, 600) as MarkScenario[]

  test('the answer matches a from-scratch reading of the buoyage rules', () => {
    for (const s of list) {
      // Returning: port-hand marks to port. Preferred-channel marks count as the hand of their main colour.
      const hand = s.mark.kind === 'port-hand' || s.mark.kind === 'pref-starboard' ? 'port' : 'starboard'
      const keepOn = s.direction === 'returning' ? hand : hand === 'port' ? 'starboard' : 'port'
      expect(requiredSide(s)).toBe(keepOn)
      const off = markOffset(s)
      const onRightSide = keepOn === 'port' ? -off : off
      const expected: Action = onRightSide >= MARK_CLEAR ? 'stand-on' : keepOn === 'port' ? 'starboard' : 'port'
      expect(resolveMark(s).best).toBe(expected)
      expect(resolveMark(s).problems).toEqual([])
    }
  })

  test('the accepted answer leaves the mark on the correct side; the others do not improve on it', () => {
    for (const s of list) {
      const solved = solve(s)
      const good = playMark(s, solved.best)
      expect(good.hit).toBe(false)
      expect(good.passedSide).toBe(requiredSide(s))
      expect(good.clearance).toBeGreaterThanOrEqual(MARK_CLEAR - 0.5)
      if (solved.best !== 'stand-on') {
        expect(play(s, solved, 'stand-on').result).not.toBe('clear')
        const opposite: Action = solved.best === 'port' ? 'starboard' : 'port'
        expect(play(s, solved, opposite).result).toBe('wrong-side')
      }
    }
  })

  test('covers both hands, both directions and all three answers', () => {
    expect(new Set(list.map((s) => s.mark.kind)).size).toBe(2)
    expect(new Set(list.map((s) => s.direction)).size).toBe(2)
    expect(new Set(list.map((s) => solve(s).best)).size).toBe(3)
  })
})
