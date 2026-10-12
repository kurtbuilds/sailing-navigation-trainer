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
  /** Restart automatically when the playback finishes. */
  loop?: boolean
  showBearing?: boolean
}

/** Playback runs a little faster than real time so nobody waits for a sailboat. */
const SPEED = 1.7
const ANSWERS: Action[] = ['stand-on', 'port', 'starboard']

export function ScenarioView({ scenario, region, solved, reveal, hold, loop, showBearing }: Props) {
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

  const [t, setT] = useState(-pre)
  const [playing, setPlaying] = useState(true)
  const tRef = useRef(-pre)
  const doneAt = useRef<number | null>(null)
  const sailOnly = scenario.you.status === 'sail' || (scenario.kind === 'encounter' && scenario.other.status === 'sail')
  const [orientation, setOrientation] = useState<Orientation>(sailOnly ? 'wind' : 'bow')

  // New scenario: start the approach again.
  useEffect(() => {
    tRef.current = -pre
    setT(-pre)
    setPlaying(true)
    setOrientation(sailOnly ? 'wind' : 'bow')
  }, [scenario.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Answer revealed (or changed): play it from the decision point.
  useEffect(() => {
    if (!reveal) return
    tRef.current = Math.min(tRef.current, 0)
    if (tRef.current > -1) tRef.current = 0
    setT(tRef.current)
    setPlaying(true)
  }, [reveal, scenario.id])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    doneAt.current = null
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const next = Math.min(end, tRef.current + dt * SPEED)
      if (next >= end && end > 0) {
        if (loop) {
          doneAt.current ??= now
          if (now - doneAt.current > 2200) {
            doneAt.current = null
            tRef.current = -pre
            setT(-pre)
            raf = requestAnimationFrame(tick)
            return
          }
        } else if (tRef.current >= end) {
          setPlaying(false)
          return
        }
      }
      if (next !== tRef.current) {
        tRef.current = next
        setT(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, end, loop, pre])

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

  return (
    <div className="views">
      <div className="views-pair">
        <FirstPerson scenario={scenario} region={region} frame={frame} banner={banner} />
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
      </div>
      <div className="transport">
        <button onClick={restart} title="Replay from the start" aria-label="Replay">
          ↺
        </button>
        <button
          onClick={() => {
            if (atEnd || (!playback && t >= 0)) restart()
            else setPlaying((p) => !p)
          }}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing && !atEnd && (playback || t < 0) ? '❚❚' : '▶'}
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
        <button className="text" onClick={() => setOrientation((o) => (o === 'wind' ? 'bow' : 'wind'))} title="Rotate the overhead view">
          Chart: {orientation === 'wind' ? 'wind up' : 'bow up'}
        </button>
      </div>
    </div>
  )
}
