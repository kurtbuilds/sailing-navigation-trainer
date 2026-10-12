import { useEffect, useMemo, useState } from 'react'
import { ACTION_LABEL, explain, outcomeText, youAre } from '../content/explain'
import { play, solve, type Solved } from '../sim'
import { generate, isMarkTopic, TOPICS, type Topic } from '../sim/generate'
import { mulberry32, pick } from '../sim/geometry'
import { isPreferred } from '../sim/marks'
import type { Action, Region, Scenario } from '../sim/types'
import { ScenarioView } from './ScenarioView'

export const TOPIC_LABEL: Record<Topic, string> = {
  'sail-opposite-tack': 'Sail: opposite tacks',
  'sail-same-tack': 'Sail: same tack',
  overtaking: 'Overtaking',
  'head-on': 'Power: head-on',
  crossing: 'Power: crossing',
  'sail-vs-power': 'Sail meets power',
  hierarchy: 'Pecking order',
  'narrow-channel': 'Narrow channel',
  'lateral-marks': 'Lateral marks',
  'preferred-marks': 'Preferred-channel marks',
}

export type NightMode = 'off' | 'mixed' | 'only'

export interface Settings {
  topics: Topic[]
  night: NightMode
}

export interface Item {
  key: number
  topic: Topic
  scenario: Scenario
  solved: Solved
  answer: Action | null
  correct: boolean
}

export interface PracticeState {
  items: Item[]
  viewing: number
  settings: Settings
}

const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0)
let nextKey = 1

function makeItem(settings: Settings, avoid?: Topic): Item {
  const pool = settings.topics.length ? settings.topics : TOPICS
  // With night scenes only, marks (always shown by day) drop out unless they are all that is selected.
  const usable = settings.night === 'only' && pool.some((t) => !isMarkTopic(t)) ? pool.filter((t) => !isMarkTopic(t)) : pool
  const choices = usable.length > 1 && avoid ? usable.filter((t) => t !== avoid) : usable
  const topic = pick(rng, choices)
  const night = settings.night === 'only' || (settings.night === 'mixed' && rng() < 0.25)
  const scenario = generate(topic, rng, { night })
  return { key: nextKey++, topic, scenario, solved: solve(scenario), answer: null, correct: false }
}

export const initialPractice = (): PracticeState => {
  const settings: Settings = { topics: [...TOPICS], night: 'mixed' }
  return { items: [makeItem(settings)], viewing: 0, settings }
}

/**
 * Change what gets asked. An unanswered question is replaced so the new
 * selection takes effect straight away; with `advance`, an answered one is
 * followed by a fresh question too.
 */
export function applySettings(s: PracticeState, settings: Settings, advance: boolean): PracticeState {
  const tail = s.items[s.items.length - 1]
  if (!tail.answer) {
    const items = [...s.items.slice(0, -1), makeItem(settings)]
    return { settings, items, viewing: items.length - 1 }
  }
  if (!advance) return { ...s, settings }
  return { settings, items: [...s.items, makeItem(settings)], viewing: s.items.length }
}

interface Props {
  region: Region
  state: PracticeState
  setState: (fn: (s: PracticeState) => PracticeState) => void
}

function prompt(s: Scenario): string {
  if (s.kind === 'encounter') {
    return `${youAre(s.you)}${s.night ? ' It is night.' : ''} Another vessel is closing on a steady bearing. What do you do?`
  }
  const where = s.direction === 'returning' ? 'coming in from sea, toward the harbor' : 'heading out to sea, with the harbor behind you'
  return `${youAre(s.you)} You are ${where}${isPreferred(s.mark.kind) ? ', and you want the preferred channel' : ''}. There is a mark ahead. What do you do?`
}

export function Practice({ region, state, setState }: Props) {
  const { items, viewing, settings } = state
  const item = items[viewing]
  const last = items.length - 1
  const isCurrent = viewing === last
  const answered = items.filter((i) => i.answer)
  const right = answered.filter((i) => i.correct).length
  let streak = 0
  for (let i = answered.length - 1; i >= 0 && answered[i].correct; i--) streak++
  const recent = answered.slice(-10)

  // Which answer the views are playing: the correct one by default.
  const [showing, setShowing] = useState<Action | null>(null)
  useEffect(() => setShowing(null), [item.key])
  const reveal = item.answer ? (showing ?? (item.correct ? item.answer : item.solved.best)) : null

  const answer = (a: Action) => {
    if (item.answer || !isCurrent) return
    setState((s) => ({
      ...s,
      items: s.items.map((it, i) => (i === s.items.length - 1 ? { ...it, answer: a, correct: it.solved.acceptable.includes(a) } : it)),
    }))
  }
  const next = () =>
    setState((s) => {
      const tail = s.items[s.items.length - 1]
      if (!tail.answer) return { ...s, viewing: s.items.length - 1 }
      return { ...s, items: [...s.items, makeItem(s.settings, tail.topic)], viewing: s.items.length }
    })
  const changeSettings = (settings: Settings) => setState((s) => applySettings(s, settings, false))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (!item.answer && isCurrent) {
        if (e.key === 'ArrowLeft') answer('port')
        else if (e.key === 'ArrowRight') answer('starboard')
        else if (e.key === 'ArrowUp' || e.key === ' ') answer('stand-on')
        else return
        e.preventDefault()
      } else if (e.key === 'Enter' || e.key === 'n') {
        next()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ex = useMemo(() => (item.answer ? explain(item.scenario, item.solved, region) : null), [item, region])
  const outcome = useMemo(() => {
    if (!item.answer || !reveal) return null
    return outcomeText(item.scenario, item.solved, reveal, play(item.scenario, item.solved, reveal))
  }, [item, reveal])

  const toggleTopic = (t: Topic) => {
    const on = settings.topics.includes(t)
    const topics = on ? settings.topics.filter((x) => x !== t) : [...settings.topics, t]
    if (topics.length) changeSettings({ ...settings, topics })
  }

  return (
    <div className="practice">
      <div className="scorebar">
        <div className="score" aria-live="polite">
          <b>
            {right} / {answered.length}
          </b>
          <span>{answered.length ? `${Math.round((100 * right) / answered.length)}% correct` : 'correct'}</span>
          {streak > 1 && <span className="streak">{streak} in a row</span>}
        </div>
        <div className="history" aria-label="Your last ten answers">
          <span className="history-label">Last 10</span>
          {recent.length === 0 && <span className="fine">Your recent answers will appear here. Click one to review it.</span>}
          {recent.map((it) => {
            const ix = items.indexOf(it)
            return (
              <button
                key={it.key}
                className={`chip ${it.correct ? 'ok' : 'bad'} ${ix === viewing ? 'on' : ''}`}
                onClick={() => setState((s) => ({ ...s, viewing: ix }))}
                title={`${TOPIC_LABEL[it.topic]} — ${it.correct ? 'correct' : 'wrong'}. Click to review.`}
              >
                <span aria-hidden>{it.correct ? '✓' : '✕'}</span>
                <small>{TOPIC_LABEL[it.topic]}</small>
              </button>
            )
          })}
        </div>
        <details className="settings">
          <summary>
            Topics{settings.topics.length < TOPICS.length ? ` (${settings.topics.length})` : ''}
          </summary>
          <div className="settings-body">
            <div className="settings-row">
              <button className="text" onClick={() => changeSettings({ ...settings, topics: [...TOPICS] })}>
                All
              </button>
              <button className="text" onClick={() => changeSettings({ ...settings, topics: TOPICS.filter((t) => t.startsWith('sail')) })}>
                Sailing only
              </button>
            </div>
            {TOPICS.map((t) => (
              <label key={t}>
                <input type="checkbox" checked={settings.topics.includes(t)} onChange={() => toggleTopic(t)} />
                {TOPIC_LABEL[t]}
              </label>
            ))}
            <div className="settings-night">
              Night scenes
              {(['off', 'mixed', 'only'] as NightMode[]).map((n) => (
                <button key={n} className={settings.night === n ? 'on' : ''} onClick={() => changeSettings({ ...settings, night: n })}>
                  {n === 'off' ? 'Off' : n === 'mixed' ? 'Some' : 'All'}
                </button>
              ))}
            </div>
          </div>
        </details>
      </div>

      {!isCurrent && (
        <div className="reviewing">
          Reviewing an earlier question.
          <button onClick={() => setState((s) => ({ ...s, viewing: s.items.length - 1 }))}>Back to the current question →</button>
        </div>
      )}

      <p className="prompt">{prompt(item.scenario)}</p>
      <ScenarioView key={item.key} scenario={item.scenario} region={region} solved={item.solved} reveal={reveal} />

      {!item.answer ? (
        <div className="answers">
          <button className="ans port" onClick={() => answer('port')}>
            <span className="arrow">↰</span>
            Turn to port
            <kbd>←</kbd>
          </button>
          <button className="ans hold" onClick={() => answer('stand-on')}>
            <span className="arrow">↑</span>
            Stand on
            <small>hold course and speed</small>
            <kbd>↑</kbd>
          </button>
          <button className="ans stbd" onClick={() => answer('starboard')}>
            <span className="arrow">↱</span>
            Turn to starboard
            <kbd>→</kbd>
          </button>
        </div>
      ) : (
        ex && (
          <div className={`feedback ${item.correct ? 'ok' : 'bad'}`}>
            <div className="verdict">
              <span className="mark-icon" aria-hidden>
                {item.correct ? '✓' : '✕'}
              </span>
              <div>
                <strong>{item.correct ? 'Correct' : 'Not quite'}</strong>
                <span>
                  You answered “{ACTION_LABEL[item.answer]}”.{!item.correct && ` The answer is “${ACTION_LABEL[item.solved.best]}”.`}
                </span>
              </div>
              {isCurrent ? (
                <button className="primary" onClick={next} autoFocus>
                  Next question <kbd>↵</kbd>
                </button>
              ) : (
                <button className="primary" onClick={() => setState((s) => ({ ...s, viewing: s.items.length - 1 }))}>
                  Back to current
                </button>
              )}
            </div>
            <div className="rulecard">
              <div className="rulecard-head">
                <h3>{ex.card.title}</h3>
                <span className="cite">{ex.card.cite}</span>
              </div>
              <p className="rule-text">{ex.card.rule}</p>
              {ex.role && <p className={`role-line ${ex.role === 'stand-on' ? 'so' : 'gw'}`}>{ex.role === 'both give way' ? 'Both vessels give way.' : `You are the ${ex.role} vessel.`}</p>}
              <ul>
                {ex.why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="do">
                <b>What to do</b> {ex.action}
              </p>
              {ex.notes.map((n, i) => (
                <p key={i} className="fine">
                  {n}
                </p>
              ))}
            </div>
            <div className="watch">
              <span>
                Now showing: <b>{reveal === item.answer ? 'your answer' : 'the correct answer'}</b> ({ACTION_LABEL[reveal!].toLowerCase()}). {outcome}
              </span>
              {!item.correct && (
                <button onClick={() => setShowing(reveal === item.answer ? item.solved.best : item.answer)}>
                  {reveal === item.answer ? 'Show the correct maneuver' : 'Show what my answer leads to'}
                </button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  )
}
