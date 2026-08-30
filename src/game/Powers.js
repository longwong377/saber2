/**
 * BATTLEFRONT BORZ — what every Force power costs.
 *
 * A leaf module on purpose: it imports nothing, so both the thing that SPENDS
 * the Force (src/game/Player.js) and the thing that DRAWS the price
 * (src/ui/HUD.js) can read the same twelve numbers without an import cycle.
 * HUD → Player → Menu → HUD is a real cycle in this tree, and a table that has
 * to live on one side of it is a table that gets copied to the other.
 *
 * It was copied, and it drifted: the HUD's private duplicate carried lightning
 * at 14 against a real 30 and stasis at 30 against a real 26, so the wheel
 * greyed out a power the player could afford and lit one they could not. The
 * stopgap was tools/checks/hud-events.mjs GREPPING each spend out of Player.js
 * and matching it against the copy, which holds only for as long as the regex
 * still recognises the shape of the line it is looking for.
 *
 * Every one of the twelve goes through `Player._spend`/`_canSpend`, so the
 * Force Drain slider and the `forceCost` boons apply to all of them and to the
 * same degree. Three used not to — `throwOrRecall` and `toggleSense` compared
 * raw force against a literal, and `forceLightning` applied the boon multiplier
 * by hand but not the drain — which meant Force Drain at 0, the setting whose
 * own label reads "unlimited Force", freed six powers and kept charging for
 * three.
 *
 * THAT SENTENCE WAS TRUE OF THE ONE-SHOTS AND NOT OF THE HOLDS, which is where
 * it went on being wrong for another round: five of these powers are channels
 * that bill per frame — the barrier, the grip, the stasis field, the lightning
 * and the mend all through `_spend` — and Force Sense's hold was `this.force -=
 * 22 * dt`, outside the gate entirely. See `SENSE_DRAIN` at the foot of this
 * file for what that measured. The claim above now holds for the holds too.
 */

export const POWER_COST = {
  push: 20, pull: 16, grip: 10, throw: 14, sense: 25,
  lightning: 30, stasis: 26, heal: 40, compel: 34,
  /* Rend was priced by a bare `38` inside Player.forceDisassemble and by
   * nothing here, so the HUD had no number for it and the refusal quoted a
   * literal. Same table as every other power now. */
  rend: 38,
  /**
   * THE PANIC BUTTON, and it is priced as one.
   *
   * "I want one force power that is a 360 degree 'get off me' type of ability,
   * costs a lot of force but you like yell really loud and raise both your
   * arms out and push everything around you off (like in a scenario where
   * you're being overwhelmed)."
   *
   * 52 is the most expensive thing on this table, past `heal`'s 40, and that
   * is the whole design: a power that answers "there are eleven of them and
   * they are all inside my guard" has to cost enough that it cannot be the
   * answer to "there are two". At the base pool it is most of a bar, so using
   * it means choosing not to jump, dash-recover or heal for a while after —
   * which is what makes it a decision rather than a rotation.
   */
  unleash: 52,
  /**
   * THE BARRIER, and it is priced as a THRESHOLD rather than as a cost.
   *
   * The player asked for this and then asked again, and the honest answer the
   * second time was that it had never been built: "did you already add the
   * force shield/bubble in the game? i'd already asked for it but I could have
   * missed it." They had not missed it.
   *
   * 18 is deliberately cheap to RAISE — cheaper than a push — because a shield
   * you cannot afford to put up in the moment you need it is a shield that is
   * never used. What it costs is the HOLDING (see `SHIELD_HOLD`) and, most of
   * all, what it stops: every bolt that dies on it is paid for out of the same
   * pool, so a firing line drains you at the rate it is shooting. That is the
   * decision the power is made of — a barrier is not a wall, it is a bank
   * balance between you and the volley.
   */
  shield: 18,
};

/**
 * Powers a boon has to grant before any amount of Force will buy them.
 *
 * BOTH OF THEM. This held `lightning` alone while `Player.forceCompel` also
 * refuses on `!this.boonMods.forceCompel` — so the HUD's wheel lit Domination
 * as READY for every player who had never drafted it, from the first frame of
 * a first run, and pressing it produced "not attuned". Measured on a real HUD
 * against a real Player at 500 Force: 8 of 9 slots ready, lightning correctly
 * grey, compel lit and refusing. The earliest a compel card was offered across
 * 400 simulated runs was wave 12.
 *
 * The two entries here are exactly the two gates in Player.js:
 * `grep "if (!this.boonMods." src/game/Player.js` returns those two and
 * nothing else. A third power with a boon gate must be added here in the same
 * commit, or its slot will lie in the same way.
 */
export const POWER_BOON = { lightning: 'lightning', compel: 'compel' };

/**
 * WHAT FORCE SENSE COSTS TO KEEP OPEN, a second.
 *
 * It is here, beside the twelve one-shot prices, and not typed into
 * `Player._regen`, because it was a bare `22` in one place and prose about a
 * `22` in two others: `HUD.MINIMAP`'s note on the linger ("drains 22 Force a
 * second") and the Codex row that teaches the power. That is §2.3's signature
 * defect with a number small enough to look harmless.
 *
 * IT IS ALSO THE ONE PRICE IN THIS FILE THAT USED NOT TO BE ONE. The header
 * above says every power goes through `_spend`/`_canSpend`, so the Force Drain
 * slider and the `forceCost` boons reach all of them to the same degree —
 * and Sense's hold was `this.force -= 22 * dt` in `_regen`, which is none of
 * that. Measured on a real World, holding Sense from a full bar:
 *
 *     Force Drain 1 (default)          125 → 47.4, shut itself off at 5.67 s
 *     Force Drain 0 ("unlimited")      125 → 47.4, shut itself off at 5.67 s
 *     forceCost 0.05 (Tempest, flow 1) 125 → 47.4, shut itself off at 5.67 s
 *
 * Three economies, one number: the setting whose own label in index.html reads
 * "Drain at 0 is unlimited Force" freed eleven powers and went on charging for
 * the twelfth, and the boon that makes every power cost a twentieth did
 * nothing at all here. `_spend(SENSE_DRAIN * dt, true)` is the whole fix —
 * `partial` because it is a per-frame hold and a hold takes what is left and
 * stops, which is the same shape the lightning channel and the barrier use.
 */
export const SENSE_DRAIN = 22;

/* ═══════════════════════════════════════════════════════════════════════ */
/*  THE UNBOUND TIER — a power off its leash, and what that costs          */
/* ═══════════════════════════════════════════════════════════════════════ */

/**
 * "I think it would be really cool if every force ability/power was represented
 * in the holocron (where it fits like make them be on the corresponding path)
 * such that it would really buff that ability to where it no longer has any
 * cooldown at all but at a great cost… like for example if you worked really
 * hard you could unlock it (should not be easy) but for example would allow you
 * to spam disassemble or compel as much as you wanted (at a cost) this would
 * open up cool unique playstyles."
 *
 * ── WHAT A COOLDOWN IS FOR, AND WHAT REPLACES IT ────────────────────────
 *
 * A cooldown is a rate limit the player cannot pay past — the one price in this
 * game that is not denominated in anything. Taking it away has to put something
 * in its place or the power is simply free, so each unbound power is billed
 * TWICE on every cast: a surcharge on the Force it already costs, and blood.
 *
 * The surcharge alone would not do it. Force regenerates, Tempest and Ataru cut
 * what it asks by most of itself, and Force Drain 0 is a shipped setting whose
 * own label reads "unlimited Force" — so a build exists in which the surcharge
 * is nothing, and that build would get a free power. The bleed is what cannot
 * be bought out of: it is a share of your MAXIMUM health, so it does not soften
 * as you get stronger, and nothing in the game reduces it.
 *
 * IT CAN TAKE YOU TO ONE HIT POINT AND IT CANNOT KILL YOU. That floor is a
 * decision and it is not mercy: a power that kills its owner is a power nobody
 * presses twice, so the tier would exist and never be used. At one hit point
 * the next bolt does it, which is the risk this is supposed to be — the death
 * is the fight's, not the button's.
 *
 * ── WHY THE TABLE IS HERE ───────────────────────────────────────────────
 *
 * Because it is read by four things that must not disagree: `Player` (which
 * charges the toll and skips the cooldown), `Waves.BOONS` (which turns each row
 * into a card), `LivingForce.FACETS` (which hangs each card off its current's
 * mastery) and the HUD. This module imports nothing, which is why it can be
 * seen from all four — see the header. One row per power: the axis it belongs
 * to, the mastery it hangs off, and both temple's names for it.
 *
 * `after` is the facet this one HANGS OFF in the lattice — its own technique
 * wherever the lattice already has one (the throw hangs off Cleaving Throw, the
 * lightning off Force Lightning, Disassemble off Dissolution) and its current's
 * mastery where it does not. That is the join and it is not the gate: what
 * makes one hard to reach is `rarity: 'epic'`, `minWave` deeper than any
 * mastery, and four cards of its own axis — see the note in Waves.js, which
 * measured what happened when the gate was the mastery instead.
 */
export const UNLEASH_TOLL = {
  /** What the power costs on top of its list price, as a share of it. */
  force: 1.5,
  /** …and what it costs in blood, as a share of MAXIMUM health. */
  bleed: 0.06,
  /** The floor. See above: it maims, it does not kill. */
  floor: 1,
  /** How deep in a run the tier opens at all. */
  minWave: 16,
};

/** `unbound-push` and so on — the id a boon, a facet and a save all share. */
export const unboundId = (key) => `unbound-${key}`;

/**
 * Ten powers, and the two that are missing are missing for a reason that is
 * worth saying out loud rather than leaving as a gap: `grip` and `sense` HAVE
 * no cooldown. The grip is a channel billed per frame and Force Sense is a
 * toggle billed per second, so there is nothing here for this tier to remove —
 * an "unbound" card for either would be a card that does nothing, which is the
 * one defect this codebase keeps deleting.
 */
export const UNBOUND = [
  { key: 'push', axis: 'force', after: 'repulse', icon: '🌊',
    name: 'The Endless Wave', tag: 'Unbound — Push',
    jedi: 'The Endless Wave', sith: 'The Hand That Never Closes',
    text: 'The shove no longer needs a breath between. It asks half again as much Force and a little of your blood each time.' },
  { key: 'pull', axis: 'force', after: 'conduit', icon: '🪝',
    name: 'The Tide That Answers', tag: 'Unbound — Pull',
    jedi: 'The Tide That Answers', sith: 'Everything Comes To Me',
    text: 'Reach again the instant you have reached. Half again the Force, and blood.' },
  { key: 'stasis', axis: 'force', after: 'tempest', icon: '🧊',
    name: 'The Held Hour', tag: 'Unbound — Stasis',
    jedi: 'The Held Hour', sith: 'Time Is Mine To Keep',
    text: 'Hold one, then the next, then the next, with nothing in between but what it costs you.' },
  { key: 'rend', axis: 'force', after: 'detonate', icon: '🔩',
    name: 'The Unmaking', tag: 'Unbound — Disassemble',
    jedi: 'The Unmaking', sith: 'Take It All Apart',
    text: 'Take them apart as fast as you can look at them. Half again the Force, and blood for every one.' },
  { key: 'throw', axis: 'blade', after: 'saberthrow', icon: '🌀',
    name: 'The Blade That Returns', tag: 'Unbound — Throw',
    jedi: 'The Blade That Returns', sith: 'The Blade That Does Not Wait',
    text: 'It is back in your hand and gone again. No recovery, at half again the Force and a cut of your own.' },
  { key: 'shield', axis: 'guard', after: 'aegis', icon: '🔆',
    name: 'The Standing Ward', tag: 'Unbound — Barrier',
    jedi: 'The Standing Ward', sith: 'The Wall That Never Falls',
    text: 'Drop the barrier and raise it in the same breath. What it saves you it takes back in Force and blood.' },
  { key: 'unleash', axis: 'body', after: 'undying', icon: '💥',
    name: 'The Cry Unending', tag: 'Unbound — Unleash',
    jedi: 'The Cry Unending', sith: 'The Roar That Does Not Stop',
    text: 'The nine-second silence after the cry is gone. Everything else about it costs more.' },
  { key: 'heal', axis: 'bond', after: 'triage', icon: '➕',
    name: 'The Well That Does Not Empty', tag: 'Unbound — Mend',
    jedi: 'The Well That Does Not Empty', sith: 'Bleed For Them',
    text: 'Mend one man and turn straight to the next. The Force asks half again, and you pay the rest yourself.' },
  { key: 'lightning', axis: 'dark', after: 'lightning', icon: '⚡',
    name: 'The Storm Refused No Longer', tag: 'Unbound — Lightning',
    jedi: 'The Storm Refused No Longer', sith: 'The Endless Storm',
    text: 'It does not stop coming. Half again the Force, and the storm earths itself through you.' },
  { key: 'compel', axis: 'dark', after: 'compel', icon: '🕯',
    name: 'Every Word Unforgivable', tag: 'Unbound — Compel',
    jedi: 'Every Word Unforgivable', sith: 'None May Refuse',
    text: 'Say it again, and again, to whoever is left. Half again the Force, and a piece of you each time.' },
];

/** The row for a power, or null — the one lookup, so nothing greps the list. */
export function unboundOf(key) { return UNBOUND.find((u) => u.key === key) || null; }
