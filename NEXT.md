# START HERE — the flagship phase

Written 20 Aug at the end of the audit session, for whoever picks this up next.
Short on purpose. Everything it points at is long.

---

## Read these three, in this order

1. **`HANDOFF.md` §2** — the traps. Non-negotiable, and §2.1 will silently
   invalidate every measurement you take if you skip it.
2. **`FLAGSHIP.md`** — the design for THE LINE, settled by a five-lane
   committee. Every number in it was measured against this tree.
3. **`ROADMAP.md` PART TWO** — why progression died here twice. `FLAGSHIP.md`
   §13 answers it, but read the original.

Do not read the rest of `HANDOFF.md` cover to cover. It is a reference.

---

## Where the tree is

- Gate: **1517 passed, 0 failed**, forward and with `SABER_CHECK_ORDER=reverse`.
  Same count both ways, which is the result — 42 of the previous run's 59
  failures were order-dependent.
- Smoke 11/11 on a quiet box. Packed build boots from `file://` and can be
  deployed into; `tools/checks/packed.mjs` proves it every run.
- **The default branch now tracks the work.** It did not before: every session
  worked on its own `claude/*` branch and none ever merged, so nothing any of
  them did reached the player's GitHub Pages link. Keep it that way — if you
  branch, merge back.

---

## Do these first, in this order. Each one can kill the design.

**Step 0 — one day, before anything else.** Fight one Command area, dump the
crater log, reload, replay, fight again. Ask a person: does visit two read as
*the same ground after a battle*, or *a level with holes in it*?

**Step 1 — four hours.** Five engagements on one Geonosis behind a debug key,
with the front marching in. Then the kill test: three screenshots from the same
spot at engagements 1, 3 and 5, shuffled. **The player orders them, or the
front is not visible and you fall back to §14's ~600-line version.**

**Step 2 — one evening.** The Dead Jedi test. Set `boonMods.cutPower = 0` and
play three engagements. Did you have anything to do?

`FLAGSHIP.md` §14 has all of them in full, with what each result means.

---

## Before any of that, if the player has not played recently

`node tools/pack.mjs /tmp/borz.html`, or just send them the Pages link. Ten
minutes of them playing is worth more than this whole document — HANDOFF §7 is
not a platitude, it is the specific reason the game is this far along.

---

## Six live bugs, not flagship work

These are wrong in the shipped game today. `FLAGSHIP.md` §16 has the detail.

1. `capsules()` has no broad phase — **39% of the frame** at 213 bodies. ~15
   lines. Do this one first; it is free performance.
2. Morale is inert while the player stands in their own formation.
3. Two lines stood 30 m apart for 35 s and neither took a casualty. **A war that
   will not fight itself cannot be a war you are a raindrop in.**
4. `_cullOldestDebris` spends debris only, so the 1,100 body cap is missed.
5. An orphaned `Commander` survives `peer-left`.
6. `attune-force` measures Δ0.000; 17 of 40 boons are UNMODELLED because
   `balance.mjs` has no Force powers in it.

---

## Two decisions waiting on the player

Neither is yours to make. `HANDOFF.md` §6.0 and §6.2.

- **The first-person grip.** Third report of the same complaint, and the fix
  needs one hand on the hilt in first person — a decision about what a
  first-person grip *is*. Nothing satisfies both existing checks otherwise; it
  was swept.
- **The composite grade on dark levels.** It multiplies mustafar's near ground
  by 0.49×. Where that ceiling belongs is a look call.

---

## How the player wants to be talked to

`CLAUDE.md`, and it is short. Lead with the point. Cut the supporting detail
unless asked. One number beats five. They will tell you when they want depth —
and when they do, they want it deep.
