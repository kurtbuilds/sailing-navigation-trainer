import { useEffect, useState } from 'react'
import { Learn } from './components/Learn'
import { applySettings, initialPractice, Practice, type PracticeState } from './components/Practice'
import { RegionPicker } from './components/RegionPicker'
import { LESSONS } from './content/lessons'
import type { Topic } from './sim/generate'
import type { Region } from './sim/types'

type Mode = 'learn' | 'practice'
const KEY = 'sailing-nav-trainer.region'

const readRegion = (): Region | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'A' || v === 'B' ? v : null
  } catch {
    return null
  }
}

/** The page lives at `#/learn/<lesson>` or `#/practice` so links and the back button work. */
const readHash = (): { mode: Mode; lesson: string } => {
  const [, mode, lesson] = window.location.hash.split('/')
  return { mode: mode === 'practice' ? 'practice' : 'learn', lesson: LESSONS.some((l) => l.id === lesson) ? lesson : LESSONS[0].id }
}

export function App() {
  const [region, setRegion] = useState<Region | null>(readRegion)
  const [picking, setPicking] = useState(region === null)
  const [route, setRoute] = useState(readHash)
  const [practice, setPractice] = useState<PracticeState>(initialPractice)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (mode: Mode, lesson = route.lesson) => {
    window.location.hash = mode === 'practice' ? '/practice' : `/learn/${lesson}`
    window.scrollTo({ top: 0 })
  }
  const pick = (r: Region) => {
    setRegion(r)
    setPicking(false)
    try {
      localStorage.setItem(KEY, r)
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }
  const practiceTopics = (topics: Topic[]) => {
    setPractice((s) => applySettings(s, { ...s.settings, topics }, true))
    go('practice')
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/learn/risk">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
            <path d="M16 3v19M17 4l9 17h-9zM14.5 8l-7 13h7z" fill="currentColor" />
            <path d="M5 24h22l-3.5 4h-15z" fill="#f2b544" />
          </svg>
          Sailing Navigation Trainer
        </a>
        <nav className="modes" aria-label="Mode">
          <button className={route.mode === 'learn' ? 'on' : ''} onClick={() => go('learn')}>
            Learn the rules
          </button>
          <button className={route.mode === 'practice' ? 'on' : ''} onClick={() => go('practice')}>
            Practice
          </button>
        </nav>
        <button className="region-btn" onClick={() => setPicking(true)} title="Change buoyage region">
          <span className={`dot ${region === 'A' ? 'red' : 'green'}`} />
          <span className={`dot ${region === 'A' ? 'green' : 'red'}`} />
          <span className="region-word">Region</span> {region ?? '—'}
          <small>{region === 'A' ? 'Europe / rest of world' : region === 'B' ? 'Americas' : ''}</small>
        </button>
      </header>
      {region && (
        <main>
          {route.mode === 'learn' ? (
            <Learn region={region} lessonId={route.lesson} onLesson={(id) => go('learn', id)} onPractice={practiceTopics} />
          ) : (
            <Practice region={region} state={practice} setState={setPractice} />
          )}
        </main>
      )}
      <footer className="foot">
        A study aid based on the International Regulations for Preventing Collisions at Sea (COLREGS) and the IALA buoyage system. Not a substitute for the{' '}
        <a href="https://www.navcen.uscg.gov/navigation-rules-amalgamated" target="_blank" rel="noreferrer">
          full rules
        </a>{' '}
        or for instruction on the water.
      </footer>
      {picking && <RegionPicker region={region} onPick={pick} first={region === null} />}
    </>
  )
}

