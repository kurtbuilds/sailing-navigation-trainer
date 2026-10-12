import { describe, expect, test } from 'vitest'
import { markLook, markNumber, requiredSide } from './marks'
import type { Mark } from './types'

const at = (kind: Mark['kind']): Mark => ({ kind, pos: { x: 0, y: 0 }, label: '3' })

describe('lateral marks', () => {
  test('Region B: red, right, returning', () => {
    expect(markLook('starboard-hand', 'B')).toEqual({ color: 'red', shape: 'cone' })
    expect(markLook('port-hand', 'B')).toEqual({ color: 'green', shape: 'can' })
  })
  test('Region A: red to port when returning', () => {
    expect(markLook('port-hand', 'A')).toEqual({ color: 'red', shape: 'can' })
    expect(markLook('starboard-hand', 'A')).toEqual({ color: 'green', shape: 'cone' })
  })
  test('shape never changes with region: cans to port, cones to starboard', () => {
    for (const r of ['A', 'B'] as const) {
      expect(markLook('port-hand', r).shape).toBe('can')
      expect(markLook('pref-starboard', r).shape).toBe('can')
      expect(markLook('starboard-hand', r).shape).toBe('cone')
      expect(markLook('pref-port', r).shape).toBe('cone')
    }
  })
  test('preferred-channel marks: main colour of the hand they act as, one band of the other colour', () => {
    expect(markLook('pref-starboard', 'A')).toEqual({ color: 'red', band: 'green', shape: 'can' })
    expect(markLook('pref-port', 'A')).toEqual({ color: 'green', band: 'red', shape: 'cone' })
    expect(markLook('pref-starboard', 'B')).toEqual({ color: 'green', band: 'red', shape: 'can' })
    expect(markLook('pref-port', 'B')).toEqual({ color: 'red', band: 'green', shape: 'cone' })
  })
  test('leaving harbour reverses the sides', () => {
    expect(requiredSide({ mark: at('port-hand'), direction: 'returning' })).toBe('port')
    expect(requiredSide({ mark: at('port-hand'), direction: 'leaving' })).toBe('starboard')
    expect(requiredSide({ mark: at('pref-port'), direction: 'returning' })).toBe('starboard')
    expect(requiredSide({ mark: at('pref-port'), direction: 'leaving' })).toBe('port')
  })
  test('red marks are even-numbered, green odd', () => {
    for (const r of ['A', 'B'] as const) {
      for (const k of ['port-hand', 'starboard-hand'] as const) {
        const n = Number(markNumber(at(k), r))
        expect(n % 2 === 0).toBe(markLook(k, r).color === 'red')
      }
    }
  })
})
