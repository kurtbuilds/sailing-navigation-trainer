import { useEffect, useMemo, useState } from 'react'
import { explain } from '../content/explain'
import { LESSONS, type Lesson } from '../content/lessons'
import { solve } from '../sim'
import type { Topic } from '../sim/generate'
import type { Region } from '../sim/types'
import { Panel } from './Panels'
import { ScenarioView } from './ScenarioView'

interface Props {
  region: Region
  lessonId: string
  onLesson: (id: string) => void
  onPractice: (topics: Topic[]) => void
}

function QuickList({ current, onLesson }: { current: string; onLesson: (id: string) => void }) {
  const groups = [...new Set(LESSONS.map((l) => l.group))]
  let n = 0
  return (
    <nav className="quick" aria-label="Quick reference">
      <h2>Quick reference</h2>
      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <ol>
            {LESSONS.filter((l) => l.group === g).map((l) => {
              n++
              return (
                <li key={l.id}>
                  <button className={l.id === current ? 'on' : ''} onClick={() => onLesson(l.id)} aria-current={l.id === current}>
                    <span className="num">{n}</span>
                    {l.quick ? (
                      <span className="rows">
                        <span>
                          <b>{l.quick.standOn}</b>
                          <i className="so">Stands on</i>
                        </span>
                        <span>
                          <b>{l.quick.giveWay}</b>
                          <i className="gw">Gives way</i>
                        </span>
                        {l.quickNote && <small>({l.quickNote})</small>}
                      </span>
                    ) : (
                      <span className="rows">
                        <span>
                          <b>{l.title}</b>
                        </span>
                        {l.quickNote && <small>{l.quickNote}</small>}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </nav>
  )
}

function LessonBody({ lesson, region, onPractice }: { lesson: Lesson; region: Region; onPractice: (t: Topic[]) => void }) {
  const [demoIx, setDemoIx] = useState(0)
  useEffect(() => setDemoIx(0), [lesson.id])
  const demo = lesson.demos[Math.min(demoIx, lesson.demos.length - 1)]
  const solved = useMemo(() => (demo ? solve(demo.scenario) : null), [demo])
  const ex = useMemo(() => (demo && solved && demo.play !== 'hold' ? explain(demo.scenario, solved, region) : null), [demo, solved, region])

  return (
    <>
      {demo && solved && (
        <section className="demo">
          {lesson.demos.length > 1 && (
            <div className="tabs" role="tablist">
              {lesson.demos.map((d, i) => (
                <button key={d.label} role="tab" aria-selected={i === demoIx} className={i === demoIx ? 'on' : ''} onClick={() => setDemoIx(i)}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
          <ScenarioView
            key={demo.scenario.id}
            scenario={demo.scenario}
            region={region}
            solved={solved}
            reveal={demo.play === 'hold' ? null : solved.best}
            hold={demo.play === 'hold'}
            loop
            showBearing={demo.showBearing}
          />
          <p className="caption">
            {ex?.role && <span className={`role ${ex.role === 'stand-on' ? 'so' : 'gw'}`}>{ex.role === 'both give way' ? 'Both give way' : ex.role === 'stand-on' ? 'You stand on' : 'You give way'}</span>}
            {demo.caption}
          </p>
        </section>
      )}
      <section className="lesson-text">
        {lesson.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {lesson.remember && (
          <p className="remember">
            <b>Remember</b> {lesson.remember}
          </p>
        )}
      </section>
      {lesson.panel && <Panel id={lesson.panel} region={region} />}
      {lesson.topics && (
        <button className="primary" onClick={() => onPractice(lesson.topics!)}>
          Practice this rule →
        </button>
      )}
    </>
  )
}

export function Learn({ region, lessonId, onLesson, onPractice }: Props) {
  const ix = Math.max(0, LESSONS.findIndex((l) => l.id === lessonId))
  const lesson = LESSONS[ix]
  const go = (d: number) => onLesson(LESSONS[Math.min(LESSONS.length - 1, Math.max(0, ix + d))].id)

  return (
    <div className="learn">
      <QuickList current={lesson.id} onLesson={onLesson} />
      <article className="lesson">
        <header>
          <div className="eyebrow">
            {lesson.group} · {ix + 1} of {LESSONS.length}
          </div>
          <h1>{lesson.title}</h1>
          <div className="cite">{lesson.cite}</div>
        </header>
        <LessonBody lesson={lesson} region={region} onPractice={onPractice} />
        <footer className="pager">
          <button onClick={() => go(-1)} disabled={ix === 0}>
            ← {ix > 0 ? LESSONS[ix - 1].title : 'Previous'}
          </button>
          <button onClick={() => go(1)} disabled={ix === LESSONS.length - 1}>
            {ix < LESSONS.length - 1 ? LESSONS[ix + 1].title : 'Next'} →
          </button>
        </footer>
      </article>
    </div>
  )
}
