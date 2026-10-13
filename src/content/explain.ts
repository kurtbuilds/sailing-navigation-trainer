// Turns a solved scenario into words: which rule applies, why it applies to
// this particular picture, and what to do about it.

import type { Playback, Solved } from '../sim'
import { norm180 } from '../sim/geometry'
import { isPreferred, markLook, treatAs } from '../sim/marks'
import { windAngle } from '../sim/rules'
import type { Action, Encounter, MarkScenario, Region, Scenario, Vessel } from '../sim/types'

export type CardId =
  | 'overtaking'
  | 'narrow-channel'
  | 'hierarchy'
  | 'sail-vs-power'
  | 'sail-opposite-tack'
  | 'sail-same-tack'
  | 'head-on'
  | 'crossing'
  | 'lateral-marks'
  | 'preferred-marks'

export interface RuleCard {
  title: string
  /** The rule in one line. */
  rule: string
  cite: string
}

export const CARDS: Record<CardId, RuleCard> = {
  'sail-opposite-tack': {
    title: 'Starboard tack stands on',
    rule: 'When two sailboats have the wind on different sides, the one with the wind on her port side keeps out of the way.',
    cite: 'Rule 12(a)(i)',
  },
  'sail-same-tack': {
    title: 'The leeward boat stands on',
    rule: 'When two sailboats have the wind on the same side, the one to windward keeps out of the way of the one to leeward.',
    cite: 'Rule 12(a)(ii)',
  },
  overtaking: {
    title: 'The vessel being overtaken stands on',
    rule: 'Any vessel coming up on another from more than 22.5° abaft her beam keeps out of the way until she is past and clear — sail or power, it makes no difference.',
    cite: 'Rule 13',
  },
  'head-on': {
    title: 'Head-on under power: both turn to starboard',
    rule: 'Two power-driven vessels meeting on reciprocal courses each alter to starboard and pass port side to port side.',
    cite: 'Rule 14',
  },
  crossing: {
    title: 'Crossing under power: the vessel on the right stands on',
    rule: 'When two power-driven vessels cross, the one that has the other on her own starboard side keeps out of the way, and avoids crossing ahead.',
    cite: 'Rule 15',
  },
  'sail-vs-power': {
    title: 'Sail stands on over power',
    rule: 'A power-driven vessel keeps out of the way of a sailing vessel. A sailboat with her engine driving her is a power-driven vessel.',
    cite: 'Rule 18(a), Rule 3',
  },
  hierarchy: {
    title: 'The less maneuverable vessel stands on',
    rule: 'Not under command → restricted in ability to maneuver → fishing → sailing → power-driven. Each keeps out of the way of everything earlier in the list.',
    cite: 'Rule 18',
  },
  'narrow-channel': {
    title: 'Keep clear of a ship confined to the channel',
    rule: 'A sailing vessel, or any vessel under 20 m, shall not impede a vessel that can safely navigate only inside the channel.',
    cite: 'Rule 9(b)',
  },
  'lateral-marks': {
    title: 'Lateral marks show the sides of the channel',
    rule: 'Lateral marks are laid for a vessel coming in from sea. Going the other way, the sides swap.',
    cite: 'IALA Maritime Buoyage System',
  },
  'preferred-marks': {
    title: 'Preferred-channel marks: follow the main color',
    rule: 'Where a channel splits, a banded mark shows the preferred channel. Treat it as a lateral mark of its main (top) color.',
    cite: 'IALA Maritime Buoyage System',
  },
}

export const lateralRule = (region: Region): string =>
  region === 'B'
    ? 'Region B: “red, right, returning” — coming in from sea, keep red marks to starboard (right) and green marks to port (left).'
    : 'Region A: coming in from sea, keep red marks to port (left) and green marks to starboard (right).'

export function describeVessel(v: Vessel): string {
  if (v.confined) return 'a ship that can only navigate inside the channel'
  switch (v.status) {
    case 'sail':
      return 'a sailboat under sail'
    case 'power':
      return v.model === 'sloop' ? 'a sailboat motoring with her sails down' : v.model === 'ship' ? 'a ship' : 'a motorboat'
    case 'fishing':
      return 'a trawler engaged in fishing'
    case 'ram':
      return 'a dredger restricted in her ability to maneuver'
    case 'nuc':
      return 'a ship not under command'
  }
}

/** Short tag for the overhead view. */
export function vesselTag(v: Vessel): string {
  if (v.confined) return 'Ship (confined to channel)'
  switch (v.status) {
    case 'sail':
      return 'Sailboat (sailing)'
    case 'power':
      return v.model === 'sloop' ? 'Sailboat (motoring)' : v.model === 'ship' ? 'Ship' : 'Motorboat'
    case 'fishing':
      return 'Trawler (fishing)'
    case 'ram':
      return 'Dredger (restricted)'
    case 'nuc':
      return 'Ship (not under command)'
  }
}

export const youAre = (v: Vessel): string =>
  v.status === 'sail' ? 'You are under sail.' : 'You are motoring: sails down, engine on.'

export function sideWords(bearing: number): string {
  const a = Math.abs(norm180(bearing))
  const side = bearing < 0 ? 'port' : 'starboard'
  if (a < 8) return 'dead ahead'
  if (a > 172) return 'dead astern'
  if (a < 60) return `on your ${side} bow`
  if (a < 110) return `on your ${side} beam`
  return `on your ${side} quarter`
}

export const ACTION_LABEL: Record<Action, string> = {
  'stand-on': 'Stand on',
  port: 'Turn to port',
  starboard: 'Turn to starboard',
}

export interface Explanation {
  card: RuleCard
  cardId: CardId
  /** You are the … vessel. */
  role: 'stand-on' | 'give-way' | 'both give way' | null
  /** Why this rule applies to this picture. */
  why: string[]
  /** What to do. */
  action: string
  /** Other acceptable moves, sound signals, caveats. */
  notes: string[]
}

function sailTurnWord(v: Vessel, wind: number, a: Action): string {
  if (v.status !== 'sail' || a === 'stand-on') return ''
  const dir = a === 'starboard' ? 1 : -1
  const headingUp = Math.sign(windAngle(v, wind) || 1) === dir
  return headingUp ? ' (heading up, toward the wind)' : ' (bearing away, off the wind)'
}

function explainEncounter(e: Encounter, solved: Extract<Solved, { kind: 'encounter' }>): Explanation {
  const { verdict: v, best, acceptable, tackOption } = { ...solved.res, tackOption: solved.res.tackOption }
  const f = v.facts
  const card = CARDS[v.rule]
  const why: string[] = []
  const notes: string[] = []
  const her = describeVessel(e.other)
  const giveWay = v.you === 'give-way'

  switch (v.rule) {
    case 'sail-opposite-tack':
      why.push(
        `The wind is on your ${f.youTack} side, so you are on ${f.youTack} tack. The other boat has the wind on her ${f.otherTack} side: ${f.otherTack} tack.`,
        giveWay ? 'You are the port-tack boat, so you keep clear.' : 'You are the starboard-tack boat, so she keeps clear of you.',
      )
      break
    case 'sail-same-tack':
      why.push(
        `Both boats are on ${f.youTack} tack, so tack doesn’t decide it — position does.`,
        f.windward === 'you'
          ? 'You are the windward boat (nearer to where the wind is coming from), so you keep clear.'
          : 'She is the windward boat (nearer to where the wind is coming from), so she keeps clear of you.',
      )
      break
    case 'overtaking':
      if (f.overtaker === 'you') {
        why.push('You are coming up on her from more than 22.5° abaft her beam — from where, at night, you would see only her sternlight. That makes you the overtaking vessel.')
        if (e.you.status === 'sail' && e.other.status !== 'sail') why.push('Being under sail doesn’t help you here: the overtaking rule comes before “power gives way to sail”.')
      } else {
        why.push('She is coming up on you from more than 22.5° abaft your beam, so she is overtaking and must keep clear until she is past.')
        if (e.other.status === 'sail' && e.you.status !== 'sail') why.push('Even though she is sailing and you are motoring, the overtaking rule comes first: she keeps clear of you.')
      }
      break
    case 'head-on':
      why.push(`You are motoring and so is she (${her}), on nearly opposite courses with each seeing the other ahead. Neither is stand-on: both must act.`)
      break
    case 'crossing':
      why.push(
        `You are both power-driven (you are motoring; she is ${her}) and your courses cross.`,
        giveWay
          ? `She is ${sideWords(f.otherFromYou)} — your starboard side — so you keep clear. At night you would be looking at her red port light: red means stop.`
          : `She is ${sideWords(f.otherFromYou)} — your port side — which means you are on HER starboard side, so she keeps clear.`,
      )
      break
    case 'sail-vs-power':
      why.push(
        giveWay
          ? `With your sails down and the engine on you are a power-driven vessel. She is ${her}. Power keeps clear of sail.`
          : `You are sailing; she is ${her}, a power-driven vessel. Power keeps clear of sail.`,
        'Neither boat is overtaking the other, which is the one case where this would be reversed.',
      )
      break
    case 'hierarchy':
      why.push(
        `She is ${her}. That puts her above you in the pecking order — she can’t get out of your way as easily as you can get out of hers.`,
        e.you.status === 'sail' ? 'Being under sail gives you priority over ordinary power-driven vessels only.' : 'As a power-driven vessel you are at the bottom of the order.',
      )
      break
    case 'narrow-channel':
      why.push(
        'The ship is following the buoyed channel and cannot leave it. You are small and have water outside the channel.',
        e.you.status === 'sail' ? 'Sail does not have priority here: Rule 9 says a sailing vessel shall not impede her.' : 'A vessel under 20 m shall not impede her.',
      )
      break
  }

  let action: string
  if (v.rule === 'head-on') {
    action = 'Turn to starboard, early and clearly, so you pass port side to port side. She should do the same.'
    notes.push('One short blast on the horn means “I am altering course to starboard”.')
  } else if (!giveWay) {
    action = 'Stand on: hold your course and speed so she can plan around you.'
    notes.push('Keep watching her. If it becomes clear she isn’t keeping out of the way you may act, and if a collision can’t be avoided by her action alone you must (Rule 17).')
  } else {
    const towardHer = Math.sign(f.otherFromYou) === (best === 'starboard' ? 1 : -1)
    const how =
      v.rule === 'overtaking'
        ? `and pass well clear down her ${best === 'starboard' ? 'starboard' : 'port'} side`
        : towardHer
          ? 'and pass astern of her — never across her bow'
          : 'to open the gap and let her go ahead'
    action = `Turn to ${best}${sailTurnWord(e.you, e.wind, best)}, early and obviously, ${how}.`
    if (v.rule === 'overtaking' && acceptable.length > 1) notes.push('When overtaking you may pass on either side, so either turn is accepted here. The one shown leaves more room.')
    if (tackOption && tackOption !== best) notes.push(`Turning to ${tackOption} here means ${Math.abs(windAngle(e.you, e.wind)) < 90 ? 'tacking' : 'gybing'} away, which would also keep you clear, so it is accepted too.`)
    notes.push('Slowing down or stopping is always allowed as well (Rule 8). Make whatever you do big enough for her to see.')
    if (e.you.status === 'power') notes.push(`Horn: ${best === 'starboard' ? 'one short blast = “I am altering course to starboard”' : 'two short blasts = “I am altering course to port”'}.`)
  }
  if (e.night) notes.push('At night you read all of this from her lights: red = her port side, green = her starboard side, a single white = her stern. A white masthead light above the colors means she is under power.')

  return { card, cardId: v.rule, role: v.rule === 'head-on' ? 'both give way' : v.you, why, action, notes }
}

function explainMark(s: MarkScenario, solved: Extract<Solved, { kind: 'mark' }>, region: Region): Explanation {
  const look = markLook(s.mark.kind, region)
  const pref = isPreferred(s.mark.kind)
  const cardId: CardId = pref ? 'preferred-marks' : 'lateral-marks'
  const hand = treatAs(s.mark.kind) === 'port-hand' ? 'port' : 'starboard'
  const { required, offset, best } = solved.res
  const shape = look.shape === 'can' ? 'can (flat top)' : region === 'B' ? 'nun (pointed top)' : 'cone (pointed top)'
  const why: string[] = [lateralRule(region)]
  if (pref) {
    why.push(`This ${look.color} mark with a ${look.band} band is a preferred-channel mark. Its main color is ${look.color}, so for the preferred channel treat it exactly like a ${look.color} ${look.shape === 'can' ? 'can' : 'cone'}: a ${hand}-hand mark.`)
  } else {
    why.push(`A ${look.color} ${shape} is a ${hand}-hand mark in this region.`)
  }
  why.push(
    s.direction === 'returning'
      ? `You are coming in from sea, so it belongs on your ${required} side.`
      : `You are heading out to sea — against the direction of buoyage — so everything is reversed and it belongs on your ${required} side.`,
  )
  const where = Math.abs(offset) < 2.5 ? 'dead ahead' : `${Math.round(Math.abs(offset))} m to ${offset > 0 ? 'starboard' : 'port'} of your track`
  const action =
    best === 'stand-on'
      ? `It is ${where}, already on the correct side with room to spare. Hold your course.`
      : `It is ${where}. Turn to ${best} so that it passes down your ${required} side.`
  const notes = [
    'Shape backs up color: port-hand marks are cans, starboard-hand marks are cones, in both regions. Red marks carry even numbers, green marks odd.',
  ]
  return { card: CARDS[cardId], cardId, role: null, why, action, notes }
}

export function explain(s: Scenario, solved: Solved, region: Region): Explanation {
  if (s.kind === 'encounter' && solved.kind === 'encounter') return explainEncounter(s, solved)
  if (s.kind === 'mark' && solved.kind === 'mark') return explainMark(s, solved, region)
  throw new Error('scenario and solution do not match')
}

/** One line on what the played-out answer led to. */
export function outcomeText(s: Scenario, solved: Solved, answer: Action, p: Playback): string {
  const correct = solved.acceptable.includes(answer)
  if (s.kind === 'mark') {
    if (p.result === 'hit-mark') return 'You hit the mark.'
    if (p.result === 'wrong-side') return 'You left the mark on the wrong side — outside the channel, where the shallow water is.'
    return correct ? `Mark left ${Math.round(p.minSep)} m to ${solved.kind === 'mark' ? solved.res.required : ''}: in the channel.` : 'You stayed on the right side of it, but the turn wasn’t needed and takes you across the channel.'
  }
  const youGiveWay = solved.kind === 'encounter' && solved.res.verdict.you === 'give-way'
  switch (p.result) {
    case 'collision':
      return 'Collision.'
    case 'close':
      return `Far too close: the hulls came within ${Math.max(0, Math.round(p.minSep))} m.`
    case 'crossed-ahead':
      return 'You cut across her bow. If she had not seen you, or you had misjudged her speed, that is a collision.'
    case 'stuck':
      return 'That turn only keeps you clear while you stay off your course. Come back to it and you are on a collision course again.'
    case 'clear':
      if (correct) return `Clear: the closest you came was ${Math.round(p.minSep)} m.`
      if (answer === 'stand-on') return 'It worked out, but only because the other skipper did all the work. You were required to act too.'
      return youGiveWay
        ? 'You stayed clear this time, but it is not the maneuver the rule asks for.'
        : 'You got away with it, but as the stand-on vessel you are required to hold course so the other skipper can predict you. Dodging can turn you straight into the path of her avoiding turn.'
  }
  return ''
}
