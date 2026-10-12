import type { Vec } from './geometry'

/** IALA buoyage region. B = the Americas, Japan, Korea, Philippines. A = everywhere else. */
export type Region = 'A' | 'B'

export type Side = 'port' | 'starboard'

/** The three answers a helmsman can give. */
export type Action = 'stand-on' | 'port' | 'starboard'

/**
 * What a vessel *is* under the rules (Rule 3), which is what decides the
 * pecking order — not what kind of boat it looks like. A sloop with its
 * engine driving it is `power`.
 */
export type Status = 'sail' | 'power' | 'fishing' | 'ram' | 'nuc'

export type Model = 'sloop' | 'motorboat' | 'trawler' | 'dredger' | 'ship'

export interface Vessel {
  status: Status
  model: Model
  pos: Vec
  /** compass degrees */
  heading: number
  /** metres / second */
  speed: number
  /** Can only navigate safely inside the marked channel (Rule 9). */
  confined?: boolean
}

export const LENGTH: Record<Model, number> = {
  sloop: 10,
  motorboat: 8,
  trawler: 22,
  dredger: 46,
  ship: 120,
}

/**
 * Lateral marks are described by which hand they are on when travelling in
 * the conventional direction of buoyage (returning from sea). Colour comes
 * from the region; shape does not change: port-hand marks are cans,
 * starboard-hand marks are cones (nuns).
 *
 * A preferred-channel mark sits where a channel splits. `pref-starboard`
 * means the preferred channel is to starboard, so the mark is treated as a
 * port-hand mark; `pref-port` is the mirror image.
 */
export type MarkKind = 'port-hand' | 'starboard-hand' | 'pref-starboard' | 'pref-port'

export interface Mark {
  kind: MarkKind
  pos: Vec
  label?: string
}

export interface Scenery {
  /** Compass bearing (from the origin) of the harbour / land. */
  shoreBearing?: number
  /** Extra marks drawn for context (channel edges etc.). */
  marks?: Mark[]
}

interface ScenarioBase {
  id: string
  /** Direction the wind is blowing FROM, compass degrees. */
  wind: number
  you: Vessel
  night?: boolean
  scenery?: Scenery
}

export interface Encounter extends ScenarioBase {
  kind: 'encounter'
  other: Vessel
}

export interface MarkScenario extends ScenarioBase {
  kind: 'mark'
  mark: Mark
  /** Travelling with the direction of buoyage (returning) or against it. */
  direction: 'returning' | 'leaving'
}

export type Scenario = Encounter | MarkScenario
