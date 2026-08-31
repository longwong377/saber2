# THE COMPANY — a plan to make troop management the thing this game is about

Written after the barracks shipped and the owner asked for the next order of
magnitude: *"significantly increase the depth and scope of the troop
management. This should not be an afterthought, but an impressive and expensive
feature of the game. Think big and bold."*

The work below was scoped by seven readers over the source and five designers
against three judges. Everything load-bearing in it was verified in the code and
is cited. Where a number is claimed it was measured.

---

## 0. The finding this plan is built on, and it is already in this repo

`SCOPE.md:12-40` opens with the conclusion four independent researchers reached
separately, and it is the most useful paragraph anybody has written about this
game:

> **A demigod protagonist poisons squad attachment, and this game is currently
> built to fail that way.** … players become attached to AI characters *after*
> experiencing them as functional and useful, and they value a character's
> utility over their emotional content. A name, a serial and a nickname are
> labels *on* attachment — they do not create it. … **The fix is structural, not
> sentimental: make troopers irreplaceable by capability.** … This is the
> highest-leverage change available, because it converts attachment from a
> feeling into a capability loss.

The barracks that shipped on 31 Aug is the sentimental layer, and it is good:
names before the ramp, paint, dossiers, scars, epitaphs, a parade ground. By
this finding it is not what will make anybody care. It is the surface that the
structural layer has been missing.

So the thesis of this plan is one sentence:

> **A named man is a capability. His death is the capability going away, said
> out loud, in the fight, while it costs you something.**

Everything below is that sentence built.

---

## 1. What the law actually forbids — narrower than it reads

The no-cross-run-power doctrine is stated four times (`Progress.js:16-24`,
`Company.js:25-33`, `FLAGSHIP.md:155-158`, `Menu.js:5895-5904`) and enforced by
exactly six mechanical clauses: a six-word source scan over Company.js and
Muster.js; the `dress`/`dressRecruit` field pin (`band,callsign,mark`); the
not-a-ratchet boot checks; bond net-zero pricing; the two-sided trait law; and
paint-moves-no-number.

What that leaves **legal and unregulated**, verified:

- **New persisted fields.** `MAN_FIELDS` is pinned by no check.
- **New writer functions.** The dress pin greps only the bodies of `dress` and
  `dressRecruit`. `Muster.setRecruitSquad` and `setPicks` already ship outside
  it. **Organisation is not cosmetics and is not scanned.**
- **New stores.** `session.mjs` counts durable writers only inside five named
  files; Company.js and Muster.js are already invisible to it.
- **New earned two-sided traits**, on the `bonded` precedent (`earned:true` +
  `sheds`), priced `≤ 0` through `priceSwing`.
- **Information.** Nothing anywhere prices knowing more.

And one governing principle, taken from the amendment the codebase already made
for itself (`Company.js:28-32`): a thing may cross runs **if a single run could
have produced it unaided** — a shortcut, never a new ceiling. Every proposal
below is tested against that sentence.

**This plan opens no amendment doors.** Everything in phases 1–6 is law-clean.
Where a bolder option exists behind a door, it is named in §8 and not taken.

---

## 2. The contradiction we are going to fix on the way

`SCOPE.md:265-269`, warning #2, verbatim:

> **Do not give veteran troopers stat bonuses.** This is the Rogue Legacy trap.
> If a veteran is 40% tankier than a fresh trooper, waves must be tuned for one
> of the two and the other feels wrong, permanently. Rank should change **what a
> trooper can be ordered to do** — a Sergeant accepts a standing order, a
> Corporal does not — and survival should earn two-sided traits, not numbers.

Today `RANKS` (`Command.js:656-662`) gives the top rung **+78% health, +34%
damage, +10% speed**, and `AIM_BY_RANK` (`Enemy.js:1513`) tightens his cone on
top. That is the trap, shipped, and it is the one live contradiction in the
repository — it is also the *cross-run power gradient*, because the company
carries rank between runs.

The fix is cheap and legal, and this is the single most valuable thing recon
found: **`tools/checks/command.mjs:833-834` asserts strict monotonicity, never
magnitude.** A ladder of `1.00 / 1.05 / 1.10 / 1.15 / 1.20` on health passes it
unedited. So the multipliers **compress** (roughly 3.5×) rather than being
deleted, the check stays green, the dossier's derived `"N% health"` string stays
true, and rank becomes what SCOPE says it should be — a licence.

Cost, stated honestly: this is a **rebalance**, not a config change. Every wave
budget in Waves.js and every measured line in PERF.md and FLAGSHIP was taken
against a line whose top rung is +78%. `tools/_flagship.mjs` step 2 is an
instrument — it reports, it does not fix. Budget a measured tuning pass, not a
commit.

---

## 3. Part 0 — the five defects, fixed first

Four were found by review of the shipped barracks; the fifth was found by the
budget reader and is older and worse than any of them.

### 0.1 The muster store's memory mirror shadows a cleared store
`Muster.readAll` falls back to `memStore` whenever `getItem` yields nothing —
but a key *removed* (by the check harness's `withCleanStore` /
`_shared.restoreShared`, or by a player clearing site data) reads as absent, and
the stale in-memory slate is served instead. Proven: mint, dress a recruit,
`removeItem`, and the recruit and his callsign come straight back.
**FIX:** set and read the mirror only from the failure path — a `storageBroken`
flag set in the `catch` and in the `typeof localStorage === 'undefined'` branch.
An absent key on a working store is an empty slate.
**CHECK:** `barracks: a cleared store is cleared`, plus a throwing-storage clause.

### 0.2 The no-write check cannot fail
`barracks: ensure on a clean read writes not one byte` compares the stored
*string*. Proven by mutation: make `saveSlate` unconditional and the suite still
passes 19/19, while the design's stated law is that a render path must not write
at all.
**FIX:** count writes with a `localStorage.setItem` spy; keep the byte
comparison as a second clause, since it catches a different defect.

### 0.3 The salt's `lost` term is untested
Removing it keeps the suite green (a *constant* salt is caught), because a wipe
also writes the dead onto `fallen` and `takenOf` excludes them, so new names
appear either way.
**FIX:** keep the term — it is the belt to the fallen list's braces once
`FALLEN_KEEP` evicts a name — and pin it in three lines: two companies identical
but for `lost`, assert `saltOf` differs.

### 0.4 A fresh profile opens on an empty parade ground
`DEFAULT_SETTINGS.mode` is `roguelite`, which fields no army, so the tab opens
on an empty roll, an empty stage and a sentence pointing at another tab — the
exact "I see nothing" this rebuild exists to kill. Skirmish and Command are
excellent; nobody arrives there first.
**FIX (recommended):** the empty state teaches and *acts* — the ground is framed,
one line says what the tab is, and a keyboard-reachable control sets the mode
from here ("Lead the Republic in a skirmish" → `selectMode('skirmish')` and
re-render). Optionally also move `DEFAULT_SETTINGS.mode` to `skirmish`, which is
a front-screen decision and the owner's call.
**REFUSED:** minting a "preview" muster for a mode that fields no army. It shows
men who are not deploying, which is the defect class the rebuild exists to kill.

### 0.5 `Company.writeAll` swallows a full quota silently — and has no mirror
`Company.js:259-264` catches and discards `QuotaExceededError`. Unlike Muster it
keeps no in-memory copy, so **the day a save stops fitting, the roll vanishes
with no error anywhere.** Measured: the whole game is ~300 KiB against a ~5 MiB
quota (6%), and a maximal man is 1,097 JSON chars — so this is not imminent, and
every phase below grows the record.
**FIX:** one shared, correct storage policy for both stores — on a failed write,
keep the value in memory for the session AND surface one honest line on the tab
("this roll is not being saved"). Silent data loss is the only unacceptable
failure mode in a permadeath game.

---

## 4. The six phases

Each phase ships on its own, on the play link, and makes the next one matter.
Sizes are the panel's, sanity-checked: **S** ≈ a sitting, **M** ≈ a day,
**L** ≈ several days plus a tuning pass.

### PHASE 1 — THE LICENCE  (S–M)  *rank stops being a health bar*

- **Duties.** Each `RANKS` rung gains one cumulative licence:
  `STANDS` (takes orders while you are in reach) → `HOLDS` (keeps a planted
  order after you leave) → `LEADS` (may hold a squad's post and take a standing
  order at all) → `CREWS` (counts as a licensed crew with no commander present)
  → `RELAYS` (carries an order onward). One exported `holds(t, duty)` that every
  consumer calls; no second table anywhere.
- **Compression.** hp `1.00→1.20`, dmg `1.00→1.12`, speed `1.00→1.04`,
  `AIM_BY_RANK` flattened to match. Legal unedited (§2).
- **The post and the succession.** A persisted `post` boolean — *he holds his
  squad's seat*. `leaderOf` (`Command.js:7918-7927`) keeps its derivation and
  gains one preference clause in front of it, so the derivation remains the
  fallback and there is no field to clear when he dies. When the post-holder
  falls, the heir is derived on the same frame and **announced**.

*Why it is the first phase:* it is the smallest change that makes a specific
man's death take something away, and every later phase hangs off `holds()`.

### PHASE 2 — THE REACH AND THE REFUSAL  (M)  *and it unblocks every other mode*

`order()` (`Command.js:5497`) has **no distance test and no rank test of any
kind** — verified. An order reaches every man on the roll, anywhere, instantly.
SCOPE calls fixing this the highest-leverage of its three capability mechanisms.

- **Reach.** `ORDER_REACH` off the commander's body. Out of reach, the order
  does not land.
- **The runner.** Press the same order again inside a short window and a named
  man leaves the line to *carry* it. He can be killed on the way, and then the
  order dies with him and the log says so.
- **Licence.** A standing order needs `LEADS` at the squad's post; an
  unsupervised hold needs `HOLDS`.
- **Compliance, with a visible reason.** An order becomes a request rolled
  against a per-man value built from existing terms (`Reactions.braveryOf`,
  presence `share`, discipline) — **no dice, no new attribute** — and every
  refusal names the term that failed: *shaken · slack · alone · too green · out
  of reach*. `SCOPE.md:78-81`: "Every refusal needs a visible reason."
- **Fall Back To Me.** Warning #1 names four required mitigations for real-time
  permadeath; three exist and this one does not. It is one order and it belongs
  here, where the rally point is your body.

**This phase is what makes the rest possible in every mode.** Crewed objectives,
fire missions and downed-not-dead are declared on The Line *alone*
(`Waves.js:517-560`), each with the argument written out: without the advance
quorum they "pay for free". Command — the mode named for the company — runs no
quorum, so those systems cannot travel. **Reach is a cost that exists in every
mode**, because every mode has your body. After Phase 2, capability has
something to be expensive against everywhere, and the asymmetry stops being a
wall.

### PHASE 3 — THE BILLETS AND THE VACANCY  (M–L)  *the headline*

Five jobs, each held by one named man, each doing something the company
otherwise cannot do. The judges independently picked this construction as the
best idea in the panel, because it is the only one that performs SCOPE's actual
conversion.

- **The billet** is a job, not a stat: the man who reads a fire-mission ellipse
  and tells you what is standing in it; the man whose voice extends your order
  reach; the man who can dig; the man who crews a battery unsupervised; the man
  who works on the wounded. Each requires a *licence* from Phase 1 — one
  taxonomy, not two.
- **The vacancy.** When a holder dies, `onDeath` says it in the fight, as a
  sentence about the company rather than about him: *"THE GLASS IS DOWN. Nobody
  reads a mark but you."* The successor is derived on the same frame.
- **The apprentice.** A man in the holder's squad accrues watch while the holder
  is *working*, and qualifies. In-run only, never persisted — so it is not a
  cross-run ratchet, and losing your Glass in area four means a gap you feel for
  ninety seconds, not a permanent hole.
- **The wanted crew.** Objective sites stop counting bodies and start wanting a
  person (`Objectives.js:107-138` gains one `wants` field per row).

### PHASE 4 — THE RAMP  (M)  *the biggest unclaimed decision already shipped*

The gunship publishes **ten** seats — six on the benches and four standing on
the rail (`Vehicles.js:2453-2468`), falling back to `BAY_SEATS = 6` with no
model — and `MAX_STRENGTH` is 24. **A full company withdrawing can lose fourteen
men, and which fourteen is decided by squared distance to the ramp, sorted once,
with zero player input** (`Extraction.js:1695-1696`). That is the single largest
identity decision sitting unclaimed in the shipped game.

- **The manifest.** Name men for the ramp while you keep fighting. The decision
  stops being *do I survive* and becomes *which men do I spend this window on.*
- **Somebody holds the door.** When the hold expires with men still on the
  ground, one turns round instead of walking — the bravest, deterministically —
  and is named in the after-action and on his own record for ever.
- **Left is not dead.** `bank()` currently mixes the man killed in area two with
  the man standing eleven metres from a closing ramp. Those are different facts
  and the memorial should say which.
- **The wound you can see.** `Trooper.wounds` has exactly one writer and it only
  fires in a mode where `downed` is declared — i.e. not in Command or skirmish,
  so the scars Fable shipped are invisible in the modes the company lives in.
  Give it a second writer that works everywhere.

### PHASE 5 — THE NAME THAT EARNED ITSELF  (M)  *the sentence layer*

`_earnNickname` draws blind from a 32-entry table at rank 2
(`Command.js:1955-1972`) while the director already logs ~21 named event kinds
with name, killer, bearing, wave, area and timestamp. `SCOPE.md:209-214` says
what to do with that and it has never been done.

- **Citations.** One pure module walks a run's log and returns the deeds worth
  naming. A name is *minted from a deed* and printed with the sentence that
  earned it. You read "Digger, KIA" and you remember why he was called that.
- **Earned two-sided traits**, priced through `priceSwing`, on the `bonded`
  precedent — including traits that remove an *order* rather than move a number
  (the `flag` field has exactly one consumer today).
- **The war diary and the memorial wall** — the honours feed past its five kinds,
  the fallen grouped by ground with the deed that named them.

**The audience note, and it changes the phasing:** this player *dies or quits
most runs*, and everything computed at the fold is never written for a wipe or a
quit. So citations must also mint **at the area boundary**, in-run, or the whole
layer is invisible to the person who asked for it. That is why Phase 5 sits
after the in-fight phases rather than first, despite being the cheapest.

### PHASE 6 — THE BOOK  (L)  *the surface, last on purpose*

The screens: the **order of battle** (squads, leaders, succession, who is
attached to you), the **briefing** (the ground, who of yours has stood there,
the expected opposition), the **after-action as a ceremony** rather than a card,
and the **wall**. All of it reads off derivations that phases 1–5 already
produce, which is why it is last: built first it would be five reading rooms
over a game that had not changed.

**Prerequisite, and it is invisible work.** The stage cannot afford this today.
Measured: a parade figure costs **15.82 ms to build** and stands as **54 meshes /
9,386 triangles with no LOD**, and `_restage` tears down and rebuilds *every*
figure on any signature change. Ten men is 540 draw calls; sixty is 3,240 —
more than the entire shipped Geonosis frame at 12 alive (2,413). The machinery
to fix it already exists and is not wired to the menu: `buildMergedSkin` takes
one figure to **9 draw calls in 9.88 ms**. Phase 6 begins with per-figure
restage invalidation, a time-budgeted amortiser instead of one-per-frame, and
merged skins. Without them, "the army at real scale" is not affordable.

---

## 5. The doctrines this plan commits to

Three cross-cutting decisions, because the panel produced three incompatible
answers to each and a plan that does not choose is not a plan.

1. **ONE INPUT DOCTRINE.** All 26 letters are bound and `controls.mjs:275-296`
   fails the build when the rebinder has no spare letter; a fourth fixed wheel
   slot is a declared review gate (`spectacle.mjs:1172-1200`). Every new verb in
   this plan therefore rides **the existing order wheel plus the reticle** —
   the man under your crosshair is the argument. No double-taps, no tap-vs-hold
   overloads on keys that already mean something under pressure.
2. **ONE CAPABILITY TAXONOMY.** Rank grants a *licence*; a *billet* is a job
   that requires one. Two designs proposed parallel taxonomies that both touch
   `RANKS`, `leaderOf`, `summary()` and `MAN_FIELDS`; shipping both would give
   the game two answers to "what is this man allowed to do".
3. **THE PAYOFF IS IN THE FIGHT.** The audience dies or quits most runs. Any
   feature whose only expression is written at the fold is invisible to him.
   Every phase above lands something on screen *during* a run.

---

## 6. What this plan deletes

The judges' sharpest collective criticism was that five designers proposed
thirty-odd screens and not one named something to remove. Three candidates:

- **`Trooper.joined`** — written from two sites, sanitised in and out of the
  save, on `MAN_FIELDS`, and **read by nothing**. The exact shape of the
  `wounds` defect. Claim it in Phase 5 (it is "the area he joined on", which is
  a citation) or delete it.
- **`LOCKED.offer`** — a reason code with a sentence and a CSS class and no
  writer; the mechanic it belonged to was built, played, complained about and
  deleted. Delete the remains.
- **The Company tab's index page** as a distinct thing. Phase 6 replaces it with
  the order of battle; keeping both is two answers to "what does this tab open
  on".

---

## 7. Cost, and the one budget that actually binds

- **Perf is the binding budget** and it binds at Phase 6, not before — see the
  measured numbers above. Phases 1–5 are logic and text.
- **Save size is not a budget.** ~300 KiB against ~5 MiB; the record can grow
  ~17× before bytes matter. Stop designing around it — but fix 0.5.
- **The check budget is the real hidden cost.** The troop family is already
  **83 s for 94 checks** (barracks 14.0, company 14.1, muster 44.5, attributes
  10.4), none of it in the 17-suite/90 s fast tier, on a gate that has been
  killed at 50 suites. The five designs would have added ~90 checks. **Cap this
  plan at ~35 new checks**, extend existing suites rather than adding new ones
  where possible, and put the three or four that guard the licence table into
  the fast tier so a regression is caught on every push rather than never.
- **The packer:** 1 KB of source becomes 1.33 KB of page and the page is already
  24.88 MB with `--min` unbuildable here. Code is affordable; new art is not.
- **Mobile is unsolved and this plan does not solve it.** There is no `@media`
  rule scoped to the company panel anywhere; the stage cannot pinch-zoom. Phase
  6 must budget a real breakpoint or explicitly declare the barracks a
  desktop-first screen.

---

## 8. The doors this plan does not open, named so nobody opens one by accident

- **A cross-run resource of any kind.** Would require rewriting five headers and
  four checks. Loses the game's most-repeated promise.
- **A veteran roll that fields more men.** Loses "a returning company is a better
  line and never a bigger one".
- **A net-positive trait transfer** (mentorship where the receiver gains more
  than the giver loses). Legal-looking and a ratchet.
- **Writing `attrs` directly from a menu.** Nothing currently catches it —
  `company.mjs:1013` pins xp/kills/wounds/areas/runs/type/designation and *not*
  attrs. **That silence is a hazard, not a permission.** If any future work
  edits attrs, add the pin first.
- **A war map / campaign layer, or save-resume.** Both explicitly cut in
  `FLAGSHIP.md:155-158` ("It is the Spire"; "A run you can put down is a
  campaign"). Reversing either is an owner decision about what the game is, not
  a troop-management feature.

---

## 9. What to build first, if only one thing gets built

**Phase 1 plus the vacancy announcement from Phase 3.**

Compress the ladder, give each rung a licence, put a post on a squad, and make
the death of the man holding it print one sentence in the fight about what the
company can no longer do. It is roughly a day's work, it opens no doors, it
fixes the repository's one live contradiction, and it is the first time in this
game's life that losing a specific man will take something away from the player
that he can name.

---

## 10. What actually shipped, and what is still on the list

Written after the build. Every claim here is held by a named check; the mutation
counts are what those checks caught when the code under them was deliberately
broken.

### Part 0 — the five defects

All five fixed. `src/game/Store.js` is now one storage policy for both durable
stores (the memory mirror no longer shadows a cleared store, and a refused write
is remembered rather than thrown away); the no-write check spies on `setItem`
and counts, so it can fail; the salt's `lost` term is pinned along with `runs`
and the headcount; a fresh profile opens on men rather than on an empty parade
ground; and `writeAll` no longer swallows a full quota in silence.

### PHASE 1 — THE LICENCE — **shipped**

- The ladder came down: `1.00 → 1.20` health, `1.12` damage, `1.04` pace, and
  `AIM_BY_RANK` flattened to `0.88` at the top. A returning company is a more
  capable army, not a bigger or a tougher one.
- `DUTIES` is one table and `holds()` is its one reader — a record, a body
  wearing one, or a bare rung, and never a corpse.
- **Four of the five duties bite today**, each on a real system, each additive:
  - `HOLDS` — when a planted squad's leader falls and nobody left in it is
    licensed, the ground is given up on that frame and the fight says so.
  - `LEADS` — the post. The player names a man to his squad's seat; it sits in
    front of `leadOf`'s derivation, so his death needs nothing cleared.
  - `CREWS` — one licensed man on a position digs it alone; an unlicensed man
    cannot, and an ordinary crew of three still can.
  - `RELAYS` — the only presence term in `Morale.js` that crosses a squad
    boundary. Lose him and every squad he was standing among feels it.
  - `STANDS` is the floor and gates nothing, which is honest: it is what
    everybody has.
- **The vacancy** speaks only when a capability has actually left the field —
  never on an ordinary casualty, which is what keeps the line worth reading.

Held by `tools/checks/licence.mjs` (8 checks). Twelve mutations, twelve caught.
It found one real bug before it shipped: `null >= 0` is true in JavaScript, so
`holds(undefined, 'STANDS')` was answering yes.

### Also shipped, out of Phases 3–4 and the tab itself

- **Deep customization, in every mode that fields a line.** Twelve rows of kit
  and paint per man — pauldron, kama, pack, rangefinder, crest, holsters,
  brace, bells, cape; plate, unit flash, visor — from a fifteen-colour palette,
  worn on the parade ground and carried onto the field through the spawn.
  Measured on a cleared store across all eleven modes: ten named men, 33 kit
  chips and 48 swatches in every mode that fields troops.
- **Issue the pattern** — to his squad or to the whole company, across both
  stores, because on a fresh profile every man the player has is on the slate.
  Nothing personal travels: the callsign, the shin mark and the forearm band
  are how you find one man in a line of ten.
- **The order of battle** — the line in the squads it will actually form, each
  under the man who leads it, off the fight's own `squadPlan` and `leadOf`.
- **A veteran can be moved between squads.** A recruit could be dealt one from
  the day the slate existed; a man who had come home could not.
- **Left is not dead.** The memorial stopped printing one sentence over the man
  cut down in engagement two and the man standing eleven metres from a closing
  ramp. Both still cost everything.
- **The scar is reachable.** `Trooper.wounds` had exactly one writer, and it
  only fires where `MODES.downed` is declared — The Line, and nowhere else. A
  second writer sits in the loop that touches every living body once a frame.
- **Training stops being offered a line it cannot land.** It runs on a
  `DojoDirector`, which has no roster, and the raise-a-line door was minting,
  naming and saving ten men for it.
- **The contingent composer learned about the shelf.** A twenty-man meeting
  composed `10 troopers + an AT-TE + an officer`, `recruit` refused both on the
  area unlock, and the `break` threw the rest away — a composed side took the
  field as ten identical clone troopers.

Held by `tools/checks/barracks.mjs`, which is 29 checks now. Fifteen further
mutations, fifteen caught.

### Still on the list, in the order they are worth building

1. **PHASE 2 — the reach and the refusal.** `order()` still has no distance
   test and no rank test: an order reaches every man on the roll, anywhere,
   instantly. This is the highest-leverage thing left, and it is what gives
   `RELAYS` its second consumer and every later phase something to be expensive
   against in every mode.
2. **PHASE 4's manifest.** The gunship publishes ten seats, `MAX_STRENGTH` is
   24, and which men board is decided by squared distance to the ramp with zero
   player input. *Left is not dead* made the loss legible; naming who runs for
   the ship is what makes it a decision. The other half — somebody turns round
   and holds the door, deterministically, and is named for ever — is the
   sentence that mechanic is for.
3. **PHASE 3 — the billets.** Five jobs, each held by one named man. The
   licence taxonomy they hang off exists now.
4. **PHASE 5 — citations.** `_earnNickname` still draws blind from a table
   while the director logs twenty-one named event kinds with name, killer,
   bearing and minute. Mint the name from the deed and print the sentence that
   earned it — and mint at the area boundary, not at the fold, or the player
   who dies or quits most runs never sees it.
5. **PHASE 6 — the book.** Last, and it begins with the invisible work: a
   parade figure costs 15.82 ms and 54 meshes with no LOD, and `_restage`
   rebuilds every figure on any signature change.
