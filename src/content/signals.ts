// Sound signals (COLREGS Part D). '.' = short blast (~1 s), '-' = prolonged blast (4–6 s).

export interface Signal {
  pattern: string
  meaning: string
  note?: string
}

export const MANEUVERING: Signal[] = [
  { pattern: '.', meaning: 'I am altering my course to starboard', note: 'US Inland: “I intend to leave you on my port side”' },
  { pattern: '..', meaning: 'I am altering my course to port', note: 'US Inland: “I intend to leave you on my starboard side”' },
  { pattern: '...', meaning: 'I am operating astern propulsion (engines in reverse)' },
  { pattern: '.....', meaning: 'Danger / doubt: I don’t understand your intentions, or doubt you are doing enough to avoid collision', note: 'Five or more short, rapid blasts. Any vessel may sound it.' },
  { pattern: '-', meaning: 'Approaching a blind bend, or leaving a dock or berth', note: 'A vessel round the bend answers with the same.' },
  { pattern: '--.', meaning: 'In a narrow channel: I intend to overtake you on your starboard side', note: 'International Rules' },
  { pattern: '--..', meaning: 'In a narrow channel: I intend to overtake you on your port side', note: 'International Rules' },
  { pattern: '-.-.', meaning: 'Agreement to be overtaken', note: 'International Rules' },
]

export const FOG: Signal[] = [
  { pattern: '-', meaning: 'Power-driven vessel making way through the water' },
  { pattern: '--', meaning: 'Power-driven vessel under way but stopped' },
  { pattern: '-..', meaning: 'Sailing vessel — and vessels fishing, restricted in ability to maneuver, not under command, or towing', note: 'This is your signal under sail.' },
]

let ctx: AudioContext | null = null

/** Sound a pattern on a synthesized horn. Returns the duration in seconds. */
export function sound(pattern: string): number {
  ctx ??= new AudioContext()
  const ac = ctx
  void ac.resume()
  let at = ac.currentTime + 0.05
  const start = at
  for (const ch of pattern) {
    const len = ch === '-' ? 2.6 : 0.7
    const gain = ac.createGain()
    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.22, at + 0.06)
    gain.gain.setValueAtTime(0.22, at + len - 0.12)
    gain.gain.linearRampToValueAtTime(0, at + len)
    for (const [freq, type] of [
      [174, 'sawtooth'],
      [220, 'sawtooth'],
      [87, 'square'],
    ] as const) {
      const osc = ac.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      osc.connect(filter)
      osc.start(at)
      osc.stop(at + len)
    }
    filter.connect(gain).connect(ac.destination)
    at += len + 0.45
  }
  return at - start
}
