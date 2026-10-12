// Navigation lights (COLREGS Part C). Each light shows over a fixed arc
// measured from the vessel's own bow, which is what lets you read another
// vessel's heading at night.

import { norm180, norm360, relBearing, type Vec } from './geometry'
import type { Model, Status, Vessel } from './types'

export type LightColor = 'red' | 'green' | 'white'

export interface NavLight {
  name: 'port sidelight' | 'starboard sidelight' | 'sternlight' | 'masthead light' | 'all-round light'
  color: LightColor
  /** Arc of visibility, degrees clockwise from the bow: from → to. */
  from: number
  to: number
  /** Position on the model: [to starboard, up, forward] in metres. */
  at: [number, number, number]
}

const SIDE = 112.5
const port = (at: NavLight['at']): NavLight => ({ name: 'port sidelight', color: 'red', from: -SIDE, to: 0, at })
const stbd = (at: NavLight['at']): NavLight => ({ name: 'starboard sidelight', color: 'green', from: 0, to: SIDE, at })
const stern = (at: NavLight['at']): NavLight => ({ name: 'sternlight', color: 'white', from: SIDE, to: 360 - SIDE, at })
const mast = (at: NavLight['at']): NavLight => ({ name: 'masthead light', color: 'white', from: -SIDE, to: SIDE, at })
const allRound = (color: LightColor, at: NavLight['at']): NavLight => ({ name: 'all-round light', color, from: 0, to: 360, at })

/** Sidelights and sternlight: carried by every vessel making way. */
const RUNNING: Record<Model, NavLight[]> = {
  sloop: [port([-1.1, 1.5, 4.4]), stbd([1.1, 1.5, 4.4]), stern([0, 1.5, -5])],
  motorboat: [port([-1.1, 1.7, 1.6]), stbd([1.1, 1.7, 1.6]), stern([0, 1.3, -3.9])],
  trawler: [port([-3, 4.6, 6]), stbd([3, 4.6, 6]), stern([0, 3.2, -10.8])],
  dredger: [port([-6.5, 3.5, 10]), stbd([6.5, 3.5, 10]), stern([0, 3.2, -22.5])],
  ship: [port([-9, 21, -40]), stbd([9, 21, -40]), stern([0, 9, -59.5])],
}

/** What marks out each kind of vessel, on top of the running lights. */
function identity(status: Status, model: Model): NavLight[] {
  switch (status) {
    case 'sail':
      return [] // sidelights and sternlight only
    case 'power':
      if (model === 'ship') return [mast([0, 19, 46]), mast([0, 31, -42])] // over 50 m: second masthead light, aft and higher
      if (model === 'sloop') return [mast([0, 8.5, -0.9])] // the "steaming light" part-way up the mast
      if (model === 'trawler') return [mast([0, 10.5, 4.5])]
      if (model === 'dredger') return [mast([0, 12, -15])]
      return [mast([0, 4.3, 0.2])]
    case 'fishing':
      // Trawling: green over white, all round.
      return [allRound('green', [0, 11.2, 4.5]), allRound('white', [0, 9.6, 4.5])]
    case 'ram':
      // Restricted in ability to manoeuvre: red, white, red in a vertical line, plus a masthead light when making way.
      return [
        allRound('red', [0, 17, -15]),
        allRound('white', [0, 15.2, -15]),
        allRound('red', [0, 13.4, -15]),
        mast([0, 11, -15]),
      ]
    case 'nuc':
      // Not under command: two red all-round lights, no masthead light.
      return [allRound('red', [0, 31, -42]), allRound('red', [0, 28, -42])]
  }
}

export const navLights = (v: Pick<Vessel, 'status' | 'model'>): NavLight[] => [
  ...identity(v.status, v.model),
  ...RUNNING[v.model],
]

export const inArc = (bearingFromBow: number, l: Pick<NavLight, 'from' | 'to'>): boolean => {
  if (l.to - l.from >= 360) return true
  return norm360(bearingFromBow - l.from) <= norm360(l.to - l.from)
}

/** The lights of `v` that an observer at `eye` can see. */
export function visibleLights(v: Pick<Vessel, 'status' | 'model'>, pos: Vec, heading: number, eye: Vec): NavLight[] {
  const b = relBearing(pos, heading, eye)
  return navLights(v).filter((l) => inArc(b, l))
}

/** Plain-language reading of what a set of lights tells you. */
export function describeAspect(bearingFromHerBow: number): string {
  const b = norm180(bearingFromHerBow)
  const a = Math.abs(b)
  if (a > SIDE) return 'her stern'
  if (a < 3) return 'her bow, head-on'
  return b < 0 ? 'her port side' : 'her starboard side'
}
