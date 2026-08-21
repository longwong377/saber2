# The whole of the outstanding work, in one list

**This is the master list.** The player, on 21 Aug:

> *"any session will know that we are working on everything we didn't do in the
> V3 list that was not reverted, the V4 list, the V5 list, and the Flagship mode
> all at once ie. melding them together and in an order that makes sense and
> getting them all done to perfection and deeply… We will make sure nothing is
> missed"*

So this file merges four sources into one ordered backlog:

| Source | Where it lives | What it is |
|---|---|---|
| **V3** | `PLAYTEST.md`, *20 Aug — first play of the post-audit build* | The first play of a build the player could actually reach. Some of it was superseded by V4; the rest is being audited item by item — see §0. |
| **V4** | `PLAYTEST.md`, *20 Aug — second play, and the flagship list* | The second play. **Closed** — every item has an outcome recorded in that file's own "What came of it" table. |
| **V5** | `PLAYTEST.md`, *21 Aug — SABER GAME NOTES AND IMPROVEMENTS V5* | The newest list. Logged verbatim, none of it started except where marked. |
| **Flagship** | `FLAGSHIP.md`, and `NEXT.md`'s headline | THE LINE. §14's three kill tests have been run; the verdicts changed what to build next. |

**Nothing is struck from this file when it is done.** It gets a ✅ and the
evidence — the file, the check suite, and the number that settles it — because
the player has twice asked for an audit of an older list, and a list that
deletes its own history cannot answer one.

---

## The order, and why it is this order

Four rules decided it, in this priority:

1. **A bug the player hit beats a feature they asked for.** They are playing
   this build; every session they spend on a defect is a session they do not
   spend telling us something new.
2. **A thing everything else stands on comes before the things that stand on
   it.** Faction correctness has to land before new hardware, or every new
   vehicle inherits the same defect and has to be revisited.
3. **Cheap and visible beats expensive and invisible**, when neither is
   blocking — a voice line lands in an hour and changes every fight.
4. **The Flagship spine is interleaved, not queued behind everything.** The
   player asked for both streams at once, twice.

---

## §0 — Answer the audit the player asked for

| # | Item | Source | State |
|---|---|---|---|
| 0.1 | **Audit the V3 list item by item** and report what is DONE / PARTIAL / MISSING / SUPERSEDED, with evidence for each. The player asked by name: *"make sure that everything on that list actually got done… and let me know if we missed anything on it"* | V5 | **in flight** |
| 0.2 | **The Force shield / bubble.** Asked for in an earlier list and never built — confirmed: `POWER_COST` has push, pull, grip, throw, sense, lightning, stasis, heal, compel, rend, unleash, and nothing that shields | V5 | **MISSING — confirmed** |

---

## §1 — Bugs the player has hit, in the build they are playing

| # | Item | Source | State |
|---|---|---|---|
| 1.1 | A dead duellist's blade hangs in the air instead of falling | V5 | ✅ `Enemy.die` drops it as a real prop, 2 in 5 still lit; `dropped.mjs` ×3 |
| 1.2 | **You fight your own side's canon hardware** — a Sith fighting Separatist walkers, a Republic player fighting clones. Applies to single NPCs as well as vehicles | V5 | ✅ measured 7 of 7 levels wrong; the enemy side is now the one you are not on. `factions.mjs` ×3 |
| 1.3 | **The Separatists ride Republic transports.** They need their own hull, functionally identical — sit or stand, see out, ramp, side doors, pilots | V5 | **in flight** |
| 1.4 | A recalled saber cannot be caught in the air even at closest approach | V5 | open — part of 3.1 |

---

## §2 — Cheap, visible, and it changes every fight

| # | Item | Source | State |
|---|---|---|---|
| 2.1 | **A line for every Force power**, 3–4 per power so it does not go stale, through the SYNTHESISED voice — the player never uses the spoken-words version | V5 | **in flight** |
| 2.2 | **The Force shield / bubble** (see 0.2). A held bubble that stops bolts, costs Force per second, visible from inside and out | V5 | open |

---

## §3 — The saber as an object you can put anywhere

| # | Item | Source | State |
|---|---|---|---|
| 3.1 | **Catch a recalled saber out of the air**; and get staggered into dropping it when you are hit with no stamina | V5 | open |
| 3.2 | **Fly the saber with the Force** — lift it, ignite or retract it remotely, and steer it around the battlefield within a radius, at a heavy Force cost | V5 | open |

---

## §4 — Faction truth, then hardware

Ordered deliberately: 4.1 first, or every giant built in 4.2 inherits the
defect and has to be revisited.

| # | Item | Source | State |
|---|---|---|---|
| 4.1 | Every archetype and vehicle carries a canon faction, and the composer never fields one against its own side (= 1.2) | V5 | ✅ see 1.2 — all 31 archetypes were already sorted; nothing asked whose side the player was on |
| 4.2 | **The giants.** SPHA (140.2 m, 12 legs), HAVw A6 Juggernaut / Clone Turbo Tank (49.4 m, 10 wheels), Octuptarra Magna Tri-Droid, AT-TE (check the one we have is right), NR-N99 Persuader snail tank. Each accurate, each moving and firing differently. Research what else we are missing. No AT-AT/AT-M6 — wrong era | V5 | open |
| 4.3 | **Drive the vehicles it makes sense to drive**, contextually | V5 | open |
| 4.4 | The Separatist transport (= 1.3) | V5 | **in flight** |

---

## §5 — The support calls

| # | Item | Source | State |
|---|---|---|---|
| 5.1 | **Rename them.** "Stratagem" is Helldivers'. Find our own word and make sure nothing in game says stratagem — every string, not just the code | V5 | open |
| 5.2 | **Many more of them**, unlockable through a run, deadly or genuinely useful, and none of them puny | V5 | open |

---

## §6 — The Flagship, interleaved

`FLAGSHIP.md` §14's kill tests have been RUN. `NEXT.md` carries the verdicts and
they change what to build; read it before starting anything here.

| # | Item | Source | State |
|---|---|---|---|
| 6.1 | §14 Step 0 — crater persistence | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.2 | §14 Step 1 — the marching front | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.3 | §14 Step 2 — the Dead Jedi test | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.4 | §14 Step 3 — the Puppet Line: 40 inert bodies on a hand-authored 60-second timeline, no AI. Isolates whether the OUTPUT reads as a battle | Flagship | open |
| 6.5 | §14 Step 4 — **L2, the merged rigid-skin rung.** The single highest-value engineering item: 42 bodies = 1,040 draw calls today, 394 with it | Flagship | open |
| 6.6 | §14 Step 5 — L3 instanced cohorts past 140 m | Flagship | open |
| 6.7 | The mode itself, after the rungs above | Flagship | open |

---

## §7 — Standing rules that outrank any item here

- **No completely indoor levels, ever** (`FLAGSHIP.md` §4). An interior may be a
  bunker you breach on an outdoor field.
- **Do not regress what the player likes**: the overhead attack; the engagement
  with your own troops; the outdoor levels.
- **Every list is logged verbatim in `PLAYTEST.md` before any work starts.**
- **A finding from someone playing the game outranks any measurement taken
  without a person at the controls** (`HANDOFF.md` §7).
