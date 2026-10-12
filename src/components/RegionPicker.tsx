import { useEffect, useState } from 'react'
import type { Region } from '../sim/types'
import { markLook } from '../sim/marks'

interface Shape {
  d: string
  region: Region | null
}

const MW = 720
const MH = 330
const LAT_TOP = 84
const LAT_BOTTOM = -58
const px = (lon: number, lat: number) => `${(((lon + 180) / 360) * MW).toFixed(1)},${(((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * MH).toFixed(1)}`

// IALA Region B: North, Central and South America, Japan, South Korea and the Philippines.
const B_COUNTRIES = new Set(['392', '410', '608'])
const GREENLAND = '304'
const ANTARCTICA = '010'

async function loadShapes(): Promise<Shape[]> {
  const [{ feature }, topo] = await Promise.all([import('topojson-client'), import('world-atlas/countries-110m.json')])
  const world = (topo.default ?? topo) as never
  const fc = feature(world, (world as { objects: { countries: never } }).objects.countries) as unknown as {
    features: { id: string; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[]
  }
  const shapes: Shape[] = []
  for (const f of fc.features) {
    if (f.id === ANTARCTICA) continue
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]
    for (const poly of polys) {
      const ring = poly[0]
      const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length
      // Overseas territories go by where they are, not who owns them (French Guiana is Region B).
      const american = lon > -170 && lon < -30 && f.id !== GREENLAND
      // Keep rings that cross the antimeridian in one piece instead of streaking across the map.
      const unwrap = (r: number[][]) => {
        let shift = 0
        return r.map((p, i) => {
          if (i > 0) {
            const jump = p[0] - r[i - 1][0]
            if (jump > 180) shift -= 360
            else if (jump < -180) shift += 360
          }
          return px(p[0] + shift, p[1])
        })
      }
      const d = poly.map((r) => 'M' + unwrap(r).join('L') + 'Z').join('')
      shapes.push({ d, region: american || B_COUNTRIES.has(f.id) ? 'B' : 'A' })
    }
  }
  return shapes
}

function MiniBuoy({ region, hand }: { region: Region; hand: 'port-hand' | 'starboard-hand' }) {
  const look = markLook(hand, region)
  const c = look.color === 'red' ? '#c8202a' : '#1f8f4a'
  return (
    <svg viewBox="-12 -16 24 30" width="22" height="28" aria-hidden>
      <path d={look.shape === 'can' ? 'M-7,-12 H7 V8 H-7 Z' : 'M0,-15 L8,8 H-8 Z'} fill={c} />
      <path d="M-10,8 H10 L8,12 H-8 Z" fill="#23272c" />
    </svg>
  )
}

export function RegionPicker({ region, onPick, first }: { region: Region | null; onPick: (r: Region) => void; first: boolean }) {
  const [shapes, setShapes] = useState<Shape[]>([])
  const [hover, setHover] = useState<Region | null>(null)
  useEffect(() => {
    let live = true
    loadShapes().then((s) => live && setShapes(s), () => {})
    return () => {
      live = false
    }
  }, [])
  const lit = hover ?? region

  const card = (r: Region, title: string, where: string, rule: string) => (
    <button className={`region-card ${region === r ? 'on' : ''}`} onClick={() => onPick(r)} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}>
      <span className="region-name">
        <b>Region {r}</b> {title}
      </span>
      <span className="region-where">{where}</span>
      <span className="region-rule">
        <MiniBuoy region={r} hand="port-hand" />
        <span className="chan">channel, coming in from sea ↑</span>
        <MiniBuoy region={r} hand="starboard-hand" />
      </span>
      <span className="region-say">{rule}</span>
    </button>
  )

  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Choose your buoyage region">
        <h2>{first ? 'Where do you sail?' : 'Buoyage region'}</h2>
        <p>
          The right-of-way rules are the same everywhere. What changes is the color of the channel markers: the world is split into two buoyage regions that use red and green the opposite
          way round.
        </p>
        <svg viewBox={`0 0 ${MW} ${MH}`} className={`worldmap ${lit ? 'lit-' + lit : ''}`} role="img" aria-label="World map of IALA buoyage regions A and B">
          <rect width={MW} height={MH} className="ocean" />
          {shapes.map((s, i) => (
            <path key={i} d={s.d} className={`land ${s.region}`} />
          ))}
          {!shapes.length && (
            <text x={MW / 2} y={MH / 2} textAnchor="middle" className="map-loading">
              Loading map…
            </text>
          )}
        </svg>
        <div className="region-cards">
          {card('B', 'US and the Americas', 'North, Central and South America, the Caribbean, Japan, South Korea, the Philippines', '“Red, right, returning”: red to starboard coming in')}
          {card('A', 'Europe and the rest of the world', 'Europe, Africa, Australia, New Zealand, the Middle East, most of Asia', 'Red to port, green to starboard coming in')}
        </div>
        <p className="fine">You can change this at any time from the top bar. The US Coast Guard calls these “IALA-A” and “IALA-B”.</p>
      </div>
    </div>
  )
}
