// The first-person view: sea, sky, your own boat around you, and whatever
// you are meeting. World (x east, y north) maps to three.js (x, up, -y).

import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
  BoxGeometry,
  CylinderGeometry,
} from 'three'
import { DEG, relBearing, type Vec } from '../sim/geometry'
import { inArc, navLights, type NavLight } from '../sim/lights'
import { markLook } from '../sim/marks'
import type { Pose } from '../sim/motion'
import { windAngle } from '../sim/rules'
import type { Mark, Region, Scenario, Vessel } from '../sim/types'
import { buildBuoy, buildVessel, buildWake, type VesselObject } from './boats'

export interface Frame {
  you: Pose
  other?: Pose
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor;
uniform float uNight, uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
  float sun = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sun, 900.0) * 6.0 + pow(sun, 24.0) * 0.28 + pow(sun, 4.0) * 0.08);
  // Fair-weather cumulus, thicker toward the horizon.
  vec2 uv = d.xz / (d.y + 0.22) * 1.6 + vec2(uTime * 0.004, 0.0);
  float c = smoothstep(0.52, 0.78, fbm(uv)) * smoothstep(0.0, 0.12, d.y);
  vec3 cloud = mix(vec3(1.0), uHorizon, 0.25) * (1.0 - uNight * 0.93);
  col = mix(col, cloud, c * 0.85 * (1.0 - uNight * 0.5));
  // Stars.
  vec2 sp = d.xz / (abs(d.y) + 0.35) * 90.0;
  float star = step(0.9965, hash(floor(sp))) * smoothstep(0.02, 0.2, d.y);
  col += vec3(star) * uNight * (1.0 - c) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

// Analytic normals from a handful of travelling sine waves plus two octaves of
// noise ripple, lit by fresnel sky reflection and a sun glitter path.
const SEA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float uTime, uNight;
uniform vec2 uWind;       // direction the waves travel (downwind), xz
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uDeep, uScatter;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main() {
  vec2 p = vWorld.xz;
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  vec2 g = vec2(0.0);
  float crest = 0.0;
  float ang = 0.0, freq = 0.11, amp = 0.34, spd = 0.9;
  for (int i = 0; i < 7; i++) {
    vec2 dir = rot(uWind, ang);
    float ph = dot(p, dir) * freq + uTime * spd;
    // Short waves shimmer into noise far away, so fade them with distance.
    float fade = 1.0 / (1.0 + dist * freq * 0.035);
    g += dir * freq * amp * cos(ph) * fade;
    crest += sin(ph) * amp * fade;
    ang += 0.71 + float(i) * 0.37;
    freq *= 1.62; amp *= 0.66; spd *= 1.17;
  }
  float rf = 1.0 / (1.0 + dist * 0.02);
  vec2 q = p * 0.9 + uWind * uTime * 0.7;
  float e = 0.35;
  float n0 = noise(q) + 0.5 * noise(q * 2.3 + 9.0);
  g += vec2(noise(q + vec2(e, 0)) + 0.5 * noise((q + vec2(e, 0)) * 2.3 + 9.0) - n0,
            noise(q + vec2(0, e)) + 0.5 * noise((q + vec2(0, e)) * 2.3 + 9.0) - n0) * 0.5 * rf;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float nv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(R.y, 0.45));
  // Light scattered back out of wave faces tilted toward the viewer.
  vec3 body = uDeep + uScatter * (0.25 + 0.75 * clamp(crest * 0.5 + 0.5, 0.0, 1.0)) * (0.35 + 0.65 * nv);
  vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0));
  float spec = pow(max(dot(R, uSunDir), 0.0), mix(420.0, 90.0, clamp(dist / 900.0, 0.0, 1.0)));
  col += uSunColor * spec * 2.4;
  // Whitecaps on the steepest crests when there is light to see them by.
  float cap = smoothstep(0.82, 1.05, crest + 0.55 * noise(p * 0.6 + uTime * 0.2)) * rf;
  col = mix(col, vec3(0.95), cap * 0.55 * (1.0 - uNight));
  float haze = smoothstep(250.0, 2600.0, dist);
  col = mix(col, uHorizon, haze);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

interface Palette {
  zenith: number
  horizon: number
  deep: number
  scatter: number
  sun: number
  sunDir: Vector3
}

const dirFrom = (azimuth: number, elevation: number) =>
  new Vector3(Math.sin(azimuth * DEG) * Math.cos(elevation * DEG), Math.sin(elevation * DEG), -Math.cos(azimuth * DEG) * Math.cos(elevation * DEG))

const DAY: Palette = { zenith: 0x2f6fc0, horizon: 0xc4dcee, deep: 0x06304a, scatter: 0x1a7f8e, sun: 0xfff1d6, sunDir: dirFrom(205, 34) }
const NIGHT: Palette = { zenith: 0x02040a, horizon: 0x0b1524, deep: 0x01060c, scatter: 0x05121c, sun: 0x9fb4d8, sunDir: dirFrom(120, 28) }

const SEEN_SCALE = { sloop: 1.6, motorboat: 1.8, trawler: 1.25, dredger: 1, ship: 1 }

const LIGHT_COLOR = { red: 0xff2b2b, green: 0x24ff7a, white: 0xfff6dc }

let glowTexture: CanvasTexture | null = null
function glow(): CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.12, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  glowTexture = new CanvasTexture(c)
  return glowTexture
}

interface Lit {
  light: NavLight
  sprite: Sprite
}

const toScene = (p: Vec, y = 0) => new Vector3(p.x, y, -p.y)

export class Scene3D {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(50, 1.6, 0.3, 9000)
  private sky: Mesh
  private sea: Mesh
  private skyMat: ShaderMaterial
  private seaMat: ShaderMaterial
  private hemi = new HemisphereLight(0xdfeeff, 0x25506a, 1.0)
  private ambient = new AmbientLight(0xffffff, 0.25)
  private sun = new DirectionalLight(0xfff3dd, 2.2)
  private content = new Group()
  private own: VesselObject | null = null
  private ownWake: Mesh | null = null
  private other: VesselObject | null = null
  private otherWake: Mesh | null = null
  private otherLights: Lit[] = []
  private buoys: Group[] = []
  private scenario: Scenario | null = null
  private frame: Frame | null = null
  /** Look direction relative to the bow, degrees (+ = starboard), and pitch. */
  yaw = 0
  pitch = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    const uniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uWind: { value: new Vector2(0, 1) },
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uSunDir: { value: new Vector3() },
      uSunColor: { value: new Color() },
      uDeep: { value: new Color() },
      uScatter: { value: new Color() },
    }
    this.skyMat = new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, side: BackSide, depthWrite: false, fog: false })
    this.seaMat = new ShaderMaterial({ vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, uniforms, fog: false })
    this.sky = new Mesh(new SphereGeometry(7000, 32, 16), this.skyMat)
    this.sky.renderOrder = -2
    this.sea = new Mesh(new PlaneGeometry(14000, 14000), this.seaMat)
    this.sea.rotation.x = -Math.PI / 2
    this.sea.renderOrder = -1
    this.scene.add(this.sky, this.sea, this.hemi, this.ambient, this.sun, this.content)
    this.scene.fog = new Fog(0xc4dcee, 300, 3200)
    this.camera.rotation.order = 'YXZ'
  }

  private applyPalette(night: boolean, windFrom: number) {
    const p = night ? NIGHT : DAY
    const u = this.seaMat.uniforms
    u.uNight.value = night ? 1 : 0
    u.uZenith.value.set(p.zenith)
    u.uHorizon.value.set(p.horizon)
    u.uDeep.value.set(p.deep)
    u.uScatter.value.set(p.scatter)
    u.uSunColor.value.set(p.sun).multiplyScalar(night ? 0.35 : 1)
    u.uSunDir.value.copy(p.sunDir)
    // Waves run downwind. Shader works in xz, so pack the direction as (x, z).
    const down = windFrom + 180
    u.uWind.value.set(Math.sin(down * DEG), -Math.cos(down * DEG))
    this.sun.position.copy(p.sunDir).multiplyScalar(100)
    this.sun.intensity = night ? 0.12 : 2.4
    this.sun.color.set(night ? 0x8aa4d6 : 0xfff3dd)
    this.hemi.intensity = night ? 0.06 : 1.1
    this.ambient.intensity = night ? 0.03 : 0.25
    ;(this.scene.fog as Fog).color.set(p.horizon)
  }

  private clear() {
    this.content.traverse((o) => {
      const m = o as Mesh
      if (m.geometry) m.geometry.dispose()
      const material = m.material
      if (Array.isArray(material)) material.forEach((x) => x.dispose())
      else if (material) material.dispose()
    })
    this.content.clear()
    this.own = this.other = null
    this.ownWake = this.otherWake = null
    this.otherLights = []
    this.buoys = []
  }

  setScenario(s: Scenario, region: Region) {
    this.clear()
    this.scenario = s
    const night = !!s.night
    this.applyPalette(night, s.wind)

    this.own = buildVessel(s.you.model, s.you.status, true)
    this.own.trim(windAngle(s.you, s.wind))
    this.ownWake = buildWake(s.you.model, s.you.speed)
    this.content.add(this.own.root, this.ownWake)

    if (s.kind === 'encounter') {
      this.other = buildVessel(s.other.model, s.other.status)
      this.other.trim(windAngle(s.other, s.wind))
      this.otherWake = buildWake(s.other.model, s.other.speed)
      // Small craft are drawn larger than life, as if through binoculars, so their sails and shape can be read at range.
      const zoom = SEEN_SCALE[s.other.model]
      this.other.root.scale.setScalar(zoom)
      this.otherWake.scale.setScalar(zoom)
      this.content.add(this.other.root, this.otherWake)
      if (night) this.otherLights = this.addLights(s.other, this.other.root)
    }
    const marks: Mark[] = [...(s.scenery?.marks ?? []), ...(s.kind === 'mark' ? [s.mark] : [])]
    for (const m of marks) {
      const b = buildBuoy(markLook(m.kind, region))
      b.position.copy(toScene(m.pos))
      b.userData.phase = (m.pos.x * 0.37 + m.pos.y * 0.11) % 6.28
      this.buoys.push(b)
      this.content.add(b)
    }
    if (s.scenery?.shoreBearing !== undefined) this.content.add(this.buildShore(s.scenery.shoreBearing, night))
    this.frame = { you: { pos: s.you.pos, heading: s.you.heading }, other: s.kind === 'encounter' ? { pos: s.other.pos, heading: s.other.heading } : undefined }
  }

  private addLights(v: Vessel, root: Group): Lit[] {
    return navLights(v).map((light) => {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: glow(),
          color: LIGHT_COLOR[light.color],
          blending: AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: false,
          fog: false,
          transparent: true,
        }),
      )
      sprite.position.set(light.at[0], light.at[1], -light.at[2])
      sprite.scale.setScalar(light.color === 'white' ? 0.026 : 0.03)
      root.add(sprite)
      return { light, sprite }
    })
  }

  /** A stretch of coast with a harbour town, so "returning" and "leaving" look different. */
  private buildShore(bearing: number, night: boolean): Group {
    const g = new Group()
    const R = 1500
    const N = 64
    const span = 150
    const pos: number[] = []
    const idx: number[] = []
    const h = (a: number) => 30 + 70 * (0.5 + 0.5 * Math.sin(a * 0.071 + 1.3)) * (0.6 + 0.4 * Math.sin(a * 0.19 + 0.4)) + 14 * Math.sin(a * 0.53)
    for (let i = 0; i <= N; i++) {
      const a = bearing - span / 2 + (span * i) / N
      const edge = Math.sin((Math.PI * i) / N)
      const x = Math.sin(a * DEG)
      const z = -Math.cos(a * DEG)
      pos.push(x * R, -1, z * R, x * (R + 500), Math.max(4, h(a) * Math.pow(edge, 0.5)), z * (R + 500))
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const land = new Mesh(geo, new MeshStandardMaterial({ color: 0x4d6b4a, roughness: 1, side: DoubleSide }))
    g.add(land)
    const wall = new MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.9, emissive: night ? 0xffc46b : 0x000000, emissiveIntensity: night ? 0.6 : 0 })
    for (let i = 0; i < 26; i++) {
      const a = bearing + (((i * 37) % 52) - 26) * 0.9
      const w = 14 + ((i * 13) % 18)
      const ht = 8 + ((i * 7) % 16)
      const b = new Mesh(new BoxGeometry(w, ht, 14), wall)
      const r = R + 40 + ((i * 29) % 90)
      b.position.set(Math.sin(a * DEG) * r, ht / 2 + 2, -Math.cos(a * DEG) * r)
      b.rotation.y = -a * DEG
      g.add(b)
    }
    // Harbour breakwater with a light on the end.
    const tower = new Mesh(new CylinderGeometry(2.2, 3.2, 26, 12), new MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 }))
    tower.position.set(Math.sin((bearing + 9) * DEG) * (R - 60), 13, -Math.cos((bearing + 9) * DEG) * (R - 60))
    g.add(tower)
    return g
  }

  setFrame(frame: Frame) {
    this.frame = frame
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  /** Horizontal half field of view, degrees. */
  get halfFov(): number {
    return Math.atan(Math.tan((this.camera.fov * DEG) / 2) * this.camera.aspect) / DEG
  }

  render(time: number) {
    const s = this.scenario
    const f = this.frame
    if (!s || !f || !this.own) return
    this.seaMat.uniforms.uTime.value = time

    const place = (obj: VesselObject, wake: Mesh | null, pose: Pose, v: Vessel, phase: number) => {
      const big = v.model === 'ship' || v.model === 'dredger'
      const bob = big ? 0 : Math.sin(time * 1.1 + phase) * 0.11
      const pitch = big ? 0 : Math.sin(time * 0.9 + phase * 1.7) * 0.022
      const roll = obj.heel(windAngle({ ...v, heading: pose.heading }, s.wind)) + (big ? 0 : Math.sin(time * 0.75 + phase) * 0.03)
      obj.root.position.set(pose.pos.x, bob, -pose.pos.y)
      obj.root.rotation.set(pitch, -pose.heading * DEG, roll, 'YXZ')
      if (wake) {
        wake.position.set(pose.pos.x, 0, -pose.pos.y)
        wake.rotation.y = -pose.heading * DEG
      }
      return bob
    }
    const bob = place(this.own, this.ownWake, f.you, s.you, 0)
    if (this.other && f.other && s.kind === 'encounter') {
      place(this.other, this.otherWake, f.other, s.other, 2.1)
      this.other.trim(windAngle({ ...s.other, heading: f.other.heading }, s.wind))
      const from = relBearing(f.other.pos, f.other.heading, f.you.pos)
      for (const l of this.otherLights) l.sprite.visible = inArc(from, l.light)
    }
    this.own.trim(windAngle({ ...s.you, heading: f.you.heading }, s.wind))
    for (const b of this.buoys) {
      b.position.y = Math.sin(time * 1.3 + b.userData.phase) * 0.12
      b.rotation.z = Math.sin(time * 0.9 + b.userData.phase) * 0.06
    }

    // Eye position: at the helm, level with the horizon (the boat heels, your head doesn't).
    const [ex, ey, ez] = this.own.eye
    const h = f.you.heading * DEG
    const cx = f.you.pos.x + ex * Math.cos(h) - ez * Math.sin(h)
    const cz = -f.you.pos.y + ex * Math.sin(h) + ez * Math.cos(h)
    this.camera.position.set(cx, ey + bob * 0.8, cz)
    this.camera.rotation.set(this.pitch * DEG + Math.sin(time * 0.9) * 0.006, -(f.you.heading + this.yaw) * DEG, Math.sin(time * 0.75) * 0.012)
    this.sky.position.copy(this.camera.position)
    this.sea.position.set(this.camera.position.x, 0, this.camera.position.z)
    this.renderer.render(this.scene, this.camera)
  }

  /** Where a world point falls on screen: x in -1..1 (left..right), or off-screen. */
  project(p: Vec, height = 2): { x: number; y: number; onScreen: boolean } {
    const v = toScene(p, height).project(this.camera)
    const behind = v.z > 1
    return { x: v.x, y: v.y, onScreen: !behind && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 1.2 }
  }

  dispose() {
    this.clear()
    this.sky.geometry.dispose()
    this.sea.geometry.dispose()
    this.skyMat.dispose()
    this.seaMat.dispose()
    this.renderer.dispose()
  }
}
