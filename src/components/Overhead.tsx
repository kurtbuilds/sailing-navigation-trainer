import { useMemo } from 'react'
import { vesselTag } from '../content/explain'
import type { Playback, Solved } from '../sim'
import { add, bearing, dirVec, norm360, rotate, scale, sub, type Vec } from '../sim/geometry'
import { isPreferred, markLook, markNumber } from '../sim/marks'
import { cpa, type Pose } from '../sim/motion'
import { STERN_SECTOR, windAngle } from '../sim/rules'
import { LENGTH, type Mark, type Region, type Scenario, type Vessel } from '../sim/types'
import type { Frame } from '../three/scene'

export type Orientation = 'wind' | 'bow'

interface Props {
  scenario: Scenario
  region: Region
  frame: Frame
  t: number
  solved: Solved
  /** Every track that might be shown, so the chart never has to rescale. */
  extents: Playback[]
  /** The answer being played out, once revealed. */
  playback: Playback | null
  reveal: boolean
  showBearing?: boolean
  orientation: Orientation
  pre: number
}

const W = 420
const H = 420
const PAD = 54

const hullPath = (v: Vessel): string => {
  // Unit length, bow toward -y.
  if (v.model === 'sloop') return 'M0,-0.5 C0.2,-0.25 0.19,0.25 0.12,0.5 L-0.12,0.5 C-0.19,0.25 -0.2,-0.25 0,-0.5 Z'
  if (v.model === 'motorboat') return 'M0,-0.5 C0.2,-0.3 0.19,0 0.18,0.5 L-0.18,0.5 C-0.19,0 -0.2,-0.3 0,-0.5 Z'
  if (v.model === 'trawler') return 'M0,-0.5 C0.17,-0.36 0.16,0 0.15,0.5 L-0.15,0.5 C-0.16,0 -0.17,-0.36 0,-0.5 Z'
  if (v.model === 'dredger') return 'M-0.1,-0.5 L0.1,-0.5 L0.155,-0.42 L0.155,0.5 L-0.155,0.5 L-0.155,-0.42 Z'
  return 'M0,-0.5 C0.07,-0.44 0.08,-0.36 0.08,-0.3 L0.08,0.46 L0.06,0.5 L-0.06,0.5 L-0.08,0.46 L-0.08,-0.3 C-0.08,-0.36 -0.07,-0.44 0,-0.5 Z'
}

function Boat({ v, heading, wind, px, cls }: { v: Vessel; heading: number; wind: number; px: number; cls: string }) {
  const twa = windAngle({ ...v, heading }, wind)
  const out = Math.min(84, Math.max(6, (Math.abs(twa) - 34) * 0.62))
  const side = twa >= 0 ? -1 : 1
  const a = (side * out * Math.PI) / 180
  // Boom swings from the mast toward the leeward quarter.
  const bx = Math.sin(a) * 0.42
  const by = -0.12 + Math.cos(a) * 0.42
  const jx = side * (0.1 + out / 400)
  return (
    <g transform={`scale(${px})`} className={cls}>
      <path d={hullPath(v)} className="hull" vectorEffect="non-scaling-stroke" />
      {v.model === 'motorboat' && <rect x={-0.1} y={-0.2} width={0.2} height={0.3} rx={0.03} className="house" />}
      {v.model === 'trawler' && <rect x={-0.1} y={-0.34} width={0.2} height={0.2} className="house" />}
      {v.model === 'dredger' && (
        <>
          <rect x={-0.1} y={0.22} width={0.2} height={0.18} className="house" />
          <line x1={0} y1={-0.05} x2={0} y2={-0.62} className="gear" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {v.model === 'ship' && <rect x={-0.065} y={0.3} width={0.13} height={0.1} className="house" />}
      {v.status === 'sail' && (
        <>
          <path d={`M0,-0.12 Q${bx * 0.5 + side * 0.07},${(-0.12 + by) / 2} ${bx},${by}`} className="sail" vectorEffect="non-scaling-stroke" />
          <path d={`M0,-0.48 Q${jx * 0.9},-0.3 ${jx},-0.08`} className="sail" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {v.model === 'sloop' && v.status !== 'sail' && <line x1={0} y1={-0.12} x2={0} y2={0.3} className="boom" vectorEffect="non-scaling-stroke" />}
    </g>
  )
}

function MarkGlyph({ mark, region, size = 9 }: { mark: Mark; region: Region; size?: number }) {
  const look = markLook(mark.kind, region)
  const shape = look.shape === 'can' ? `M${-size * 0.7},${-size} H${size * 0.7} V${size} H${-size * 0.7} Z` : `M0,${-size * 1.1} L${size * 0.85},${size} H${-size * 0.85} Z`
  const id = `clip-${mark.kind}-${Math.round(mark.pos.x)}-${Math.round(mark.pos.y)}`
  return (
    <g>
      <clipPath id={id}>
        <path d={shape} />
      </clipPath>
      <path d={shape} className={`mark ${look.color}`} />
      {look.band && <rect x={-size} y={-size * 0.3} width={size * 2} height={size * 0.62} className={`mark-band ${look.band}`} clipPath={`url(#${id})`} />}
      <path d={shape} className="mark-outline" />
    </g>
  )
}

export function Overhead({ scenario: s, region, frame, t, solved, extents, playback, reveal, showBearing, orientation, pre }: Props) {
  const up = orientation === 'wind' ? s.wind : s.you.heading
  const other = s.kind === 'encounter' ? s.other : null

  // Fit everything that will ever be drawn: both approaches, every playback, the marks.
  const view = useMemo(() => {
    const pts: Vec[] = []
    const back = (v: Vessel) => add(v.pos, scale(dirVec(v.heading), -v.speed * pre))
    pts.push(s.you.pos, back(s.you))
    if (s.kind === 'encounter') {
      pts.push(s.other.pos, back(s.other))
      const c = cpa(s.you, s.other)
      const tt = Math.min(Math.max(c.t, 0), 60)
      pts.push(add(s.you.pos, scale(dirVec(s.you.heading), s.you.speed * tt)))
    } else pts.push(s.mark.pos)
    // Wrong answers can wander a long way; frame the chart on the correct maneuver and let those run off the edge.
    const horizon = extents[0].end + 3
    for (const p of extents) {
      const n = Math.min(p.you.length - 1, Math.ceil(Math.min(p.end, horizon) / p.dt))
      for (let i = 0; i <= n; i += 5) {
        pts.push(p.you[i].pos)
        if (p.other) pts.push(p.other[i].pos)
      }
    }
    const rot = pts.map((p) => rotate(p, -up))
    const xs = rot.map((p) => p.x)
    const ys = rot.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 120)
    return { cx, cy, k: (W - 2 * PAD) / ext }
  }, [s, extents, up, pre])

  const P = (p: Vec): [number, number] => {
    const r = rotate(p, -up)
    return [W / 2 + (r.x - view.cx) * view.k, H / 2 - (r.y - view.cy) * view.k]
  }
  const pt = (p: Vec) => P(p).map((n) => n.toFixed(1)).join(',')
  const boatPx = (v: Vessel) => Math.max(LENGTH[v.model] * view.k, v.model === 'ship' ? 60 : v.model === 'dredger' ? 44 : v.model === 'trawler' ? 44 : 38)

  const trail = (v: Vessel, poses: Pose[] | undefined, dt: number): string => {
    const start = add(v.pos, scale(dirVec(v.heading), -v.speed * pre))
    const parts = [pt(start)]
    if (t > 0 && poses) {
      const n = Math.min(poses.length - 1, Math.floor(t / dt))
      for (let i = 0; i <= n; i += 3) parts.push(pt(poses[i].pos))
    }
    return 'M' + parts.join(' L')
  }
  const ahead = (v: Vessel, secs: number) => `M${pt(v.pos)} L${pt(add(v.pos, scale(dirVec(v.heading), v.speed * secs)))}`
  const future = (poses: Pose[] | undefined, p: Playback): string => {
    if (!poses) return ''
    const parts: string[] = []
    const n = Math.min(poses.length - 1, Math.ceil(p.end / p.dt))
    for (let i = Math.max(0, Math.floor(t / p.dt)); i <= n; i += 3) parts.push(pt(poses[i].pos))
    return parts.length > 1 ? 'M' + parts.join(' L') : ''
  }

  const verdict = solved.kind === 'encounter' ? solved.res.verdict : null
  const tc = s.kind === 'encounter' ? Math.min(Math.max(cpa(s.you, s.other).t, 0), 60) : 0
  const hidden = !!s.night && !reveal && !!other
  const [yx, yy] = P(frame.you.pos)
  const [ox, oy] = frame.other ? P(frame.other.pos) : [0, 0]
  const rotOf = (heading: number) => heading - up

  // A sector drawn from a vessel: used for the stern sector and the danger zone.
  const wedge = (pos: Vec, heading: number, from: number, to: number, r: number) => {
    const [x, y] = P(pos)
    const a0 = ((heading + from - up - 90) * Math.PI) / 180
    const a1 = ((heading + to - up - 90) * Math.PI) / 180
    const large = norm360(to - from) > 180 ? 1 : 0
    return `M${x},${y} L${x + r * Math.cos(a0)},${y + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${x + r * Math.cos(a1)},${y + r * Math.sin(a1)} Z`
  }

  const tags: { who: 'you' | 'other'; text: string; cls: string }[] = []
  if (reveal && verdict && other && frame.other) {
    const role = (r: 'stand-on' | 'give-way') => (r === 'give-way' ? 'GIVE WAY' : 'STAND ON')
    const extra = (who: 'you' | 'other') => {
      if (verdict.rule === 'sail-opposite-tack') return ` · ${who === 'you' ? verdict.facts.youTack : verdict.facts.otherTack} tack`
      if (verdict.rule === 'sail-same-tack') return verdict.facts.windward === who ? ' · windward' : ' · leeward'
      if (verdict.rule === 'overtaking') return verdict.facts.overtaker === who ? ' · overtaking' : ' · being overtaken'
      return ''
    }
    tags.push({ who: 'you', text: role(verdict.you) + extra('you'), cls: verdict.you })
    tags.push({ who: 'other', text: role(verdict.other) + extra('other'), cls: verdict.other })
  }

  const windFlow = s.wind + 180 - up // screen direction the wind blows toward, clockwise from up
  const marks: Mark[] = [...(s.scenery?.marks ?? []), ...(s.kind === 'mark' ? [s.mark] : [])]
  const metres = [200, 100, 50, 20].find((m) => m * view.k < 110) ?? 20
  const shore = s.scenery?.shoreBearing

  return (
    <div className="oh">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Overhead view">
        <defs>
          <pattern id="streaks" width="46" height="60" patternUnits="userSpaceOnUse" patternTransform={`rotate(${windFlow})`}>
            <path d="M12,6 V26 M34,34 V52" className="wind-streak" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" className="arrow-head" />
          </marker>
        </defs>
        <rect width={W} height={H} className="oh-sea" />
        <rect width={W} height={H} fill="url(#streaks)" />

        {shore !== undefined &&
          [
            { text: 'harbor', at: shore - up },
            { text: 'open sea', at: shore - up + 180 },
          ].map(({ text, at }) => (
            <text
              key={text}
              x={W / 2 + Math.sin((at * Math.PI) / 180) * (W / 2 - 44)}
              y={H / 2 - Math.cos((at * Math.PI) / 180) * (H / 2 - 30) + 4}
              textAnchor="middle"
              className="oh-shore"
            >
              {text}
            </text>
          ))}

        {/* Rule geometry, once the answer is shown. */}
        {reveal && verdict && other && frame.other && verdict.rule === 'overtaking' && (() => {
          const slow = verdict.facts.overtaker === 'you' ? frame.other : frame.you
          return <path d={wedge(slow.pos, slow.heading, STERN_SECTOR, 360 - STERN_SECTOR, 150)} className="sector stern" />
        })()}
        {reveal && verdict && other && frame.other && verdict.rule === 'crossing' && (() => {
          const gw = verdict.you === 'give-way' ? frame.you : frame.other
          return <path d={wedge(gw.pos, gw.heading, 0, STERN_SECTOR, 150)} className="sector danger" />
        })()}

        {marks.map((m, i) => {
          const [x, y] = P(m.pos)
          const num = markNumber(m, region)
          const main = s.kind === 'mark' && m === s.mark
          return (
            <g key={i} transform={`translate(${x},${y})`} opacity={main ? 1 : 0.85}>
              <MarkGlyph mark={m} region={region} size={main ? 10 : 6} />
              {main && (num || isPreferred(m.kind)) && (
                <text x={15} y={4} className="oh-label">
                  {num ? `“${num}”` : 'junction'}
                </text>
              )}
            </g>
          )
        })}

        {/* Where each vessel is heading if nobody does anything. */}
        {!reveal && (
          <>
            <path d={ahead(s.you, s.kind === 'encounter' ? tc : 30)} className="course you" />
            {other && !hidden && <path d={ahead(other, tc)} className="course" />}
          </>
        )}
        {reveal && playback && (
          <>
            <path d={future(playback.you, playback)} className="course you" markerEnd="url(#arrow)" />
            {other && <path d={future(playback.other, playback)} className="course" />}
          </>
        )}
        <path d={trail(s.you, playback?.you, playback?.dt ?? 1)} className="trail you" />
        {other && !hidden && <path d={trail(other, playback?.other, playback?.dt ?? 1)} className="trail" />}

        {showBearing && other && frame.other && (
          <g>
            <line x1={yx} y1={yy} x2={ox} y2={oy} className="bearing-line" />
            <text x={(yx + ox) / 2 + 8} y={(yy + oy) / 2 - 6} className="oh-label strong">
              bearing {String(Math.round(bearing(frame.you.pos, frame.other.pos))).padStart(3, '0')}°
            </text>
          </g>
        )}

        {other && frame.other && (
          <g transform={`translate(${ox},${oy})`}>
            {hidden ? (
              <g className="contact">
                <circle r={13} />
                <text y={5} textAnchor="middle">
                  ?
                </text>
              </g>
            ) : (
              <g transform={`rotate(${rotOf(frame.other.heading)})`}>
                <Boat v={other} heading={frame.other.heading} wind={s.wind} px={boatPx(other)} cls={`boat other ${reveal && verdict ? verdict.other : ''}`} />
              </g>
            )}
          </g>
        )}
        <g transform={`translate(${yx},${yy}) rotate(${rotOf(frame.you.heading)})`}>
          <Boat v={s.you} heading={frame.you.heading} wind={s.wind} px={boatPx(s.you)} cls={`boat you ${reveal && verdict ? verdict.you : ''}`} />
        </g>

        {/* Labels sit beside the boats, each pushed directly away from the other vessel. */}
        {(() => {
          const d = other && frame.other ? sub({ x: yx, y: yy }, { x: ox, y: oy }) : { x: -1, y: 0 }
          const n = Math.hypot(d.x, d.y) || 1
          const ux = d.x / n
          const uy = d.y / n
          const label = (x: number, y: number, dir: 1 | -1, title: string, who: 'you' | 'other', cls: string) => {
            const tag = tags.find((g) => g.who === who)
            const lx = Math.min(W - 6, Math.max(6, x + dir * ux * 30))
            const ly = Math.min(H - 22, Math.max(14, y + dir * uy * 30 + (dir * uy < -0.5 ? -12 : 4)))
            // Text grows away from the boat; near an edge it grows back toward the middle.
            const width = Math.max(title.length * 6.6, (tag?.text.length ?? 0) * 6.4)
            let anchor: 'start' | 'middle' | 'end' = dir * ux < -0.3 ? 'end' : dir * ux > 0.3 ? 'start' : 'middle'
            if (anchor !== 'start' && lx - (anchor === 'end' ? width : width / 2) < 4) anchor = 'start'
            if (anchor !== 'end' && lx + (anchor === 'start' ? width : width / 2) > W - 4) anchor = 'end'
            return (
              <g transform={`translate(${lx},${ly})`} textAnchor={anchor}>
                <text className={`oh-label strong ${cls}`}>{title}</text>
                {tag && (
                  <text y={13} className={`oh-tag ${tag.cls}`}>
                    {tag.text}
                  </text>
                )}
              </g>
            )
          }
          return (
            <>
              {label(yx, yy, 1, 'YOU', 'you', 'you')}
              {other && frame.other && label(ox, oy, -1, hidden ? 'Lights only' : vesselTag(other), 'other', '')}
            </>
          )
        })()}

        {/* Wind arrow and scale. */}
        <g transform={`translate(34,40) rotate(${windFlow - 180})`} className="oh-wind">
          <path d="M0,-20 V16 M-7,6 L0,18 L7,6" />
        </g>
        <text x={34} y={76} textAnchor="middle" className="oh-wind-label">
          WIND
        </text>
        <g transform={`translate(${W - 18 - metres * view.k},${H - 16})`} className="oh-scale">
          <path d={`M0,-4 V0 H${metres * view.k} V-4`} />
          <text x={(metres * view.k) / 2} y={-6} textAnchor="middle">
            {metres} m
          </text>
        </g>
      </svg>
      <div className="view-title dark">Overhead · {orientation === 'wind' ? 'wind from the top' : 'your bow up'}</div>
    </div>
  )
}
