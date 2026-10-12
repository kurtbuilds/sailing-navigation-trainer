import { describe, expect, test } from 'vitest'
import { dirVec, scale } from './geometry'
import { navLights, visibleLights } from './lights'
import type { Model, Status } from './types'

const seen = (status: Status, model: Model, fromBearing: number) =>
  visibleLights({ status, model }, { x: 0, y: 0 }, 0, scale(dirVec(fromBearing), 200))
    .map((l) => l.color)
    .sort()
    .join(' ')

describe('navigation lights', () => {
  test('a sailboat shows red to port, green to starboard, white astern, never two at once (except dead ahead)', () => {
    expect(seen('sail', 'sloop', -60)).toBe('red')
    expect(seen('sail', 'sloop', 60)).toBe('green')
    expect(seen('sail', 'sloop', 180)).toBe('white')
    expect(seen('sail', 'sloop', 0)).toBe('green red')
    expect(seen('sail', 'sloop', 110)).toBe('green')
    expect(seen('sail', 'sloop', 115)).toBe('white')
    expect(seen('sail', 'sloop', -115)).toBe('white')
  })
  test('a power-driven vessel adds a white masthead light over the same arc as both sidelights', () => {
    expect(seen('power', 'motorboat', -60)).toBe('red white')
    expect(seen('power', 'motorboat', 0)).toBe('green red white')
    expect(seen('power', 'motorboat', 180)).toBe('white')
    expect(seen('power', 'sloop', 60)).toBe('green white')
    expect(seen('power', 'ship', 60)).toBe('green white white')
  })
  test('trawler: green over white; restricted: red-white-red; not under command: red over red', () => {
    expect(seen('fishing', 'trawler', 180)).toBe('green white white')
    expect(seen('fishing', 'trawler', -60)).toBe('green red white')
    expect(seen('ram', 'dredger', 180)).toBe('red red white white')
    expect(seen('ram', 'dredger', 60)).toBe('green red red white white')
    expect(seen('nuc', 'ship', 60)).toBe('green red red')
    expect(seen('nuc', 'ship', 180)).toBe('red red white')
  })
  test('from any direction you see a sidelight or the sternlight, never neither', () => {
    for (const [status, model] of [['sail', 'sloop'], ['power', 'motorboat'], ['fishing', 'trawler']] as [Status, Model][]) {
      for (let b = -180; b < 180; b += 0.5) {
        const names = visibleLights({ status, model }, { x: 0, y: 0 }, 37, scale(dirVec(b + 37), 100)).map((l) => l.name)
        const running = names.filter((n) => n.includes('sidelight') || n === 'sternlight')
        expect(running.length).toBeGreaterThanOrEqual(1)
        if (Math.abs(b) > 1 && Math.abs(Math.abs(b) - 112.5) > 1) expect(running.length).toBe(1)
      }
      expect(navLights({ status, model }).length).toBeGreaterThanOrEqual(3)
    }
  })
})
