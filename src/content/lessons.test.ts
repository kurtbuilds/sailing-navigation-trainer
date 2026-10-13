import { describe, expect, test } from 'vitest'
import { play, solve } from '../sim'
import { TOPICS } from '../sim/generate'
import { cpa } from '../sim/motion'
import { classify } from '../sim/rules'
import { explain } from './explain'
import { LESSONS } from './lessons'

describe('lesson demonstrations', () => {
  const demos = LESSONS.flatMap((l) => [l, ...(l.sections ?? [])].flatMap((sec) => sec.demos.map((d) => ({ lesson: l.id, ...d }))))

  test.each(demos.map((d) => [`${d.lesson} / ${d.label}`, d] as const))('%s', (_name, d) => {
    const s = d.scenario
    const solved = solve(s)
    if (s.kind === 'encounter') {
      if (d.play === 'hold') {
        expect(cpa(s.you, s.other).d).toBeGreaterThan(40)
        return
      }
      const v = classify(s)
      expect(d.expect).toBeDefined()
      expect({ rule: v.rule, you: v.you }).toEqual(d.expect)
      // The "in doubt" demonstration is deliberately doubtful; nothing else may be.
      const problems = solved.kind === 'encounter' ? solved.res.problems : []
      if (!d.doubtful) expect(problems).toEqual([])
      expect(cpa(s.you, s.other).d).toBeLessThan(12)
    }
    expect(solved.acceptable.length).toBeGreaterThan(0)
    expect(play(s, solved, solved.best).result).toBe('clear')
    for (const region of ['A', 'B'] as const) {
      const ex = explain(s, solved, region)
      expect(ex.why.length).toBeGreaterThan(0)
      expect(ex.action.length).toBeGreaterThan(10)
    }
  })

  test('every quiz topic is taught by some lesson', () => {
    const taught = new Set(LESSONS.flatMap((l) => l.topics ?? []))
    for (const t of TOPICS) expect(taught.has(t), t).toBe(true)
  })
})
