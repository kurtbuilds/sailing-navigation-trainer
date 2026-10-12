// Procedural vessel models. Local frame: -Z is the bow, +X is starboard,
// Y is up, origin amidships on the waterline. All sizes in metres.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three'
import { LENGTH, type Model, type Status } from '../sim/types'
import { BEAM } from '../sim/motion'

const mat = (color: number, rough = 0.7, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
  new MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, ...extra })

const smooth = (t: number) => t * t * (3 - 2 * t)

interface HullSpec {
  length: number
  beam: number
  freeboard: number
  draft: number
  /** Transom width as a fraction of the beam. */
  stern: number
  /** How much the sheer rises toward the bow, as a fraction of freeboard. */
  rise: number
  /** How far the stem overhangs the waterline, metres. */
  rake: number
  /** 2 = fine yacht bow, 5+ = bluff ship bow. */
  fullness: number
  top: number
  bottom: number
}

function hull(spec: HullSpec): { sides: BufferGeometry; deck: BufferGeometry; gunwale: (t: number) => number } {
  const N = 20
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const deckPos: number[] = []
  const deckIdx: number[] = []
  const top = new Color(spec.top)
  const bottom = new Color(spec.bottom)
  const gunwale = (t: number) => spec.freeboard * (1 + spec.rise * Math.pow(t, 2.5))
  const ROWS = 6
  for (let i = 0; i <= N; i++) {
    const t = i / N // 0 = stern, 1 = bow
    const mid = 0.4
    const w =
      t < mid
        ? spec.stern + (1 - spec.stern) * smooth(t / mid)
        : Math.pow(Math.max(0, 1 - Math.pow((t - mid) / (1 - mid), spec.fullness)), 0.8)
    const b = (spec.beam / 2) * w
    const g = gunwale(t)
    const z = spec.length / 2 - t * (spec.length - spec.rake)
    const keel = -spec.draft * (1 - Math.pow(t, 3)) * (0.5 + 0.5 * Math.min(1, t * 3))
    // Section from keel to gunwale; the waterline row is doubled for a crisp boot-top.
    const rows: [number, number, Color][] = [
      [0, keel, bottom],
      [0.6 * b, keel * 0.55, bottom],
      [0.92 * b, 0.12, bottom],
      [0.92 * b, 0.12, top],
      [0.985 * b, g * 0.55, top],
      [b, g, top],
    ]
    for (const side of [1, -1]) {
      for (const [x, y, c] of rows) {
        const zz = z - spec.rake * Math.pow(t, 3) * Math.max(0, y / g)
        pos.push(side * x, y, zz)
        col.push(c.r, c.g, c.b)
      }
    }
    deckPos.push(b * 0.97, g - 0.06, z - spec.rake * Math.pow(t, 3), -b * 0.97, g - 0.06, z - spec.rake * Math.pow(t, 3))
    if (i < N) {
      const a = i * ROWS * 2
      const n = (i + 1) * ROWS * 2
      for (const off of [0, ROWS]) {
        for (const r of [0, 1, 3, 4]) {
          idx.push(a + off + r, n + off + r, a + off + r + 1, n + off + r, n + off + r + 1, a + off + r + 1)
        }
      }
      const d = i * 2
      deckIdx.push(d, d + 1, d + 2, d + 1, d + 3, d + 2)
    }
  }
  // Transom.
  for (const r of [0, 1, 3, 4]) idx.push(r, r + 1, ROWS + r, r + 1, ROWS + r + 1, ROWS + r)
  const sides = new BufferGeometry()
  sides.setAttribute('position', new Float32BufferAttribute(pos, 3))
  sides.setAttribute('color', new Float32BufferAttribute(col, 3))
  sides.setIndex(idx)
  sides.computeVertexNormals()
  const deck = new BufferGeometry()
  deck.setAttribute('position', new Float32BufferAttribute(deckPos, 3))
  deck.setIndex(deckIdx)
  deck.computeVertexNormals()
  return { sides, deck, gunwale }
}

function hullMesh(spec: HullSpec, deckColor: number): { group: Group; gunwale: (t: number) => number } {
  const h = hull(spec)
  const group = new Group()
  group.add(new Mesh(h.sides, new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, side: DoubleSide })))
  group.add(new Mesh(h.deck, mat(deckColor, 0.9, { side: DoubleSide })))
  return { group, gunwale: h.gunwale }
}

const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m)
  mesh.position.set(x, y + h / 2, z)
  return mesh
}
const post = (r: number, h: number, m: Material, x: number, y: number, z: number) => {
  const mesh = new Mesh(new CylinderGeometry(r, r, h, 8), m)
  mesh.position.set(x, y + h / 2, z)
  return mesh
}

/** A triangular sail with belly toward +X. a = tack, b = head, c = clew. */
function sailGeometry(a: number[], b: number[], c: number[], camber: number): BufferGeometry {
  const U = 10
  const V = 8
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= U; i++) {
    const u = i / U
    for (let j = 0; j <= V; j++) {
      const v = j / V
      const luff = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * u)
      const leech = [0, 1, 2].map((k) => c[k] + (b[k] - c[k]) * u)
      const p = [0, 1, 2].map((k) => luff[k] + (leech[k] - luff[k]) * v)
      const chord = Math.hypot(leech[0] - luff[0], leech[2] - luff[2])
      p[0] += camber * chord * Math.sin(Math.PI * Math.pow(v, 0.8)) * (0.35 + 0.65 * (1 - u))
      pos.push(p[0], p[1], p[2])
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const p = i * (V + 1) + j
      idx.push(p, p + 1, p + V + 1, p + 1, p + V + 2, p + V + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const BLACK = new MeshBasicMaterial({ color: 0x0b0b0b })

/** Day shapes (Rule 27 / 26): how a hampered vessel identifies herself in daylight. */
function dayShapes(status: Status, x: number, y: number, z: number, size: number): Group {
  const g = new Group()
  const ball = (dy: number) => {
    const m = new Mesh(new SphereGeometry(size / 2, 12, 8), BLACK)
    m.position.set(x, y + dy, z)
    g.add(m)
  }
  if (status === 'nuc') {
    ball(0)
    ball(size * 1.6)
  } else if (status === 'ram') {
    ball(0)
    ball(size * 3.2)
    const d = new Mesh(new OctahedronGeometry(size * 0.6), BLACK)
    d.scale.set(1, 1.2, 1)
    d.position.set(x, y + size * 1.6, z)
    g.add(d)
  } else if (status === 'fishing') {
    // Two cones, points together.
    const up = new Mesh(new ConeGeometry(size / 2, size * 0.8, 12), BLACK)
    up.position.set(x, y, z)
    const down = new Mesh(new ConeGeometry(size / 2, size * 0.8, 12), BLACK)
    down.rotation.x = Math.PI
    down.position.set(x, y + size * 0.8, z)
    g.add(up, down)
  }
  return g
}

export interface VesselObject {
  root: Group
  /** Trim the sails for a true wind angle (degrees, + = wind over starboard). No-op for boats without sails. */
  trim(twa: number): void
  /** Where the helmsman's eyes are, in local coordinates. */
  eye: [number, number, number]
  /** Leeward heel in radians for a given wind angle. */
  heel(twa: number): number
}

function sloop(status: Status, own: boolean): VesselObject {
  const root = new Group()
  const { group, gunwale } = hullMesh(
    { length: 10, beam: 3.2, freeboard: 1.0, draft: 0.5, stern: 0.72, rise: 0.22, rake: 0.9, fullness: 2.1, top: 0xf4f2ec, bottom: 0x1d3557 },
    0xd9cfb8,
  )
  root.add(group)
  const deckY = gunwale(0.5) - 0.06
  const white = mat(0xf2f0ea, 0.6)
  const cabin = box(1.9, 0.5, 3.7, white, 0, deckY, -0.7)
  root.add(cabin)
  const glass = mat(0x1b2a38, 0.2)
  for (const s of [1, -1]) root.add(box(0.04, 0.2, 2.4, glass, s * 0.96, deckY + 0.18, -0.9))
  // Cockpit coaming and wheel.
  for (const s of [1, -1]) root.add(box(0.14, 0.28, 2.6, white, s * 1.0, deckY, 3.1))
  const spar = mat(0xc9ccd1, 0.35, { metalness: 0.6 })
  root.add(post(0.05, 0.7, spar, 0, deckY, 3.2))
  const wheel = new Mesh(new TorusGeometry(0.3, 0.02, 6, 24), spar)
  wheel.position.set(0, deckY + 0.72, 3.27)
  root.add(wheel)

  const mastZ = -1.3
  const mastTop = deckY + 13
  const boomY = deckY + 2.6
  const boomLen = 3.6
  root.add(post(0.075, 13, spar, 0, deckY, mastZ))
  const stays = new BufferGeometry()
  const bowZ = -4.9
  stays.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        [0, mastTop, mastZ, 0, deckY + 0.5, bowZ],
        [0, mastTop, mastZ, 0, deckY + 0.3, 4.9],
        [0, mastTop - 2.5, mastZ, 1.5, deckY, mastZ + 0.2],
        [0, mastTop - 2.5, mastZ, -1.5, deckY, mastZ + 0.2],
      ].flat(),
      3,
    ),
  )
  root.add(new LineSegments(stays, new LineBasicMaterial({ color: 0x5b6470, transparent: true, opacity: 0.8 })))

  const boom = new Group()
  boom.position.set(0, boomY, mastZ)
  const boomSpar = new Mesh(new CylinderGeometry(0.06, 0.06, boomLen, 8), spar)
  boomSpar.rotation.x = Math.PI / 2
  boomSpar.position.z = boomLen / 2
  boom.add(boomSpar)
  root.add(boom)

  const sailing = status === 'sail'
  let main: Mesh | null = null
  let jib: Mesh | null = null
  if (sailing) {
    // Your own sails are slightly see-through so they don't hide the vessel you are meant to be watching.
    const cloth = new MeshStandardMaterial({
      color: 0xfbfaf5,
      roughness: 0.9,
      side: DoubleSide,
      transparent: own,
      opacity: own ? 0.42 : 1,
      depthWrite: !own,
    })
    main = new Mesh(sailGeometry([0, 0.08, 0.08], [0, mastTop - boomY - 0.3, 0.05], [0, 0.08, boomLen - 0.1], 0.11), cloth)
    boom.add(main)
    jib = new Mesh(sailGeometry([0, deckY + 0.6, bowZ + 0.1], [0, mastTop - 1.6, mastZ - 0.15], [1.25, deckY + 1.0, mastZ + 1.1], 0.09), cloth)
    root.add(jib)
  } else {
    // Sails down: main flaked on the boom under a cover, jib rolled on the forestay.
    const cover = new Mesh(new CylinderGeometry(0.13, 0.1, boomLen - 0.3, 8), mat(0x3f6c94, 0.9))
    cover.rotation.x = Math.PI / 2
    cover.position.set(0, 0.16, boomLen / 2)
    boom.add(cover)
    const len = Math.hypot(mastTop - 1.6 - deckY - 0.5, bowZ - mastZ)
    const roll = new Mesh(new CylinderGeometry(0.07, 0.09, len * 0.9, 6), mat(0xe8e6df, 0.9))
    roll.position.set(0, (mastTop + deckY) / 2 - 0.2, (bowZ + mastZ) / 2)
    roll.rotation.x = -Math.atan2(bowZ - mastZ, mastTop - deckY)
    root.add(roll)
  }

  return {
    root,
    // The helmsman sits off to one side, so the mast is not dead ahead.
    eye: [0.6, deckY + 1.6, 4.1],
    // Positive roll lifts the starboard side: wind over starboard heels her to port.
    heel: (twa) => (sailing ? 0.2 * Math.sin(Math.min(Math.abs(twa), 140) * (Math.PI / 180)) * Math.sign(twa) : 0),
    trim(twa) {
      if (!sailing) return
      const out = Math.min(84, Math.max(6, (Math.abs(twa) - 34) * 0.62))
      // Wind over starboard puts the boom out to port (-X) and vice versa.
      const side = twa >= 0 ? -1 : 1
      boom.rotation.y = side * out * (Math.PI / 180)
      if (main) main.scale.x = side
      if (jib) jib.scale.x = side * (0.75 + out / 70)
    },
  }
}

function motorboat(): VesselObject {
  const root = new Group()
  const { group, gunwale } = hullMesh(
    { length: 8, beam: 2.8, freeboard: 0.95, draft: 0.4, stern: 0.92, rise: 0.3, rake: 0.8, fullness: 2.4, top: 0xf7f7f5, bottom: 0x8b1e1e },
    0xe9e4d8,
  )
  root.add(group)
  const y = gunwale(0.5) - 0.06
  const white = mat(0xfafafa, 0.5)
  root.add(box(2.1, 0.55, 3.0, white, 0, y, -1.2))
  root.add(box(1.9, 0.75, 1.9, mat(0x16222e, 0.15), 0, y + 0.55, -0.9))
  root.add(box(2.15, 0.1, 2.5, white, 0, y + 1.3, -0.7))
  root.add(box(0.5, 0.9, 0.45, mat(0x22262b, 0.4), 0, y - 0.35, 4.0))
  root.add(post(0.04, 1.9, mat(0xc9ccd1, 0.4), 0, y + 1.4, -0.2))
  return { root, trim() {}, eye: [0, y + 1.3, 0.6], heel: () => 0 }
}

function trawler(status: Status): VesselObject {
  const root = new Group()
  const { group, gunwale } = hullMesh(
    { length: 22, beam: 6.5, freeboard: 2.1, draft: 1.2, stern: 0.85, rise: 0.55, rake: 2.0, fullness: 2.8, top: 0x1f5d7a, bottom: 0x7a1f1f },
    0x6f6a5c,
  )
  root.add(group)
  const y = gunwale(0.45) - 0.06
  const white = mat(0xf1efe8, 0.6)
  root.add(box(4.6, 2.5, 4.6, white, 0, y, -4.2))
  root.add(box(4.65, 0.7, 3.2, mat(0x17232e, 0.2), 0, y + 1.4, -5.0))
  root.add(box(5.0, 0.18, 5.2, white, 0, y + 2.5, -4.2))
  const steel = mat(0xb9772f, 0.7)
  root.add(post(0.14, 9.5, steel, 0, y + 2.6, -4.5))
  // Stern gantry and trawl warps running aft into the water.
  for (const s of [1, -1]) root.add(post(0.16, 4.2, steel, s * 2.4, y, 8.2))
  root.add(box(5.2, 0.3, 0.3, steel, 0, y + 4.2, 8.2))
  for (const s of [1, -1]) {
    const boom = post(0.09, 8, steel, 0, 0, 0)
    boom.position.set(s * 2.6, y + 5.2, -1.4)
    boom.rotation.z = -s * 0.75
    root.add(boom)
  }
  root.add(box(2.2, 1.1, 2.6, mat(0x2c6e49, 0.95), 0, y, 4.6))
  const warps = new BufferGeometry()
  warps.setAttribute('position', new Float32BufferAttribute([2.2, y + 4.2, 8.2, 3.2, -0.3, 22, -2.2, y + 4.2, 8.2, -3.2, -0.3, 22], 3))
  root.add(new LineSegments(warps, new LineBasicMaterial({ color: 0x2a2a2a })))
  if (status === 'fishing') root.add(dayShapes(status, 0, y + 9.4, -4.5, 1.3))
  return { root, trim() {}, eye: [0, y + 3, -4], heel: () => 0 }
}

function dredger(status: Status): VesselObject {
  const root = new Group()
  const { group, gunwale } = hullMesh(
    { length: 46, beam: 14, freeboard: 1.9, draft: 1.5, stern: 1, rise: 0.05, rake: 1.5, fullness: 9, top: 0x30363d, bottom: 0x6b1d1d },
    0x57534a,
  )
  root.add(group)
  const y = gunwale(0.3) - 0.06
  const white = mat(0xeeece4, 0.6)
  root.add(box(9, 5.5, 8, white, 0, y, 15))
  root.add(box(9.05, 1.1, 5, mat(0x17232e, 0.2), 0, y + 3.6, 13.6))
  const yellow = mat(0xd9a520, 0.6)
  root.add(post(1.5, 3.2, yellow, 0, y, -4))
  root.add(box(4, 2.6, 5, yellow, 0, y + 3.2, -3))
  const jib = box(0.9, 0.9, 26, yellow, 0, 0, 0)
  jib.position.set(0, y + 12.5, -15)
  jib.rotation.x = 0.62
  root.add(jib)
  const cable = new BufferGeometry()
  cable.setAttribute('position', new Float32BufferAttribute([0, y + 20, -25.5, 0, 1, -25.5], 3))
  root.add(new LineSegments(cable, new LineBasicMaterial({ color: 0x1c1c1c })))
  root.add(box(2.4, 2.2, 2.4, mat(0x2b2b2b, 0.8), 0, 0.2, -25.5))
  const spoil = new Mesh(new ConeGeometry(5, 3.4, 14), mat(0x7b6a4f, 1))
  spoil.position.set(0, y + 1.7, 5.5)
  spoil.scale.set(1, 1, 1.5)
  root.add(spoil)
  for (const s of [1, -1]) root.add(post(0.45, 16, mat(0x3c4148, 0.6), s * 5.8, -2, 21))
  root.add(post(0.16, 12.5, mat(0x9aa0a6, 0.5), 0, y + 5.5, 15))
  if (status === 'ram') root.add(dayShapes(status, 0, y + 11.6, 15, 1.7))
  return { root, trim() {}, eye: [0, y + 6, 12], heel: () => 0 }
}

function ship(status: Status): VesselObject {
  const root = new Group()
  const L = LENGTH.ship
  const { group, gunwale } = hullMesh(
    { length: L, beam: BEAM.ship, freeboard: 7.5, draft: 3, stern: 0.9, rise: 0.22, rake: 5, fullness: 6, top: 0x1b2430, bottom: 0x8a2020 },
    0x6d3b32,
  )
  root.add(group)
  const y = gunwale(0.3) - 0.06
  const white = mat(0xf0eee8, 0.55)
  root.add(box(17, 13, 12, white, 0, y, 42))
  root.add(box(19.5, 2.6, 6, white, 0, y + 13, 39.5))
  root.add(box(19.6, 1.1, 5.5, mat(0x17232e, 0.2), 0, y + 14, 39.2))
  const funnel = box(5, 7, 5.5, mat(0x1d4e89, 0.6), 0, y + 13, 46.5)
  root.add(funnel)
  root.add(post(0.3, 10, white, 0, y + 15.6, 42))
  root.add(post(0.35, 12, white, 0, y, -46))
  // Deck cargo.
  const colors = [0xb5432f, 0x2f6fb5, 0x3e8e5a, 0xd08a2c, 0x7c7f86, 0x9a3d6a]
  let k = 0
  for (let z = -38; z <= 30; z += 6.6) {
    for (let x = -6.6; x <= 6.61; x += 4.4) {
      const tiers = 1 + ((k * 7 + Math.round(z)) % 3)
      for (let t = 0; t < tiers; t++) root.add(box(4.1, 2.6, 6.2, mat(colors[(k + t) % colors.length], 0.8), x, y + t * 2.65, z))
      k++
    }
  }
  if (status === 'nuc') root.add(dayShapes(status, 0, y + 21.5, 42, 2.4))
  return { root, trim() {}, eye: [0, y + 14, 38], heel: () => 0 }
}

export function buildVessel(model: Model, status: Status, own = false): VesselObject {
  switch (model) {
    case 'sloop':
      return sloop(status, own)
    case 'motorboat':
      return motorboat()
    case 'trawler':
      return trawler(status)
    case 'dredger':
      return dredger(status)
    case 'ship':
      return ship(status)
  }
}

/** Foam trail astern, fading with distance. */
export function buildWake(model: Model, speed: number): Mesh {
  const half = BEAM[model] / 2
  const len = Math.min(140, Math.max(6, speed * 9)) * (model === 'ship' ? 1.6 : 1)
  const start = LENGTH[model] / 2 - 0.4
  const N = 12
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const w = half * (0.75 + 1.6 * t)
    const z = start + t * len
    const a = Math.min(1, speed / 2.5) * 0.6 * Math.pow(1 - t, 1.6)
    pos.push(-w, 0.06, z, 0, 0.06, z, w, 0.06, z)
    col.push(1, 1, 1, 0, 1, 1, 1, a, 1, 1, 1, 0)
    if (i < N) {
      const p = i * 3
      idx.push(p, p + 1, p + 3, p + 1, p + 4, p + 3, p + 1, p + 2, p + 4, p + 2, p + 5, p + 4)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  g.setIndex(idx)
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, fog: true }))
}

const RED = 0xc8202a
const GREEN = 0x1f8f4a

/** A lateral or preferred-channel buoy. Drawn larger than life so it reads at a distance. */
export function buildBuoy(look: { color: 'red' | 'green'; band?: 'red' | 'green'; shape: 'can' | 'cone' }): Group {
  const g = new Group()
  const main = mat(look.color === 'red' ? RED : GREEN, 0.5)
  const band = look.band ? mat(look.band === 'red' ? RED : GREEN, 0.5) : main
  const float = new Mesh(new CylinderGeometry(1.15, 1.0, 0.6, 16), mat(0x23272c, 0.8))
  float.position.y = 0.2
  g.add(float)
  const r = 0.8
  const seg = (m: Material, y0: number, h: number, r0: number, r1: number) => {
    const mesh = new Mesh(new CylinderGeometry(r1, r0, h, 16), m)
    mesh.position.y = y0 + h / 2
    g.add(mesh)
  }
  if (look.shape === 'can') {
    seg(main, 0.5, 0.8, r, r)
    seg(band, 1.3, 0.8, r, r)
    seg(main, 2.1, 0.8, r, r)
  } else {
    // Cone on a short drum: taper each third so the bands follow the cone.
    seg(main, 0.5, 0.8, r, r * 0.86)
    seg(band, 1.3, 0.8, r * 0.86, r * 0.55)
    seg(main, 2.1, 0.9, r * 0.55, 0.04)
  }
  g.scale.setScalar(1.7)
  return g
}
