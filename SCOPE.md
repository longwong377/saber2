# What this game could be

Four independent researchers were sent out with a description of this engine and
no access to the source. Two hundred searches each, across squad-command games,
roguelite structure, systemic and immersive-sim design, and the whole history of
Star Wars games. What follows is what came back, filtered and ordered by me.

Everything here is a proposal. Nothing in it is built.

---

## The finding all four made independently

**A demigod protagonist poisons squad attachment, and this game is currently
built to fail that way.**

The research literature is blunt about it: players become attached to AI
characters *after* experiencing them as functional and useful, and they value a
character's utility over their emotional content. A name, a serial and a
nickname are labels *on* attachment — they do not create it.

The documented failure case is Bannerlord, where companions are named characters
with written backstories that players openly call useless, because the player
character is simply better at everything, so the game "encourages you to spam
trash". A Jedi with eleven Force powers is better than every trooper at
everything. Persisting the company does not fix that. It makes it worse, because
now the useless men are *permanent*.

**The fix is structural, not sentimental: make troopers irreplaceable by
capability.**

- A stratagem requires a living named trooper with line of sight to the target.
  Lose the man who spots, lose orbital support until someone else is trained.
- Emplacements need crew. Blast doors need someone holding them. Transports need
  a driver.
- Command range is gated on your body. Orders reach men near you and no further.

This is the highest-leverage change available, because it converts attachment
from a feeling into a capability loss. Everything else in this document is
downstream of it.

---

## Five that would change what this game is

### 1. The Force hits your own men

Unleash is a 360° panic shove. Fired in the middle of your own line it should
ragdoll your men into terrain and each other, with real injuries. Lightning
should arc — through standing water in the drowned forest, between men in
contact armour. A *poor* deflection — the grade already exists in the code —
should have a real chance of putting the bolt into the trooper standing behind
you, where a good one returns it to the enemy.

Arrowhead's position on Helldivers is the argument: friendly fire is about
believability, and "if we turned off friendly fire we would have to turn off
bullet damage against enemies as well". The evidence it works: 177 million of
Helldivers 2's 8.6 billion deaths were friendly fire.

Nobody has this in a game where the friendly you kill has a name and a rank and
does not come back. It makes where your line stands a second-by-second combat
decision, and it makes your deflection skill a moral fact rather than a stat.

### 2. The men refuse

Close Combat (1996) hired a psychiatrist to build a per-soldier **anxiety index**
from tiredness, preparedness, experience and past success. Units "would simply
not obey bad orders, like advancing across open ground against a dug in enemy" —
they went to cover, retreated, or quit the battle.

Thirty years old. Never copied into an action game. It needs exactly what this
game already has: named men, ranks, squads, morale, and a presence aura.

A formation order stops being a command and becomes a *request*, rolled against
that value. Your physical presence is what buys compliance. Command bandwidth
becomes literal: a demigod who cannot make anyone do anything unless he is
standing there.

The caveat from the research is real — players hate losing agency, and Close
Combat only got away with it because refusal was always a correct tactical
judgement and always legible. Every refusal needs a visible reason.

### 3. The ground remembers between runs

The crater log is run-scoped. Making it campaign-scoped is, as far as four
researchers could find, **something no shipped game has done**. Red Faction
Guerrilla persisted damage but had no army; Foxhole has player-built earthworks
but no terrain memory of this kind; Noita simulates every pixel and throws it
away at the end of the run.

What falls out for free once battlefield 3 of 7 remembers every crater:

- Veterans fight in ruins of their own making.
- Cover degrades permanently, so late-campaign maps get more lethal without a
  single number changing.
- The memorial can point at the exact hole where a man died.
- **Graves in the terrain** — a marker at the true world coordinate where each
  man of the company fell, present in later runs, with the surviving squad's
  morale reacting when they walk past it. Nobody has persisted the geography of
  your own losses.

One warning attached, and it is the important one. *Fracture* (2008) made
terrain deformation its entire pitch and failed on exactly this: the AI ignored
the sculpted terrain and charged anyway. **Player-authored ground is worthless
unless the squad AI garrisons it.** An eighth formation order — *Dig In*, which
sends a squad to the nearest player-made depression — is the thing that makes
the whole system real.

### 4. The run has no shape — it has a counter

Three structural absences, in order of damage:

**No route choice.** Every roguelike that survives thirty runs has a
pre-commitment layer where the player picks their own risk curve with partial
information. FTL's core decision is whether to take the dense, dangerous path for
more salvage or the guaranteed exit. Command is already a five-area campaign —
it is 90% of a branching map and it does not branch. Node types visible before
you commit, contents unknown: assault, hold, column, cache, duel, holocron,
evac window.

**No randomised offer at the holocron.** 46 fixed nodes with fixed adjacency and
fixed income is a solved build order by run ten. Skill trees converge — that is
their job, and it is the wrong tool here. Keep all 46 nodes and all the
adjacency rules; change only the *offer*. Kneeling shows **three of the
currently-legal nodes**. Insight buys one. Rerolls cost. Zero new content, and
the lattice stops being a checklist.

And make roughly eight of the 46 change *rules* rather than numbers — Balatro's
actual lesson. *Force push ragdolls allies too. Your saber no longer deflects, it
absorbs and stores. Shattering a prop refunds Insight.*

**No player-authored difficulty.** Not Easy/Normal/Hard. Hades' Pact of
Punishment: fourteen modifiers, each with ranks, and you choose which axes get
harder. Then tie Insight income to the total, which fixes the flat 1-per-wave
drip in the same stroke.

### 5. Umbara — the order you can check

Season 4, episodes 7–10 of the 2008 show. A Jedi general spends the 501st in
reckless frontal assaults and then convinces two clone squadrons that the other
is disguised enemy, and orders them to shoot each other. The clones mutiny and
execute a Jedi.

**Zero adaptations. Nothing in games has touched an order you should refuse.**

The mechanism: High Command issues an artillery stratagem with a designated
impact ellipse. Sense-through-walls will show you what is inside that ellipse,
including friendly IFF. Obeying immediately is faster and rewarded. Verifying
costs twelve seconds under fire. Sometimes the ellipse contains your own men, and
the game never tells you — it only lets you look.

The dead stay dead. If you refuse, High Command cuts your stratagem budget for
the rest of the campaign.

TIE Fighter had the precedent — secret orders from a hooded messenger that
sometimes conflicted with your actual mission orders — and nobody has repeated
it in thirty years.

---

## Moments the systems would produce

These are not scripted set pieces. Each one is a consequence of systems above.

**The general leaves the line.** Morale radiates from your body and order range
is gated by distance and line of sight. Your left flank is wavering, your centre
is winning *because you are standing in it*, and the only fix is to physically
sprint two hundred metres and let the centre wobble. Nothing is authored. The
set piece is you running across your own battle while both ends degrade behind
you. This one mechanic justifies the entire premise.

**Squadmates grab the man you are gripping.** A thin active-ragdoll layer: a
gripped body reaches for the nearest collider within arm's length and forms a
joint with a break force. A squadmate within reach grabs *him* — so a grip on one
man drags two, and the Force contest resolves against their combined mass. This
is the Ico bond expressed purely as physics, with no dialogue. The Force
Unleashed's Euphoria did the self-preservation half in 2008 and the industry
abandoned it because it was proprietary and expensive; a single joint with a
break force is cheap in Rapier.

**Contested telekinesis.** Two Force users gripping the same rigid body as a
shared constraint: each spends pool per second to bias the target transform and
the object physically shudders between them. Break his guard first — the cap
collapses to a third, which is already in the code — and he loses the object
*and* it is now a projectile with his name on it. In Psi-Ops, Half-Life 2, The
Force Unleashed and Control, exactly one entity owns an object at a time. **Two-
party contested grip does not exist in any game.**

**Drag.** Wounded are a decision, never an automation. Two men must leave the
firing line to carry one, which lowers your volume of fire, which raises
pressure, which produces more wounded. The peak is the last ten metres to the
transport: the drag team backing up, the Jedi walking backwards behind them
deflecting everything, and heal competing with push for the same Force.

**The duel with an audience.** A blade lock against a Sith is not a cutscene
because your troops can see it. Men within sight of a duel you are winning gain
morale; men watching you lose one lose it. Break the lock with a push and the
shockwave knocks down troopers *of both sides* — the crowd is inside the physics.
Fighting in the middle of your line is tactically different from fighting behind
a rock.

**Shinies.** Canon, and no game has mechanised it: Jedi Generals *allowed* the
clones to paint their armour, and unpainted rookies are called shinies. Make the
rank repaint an act the player performs at camp, not an automatic unlock. Free
consequence: you can read your army's veterancy across a battlefield at a
glance — which means **you can watch your army get younger over a losing
campaign, with no UI element at all.**

**The name that earned itself.** Canon says clone nicknames come from "a habit, a
skill, a moment in battle". So do not roll them at spawn. Award them from a
logged event and print the sentence that earned it. The man who survived being
buried in your own crater becomes Digger. You read "Digger, KIA" and you remember
why he was called that.

**Force sense as retrocognition.** Hold sense over ground and the crater log plus
the event log replay a frozen tableau of what happened there — whose body fell,
the vector the shot came from, what cut this trench. Obra Dinn's structure, on
data this game already stores. Both systems exist; the wire between them does
not.

---

## Cheap, and worth doing regardless

- **Command verbs that are missing:** Hold Fire / Fire At Will (with deflection
  in play, this is a physics problem and a one-key fix). Fall Back To Me, where
  the rally point is your body. Suppress That / **Ignore That** — a negative
  order is the cheapest way to make an order feel like judgement. **Delegate** a
  squad to its sergeant, with rank determining how well he does it — non-
  negotiable in a game where the player is in a blade lock.
- **Republic Commando's one contextual key.** Orders lived in the world, not in a
  menu: crosshair on a door means breach, on a console means slice. Praised
  specifically for being usable mid-combat. This should be the primary interface;
  the seven formations become the secondary menu.
- **Bank on the ramp / partial extraction.** Send named men up individually while
  you keep fighting. The decision stops being "do I survive" and becomes *which
  men do I spend this window on*.
- **Downed ≠ dead.** A bleed-out window; an enemy reaching the body finishes it;
  Heal is what saves him. That is the interruption that makes you break off a
  duel — the best kind.
- **Bonding, ported directly from XCOM 2.** Soldiers bond when one rescues an
  unconscious mate, or when more than half the squad dies and they survive it
  together. A bonded pair gets a small benefit, and when one goes down the other
  charges *whether you ordered it or not*. Behaviour you do not control,
  generated by a relationship you did not author.
- **Somebody holds the door.** Darkest Dungeon's rule made physical: extracting
  under contact costs one man on the ramp. Let the highest-morale trooper
  volunteer and be named in the after-action log.

---

## Three warnings from the research

**1. Real-time permadeath is the thing XCOM's designer said does not work.**
Jake Solomon's stated reason XCOM is turn-based: with permadeath fundamentally
important, real-time "would never work, because you'd always blame the AI even if
it wasn't responsible". This game is building the thing he said fails.

The mitigations are all cheap and all necessary: an after-action report naming
who killed whom, from what direction, at what wave, so no death is mysterious;
visible self-preservation behaviour so troopers are *seen* trying; a one-key Fall
Back To Me so any death is attributable to a decision the player could have made;
and the downed-not-dead window so the last word is always the player's.

**2. Do not give veteran troopers stat bonuses.** This is the Rogue Legacy trap.
If a veteran is 40% tankier than a fresh trooper, waves must be tuned for one of
the two and the other feels wrong, permanently. Rank should change **what a
trooper can be ordered to do** — a Sergeant accepts a standing order, a Corporal
does not — and survival should earn two-sided traits, not numbers.

**3. Blocking economics, before anything else in the duel system.** The clearest
cautionary tale in Star Wars game history is Jedi Academy's 1.02 → 1.04 patch
war: blocking was tuned up, kills collapsed into spam, Force powers became
useless because everything got blocked, and players still deliberately downgrade
to the old version twenty years later. The fix already exists and is free —
Movie Battles II's block-point economy, where every block costs the blocker a
visible resource. Twenty years of unpaid balance work is sitting there.

Also worth knowing: **the Nemesis system is patented to 2036** and has appeared
in exactly one game in nine years. The patent covers hierarchies of *adversary*
NPCs. A remembering, grudge-holding hierarchy of *friendly* named soldiers is
plausibly outside the claims — but that is a lawyer's call, not mine.

---

## One piece of timing

**Star Wars: Zero Company** (Bit Reactor + Respawn) ships **27 August 2026** —
turn-based Clone Wars tactics, squads of four, operatives that can be lost for
good. It is the first Star Wars strategy game since Empire at War in 2006.

It is turn-based, it is led by a human ex-officer rather than a Jedi, and clones
arrive late as a reward. **The gap it leaves open is exactly this game**:
real-time, physical presence, and a Jedi whose body *is* the morale system.

Worth playing before committing to anything here.
