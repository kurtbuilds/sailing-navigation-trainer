import { describe, expect, test } from 'vitest'
import { dirVec, dot, mulberry32, norm360, range, rotate, scale, sub, type Rng } from './geometry'
import { meet } from './generate'
import { classify, RANK, type RuleId, type Role } from './rules'
import type { Encounter, Model, Status, Vessel } from './types'

const v = (status: Status, model: Model, x: number, y: number, heading: number, speed = 3): Vessel => ({
  status,
  model,
  pos: { x, y },
  heading,
  speed,
})
const enc = (wind: number, you: Vessel, other: Vessel) => ({ wind, you, other })
const sail = (x: number, y: number, h: number, s = 3) => v('sail', 'sloop', x, y, h, s)
const power = (x: number, y: number, h: number, s = 4) => v('power', 'motorboat', x, y, h, s)

describe('textbook cases', () => {
  // Wind from the north throughout. Heading 045 = wind on the port bow = port tack.
  test('opposite tacks: port tack keeps clear of starboard tack', () => {
    const port = sail(-60, -60, 45)
    const stbd = sail(60, -60, 315)
    expect(classify(enc(0, port, stbd))).toMatchObject({ rule: 'sail-opposite-tack', you: 'give-way' })
    expect(classify(enc(0, stbd, port))).toMatchObject({ rule: 'sail-opposite-tack', you: 'stand-on' })
  })

  test('same tack: windward boat keeps clear of leeward boat', () => {
    // Both on starboard tack. The windward boat (north) reaches down onto the leeward one.
    const windward = sail(50, 40, 250)
    const leeward = sail(40, -40, 300)
    const r = classify(enc(0, windward, leeward))
    expect(r).toMatchObject({ rule: 'sail-same-tack', you: 'give-way' })
    expect(r.facts.windward).toBe('you')
    expect(classify(enc(0, leeward, windward))).toMatchObject({ rule: 'sail-same-tack', you: 'stand-on' })
  })

  test('overtaking vessel keeps clear, whatever she is', () => {
    const ahead = power(0, 0, 0, 2)
    const sailAstern = sail(5, -80, 350, 3.5)
    // A sailboat overtaking a motorboat gives way: Rule 13 beats Rule 18.
    expect(classify(enc(90, sailAstern, ahead))).toMatchObject({ rule: 'overtaking', you: 'give-way' })
    expect(classify(enc(90, ahead, sailAstern))).toMatchObject({ rule: 'overtaking', you: 'stand-on' })
    // ...and so does a sailboat overtaking a trawler, or a trawler overtaking a sailboat.
    const trawler = v('fishing', 'trawler', 0, 0, 0, 1.5)
    expect(classify(enc(90, sailAstern, trawler)).rule).toBe('overtaking')
    const fastTrawler = v('fishing', 'trawler', 0, -90, 0, 5)
    expect(classify(enc(90, sail(0, 0, 0, 2), fastTrawler))).toMatchObject({ rule: 'overtaking', you: 'stand-on' })
  })

  test('a vessel abaft the beam that is dropping back is not overtaking', () => {
    const r = classify(enc(90, power(0, 0, 0, 6), power(5, -80, 0, 3)))
    expect(r.rule).not.toBe('overtaking')
  })

  test('the stern sector starts 22.5° abaft the beam', () => {
    const ahead = power(0, 0, 0, 2)
    const at = (deg: number) => {
      const p = scale(dirVec(deg), 80)
      return power(p.x, p.y, deg + 180, 6) // steering straight at her
    }
    expect(classify(enc(0, at(125), ahead)).rule).toBe('overtaking')
    expect(classify(enc(0, at(100), ahead)).rule).toBe('crossing')
    expect(classify(enc(0, at(-125), ahead)).rule).toBe('overtaking')
    expect(classify(enc(0, at(-100), ahead)).rule).toBe('crossing')
  })

  test('power head-on: both give way', () => {
    expect(classify(enc(0, power(0, -100, 0), power(2, 100, 180)))).toMatchObject({
      rule: 'head-on',
      you: 'give-way',
      other: 'give-way',
    })
  })

  test('power crossing: the vessel with the other on her starboard side keeps clear', () => {
    const you = power(0, -100, 0)
    const fromStarboard = power(100, 0, 270)
    const fromPort = power(-100, 0, 90)
    expect(classify(enc(0, you, fromStarboard))).toMatchObject({ rule: 'crossing', you: 'give-way' })
    expect(classify(enc(0, you, fromPort))).toMatchObject({ rule: 'crossing', you: 'stand-on' })
  })

  test('power gives way to sail', () => {
    const s = sail(0, -100, 60)
    const p = power(100, 0, 270)
    expect(classify(enc(0, s, p))).toMatchObject({ rule: 'sail-vs-power', you: 'stand-on' })
    expect(classify(enc(0, p, s))).toMatchObject({ rule: 'sail-vs-power', you: 'give-way' })
  })

  test('a sailboat motoring is a power-driven vessel', () => {
    const motoring = v('power', 'sloop', 0, -100, 0)
    expect(classify(enc(0, motoring, power(100, 0, 270))).rule).toBe('crossing')
    expect(classify(enc(0, motoring, sail(100, 0, 270)))).toMatchObject({ rule: 'sail-vs-power', you: 'give-way' })
  })

  test('pecking order: everyone keeps clear of the vessels above them', () => {
    const order: Status[] = ['nuc', 'ram', 'fishing', 'sail', 'power']
    const model: Record<Status, Model> = { nuc: 'ship', ram: 'dredger', fishing: 'trawler', sail: 'sloop', power: 'motorboat' }
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const hi = v(order[i], model[order[i]], 100, 0, 270, 2)
        const lo = v(order[j], model[order[j]], 0, -100, 60, 2)
        expect(RANK[order[i]]).toBeLessThan(RANK[order[j]])
        expect(classify(enc(0, lo, hi)).you, `${order[j]} vs ${order[i]}`).toBe('give-way')
        expect(classify(enc(0, hi, lo)).you, `${order[i]} vs ${order[j]}`).toBe('stand-on')
      }
    }
  })

  test('narrow channel: do not impede a vessel confined to it, even under sail', () => {
    const ship: Vessel = { ...v('power', 'ship', 0, -200, 0, 5), confined: true }
    expect(classify(enc(0, sail(-100, 0, 90), ship))).toMatchObject({ rule: 'narrow-channel', you: 'give-way' })
  })
})

// --- Property tests -------------------------------------------------------

const STATUS: [Status, Model][] = [
  ['sail', 'sloop'],
  ['sail', 'sloop'],
  ['power', 'motorboat'],
  ['power', 'sloop'],
  ['fishing', 'trawler'],
  ['ram', 'dredger'],
  ['nuc', 'ship'],
]

function randomEncounter(rng: Rng): Pick<Encounter, 'wind' | 'you' | 'other'> {
  const mk = (): Vessel => {
    const [status, model] = STATUS[Math.floor(rng() * STATUS.length)]
    return v(status, model, 0, 0, range(rng, 0, 360), range(rng, 0.5, 7))
  }
  // The rules only speak when there is risk of collision, so put the pair on
  // a (near) collision course: both reach the origin at about the same time.
  return { wind: range(rng, 0, 360), ...meet(mk(), mk(), range(rng, 10, 40), range(rng, -8, 8)) }
}

const flip = (r: Role): Role => (r === 'give-way' ? 'stand-on' : 'give-way')

describe('invariants over random encounters', () => {
  const N = 20000

  test('roles are complementary and swap with the point of view', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < N; i++) {
      const e = randomEncounter(rng)
      const a = classify(e)
      const b = classify({ wind: e.wind, you: e.other, other: e.you })
      expect(b.rule).toBe(a.rule)
      if (a.doubts.length) continue
      if (a.rule === 'head-on') {
        expect([a.you, a.other, b.you, b.other]).toEqual(['give-way', 'give-way', 'give-way', 'give-way'])
      } else {
        expect(a.other).toBe(flip(a.you))
        expect(b.you).toBe(a.other)
      }
    }
  })

  test('nothing changes when the whole picture is rotated and shifted', () => {
    const rng = mulberry32(2)
    for (let i = 0; i < N; i++) {
      const e = randomEncounter(rng)
      const turn = range(rng, 0, 360)
      const shift = { x: range(rng, -500, 500), y: range(rng, -500, 500) }
      const move = (b: Vessel): Vessel => {
        const p = rotate(b.pos, turn)
        return { ...b, heading: norm360(b.heading + turn), pos: { x: p.x + shift.x, y: p.y + shift.y } }
      }
      const a = classify(e)
      const b = classify({ wind: norm360(e.wind + turn), you: move(e.you), other: move(e.other) })
      if (a.doubts.length || b.doubts.length) continue // exactly on a boundary, rounding may tip it
      expect([b.rule, b.you]).toEqual([a.rule, a.you])
    }
  })

  test('a mirror image swaps the roles only for the port/starboard rules', () => {
    const rng = mulberry32(3)
    const handed: RuleId[] = ['sail-opposite-tack', 'crossing']
    for (let i = 0; i < N; i++) {
      const e = randomEncounter(rng)
      const mirror = (b: Vessel): Vessel => ({ ...b, heading: norm360(-b.heading), pos: { x: -b.pos.x, y: b.pos.y } })
      const a = classify(e)
      const b = classify({ wind: norm360(-e.wind), you: mirror(e.you), other: mirror(e.other) })
      if (a.doubts.length || b.doubts.length) continue
      expect(b.rule).toBe(a.rule)
      expect(b.you).toBe(handed.includes(a.rule) ? flip(a.you) : a.you)
    }
  })

  // A second implementation, written with vectors instead of bearings, as an
  // independent check on the classifier.
  function oracle(e: Pick<Encounter, 'wind' | 'you' | 'other'>): [RuleId, Role] {
    const { you, other, wind } = e
    const fwd = (b: Vessel) => dirVec(b.heading)
    const right = (b: Vessel) => dirVec(b.heading + 90)
    const vel = (b: Vessel) => scale(fwd(b), b.speed)
    const cos675 = Math.cos((67.5 * Math.PI) / 180)
    // a overtakes b: a lies inside the 135° cone behind b, and the gap is shrinking.
    const overtakes = (a: Vessel, b: Vessel) => {
      const r = sub(a.pos, b.pos)
      const d = Math.hypot(r.x, r.y)
      const inCone = dot(r, scale(fwd(b), -1)) / d > cos675
      return inCone && dot(r, sub(vel(a), vel(b))) < 0
    }
    if (overtakes(you, other)) return ['overtaking', 'give-way']
    if (overtakes(other, you)) return ['overtaking', 'stand-on']
    if (other.confined && !you.confined) return ['narrow-channel', 'give-way']
    const order = ['nuc', 'ram', 'fishing', 'sail', 'power']
    const iy = order.indexOf(you.status)
    const io = order.indexOf(other.status)
    if (iy !== io) {
      const pair = new Set([you.status, other.status])
      const rule: RuleId = pair.has('sail') && pair.has('power') ? 'sail-vs-power' : 'hierarchy'
      return [rule, iy > io ? 'give-way' : 'stand-on']
    }
    const windFrom = dirVec(wind)
    if (you.status === 'sail') {
      // Wind comes over the starboard side when the upwind direction is to the right of the bow.
      const stbdTack = (b: Vessel) => dot(windFrom, right(b)) >= 0
      if (stbdTack(you) !== stbdTack(other)) return ['sail-opposite-tack', stbdTack(you) ? 'stand-on' : 'give-way']
      return ['sail-same-tack', dot(sub(you.pos, other.pos), windFrom) > 0 ? 'give-way' : 'stand-on']
    }
    const toOther = sub(other.pos, you.pos)
    const toYou = sub(you.pos, other.pos)
    const d = Math.hypot(toOther.x, toOther.y)
    const cos10 = Math.cos((10 * Math.PI) / 180)
    if (dot(toOther, fwd(you)) / d >= cos10 && dot(toYou, fwd(other)) / d >= cos10) return ['head-on', 'give-way']
    return ['crossing', dot(toOther, right(you)) > 0 ? 'give-way' : 'stand-on']
  }

  test('agrees with an independent vector-based implementation', () => {
    const rng = mulberry32(4)
    let compared = 0
    for (let i = 0; i < N; i++) {
      const e = randomEncounter(rng)
      const a = classify(e)
      if (a.doubts.length) continue
      compared++
      expect([a.rule, a.you]).toEqual(oracle(e))
    }
    expect(compared).toBeGreaterThan(N / 3)
  })
})
