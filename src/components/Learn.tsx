import { useMemo, useState } from 'react'
import { explain } from '../content/explain'
import { LESSONS, type Lesson, type Section } from '../content/lessons'
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
      <p className="quick-note">Each rule is named for who stands on.</p>
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
                    <span className="rows">
                      <b>{l.title}</b>
                      {l.when && <small>{l.when}</small>}
                    </span>
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

function SectionView({ section, heading, region }: { section: Section; heading?: string; region: Region }) {
  const [demoIx, setDemoIx] = useState(0)
  const demo = section.demos[Math.min(demoIx, section.demos.length - 1)]
  const solved = useMemo(() => (demo ? solve(demo.scenario) : null), [demo])
  const ex = useMemo(() => (demo && solved && demo.play !== 'hold' ? explain(demo.scenario, solved, region) : null), [demo, solved, region])

  return (
    <>
      {heading && (
        <header className="section-head">
          <h2>{heading}</h2>
          <div className="cite">{section.cite}</div>
        </header>
      )}
      {demo && solved && (
        <section className="demo">
          {section.demos.length > 1 && (
            <div className="tabs" role="tablist">
              {section.demos.map((d, i) => (
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
            showBearing={demo.showBearing}
          />
          <p className="caption">
            {ex?.role && <span className={`role ${ex.role === 'stand-on' ? 'so' : 'gw'}`}>{ex.role === 'both give way' ? 'Both give way' : ex.role === 'stand-on' ? 'You stand on' : 'You give way'}</span>}
            {demo.caption}
          </p>
        </section>
      )}
      <section className="lesson-text">
        {section.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {section.remember && (
          <p className="remember">
            <b>Remember</b> {section.remember}
          </p>
        )}
      </section>
      {section.panel && <Panel id={section.panel} region={region} />}
    </>
  )
}

/** A page of several sections is headed by its name; a single rule by its own heading. */
const pageName = (l: Lesson) => (l.sections ? l.title : (l.heading ?? l.title))

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
            {lesson.group}
            {!lesson.sections && lesson.when ? ` · ${lesson.when}` : ''}
          </div>
          <h1>{pageName(lesson)}</h1>
          {!lesson.sections && <div className="cite">{lesson.cite}</div>}
        </header>
        {[lesson, ...(lesson.sections ?? [])].map((s, i) => (
          <SectionView key={`${lesson.id}-${i}`} section={s} heading={lesson.sections ? s.heading : undefined} region={region} />
        ))}
        {lesson.topics && (
          <button className="primary" onClick={() => onPractice(lesson.topics!)}>
            Practice this rule →
          </button>
        )}
        <footer className="pager">
          <button onClick={() => go(-1)} disabled={ix === 0}>
            ← {ix > 0 ? pageName(LESSONS[ix - 1]) : 'Previous'}
          </button>
          <button onClick={() => go(1)} disabled={ix === LESSONS.length - 1}>
            {ix < LESSONS.length - 1 ? pageName(LESSONS[ix + 1]) : 'Next'} →
          </button>
        </footer>
      </article>
    </div>
  )
}
