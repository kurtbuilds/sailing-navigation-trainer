import { useEffect, useRef, useState } from 'react'
import { norm180, relBearing, type Vec } from '../sim/geometry'
import { windAngle } from '../sim/rules'
import type { Region, Scenario } from '../sim/types'
import { Scene3D, type Frame } from '../three/scene'

interface Props {
  scenario: Scenario
  region: Region
  /** Latest poses; read every animation frame. */
  frame: Frame
  banner?: string | null
}

const lookWords = (yaw: number): string => {
  const a = Math.abs(yaw)
  const side = yaw < 0 ? 'port' : 'starboard'
  if (a < 12) return 'Looking ahead'
  if (a > 165) return 'Looking astern'
  if (a < 65) return `Looking over the ${side} bow`
  if (a < 115) return `Looking abeam to ${side}`
  return `Looking over the ${side} quarter`
}

/** Where the thing you should be watching is, for the initial view and the edge pointer. */
const targetOf = (s: Scenario, f: Frame): Vec => (s.kind === 'encounter' ? (f.other?.pos ?? s.other.pos) : s.mark.pos)

export function FirstPerson({ scenario, region, frame, banner }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene3D | null>(null)
  const frameRef = useRef(frame)
  const scenarioRef = useRef(scenario)
  frameRef.current = frame
  scenarioRef.current = scenario
  const [yaw, setYaw] = useState(0)
  const [failed, setFailed] = useState(false)
  const manual = useRef(false)
  const shownYaw = useRef(0)

  // One renderer for the life of the component.
  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    let scene: Scene3D
    try {
      scene = new Scene3D(canvas)
    } catch {
      setFailed(true)
      return
    }
    sceneRef.current = scene
    const fit = () => scene.resize(wrap.clientWidth, wrap.clientHeight)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    let raf = 0
    const t0 = performance.now()
    const loop = (now: number) => {
      scene.setFrame(frameRef.current)
      // Until you take over by dragging, your head follows the other vessel as the boats turn.
      if (!manual.current) {
        const f = frameRef.current
        const rb = relBearing(f.you.pos, f.you.heading, targetOf(scenarioRef.current, f))
        const want = Math.abs(rb) > 28 ? rb - Math.sign(rb) * 22 : 0
        const diff = norm180(want - scene.yaw)
        if (Math.abs(diff) > 0.2) {
          scene.yaw = norm180(scene.yaw + diff * 0.06)
          if (Math.abs(scene.yaw - shownYaw.current) > 2) {
            shownYaw.current = scene.yaw
            setYaw(scene.yaw)
          }
        }
      }
      scene.render((now - t0) / 1000)
      // Edge pointer toward the other vessel / mark when it is out of view.
      const el = pointerRef.current
      const s = scenarioRef.current
      if (el) {
        const target = targetOf(s, frameRef.current)
        const p = scene.project(target, s.kind === 'encounter' ? 3 : 2)
        const you = frameRef.current.you
        const rel = norm180(relBearing(you.pos, you.heading, target) - scene.yaw)
        el.style.display = p.onScreen ? 'none' : 'flex'
        el.dataset.side = rel < 0 ? 'left' : 'right'
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // New scenario: rebuild the scene and turn your head toward the action.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setScenario(scenario, region)
    const you = scenario.you
    const rb = relBearing(you.pos, you.heading, targetOf(scenario, { you }))
    const start = Math.abs(rb) > 28 ? rb - Math.sign(rb) * 22 : 0
    manual.current = false
    scene.yaw = start
    scene.pitch = scenario.kind === 'encounter' && scenario.other.model === 'ship' ? 4 : -1
    setYaw(start)
  }, [scenario, region])

  // Drag to look around.
  useEffect(() => {
    const wrap = wrapRef.current!
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
    const down = (e: PointerEvent) => {
      const scene = sceneRef.current
      if (!scene) return
      manual.current = true
      drag = { x: e.clientX, y: e.clientY, yaw: scene.yaw, pitch: scene.pitch }
      wrap.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const scene = sceneRef.current
      if (!drag || !scene) return
      const k = (scene.halfFov * 2) / wrap.clientWidth
      scene.yaw = norm180(drag.yaw - (e.clientX - drag.x) * k)
      scene.pitch = Math.max(-25, Math.min(30, drag.pitch + (e.clientY - drag.y) * k))
      setYaw(scene.yaw)
    }
    const up = () => (drag = null)
    wrap.addEventListener('pointerdown', down)
    wrap.addEventListener('pointermove', move)
    wrap.addEventListener('pointerup', up)
    wrap.addEventListener('pointercancel', up)
    return () => {
      wrap.removeEventListener('pointerdown', down)
      wrap.removeEventListener('pointermove', move)
      wrap.removeEventListener('pointerup', up)
      wrap.removeEventListener('pointercancel', up)
    }
  }, [])

  const look = (to: number | 'follow') => {
    const scene = sceneRef.current
    if (!scene) return
    manual.current = to !== 'follow'
    if (to === 'follow') return
    scene.yaw = to
    scene.pitch = 0
    setYaw(to)
  }

  const twa = windAngle({ ...scenario.you, heading: frame.you.heading }, scenario.wind)
  const what = scenario.kind === 'encounter' ? 'Other vessel' : 'Mark'

  return (
    <div className="fp" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="First-person view from the helm" />
      {failed && <div className="fp-failed">This browser couldn’t start WebGL, so the helm view is unavailable. The overhead view still works.</div>}
      <div className="view-title">From the helm{scenario.night ? ' · night' : ''}</div>
      <div className="fp-look">
        {lookWords(yaw)}
        {Math.abs(yaw) > 1 && (
          <button onClick={() => look(0)} title="Look straight ahead">
            Face forward
          </button>
        )}
      </div>
      <div className="fp-pointer" ref={pointerRef} onClick={() => look('follow')}>
        <span>{what}</span>
      </div>
      {/* Wind and view direction relative to your own boat. */}
      <svg className="fp-dial" viewBox="-50 -50 100 100" aria-label={`Wind ${Math.round(Math.abs(twa))} degrees off the ${twa < 0 ? 'port' : 'starboard'} bow`}>
        <circle r="46" className="dial-bg" />
        <path d={`M0,0 L${46 * Math.sin(((yaw - 32) * Math.PI) / 180)},${-46 * Math.cos(((yaw - 32) * Math.PI) / 180)} A46,46 0 0 1 ${46 * Math.sin(((yaw + 32) * Math.PI) / 180)},${-46 * Math.cos(((yaw + 32) * Math.PI) / 180)} Z`} className="dial-view" />
        <path d="M0,-22 C7,-12 7,10 4.5,20 L-4.5,20 C-7,10 -7,-12 0,-22 Z" className="dial-boat" />
        <g transform={`rotate(${twa})`}>
          <path d="M0,-46 L0,-27 M-5,-33 L0,-26 L5,-33" className="dial-wind" />
        </g>
        <text y="38" textAnchor="middle" className="dial-label">
          WIND
        </text>
      </svg>
      <div className="fp-hint">Drag to look around</div>
      {banner && <div className="fp-banner">{banner}</div>}
    </div>
  )
}
