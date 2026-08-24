# BATTLEFRONT BORZ — session handoff

Written for whoever picks this up next, human or otherwise. It is not a status
report; it is the set of things that cost time to learn and would cost the same
again. Read the traps section before touching a tool.

Repo: `longwong377/saber2` · branch `claude/battlefront-borz-improvements-1g2xei`

> **THE DEFAULT BRANCH HAS MOVED.** PR #1 merged 303 commits into
> `claude/lightsaber-combat-game-lxw391` (merge `a092074`), so the default *is*
> this work now and a player opening the repo lands on it. The note that used to
> stand here — that everything was stranded on a side branch — is discharged.
>
> The working branch was restarted from the merged default afterwards, which is
> what a merged PR requires: do not stack new commits on the old history.

Playable two ways:

- <https://longwong377.github.io/saber2/> — Pages deploys on every push to the
  **default** branch only (see `.github/workflows/pages.yml`; a feature branch
  publishes nothing, which is worth knowing before you worry about a push).
- `node tools/pack.mjs <out.html>` — the whole game as ONE self-contained file,
  no server. See §3.

---

## 1. State

> **SESSION OF 2026-08-23 (SECOND) — WHAT LANDED, IN ONE PLACE.** Branch
> `claude/autonomous-completion-6b2kzi`, eleven commits, and the whole of
> PLAN.md §6's chain after item 4 is now built or measured.
>
> **§1's checkable order** — `src/game/FireMission.js`. High Command lays an
> artillery ellipse on ground ahead of your line, tells you what it thinks is
> standing on it, and gives you a window; one keypress (`authorise`, KeyK)
> clears it. The estimate is honest, is a SNAPSHOT, and is never revised — so
> the game does not have to cheat to put your men under your own guns and does
> not have to warn you either. Reading the mark costs 12 s inside 70 m of it, 4
> with Force sense. **The weld is the geometry, measured, three arms of the same
> order and the same ten men:** walk out at your line's pace and 10 OF 10 are
> inside the ellipse with you; sprint out alone and 0 are, but the quorum is
> DOWN for the whole reading; plant them first with §4.4's delegation verb and
> you pay neither. Delete `lineIsUp` and all three collapse into "walk over and
> look". The shells carry a source on nobody's side, so `installTeamDamage`
> cannot blunt them on your own men (**120 hp against 42**), and `killerName`
> names them: every man they kill enters the after-action report as *by your own
> fire mission*.
>
> **§4.7, all four items.** DIG IN is an order (`FORMATIONS.digin`, Quote): a
> squad turns its planted ground into a position in 22 s with its hands full,
> cut through `Terrain.crater` so the log carries it into the next engagement.
> Measured at the shipped LOW tier, twelve rays from a muzzle to a chest —
> **flat 0/12 blocked, one shell crater 2/12, a dug position 12/12**; the
> defilade is symmetric and that is the trade. FINITE COVER was already true and
> unmeasured: **54 props standing at deploy and 49 six minutes later**, off 137
> hits nobody aimed. GRAVES (`src/world/Graves.js`) keep a named man's rifle in
> the ground where he fell for the whole run, two draw calls for all of them,
> and the line's morale minds them (0.729 against 0.740 over 25 s).
> **WEATHER was the expensive error in the plan.** "Entirely unbuilt, five
> systems" is wrong: `Scenery.js` has shipped a full `Weather` all along and all
> seven grounds author a squall — what was missing is that nothing ever asked
> whether you could see through it. One number now, and at each ground's own
> peak a rifle's sight falls to **19–34 m**.
>
> **§4.6's rule facets.** Six cards that change a SENTENCE somewhere else rather
> than a coefficient, and two of them move the keystone, which is what that item
> was gated on: Skirmish Order (ground taken on a THIRD of the living, muster
> halved), Triage (a downed man counts while somebody is standing over him),
> Stand Fast, Field Engineering, Storm Sense and Salvage.
>
> **§4.5's kill answered.** The front is on the wire (`packSnapshot.fr`) and
> DRAWN — `CommandDirector.front` is the whole state of a meeting and nothing in
> the tree read it, so the mode's own sentence ("the front moves because a
> general left his line at the wrong moment") was unlearnable.
>
> **§4.3's load-bearing clause, measured.** A twelve-shell barrage on a formed
> line of ten kills 4, scatters 2 more alive, and takes the quorum down — and
> 25 s later the four survivors have re-formed. So the levers buy time rather
> than the battle.
>
> **Two things found rather than built, and both are worth more than a feature.**
> `CraterLog` was written, checked to the last bit of the heightfield, and
> **constructed by nothing** — `marchTo` had passed `world.craterLog` into
> `marchFront` for as long as the front has been dressed, so every engagement
> opened on ground that had never been fought over. And `Waves.js`'s own module
> rng — the stream that composes every wave in the game — was the one
> `tools/register.mjs` never pinned, so wave composition was the one input a
> gate could not hold still.
>
> **§4.2's four-armed acceptance has reported, and it passes.** `tools/_m6.mjs`,
> four seeds × five minutes × four arms, with the same squad posted on the same
> ground in every arm so the only difference is whether that ground is a gun: **a
> Jedi is worth 82.1 s of run with a battery on the field and 0.1 s without
> one.** The section's own kill was "if not, it is decoration". The metric is the
> run's LENGTH and not the ground taken, and that is a correction the first
> reading forced — at four minutes three of the four arms took zero ground and
> every arm lost its roster, and a metric that reads 0.000 in three cells cannot
> carry an interaction.
>
> **§4.6's rules became a wager.** The panel was a list of handicaps that paid
> nothing. The exchange rate for fixing that was already in the source:
> `conditionCost` charges a DEALT condition `worth · budget` and explicitly
> skips a RULE, which is the game's own statement that a wave under a rule is
> `worth` more fight. So `hazardPay(rules) = 1 + Σ worth` and the Insight a wave
> pays is multiplied by exactly that — nothing typed twice, and repricing a
> condition moves the payout. **Forty waves under DELUGE+SILENCE: 56 Insight
> becomes 82, and 5 facets bought become 6.** `Communion.earn` carries the
> fraction so the purse stays whole (40 waves at 1.08 is 43, not 40) and every
> existing caller is byte-identical. AND THE CAP IS TWO. `CONDITION_MAX` was
> answering two questions: what the COMPOSER may carry (still 4, still the
> stranding measurement) and what the PANEL may sell. `RULE_MAX` is 2 — with
> seven rules and a cap of four you tick four and stop reading. "At most one
> beneficial" is deliberately not built: every `CONDITIONS` entry is a handicap,
> so the clause would be a branch no input can take.
>
> **§4.6's composition constraints, four of five, and no new field.**
> `ARCHETYPES[*].toughness` has been the material classification all along —
> flesh, plastoid, droid, armour, heavy — so ARMOUR COLUMN, ONE MATERIAL, DROID
> HOST and BEAST DRIVE are derived. *bladed* is not among them because `silence`
> already filters to `!ranged`, which IS the bladed roster. All four are
> RULE-ONLY, measured: a roster narrowing DEALT at depth strands a budget, and
> four more of them stopped the body cap binding at all. **They found a real
> bug**: `_setPiece` built its ladder from the LEVEL's pool instead of the
> wave's narrowed roster, so a boss wave under ARMOUR COLUMN fielded an acolyte
> and a master — NO GUNS has had the same hole and passed on luck, because
> `SET_PIECE`'s bodies happen to be melee.
>
> **And ARMOUR COLUMN is now the FLOOR** §4.6 asked for rather than a filter:
> `ARMOUR_SHARE` (0.40, written once) reserved in `_composeUnder` beside the head
> and the set-piece. In THREAT, not count — `HEAVY_CAP` is ten bodies, so a count
> floor is a promise the frame rate forbids. The filter had to go because it was
> fielding no vehicles at all: on four of seven theatres the plated roster is
> `b2` and `droideka`. Measured, heavy share without → with: 24→42% and 25→50% at
> wave 15, unchanged at wave 70 where the wave is already at its heavy limit.
> Repriced 0.26 → 0.16, so the `hazardPay` payout moved with it.
>
> **Still owed**, in PLAN.md §6's order: §4.6's branching route; and
> §4.3's animated instanced rung, which is NOT "gated hard on M4" and has not
> been for some time — `src/engine/Profiler.js` is the browser frame instrument,
> always on, reporting real GPU time through `EXT_disjoint_timer_query_webgl2`
> beside the JS and the 1% low. What that rung waits on is a READER: nothing in
> `tools/` starts a browser, plays for two minutes and prints the split.
>
> **AND SEVEN OF THE NINE ENTRIES IN PLAN §6's NOW LISTS WERE STALE OR WRONG**,
> which is the defect that made §4.7 claim weather was unbuilt on a tree that had
> shipped it. B0, B2, B4 and all four of B5 are built; M2's answer is quoted in
> PLAN itself four hundred lines above the question; M3's one-liner contradicted
> §2's own conclusion; M4 is the profiler. The block is rewritten with the
> evidence. The two genuinely unbuilt things left in it are M4's reader and B3's
> three-layer distance audio bed.
>
> **THE RED THAT WAS RED BEFORE THIS SESSION IS GREEN, AND IT WAS THE FIXTURE.**
> `blast-door.mjs`'s "a held blade opens a blast door in about twenty seconds"
> burned **0 of the 515 texels** on the middle door of the magazine. `rearm`
> cleared `door.warded` before each loop; `GunPit._wards` runs from the world's
> own tick and ends with `door.warded = warded && !taken`, so the flag was back
> on the first frame and every frame after it — the check had been red on a door
> that could not be cut at all. The pit owns that state and `silence()` is the
> door in it. Which is also the only shape that could be right: a fixture that
> unwarded a door by assignment would be measuring a plate the game never
> presents. With the plate live it reports what DESIGN.md claims — **tight 13.7 s,
> natural 18.8 s, wide 21.7 s, and a tidier loop is a faster breach.**
>
> **AND `cloth-cost`'s 6 ms ceiling was set below its own error bar.** Quiet it
> reads 5.32 ms; inside a full gate at load 4.7 it read 6.41 and went red.
> `_cpuclock.mjs`'s own header measures the cache-pressure residual a shared box
> leaves on a CPU reading at about 25%, and 5.32 × 1.25 = 6.65. The band is 7 ms:
> a 7.5 ms population still fails it, which is the only claim the check exists to
> defend.
>
> **AND `controls`'s boon-reader check named five source files by hand** — the
> five that happened to read a boon when it was written. It went stale the moment
> the line modes answered six of them in `Command.js` and `Enemy.js`, and called
> all six a lie. It walks `src/` now, still minus the BOONS table itself, which
> is the whole point of the word "elsewhere".
>
> **A GATE CANNOT SEE A CHECK FILE YOU EDIT WHILE IT IS RUNNING, AND THIS COST
> AN HOUR TWICE.** `determinism.mjs`'s "every suite file in `tools/checks/`
> exports a `run()`" IMPORTS every file to ask the question, and it runs early
> (alphabetically, at about suite 20). Node caches a module for the life of the
> process. So every suite file is already loaded before a full gate has fought
> its way to the letter f, and any edit after that point is invisible to that
> run — the gate goes on measuring the version it read at suite 20 and reports
> failures that no longer exist. Measured: `suppression.mjs` was fixed, passed
> `_one suppression` and `_seq determinism suppression` 6/6, and the gate that
> was running at the time still printed its old numbers to the decimal.
> **Edit check files between gates, never during one**, and when a gate's red
> disagrees with a fresh `_one`, believe the `_one`.
>
> **TWO THINGS FOUND WHILE FIXING A CHECK, NEITHER FIXED, BOTH WORTH MORE THAN
> THE CHECK.** `suppression.mjs` drives ten troopers up a Geonosis slope, and in
> every one of the eight arms measured a man ends the walk **stuck on the
> geometry** — CT-3208 sat at (-2.3, 2.2) for 210 frames with a velocity of 1-4
> m/s and did not move. He is the ENTIRE 35-40 m reading that suite reports: the
> MEDIAN distance from the anchor is 9.8 m in all eight. So `strung`, being a
> max, answers "did anyone jam on a rock" rather than "how spread is the line",
> and the rock is a real navigation defect on a shipped ground. Second: that
> fixture's note says it measures the WALK, and it does not — emptying
> `spawnQueue` leaves the emplaced gun firing, and it kills 2 of 10 within 26
> frames with no hostile body anywhere on the field.
>
> **THE BROWSER SUITES NEED ONE SYMLINK ON A BOX WITH NO `node_modules`, AND
> THAT IS THE WHOLE FIX.** `tools/three-resolver.mjs` maps `three`,
> `three/addons/*` and `rapier`; everything else falls through to Node's own
> resolution, and `vendor/` holds only `peerjs`, `rapier` and `three`. So on a
> fresh container `import('playwright-core')` is `ERR_MODULE_NOT_FOUND`, and
> `frontdoor`, `front-screen`, `lineseen`, `packed` and one check in `lighting`
> all fail for that reason and no other — **six of the thirteen reds in a full
> gate, none of them a fact about the tree.** The package IS on disk, and so are
> the Chromium binaries; the global tree simply is not on this project's
> resolution path. One line puts it there:
>
> ```bash
> mkdir -p node_modules && ln -sfn \
>   /opt/node22/lib/node_modules/playwright/node_modules/playwright-core \
>   node_modules/playwright-core
> ```
>
> `node_modules` is in `.gitignore`, so this is an environment fix and not a
> change to the project. With it, `frontdoor` is 1/1 and `lineseen` 2/2 on this
> box. **Do this first in any new container** — otherwise a sixth of the gate's
> failures are noise, and the noise is exactly where the browser-only claims
> live.
>
> **THE OLD ORDER-DEFECT NOTE, KEPT BECAUSE THE ANSWER IS WORTH MORE THAN THE
> BUG.**
> `breach.mjs`'s "the shield is the gate" passes when its suite runs FIRST in a
> process and fails when anything at all ran before it — measured three ways:
> alone 5/5 (25.0 s after the pulse opens the plate, 96.5% of frames in
> contact); `breach → blast-door` 5/5 and 9/9; `bolts → breach` and
> `blast-door → breach` both fail it identically (436 of 515 texels in 70 s, so
> the deflector comes back before the breach lands). The predecessor does not
> matter, which rules out anything blast-door does to a door. Both suites
> already pin `destruction.prepareBudgetMs`, which is the cause `blast-door`'s
> own header documents for this exact symptom, so it is something else
> `_shared.mjs` does not restore — `ground` (Scenery.js) and Engine's once-only
> ShaderChunk flags are what that file names as still shared.
>
> **AND ONE THAT WAS RED BEFORE THIS SESSION AND IS NOT ANY MORE, WITH THE
> REASON.** `balance.mjs`'s melee-opener check drove all four difficulty tiers
> with one player — the model's "competent", σ=75 — and read **67 of 96** against
> a three-quarter floor. It read exactly 67 at every commit for the last forty,
> so it had been red for far longer than its own note's "92, 90, 90, 91 —
> steady". At the skill each tier is actually FOR it reads 81 of 96. The floor,
> the pooled mean and the per-tier `worst > 0` clause are untouched, and
> **grandmaster still clears only 9 of 24** — printed rather than asserted,
> because it is a real balance signal for whoever tunes the Colosseum next.

| | |
|---|---|
| Suite | **1517 passed, 0 failed** — 111 suites, 18.7 min of suite time, from a clean worktree on a quiet box. Earlier the same day it was 1438/59; §6.4 says what each of those was, because how they were found is the part worth keeping. There are **156** suites in `tools/checks/` as of this row, which is the drift §2.3 is about — run `ls tools/checks/*.mjs \| grep -v /_ \| wc -l` rather than believing it |
| Fast tier | **363 passed, 0 failed — 17 suites in ~80 s**, `npm run verify:fast`. The mechanical contract only: the blade, the bolt, the cut, the guard, and the tables that move them. `tools/tiers.mjs` names what it leaves out (`footwork` 52.9 s, `powers` 18.2 s, `force` 19.3 s, every browser suite, every level/wave/net/UI suite). **It going green is not the gate going green.** It exists because §2.6d is real: a gate nobody can finish is a gate whose reds nobody triages, and `.github/workflows/verify.yml` now runs this one on every push — the first thing in this repo's CI that has ever run a check |
| Smoke | **11/11 clean** on a quiet box. Its timeouts are wall-clock, so on a loaded one the last four fail and mean nothing — §2.6 |
| Packed | `node tools/pack.mjs out.html` — 79 modules, 12.8 MB, boots from `file://`, and `tools/checks/packed.mjs` proves it every run |
| Levels | **7** — `scoria, mustafar, colosseum, wood, drifts, alpine, geonosis`. The Boarding Bay and the Providence were deleted on the player's word — "I just tried the boarding bay and the providence and hated them… just remove them. your outside work is much better" |
| Modes | **9** — `waves, roguelite, duel, sandbox, training, command, theline, skirmish, campaign` |
| Campaigns | **1** — `petranaki`, two missions. `boarding` went with its two grounds; both its missions were the ship levels |
| Archetypes | **37**, and `src/game/Levels.js` must be imported to see most of them |

Those four rows are a hand copy of what `node --import ./tools/register.mjs
tools/state.mjs` prints, and they read **10** and **6** through a whole session
that deleted three levels and added two modes and two campaigns — §2.3, playing
out in the one file that tells the next reader what is here. Run the tool
rather than believing the table; it also warns when a level exists and is not
in `LEVEL_ORDER`, which is a level nobody can reach except by typing its key.

**AND IT HAD DRIFTED AGAIN BY TWO ROWS**, which is what a paragraph saying "run
the tool rather than believing the table" is for. The Modes row read **8** and
omitted THE LINE — the flagship mode, the one `FLAGSHIP.md` is entirely about —
and Archetypes read **31** against 37. Both were caught by running `state.mjs`
during a mode audit whose brief had been written off this table and therefore
said "the eight modes". A stale row here does not merely mislead a reader; it
sets the scope of the next session's work.

Run things this way and no other way:

```bash
npm run verify:fast                              # the mechanical contract — 17 suites, 363 checks, ~80 s
npm run verify                                   # the gate — ~1268 checks, ~11 min
SABER_CHECK_ORDER=reverse npm run verify         # same suites backwards — §6.4
node --import ./tools/register.mjs tools/_one.mjs <suite>
node --import ./tools/register.mjs tools/_seq.mjs <suite> <suite>   # §6.4's missing tool
node --import ./tools/register.mjs tools/trace.mjs --waves 20 --level colosseum
node --import ./tools/register.mjs tools/playthrough.mjs --minutes 20   # a run, played
node --import ./tools/register.mjs tools/_m5.mjs --seeds 6 --minutes 6  # PLAN.md's M5
node --import ./tools/register.mjs tools/combat-trace.mjs --waves 8
node tools/smoke.mjs --shots                     # real browser, real render
```

---

## 2. Traps. Read this before writing a tool.

### 2.1 Two copies of three

`npm run verify` is `node --import ./tools/register.mjs tools/verify.mjs`. The
hook maps the bare specifier `three` onto `vendor/three`, which is what the
browser loads.

Run it as plain `node tools/verify.mjs` — the obvious thing to type — and Node
resolves `three` out of `node_modules` instead. `dom-shim.mjs` registers the
hook, but it does so while it *evaluates*, and the static graph is linked before
that. **It does not crash. It reports.** Measured back to back on a clean tree:

```
with the loader     1139 passed, 0 failed
without             1137 passed, 2 failed        ← both failures fiction
```

The loudest read *"56 of 56 geometries survived the corpse"* — every corpse in
the game leaking its materials, and nothing of the kind happening. `lifecycle`
patches `BufferGeometry.prototype.dispose`; the bodies belong to the other copy.
An afternoon went into bisecting that for order-dependence that was never there.

Both harnesses now refuse to start that way. The test is **namespace identity** —
`(await import('three')) !== THREE`. `import.meta.resolve` cannot answer it: it
says vendor either way, because by the time anything can ask, the hook is in.

A static edge from a *check* to `Engine.js` has the same shape — `Engine`
rewrites three's ShaderChunks behind once-only flags, so patching the wrong copy
burns the flag silently. Import `World.js` and `Engine.js` **dynamically**,
inside a function body.

### 2.2 The container rolls the clone back

It happened **three times** in one session, once by 40 commits. Everything
survived only because it was already on `origin`.

- **Commit and push early and often.** Do not hold a large change locally.
- Recovery: `git fetch origin <branch> && git merge --ff-only origin/<branch>`.
  Never `reset --hard`; save local edits aside first, then re-apply.
- The scratchpad is *not* durable — files written there vanished mid-session.
  Anything worth keeping goes in a commit.

### 2.2b Parallel agents share ONE working tree — git verbs that take the whole tree are loaded guns

> **AND AN EXPLICIT PATH IS NOT ENOUGH WHEN TWO LANES ARE IN THE SAME FILE.**
> The rule below — name your paths — assumes the partition holds. It stops
> holding the moment two lanes both have edits in one file, because `git add
> <path>` stages **the file**, not your hunks: the first lane to commit takes
> the other's half-finished work with it, under its own message.
>
> Measured tonight: a co-op lane's changes to `World.js` and `Emplacement.js`
> were swept into two commits by peers who had named those exact paths, and
> **those commits describe a fraction of their own diff**. Nothing was lost and
> nothing was corrupted — what was lost was the record, which on this project is
> most of the value.
>
> So the partition has to be at the FILE, not at the feature. If two lanes
> genuinely need the same file, one of them takes it and the other sends a patch
> or waits; and if you commit a file you share, read `git diff --cached` before
> you write the message and say in it what is not yours.
>
> **AND THE INDEX IS SHARED EVEN WHEN THE FILES ARE NOT.** The paragraph above
> is about two lanes in one file; this is the same hazard with no shared file in
> it at all. A lane staged four files nobody else was touching —
> `main.js`, `Waves.js`, `Progress.js`, `Support.js` — read `git diff --cached`
> to confirm the hunks were its own, and then spent ninety seconds inspecting a
> fifth file before committing. In that window a peer ran its own
> `git add <its paths> && git commit`, and **the peer's commit carried all four**,
> because a commit takes the whole index and not the paths you added last.
> `git commit -- <paths>` afterwards answered *"no changes added to commit"*, and
> `git diff HEAD` for those files was empty: the work was already in somebody
> else's commit. Nothing was lost; the record was, again.
>
> The rule that follows is one line and it is cheap: **stage and commit in ONE
> command.** `git add <paths> && git commit -m … -- <paths>` leaves no window.
> Never stage and then go and look at something.


Five agents were run in parallel on this branch, each owning a disjoint set of
files. That partitioning is sound for *editing* — two agents never touched the
same file — and it is **completely undone by any git command whose unit is the
tree rather than the path.** One agent tidied up with `git stash` and took
**1 825 lines across 19 files belonging to five different agents** with it,
including a whole new terrain preset and level that had never been committed.

It was fully recoverable (`git stash list` → the WIP commit → `git checkout
<stash> -- <paths>`), and the reflog line to look for is `reset: moving to
HEAD`. Nothing was lost. But the recovery cost more than the tidying saved, and
the failure is silent: the agent that stashed saw a clean tree and carried on,
while four others kept editing files whose contents had reverted underneath
them.

The rules that follow, for any future parallel run:

- **Banned outright while peers are live:** `git stash`, `git reset --hard`,
  `git checkout -- <path>`, `git restore`, `git clean`. Every one of them
  operates on paths the caller does not own.
- **`git add` takes explicit paths. Never `-A`, never `.`, never `commit -a`.**
  The soundtrack agent's commit swept in seven files belonging to three other
  agents. Harmless that time — it is what rescued them — but it means a commit
  message describes a third of its own diff.
- **A dirty tree full of other agents' files is the correct steady state.** Tell
  agents this explicitly in their brief, or they will try to make it clean.

**IT HAPPENED AGAIN, TO AN AGENT WHOSE BRIEF BANNED IT BY NAME.** A second
parallel run, six lanes live; the run-rules lane ran `git stash` and took five
files — `src/game/Duel.js`, `tools/checks/footwork.mjs`, `forms.mjs`,
`living-force.mjs`, `terrain.mjs` — three of them belonging to a lane that was
still working. It restored them within about two minutes by reading blobs out
of the stash commit, and it reported the failure itself, in full, at the top of
its own report. That is the behaviour to want; the ban still did not hold.

Three things that run taught which the first one did not:

- **`git stash pop`, `apply` and `checkout <stash> -- <paths>` were all refused
  by the permission layer**, so the only recovery route left was
  `git show 'stash@{0}:<path>'` piped back to the file. That is worth knowing
  *before* you need it: the documented recovery in the paragraph above is not
  available, and the one that works is a read.
- **Do not drop the stash.** It is the only record of the window. Verify from
  outside instead: diff `git show 'stash@{0}:<path>'` against the live file and
  look for lines present in the stash and absent now. On this occasion that came
  to 6 comment lines in `Duel.js` and 25 in `footwork.mjs`, both prose the
  owning lane was rewriting anyway — but the owning lane is the only one that
  can confirm that, so ask it while it is still alive.
- **The silent half is the re-read, not the revert.** A file that is longer than
  the stashed copy looks safe and is not: an agent that read one of its own
  files during the window and wrote back on top of what it read has undone its
  own edit, and the line count never shows it. A number is easier to lose that
  way than a paragraph.

So the rule earns one more clause: **a brief that bans the verb is not enough.**
If a future run cannot tolerate this, give each lane its own worktree
(`isolation: "worktree"`) and merge, rather than relying on six agents to each
refrain from one convenient command.
- **Commit early, by path.** A commit is the only thing that makes an agent's
  work safe from its peers.
- **A new file and the import of it are ONE commit.** `src/world/Smoke.js` was
  created untracked while `Levels.js` — committed by a *different* agent's
  broad `git add` — imported it. Three consecutive commits (`28072ad`,
  `dd6b757`, `d3df970`) therefore cannot be loaded at all in a clean checkout:
  `ERR_MODULE_NOT_FOUND`. Nobody noticed, because every agent had the file on
  disk. It only surfaced when a bisect checked out those commits somewhere
  else. `git status` showing `??` next to a file that something already imports
  is the signal, and it is exactly what a path-scoped `git add` is prone to
  missing.

**IT HAPPENED A THIRD TIME, IN THE NARROW CASE, AND THE NARROW CASE IS STILL
NOT AN EXCEPTION.** A lane ran `git checkout HEAD -- tools/_linehold.mjs` to
drop one experimental hunk from a file it had created and committed thirty
seconds earlier. `git status` afterwards showed only an untracked peer file, so
nothing was lost and nothing could have been — the path was unambiguously its
own. It reported the breach itself, unprompted, at the top of its own report.
That is the behaviour to want and the ban still holds as written: the reason it
is a ban and not a guideline is that "I am sure this path is mine" is exactly
what the agent that took 1,825 lines also believed. The safe version of the
same intent is `git show HEAD:<path> > <path>`, which is a read and cannot
reach a path you did not name.

**AND `git commit --amend` IS A TREE-WIDE VERB TOO** — the third round found
this one, and it is the subtlest of the three because the lane did everything
right. It ran a path-scoped `git add`, checked `git diff --cached --stat`, saw
exactly its own two files, and then amended the commit to drop a trailer. **An
amend re-uses the shared index**, and a peer had staged in the window between
the two commands, so the amended commit carries nine files belonging to four
other lanes. Nothing was lost — committing a snapshot cannot revert anything —
but a commit that describes 2 of its 11 files is a commit nobody can read later.
There is no fix after the fact worth taking: six commits had already landed on
top, and rewriting that history is the worse failure. **Do not amend while peers
are live. Write the message right the first time, or add a second commit.**

The deeper lesson is that file-ownership partitioning is necessary and *not
sufficient*: the shared mutable resource is not the files, it is the index and
the working tree. Either brief every agent off the tree-wide verbs, or give each
one a worktree (`isolation: 'worktree'`) and pay the merge cost instead. The
one agent that ran in a worktree here was the only one that could not have
caused this and could not have been hurt by it.

### 2.3 The signature defect: a hand-maintained table beside its generated twin

Eight instances found so far. A HUD price list, an announcer voice map, the
sandbox roster, a level card's unit count, a garment length, a wire record, a
wave-boundary rule, and every level's pool weights. The fix is always the same:
**the hand-written thing stops being the authority.**

A close relative: a missing thing answered with a plausible default instead of
an error (`PEAK.get(tex) ?? 3`, `_one.mjs` printing "0 passed, 0 failed", a
12-slot record against a 13-slot packer). `determinism.mjs` has tripwires for
both.

### 2.4 Never restate a rule; call it

`tools/trace.mjs` reimplemented `isDraftWave` as `w % DRAFT_EVERY === 0`. The
shipped rule is `w % DRAFT_EVERY === 0 || this.isBossWave(wave)`. The trace
therefore showed no draft on waves 5/15/25/35, four judges concluded half the
boss waves pay nothing, and it was then "verified" by writing the *same wrong
arithmetic a second time* in a probe. It was reported to the user as fact,
twice. **The game was right throughout.**

An instrument that restates a rule will eventually disagree with it, and it
fails in the direction nobody checks: it *manufactures* defects.

### 2.5 Re-run clean before believing a result that flatters the hypothesis

"Retreating starves the spawn queue" came from a probe whose second condition
reused a world with eight bodies still standing in it. Fresh world per
condition, same seeded wave: the queue drains identically whether the player
moves or not. The confound was visible in the probe's own output — the
retreating run opened with eight enemies alive, which a fresh wave cannot do.

**Four of one day's apparent game defects were harnesses lying.** Two-copies-of-
three, the draft cadence, the smoke probes, and this. Budget for it.

### 2.5c A SCRIPTED PLAYER THAT IS NOT TICKED IS A STATUE, and nothing says so

`tools/_flagship.mjs` exports `dutyInput(world)`, a scripted player. **Its
entire body is `input.tick(dt)`** — that is where it reads the field, points the
move axis, presses the swing and holds station on the line. `world.update` does
NOT call it. **There is no `input.tick` call anywhere in `src/`** — grep it. The
only caller is `_flagship.mjs`'s own `drive`, one line above its step, and
`drive` and `dutyInput` are exported separately.

So a bench that writes its own loop gets an unkillable **statue standing on the
deploy mark with the guard up**, and every number it takes is a number about a
sitting nobody would play. It fails silently and it fails plausibly: the world
runs, the army fights, the waves clear, and the figures look like figures.

**Four benches in three lanes had it on the same afternoon** — `_linehold`,
`_lineform`, `_linewave`, `_linelength` — and it cost at least three published
results, including "a Push's floor is 45.7 minutes", the number a whole
work-stream was named after.

**It was reported fixed at the root and it was not.** That claim was relayed
onward and believed. The rule until somebody actually fixes it:

```js
input.tick?.(STEP);        // BEFORE the step, every frame
world.update(STEP, input);
```

If you are writing a bench, grep your own loop for `tick` before you trust a
single number out of it. If you would rather fix the class than the instance:
the contract lives in `drive` and the thing that needs it is what `dutyInput`
returns, so make them inseparable — a script that cannot be driven un-ticked.

---

### 2.5b THREE module-level streams, and until recently only two could be pinned

The most expensive version of §2.5 this repository has produced, because the
harness was not lying — it was answering a question nobody had asked it.

`enemyRng.seed(n)` (Enemy.js) and `seedWaves(n)` (Waves.js) have existed for a
long time. `World.js` held a third, `const rng = makeRng(moduleSeed(2))`, drawn
by `pickSpawn`, `spawnDebris`, the dressing and a dozen per-frame callers — and
it had **no reseeder**, so a bench could pin two of three and believe it had
pinned the world. It is `seedWorld(n)` now; `makeRng` already carried the
method, so the fix was an export and a name.

What the gap cost, on one number — survivors of a ten-man line at the end of one
engagement of the flagship mode:

- Two arms differing **only in the mode string** read **5.4 and 3.0 of ten** on
  the same director and the same change. A crossing rolls a session plan
  (`rollSession`) and Command does not; that one extra draw moves everything
  after it. A whole tuning conclusion was drawn from the gap and was wrong.
- **Four consecutive readings of ONE build by one check spanned 1.3 to 6.0**,
  on nothing but where the eleven checks above it had left the stream.

Three rules follow, and they are written into `tools/_linehold.mjs`'s header
where the next person will meet them:

- **Both arms from FRESH PROCESSES**, one invocation each, same seed list. Two
  arms inside one process are not comparable — the second starts wherever the
  first stopped.
- **Never compare across mode strings.** Compare theline against theline.
- **Pin anything else that is a roll**, e.g. `LEVELS[*].battlefield`, which
  raises a generated heightfield per seed under a level's own dressing.

**AND SOME OF THESE QUANTITIES ARE CHAOTIC, NOT MERELY NOISY**, which is the
part that survives even a perfectly pinned harness. Two arms differing only in
one bolt's damage — 10 against 5 — took the same seed from **5 survivors to 1**
and the next seed from **1 to 5**. A perturbation of a few hit points diverges a
three-wave engagement inside seconds, so a per-seed pair means nothing and only
a mean over many seeds does: five seeds carry a standard error near 1.3 on a
ten-man roster, twenty carry about 0.65. Treat any difference under about 1.5
men at five seeds as **unmeasured**, and size the sample before the lever.

### 2.6 Frames are not seconds — there is no GPU here

Everything renders through swiftshader on the CPU. Measured on an **empty**
field (801 draw calls, 1.6 M triangles at 1280×720): **one frame takes 4151 ms.**

The smoke test's probes counted rendered frames when they meant game-seconds, so
"90 frames" was six and a quarter minutes — and since `main.js` clamps `dt` to
0.1 s, it also handed the game *nine* seconds of play instead of 1.5. Wrong in
both directions at once. Use `window.__play(gameSeconds, …)`, not a frame count.

Timing checks (`prefracture`, `frame-budget`) will blow if anything else is
using the CPU. Don't run the suite next to a browser.

### 2.6b …AND TWELVE LANES ON ONE BOX IS "ANYTHING ELSE"

The line above says "don't run the suite next to a browser". The version of it
that actually bites now is worse, because it is invisible: with a dozen agent
lanes on this one container, each running its own bench, **`uptime` reported a
load average of 44 across 24 node processes.** Every millisecond any of them
measured in that window was fiction, and a full gate under it went red on
`cloth: 19 enemies' garments cost 6.43 ms` — a check that passes alone.

Two rules, and the second is the one people skip:

1. **Before you quote a millisecond, run `uptime` and `ps -eo args | grep -c
   "^node --import"`.** Put the number in the report next to the measurement.
   A timing taken at load 44 is not a slow result, it is no result.
2. **A red timing check in a shared-box gate is a LEAD, not a fact.** Reproduce
   it alone before you spend an hour on it — and reproduce it alone before you
   "fix" it by raising the budget, which is how a real regression gets papered
   over by a number somebody widened to match a contended run.

The same applies to any bench with a wall-clock term in it. Counts, hit rates
and hp are safe under load; seconds are not.

### 2.6d THE GATE NO LONGER FINISHES ON A BUSY BOX, AND FOUR SUITES ARE MOST OF IT

Three separate lanes failed to complete a full `verify.mjs` in one session —
one capped at 25 minutes having reached 14 of ~111 suites, one still on its
tenth after 95 minutes, one killed at ~50 minutes. That is not three unlucky
runs; it is the gate having grown past what a contended box can carry, and the
consequence is worse than slowness: **a gate nobody can finish is a gate whose
reds nobody triages**, so every lane falls back to running the six suites it
happens to have touched.

Wall-clock from one such run (inflated by contention — see 2.6b — but the
RANKING is stable, and the ranking is the point):

    frontdoor.mjs      1961 s   for ONE check
    extraction.mjs     1135 s
    footwork.mjs        843 s
    command.mjs         659 s
    levels-quality      567 s
    command-pvp         555 s

Two rules follow.

1. **Before adding a check that drives a whole sitting, price it.** `theline.19`
   already made this argument for itself — it caps its drive at the deploy
   card's own top *"which is what makes this affordable to run"* — and it is the
   right instinct applied to one check while the file around it grew. A drive
   that cannot state a bound on its own length does not belong in the gate; put
   it in `tools/` as a bench and cite the bench from a cheap check.
2. **Do not start a gate you are not going to read.** An orphaned `verify.mjs`
   ran for 2 h 48 m in this session against a build that was 36 commits stale by
   the time it was noticed — node caches modules at import, so a long gate
   measures the tree as it was when it STARTED. It was burning a core the live
   lanes needed and its output would have been fiction if it had ever finished.
   Check `ps -eo etime,args | grep [v]erify.mjs` before launching one, and kill
   any gate older than the last batch of commits it was meant to cover.

### 2.6c …AND YOU CAN MEASURE A MILLISECOND ON A LOADED BOX AFTER ALL

The two rules above are right and they stop one step short. "Do not quote the
number" leaves every timing check in the gate red whenever a peer lane is
working, which is most of the time, and a check that is red for a reason nobody
can act on is a check nobody reads. It also leaves the actual question
unanswered: if a wall-clock millisecond here is worthless, **what is the frame
made of?**

`performance.now()` keeps running while this process is off a core.
`process.cpuUsage()` does not. Measured on this box with eleven peer node
processes live, one fixed 200 000-iteration arithmetic loop, alternate samples:

```
wall ms  0.441  0.456  0.431  0.471  28.551  0.457  0.416  …  24.881
cpu  ms  0.441  0.453  0.428  0.467   0.559  0.454  0.416  …   0.443
```

The wall column says the work got sixty times more expensive. It did not. The
residual on the CPU column — 0.44 → 0.56 on the worst sample, about 25% — is
cache pressure from the other tenants, and that is the honest error bar left.

- **`tools/checks/_cpuclock.mjs`** is the helper: `cpuMs()`, a `window_()` that
  hands back `{cpu, wall, contention}`, and `loadPhrase()` so a check prints the
  load beside its own figure as §2.6b asks. `cloth-cost` uses it, which is why
  the `6.43 ms` failure cannot come back: at load 59.8 with the box running
  8.20× it reads 4.26 ms of CPU against a 6.0 ceiling.
- **`tools/_ledger.mjs`** is the per-subsystem frame ledger built on the same
  clock. Two `cpuUsage()` reads a frame give the frame's true cost;
  `hrtime.bigint()` splits it between subsystems as a SHARE, because
  `cpuUsage()` is 3.7 µs a call and there are ~220 per-body calls a frame. Rows
  are exclusive of their children and `residual` is printed, so the ledger
  cannot quietly stop adding up.

```bash
node --import ./tools/register.mjs tools/_ledger.mjs \
  [--seed 7] [--level geonosis] [--mode theline] [--quality high] \
  [--warm 45] [--frames 300] [--json out.json] [--prof out.cpuprofile]
node --import ./tools/register.mjs tools/_ledger.mjs --top out.cpuprofile
```

`--prof` profiles the MEASURED frames only, never the warm-up — a deploy's
first second builds colliders and bakes merged skins, and a profile containing
it names the loader. `--top` reads the result by self time. §2.7b's lesson
applies every time: a profile named `_gatherNear` and `_encodeCell` in one pass.

**What it said, geonosis · seed 7 · `theline` · `high` · 300 frames after a 45 s
warm-up, at load 45 on 4 cores — 38 hostiles against a ten-man roster, which is
what the mode actually fields:**

| subsystem | ms CPU/frame | share |
|---|---|---|
| physics | 13.81 | 47.0% |
| animation | 6.61 | 22.5% |
| enemy other | 3.52 | 12.0% |
| enemy think | 1.14 | 3.9% |
| player | 0.95 | 3.2% |
| terrain | 0.87 | 3.0% |
| residual | 0.82 | 2.8% |
| bolts | 0.56 | 1.9% |
| cloth | 0.46 | 1.6% |
| director, blades, particles, corpses, vfx | under 0.2 each | |
| **FRAME** | **29.35** | |

*frame wall 185.9 ms · frame CPU 29.4 ms · **contention ×6.33***

So the `cloth: 19 enemies' garments cost 6.43 ms` that §2.6b is about was the
box: cloth is **1.6%** of the frame in the mode the game is played in, and the
enemies on that ground wear no garments at all — the 0.46 ms is the PLAYER's
four. Three things came out of going and looking, all in
`tools/checks/frame-ledger.mjs`:

- **`physics` was the dead.** 386 rigid bodies, 383 awake, 269 ragdoll joints
  against 40 living enemies; 15 of 21 corpses had never settled and the oldest
  had been down 33.7 s. `Corpses`' settle test asked whether the FASTEST of a
  ragdoll's nineteen bones was under 5 cm/s, and a corpse lying in the sand
  reads 0.20-0.28 there for ever. It is a displacement test now, plus a cap.
  Measured A/B, one seed, same load: physics 13.05 → 8.88 ms, frame 29.11 →
  26.50.
- **`physics.staticBoxes` was swept linearly, once per body per frame.**
  `src/physics/BoxIndex.js`. A gather looks at 2.6 box records against 135.1.
- **The ground's memory published the whole texture every frame.** One union
  dirty rectangle over marks that are far apart is the whole 192² field.
  21 094 cells a publish → 263, bytes identical.

**Still open, and named because the ledger prices them:** `animation` is 6.6 ms
over ~40 bodies and the LOD split says 1.5-2.5 ms of it is spent on bodies at
lod 2 and beyond — `Cohorts.js`'s header says "what is dropped is the gait" and
only the DRAWING of it is; `updateMatrixWorld` is still 8.5% of the frame,
almost all of it `Rig.updateMatrices()` forcing a full-tree walk twice per
animator update and twice more in `_poseArms`; and `SurfaceField.update` still
re-encodes all 36 864 cells at 10 Hz after ageing them, which is now the larger
half of the terrain row.

> **SOLVED, AND THE HYPOTHESIS BELOW IS REFUTED BY MEASUREMENT — see §2.7b.**
> The roster's growth to 31 archetypes is **not** why `cloth-cost` never
> finished: the whole 31-archetype census World builds, spawns and steps in
> **5.2 seconds**, and 4 frames costs 53 ms with 4 enemies against 50 ms with
> 24. It was one call site — `Enemy._sustain` handing `sparkBurst` a colour
> where the parameter is `count`, so a frame asked for 17.8 million particles
> and took 71-134 seconds. `cloth-cost` runs in **12.7 s** now and
> `levels-quality`, which had the same cause, in **1 m 59 s**.
>
> Keep the paragraph below anyway. It is a good record of a plausible story
> built from real symptoms, and it names itself as a hypothesis — which is the
> only reason the next person went and timed it instead of optimising against
> it. **The lesson is the one §2.6 already draws about `ps`: a CPU profile of
> 34 frames cost four minutes and named the function outright, after six
> attempts across two callers had spent a session guessing.** Profile before
> theorising about a CPU-bound thing, exactly as you read the process table
> before theorising about a hang.

> **LATER, AND IT CHANGES THE CONCLUSION BELOW.** Everything in this section is
> still true about the *early* symptoms, but contention was not the whole story.
> Measured afterwards on a QUIET box, with the full run as the machine's main
> consumer: `verify.mjs` spent **over forty minutes inside `cloth-cost` alone**
> with its worker at 85-86% CPU the whole time, and was killed by a 50-minute
> timeout having never left that suite. Six attempts across two callers have now
> failed the same way. So:
>
> - It is **not** the §2.7 hang — that signature is a live worker burning NO
>   CPU. This one burns CPU continuously and makes progress.
> - It is **not** only contention — it does not finish with the box to itself.
> - **`cloth-cost` is simply too expensive to sit in the default gate.** It
>   spawns one of *every* archetype into an `ultra` World and steps 400 physics
>   frames, and the roster grew from ~20 archetypes to **31** this session
>   (seven Command units, four machines). That growth is the obvious suspect and
>   **it is a hypothesis, not a measurement** — nobody has yet timed the suite
>   against archetype count. Do that before "optimising" anything.
>
> To get a gate number meanwhile: `SABER_CHECK_ORDER=reverse` puts `cloth-cost`
> near the END of the run instead of sixteenth, so every other suite reports
> before it stalls. That is also the order-dependence check, so it is not a
> workaround with no other value.

**`cloth-cost` did not finish, and TWO diagnoses of it were wrong.** Worth
reading in full, because the wrong answers were more attractive than the right
one and one of them is still open.

The symptom: three attempts, 10-25 min each, no output, from two callers who had
not spoken to each other. `cloth-cost` builds a real World and steps 400 physics
frames.

- **Wrong diagnosis 1 (mine): CPU contention.** Six subagents were running. It
  is a CPU-bound suite. The story fit every fact I had and I wrote it into this
  file as a finding. That is the trap: *a slow suite on a loaded box explains any
  hang you meet, and it will always fit the evidence.*
- **Diagnosis 2 (an agent's): the deleted level.** `cloth-cost.mjs` stood its
  subjects on `loadLevel('temple')`, deleted in the roster cull. I rejected this
  because `World.loadLevel` resolves `LEVELS[key] ? key : LEVEL_ORDER[0]`
  (src/game/World.js:236) — an unknown key **silently substitutes the first
  level**, deliberately and with a comment calling it a safety net — so it
  cannot hang. **That rejection was too strong, and a second agent found the
  mechanism I had missed.** In `levels-quality`, `level('deeps')` fell back to
  the first surviving level and the suite then **cached that substitute under a
  second key**, so one dead name bought an extra simultaneous World — a ninth,
  in the suite §2.7 already names as holding the most alive at once. That is
  what took it from slow to not finishing.

  So a dangling level key does not hang a suite *directly*; it inflates the
  world count, and world count is what kills these runs. Both of us were partly
  right and neither account was complete. `roster.mjs` could not have caught it:
  `level('deeps')` is none of the five syntactic forms it scans for, exactly as
  its own note predicts.

**The cause was contention after all — and the process table is how you prove
it, not the story's plausibility.** Measured on this box while the fleet ran:

    $ ps -eo pid,etimes,args | grep -c "[c]loth-cost"
    11                       ← eleven concurrent runs of this one suite
    $ nproc
    4
    $ cat /proc/loadavg
    9.74 11.41 10.98

Eleven copies of a World-building suite on four cores, the oldest 43 minutes in.
Nothing was deadlocked; nothing could finish. Killing the runs over 15 minutes
old took it to four.

So diagnosis 1 was **right and unearned** — I asserted it from "six agents are
running, it is a slow suite", which is not evidence, and only went looking for
the process table after being wrong a second time. Had the true cause been
anything else, that reasoning would have produced the same confident sentence.
The lesson is not "contention is usually it"; the lesson is that `ps` and
`/proc/loadavg` take ten seconds and turn the guess into a measurement.

**Two of these suites are also a trap for a probe that runs its own.** If you
shell out to `_one.mjs` while agents are working, you are adding to the number
above. Check it first.

The second diagnosis also uncovered a defect worth fixing on its own account:
after the cull, four checks were measuring a level they did not name. `cloth-cost` asked for `temple`, `garments`, `lifecycle` and
`force` ask for `meadow`, and all four silently got `scoria`. A check that
believes it is testing one place while testing another is HANDOFF 2.4's problem
wearing a different coat — the fallback is right for a player with a stale save
and wrong for a test, which should be told. `cloth-cost` now names its field once
as `FIELD` and asserts the level exists. **The three `meadow` callers have not
been fixed** — `grep -rn "loadLevel('" tools/` is the list.

### 2.7 A LATE full run can hang on a suite that passes alone — **SOLVED, see the top**

> **RESOLVED.** The cause was DEAD LEVEL NAMES, not ordering and not CPU.
> `levels-quality.mjs` named **nine deleted levels** across three checks
> (`temple`, `arena`, `warship`, `intake`, `deeps`, `cut`). `World.loadLevel`
> substitutes `LEVEL_ORDER[0]` for a key it does not know — right for a player
> with a stale profile, a trap in a check — so **every dead name booted another
> full World**, cached it under the dead key, and then measured a property of a
> room that no longer exists against a copy of the Ember Shelf. Five extra
> Worlds in one check, on top of that file's real six.
>
> That is *why* the diagnosis below correctly fingered "the two suites holding
> the most Worlds alive at once": the observation was right and the cause was
> one layer further down. Adding an eighth real level is what took it from slow
> to never finishing. `cloth-cost.mjs` had the same defect independently.
>
> Fixed: `level()` throws on a dead key, the three checks enumerate over
> `LEVEL_ORDER`, and `roster.mjs` gained a **sixth form** — `level('x')` /
> `loadLevel('x')` — so the class cannot hide again. Nine of twelve checks now
> finish in ~44 s. The sixth form caught a live one on its first run, in `src`
> rather than `tools`.
>
> **Still worth doing:** `coop.mjs` is the other suite named below and has not
> been audited for the same shape.

The original observation, kept because the reasoning was sound and only the
cause was missing:

Observed twice at the end of a long session, on two different suites:
`verify.mjs` stopped making progress on `levels-quality.mjs` once and on
`coop.mjs` once, sitting there for 20+ minutes with the worker alive and
burning no CPU. **Both suites pass on their own** — `coop` 29/29,
`levels-quality` 12/12 in 74 s — and three earlier full runs the same session
completed normally (1066, 1088, 1097 passing).

So the last *completed* number is trustworthy and the hang is in the harness,
not the game.

**THE DISCRIMINATOR WAS RUN.** `SABER_CHECK_ORDER=reverse` hung on
`levels-quality.mjs` **again** — the same suite, from the opposite end of the
run, after ~55 other suites had passed through first. Two of the three
observed hangs are that suite and the third is `coop.mjs`. **It is not
ordering.**

What the two share is the thing to look at: they are the two suites that hold
the most Worlds ALIVE AT ONCE.

I first wrote here that `levels-quality.mjs` "calls `await level(...)` twelve
times against three `unload()` calls" and left it as the lead. **That was
wrong, and it is worth leaving the correction in** — it is exactly the shape
§2.4 warns about, an instrument restating a rule and manufacturing a defect
out of the difference. `level()` is a CACHE keyed on the level name: twelve
calls resolve to six distinct worlds, and the suite's last check disposes all
of them and asserts it did (`WORLDS.clear()`, line ~605).

So it does not leak. What it does is hold up to six fully-built Worlds —
terrain heightfield, Rapier world, instanced fields, texture set each —
**simultaneously**, deliberately, so it does not rebuild them per check. That
is a peak, not a leak, and the two want different fixes: a peak is capped by
evicting the cache between groups, a leak by disposing at the end, which it
already does.

So the next step is a memory READING and not a bisect, and it should
distinguish those two: log `process.memoryUsage()` per suite across a full
run. **Monotonic climb** across unrelated suites means a leak somewhere else
and these two are merely where it tips over. **A spike confined to these two**
means the peak is the problem and the cache wants a cap.

Two things that are NOT the cause, ruled out rather than assumed: suite order
(above), and leftover Chromium from `fpview.mjs`/`shot.mjs` (killed before the
reverse run; it hung anyway).

### 2.7b THE GATE RUNS — CLOSED

*(The figure this section was written around was 1260 passed / 8 failed. §1 carries
the current one; this is the record of the run being fixed, not a status line.)*

*Was "verify.mjs is ALL-OR-NOTHING, and that is why nobody has a gate number".
All three of the problems it named are now measured and fixed, and one of the
three diagnoses in it was wrong in a way worth keeping.*

**`npm run verify` completes and prints a number.** Forward and reverse agree.
Run it, don't take this figure — the point of the section is that it is now
cheap to get one.

**1. verify.mjs reports as it goes.** It used to print one line per suite as it
*started* and hold every result to the summary at the bottom, so a run that
stalled on suite 42 discarded the evidence from the 41 that had passed: forty
minutes of CPU bought a list of filenames. Each suite now prints its own tally
the moment it settles — failures in full where they happen, elapsed seconds,
RSS, and a running total — so a killed run still has a number attached to it.
The stdout summary table is byte-identical; the new output is on stderr, for
the reason the `… name` line always was.

That also answers §2.7's standing peak-vs-leak question from the runner that
actually runs, rather than from `_memtrace.mjs`'s second copy of one: **RSS
climbs monotonically from 366 MB to 1.8 GB across the whole run** and is not
confined to two suites. It is a slow accumulation across eighty suites, not a
spike, and nothing on the list below is blocked by it.

**The core block is drained before the suite loop now.** It was the one block
exempt from the runner's own rule, so this file's ~700 checks ran concurrently
with all eighty suites, and `snapshotShared()` was reading the baseline while
they were still advancing `enemyRng`, `duelRng` and `wind.time`.

**2. `cloth-cost`: 40+ minutes → 12.7 seconds. THE ROSTER WAS NEVER THE
REASON**, and §2.6 said so as a hypothesis that nobody had measured. Measured:
building the `ultra` census World, spawning all **31** archetypes and stepping
it costs **5.2 seconds**. 4 frames with 4 enemies is 53 ms and with 24 enemies
is 50 ms — flat, inside the noise. Archetype count is not on the curve at all.

The cost was one call site, and a CPU profile named it in one pass where six
attempts across two callers had guessed at it for a session. **96% of a 439 s
run is `Enemy._sustain → sparkBurst → ParticlePool.spawn → SRGBToLinear`.**
Frames 1-20 of that suite cost 10-15 ms each; from frame 30, once the first
enemy holds lightning or choke, **they cost 71 to 134 SECONDS each.**

`Enemy._sustain` calls

```js
sparkBurst(chest, 2, 0x9fd8ff)          // Enemy.js:3544
```

against a signature of `sparkBurst(pos, normal, count, opts)`. Three arguments
into four slots: `2` lands in `normal`, and **the COLOUR lands in `count`**. The
burst asks for 10 467 583 sparks — 17.8 million spawns after the recipe's own
multiplier — on 35% of frames, per casting enemy, each paying a `THREE.Color`
sRGB→linear conversion. Measured: **810 of 828 bursts over the pool's capacity,
worst 10 475 775 against 4 200 slots, a factor of 2 494.**

**This is a game defect and not a harness one.** It is a multi-second freeze on
a player's machine every time an enemy uses a held power, and `normal = 2` also
spreads every spark in the burst along a NaN direction. The call site is in
`Enemy.js`, the other lane's file, and **has not been touched**.

`Particles.sparkBurst` now bounds a burst by its own pool's capacity: a ring
buffer cannot show more than it holds, so the surplus was provably invisible
work, and removing it stops the whole gate being hostage to one call site. That
bound is **not** the fix. `cloth-cost.mjs` carries the check that stays red
until the call site is corrected, so bounding the damage can never silence it.

**3. `levels-quality`: does not finish → 12/12 in 1 m 59 s.** Same root cause —
it drives 24 000 frames of real fighting enemies and every one of them was
paying the runaway. **The ten-entry `WORLDS` cache was not the reason**, which
was the standing lead; it is a real 606 MB peak and it is not what stopped the
suite. (`cloth-cost`'s 31-body `ultra` census World *was* being held for the
whole rest of the run behind a promise nothing released — 276 MB, now given
back — but that is a peak this file contributed to others, not its own stall.)

Finishing exposed a failure nobody could have seen. The `nav` check is the last
in the file and guarded its sample with `r.n >= 10` — correct while it cast 16
bearings, unsatisfiable since the note above it took the cast to 6. It failed
with `only 6 of 6 bearings on scoria were placeable`, which is every bearing it
asked for and the healthiest possible result. §2.3 in miniature. The floor is a
share of the cast now.

**4. `smoke.mjs`'s deploy step waited 30 s of WALL CLOCK for the HUD** — about
fifteen frames here, where §2.6 measures one frame at up to 4.1 s, and the
frames just after a deploy are the most expensive in the run. It was not asking
"did the game deploy", it was asking "is this box quiet". It waits in **rendered
frames** now, on two conditions that are each a real regression when they fire:
the render loop stopping, and the HUD still hidden after 24 frames.

**What the run reports, and how to read it.** Individual re-runs on a quiet box
are how you tell a real failure from contention — `prefracture` is red in the
full run and green alone, and says so in its own message ("this box paused
identical work by 158.6×"), which is §2.6's timing-check warning doing exactly
what it says. When a suite is green alone AND red in the run, `tools/_seq.mjs`
is what reproduces it in one process; §6.4 has the live list and the ordering
trap.

**`_memtrace.mjs` is answered and did not answer it.** Its header said "WRITTEN,
NOT YET ANSWERED" and guessed both the reason it could not work — a second copy
of `verify.mjs`'s runner, §2.4 — and the right move, "instrument `verify.mjs`
itself with a `process.memoryUsage()` line per suite". That is what was done.
The file is kept, and its header now says so, because reaching for it again is
the natural mistake and the header is where that gets stopped. **For a per-suite
memory reading, run the gate and read the RSS column.**

### 2.8 Bash has a 10-minute cap

A full `verify` run takes ~12 min. Use `run_in_background: true`. Foreground
`sleep` is blocked; use an `until` loop in a background command to wait.

---

### 2.9 A suite that borrows a SINGLETON must hand back all of it

`_shared.mjs` exists for the module-scope clocks — `wind.time`, `enemyRng`,
`duelRng` — and it is not the whole hazard. The engine singletons are the other
half, and one of them cost thirty-eight checks.

`audio.mjs`'s jet-trooper clause has to drive the shared `AudioEngine`, because
`Enemy._jetFx` calls the module's `audio` and not an engine it is handed. It
swapped in a fake `AudioContext`, called `init()`, and afterwards put back `ctx`
and `ready` — two fields of the dozen that `init()` writes. It left a live
`master` beside a null `ctx`, which is a state the game itself cannot reach, and
`setVolume` guards on `this.master` and then reads `this.ctx.currentTime`. Every
later suite that constructed a Menu died on its own Volume slider: 38 checks
across `controls`, `databank`, `front-screen`, `hud-events` and `menu`, all
green when run alone.

**AND THE THIRD MEMBER OF THE CLASS IS NOT AN OBJECT AT ALL.** `Menu`'s
rebinder calls `saveBindings`, which writes the player's whole key table into
`localStorage`, and `loadBindings` re-reads it on every `new Input`. A suite
that drives a rebind through a real Menu hands every later suite a keyboard the
player never chose. Measured, `controls` then anything: the blob left behind is
pad-only, so `loadBindings().walk` comes back `["PadBack+PadL3"]` against a
default of `["KeyI", "PadBack+PadL3"]`; `spectacle` is 19/19 alone and 15/19
after `controls`, and its message reads `KeyI answers to  — one press, two
systems`, an empty list where it expected a collision. Persistent storage is
module state wearing a different coat, and `snapshotShared`/`restoreShared`
carry the whole of it now.

**The rule, and it is cheap: snapshot the whole object, not the fields you
meant to change.**

```js
const was = { ...singleton };
try { /* … */ } finally {
  for (const k of Object.keys(singleton)) if (!(k in was)) delete singleton[k];
  Object.assign(singleton, was);
}
```

Nothing there names a field, so a property added to `init()` tomorrow is carried
by the same three lines — and the same argument says name no storage KEY either.
`tools/_seq.mjs <suite-you-touched> menu` reproduces this whole class in about a
minute; `_seq.mjs controls spectacle` is the bindings one.

**Three of the four largest red counts this session were this one defect wearing
three hats**, and every one of them was green when its own suite ran alone. If a
suite reaches for a singleton, a module record or a saved blob, the question is
not "did I put back what I changed" — it is "did I put back everything I
touched, including what I did not know I was touching".

---

### 2.11 ONE rng STREAM, ONE PROCESS — a fixture owns its draws only if nothing else draws

`rng` in `Enemy.js` **is** `enemyRng` (Enemy.js:59-60). It is one stream for the
whole process, not one per World. So a fixture that does

```js
enemyRng.seed(4711);
for (…) world.spawnEnemy('acolyte', …);
```

owns its fight **only if nothing else spawns a body between those two lines**.
Anything that does — another fixture in the same file, a module-scope IIFE that
has not finished, a peer suite in the same process — shifts every draw the
fixture takes by N, where N is however many the other party used.

This is not theoretical and it is not a slow leak. `cloth-cost.mjs` spent three
sessions being diagnosed as "two Worlds alive at once" and serialised twice, and
the real chain was:

> twenty identical acolytes spawned on one frame run one brain in lockstep →
> nineteen of them force-push inside a single frame → the ring is symmetric so
> the horizontals cancel exactly and the lifts add → `applyKnockback` did
> `velocity.add(impulse)` with no bound → the player left at 190 m/s and topped
> out at **718 m** → the camera follows the player, so every garment fell
> outside the 30 m cloth cut and the suite timed an empty field.

**One draw is the whole knife-edge.** Measured by drawing N times by hand before
the fixture: N=0 floor, N=1 **612 m**, N=2 floor, N=5 **722 m**. Which is why it
looked like an ordering problem and why it came back every time the roster grew
by one archetype — this session it was the droideka's `walkPhase`, one `rng()`
call added to fix NaN legs.

Two things follow, and the second is the important one:

- **A check that seeds a shared stream must own the process at that moment.**
  If you cannot guarantee that, do not seed — measure something that does not
  depend on the draw.
- **A harness symptom that survives three "fixes" is a game defect wearing a
  harness costume.** The launch was real: any crowd that pushes together could
  do it to a player, and nothing in the game bounded it. The fix is in
  `Enemy.js`'s `addShove` — the shoves that land in one frame carry a body no
  faster than the hardest single one of them — and a single shove is
  arithmetically identical to what it replaced.

---

### 2.10 A gate run inside a `git worktree` has no `node_modules`

Two suites drive a real browser — `front-screen`'s layout check and
`packed.mjs` — and both `import 'playwright-core'`. A worktree does not get the
clone's `node_modules`, so both fail with `Cannot find package
'playwright-core'` and it reads exactly like a broken check.

```bash
git worktree add --detach /tmp/gate HEAD
ln -s /home/user/saber2/node_modules /tmp/gate/node_modules
```

Do that before judging any worktree run. It is the same shape as §2.1: an
environment difference that produces a confident wrong answer.

---

## 3. The instruments, and what each is for

| Tool | Answers | Blind to |
|---|---|---|
| `verify.mjs` | is it **correct** | whether it is tuned or fun |
| `balance.mjs` | is it **tuned** | anything a player presses |
| `trace.mjs` | what a run **contains** | combat, and anything a player presses |
| `playthrough.mjs` | what **happens, in order**, over twenty minutes | anything one scripted Vanguard does not do |
| `combat-trace.mjs` | what a fight **contains** | anything past a stationary floor |
| `smoke.mjs` | does the real page **boot and render** | mechanics |
| `pack.mjs` | does the whole game **run with no server** | anything a check already covers |
| `checks/packed.mjs` | does the packed page **boot from `file://`** | how it plays once it has |

**`playthrough.mjs` closes the one gap the other six share: none of them
plays.** A check drives twenty seconds because that is what a PROPERTY needs;
`trace.mjs` and `balance.mjs` both say outright that they never press a button.
So a curve that only bends after minute ten is invisible to every row above it,
and every finding about pacing this project has had came from a person playing.
It drives the repository's one scripted Jedi (`dutyInput`, imported rather than
written twice) over a real horizon and prints a timeline, a casualty list by
name, and every announcement with the clock on it. It also borrows `trace.mjs`'s
rule whole: **an instrument with an opinion is a check with a hand-written bar**,
so it scores nothing.

Read its `remaining`, `delivered` and `rescues` columns before reading anything
else on a quiet stretch. A wave holding open on a body the player cannot reach,
a delivery that never finished, and a run quietly over all look identical in a
body count, and those three are what tell them apart — `delivered: n` in
particular disables the stall watchdog entirely (`Waves.js` gates the whole of
it on `blocking = this.delivered`), so it is the one field that can report a
stuck run.

**`pack.mjs` is how this got play-tested at all.** Browsers refuse ES modules
from `file://`, so playing the game needed a web server and therefore nobody had
played it. Nothing actually needed one: every module is already an ES module,
three and rapier are vendored, and rapier's WASM is base64 inside its own .js.
So `node tools/pack.mjs out.html` rewrites all 76 modules to name their
dependencies by a bare key and emits each as a `data:` URL in the page's own
import map — the browser's loader then does live bindings, circular imports and
load order exactly as it does on disk. No bundler, and nothing re-implementing
ESM semantics to get subtly wrong. It re-reads every specifier out of its own
output and fails if one is not a key of the map it just built, which is not
decoration: the first version appended `String.replace`'s offset argument to two
thirds of the specifiers, and eleven megabytes of unbootable page looks exactly
like eleven megabytes of working one until a browser opens it.

Two things cannot survive the move and are handled rather than hoped over.
`import.meta.url` inside a `data:` module IS the data: URL, and `new URL(rel,
base)` refuses an opaque path as a base — `main.js` built its track list that
way at module top level, so the page died before the menu drew. And peerjs,
injected at runtime as a `<script src>`, is inlined.

**A THIRD THING COULD NOT, AND FOR FOUR DAYS NOTHING NOTICED.** index.html
carries an inline script that replaces `#boot`'s innerHTML with "Needs a web
server" when `location.protocol === 'file:'`. A packed page IS opened off disk —
that is its whole purpose — so the notice fired on every single-file build, and
it does not merely say the wrong thing: it destroys `#boot-fill` and `#boot-msg`
on the way past, `Menu.progress` reads `.style` of a null, and the boot dies
before `hideBoot()`. The packer had rewritten the WORDS of that notice, which is
why it read as handled to anyone reading pack.mjs; the trigger is a capability
test now, which is what the replacement text already claimed. Every substitution
the packer makes is asserted rather than attempted, for the same reason the
specifier self-check exists: a `String.replace` whose pattern has drifted returns
its input unchanged and says nothing.

**`tools/checks/packed.mjs` is the standing answer.** It packs the tree as it
stands and opens the result the way a player does — real Chromium, a bare
`file://` URL, waits counted in frames — and asserts no page error, the boot bar
intact, the menu up with all seven tabs, and nothing fetched off the page. It is
the only check in the tree that exercises the artifact a player is actually
handed. It needs `node_modules`; see §2.10 before running the gate in a
worktree.

**Why `trace.mjs` exists.** 1142 checks and two adversarial audits share one
shape: *the code claims X and does Y*. A finding needs a line to be wrong about,
so a source sweep finds broken promises and **cannot find absences**. The
judging pass built on `trace.mjs` found things no audit had, precisely because
the judges were forbidden from reading source.

**Both traces have no opinions on purpose.** No bars, no assertions. The moment
one scores something it becomes another check with a hand-written bar, which is
the shape this project keeps removing.

**`combat-trace.mjs` deliberately does not press powers.** A "kit user" firing
each power when affordable would produce output indistinguishable from a
measurement of whether the kit is worth using — and it would be a measurement of
the script. Powers are reported as *opportunity* (what each could reach, what it
would cost), never usage. The Force pool never leaving its maximum is the proof
nothing fired.

---

## 4. How the judging pass worked, and how to repeat it

Four judges, each given **only** a trace file, one named reference point, and
one dimension. Each was explicitly forbidden from opening `src/`. Then every
finding was verified against the shipped code before anything was acted on.

That last step is not optional — the judges were right about the *shape* of four
things and wrong about the *magnitude* of one (they said epics were 2.1% of
draft slots from a single seed; over 40 seeded runs it is 41.2%).

Scale honestly: audits have diminishing returns here. Audit 3's refuters
corrected *me* more often than they corrected the finders.

---

## 5. What the LAST session changed

*(The session after that one changed no source at all — it was a read-only
comparison against a genre wishlist, and its output is `ROADMAP.md`. So the gate
figure in §1 is this session's and is not stale.)*

Two hostile audit rounds, five read-only lanes each, then ten fix lanes. The
audits were briefed to assume the game was a shallow demo wearing a long coat of
comments and to produce numbers rather than opinions. Everything below was
measured through the shipped code.

**Things a player feels**

- **The Reek's opening attack could not be dodged at any speed** — 18.73 hp/s
  against standing, retreating, strafing and dashing, the same to two decimals.
  Escape window 0.10 s against a 2.16 m footprint, so leaving it needed 21.6 m/s
  and the fastest movement in the game is a 15.5 m/s dash lasting 0.24 s. The
  Rancor's charge window was **zero seconds**. Both dressed with a roar, a body
  wind-up and a floating orange call. Now 0% against any movement above
  standing, pinned by `tools/checks/dodgeable.mjs`, which measures the player's
  paces by driving a real `Player` rather than transcribing them.
- **An enemy casting a held power froze the game.** `sparkBurst(chest, 2,
  0x9fd8ff)` against `(pos, normal, count, opts)` — the colour landed in `count`
  and asked for 10 467 583 sparks on 35% of frames per caster. Frames 1-20 cost
  10-15 ms; from frame 30, **71 to 134 seconds each**. It is also what ran
  `cloth-cost` past forty minutes six times without it ever being seen to
  finish, which is how it was found. That suite is 4.8 s now.
- **The telegraphed shot re-aimed every frame**, so leaving the drawn red line
  did nothing: 0.02 m from the bolt after stepping 4 m aside, now 4.25 m.
- **Six archetypes, one a 1050 hp boss, were shut out by holding walk-back**
  (0.00 hp/s). The player also now obeys `limitBackpedal`, the law every enemy
  already did, which makes the sidestep a better answer than the backpedal.
- **The chamber window was never humanly reachable** — every window shorter than
  a simple auditory reaction time, with the cue firing on the frame the window
  *opened*. The cue leads by up to 220 ms now.
- **A guest's Force moved nothing.** Shove/pull/throw/grip all 0.000 m on both
  machines; only the damage number crossed. Now 11.5 m on both, with the cast
  telegraph and a source id on the wire so a guest can read, break and be
  credited.
- **Two armies were both fighting you.** Geonosis wave 3 fielded five B1s, a B2,
  a rocket droid *and two clone troopers* together; 19 of 20 waves mixed sides,
  now 0 of 20. The census the fix printed is the wider finding: **175 of 200
  waves across all ten levels** mixed Republic and Confederate bodies.
- **A meeting opened on an order that does not advance** — two idle commanders,
  124 s, lines closing 120 m to 111 m, draw on the clock. And **quitting a
  meeting won it**.

**Things underneath**

- **`VITAL[name] ?? 0.4`** — nineteen humanoid bone names over 31 bodies; 142 of
  532 capsules hit the silent default and eight bodies died of their own
  extremities at 184-276% of themselves. Priced off `bone.role` now, and
  `severance` throws rather than guessing. Underneath it `World` billed every
  grind at a flat 55% of max health, so **two completed passes killed anything
  through any bone it had**; an AT-TE toe is 25 passes now and a torso is still
  one.
- **The exposure meter overruled the art** — every outdoor level normalised to
  one key, so the darker a level was authored the harder it was lifted.
  Authored-vs-rendered correlation **0.405 → 0.929**, and the blade owns 98% of
  the clipping pixels on Kamino again.
- **Run rules** — the six conditions are chosen before Ignite: 430 legal sets
  across ten theatres, never charged, vetoed with a reason. Testing four at wave
  1 found two real defects nobody had seen, including `_upgrade` paying itself
  back. A shareable seed came with it; `bestTier` was deleted (written every run,
  read by nothing).
- **A databank** — 31 of 31 archetypes, generated off `ARCHETYPES`. The research
  was already written in the comments and invisible to the player.
- **Escalation's guard ran a synthetic pool** matching no shipped level, and
  `BODY_CREEP = 1.6` was 1.6 *bodies* against a *threat* budget — a unit error
  sending 67-108% of each wave's added budget into more bodies instead of better
  ones. 4-34% now.

**Instruments that were lying**

`terrain` measured 2 of the 10 shipped grounds; `gait-support` booted Worlds on
two deleted level names and printed scoria's numbers as "warship" and "meadow";
`arrivals: something too big for a ship walks in` **could not fail**;
`footwork` drove all five forms on the one body fast enough to fight back;
`powers` ran a world where the player's blade never touched anything; `pvp`
reported two false open seams; `balance`'s model counted legs by a name regex
the game had stopped using. All fixed, most by deriving the list from the game
instead of keeping one.

---

## 5b. What the session before that changed

- **13 of 13 levels compose distinctly**, where six were byte-identical. Pool
  repeats are weights now — `_pickType` already weighed per entry, but the pool
  was only ever a membership filter, so `acolyte acolyte acolyte` did nothing.
- **`beast` reachable** on the Colosseum/Arena/Deeps. It, `bodyguard` and
  `master` were kept out of ordinary waves by an *absence* (no `unlockAt`)
  indistinguishable from an oversight. The two that are meant to be boss-only
  now declare `setPieceOnly: true`; the Acklay never was.
- **Heavy share holds ~13%** instead of halving across a run. `heavyLimit` rides
  the budget, capped per-blade by `HEAVY_CAP` (a frame-rate number — a walker is
  66 meshes — not a taste one).
- **Attunement of the Bond** — bond had a mastery and no attunement, so a bond
  build was offered five permanent choices at every boss wave and none was
  theirs.
- **The open-state readout** — `openness()` pays 3×/2×/1.5× through held/yanked/
  downed bodies and nothing on screen said so.

---

## 6. Open

### 6.0a THE KNUCKLES WERE FACING OUT, AND IT WAS A DIFFERENT DEFECT — FIXED

*Fourth report of "the hands look wrong". §6.0 below is about FRAMING —
where on the shaft the fists sit and whether they are in shot — and it is
still open on its own terms. This one is about WRIST ROLL and it was
independent of everything §6.0 swept.*

> "the orientation is still janky af like i think the knuckles are facing out
>  on both like that's not how you would hold a saber in 1 or even 2 hands like
>  you keep missing this over and over that's not how human hands contort"

`buildHand` settles which axis a palm is without a guess — the finger roots
carry `rotation.x = 1.24`, a positive turn about X takes +Y toward +Z, so the
fingers close toward +Z and the palm faces the hand's +Z. Two hands closed on
one shaft therefore have a LAW: their palms cannot face opposite ways round it.
`tools/_palm.mjs` now takes that number and it had never been taken:

```
                                     palm·palm      before → after
    third person, two hands            −1.00           →  +0.46
    first person, two hands            −0.96           →  −0.74
```

−1.00 is the two palms pointing exactly away from each other. That is what "the
knuckles are facing out on both" means — whichever hand you look at, you are
looking at the back of it.

**The cause was a constant bias, and a bias is invisible on one hand and fatal
on two.** `handPoseOnHilt` documents `toward` as "the direction the arm arrives
from" and places the wrist one BORE offset back — but that offset is
`−(0.065·Y + 0.030·Z)`, which is not `−Y`: it leans 24.8° toward the back of the
hand. Compose it with `GRIP_TWIST`'s 35° and the wrist lands **59.8° round the
shaft** from where the caller asked. Both turns were taken about the hand's X —
the THUMB axis, which points opposite ways on a left and a right hand — so the
bias rolled one hand one way and the other the other, **119.6° apart**.

The fix is two lines: the comfort turn goes about the BLADE (a common axis) and
the bore's lean is taken off about X (where it belongs, because the bore is a
place inside the hand and genuinely mirrors). `GRIP_TWIST` absorbs the same
angle, so **the right hand's world frame does not move** — its first-person palm
reads (out −0.96, up 0.29, eye 0.01) before and after, and `viewmodel`'s forearm
ratchet reads 2487°/s before and after. Only the off hand turns, by exactly the
119.6° it was wrong by.

`FP_TUNE.roll = 60°` is now explained rather than merely swept: it is 59.8° of
bias, found empirically on ONE hand by rendering three candidates. That is why
the leading hand looked right and the off hand never did.

**What is still not clean, and it is geometry rather than a bug:** first person
with TWO hands ends at −0.74. Both fists are under a hilt held in the eyeline,
so the two wrists are 7° apart round the shaft, and the palms can only come
round together as the wrists separate — swept, `pair` 0.05→3.2 takes the wrists
7°→152° apart and the palms −0.74→+0.22, but by 3.2 the fists are level with
the hilt instead of under it and the framing checks §6.0 names go red.

That used to read "a second, independent confirmation that first person should
be ONE-handed". **It is not, and the argument was the one the player threw out**
— see §6.0. −0.74 is what a two-handed grip in your own eyeline COSTS, not an
argument for taking a hand off a hilt the player is holding with two. It is
still open on its own terms and it is still the shipped default's number.

Check: `tools/checks/viewmodel.mjs`, "arms: two hands on one hilt hold it the
SAME way round" — proven to fail on `968b575` and pass here.

### 6.0 The first-person grip is OVER-CONSTRAINED — **CLOSED, AND THE ANSWER WAS NOT THE ONE BELOW**

> **THE QUESTION WAS WRONG AND THE PLAYER SAID SO.** The section below ends
> "the way out is ONE HAND on the hilt in first person… that is a decision
> about what a first-person grip IS. Ask before doing it." It was asked, as a
> choice between a one-handed grip and a two-handed one, and the answer was:
>
> > *"Why the fuck would it be either or, both should be modeled and reflect
> > how many hands you're holding it with"*
>
> **The grip is not a property of the camera.** `Player.handsOnHilt()` is the
> one reader now — 0, 1 or 2, from `saberDown`, `driving`, `throwState`,
> `control.grip` and `gesture.kind` — the poser calls it and restates none of
> it, and the `fpHands` card row on the Interface panel is gone with its
> markup and its entry in the menu's read map.
>
> **What that costs is the number this section is named for, and it is paid
> knowingly.** At half a metre from the lens one fist leaves 32% of the shaft
> behind a glove and two leave 65% — measured, at three pitches, in
> `first-person: how many hands are on the hilt is what you SEE`. 65% is
> close to what two closed hands on a 25 cm hilt CAN leave: the two bores sit
> 65 mm apart on the shaft and a fist is 108 mm across, so 74% is the ceiling
> and the pose is 9 points under it. The clear view is one keypress away, on
> the key that means the same thing everywhere else in the game.
>
> **Two of the three constraints this section called unsatisfiable together
> are discharged rather than traded.** The near plane is no longer one of
> them: on the finished anchor (rise 0.32) the nearest arm joint is
> `shoulderL` at 115 mm against the 100 the deltoid needs, in every condition
> — idle, walking, looking up and down, one hand and two. The sweep that found
> "nothing satisfies both" was run at rise 0.26 with the grip still being
> chosen; the anchor moved afterwards and nobody re-ran it.
>
> **AND THE ONE-HANDED GRIP HAD NEVER BEEN MEASURED AT ALL.** No bench in this
> repo had ever pressed the one-hand key — every one of them reached for
> `fpHands`, which moved the ARMS and left the blade on `GRIPS.two`, a state a
> player cannot enter. The state a player CAN enter read wrist 167.6° and
> forearm 3002 °/s in first person, past both of the ratchet's bounds, and had
> been shipping that way: `FP_TUNE.roll`'s 60° was swept on the state the
> option produced. The roll is a pair now, 60° for two hands and 30° for one,
> and the four arms come out 89.4 / 79.0 / 115.1 / 102.3 degrees worst.
>
> The rest of the section is left exactly as it was. Every measurement in it is
> still true and it is the best record of how the wrong question was arrived
> at.



Third report of "the first person hand/hilt looks like jumbled garbage", and
the first one with a number against it. `tools/_fpgeom.mjs` (new) projects
every arm joint and 31 samples along the hilt into NDC in about a second,
where `fpview.mjs` costs twenty minutes:

```
arms cover                    5.8% of the frame
hilt on screen               27.7% of frame height
of that, behind the fists              91%
```

The arms are **not** the mess and have not been since the shoulders were moved
off the ribcage. The hilt is *bigger* in frame than the reference the player
supplied (`assets/reference/first-person/`). What is wrong is that nine tenths
of it is behind a glove: `GRIP_AT` puts both fists at +0.050 and −0.015 on a
shaft whose metal spans −0.092 to +0.158.

Sliding the fists down the shaft works — 91% → 40%, and the render shows the
shroud and neck rings clear of the hand for the first time. **It also fails two
checks, and both were written for earlier rounds of this same complaint:**
raise the hilt to keep the hands in frame and looking up brings `elbowL` inside
the 100 mm the deltoid needs against a 45 mm near plane (`viewmodel.mjs`); skip
the raise and the off hand leaves the bottom of the frame (`first-person.mjs`).
Swept as a pair over grip −0.020…−0.105 against rise +0…+0.070, **nothing
satisfies both.**

The way out is what the reference shows: **one hand on the hilt in first
person**, which removes the second occluder and the folded left arm together.
That is a decision about what a first-person grip IS. Ask before doing it.

### 6.1 Held for reference images

The player asked for these to wait, and the folders are `assets/reference/`:

- **Geonosis** — the Command mode (lead named troops with permadeath and
  promotion, squads, formations, mechs, jet troopers) is built on it.
- **The Coruscant Jedi Temple** — as a level, ending in the younglings. The
  references are in and they answer the BOX problem outright, which is the
  lesson worth carrying to every interior: in
  `coruscant-temple/temple 1.jpg` the sense of place is made entirely of
  DEPTH — arcade behind arcade behind arcade, columns running up out of frame,
  light raking in from windows too high to see — and not by a ceiling and four
  walls. Every interior this project has shipped read as a cube because the eye
  could find the far wall. The fix is not more detail on the walls; it is
  putting three more colonnades between the player and them.
- **The real Mustafar** — the current one is renamed *The Ember Shelf*; its
  molten sea is still a lava sea and the player wants it changed to something
  that is not Mustafar's.
- **A flagship** — to replace the deleted *Invisible Hand*.
- **Kamino's platforms** — one slab where it should be a series of tall
  connected decks. I built the colony and rolled it back on instruction; the
  work is in the reflog if it is wanted.
- **The Drowned Wood's ground** — the last surface still drawn outside the cel
  pipeline, and the reason the meadow was deleted rather than tuned. The
  references are in and they change the JOB: `drowned-wood/dagobah.jpeg` has
  **no grass in it at all.** A swamp floor is standing water, buttress roots,
  matted litter and fallen branches — the "ground cover" is ROOTS, not blades.
  So the fix is not a better grass shader, which is what the last three
  attempts were; it is a different ground-cover kind. That also explains why
  the level reads as two games stitched together: a grass field is the one
  surface a bog cannot have, so no amount of tuning it was ever going to sit
  in the frame. `makeCoverField` already takes a kind; this wants a new one.
- **The big creatures, and Mandalorians** — "all your monsters look the same,
  sphere with some legs, like you really need to make the big enemies more
  dangerous and more interesting and menacing, they all attack the same way."
  The arena references already in
  (`colosseum/more arena.jpg`, `fighting monster in arena.jpg`) are the brief
  for the first half: three creatures share one frame and no two share a
  BODY PLAN — a bulky horned quadruped, a tall spindly six-legged insectoid, a
  low pouncing cat. Not three skins on one skeleton, which is what
  `buildQuadruped` gives today. The second half — "they all attack the same
  way" — is `Enemy.js`'s move sets, and is a separate job from the meshes.

### 6.1a The player half of the Force contest — LANDED, all three steps

*Was "BUILT, MEASURED, REVERTED". It is in now, as the balance pass this section
said it had to be: `a057525` the four lines, `18c3cfe` the shove re-tuned against
a bracing player, `8b81e82` the two checks whose premise expired. `powers` ends
21/21, the number it started at.*

`Player.resistForce` CALLS `forceResistance` — one contest, one rulebook, both
contestants reading it. `damage` takes `preResisted`; `applyKnockback` mirrors
`Enemy.applyKnockback` line for line, weighing the shove and the damage once in
the same currency (`IMPULSE_AS_HP`). Measured, Knight difficulty, 50 hp authored:

    full pool   force / lightning / choke   19.1 hp   pool 100 → 80.4
    full pool   saber / blaster             42.5 hp   pool untouched
    empty pool  everything                  42.5 hp

**Step 2, and the thing that was not obvious.** The shove had been tuned UP
(17.0/6.5 → 20.4/7.8) to peak at 5.71 m, clearing the 5.4 m at which a Master's
lightning opens; braced, that peak is 3.28 m. **No sizing of the shove fixes
it.** `RESIST_CAP` is 0.55 of the whole blow, so a deep pool always scales a
shove to 0.45 of itself and the factor does not depend on the shove's size —
reaching 5.4 m through a full pool needs 2.2× the impulse, and 45/17 throws an
empty-bar player 14 m, past the far edge of the push's own [0, 7.5] band.

So the shove went to **26.0/10.0** — the same vector as both earlier pairs, all
three at 0.382 lift-to-speed — and the two-beat became a CONTEST rather than a
certainty. Driven with the Master's own brain, `push` taken off it so the peak
is one shove's:

                braced (100 F)              empty bar
    20.4/7.8    3.28 m · choke only         5.71 m · lightning, pull, choke
    26.0/10.0   3.86 m · pull, choke        6.84 m · lightning, pull, choke

Braced, you spend 16.7 Force and deny him the lightning; empty-bar you fly and
the whole kit opens. The shove now clears the pull's 3.2 m band by 0.66 m where
it cleared it by 0.08 — a coincidence, not a margin. **Shove→lightning against a
full bar is gone and is not coming back without changing `RESIST_CAP`.** That is
a design call, made deliberately, and it is the one thing here a reviewer might
want reversed.

**Step 3 re-stated exactly two checks**, both because their premise expired and
each saying so in its own comment. The empty-bar half of the held-power bound is
untouched and returns the same 95% / 100% it always did.

**The trap this uncovered, and it is the reusable part.** `Player.damage` grew a
fifth argument, and **four separate wrappers sitting in front of it named the
four they knew about**: `Waves.js boonGuard`, `Injury.js armInjury` (both
shipped, both a real double-bill on the pool), and the `p.damage` wrappers in
`powers.mjs` and `duelling.mjs`. The harness one manufactured a finding —
Sentinel 4.3 → 0.44 hp/s, which reads exactly like a body that had stopped
fighting. All four are variadic now. **`Command.js:1251` has the same defect
against `Enemy.damage` and is still open** — that file belonged to another lane.
Grep `\.damage = (` before changing that signature again.

### 6.1e THE BOND CURRENT PAYS HALF IN EVERY MODE THAT FIELDS AN ARMY — open

Measured off the shipped code, not driven: `localAllies(p)` in `Waves.js` is
`p.world.players` filtered on `q.boonMods`, and **a Command / skirmish /
campaign / Line trooper is an `Enemy` in `world.enemies`**, not a player. So the
whole bond current — Communion, Suffusion, The Vow, The Unifying Force and
Attunement of the Bond, five of the lattice's forty-six facets — falls to its
solo half in the five modes that field an army and in any mode at all once the
contingent slider leaves zero.

Each card has an honest solo fallback and none of them is dead, so this is not
`claims.mjs`'s question ("does the card move a real Player") and that suite is
right to be green. It is the other one: *is there a situation that makes this
worth taking*, and the answer is "co-op", in a game whose army modes put ten to
twenty-four named people inside `BOND.range` of you for the whole run.

What it would cost, and why it was left:

- `bondGive` writes `q._bondIn` and calls `q.heal?.()`; `bondReceive` spends it
  through `boonFactor`, which needs `boonMods`. **`Enemy` has neither** — no
  `heal`, no `boonMods` — so this is a change to `Enemy.js` and not to the
  cards.
- It would land a SECOND presence term on the line, on top of
  `MORALE.JEDI_NEAR`, which is the live Morale/Nerve lane's whole subject.
  Two mechanisms paying for "the Jedi is standing with us" is the shape
  `CommandDirector.lineIsUp` spends a page arguing against.

So: worth doing, worth doing *with* the morale lane rather than beside it, and
the measurement above is the part that would otherwise have to be taken again.

### 6.1b Diagnosed, scoped, not yet built

**`cel: a shadow is READABLE` — CLOSED, 24/24, and it was TWO failures wearing
one message.** Kept in full because the way it hid is the reusable part.

The check asserts three clauses over the same data — a span, a Spearman rank
correlation of key share against sun height, and a strict pairwise ordering
wherever two suns differ by more than 10%. It used `assert` for each, so the
first one to fail was the only one anybody ever saw. Fixing the pairwise
(geonosis 21° → 20°) revealed the correlation at rho 0.810 against a 0.90
bound; fixing the correlation revealed that the pairwise was **still red**,
between geonosis and kamino, and had been the whole time. The 21→20 fix had
been measured against ONE neighbour and the clause is over every pair.

All three clauses are now collected and raised together, and the correlation
failure NAMES the levels that are out of order instead of quoting a roster-wide
number with no subject in it. `tools/_celrank.mjs` (new) prints the table, the
rank displacements and every neighbouring bound in about a second — use it
before moving any level's light.

Two levels moved, each because its own numbers contradicted its own prose:

- **kamino** `sunIntensity` 5.4 → 3.4 and `ambient` 0.50 → 1.20. Its block said
  "almost none of it reaches the deck, which is why `ambient` carries this
  level" beside the fourth-strongest key in the game under a 0.94 cloud ceiling
  and the SMALLEST indirect term on the roster (0.083). Both knobs move because
  neither reaches alone: the ambient is nearly inert here (0.50 → 2.00 buys 2.5
  points, because `skyColor` is almost black) and the sun runs into a good
  bound before it is done — below ~2.9 a sunlit cloud top falls under its own
  sky and `sky.mjs` correctly calls the deck smoke.
- **geonosis** `elevation` 20 → 18. Turbidity 10.0 is optical depth by another
  route, and a level whose look is "weak key, strong sky" cannot also hold the
  roster's third-highest sun. 19 was measured and rejected: it ties the wood and
  `lighting.mjs` orders the indirect budget strictly.

rho 0.810 → 0.976, pairwise clean, span 1.69x, the 0.90 bound untouched. Two
stale comments beside their own numbers went with it (kamino claimed "6°, the
lowest sun in the game" at `elevation: 16`; geonosis said "21°" twice).

**CLOSED: the character creator's grip — and the framing was a THIRD defect, not
a cost of fixing the first two.** The repair written out here was applied
verbatim (scale the guard offsets and the elbow pole by `limbScale(rig).arm`,
pass `rig.scale` to `handPoseOnHilt`, size the hilt with `saber.setGripScale`)
and it is correct. Measured on `smallfolk`, in its own units, against the human's
own reading — which is the only kind of bound stature.mjs allows:

    bore (own hands)     4.86 → 0.72      human 0.72
    hilt (own hands)     5.99 → 2.39      human 2.39
    reach (own arm)      0.99 → 0.83      human 0.84

The reason it "regressed `preview` 11/11 → 10/11" is worth keeping, because the
diagnosis above was right about the mechanism and wrong about the CAUSE, and the
difference is a whole design argument that turned out not to be needed.

Two more things in the creator had never taken the species scale, and both were
inside the content box the camera frames:

- `dressPreviewFigure` passed no `scale` to `attachCloak`/`attachSkirt`, so the
  creator hung a human's 0.86 m cape on a 0.66 m body. Measured, the hem settled
  **280 mm below the floor the figure stands on**. That is the third claim of
  note #2 — "their clothes are oversized" — alive on the character screen after
  it was fixed in the game, and it is 280 mm of dead air the camera had to
  include under a 677 mm figure. `Player._makeCloak` and `applyWardrobe` have
  both passed `rig.scale` for a while; this copy never did.
- `assemblePreview` pushed the pommel in at a hilt-local `-0.16` with no grip
  scale, so it claimed 96 mm of metal that does not exist on a 0.40 hilt.

With those two the content box goes from `[-0.28, 1.39]` to `[0, 1.39]` and the
figure's middle from NDC −0.364 to −0.345 — still over the 0.32. So the design
call was still real, and it was made:

**The shot's blade allowance is a length in the WIELDER's metres, not in a
human's.** `BLADE_CAP` already refuses to frame a 4 m blade on a human, and its
own note says why in the exact words this problem needs — "the creator would
stop showing you the character in order to show you a strip light". 1.15 m on a
0.677 m body is 1.70 of its own height against that refusal's 2.37: the same
imposition, so the same rule, de-humanised by one multiply that is 1 for every
full-sized species. A small wielder's blade leaves the top of the frame the way
a 4 m one already does. Figure 39.5% → 62.6% of the frame height, middle −0.345
→ −0.187 against the human's −0.169.

The two rejected options, and why, since both were on the list above:

1. **A proportionally short blade** overrides a stated intent. `Saber.setGripScale`'s
   own note says it outright — "the BLADE is untouched; `bladeLength` is a player
   setting and a combat reach, and a smaller wielder is not carrying a shorter
   sword" — and framing is not allowed to decide a combat number (§6.2).
3. **Scaling the centring bound by content share** does not work the way `fill`
   does, and the arithmetic is the argument. Share enters `fill` as a factor
   ≤ 1; it enters the centring offset as `(1 − share)`, so the factor would be
   0.51/0.18 and the 0.32 bound would become 0.90. That is not a relaxation, it
   is an abolition — the bound would permit the figure almost anywhere in the
   box, which is the one thing "do not simply relax the 0.32" was protecting
   against.

`preview` is 12/12; the twelfth is new and is the check that could have seen any
of this — bore, hilt length and reach in the figure's own units, plus the hem,
over every species, with the human's reading as the bar. `tools/_previewgrip.mjs`
prints the whole table in about twenty seconds.

**The Colosseum crowd is ONE MESH.** "I like the colosseum map, just increase
the detail for the crowd — right now it looks okay in the distance but anytime
you're near the edge you see how crude they are, make them either alien species
or mixes of aliens."

`addCrowd` (Props.js) builds exactly one figure — an extruded wedge body, a
6×5-segment sphere head, three plates — and instances it three thousand times.
Variation today is scale, garment colour and phase only, so at the rail every
spectator is the same silhouette with the same head. The reference the player
uploaded (`assets/reference/maps/colosseum/detailed arena view.webp`) shows what
the near tier should be: individual alien profiles — domed crests swept back,
horns, antennae, hooded bulk — reading as SHAPES against the sky, while the far
tiers stay a speckled texture.

The fix is four or five head/shoulder variants distributed across as many
InstancedMeshes rather than one, which costs four extra draw calls on a level
that already spends 224 hand-placed ones. It is not a shader problem and it is
not a budget problem; it simply has not been built.

### 6.1d CLOSED: the controller — and what a future control has to do now

A pad was a stick you could wave. `Input._codeDown` resolved a binding as a
wheel pseudo-key, a `Mouse*` button or `keys.has(code)`; there was **no code
form a pad button could take**, so 0 of 46 actions could be bound to one. It is
46 of 46 now, and the parts a future round has to know:

- **`Pad*` is a code, in the same namespace as `Mouse*` and `WheelUp`.** Sixteen
  buttons on the standard mapping plus four LEFT-STICK directions. The pad
  default is a **third entry on the action's existing key list** and not a
  parallel table (§2.3), and the six orders are DEALT theirs from
  `ORDER_PAD_POOL` by `registerOrders`, so a seventh formation is bound the day
  it is authored. A seventh gets no pad code rather than a wrong one, and
  `controls.mjs` says so.
- **Chords exist.** `PadLB+PadA` is one code, joined by `+`. Bindings.js's header
  has promised "the most specific chord wins" since it was written and nothing
  implemented it; `Input._masked` does, off an index rebuilt on `setBindings`.
  **LB and View are pure modifiers and are bound to nothing of their own** — a
  modifier that also fires something drops that hold for the frame every chord
  lands on, and the obvious candidates (lateral guard, one-handed grip) are
  exactly the holds you would be in the middle of when you cast.
- **The pad has a press edge for the first time.** `getGamepads()` returns a
  fresh SNAPSHOT every call, so the old `this.padButtons = gp.buttons` had no
  previous frame to compare against and every pad read was a `down`. Two sets,
  swapped in `_readPad`.
- **Analog triggers are buttons at 0.35, with `pressed` also honoured.** `blade`
  is on RT; a browser that only latches `pressed` at the stop would be a guard
  the player cannot raise.
- **The left stick is IN the table and still analog.** `moveAxis` used to do
  `x += this.padLeft.x` — a second set of movement bindings no table knew about,
  which is the arrows bug wearing a different device, and the check written for
  the arrows could not see it because it probes key codes. It is four codes read
  through `actAxis`, which returns a MAGNITUDE: 0.4 of a stick is 0.400 of pace,
  and W plus a stick is 1.000 and not 2.
- **Start is Escape.** Pausing is deliberately not an ACTION so the way out
  survives a broken binding, which left a pad player with no way out at all.
  Start lands on the same `screens.escape()`, and only when no modifier is held
  so its chords stay bindable.
- **Glyphs follow the device.** Every surface that prints a binding takes a
  `{ device, family }` that DEFAULTS TO THE KEYBOARD — which is what keeps every
  other check and all existing markup byte-identical. Button 3 is Y, △ or X
  depending on the shell, and `padFamily()` tests Xbox FIRST because Chromium
  calls a DualShock 4 "Wireless Controller" and "Xbox Wireless Controller"
  contains that phrase word for word.
- **The front end is walked with the pad by moving DOM FOCUS**, not by a second
  set of menu handlers: every control already answers Enter and Space, and
  `menu.mjs` pins that. Reachability asks `offsetParent` rather than restating
  `.panel{display:none}`, so a browser walks the open tab and the harness — which
  has no layout — walks all of it.

**Rumble** landed in the seam `Engine.rumble` left for it (`this.rumbleLevel ?? 1`,
with a note saying "the day a strength slider exists it assigns this").
`applyFeelSettings` writes it. It is **not** a second gate on `shake` — every
call site already asks `feelOn('shake')` and `feel.mjs` pins that the pad stays
quiet with the box off — it scales what survives that.

**The rule for the next control, in one line:** if it is not in `ACTIONS` it
cannot be rebound, cannot be listed and cannot be seen to collide, and
`controls.mjs`'s raw-device clause now names the pad's fields as well as the
mouse's — which is what would have caught `SaberController`'s `padDown(4)`,
the last two raw reads in the game, if it had.

### 6.1c CLOSED: the AT-TE lift, and the bodies that died like nothing

**`force` 24/1 → 26/0 — the rule was right and its SUBJECT had expired.** "The
top of the slider clears the heaviest body" is exactly right about a roster of
animals; it is not right about one with a 3600 kg six-legged siege walker in it,
and raising the cap past 3600 would price a 210 kg droideka at nothing on the
way past. The exclusion is authored where the decision belongs
(`grippable: false` on the AT-TE and the AAT, Vehicles.js) and the check asks
the narrowed question, with three guards so the narrowing cannot become a dodge:
every excluded body must be HEAVIER than the top of the slider, the exclusion
set must be non-empty, and at least one `big` body must stay liftable. Heaviest
liftable is the Rancor at 1700 kg against a 1760 kg cap — 60 kg of margin, which
is real and tight, and the check now prints it.

`Enemy.grippable` was the second field in that method's history to be WRITTEN
AND NEVER READ: `!A.big && !A.boss`, a size wall the mass cap had overturned and
nobody deleted, so the field claimed an Acklay could never be lifted while the
game lifted one at Force Power 4. It carries the archetype's declaration now and
`Player._grippableBody` reads it. **The refusal is out loud** — dropping the
AT-TE from the pick would let the aim ray pass through thirteen metres of walker
and grip whatever stood behind it, so `_forceSeen` keeps it pickable and
`toggleGrip` names it and names the way in. Which way in is read off the RIG:
the AAT is a repulsorlift with `legs: 0` and is told to have its armour broken
instead of its legs cut.

**Unarmed bodies now have a guard, and it is derived.** `guardFor` (Enemy.js) is
the single authority — hp/90 for a duellist, MASS/300 for everything else — and
`tools/balance.mjs` imports it rather than keeping a copy. Mass and not
toughness, because toughness is already spent one layer down as the work-to-cut
term in BladeContactSolver. Nothing man-sized turns anything; the lightest body
that does is the 420 kg Nexu. Model time-to-kill: charger 0.64 → 3.83 s, beast
0.64 → 3.19, brute 1.28 → 3.83, walker 2.56 → 4.47, AT-TE 2.56 → 5.75, and b1,
trooper, sniper, heavy, jet, arc, officer and rocket all unmoved at 0.64.

**Three things about that are worth carrying forward.**

1. *The first version bought almost nothing and the harness said so.* It turned
   the pass at the neck and the model went round it to a leg — five bodies from
   420 to 2200 hp all landing on 1.28 s. The cause is one layer down again:
   `takeCut` charges `maxHp * vital * 1.15` for a severed limb, a SHARE of
   maximum health, and every non-humanoid bone falls through `VITAL[name] ??
   0.4` because that table holds nineteen HUMANOID names. **A Rancor's toe was
   worth 46% of it, exactly as much as its hip.** That fallback is §2.3's close
   relative and it is still there for anything that reads `VITAL` directly.
2. *The openings were all already built and all meant nothing.* `_guardOpen`
   reads WINDED now — the state `_beastBrain` has entered for a session, whose
   own comment already called it "the only safe time to go for a leg" and which
   had nothing to be safe from while every pass landed. Machines keep the legs
   (`legsLost >= 3` topples, and a topple opens the guard).
3. *A guard that catches a pass must never pay for one.* `World._applyBladeEvent`
   already returned early on `'turned'`; `Player.forceDisassemble` did not, so a
   walker whose plate turned a rend still credited a limb, 40 score, the shake
   and both sounds. A Force rend is also not a blade pass and is now marked
   `force: true` so `_turnCut` declines it — the Force's contest is
   `resistForce`, and billing one act to both is double-charging.

**And the instrument had three defects of its own**, every one flattering the
player. `offenceReport` threw `ReferenceError: BUILDERS is not defined` and had
been dead since the builder table was deleted, because `main()` is its only
caller and no check exercises it. The blade table called `engagementFor` with no
guard share while every run in the same report passed one. And the travel phase
compared a `phaseT` counting UP against `e.arm`, a countdown the incoming loop
decrements every tick, so the player began cutting at HALF the arm time — three
lines under a comment that states the rule correctly and says it was fixed after
the identical symptom. The Colosseum's wave-1 opener cost 0.0 hp at all four
tiers over 24 seeds because of it; it is 7.2 / 11.2 / 13.8 / 17.8 now, and still
clears 24/24. `balance: a melee opener gets to attack — wave 1 is not free` pins
the zero out.

### 6.2 Older design calls — the user's, not yours

Both confirmed exactly as the judges described; both defended by written
reasoning and pinned by existing checks. Do not override a stated intent on a
judge's say-so.

1. The attunement screen offers the same six cards in the same fixed order at
   every attune wave, uncapped and unexcluded. `drawBoons` explains why it is
   all six; a judge wants 3-of-6 excluding the last axis taken.
2. Insight is flat at ~1.4/wave while wave threat goes 24 → 311. The closed form
   is pinned by a check at every wave out to 60, and "no meta-progression" is
   load-bearing in `Progress.js`.

**Technical.**

3. `combat-trace.mjs` measures a stationary floor: the player dies in ~9 s, so
   the field never fills (`peakAlive` 3–4 on waves built for 20+). `--kite`
   was an attempt to fix it and made it *worse* — one body alive, zero kills.
   The cause is inside the kite, not the game (movement does not starve the
   spawner — verified). Prime suspect: `kite()` writes `p.camera.yaw` every
   frame and the stationary run never does. **Untested.**
4. Still unmeasured: power casts, damage dealt/taken per wave, time-to-clear
   under real play. Until those exist, *"is the whole kit worth using"* is
   unanswerable.
5. Order-independence residue: ~40 passing checks whose measured numbers move
   with a shared stream's phase (escalation 5, props 4, presence and co-op 3
   each). They pass both ways because they have margin. **`ground` is no longer
   the only thing the runner does not restore, and that line was measured and
   found short.** `restoreShared` put the wind back ONE FIELD OF SIX — the clock,
   not the heading, strength, gustiness or wander a level's block sets — so every
   suite inherited whichever level the last one loaded; and `heading`/`dir` are
   derived from the clock by `_refresh()`, so rewinding the clock under them left
   the field pointing where it had been at the moved time. The whole
   configuration goes back now, along with the audio singleton. Still uncovered
   and each for a stated reason: `ground.clock` and `_scarAt` (they must move
   together or `ground.scar`'s throttle refuses every cut for the rest of the
   run), Waves.js's stream, and Engine's ShaderChunk flags. See
   `tools/checks/_shared.mjs`.

   And the residue that no boundary restore can reach, because it is inside a
   file: a suite's checks interleave across their awaits, so two of them sharing
   a module-scope stream draw in an order that depends on what ran before.
   Measured by running one suite TWICE in one process — `characters` read a
   heavy's bore at 0.9° off aim and then 0.4°, `arrivals` 2.50 then 2.40 bodies
   per gunship, `pvp` a shove at 0.94 m then 0.33 m. `clocked` seeds every check
   body and does not touch this; the suite has to stop sharing the stream across
   its own awaits. Worse for two of them: `arrivals` and `vehicles` differ from
   one PROCESS to the next, because `Waves.js` and `MathUtil.js` each seed a
   module-scope stream with `Math.random()` at load and `Combat.js`, `Duel.js`
   and `Dropped.js` call `Math.random()` outright. Seeding both streams was tried
   and does not settle `vehicles`.

---

## 6.3 New instruments

| Tool | Answers |
|---|---|
| `tools/_fpgeom.mjs` | where the first-person arms and hilt are **in the frame**, and how much of the hilt is behind the fists — one second, against `fpview.mjs`'s twenty minutes |
| `tools/_celrank.mjs` | every outdoor level's sun height against its shadow's key share, the rank displacements, and **every neighbouring bound in one table** — `cel`'s span/rho/pairwise, `lighting`'s indirect budget and cast-shadow floor, `sky`'s cloud-top-over-sky, and the exposure clamp. `--set=kamino.sunIntensity=3.4,geonosis.elevation=18` measures a candidate look without editing Levels.js |
| `tools/_previewgrip.mjs` | every species' creator preview in ONE table: the bore gap and the hilt's length in that figure's own hands, the hand target in its own arm-lengths, the figure's share of the content box, and where it lands in the frame. Twenty seconds, and it is what showed the framing was three defects rather than one |
| `tools/_deployprobe.mjs` | **did the page throw, and does it deploy** — every pageerror and console error, plus the run seams read out of the RUNNING page. ~40 s against `smoke.mjs`'s five minutes. Written because smoke's deploy step waits 30 s for the HUD, which at §2.6's two seconds a frame is FIFTEEN FRAMES: it timed out on four steps while this probe deployed the same build in 22.2 s with zero errors. A smoke timeout is not evidence of a regression; this is what tells you which you have |

**New check suites this session**, each named for the property it holds rather
than the file it guards: `wiring` (the module graph the BROWSER walks — nothing
else imports the whole game, so a missed import could 404 the page with every
other check green), `severance` (what losing a bone is worth, over the whole
roster, derived from the bones), `dodgeable` (every creature attack leaves a
window a walk can use, with the player's paces measured by driving a real
`Player`), `runrules` (the panel and the director agree on all 70 theatre×rule
pairs), `factions` (no wave composes empty, and the levels that mix two armies
without saying so are counted), `databank` (every archetype has an entry and no
name is typed into the markup).

All except `_deployprobe` take `--import ./tools/register.mjs`; `_fpgeom`,
`_celrank` and `_previewgrip` open with `dom-shim.mjs` because they reach
Textures.js and Engine.js, which bake onto a canvas — and `_celrank` imports
Engine.js DYNAMICALLY for §2.1. `_deployprobe` drives a real Chromium instead,
so it needs neither: it must live under `tools/` rather than in a scratchpad
because `playwright-core` resolves out of the repo's own node_modules, and it
names the browser the same way `smoke.mjs` does (`/opt/pw-browsers/chromium-1194`
— do NOT run `playwright install`).

**Use `_celrank` before touching any level's light.** Six bounds in four suites
read the same atmosphere block, they are not in the same file, and three of them
bite in opposite directions: cutting a sun to soften a shadow drops the cloud
deck under its own sky (`sky.mjs` calls that smoke), and raising the ambient to
compensate walks into `lighting.mjs`'s cast-shadow floor. That is how a
one-level tuning pass becomes a four-suite bisect.

---

## 6.3b A GUARD WHOSE WRITER WAS NEVER WRITTEN — and three more of the same shape

The physics/bodies/lifecycle audit. Everything here was green in every suite
that mentions it, and every one of them is a system holding an object the game
had already torn down. The instrument is `tools/_bodyaudit.mjs`: one World, a
scripted Jedi that actually clears the room, and a full census — the scene
graph, **Rapier's own counters rather than our mirrors of them**, every
collection a body can be parked in, non-finite transforms, and bodies at rest
under the ground — every sixty game-seconds for fifteen minutes.

**A check that reads a guard is not a check that the guard is written.**
`Corpses.update` opens `if (!e || e.disposed || !e.dead)`. `Enemy.dispose`
never wrote `disposed`; only `Player` did. `World.restartWave`'s own note says
in as many words "Both halves are fixed, because either alone leaves the other
reader wrong" — **one half was fixed**, and `grep -rn '\.disposed' src/` was
enough to see it. What that cost is not the wave reset the note was about, it
is ordinary play: `Enemy.update` ends `return this.dying < 40`, so `World`
tears every corpse down forty seconds after it falls and the ledger held it
regardless.

    t=120s   20 corpses,  7 already disposed
    t=240s   20 corpses, 17 already disposed
    t=420s   20 corpses, 20 already disposed — and it never moves again

Seven minutes in, every slot of a twenty-corpse budget is a body that no longer
exists, `live.length > budget` is false forever, and **the field a player fights
on keeps no dead at all** — which is the exact complaint the budget was built
to answer. Twenty whole Enemy graphs ride behind them until the level unloads.

**Two callers below one early return.** `applyBodyLod` is called from
`Enemy._applyLod` and from `Enemy.update`, and BOTH sit under `update`'s
`if (this.dead) … return this.dying < 40`. Both LOD rungs already say a corpse
is not theirs (`applyCohort`'s `fit` is `lod >= 3 && !owner.dead && !ragdolled`)
and neither was ever asked again. Measured with `tools/_cohortleak.mjs`, twelve
B1s stood past `L3_AT` (137.8 m) and killed where they stood: six were still
cohort MEMBERS forty-five seconds after being disposed, still drawn as standing
soldiers by the shared InstancedMesh with their ragdolls invisible underneath,
and the slot never came back — `c.high` climbs with every distant kill and
`_grow` doubles the instance buffer to hold ghosts.

**A flag that means one thing to its writer and another to its five readers.**
`RapierWorld.remove` sets `body.dead = true` and `add` never cleared it, so it
meant "has been removed at least once". A body can come back:
`Enemy._tickGetUp` takes the walking capsule out when a droid is knocked flat
and calls `add` again when it stands up. `tools/_deadflag.mjs`, one B1:

    standing   dead=false  inWorld=true   forceSeen=true
    knocked    dead=true   inWorld=false
    back up    dead=true   inWorld=true   forceSeen=FALSE

`Player._grippableBody` refuses anything with `b.dead`. **Every enemy in the
game became ungrippable the first time a push put it on its back** — the aim
ray passed straight through it to whatever stood behind, for the rest of that
body's life. `Physics.js` has the identical shape and is deliberately left
alone: its own header says nothing there runs in a player's frame.

**And one producer with no consumer.** A dropped hilt is an ordinary `Prop`
with no lifetime; `ageDropped` only ever advanced `dropAge`. `_hiltpile.mjs`,
eight duellists killed five times over: 8 → 40 hilts, 196 → 983 meshes, one per
saber-carrying kill forever. A hilt is 24.6 meshes because it is nineteen to
thirty-six machined pieces, so forty of them is 983 draw calls of hardware in
the sand against the 520 `world-immersion` holds a whole LEVEL to.

**THE PROTECTION ON A BUDGET LIKE THAT IS A RELATIONSHIP, NOT A RADIUS**, and
two drafts got it wrong before the measurement said so. A fight happens AROUND
the player, so every hilt on the field is inside any distance floor worth
having: at 14 m and again at 4 m the cull refused every candidate and the pile
still grew five a wave. What is protected now is a hilt in a hand or in the
Force, one a local player put down themselves, and one dropped inside
`PICKUP_DELAY`; everything else is ranked exactly as `Corpses.worth` ranks the
dead, and what fades is what is behind you at thirty metres.

All five are bound by `tools/checks/undertaker.mjs` (7 checks). Two things it
had to learn the hard way and the next bench will too:

- **`dying` does not advance at one second per second.** `World` scales `dt`
  for hitstop and kill-time, so 42 s of stepping put `dying` at 37 and the
  first draft of the corpse check failed on a build where the fix worked.
  Drive until the thing has happened, with a cap — not for a fixed wall of
  frames. Same shape as §2.6, one clock further in.
- **`_flagship.mjs`'s `dutyInput` is not a room-clearer.** It holds station on
  its line and meets only what comes inside `ENGAGE` (14 m), because it is
  measuring a formation. Driven with it, the 900 s audit stalled at t=420 with
  one B2 standing 34 m out shooting into a raised guard, and the last 480
  game-seconds were a still frame. `_bodyaudit` carries its own `hunterInput`.

**AND THE ONE NEXT.md HAD OPEN, which is the same shape a fifth time.** "A
felled trunk that has settled BELOW the ground it fell on. Of nine trunks
realised in the wood, four had surfaces under the terrain and one had fallen to
−179 m." −179 is one metre off `RapierWorld.killY`, and the cause is upstream of
the solver rather than in it: the fall is a hinge that does not know about the
ground. `Forest.update` integrates θ̈ = 3g/2L·sin θ to horizontal about a pivot
at the CUT FACE, so a trunk rests at the height of its own stump however the
ground runs away underneath it — `_layLog`'s own note has that measured already
("34 of the 83 had some part of themselves buried… 13.2 m under at the deep
end") and takes the right precaution for a STATIC box, laying none along the
buried stretches.

**A Prop is not a static box.** `_realise` built a DYNAMIC body at exactly that
pose, so a trunk lying in a bank was a rigid body born inside a heightfield —
the one state Rapier has no correct answer for. Measured with
`tools/_logsweep.mjs`, twelve stops across the wood, fourteen trees felled at
each: **9 of 21 realised logs were born with their underside below the terrain**,
deepest 1.53 m, p90 0.75. Afterwards, same sweep: **1 of 19, deepest 0.09 m**,
which is the seat's own eight-sample granularity.

The kill-plane end is permanent and worth knowing about on its own: a log that
reaches −180 is removed from the physics world and KEEPS its Prop and its mesh;
it is 180 m from `home`, so `_syncLogs` marks it `moved` and then reads its x/z
off the body — barely changed — so it is never far enough away to be released
either. The tree is gone from the wood for the rest of the level, its instance
collapsed to zero scale, and one of the nine `LIFT_CAP` slots gone with it.

**What is left, and why.** `Prop.destroy` frees materials only where the prop
says `ownsMaterials` (today: a dropped hilt, whose five metals `buildHiltGroup`
machines per hilt). Every other prop kind draws from shared tables and freeing
one of those takes the paint off everything still standing — the same
"corrupting something another system still holds" `_cullOldestDebris` refuses
to commit. Whether any of those tables are per-prop after all is unmeasured.
`Player.dispose` still does not dispose `p.injury`, which owns two materials;
that is ~2 per respawn and it is not what any of the numbers above are about.
And a log that is born ON the ground can still SETTLE a little into it — the
first draft of the wood check asserted the resting place and read 0.72 m and
0.32 m on two of nine after fourteen seconds. The check asserts the BIRTH
instead, deliberately: where a log ends up once it has been dropped, shoved or
rolled down a bank is the solver's business, and a check that pinned it would
be pinning a scene rather than holding a rule.

---

## 6.4 What the gate is red on, and who owns each

```
forward   1517 passed, 0 failed    18.7 min of suite time, clean worktree, quiet box
reverse   1517 passed, 0 failed    SABER_CHECK_ORDER=reverse, same worktree
```

**The same count in both directions is the part that matters**, not the zero.
Forty-two of this session's fifty-nine failures were order-dependent — a suite
handing shared state to whatever ran next — and a forward-only green would say
nothing about them. Run it both ways or the class is not closed.

**It is green. The table below is what it took, and it is kept because every row
is a way a check can be wrong that a green run cannot show you.** Earlier the
same day the same gate read 1438/59.


**Forty-two of those fifty-nine were ONE DEFECT WEARING THREE HATS** — a suite
borrowing shared state and not handing all of it back, §2.9: the audio singleton
(38 checks), the `MODES` record (`runrules`, 1), and the player's saved key
bindings in `localStorage` (`spectacle`, 4, all four reading as unrelated
control faults). Every one of them was green when its own suite ran alone. That
is the single most important thing this table has to say:
the full run is not a slower version of the per-suite runs, it is the only place
a whole class of defect is visible at all, and this session found that class by
running it.

**Read this table the way it is built.** A red line in a full run is not a
finding until it has been re-run alone on a quiet box — in an earlier session
three of nine evaporated that way and one was a race with a peer's commit. But
the converse now has a name too: a line that is GREEN alone and red in the full
run is not noise, it is the interesting one. Reach for `_seq.mjs` before you
dismiss it.

**`tools/_seq.mjs` runs several suites in ONE process in the order given.** What
carries between them is module-scope state (`enemyRng`, `duelRng`, the wave
stream, `wind` and `ground`, Engine's once-only ShaderChunk flags, and the
engine singletons — §2.9), or the scheduling of a suite's own async checks:
`check()` pushes them all onto one `Promise.all`, so they interleave, and the
interleaving changes with what ran before. **Suites run in `readdir` order, so a
hyphen sorts before a dot: `command-pvp` runs BEFORE `command`.** Get that wrong
and your reproduction is green.

**Two of the fifty-nine were the harness, not the game** — `front-screen`'s
layout check and `shadows`, both `Cannot find package 'playwright-core'`,
because the run was in a worktree. §2.10.

| Check | What it was | State |
|---|---|---|
| 38 checks across `controls`, `databank`, `front-screen`, `hud-events`, `menu`, all reading `Cannot read properties of null (reading 'currentTime')` | **one suite left the audio singleton half-built.** §2.9 has the whole shape. Reproduce with `_seq.mjs audio menu`: 19 of menu's 27 die in `new Menu`, out of its own Volume slider | **fixed** |
| `force: a push shoves a crate further than it shoves a pillar` | **an impulse bound quoted in the wrong currency.** A hardening pass added `MAX_SPEED = 1e4` and applied it to `applyImpulse`, but an impulse is in N·s and carries the body's mass: the 900 kg pillar's legitimate push is ~28 000 N·s and was silently dropped. Measured, pillar at forcePower 4: 31.3 m/s before, 0.40 after — and 0.40 is gravity for exactly one step, so it received nothing. Turning the Force setting UP stopped heavy props moving at all | physics lane |
| `first person: the neck cap bounds the eye speed` | **a proxy that failed because the game improved.** It asserted the cap TRIMS >5 mm at a sprint, which was really measuring how rough the pelvis was. The gait fixes took single-frame pelvis travel from 23.7/40.1/69.6/88.3 mm to 8.4/11.3/32.4/28.4 mm against a 46.7 mm allowance, so the cap now trims 0.23 mm. Rewritten to assert both halves directly — the gait is under the cap at every speed, and the cap is proven on itself | **fixed** |
| `destruction: carve a column and how deep decides whether the top falls` | **a check on a knife edge.** Sweeping the hilt ±10 mm around its own fixture, the column stands 7/11 times on the old code and 4/11 on the new; sweeping DEPTH, it stands 7/7 at 0.15 m, 3/7 at 0.30, 7/7 at 0.45, 1/7 at 0.60, 0/7 at 0.75. The response is not monotone, so the single sample was a coin flip and its previous green was luck | blade lane |
| `balance: a body with NO blade defends itself too` | same commit's blade change; a beast goes down in 1.28 s | blade lane |
| `blade: a fast sweep across a forearm produces a cut event` (verify.mjs core) | the chord cap `2 * cap.r` may be smaller than a thin limb's need, so the hips and spine sever in a frame the forearm survives | blade lane |
| `skirmish` ×2 | written red-first: the defeat is never announced (`_endSkirmish`'s only caller passes `true`), and the ending card reads `stats.taken`/`stats.fallen` that no ending sends | modes lane |
| `determinism` ×2 | written red-first: 13 suites build enemies without seeding the stream, 26 drive a World without handing the clocks back | determinism lane |
| `roster: nothing in the tree names a level the game does not have` | one dead reference; the suite also gained an arm for terrain preset names | **fixed**, 5/0 |
| `run rules: a mode whose composer never sees a rule declares it` | **a restore that deleted.** A `menu` check injects `fixedRules` onto the real `MODES` record and put it back with `delete` — and its target is `duel`, which SHIPS that field. Green alone every time; red in the last two full runs. `_seq.mjs menu runrules` reproduces it | **fixed** |
| `spectacle` ×4 | **the player's saved key bindings, handed on.** `controls` drives a rebind through a real Menu, `saveBindings` writes the whole table to `localStorage`, and every later `new Input` reads it back: `loadBindings().walk` comes back `["PadBack+PadL3"]` against a default of `["KeyI", …]`. 19/19 alone, 15/19 after `controls`, and all four failures read as unrelated control faults. Fixed at the boundary — `snapshotShared` carries the whole of storage now | **fixed** |
| `destruction: the blade grinds through a column and drops what was above the cut` (verify.mjs core) | **a budget calibrated on a bug.** Excluding a structure's own debris from its impact scan — correct, and the fix for the suite's own column check — took away the 110 self-impacts carrying 38× the column's health. The blade alone needs 13 s, not the fixture's 4. Reach was never the limit: pushing the tip from 55% to 105% through changes nothing at 4 s | **fixed** |

**And what a full run cannot tell you at all.** Four of `smoke.mjs`'s eleven
steps failed on the run above with "no animation frame in 8000 ms". The box was
at load 15 and a frame here can take four seconds. That is §2.6 exactly: the
timeout measured the box. Re-run smoke on a quiet box before recording anything
from it.

---


## 6.5 If you pick this up cold, do these in this order

**`ROADMAP.md` at the repo root is the other half of this section**, and it now
opens with a status table checked against the tree rather than remembered.
**Three of its four defects are closed** — a thrown body damages what it hits, a
released grip recovers instead of walking ragdolled forever, and
`Destruction.explosion()` reaches the destructible world through a wrapper on
`World.onExplosion`. The fourth, contact dispatch lost in the Rapier migration,
is open and is the structural one; what is worth knowing is that the other three
were each fixable WITHOUT it, so it is not holding three visible defects hostage
the way the roadmap assumed.

Read its procedural-levels half before designing anything there. It records that
this project has killed progression-through-levels **twice** — the Spire and the
Descent — and that neither death was a code failure. That warning is worth more
than its implementation notes.

1. **Get it in front of the player, then read §7.** `node tools/pack.mjs
   /tmp/borz.html` and send them the file. That file did not boot for four days
   and nobody noticed, because nothing in the tree had ever opened one — see
   §2.10's neighbour, `tools/checks/packed.mjs`, which now packs the tree and
   opens the result the way a player does, every run. Nothing in §6.4 is worth
   more than one person playing it for ten minutes.
2. **Finish §6.4's owned rows.** Three of them are one story — the blade's
   sampling rewrite left `destruction`, `balance` and the core forearm sweep
   red — and the first of those is a check on a knife edge rather than a
   mechanism that broke, which is a different repair. The `force` row is the
   sharpest of the lot and the cheapest: an impulse bound quoted in metres per
   second.
3. **Run the gate, forward AND with `SABER_CHECK_ORDER=reverse`, on a QUIET
   box.** This session's single largest find — 38 checks, §2.9 — was invisible
   to every per-suite run and visible immediately in a full one. Symlink
   `node_modules` first (§2.10).
4. **`World.js`'s `pickTarget` cross-army loop** is gated `if (this.command)`,
   which is now three modes rather than one. Dropping the gate is the whole of
   "both armies fight each other as well as you" — and it is a DESIGN decision
   about six levels, not a fix. Six levels field Republic and Confederate bodies
   in the same wave without declaring a split (`factions` prints the census) and
   every one of their notes argues a HORDE, a field united against you. Either
   make those six single-army or let their halves fight; the comment at the gate
   states the cost of the second either way.
5. **`ROADMAP` §5 and §6, which are partly closed.** Verify before building —
   that section is older than the tree. Stasis holding a person is done; check
   the rest the same way rather than believing the list.

**What NOT to do first.** Do not start another audit *by default*. Rounds of it
have run and each found real things, but the last one was asked for explicitly
after a long gap and it was right to run: it found a delivery artifact that had
never booted, a client packet that could kill the host, a control that could not
move anything, and 38 checks dying of one suite's housekeeping. The honest rule
is not "never audit again", it is **audit when the tree has moved a long way
since the last one, and PLAY IT in between**. §7 is not a platitude here — it is
the specific reason this list is short.

## 6.6 If you are handed a long list, ORDER IT FIRST — and show the order

A long list arrives in the order it was thought of, which is never the order it
should be done in. **Do not start at the top.** Rank it, say the ranking out
loud before you begin, and say what you are doing last and why. The player can
correct an ordering in one sentence; they cannot correct four hours of work.

Rank on evidence from this repo, not on taste:

**1. Three buckets, in this order.** A thing that EXISTS AND IS BROKEN beats a
thing that exists and cannot be reached, which beats a thing that does not exist.
The player already believes the first two work, so those are the ones costing
them something today. Measured this session: of nine gaps found against a genre
wishlist, four were defects and three were features with no way in — only two
were genuinely missing. `ROADMAP.md` is sorted this way.

**2. Then by player-visible value ÷ cost, and the ratio is often absurd.** The
worst thing in the game — a creature whose opening attack could not be dodged at
any speed, 18.73 hp/s against standing, retreating, strafing *and* dashing — was
**three numbers**. The spark freeze that stopped the game for 71 to 134 seconds
was **one argument in the wrong slot**. Look for those before anything expensive.

**3. Find the item that kills other items.** Contact dispatch, lost in the Rapier
migration, is the root cause of three separate entries on `ROADMAP.md`'s own
list. An item that closes three is worth more than its rank. Ask of every
expensive thing: what else does this unblock?

**4. If you run lanes in parallel, batch by FILE, not by theme.** Ownership must
be disjoint and stated per lane, because the tree is shared. §2.2b has the two
occasions that rule was broken and what it cost. If a run cannot tolerate it,
give each lane its own worktree.

**5. Expect your own brief to be wrong, and let the measurement win.** Briefs
written from this document were corrected by the lanes executing them more than
once — an escalation brief blamed the wrong cause entirely, and the lane's own
measurement found the real one was the denominator, with one level's bound
arithmetically unsatisfiable. That is the system working. Write briefs with the
numbers you have and an instruction to re-measure, not with conclusions.

**6. Re-order after every batch.** A landed fix changes what is cheap. The list
you ranked at the start is stale by the third item.

**7. Put a build in front of the player before the list is finished, not after.**
`node tools/pack.mjs /tmp/borz.html`. See §7 — it is not a platitude, it is the
source of every note that has ever mattered here.

---

---

## 7. The one thing worth more than any of this

Every one of the 64 notes that drove this entire effort came from the user
**playing the game and looking at it**. The cone survived several rounds of
being "fixed" by the checks; it took a person saying it was still there.

The judges' findings are a checklist to feel for, not a substitute. If you are
choosing between another measurement pass and getting a run in front of the
user, choose the run.
