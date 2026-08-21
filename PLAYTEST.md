# Playtest log

What the player found by playing, and what came of it. Newest first.

**This file is the most valuable document in the repo.** Every one of the 64
notes that drove the original effort came from someone playing the game and
looking at it, and `HANDOFF.md` §7 exists to say so. A finding here outranks any
measurement taken without a person at the controls.

---

## 20 Aug — second play, and the flagship list

Handed over as a stream of consciousness, explicitly not in order. Logged
verbatim before any work started. Items marked **(repeat)** the player has asked
for before and did not get.

### Front end

> *"I'm going to give you an image that you're going to use for the background of
> the menu and loading screen, it will be the background for any non-in game menu
> or screen, I don't think our current one is good enough"*

> *"I'm going to give you the logo for Battlefield Borz, I hate your version...
> You will extract the logo and attractively impose it over the background image
> I've uploaded for the main menu and loading screen"*

### Transports — **(repeat, third time)**

> *"You don't start any matches coming in on a transport ship with your troops, I
> already told you that you should never just appear, ON ANY MAP, you must always
> arrive and leave via transport regardless of if you're with troops or not... You
> should be able to see the pilots too. If you're just starting a game or map from
> scratch maybe you start a game in a transport ship with your troops if you have
> any just as you're leaving the capitol ship in space like you when you start you
> look behind the ship flying through space and you see the capitol ship getting
> smaller and smaller and the planet getting larger and larger as you enter the
> atmosphere and land on your battlefield. Every mode/map should start like this"*

> *"the transports are closed at the sides, you can't see yourself or your troops
> it's completely blocked and also incredibly janky, like you don't even walk into
> the ship you touch it and teleport in I guess? you need to do a lot better. also
> the models are still pretty crude considering how good of references you have,
> also they fly backwards a lot, I don't see any engines working, a lot of troops
> have trouble getting inside, etc. Do better. Maybe like the transports land, you
> see a large ramp come out, then the side doors slide open, the troops file in,
> you can either sit or stand, should look really cool (because of the close
> quarters you would have to press the button to retract your saber, would be a
> cool time to make you actually use it), then you land, and can only disembark
> when the ramp comes back out, then the ramp retracts once the troops are out,
> the side doors close, then the ships leave. Also the ships fly straight through
> mountains a lot"*

### Combat

> *"the left click slash is better and more violent but it needs to cut
> horizontally in a wide arc (without moving your camera), obviously pressing it
> closely in succession will do like an attack sequence of some sort, maybe like
> three clicks will be two light attacks and then a heavy slash you can hold and
> release for more power idk"*

> *"the spin attack just moves your camera and is mostly ineffective in battle,
> I've already told you what this needs to be multiple times"* **(repeat)**

> *"since your stab attack also currently sucks right now I want you to merge the
> spin and the stab together, so the spin/stab will be like you hold the saber out
> in front of you and spin like a missile for a short duration in any direction you
> choose you understand? the move was done plenty of times in the prequels"*

### Force

> *"I've told you this a hundred times by now but force lightning needs to be
> fucking LIGHTNING that comes out of your hands like I need to be able to fucking
> see the lightning come out and travel to where I'm aiming like this needs to
> sound and look cool as fuck but for the millionth time it's nothing in the air
> right now like there's no VFX or anything like why do you keep fucking this
> up"* **(repeat)**

> *"have you explained anywhere in the instructions or codex how force vs force
> user combat works? I still don't know how to counter or fight against other
> force users when they are using their force powers against me like I'm just
> being manipulated and thrown around like a ragdoll being unable to do anything...
> also they need to be subject to the same force resources and limitations that
> effect me based on how strong they are"*

### Stratagems

> *"strategems should not cost force how does that even fucking make sense? maybe
> there's a bar and it shows the level of outside support and resources that have
> built up, and different strategems cost more obviously but when you use them it
> depletes your side's support resources so like carriers rearming, etc."*

> *"I like that the strategems are more deadly and impactful, one thing the smoke
> screen needs to be way bigger and more useful, it should effect your allies and
> your enemies ability to aim"*

### Bugs

> *"sometimes I see my own troops and they have light sabers and I don't know why,
> unless they are other jedi or sith that are helping you it doesn't make sense for
> a fucking droid to be holding a lightsaber"*

> *"the forest map still has a shit ton of invisible walls blocking you, I think
> maybe only when you cut trees down"* **(repeat)**

> *"troops go completely invisible a lot like I see their names above their heads
> but they're invisible, I can still throw them around though"*

> *"in skirmish mode I'll start the map will immediately say cleared and we leave
> like there were never any enemies"*

> *"in campaign mode the game completely freezes when you finish the first wave,
> never unfreezes so I don't know what's in it"*

### Wardrobe

> *"you should be able to wear different kinds of hoods that go over your head and
> look cool, there are no hoods in the game right now"*

### Allies

> *"I haven't seen any troops diving or having any dynamic movements, they should
> be smart and reactive to their own environment with self preservation, like
> diving out of the way of a grenade or picking one up and throwing it back
> (sometimes killing themselves) or diving on a grenade to save their friends if
> they're brave and selfless enough, or dragging their friends to safety, not just
> this stuff you know this stuff and more, you need to be really creative here the
> world is our oyster."*

### The Holocron, and the menu's whole look — added mid-session

> *"I've already told you a million times to completely get rid of the
> attunement star chart shit and start from scratch with something that has
> nothing to do with stars and is more in keeping with the game's aesthetic and
> I still see the same exact star chart bullshit like why have you missed this
> again and again and again get fucking rid of it and redo the whole thing, also
> make it less confusing"* **(repeat, many times)**

> *"also I want you to redo all the main menu UI to be more aesthetically sable
> like and in keeping with the new background and logo, the dark blue, light blue
> shit just doesn't work anything but the whole thing should be redone"*

### Questions asked

- *"explain to me the difference between the trail of waves and the path of the
  blade, I don't understand the difference"*
- *"remind me how you heal your allies (I've probably just missed it)"*

### What came of it

Written after the work, one line each, with the number that decided it. Both
questions above turned out to be defects rather than lapses: the two mode cards
never mentioned each other, and there was no way to heal an ally at all.

| Finding | What it was, and what happened |
|---|---|
| Menu/loading background, and the logo | The player's own art, prepared by `tools/uiart.mjs`: the plate fitted to width and cropped 39/61, the mark unpremultiplied off white to straight alpha. 127 KB and 141 KB. |
| Transports, from orbit, on every map | `ExtractionDirector.beginInsertion`. A fresh start opens in the bay leaving a capital ship; the rotate between grounds happens inside the flight. |
| Transport quality — ramp, doors, sitting, boarding | `buildTransport` publishes bay, seats, ramp, doors, engines and pilots; boarding is a walk to a seat, not a teleport, and the saber has to come down in the bay. |
| Left click: a wide arc and a combo | Two lights into a held heavy. The old left click had 0.00 m of lateral blade travel. |
| Spin and stab, merged | One steerable drill you point where you like. |
| Stratagems should not cost Force | `WarSupport`: a side's supply line, credited by kills, waves and ground held, with a rearm hold after every call. |
| Force lightning must BE lightning | `src/world/Lightning.js`. It drew nothing when it hit nothing, which is what a player tries first — the check that would have caught it fires at open ground. |
| Smoke: bigger, and it blinds both sides | 12 m → 26 m radius, six canisters, and `seeThrough` is in every body's aim. |
| Skirmish cleared instantly; campaign froze after wave 1 | A skirmish is `SKIRMISH.waves` waves now; the freeze was an auto-open racing a pending ground change. |
| Droids holding lightsabres | `weaponStyle`: a vibrosword and an electrostaff that cut exactly as a blade of the same length does. |
| The attunement star chart | Deleted. Six plates of rungs in its place, and `LivingForce` no longer carries 46 pairs of chart coordinates. |
| The whole main menu palette | Warm, off the new art. Every cool hex in the front end rotated. |
| Troops invisible with names above them | A hold was a latch: nothing but `releaseGrip` ever cleared it, so a gripper who died left a body limp, brainless and invisible for the rest of the level. It is a lease now, and `Enemy._auditVisible` asks three times a second whether a living body is drawing anything at all. |
| Forest invisible walls (repeat) | `STEP_UP` is 0.45 m and the median trunk in that wood lies 0.55 m off the ground: half the timber was a wall by ten centimetres. A felled trunk is climbable now, and its collider is the shape of the wood rather than a square beam of the butt radius. 61 of 88 stalls were logs; 3 afterwards. |
| Fighting other Force users | Every counter already existed and none was visible. A Codex section, a reserve bar and a cast readout under their name, and their regen scaled to their own pool so strength means what you can spend rather than how long you are quiet. |
| Hoods | Four, on the head bone, in the creator. One extra draw call. |
| Reactive troops | `src/game/Reactions.js`: a live grenade with a fuse, and four answers — shout, dive, throw it back, lie on it — plus dragging a hurt man out. |
| How do you heal allies? | You could not. The same channel mends the man under your reticle now, and stands him up if he is down. |
| Trial of Waves vs Path of the Blade? | The cards never mentioned each other. Both now name the axis: where your power comes from. |

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
