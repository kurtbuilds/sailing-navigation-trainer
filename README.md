# Sailing Navigation Trainer

A static site for learning and practicing the rules of the road under sail: who gives way, channel markers, navigation lights and sound signals.

Live: https://kurtbuilds.github.io/sailing-navigation-trainer/

- **Learn** walks through each rule with an animated demonstration, shown both from the helm (3D) and from overhead. The quick-reference list on the left jumps straight to any rule.
- **Practice** generates random encounters and asks what you do: turn to port, stand on, or turn to starboard. It then shows the rule that decides it, plays out the answer, and keeps a running score with your last ten answers to revisit.
- A region switch covers IALA buoyage Region A (Europe and most of the world) and Region B (the Americas, Japan, Korea, the Philippines). The right-of-way rules are the same in both; the marker colors are not.

There is no server and nothing is saved except your region choice (in the browser's local storage).

## Develop

Requires Node, pnpm and [just](https://github.com/casey/just).

    just install
    just dev        # dev server
    just test       # rules engine + scenario generator tests
    just deploy     # test, build, push dist/ to the gh-pages branch

## How scenarios are generated

Practice questions are built rule-first (`src/sim/generate.ts`): pick the rule to drill, place two vessels on a collision course that falls under it, then verify the result with the rules classifier (`src/sim/rules.ts`) and the motion simulator (`src/sim/motion.ts`). A candidate is thrown away if it classifies as a different rule, sits in a doubt band between two rules (near the 22.5°-abaft-the-beam line, between head-on and crossing, a tack that isn't obvious), has no real risk of collision, or has more than one plain turn that works.

The tests check the classifier against textbook cases, symmetry properties and an independent second implementation, and check thousands of generated scenarios for each topic: correct rule, no doubt, stable under small nudges, the accepted answer keeps clear when simulated, and the rejected answers do not.

## Sources

- [USCG Navigation Rules (International and Inland)](https://www.navcen.uscg.gov/navigation-rules-amalgamated)
- [American Sailing quick guide to navigation rules](https://americansailing.com/articles/sailing-navigation-rules/)
- IALA Maritime Buoyage System

This is a study aid, not a substitute for the full rules or for instruction on the water.
