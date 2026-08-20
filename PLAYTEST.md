# Playtest log

What the player found by playing, and what came of it. Newest first.

**This file is the most valuable document in the repo.** Every one of the 64
notes that drove the original effort came from someone playing the game and
looking at it, and `HANDOFF.md` §7 exists to say so. A finding here outranks any
measurement taken without a person at the controls.

---

## 20 Aug — first play of the post-audit build

The first session in which the player could actually reach the current build:
the live GitHub Pages link had been pinned to a branch nothing ever merged into,
so **no session's work had ever reached the player.** Fixed by fast-forwarding
the default branch. Everything below is from the first real play.

### Cut outright

| Finding | Action |
|---|---|
| **The Boarding Bay and The Providence were hated.** *"you completely missed the ball so just remove them. your outside work is much better."* | Both levels deleted, and the `boarding` campaign with them. 9 levels → 7, 2 campaigns → 1. Recorded as a standing rule in `FLAGSHIP.md` §4: **no completely indoor places, ever.** |
| **Small white text under the title in the menu** — progress lines and similar. *"a bunch of useless shit — I want you to remove it completely."* | Deleted. |
| **The current wordmark.** *"kind of lame to be honest and not at all in keeping with the style of the game."* | Replaced everywhere. |

### Combat feel

- **The light attack barely moves the saber.** *"almost like both attacks do
  nothing."* Wanted: *"something violent but graceful and effective for slashing
  down hordes."*
- **The spin attack is nothing.** Should be *"a whole body spin/directional
  force spin thing"* — and **steerable during the spin**.
- **The overhead attack is right.** *"a lot better, like good job, it feels
  real."* It is the reference the other two are measured against.
- **First-person grip, fourth report.** *"the knuckles are facing out on both,
  that's not how you would hold a saber in 1 or even 2 hands, you keep missing
  this over and over."* Diagnosed as a wrist-roll problem, distinct from the
  framing problem `HANDOFF.md` §6.0 swept.

### Things that look like bugs

- **Allies freeze in place when uninspired.** *"them frozen still looks like a
  bug almost and it happens everywhere."* A broken soldier should take cover,
  fire wildly, back away — anything but stand still. Measured beforehand: allied
  bodies were standing idle 27–52% of frames.
- **Falling trees instakill** rather than doing damage by size and speed.
- **Falling trees leave invisible walls** that accumulate until they fence the
  level in.
- **You spawn with allies in front of your blade** and kill them on arrival.

### The transitions — a repeat request, previously not delivered

> *"right now you just teleport and it's really disorientating... teleporting the
> second you kill the last enemy is insane... I already asked that you have to
> call in transport, walk to the transport, get transported out (seeing the whole
> time in the trooper carrier etc.) and then you fly and go on a journey to your
> next destination where you disembark. you should never just teleport."*

Reinforcements have the same defect — they appear beside you instead of arriving.

### Stratagems — *"turned up to 9000"*

> *"completely arbitrary... each of the stratagem attacks is a little poof of
> nothing."*

Wanted, in order: hold the comm up and **speak** — every keystroke a word; then
**aim it**, not drop it where you stand; then a **delay**; then a **ship you can
watch** come in and bomb, strafe or drop smoke. *"It needs to be deadly and
massive and substantial."*

### Front end

- The saber-line graphic was removed from the menu but **still appears on the
  boot screen**, next to the name.
- **The first loading screen has no art background** — the menu has one and the
  boot screen is bare.

### Asked for

- **Muster allied troops in any mode, on any map**, at the player's option.

---

## What the player likes — do not regress these

- The overhead attack.
- The engagement with your own troops: *"i like the engagement like it makes you
  play with your troops."*
- The outdoor levels, in contrast with the indoor ones.
