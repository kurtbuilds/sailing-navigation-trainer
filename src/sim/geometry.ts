// Plane geometry helpers. World frame: x = east, y = north, metres.
// Headings and bearings are compass degrees (0 = north, clockwise).

export interface Vec {
  x: number
  y: number
}

export const DEG = Math.PI / 180

export const norm360 = (a: number): number => ((a % 360) + 360) % 360

/** Normalise to (-180, 180]. */
export const norm180 = (a: number): number => {
  const n = norm360(a)
  return n > 180 ? n - 360 : n
}

export const dirVec = (heading: number): Vec => ({
  x: Math.sin(heading * DEG),
  y: Math.cos(heading * DEG),
})

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
export const len = (a: Vec): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Compass bearing from one point to another. */
export const bearing = (from: Vec, to: Vec): number =>
  norm360(Math.atan2(to.x - from.x, to.y - from.y) / DEG)

/**
 * Bearing of `target` relative to a vessel's bow: 0 = dead ahead,
 * positive = starboard side, negative = port side, ±180 = dead astern.
 */
export const relBearing = (pos: Vec, heading: number, target: Vec): number =>
  norm180(bearing(pos, target) - heading)

export const rotate = (v: Vec, deg: number): Vec => {
  // clockwise (compass) rotation
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Small seeded PRNG so generated scenarios are reproducible in tests. */
export type Rng = () => number
export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng()
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]
export const coin = (rng: Rng, p = 0.5): boolean => rng() < p
