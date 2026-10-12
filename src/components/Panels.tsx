import { useState } from 'react'
import { FOG, MANEUVERING, sound, type Signal } from '../content/signals'
import { markLook } from '../sim/marks'
import type { MarkKind, Region } from '../sim/types'
import type { PanelId } from '../content/lessons'

function Blasts({ pattern }: { pattern: string }) {
  return (
    <span className="blasts" aria-label={[...pattern].map((c) => (c === '-' ? 'prolonged' : 'short')).join(', ')}>
      {[...pattern].map((c, i) => (
        <i key={i} className={c === '-' ? 'long' : 'short'} />
      ))}
    </span>
  )
}

function SignalRow({ s }: { s: Signal }) {
  const [busy, setBusy] = useState(false)
  return (
    <li>
      <button
        className="horn"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          window.setTimeout(() => setBusy(false), sound(s.pattern) * 1000)
        }}
        aria-label="Play signal"
      >
        {busy ? '♪' : '▶'}
      </button>
      <Blasts pattern={s.pattern} />
      <div>
        <strong>{s.meaning}</strong>
        {s.note && <small>{s.note}</small>}
      </div>
    </li>
  )
}

function Signals() {
  return (
    <div className="panel signals">
      <h3>Maneuvering and warning — vessels in sight of one another</h3>
      <ul>{MANEUVERING.map((s) => <SignalRow key={s.pattern} s={s} />)}</ul>
      <h3>In fog — at least every two minutes</h3>
      <ul>{FOG.map((s) => <SignalRow key={s.pattern} s={s} />)}</ul>
      <p className="fine">At anchor in fog: ring a bell rapidly for about five seconds every minute.</p>
    </div>
  )
}

const RED = '#c8202a'
const GREEN = '#1f8f4a'
const fill = (c: 'red' | 'green') => (c === 'red' ? RED : GREEN)

function Buoy({ kind, region }: { kind: MarkKind; region: Region }) {
  const look = markLook(kind, region)
  const can = look.shape === 'can'
  const body = can ? 'M-14,-34 H14 V10 H-14 Z' : 'M0,-40 L17,10 H-17 Z'
  return (
    <svg viewBox="-30 -46 60 76" className="buoy">
      <clipPath id={`b-${kind}-${region}`}>
        <path d={body} />
      </clipPath>
      <path d={body} fill={fill(look.color)} />
      {look.band && <rect x={-20} y={-18} width={40} height={14} fill={fill(look.band)} clipPath={`url(#b-${kind}-${region})`} />}
      <path d="M-22,10 H22 L18,20 H-18 Z" fill="#23272c" />
      <path d="M-30,22 q7.5,-5 15,0 t15,0 t15,0 t15,0" fill="none" stroke="#4d8fb3" strokeWidth="2" />
    </svg>
  )
}

function MarksChart({ region }: { region: Region }) {
  const side = (hand: 'port' | 'starboard') => (hand === 'port' ? 'port (left)' : 'starboard (right)')
  const rows: { kind: MarkKind; name: string; hand: 'port' | 'starboard'; extra?: string }[] = [
    { kind: 'port-hand', name: 'Port-hand mark', hand: 'port' },
    { kind: 'starboard-hand', name: 'Starboard-hand mark', hand: 'starboard' },
    { kind: 'pref-starboard', name: 'Preferred channel to starboard', hand: 'port', extra: 'main channel is on its starboard side' },
    { kind: 'pref-port', name: 'Preferred channel to port', hand: 'starboard', extra: 'main channel is on its port side' },
  ]
  return (
    <div className="panel">
      <h3>
        Region {region} — coming in from sea {region === 'B' ? '(“red, right, returning”)' : '(red to port)'}
      </h3>
      <div className="buoy-grid">
        {rows.map((r) => {
          const look = markLook(r.kind, region)
          return (
            <figure key={r.kind}>
              <Buoy kind={r.kind} region={region} />
              <figcaption>
                <strong>{r.name}</strong>
                <span>
                  {look.color}
                  {look.band ? ` with a ${look.band} band` : ''}, {look.shape === 'can' ? 'can' : region === 'B' ? 'nun (cone)' : 'cone'}
                </span>
                <span>
                  Returning: leave to <b>{side(r.hand)}</b>
                </span>
                <span>Leaving: leave to {side(r.hand === 'port' ? 'starboard' : 'port')}</span>
                {r.extra && <span className="fine">{r.extra}</span>}
              </figcaption>
            </figure>
          )
        })}
      </div>
      <h3>The same in both regions</h3>
      <div className="buoy-grid minor">
        <figure>
          <svg viewBox="-30 -46 60 76" className="buoy">
            <circle cy={-40} r={4} fill={RED} />
            <path d="M-14,-32 H14 V10 H-14 Z" fill="#f4f1ea" />
            <path d="M-14,-32 h7 v42 h-7 Z M0,-32 h7 v42 h-7 Z" fill={RED} />
            <path d="M-22,10 H22 L18,20 H-18 Z" fill="#23272c" />
          </svg>
          <figcaption>
            <strong>Safe water</strong>
            <span>Red and white vertical stripes. Deep water all round: marks a fairway or the seaward end of a channel.</span>
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="-30 -46 60 76" className="buoy">
            <circle cy={-42} r={3.5} fill="#111" />
            <circle cy={-34} r={3.5} fill="#111" />
            <path d="M-12,-28 H12 V10 H-12 Z" fill="#111" />
            <rect x={-12} y={-16} width={24} height={12} fill={RED} />
            <path d="M-22,10 H22 L18,20 H-18 Z" fill="#23272c" />
          </svg>
          <figcaption>
            <strong>Isolated danger</strong>
            <span>Black with a red band, two black balls. Sits on a small hazard with clear water around it.</span>
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="-30 -46 60 76" className="buoy">
            <path d="M-6,-44 l12,12 m0,-12 l-12,12" stroke="#d9a520" strokeWidth="3" />
            <path d="M-12,-28 H12 V10 H-12 Z" fill="#e6b422" />
            <path d="M-22,10 H22 L18,20 H-18 Z" fill="#23272c" />
          </svg>
          <figcaption>
            <strong>Special mark</strong>
            <span>Yellow, X topmark. Not for navigation: moorings, race marks, pipelines, swim areas.</span>
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="-30 -46 60 76" className="buoy">
            <path d="M0,-46 l6,9 h-12 Z M0,-36 l6,9 h-12 Z" fill="#111" />
            <path d="M-12,-24 H12 V10 H-12 Z" fill="#e6b422" />
            <rect x={-12} y={-24} width={24} height={17} fill="#111" />
            <path d="M-22,10 H22 L18,20 H-18 Z" fill="#23272c" />
          </svg>
          <figcaption>
            <strong>Cardinal marks</strong>
            <span>Black and yellow, two cones on top. Named for the side to pass on: a north cardinal (both cones up) means keep north of it.</span>
          </figcaption>
        </figure>
      </div>
    </div>
  )
}

function LightsChart() {
  const arc = (from: number, to: number, r: number) => {
    const p = (a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(1)},${(-r * Math.cos((a * Math.PI) / 180)).toFixed(1)}`
    return `M0,0 L${p(from)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)} Z`
  }
  const combos: [string[], string, string][] = [
    [['red'], 'Red only', 'Port side of a vessel under sail'],
    [['green'], 'Green only', 'Starboard side of a vessel under sail'],
    [['white', 'red'], 'White above red', 'Port side of a power-driven vessel'],
    [['white', 'green'], 'White above green', 'Starboard side of a power-driven vessel'],
    [['white', 'red+green'], 'White above red and green', 'Power-driven vessel heading straight for you'],
    [['white'], 'One white', 'A sternlight (you are behind her) — or a vessel at anchor'],
    [['green', 'white'], 'Green over white', 'Trawling'],
    [['red', 'white', 'red'], 'Red, white, red', 'Restricted in her ability to maneuver'],
    [['red', 'red'], 'Red over red', 'Not under command'],
  ]
  return (
    <div className="panel lights">
      <div className="lights-top">
        <svg viewBox="-110 -110 220 220" className="arcs">
          <path d={arc(-112.5, 0, 100)} fill="rgba(220,40,40,.55)" />
          <path d={arc(0, 112.5, 100)} fill="rgba(40,200,110,.55)" />
          <path d={arc(112.5, 247.5, 100)} fill="rgba(255,255,255,.75)" />
          <path d={arc(-112.5, 112.5, 52)} fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="5 4" />
          <path d="M0,-30 C10,-16 10,14 6,28 L-6,28 C-10,14 -10,-16 0,-30 Z" fill="#0b1522" stroke="#9fb3c8" />
          <text x={-62} y={-48}>112.5°</text>
          <text x={34} y={-48}>112.5°</text>
          <text x={-14} y={84}>135°</text>
        </svg>
        <p>
          Sidelights and sternlight together make a full circle with no overlap, so from any direction you see exactly one of them (two only from dead ahead). The dashed arc is the white
          masthead light of a power-driven vessel: it covers the same 225° as both sidelights.
        </p>
      </div>
      <ul className="combos">
        {combos.map(([lights, name, meaning]) => (
          <li key={name}>
            <span className="stack">
              {lights.map((l, i) =>
                l === 'red+green' ? (
                  <span key={i} className="pair">
                    <i className="l red" />
                    <i className="l green" />
                  </span>
                ) : (
                  <i key={i} className={`l ${l}`} />
                ),
              )}
            </span>
            <div>
              <strong>{name}</strong>
              <small>{meaning}</small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PeckingOrder() {
  const rows: [string, string, string][] = [
    ['Not under command', 'Can’t maneuver at all: steering or engine failure', '●●  two balls'],
    ['Restricted in ability to maneuver', 'Tied to her work: dredging, cable-laying, diving, a difficult tow', '●◆●  ball, diamond, ball'],
    ['Constrained by draft', 'A deep ship in a shallow channel (International Rules only)', '▮  cylinder'],
    ['Fishing', 'Nets, trawls or long lines out — not trolling', '▼▲  two cones, points together'],
    ['Sailing', 'Under sail alone, engine not driving the boat', ''],
    ['Power-driven', 'Anything moved by an engine, including a sailboat motoring', ''],
  ]
  return (
    <div className="panel pecking">
      <p className="fine">Each vessel keeps out of the way of everything above it. An overtaking vessel keeps clear of whatever she overtakes, wherever the two sit on this ladder.</p>
      <ol>
        {rows.map(([name, what, shape], i) => (
          <li key={name} className={i === 4 ? 'you' : ''}>
            <strong>{name}</strong>
            <span>{what}</span>
            {shape && <em>{shape}</em>}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Panel({ id, region }: { id: PanelId; region: Region }) {
  if (id === 'signals') return <Signals />
  if (id === 'marks-chart') return <MarksChart region={region} />
  if (id === 'lights-chart') return <LightsChart />
  if (id === 'pecking-order') return <PeckingOrder />
  return null
}
