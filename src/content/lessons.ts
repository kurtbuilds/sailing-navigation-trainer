// The Learn mode syllabus. Every demonstration is a real scenario run
// through the same rules engine as the quiz (and checked by lessons.test.ts).

import type { Topic } from '../sim/generate'
import { meet } from '../sim/generate'
import { add, dirVec, norm360, scale } from '../sim/geometry'
import type { RuleId } from '../sim/rules'
import type { Encounter, Mark, MarkKind, MarkScenario, Model, Scenario, Status, Vessel } from '../sim/types'

export type PanelId = 'signals' | 'marks-chart' | 'lights-chart' | 'pecking-order'

export interface Demo {
  label: string
  caption: string
  scenario: Scenario
  /** Rule the engine must find (encounters only) — asserted in tests. */
  expect?: { rule: RuleId; you: 'stand-on' | 'give-way' }
  /** 'hold' plays both vessels straight on with nobody altering course. */
  play?: 'best' | 'hold'
  /** Draw the line of sight and its compass bearing in the overhead view. */
  showBearing?: boolean
}

export interface Lesson {
  id: string
  group: string
  title: string
  /** Quick-reference rows: who stands on, who gives way. */
  quick?: { standOn: string; giveWay: string }
  quickNote?: string
  cite: string
  body: string[]
  remember?: string
  demos: Demo[]
  panel?: PanelId
  /** Quiz topics that drill this lesson. */
  topics?: Topic[]
}

// Lessons use wind from the north so "upwind" is always the top of the chart.
const WIND = 0
const v = (status: Status, model: Model, heading: number, speed: number, extra: Partial<Vessel> = {}): Vessel => ({
  status,
  model,
  heading: norm360(heading),
  speed,
  pos: { x: 0, y: 0 },
  ...extra,
})
/** A sailboat with the given wind angle: positive = starboard tack. */
const sailing = (twa: number, speed = 3) => v('sail', 'sloop', WIND - twa, speed)
const motoring = (heading: number, speed = 3) => v('power', 'sloop', heading, speed)
const motorboat = (heading: number, speed = 6) => v('power', 'motorboat', heading, speed)

let n = 0
const enc = (you: Vessel, other: Vessel, T = 24, miss = 0, extra: Partial<Encounter> = {}): Encounter => ({
  id: `lesson-${++n}`,
  kind: 'encounter',
  wind: WIND,
  ...meet(you, other, T, miss),
  ...extra,
})

const markDemo = (kind: MarkKind, direction: 'returning' | 'leaving', lateral: number, underSail = false): MarkScenario => {
  const you = underSail ? sailing(-90) : motoring(20)
  const pos = add(scale(dirVec(you.heading), 85), scale(dirVec(you.heading + 90), lateral))
  return {
    id: `lesson-${++n}`,
    kind: 'mark',
    wind: WIND,
    you,
    mark: { kind, pos, label: '2' },
    direction,
    scenery: { shoreBearing: norm360(direction === 'returning' ? you.heading : you.heading + 180) },
  }
}

const channelMarks = (up: number): Mark[] => {
  const marks: Mark[] = []
  for (let along = -360; along <= 480; along += 210) {
    for (const hand of ['port-hand', 'starboard-hand'] as const) {
      marks.push({ kind: hand, pos: add(scale(dirVec(up), along), scale(dirVec(up + 90), hand === 'port-hand' ? -55 : 55)) })
    }
  }
  return marks
}

export const LESSONS: Lesson[] = [
  {
    id: 'risk',
    group: 'Before the rules apply',
    title: 'Is there a risk of collision?',
    quickNote: 'Constant bearing, decreasing range = collision course',
    cite: 'Rules 5 and 7',
    body: [
      'Every rule that follows begins “when there is risk of collision”. So the first job, always, is to keep a proper lookout and decide whether the risk exists.',
      'The test is simple: watch the other vessel against something fixed on your own boat — a stanchion, a shroud. If she stays lined up with it while getting closer, her compass bearing is not changing and you will meet. If she steadily slides forward or aft along your rail, she will pass ahead or astern.',
      'If you are not sure, assume the risk exists. Rule 7 says so in as many words.',
    ],
    remember: 'Constant bearing + decreasing range = collision.',
    demos: [
      {
        label: 'Steady bearing',
        caption: 'The motorboat stays at the same angle off your bow as she gets closer. You are on a collision course, and — both under power, she is on your starboard side — you give way.',
        scenario: enc(motoring(0), motorboat(270, 5), 26),
        expect: { rule: 'crossing', you: 'give-way' },
        showBearing: true,
      },
      {
        label: 'Bearing drawing ahead',
        caption: 'Same boats, but watch the bearing: she moves steadily toward your bow. She will cross well ahead. No risk of collision, so nobody has to do anything.',
        scenario: enc(motoring(0), motorboat(270, 5), 26, 75),
        play: 'hold',
        showBearing: true,
      },
    ],
  },
  {
    id: 'duties',
    group: 'Before the rules apply',
    title: 'Give-way and stand-on',
    quickNote: 'Give way: early and obvious. Stand on: hold course and speed',
    cite: 'Rules 2, 8, 16 and 17',
    body: [
      'The rules never use the words “right of way”. In each meeting one vessel is the give-way vessel and the other is the stand-on vessel, and both have a job.',
      'Give-way vessel (Rule 16): take early and substantial action to keep well clear. A big, obvious change of course is better than a series of small ones, because the other skipper has to be able to see what you are doing. Pass astern of her; avoid crossing ahead.',
      'Stand-on vessel (Rule 17): hold your course and speed, so that you are predictable. If it becomes clear the other vessel is not keeping clear you may act, and when a collision can no longer be avoided by her action alone you must.',
      'Rule 2 sits above all of it: nothing in the rules excuses you from doing whatever it takes to avoid a collision. Nobody has the right to hit a vessel that gets it wrong.',
    ],
    remember: 'Give way early and obviously. Stand on predictably — but never into a collision.',
    demos: [
      {
        label: 'You give way',
        caption: 'One clear turn to starboard, held until you are past her stern, then back on course.',
        scenario: enc(motoring(0), motorboat(250, 5), 26),
        expect: { rule: 'crossing', you: 'give-way' },
      },
      {
        label: 'You stand on',
        caption: 'You hold course and speed. She turns behind you. Keep watching until she is past.',
        scenario: enc(motoring(0), motorboat(110, 5), 26),
        expect: { rule: 'crossing', you: 'stand-on' },
      },
    ],
  },
  {
    id: 'opposite-tacks',
    group: 'Sail meets sail',
    title: 'Opposite tacks: port gives way',
    quick: { standOn: 'Starboard tack sail', giveWay: 'Port tack sail' },
    cite: 'Rule 12(a)(i)',
    body: [
      'A sailboat’s tack is named for the side the wind is coming over. Wind on your right cheek: starboard tack. Wind on your left: port tack. The boom is always on the other side — so if your boom is out to starboard, you are on port tack.',
      'When two sailboats on opposite tacks meet, the port-tack boat keeps out of the way. It does not matter who is close-hauled, who is running, or who is faster.',
      'The usual way to keep clear is to bear away and pass astern of the starboard-tack boat (“ducking”). Tacking away works too if you do it early.',
    ],
    remember: 'Boom on the starboard side? You are on port tack — you give way.',
    topics: ['sail-opposite-tack'],
    demos: [
      {
        label: 'You are on port tack',
        caption: 'Wind over your port side, boom to starboard. You bear away and pass astern of the starboard-tack boat.',
        scenario: enc(sailing(-50), sailing(50), 24),
        expect: { rule: 'sail-opposite-tack', you: 'give-way' },
      },
      {
        label: 'You are on starboard tack',
        caption: 'Wind over your starboard side. You hold your course; the port-tack boat ducks behind you.',
        scenario: enc(sailing(50), sailing(-50), 24),
        expect: { rule: 'sail-opposite-tack', you: 'stand-on' },
      },
      {
        label: 'Port tack, running',
        caption: 'Running downwind does not change anything. You are on port tack, she is on starboard: you keep clear.',
        scenario: enc(sailing(-140), sailing(65), 24),
        expect: { rule: 'sail-opposite-tack', you: 'give-way' },
      },
    ],
  },
  {
    id: 'same-tack',
    group: 'Sail meets sail',
    title: 'Same tack: windward gives way',
    quick: { standOn: 'Leeward sail', giveWay: 'Windward sail' },
    quickNote: 'if both on the same tack',
    cite: 'Rule 12(a)(ii)',
    body: [
      'When both boats have the wind on the same side, tack can’t separate them. Instead, the boat that is to windward — closer to where the wind is coming from — keeps out of the way of the boat to leeward.',
      'The reasoning is practical. The leeward boat may be unable to point any higher, and the windward boat is blanketing her wind. The windward boat has the room and the power to maneuver.',
      'Typically this is a boat reaching or running down onto a close-hauled boat on the same tack. The windward boat either goes behind, or heads up and stays above her.',
    ],
    remember: 'Same tack: the upwind boat stays out of the way.',
    topics: ['sail-same-tack'],
    demos: [
      {
        label: 'You are the windward boat',
        caption: 'Both on starboard tack. You are upwind of her and sailing lower, so you keep clear and pass astern.',
        scenario: enc(sailing(125), sailing(55), 30),
        expect: { rule: 'sail-same-tack', you: 'give-way' },
      },
      {
        label: 'You are the leeward boat',
        caption: 'Both on starboard tack. She is upwind of you and coming down onto you: she keeps clear.',
        scenario: enc(sailing(55), sailing(125), 30),
        expect: { rule: 'sail-same-tack', you: 'stand-on' },
      },
    ],
  },
  {
    id: 'in-doubt',
    group: 'Sail meets sail',
    title: 'On port tack and not sure? Give way',
    quickNote: 'Port tack, can’t tell her tack: keep clear',
    cite: 'Rule 12(a)(iii)',
    body: [
      'If you are on port tack and you see a sailboat to windward but cannot tell which tack she is on, you keep out of her way.',
      'This happens more often than you would think: a boat running dead downwind under a spinnaker, or at night, or with the mainsail hidden behind a big headsail.',
      'It follows from the first two rules. If she turns out to be on starboard, you were give-way as the port-tack boat. If she turns out to be on port, she is the windward boat and... she should keep clear — but you can’t know that, so you act.',
    ],
    remember: 'Port tack + doubt = you keep clear.',
    demos: [
      {
        label: 'Boat running down from windward',
        caption: 'You are on port tack. She is square to the wind and you can’t make out which side her boom is on. Assume she is on starboard and keep clear — here, by tacking away early.',
        scenario: enc(sailing(-50), sailing(176), 24),
        expect: { rule: 'sail-opposite-tack', you: 'give-way' },
      },
    ],
  },
  {
    id: 'overtaking',
    group: 'Any two vessels',
    title: 'Overtaking: the overtaker keeps clear',
    quick: { standOn: 'Overtaken', giveWay: 'Overtaking' },
    cite: 'Rule 13',
    body: [
      'Any vessel overtaking another keeps out of her way. This rule beats every rule about types of vessel: a sailboat overtaking a motorboat must keep clear of it.',
      'You are overtaking if you are coming up from more than 22.5° abaft her beam — the sector covered by her sternlight. If you are not sure, assume you are.',
      'Once you are the overtaking vessel you stay the overtaking vessel until you are finally past and clear. Drawing level does not turn it into a crossing situation.',
      'You may pass on either side. Give her plenty of room, and remember that passing close to windward of a sailboat takes her wind.',
    ],
    remember: 'Coming up from behind? It is on you, whatever you are sailing.',
    topics: ['overtaking'],
    demos: [
      {
        label: 'You overtake a motorboat, under sail',
        caption: 'You are sailing, she is motoring slowly — and you still give way, because you are overtaking.',
        scenario: enc(sailing(100, 3.6), v('power', 'sloop', 248, 1.8), 40),
        expect: { rule: 'overtaking', you: 'give-way' },
      },
      {
        label: 'A motorboat overtakes you',
        caption: 'She is coming up inside your stern sector. Hold your course and speed and let her go round.',
        scenario: enc(sailing(100, 2.6), motorboat(272, 6), 40),
        expect: { rule: 'overtaking', you: 'stand-on' },
      },
      {
        label: 'A faster sailboat overtakes you',
        caption: 'Same tack, and she is the leeward boat — but overtaking comes first, so she keeps clear of you.',
        scenario: enc(sailing(70, 2.1), sailing(52, 3.7), 44),
        expect: { rule: 'overtaking', you: 'stand-on' },
      },
    ],
  },
  {
    id: 'head-on',
    group: 'Power meets power',
    title: 'Head-on: both turn to starboard',
    quick: { standOn: '—', giveWay: 'Both: turn to starboard' },
    quickNote: 'pass “port to port”',
    cite: 'Rule 14',
    body: [
      'This rule and the next apply when both vessels are power-driven — including you, any time your engine is driving the boat.',
      'When two power-driven vessels meet head-on, or nearly so, there is no stand-on vessel. Each turns to starboard so they pass port side to port side, like cars on a road in most of the world.',
      'At night, head-on looks like both sidelights (red and green) at once with the white masthead light above. If you are not sure whether it is head-on, treat it as head-on.',
    ],
    remember: 'Head-on under power: each turns right, pass port to port.',
    topics: ['head-on'],
    demos: [
      {
        label: 'Motorboat dead ahead',
        caption: 'You are motoring. Both of you turn to starboard and pass port to port. One short blast each.',
        scenario: enc(motoring(0), motorboat(181, 5), 20, 2),
        expect: { rule: 'head-on', you: 'give-way' },
      },
    ],
  },
  {
    id: 'crossing',
    group: 'Power meets power',
    title: 'Crossing: give way to starboard',
    quick: { standOn: 'Vessel on the other’s starboard side', giveWay: 'Vessel with the other to starboard' },
    cite: 'Rule 15',
    body: [
      'When two power-driven vessels are crossing, the one that has the other on her own starboard side keeps out of the way.',
      'Your “danger zone” runs from dead ahead to 22.5° abaft your starboard beam — exactly the arc of your green sidelight. A power-driven vessel in that zone on a collision course is one you give way to.',
      'The rule also says how: avoid crossing ahead of her. In practice, turn to starboard and go round her stern, or slow down and let her pass.',
      'The night-time memory aid is built in. A vessel crossing from your starboard side shows you her red port light: red, stop. One crossing from your port side shows green: go — carefully.',
    ],
    remember: 'If she is on your right, she is in the right.',
    topics: ['crossing'],
    demos: [
      {
        label: 'She is on your starboard side',
        caption: 'You are motoring and she is in your danger zone. Turn to starboard and pass astern of her.',
        scenario: enc(motoring(0), motorboat(265, 5), 24),
        expect: { rule: 'crossing', you: 'give-way' },
      },
      {
        label: 'She is on your port side',
        caption: 'You are on her starboard side, so she gives way. Hold your course and speed.',
        scenario: enc(motoring(0), motorboat(95, 5), 24),
        expect: { rule: 'crossing', you: 'stand-on' },
      },
    ],
  },
  {
    id: 'sail-power',
    group: 'Different kinds of vessel',
    title: 'Power gives way to sail',
    quick: { standOn: 'Sail only', giveWay: 'Power driven' },
    cite: 'Rule 18(a), Rule 3',
    body: [
      'A power-driven vessel keeps out of the way of a sailing vessel.',
      'But you are only a “sailing vessel” while sail alone is moving you. The moment the engine is in gear you are a power-driven vessel, even with every sail up. (By day a motor-sailing boat is supposed to hang a black cone, point down, to say so.)',
      'Three things override it: if you are the one overtaking, you keep clear; in a narrow channel you must not impede a vessel that can only use the channel; and vessels fishing, restricted, or not under command rank above you.',
      'Common sense applies as well. A ship in open water is technically “power-driven”, but she may take a mile to turn. Don’t stand on into the path of something that cannot avoid you.',
    ],
    remember: 'Engine on = you are a motorboat.',
    topics: ['sail-vs-power'],
    demos: [
      {
        label: 'You are sailing',
        caption: 'She is a motorboat on your starboard side. That would matter between two motorboats — but you are under sail, so she keeps clear.',
        scenario: enc(sailing(-90), motorboat(0, 5.5), 24),
        expect: { rule: 'sail-vs-power', you: 'stand-on' },
      },
      {
        label: 'You are motoring',
        caption: 'Sails down, engine on: you are power-driven. The sailboat is on your port side, but she is sailing, so you keep clear.',
        scenario: enc(motoring(0), sailing(-95), 24),
        expect: { rule: 'sail-vs-power', you: 'give-way' },
      },
    ],
  },
  {
    id: 'pecking-order',
    group: 'Different kinds of vessel',
    title: 'The pecking order',
    quick: { standOn: 'Restricted', giveWay: 'Maneuverable' },
    cite: 'Rule 18',
    body: [
      'Power gives way to sail because a motorboat is the more maneuverable of the two. The same idea continues up the scale: the vessel that can get out of the way more easily does.',
      'A vessel engaged in fishing means one hampered by nets, lines or trawls — not a sport fisherman trolling a lure. By day she shows two black cones, points together.',
      'A vessel restricted in her ability to maneuver is tied to her work: dredging, laying cable, towing something unwieldy. By day: ball, diamond, ball in a vertical line.',
      'A vessel not under command cannot maneuver at all — engine or steering failure, for example. By day: two black balls.',
      'Under sail you give way to all three.',
    ],
    remember: 'New Reels Catch Fish So Purchase Some: Not under command, Restricted, Constrained by draft, Fishing, Sail, Power, Seaplane.',
    panel: 'pecking-order',
    topics: ['hierarchy'],
    demos: [
      {
        label: 'Trawler fishing',
        caption: 'You are sailing, but she is trawling and can’t alter easily. You keep clear, and pass well astern of her gear.',
        scenario: enc(sailing(-80), v('fishing', 'trawler', 350, 1.8), 28),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
      {
        label: 'Dredger at work',
        caption: 'Ball-diamond-ball: restricted in her ability to maneuver. Everyone below her in the order keeps clear.',
        scenario: enc(motoring(20), v('ram', 'dredger', 290, 0.5), 38, -5),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
      {
        label: 'Ship not under command',
        caption: 'Two black balls: she can’t steer or can’t stop. Give her a very wide berth.',
        scenario: enc(sailing(-60), v('nuc', 'ship', 250, 0.6), 40),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
    ],
  },
  {
    id: 'narrow-channel',
    group: 'Different kinds of vessel',
    title: 'Narrow channels',
    quickNote: 'Keep right; never impede a ship in the channel',
    cite: 'Rule 9',
    body: [
      'In a narrow channel, keep as near to the outer edge on your starboard side as is safe.',
      'A sailing vessel, and any vessel under 20 m, shall not impede a vessel that can safely navigate only within the channel. In a channel, a ship is not “just a motorboat” that owes you room — she has nowhere else to go, and you do.',
      'Don’t cross a channel if doing so gets in the way of a vessel using it, and don’t anchor in one.',
      'If a ship sounds five short blasts at you, she is telling you she doubts you are doing enough to keep clear.',
    ],
    remember: 'In the channel, small boats and sailboats stay out of the big ship’s way.',
    topics: ['narrow-channel'],
    demos: [
      {
        label: 'Crossing ahead of a ship',
        caption: 'You are sailing across the channel. The ship can’t leave it. Turn and pass astern of her.',
        scenario: enc(sailing(-110), v('power', 'ship', 15, 5, { confined: true }), 40, 0, {
          scenery: { marks: channelMarks(15), shoreBearing: 15 },
        }),
        expect: { rule: 'narrow-channel', you: 'give-way' },
      },
    ],
  },
  {
    id: 'lateral-marks',
    group: 'Channel markers',
    title: 'Lateral marks: the sides of the channel',
    quickNote: 'Red and green marks: which side to leave them',
    cite: 'IALA buoyage, Regions A and B',
    body: [
      'Red and green lateral marks show the edges of a channel. They are laid out for a vessel coming in from sea (or heading upstream). Going the other way, everything swaps sides.',
      'The world is split into two regions that use opposite colors. Region B (the Americas, Japan, Korea, the Philippines): “red, right, returning” — red to starboard coming in. Region A (everywhere else): red to port coming in.',
      'Shape is the same everywhere and backs up the color when the light is poor: port-hand marks are flat-topped cans, starboard-hand marks are pointed cones (called nuns in the US).',
      'Red marks carry even numbers and green marks odd numbers, counting up from seaward.',
    ],
    panel: 'marks-chart',
    topics: ['lateral-marks'],
    demos: [
      {
        label: 'Returning, port-hand mark ahead',
        caption: 'Coming in from sea with a port-hand mark dead ahead: turn to starboard and leave it on your port side.',
        scenario: markDemo('port-hand', 'returning', 0),
      },
      {
        label: 'Returning, starboard-hand mark ahead',
        caption: 'A starboard-hand mark, close on your bow: turn to port and leave it to starboard.',
        scenario: markDemo('starboard-hand', 'returning', -3),
      },
      {
        label: 'Heading out to sea',
        caption: 'Outbound, the same port-hand mark now belongs on your starboard side. It already is — hold your course.',
        scenario: markDemo('port-hand', 'leaving', 20, true),
      },
    ],
  },
  {
    id: 'preferred-marks',
    group: 'Channel markers',
    title: 'Preferred-channel marks: where the channel splits',
    quickNote: 'Red-and-green banded marks: follow the main color',
    cite: 'IALA buoyage, Regions A and B',
    body: [
      'Where a channel divides, a mark banded in both red and green stands at the junction. You can pass either side of it, but one side is the preferred (main) channel.',
      'Read the main color — the top band — and treat the mark as an ordinary lateral mark of that color. A mostly red mark is treated as red; a mostly green mark as green.',
      'So in Region B, coming in from sea, a red mark with a green band is left to starboard like any red mark: the preferred channel is to its left. In Region A that same-looking mark is left to port.',
      'The shape still agrees: a banded can behaves as a port-hand mark, a banded cone as a starboard-hand mark.',
    ],
    panel: 'marks-chart',
    topics: ['preferred-marks'],
    demos: [
      {
        label: 'Preferred channel to starboard',
        caption: 'A banded can: treat it as a port-hand mark. Coming in, leave it to port — the main channel is to its right.',
        scenario: markDemo('pref-starboard', 'returning', 2),
      },
      {
        label: 'Preferred channel to port',
        caption: 'A banded cone: treat it as a starboard-hand mark. Coming in, leave it to starboard — the main channel is to its left.',
        scenario: markDemo('pref-port', 'returning', -2),
      },
    ],
  },
  {
    id: 'lights',
    group: 'Lights and sound',
    title: 'Reading navigation lights',
    quickNote: 'Red = port, green = starboard, white = stern',
    cite: 'Rules 21–27',
    body: [
      'At night you can’t see which way a vessel is pointing, so her lights tell you. Each one shines over a fixed arc: red sidelight from dead ahead round to 22.5° abaft the port beam, green the same to starboard, and a white sternlight covering the 135° behind.',
      'That is why the overtaking sector is “more than 22.5° abaft the beam”: it is exactly where you see her sternlight and neither sidelight.',
      'A sailboat under sail shows only those three. A power-driven vessel adds a white masthead light shining forward over the same arc as both sidelights — so a white light above a colored one means engine. A ship over 50 m carries two, the aft one higher.',
      'Special vessels show all-round lights in a vertical line. Trawling: green over white. Restricted in ability to maneuver: red, white, red. Not under command: red over red.',
    ],
    remember: 'Red over red, the captain is dead. Red-white-red, restricted ahead. Green over white, trawling at night.',
    panel: 'lights-chart',
    demos: [
      {
        label: 'Red + white',
        caption: 'A red light with a white one above it, on your starboard bow: the port side of a power-driven vessel crossing from your starboard. You are motoring, so you give way. Red = stop.',
        scenario: enc(motoring(0), motorboat(265, 5), 24, 0, { night: true }),
        expect: { rule: 'crossing', you: 'give-way' },
      },
      {
        label: 'Green + white',
        caption: 'Green with white above, on your port bow: the starboard side of a power-driven vessel. You are on her starboard side, so you stand on.',
        scenario: enc(motoring(0), motorboat(95, 5), 24, 0, { night: true }),
        expect: { rule: 'crossing', you: 'stand-on' },
      },
      {
        label: 'Red, green and white',
        caption: 'Both sidelights and a masthead light: a power-driven vessel pointing straight at you. Head-on. Turn to starboard.',
        scenario: enc(motoring(0), motorboat(180, 5), 20, 1, { night: true }),
        expect: { rule: 'head-on', you: 'give-way' },
      },
      {
        label: 'Red alone',
        caption: 'A single red light and no white above it: the port side of a vessel under sail. She is on starboard tack; you are on port. You keep clear.',
        scenario: enc(sailing(-55), sailing(60), 24, 0, { night: true }),
        expect: { rule: 'sail-opposite-tack', you: 'give-way' },
      },
      {
        label: 'One white light',
        caption: 'A single white light ahead that you are catching up with: a sternlight. You are overtaking, so you keep clear.',
        scenario: enc(sailing(100, 3.6), v('power', 'sloop', 248, 1.8), 40, 0, { night: true }),
        expect: { rule: 'overtaking', you: 'give-way' },
      },
      {
        label: 'Green over white',
        caption: 'Green over white in a vertical line: a trawler with her gear down. You keep clear of her, even under sail.',
        scenario: enc(sailing(-80), v('fishing', 'trawler', 350, 1.8), 28, 0, { night: true }),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
      {
        label: 'Red, white, red',
        caption: 'Red-white-red in a vertical line: restricted in her ability to maneuver. You keep clear.',
        scenario: enc(motoring(20), v('ram', 'dredger', 290, 0.5), 38, -5, { night: true }),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
      {
        label: 'Red over red',
        caption: 'Two reds in a vertical line and no masthead light: not under command. Keep well away.',
        scenario: enc(sailing(-60), v('nuc', 'ship', 250, 0.6), 40, 0, { night: true }),
        expect: { rule: 'hierarchy', you: 'give-way' },
      },
    ],
  },
  {
    id: 'signals',
    group: 'Lights and sound',
    title: 'Sound signals',
    quickNote: 'One short = starboard, two = port, five = danger',
    cite: 'Rules 32–35',
    body: [
      'A short blast lasts about one second; a prolonged blast four to six seconds.',
      'Maneuvering signals are made by power-driven vessels in sight of one another. Under the International Rules they state what you are doing; under the US Inland Rules the same signals propose a passing and the other vessel answers with the same signal to agree.',
      'In fog or other restricted visibility every vessel makes a signal at least every two minutes. Note that a sailboat under sail makes the same signal as the other hampered vessels: one prolonged followed by two short.',
    ],
    remember: 'Five or more short blasts: “I don’t understand what you are doing — danger.”',
    panel: 'signals',
    demos: [],
  },
]

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id)
