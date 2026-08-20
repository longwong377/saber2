# START HERE — the flagship phase

Written 20 Aug, end of the audit-and-playtest session. Short on purpose.
Everything it points at is long.

---

## Read these four, in this order

1. **`HANDOFF.md` §2** — the traps. §2.1 will silently invalidate every
   measurement you take if you skip it. §2.2b is why seven parallel lanes kept
   committing each other's files.
2. **`PLAYTEST.md`** — what the player found by playing. **This outranks every
   measurement in the repo.** A finding here beats any number taken without a
   person at the controls.
3. **`FLAGSHIP.md`** — the design for THE LINE, settled by a five-lane
   committee. Every number in it was measured against this tree.
4. **`ROADMAP.md` PART TWO** — why progression died here twice. `FLAGSHIP.md`
   §13 answers it; read the original anyway.

Do not read the rest of `HANDOFF.md` cover to cover. It is a reference.

---

## Where the tree is

- **7 levels, 8 modes, 1 campaign, 31 archetypes.** Run `tools/state.mjs`
  rather than believing that sentence.
- Gate was 1517/0 both directions before this session's seven lanes landed;
  it is ~1553 now. **Re-run it before trusting anything** — symlink
  `node_modules` if you use a worktree (§2.10), and give the worktree a unique
  name, because two lanes collided on `/tmp/gate` this session.
- **The default branch tracks the work and the live link follows it.** That was
  not true until this session: every session worked on its own `claude/*`
  branch and none merged, so *nothing any of them did had ever reached the
  player*. If you branch, merge back.

---

## What the last session did

**An adversarial audit** across thirteen domains, then **seven fix lanes** off
a single playtest. The audit's own headline is in `HANDOFF.md` §6.4: 42 of 59
failures were one defect — a suite borrowing shared state and not handing all
of it back.

The playtest lanes, and what each turned out to be:

| Lane | The finding under it |
|---|---|
| Cut the indoor levels | The `boarding` campaign went with them. `works()` is orphaned and holds **the only blast door in the game** — see below |
| The attacks | Left click was a pure lunge with **0.00 lateral blade travel**; by the game's own cutting model it did not qualify as a swing. The spin turned the body 35.5° and reached 2 of 18 |
| The hands | Palm-to-palm dot **−1.00** — both knuckles out. Two turns taken about the hand's X axis, which points opposite ways on a left and a right hand. **A constant bias is invisible on one hand and fatal on two**, which is why four reports missed it |
| Allies freezing | Four paths, not one — three bare `return`s in `steer`, plus a wall-slide that emptied the movement wish and thereby disabled the unstick logic twice. Frozen frames **40.0% → 1.8%** |
| Transports | Every teleport replaced with a called, boarded, flown journey. Its own check then caught **1 of 10 men still standing in your swing arc at disembark** |
| Stratagems | Spoken word by word, aimed, flown in, watched. **1–2 kills of a 22-body wave → 6–9.** Then overflowed three shared particle rings |
| Trees | Flat 46 damage → `mass·v²`. And **162 fells left 147 permanent invisible walls** |

---

## YOU ARE RUNNING TWO STREAMS AT ONCE. Do not pick one.

The player is handing you a **new list of playtest findings** at the start of
this session, and they want the **flagship mode** built at the same time. Both,
in parallel, from the first hour.

**Stream A — the list.** Fixes and features from someone who has played the
build. Log every item into `PLAYTEST.md` as it arrives, in the player's own
words, before you start. That file already holds the previous round and its
format is the one to follow.

**Stream B — the flagship.** `FLAGSHIP.md`, starting with §14's three kill
tests.

### How to run them together

- **Stream A outranks Stream B on conflict.** A thing that is broken in the
  game the player is holding beats a thing that does not exist yet. If a lane
  has to choose, it fixes.
- **But start Stream B's kill tests in the first hour anyway.** They are a day
  each and a negative result changes what is worth building — finding that out
  in week one is the whole reason they are cheap. Do not let the list push them
  to "later"; later never comes.
- **Fan the list out into lanes by FILE OWNERSHIP, not by topic.** Last session
  ran seven lanes on one tree and they committed each other's work repeatedly,
  once capturing a file with a debug line still in it. **Give every lane its own
  worktree this time** (`isolation: "worktree"`), or partition so hard that two
  lanes cannot touch one file.
- **One lane owns the flagship** and does not get interrupted by the list. It is
  the only piece of work here with a design behind it and it needs continuity.
- **Re-run the gate before you believe any of it.** Seven lanes landing on one
  tree is exactly when a green suite goes red for reasons nobody owns.

---

## The flagship's three kill tests. Each can kill the design.

**Step 0 — one day, before anything.** Fight one Command area, dump the crater
log, reload, replay, fight again. Ask a person: does visit two read as *the
same ground after a battle*, or *a level with holes in it*?

**Step 1 — four hours.** Five engagements on one Geonosis with the front
marching in. Kill test: three screenshots from the same spot at engagements 1,
3 and 5, shuffled. **The player orders them, or the front is not visible** and
you take §14's ~600-line fallback.

**Step 2 — one evening.** The Dead Jedi test. `boonMods.cutPower = 0`, play
three engagements, and answer whether you had anything to do.

`FLAGSHIP.md` §14 has all three in full, with what each result means. **A
"no" on any of them is a good outcome bought cheaply** — §14 names the fallback
for each, and the fallback is still a mode worth shipping.

---

## Open, and worth a decision

- **`works()` is orphaned and holds the only `BlastDoor` in the game.** The
  Providence was its sole caller. DESIGN.md calls the twenty-second door hold a
  signature mechanic, and no level has one now. It belongs on an outdoor field
  as a bunker you breach — which is what `FLAGSHIP.md` §4 says an interior may
  be.
- **The overhead attack has never made a swing sound.** It peaks at 10.8 m/s
  against an 11 m/s whoosh threshold. One number.
- **First person should be one-handed.** Two independent confirmations now: the
  framing sweep in §6.0, and the palm geometry — separating two fists properly
  puts them level with the hilt instead of under it. `fpHands` already defaults
  that way.
- **The composite grade crushes dark levels** — mustafar's near ground ×0.49.
  A look call, not an engineering one.
- **A stump gets a drawn instance and never a collider**, so a lopped tree can
  leave a 20 m spar you walk through.
- **Muster-anywhere is the small honest version.** A full one needs a shelf to
  compose the contingent, allies drawn from the level's own pool, a score
  ladder that knows how many men you brought, and a co-op run with allies that
  nobody has driven.

---

## How the player wants to be talked to

`CLAUDE.md`, and it is short. Lead with the point. Cut supporting detail unless
asked. One number beats five. They will tell you when they want depth — and
when they do, they want it deep.

**And get it in front of them.** The live link is GitHub Pages off the default
branch. Ten minutes of them playing is worth more than this document.
