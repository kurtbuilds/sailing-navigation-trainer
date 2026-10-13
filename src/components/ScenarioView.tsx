import { useEffect, useMemo, useRef, useState } from 'react'
import { play, playHold, type Playback, type Solved } from '../sim'
import { poseAt } from '../sim/motion'
import type { Action, Region, Scenario } from '../sim/types'
import type { Frame } from '../three/scene'
import { FirstPerson } from './FirstPerson'
import { Overhead, type Orientation } from './Overhead'

interface Props {
  scenario: Scenario
  region: Region
  solved: Solved
  /** The answer to play out, or null while the question is still open. */
  reveal: Action | null
  /** Play both vessels straight on instead of an answer (no-risk demonstrations). */
  hold?: boolean
  showBearing?: boolean
}

/** Playback runs a little faster than real time so nobody waits for a sailboat. */
const SPEED = 1.7
const ANSWERS: Action[] = ['stand-on', 'port', 'starboard']

type View = 'helm' | 'overhead'
const VIEW_KEY = 'sailing-nav-trainer.view'
/** One view at a time; the choice carries over from one scenario to the next. */
let lastView: View = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'overhead' ? 'overhead' : 'helm'
  } catch {
    return 'helm'
  }
})()

export function ScenarioView({ scenario, region, solved, reveal, hold, showBearing }: Props) {
  const pre = scenario.kind === 'encounter' ? 7 : 3
  const extents = useMemo(() => {
    if (hold) return [playHold(scenario)]
    return ANSWERS.map((a) => play(scenario, solved, a))
  }, [scenario, solved, hold])
  const playback: Playback | null = useMemo(() => {
    if (hold) return extents[0]
    return reveal ? extents[ANSWERS.indexOf(reveal)] : null
  }, [extents, reveal, hold])
  const end = playback ? playback.end : 0

  // Nothing moves until you press play. A demonstration waits at the start of
  // the approach; an open question waits at the moment you have to decide.
  const start = reveal || hold ? -pre : 0
  const [t, setT] = useState(start)
  const [playing, setPlaying] = useState(false)
  const tRef = useRef(start)
  const sailOnly = scenario.you.status === 'sail' || (scenario.kind === 'encounter' && scenario.other.status === 'sail')
  const [orientation, setOrientation] = useState<Orientation>(sailOnly ? 'wind' : 'bow')
  const [view, setView] = useState<View>(lastView)
  const show = (v: View) => {
    lastView = v
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }

  // You answered (or asked to see the other answer): play it from the decision point.
  const shown = useRef(reveal)
  useEffect(() => {
    if (shown.current === reveal) return
    shown.current = reveal
    if (!reveal) return
    tRef.current = Math.min(tRef.current, 0)
    if (tRef.current > -1) tRef.current = 0
    setT(tRef.current)
    setPlaying(true)
  }, [reveal])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const next = Math.min(end, tRef.current + dt * SPEED)
      if (tRef.current >= end) {
        setPlaying(false)
        return
      }
      if (next !== tRef.current) {
        tRef.current = next
        setT(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, end])

  const frame: Frame = useMemo(() => {
    const dt = playback?.dt ?? 1
    const you = poseAt(playback?.you ?? [], dt, scenario.you, playback ? t : Math.min(t, 0))
    if (scenario.kind !== 'encounter') return { you }
    return { you, other: poseAt(playback?.other ?? [], dt, scenario.other, playback ? t : Math.min(t, 0)) }
  }, [scenario, playback, t])

  const atEnd = !!playback && t >= end - 0.01
  const banner = atEnd && playback.result === 'collision' ? 'Collision' : atEnd && playback.result === 'hit-mark' ? 'Hit the mark' : null
  const seek = (v: number) => {
    tRef.current = v
    setT(v)
  }
  const restart = () => {
    seek(-pre)
    setPlaying(true)
  }

  const running = playing && !atEnd && (!!playback || t < 0)

  return (
    <div className="views">
      <div className="view-bar">
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'helm'} className={view === 'helm' ? 'on' : ''} onClick={() => show('helm')}>
            From the helm
          </button>
          <button role="tab" aria-selected={view === 'overhead'} className={view === 'overhead' ? 'on' : ''} onClick={() => show('overhead')}>
            Overhead
          </button>
        </div>
        {view === 'overhead' && (
          <button className="text" onClick={() => setOrientation((o) => (o === 'wind' ? 'bow' : 'wind'))} title="Rotate the overhead view">
            {orientation === 'wind' ? 'Wind up' : 'Bow up'}
          </button>
        )}
      </div>
      {view === 'helm' ? (
        <FirstPerson scenario={scenario} region={region} frame={frame} banner={banner} />
      ) : (
        <Overhead
          scenario={scenario}
          region={region}
          frame={frame}
          t={t}
          solved={solved}
          extents={extents}
          playback={playback}
          reveal={!!reveal || !!hold}
          showBearing={showBearing}
          orientation={orientation}
          pre={pre}
        />
      )}
      <div className="transport">
        <button
          className={running ? 'play' : 'play primary'}
          onClick={() => {
            if (atEnd || (!playback && t >= 0)) restart()
            else setPlaying((p) => !p)
          }}
        >
          {running ? '❚❚ Pause' : atEnd ? '↺ Replay' : '▶ Play'}
        </button>
        <button
          onClick={() => {
            setPlaying(false)
            seek(-pre)
          }}
          title="Back to the start"
          aria-label="Back to the start"
        >
          ⏮
        </button>
        <input
          type="range"
          min={-pre}
          max={Math.max(end, 0)}
          step={0.1}
          value={t}
          onChange={(e) => {
            setPlaying(false)
            seek(Number(e.target.value))
          }}
          aria-label="Scrub through the encounter"
        />
        <span className="clock">{t < 0 ? `${Math.ceil(-t)} s to decision` : playback ? `+${t.toFixed(0)} s` : 'decision time'}</span>
      </div>
    </div>
  )
}
