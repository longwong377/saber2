/**
 * BATTLEFRONT BORZ — MUSTER: AN ARMY IS A SETTING, NOT A MODE.
 *
 * The player's words: "I should be able to choose to spawn in allied troops on
 * any map in any mode if I so wish."
 *
 * They could not. `World.loadLevel` read three mode names —
 *
 *     const leadsArmy = mode === 'command' || battles;
 *
 * — so the whole of `src/game/Command.js` (a roster with names on it, five
 * ranks, permadeath, morale, seven formations, the muster, the orders and the
 * HUD feed) was reachable from three of eight modes, and from ONE ground,
 * because `MODES.command.level` pins Command to Geonosis. Five modes and eight
 * theatres could not field a single ally by any route a player has.
 *
 * WHAT THIS IS AND WHAT IT IS NOT. It is a wiring change with one honest new
 * idea in it: `CommandDirector.campaign`. A contingent is the same director
 * with the five-area CROSSING switched off, because the crossing is what would
 * break every mode it was dropped into — `_areaClear` opens a screen, recalls
 * the line onto gunships and, five areas in, calls `_endCampaign`, which fires
 * `onGameOver` with a VICTORY. In the Trial of Waves that ends an endless mode
 * on wave 21 and calls it a win.
 *
 * It is NOT a second army system, a second wave composer or a second muster.
 * There is one of each and this file's job is to hold the seam to that: the
 * checks below drive the shipped `World`, the shipped `commandConfig`, the
 * shipped `canHarm` and the shipped `budgetFor`, and every one of them fails on
 * the tree it was written against.
 *
 * ── THE THREE GAPS THIS FILE NAMED, AND WHAT CLOSING THEM MEASURED ──────
 *
 * The audit that read this header called the feature "wired everywhere and
 * thin" and quoted three gaps out of it. All three are closed and each has a
 * check below that measures it rather than asserting it was done. What follows
 * is the before number, the after number, and — for the third — the correction,
 * because one of the three gaps was described with the right number and the
 * wrong mechanism.
 *
 * 1. THE PLAYER COULD NOT COMPOSE THE CONTINGENT. Driven on `waves`/`scoria`
 *    with eight allies asked: `{"trooper": 8}`, a purse of 0, `musterOffer`
 *    selling `trooper` and `heavy` and nothing else, and `recruit('arc')`
 *    answering "ARC Trooper is not available until area 3 of the advance" in a
 *    mode that has no advance. `rung.at` is an AREA gate and `areaNumber` is 1
 *    forever without one, so five of seven rungs were structurally unreachable.
 *    Now: `unlockAt` states that gate once and answers it differently for a
 *    contingent, the whole shelf is offered (7 rungs), and the slider is a
 *    PURSE — `opening × musterCost(cheapest)` — spent on the rung the player
 *    chose. Ten Republic allies is 50 points and buys ten troopers, or eight
 *    heavies, or four ARCs, or one AT-TE and three men to walk beside it.
 *    See `allyUnit` and `Command._musterOpening`.
 *
 * 2. THE ARMY WAS ALWAYS THE ONE YOUR ORDER NAMED. Measured on all seven
 *    grounds under all three orders — 21 worlds — the answer was the order's,
 *    every time, and a Grey got the Republic on all seven from a hard-coded
 *    `|| 'republic'`. This header proposed drawing allies from the LEVEL's own
 *    pool; the pools were then counted and they cannot answer, because every
 *    one of the seven names bodies from BOTH armies and only Geonosis declares
 *    `armies` at all. So the rule is the player's, with the order as the
 *    default and the ground as the tiebreak for a commander who leads neither —
 *    `Command.armyToLead`, argued in full there.
 *
 *    AND THE GAP HAD A LIVE BUG UNDER IT. `CommandDirector.unlockedAt` filtered
 *    the enemy fill by the seven types on the muster LADDER instead of by
 *    faction, and `sideFor()` returns null in this class, so the base director's
 *    faction rule was switched off with nothing behind it. Driven, twenty waves
 *    on each of the seven grounds:
 *
 *        allies 0 · sith    0 of the player's own bodies fielded against them
 *        allies 6 · sith   10 — acolyte on five grounds, walker on three,
 *                               dwarfspider and hailfire on Geonosis
 *
 *    Turning allies on was what broke it: note 1.2's defect, reintroduced by
 *    the feature this file is about, on six of seven grounds, for one of the
 *    two orders. 10 → 0.
 *
 * 3. SMALL GROUND SILENTLY DROPPED MEN — right that something was wrong, wrong
 *    about what. This header said four allies on the Colosseum "put TWO on the
 *    field" because `spawnClear` refused the rest. Driven again: `deploy()`
 *    returns 4, four bodies stand up, and at twenty-two seconds two are dead
 *    with `roster.fallen` naming both — killed by the duel's acolyte. The count
 *    was read off a live fight. `deploy` never called `spawnClear` at all.
 *
 *    The real defect is quieter and worse. Measured over the seven grounds, a
 *    24-body contingent from eight anchors each, 1,344 placements tested against
 *    the level's own colliders and water: 67 landed on ground `spawnClear`
 *    refuses — 8.3% on the Colosseum and on scoria, 7.3% in the Wood's
 *    channels, 5.0% overall. One trooper in twenty arrived inside a rock, a
 *    wall, a wreck or a stream, and nothing said so. Now: `_standingRoom`
 *    widens the ring and re-jitters the angle up to six times, 67 → 0, and the
 *    one placement in 1,344 it still cannot make is REFUSED OUT LOUD, the way
 *    `reinforce` has refused since it was written.
 *
 * ── WHAT A FULL VERSION WOULD STILL NEED, and neither is wired here ──────
 *
 * THE SCORE LADDER DOES NOT KNOW. `allyScale` prices the wave against the army
 *   standing in it (×1.53 at ten), which is what stops allies trivialising a
 *   mode — but the wave-clear payout is a flat `500 × wave` and the Insight is
 *   one per clear in every mode, so a led run banks both FASTER simply by
 *   clearing faster. `Progress.recordRun` does not record the contingent size,
 *   so a solo run and a ten-man run sit on one ladder and cannot be told apart.
 *   Deciding whether they should is the design question this lane did not have
 *   the standing to answer.
 *
 * CO-OP IS UNDRIVEN. `_netShell`, `publishMuster` and the roster wire were all
 *   built for a campaign's muster screen. A contingent raises no screen, so
 *   there is nothing obvious to break — but nothing here has driven a host and
 *   a client through a wave run with allies, and that is a gap and not a claim.
 */
import { clocked } from './_shared.mjs';

const DT = 1 / 30;

/** The fields a director reads when there is no World to read them off. Two of
 *  the checks below are about arithmetic — a budget and a purse — and building a
 *  level to ask them would be four seconds and a heightfield for a multiply. */
const bench = () => ({ settings: {}, enemies: [], players: [], notify() {}, report() {},
  physics: { staticBoxes: [], bodies: [] } });

async function world(mode, level, settings = {}) {
  const { stubEngine } = await import('./_coop.mjs');
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../../src/game/Combat.js');
  await initPhysics();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', mode, ...settings };
  const w = new World(await stubEngine(), s);
  w.runSeed = 20260820;
  w.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
  await w.loadLevel(level);
  const p = w.spawnPlayer({ name: 'Jedi', isLocal: true });
  return { w, p };
}

export async function run({ check, assert }) {
  check = await clocked(check);

  await check('the size of your army is a number the player writes', async () => {
    const { commandConfig, MAX_STRENGTH } = await import('../../src/game/Command.js');
    assert(commandConfig({}).contingent === 0, 'a mode with no ally setting fielded an army');
    assert(commandConfig({ allies: 6 }).contingent === 6, 'six allies did not survive the read');
    assert(commandConfig({ allies: 999 }).contingent === MAX_STRENGTH,
      `999 allies came back as ${commandConfig({ allies: 999 }).contingent}`);
    assert(commandConfig({ allies: -4 }).contingent === 0, 'a negative army');
    return `0 default · 6 · clamped to ${MAX_STRENGTH} · never below 0`;
  });

  /**
   * THE WHOLE FEATURE, DRIVEN: a ground Command has never been fought on, in a
   * mode that has never had a second side, with the faction rules holding.
   *
   * `waves` on `scoria` is the pair on purpose — `MODES.command.level` is
   * `geonosis` and `MODES.waves` has no army at all, so before this change
   * neither half of this world could exist.
   */
  await check('muster: a purse buys a replacement or a promotion, and the promotion is still earned', async () => {
    /**
     * PLAN.md §4.4: "Make it a decision at the Company screen: **replacements,
     * or promote a survivor, or bank the purse.**"
     *
     * Two of the three already worked and one did not. `recruit` buys
     * replacements; BANKING is what closing a muster without spending has
     * always done, because the purse is never cleared and points survive to the
     * next ground. Promoting a survivor was the missing option, and its absence
     * is most visible exactly where the decision matters most: at
     * `MAX_STRENGTH` every card on the shelf is priced out and a full line had
     * a purse with nowhere to go.
     *
     * ── WHAT THIS ASSERTS, AND WHY THE PRICE IS THE INTERESTING PART ────────
     *
     * A commendation must not be a second way to hold a rank. A rank in this
     * mode is `xp` crossing a gate in `RANKS`, and `Trooper.award` is the one
     * door every promotion in the game comes through — so this drives the
     * purchase and requires that the MAN'S EXPERIENCE moved, that his rank only
     * moved if the experience carried him over his own gate, and that a man
     * already at the top of the ladder is refused rather than charged.
     *
     * And the price is derived, not chosen: holding an area awards
     * `XP_PER_AREA` and pays `area.muster`, so a commendation costs what the
     * ground that would have earned it pays. That is asserted as an IDENTITY
     * against the two constants, which is what stops it becoming a second table
     * — the landing zone pays 11 and must charge 6; the Core Ship pays 30 and
     * must charge 15.
     */
    const C = await import('../../src/game/Command.js');
    const { bootWorld } = await import('./_coop.mjs');
    const { world: w } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', quality: 'low' },
      runSeed: 41,
    });
    const d = w.command;
    d.start(1);
    const c = d.commander;
    assert(c.roster.living.length >= 3, `the fixture mustered ${c.roster.living.length} men`);

    /* ── 1. the price IS the rate, at every rung THIS RUN WALKS ──────────────
     *
     * `d.area` and not `AREAS[i]`: `stages` is the ROUTE, and §4.6's branching
     * route means a run of three engagements walks rungs 0, 2 and 4 rather than
     * 0, 1 and 2. Reading the table by index priced the ground the run is not
     * standing on — which is how this arm first failed, at "The Open Plain
     * costs 9 against a muster of 14" when the director was in fact on the
     * Hailfire Line and its 17. The price has to track the ground you are on,
     * so the assertion asks the director where that is. */
    const seen = [];
    for (let i = 0; i < d.stages.length; i++) {
      d.areaIndex = i;
      const A = d.area;
      const want = Math.max(1, Math.ceil(A.muster / C.XP_PER_AREA));
      assert(d.commendCost() === want,
        `at ${A.name} a commendation costs ${d.commendCost()} against a muster of ${A.muster} and `
        + `${C.XP_PER_AREA} xp for holding it — the price has become a second table and will `
        + 'drift from the thing that earns it');
      seen.push(`${A.muster}→${want}`);
    }
    assert(seen.length >= 2, `the route has ${seen.length} rung(s) — nothing to compare`);
    d.areaIndex = 0;
    const cost = d.commendCost();

    /* ── 2. it is REFUSED with no purse, and nothing moves ───────────────── */
    const man = c.roster.living[0];
    c.roster.points = 0;
    const xp0 = man.xp;
    assert(d.commend(man.name, c) === null && /points needed/.test(d.refused || ''),
      `a commendation with an empty purse was not refused: ${d.refused}`);
    assert(man.xp === xp0, 'a refused commendation still awarded experience');

    /* ── 3. bought, the experience lands and the purse pays for it ───────── */
    c.roster.points = cost * 3;
    const purse0 = c.roster.points;
    d.mustering = true;
    assert(d.commend(man.name, c), `a funded commendation was refused: ${d.refused}`);
    assert(man.xp === xp0 + C.XP_PER_WAVE,
      `experience went ${xp0} → ${man.xp}, not by ${C.XP_PER_WAVE}`);
    assert(c.roster.points === purse0 - cost,
      `the purse went ${purse0} → ${c.roster.points} for a ${cost}-point commendation`);
    assert(d.log.some((e) => e.t === 'commend' && e.name === man.name),
      'the commendation is not on the log, so the report is about a different run');

    /* ── 4. AND THE RANK IS STILL EARNED. Buy up to the gate and the promotion
     * arrives through `award`, exactly as fighting delivers it; one short of the
     * gate and it does not. */
    const gate = C.RANKS[man.rank + 1].xp;
    const short = gate - man.xp - C.XP_PER_WAVE;
    assert(short >= 0, `the fixture's man is already past his gate (${man.xp} of ${gate})`);
    const rankBefore = man.rank;
    c.roster.points = cost * (short + 2);
    for (let i = 0; i < short; i++) d.commend(man.name, c);
    assert(man.rank === rankBefore,
      `${man.name} was promoted at ${man.xp} xp against a gate of ${gate} — a commendation is `
      + 'writing a rank instead of paying experience into the gate that decides it');
    const rose = d.commend(man.name, c);
    assert(man.rank === rankBefore + 1 && rose && rose.title,
      `${man.name} crossed ${gate} xp at rank ${man.rank} and no promotion came back`);

    /* ── 5. …and the top of the ladder is shown and refused, not charged ─── */
    const top = c.roster.living[1];
    top.xp = C.RANKS[C.RANKS.length - 1].xp;
    const before = c.roster.points;
    assert(d.commend(top.name, c) === null && /already holds/.test(d.refused || ''),
      `a man at the top of the ladder was not refused: ${d.refused}`);
    assert(c.roster.points === before, 'a refused commendation still took the points');

    /* ── 6. and the offer carries what the card needs, and nothing more ──── */
    const o = d.musterOffer(c);
    assert(o.commend && o.commend.cost === d.commendCost(), 'the offer does not price a commendation');
    const row = o.commend.men.find((m) => m.name === top.name);
    assert(row && row.to === null && row.afford === false,
      'the offer offers a man who has nothing above him');
    w.unload();
    return `price = muster/${C.XP_PER_AREA} at every rung this route walks (${seen.join(' ')}); `
      + `refused with no purse; ${xp0} xp → the gate at ${gate} promoted through award(); `
      + 'the top of the ladder shown and refused';
  });

  await check('allies deploy in a mode and on a ground that never had them', async () => {
    const { canHarm } = await import('../../src/game/Player.js');
    const { idleInput } = await import('./_coop.mjs');
    const { w, p } = await world('waves', 'scoria', { allies: 6 });
    try {
      assert(w.command, 'the Trial of Waves still refuses to lead an army');
      assert(w.command.campaign === false, 'a contingent was handed the Geonosis crossing');
      /* THE MUSTER, BEFORE THE BATTLE TOUCHES IT. `strength` is the LIVING
       * count, and twenty-two seconds of a real wave will take some of them —
       * that is the mode working, not the muster failing. So the six are
       * counted here, and what the window is asked for is bodies on the field
       * and a roll that still adds up. */
      assert(w.command.roster.strength === 6,
        `the muster enlisted ${w.command.roster.strength} of the 6 asked for`);
      w.director.start(1);
      for (let i = 0; i < 22 * 30; i++) w.update(DT, idleInput());
      const troops = w.enemies.filter((e) => e.trooper && !e.dead);
      const foes = w.enemies.filter((e) => !e.trooper && !e.dead);
      /* THE ROSTER is what the muster produced; the BODIES are what is still
       * standing twenty-two seconds into a real wave, and holding a live count
       * to six would be a check on how the fight went. */
      const roll = w.command.roster.living.length + w.command.roster.fallen.length;
      assert(roll === 6, `the roll came to ${roll} names, living and dead, out of 6 mustered`);
      assert(troops.length >= 1, 'no ally reached the field at all');
      assert(foes.length >= 1, 'nothing hostile was composed — the mode lost its own wave');
      /* THE FACTION RULES, THROUGH THE SHIPPED FUNCTION. Two sides on a level
       * that has only ever had one is exactly where `sideFor`/`canHarm` would
       * be expected to have an opinion, so they are asked rather than trusted. */
      assert(troops.every((e) => e.team === p.team), 'an ally deployed onto the horde’s team');
      assert(troops.every((e) => !canHarm(p, e)), 'the player can cut down their own troops for free');
      assert(foes.every((f) => canHarm(f, troops[0])), 'the horde cannot touch the line');
      assert(troops.every((e) => canHarm(e, foes[0])), 'the line cannot touch the horde');
      return `6 enlisted, ${troops.length} standing against `
        + `${foes.length} hostiles on the Ember Shelf, teams ${p.team} v ${foes[0].team}`;
    } finally { w.dispose?.(); }
  });

  await check('…and the mode it is dropped into is still that mode', async () => {
    const { w } = await world('waves', 'scoria', { allies: 6 });
    try {
      const d = w.director;
      d.start(1);
      /* FORTY WAVES PAID, which is past the whole five-area crossing (3+4+4+5+5
       * = 21). A campaign ends there; the Trial of Waves does not end at all. */
      for (let i = 0; i < 40; i++) { d.wave = i + 1; d.payWave(i + 1); }
      assert(!d.done, 'an endless mode declared victory after the fifth area');
      assert(!d.mustering, 'a muster screen opened in a mode that has no muster');
      assert(d.areaIndex === 0, `the area ladder advanced to ${d.areaIndex} in a mode with no areas`);
      assert(!w.over, 'the run was ended by the army rather than by the player');
      return `40 waves paid · area ${d.areaIndex} · done ${d.done} · muster ${d.mustering}`;
    } finally { w.dispose?.(); }
  });

  /**
   * THE PAYOUT QUESTION, and it is answered by a term that already existed.
   *
   * "Do allies dilute the score?" — they cost, and `allyScale` is where. It is
   * deliberately NOT conditional on the campaign: a wave is priced against the
   * army standing in it wherever that army came from, so a player who brings
   * ten men to the Trial of Waves meets a wave composed for eleven.
   */
  await check('the wave is priced against the army, in every mode', async () => {
    const { CommandDirector, MAX_STRENGTH } = await import('../../src/game/Command.js');
    const { WaveDirector } = await import('../../src/game/Waves.js');
    const bare = new WaveDirector(bench(), { mode: 'waves', seed: 1 });
    const d = new CommandDirector(bench(), { mode: 'waves', seed: 1, campaign: false, strength: 10 });
    const alone = bare.budgetFor(8), led = d.budgetFor(8);
    assert(led > alone * 1.3, `ten allies moved a wave-8 budget from ${alone} to ${led}`);
    assert(d.allyScale() <= 2.6, 'the ally multiplier is uncapped');
    assert(d.opening === 10 && d.opening <= MAX_STRENGTH, `opening strength read ${d.opening}`);
    return `wave 8: alone ${alone}, with ten allies ${led} (×${(led / alone).toFixed(2)})`;
  });

  /**
   * WIPE. The run ends when the PLAYER dies, and not when the army does —
   * `World._checkWipe` has always said so ("every player on this field is down")
   * and nothing here changes it, which is the point of asserting it: a
   * contingent is not a second life and losing it is not a defeat.
   */
  await check('the run ends when you die, not when your line does', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const { w, p } = await world('waves', 'scoria', { allies: 6 });
    try {
      w.director.start(1);
      for (let i = 0; i < 20 * 30; i++) w.update(DT, idleInput());
      for (const e of w.enemies) if (e.trooper) { e.dead = true; e.hp = 0; }
      for (const t of w.command.roster.living.slice()) t.alive = false;
      w.update(DT, idleInput());
      assert(!w.over, 'losing the whole line ended the run');
      p.alive = false; p.hp = 0;
      w.onPlayerDeath(p, null);                  // the shipped door, not a flag
      for (let i = 0; i < 12; i++) w.update(DT, idleInput());
      assert(w.over, 'the run did not end when the player did');
      return 'army wiped: run continues · player down: run over';
    } finally { w.dispose?.(); }
  });

  /**
   * A CONTINGENT NEVER GROWS, which is what stops "bring allies anywhere" from
   * being "bring twenty-four men anywhere for free". `_reinforce` buys back the
   * strength the player deployed with and not one body more, out of a purse a
   * cleared wave pays at `CONTINGENT_WAVE_MUSTER`.
   */
  await check('replacements refill the line and never grow it', async () => {
    const { CommandDirector, CONTINGENT_WAVES_PER_BODY } = await import('../../src/game/Command.js');
    const d = new CommandDirector(bench(), { mode: 'waves', seed: 1, campaign: false, strength: 5 });
    assert(d.roster.strength === 5, `the opening muster enlisted ${d.roster.strength} for a contingent of 5`);
    assert(d.roster.points === 0, 'a contingent opened with a purse it has no screen to spend');
    for (let i = 0; i < 60; i++) d._reinforce();
    assert(d.roster.strength === 5, `sixty cleared waves grew the line to ${d.roster.strength}`);
    /* Kill two and let the purse do its work: `CONTINGENT_WAVES_PER_BODY`
     * clears a body, so two men back is four clears and no fewer. */
    for (const t of d.roster.living.slice(0, 2)) t.alive = false;
    assert(d.roster.strength === 3, 'the roster did not notice two dead');
    d._reinforce();
    const afterOne = d.roster.strength;
    assert(afterOne < 5, 'a hole in the line was filled the instant it appeared');
    let clears = 1;
    for (; clears < 12 && d.roster.strength < 5; clears++) d._reinforce();
    assert(d.roster.strength === 5, `twelve clears left the line at ${d.roster.strength} of 5`);
    assert(clears >= 2 * CONTINGENT_WAVES_PER_BODY,
      `two replacements arrived in ${clears} clears, and the rate says ${2 * CONTINGENT_WAVES_PER_BODY}`);

    /**
     * …AND THEY REFILL THE SHAPE, NOT THE HEAD COUNT — which is a distinction
     * that did not exist until the player could compose a contingent.
     *
     * `_reinforce` used to be `while (strength < opening) recruit(cheapest)`,
     * and while every contingent was ten identical clone troopers that was the
     * same sentence. It stops being it the moment the line is four ARCs: the
     * first casualty comes back as a trooper, and over a long run four ARCs
     * become eight troopers with nothing anywhere reporting the drift. A
     * replacement is measured against `lineup` — the roll the opening muster
     * actually bought — so an ARC is replaced by an ARC at an ARC's price.
     */
    await import('../../src/game/Levels.js');
    const arcs = new CommandDirector(bench(),
      { mode: 'waves', seed: 1, campaign: false, strength: 10, unit: 4 });
    const opened = arcs.roster.living.map((t) => t.type).join(',');
    assert(arcs.roster.living.every((t) => t.type === 'arc'),
      `a contingent of ARCs opened as ${opened}`);
    arcs.roster.living[0].alive = false;
    for (let i = 0; i < 40 && arcs.roster.strength < 4; i++) arcs._reinforce();
    const back = arcs.roster.living.map((t) => t.type);
    assert(back.length === 4 && back.every((t) => t === 'arc'),
      `a fallen ARC was replaced and the line came back as ${back.join(',')}`);
    return `5 held over 60 clears · 2 lost, back to 5 in ${clears} clears · `
      + `a fallen ARC comes back an ARC (${back.join('+')})`;
  });

  await check('muster: the men who held the ground keep it, and the ships bring only replacements', async () => {
    /**
     * ══ THE TRANSPORT CARRIES THE DEAD MAN'S REPLACEMENT, NOT THE SURVIVOR ══
     *
     * The player, on the area boundary: "after finishing a round and calling in
     * reinforcements you leave that menu and you're now by yourself until a
     * couple seconds later the reinforcement ships come in and drop your new
     * troops off — however for sake of immersion it would make more sense if
     * the troops that survived stayed with you on the ground and the only
     * troopers coming in with the ships would be new troopers. Right now your
     * surviving troops get off the transport with the new troops."
     *
     * They did. `_areaClear` called `recall()` on the WHOLE roll, so the six
     * men who had just held the ground were disposed alongside the four about
     * to be bought, the muster opened over an empty field, and `closeMuster`
     * flew everybody back in. A survivor riding in on the transport that is
     * meant to be bringing his replacements is the mode telling you its own
     * casualty list does not mean anything — the one list FLAGSHIP §13 calls
     * the mode's second spine on the grounds that it only ever shrinks.
     *
     * ── WHAT IS ACTUALLY DRIVEN, AND WHY EACH CLAUSE IS SEPARATE ───────────
     *
     * THE SAME BODIES. Not "seven men are standing" — object identity, and the
     *   same position to a millimetre. A withdrawal that disposed the bodies
     *   and instantly rebuilt them somewhere else would satisfy a head count
     *   and would be the exact thing the player is describing.
     * THE SHIPS CARRY THE REPLACEMENTS AND NOTHING ELSE. `deploy` is asked how
     *   many bodies it put down, and the answer has to be the number of men
     *   with no body — not the strength of the roll.
     * AND A FULL WITHDRAWAL STILL WITHDRAWS. The end of a campaign and a
     *   departing commander have no next area for anybody to be standing in,
     *   and `keepStanding` is opt-in for exactly that reason.
     */
    const { army } = await import('./_army.mjs');
    const { d, c } = army();
    const started = d.led(c).filter((t) => t.body && !t.body.dead);
    assert(started.length >= 6, `only ${started.length} men were deployed to begin with`);

    /* Three killed the way a wave kills them, through the director's own door. */
    for (const t of started.slice(0, 3)) { t.body.dead = true; d.onDeath(t.body, null); }
    assert(c.roster.fallen.length === 3, `${c.roster.fallen.length} casualties for three deaths`);
    const held = d.led(c).filter((t) => t.body && !t.body.dead);
    const was = new Map(held.map((t) => [t, { e: t.body, at: t.body.position.clone() }]));

    /* THE AREA BOUNDARY, exactly as `_areaClear` spells it. */
    d.recall(null, { keepStanding: true });
    const after = d.led(c).filter((t) => t.body && !t.body.dead);
    assert(after.length === held.length,
      `${held.length} men held the ground and ${after.length} were still standing on it after `
      + 'the muster opened — the survivors are being flown back in with their own replacements');
    for (const t of after) {
      const w0 = was.get(t);
      assert(w0 && w0.e === t.body,
        `${t.name} is standing there on a different body — the withdrawal disposed him and `
        + 'rebuilt him, which is the same event with a head count that hides it');
      assert(t.body.position.distanceTo(w0.at) < 1e-6,
        `${t.name} moved ${t.body.position.distanceTo(w0.at).toFixed(1)} m across the boundary`);
    }

    /* THE SHIPS. Two bought, two flown, and not one survivor among them. */
    c.roster.points = 999;
    const bought = [d.recruit('trooper'), d.recruit('trooper')].filter(Boolean);
    assert(bought.length === 2, `the purse bought ${bought.length} replacements`);
    const put = d.deployAll({ byShip: true });
    assert(put === bought.length,
      `${put} bodies were deployed for ${bought.length} replacements — the transport is `
      + 'carrying men who never left the ground');
    for (const t of after) {
      assert(t.body === was.get(t).e, `${t.name} was re-deployed by the ship he did not need`);
    }

    /**
     * ══ AND NOBODY IS LEFT INSIDE WHAT THE FRONT RAISED ON THEM ═══════════
     *
     * `marchFront` sites plates, wrecks and barricades knowing nothing about
     * bodies, and it used to run on an empty field because the whole army had
     * just been withdrawn. Now the survivors are standing on it while it is
     * re-dressed. MEASURED across 5 seeds, 943 open sample points each within
     * 30 m of the origin: 0.59 % of open ground becomes `placementClear`-blocked
     * by the engagement-5 march — with eight survivors, about one boundary in
     * twenty puts a man inside a fresh wreck.
     *
     * DRIVEN BY BUILDING THE WRECK ON HIM, because a 5 % event is not
     * something a check can wait for. He keeps his body, his name and his
     * wounds and steps out of it; nothing else on the field moves.
     */
    {
      const { army: army3 } = await import('./_army.mjs');
      const A = army3();
      const one = A.d.led(A.c).find((t) => t.body && !t.body.dead);
      const was = one.body;
      const at = one.body.position.clone();
      /* A static exactly where he is standing, in the shape `spawnClear`
       * actually reads — centre, radius, orientation and half extents. */
      const THREE = await import('three');
      A.w.physics.staticBoxes.push({
        center: new THREE.Vector3(at.x, at.y + 1, at.z),
        radius: 3.6,
        invQuat: new THREE.Quaternion(),
        halfExtents: new THREE.Vector3(2, 2, 2),
      });
      assert(!(await import('../../src/game/Spawn.js')).placementClear(A.w, at.x, at.y, at.z),
        'the fixture built a wreck that the game does not think is in the way');
      /* WHO WAS ALREADY CLEAR, asked of the same function `_unbury` asks —
       * a wreck big enough to bury one man can reach a second, and the claim
       * is that nobody on clear ground is touched, not that nobody else is. */
      const { placementClear: clear } = await import('../../src/game/Spawn.js');
      const others = A.d.led(A.c).filter((t) => t !== one && t.body
        && clear(A.w, t.body.position.x, t.body.position.y, t.body.position.z))
        .map((t) => [t, t.body.position.clone()]);
      const moved = A.d._unbury(A.c);
      assert(moved >= 1, 'a man standing inside a wreck the front raised on him was left in it');
      assert(one.body === was, 'he was rebuilt rather than moved — his name and his wounds go with the body');
      assert(one.body.position.distanceTo(at) > 1,
        `he is still at ${at.x.toFixed(1)},${at.z.toFixed(1)} inside the static`);
      assert(one.body.position.distanceTo(at) <= 7,
        `he was teleported ${one.body.position.distanceTo(at).toFixed(0)} m across the field`);
      for (const [t, p] of others) {
        assert(t.body.position.distanceTo(p) < 1e-6,
          `${t.name} was standing on clear ground and was moved anyway`);
      }
    }

    /**
     * ══ AND THE BOUNDARY SAYS WHAT IT TOOK AWAY ═══════════════════════════
     *
     * `HUD._squadOrders` is push-only: it is cleared by an ARMY-WIDE
     * `setOrder` and by nothing else. So a boundary that deleted `squadOrders`
     * in silence left the order panel's second line saying "Havoc — take
     * cover" about a squad under no order, for the rest of the run. That is
     * the defect `HUD.setOrder`'s own note already records — "the director
     * gives a squad's own order up in two places nobody was telling this panel
     * about … for ever" — and the boundary was a third place.
     *
     * `_vacancy` has the shape: a null formation with a null name, per squad.
     * ONE PER SQUAD THAT ACTUALLY HAD ONE, so a boundary after an engagement
     * nobody delegated in says nothing at all.
     */
    {
      const { army: army2 } = await import('./_army.mjs');
      const A = army2();
      const said = [];
      A.d.onOrder = (F, n, one) => said.push([F?.id ?? null, one?.squad ?? null, one?.name ?? null]);
      const sq2 = A.d.squadsOf(A.c);
      A.c.player.position.set(0, 0, 0);
      assert(A.d.order('cover', A.c, 1) === true, `1st arm: ${A.d.orderRefused}`);
      assert(A.d.order('digin', A.c, 0) === true, `2nd arm: ${A.d.orderRefused}`);
      A.d.hold(true);
      said.length = 0;
      A.d._areaClear?.();
      const drops = said.filter((r) => r[0] === null && r[1] != null);
      assert(drops.length === 2,
        `the boundary deleted two squads' orders and announced ${drops.length} of them — the `
        + 'order panel goes on printing an order nobody is under, for the rest of the run');
      assert(new Set(drops.map((r) => r[1])).size === 2,
        `both announcements named the same squad (${JSON.stringify(drops)})`);
      assert(!A.c.holding, 'the boundary left the company holding ground the front has left');
      assert(A.w.notes.some(([t]) => /FRONT HAS MOVED/.test(t)),
        'the hold and every squad order were released without a word to the player — `hold()` '
        + 'notifies and logs, and the boundary undid the same standing order in silence');
      /* AND A QUIET BOUNDARY IS QUIET. */
      const B = army2();
      const alsoSaid = [];
      B.d.onOrder = () => alsoSaid.push(1);
      B.d._areaClear?.();
      assert(alsoSaid.length === 0,
        `a boundary after an engagement nobody delegated in announced ${alsoSaid.length} drops`);
    }

    /**
     * …AND THE AREA BOUNDARY IS THE CALLER THAT ASKS FOR IT.
     *
     * Everything above drives `recall` directly, which is the right way to
     * measure what the withdrawal DOES and is blind to the one line that
     * decides whether it ever happens that way in a run: a `_areaClear` that
     * went back to a bare `recall()` would pass every assertion above and put
     * the survivors back on the transports. Measured — that mutation is
     * invisible to a fixture that calls `recall` itself.
     *
     * So the call site is read. `_areaClear` is where a run crosses from one
     * engagement to the next and it is the only caller that has a next area to
     * leave anybody standing in; the two that do not — the end of a campaign
     * and a departing commander — must NOT carry it, and that is asserted in
     * the same breath rather than left as an absence.
     */
    const { readFile } = await import('node:fs/promises');
    const { functionBody } = await import('./_source.mjs');
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    const boundary = functionBody(src, '  _areaClear(');
    const calls = [...boundary.matchAll(/this\.recall\(([^)]*)\)/g)].map((m) => m[1]);
    assert(calls.length === 1,
      `_areaClear makes ${calls.length} withdrawal calls — there is one boundary and one door`);
    assert(/keepStanding:\s*true/.test(calls[0]),
      `the area boundary calls recall(${calls[0]}) — without \`keepStanding\` every survivor is `
      + 'disposed and flown back in beside his own replacement, which is the defect this '
      + 'check exists for and which no fixture calling recall() itself can see');
    for (const [what, sig] of [['the end of a campaign', '  _endCampaign('],
                               ['a departing commander', '  dismissCommander(']]) {
      const body = functionBody(src, sig);
      for (const m of body.matchAll(/this\.recall\(([^)]*)\)/g)) {
        assert(!/keepStanding/.test(m[1]),
          `${what} leaves bodies standing (recall(${m[1]})) — there is no next area for them `
          + 'to be standing in');
      }
    }

    /**
     * ══ AND A MAN ON HIS BACK DID NOT HOLD THE GROUND ═════════════════════
     *
     * `!e.dead` is not the same question as "is he standing". In THE LINE a
     * wounded named man is DOWNED — ragdolled, bleeding out on `_tickDown`,
     * and `dead === false` — so a withdrawal testing only `dead` KEPT him:
     * he crossed the boundary lying in the dirt of an area already banked,
     * `deploy` skipped him because he has a body, no replacement was ever
     * bought for him, the line re-formed on the commander and walked away,
     * and the bleed finished him. Driven before the fix: "downed man kept his
     * body: true · still downed: true · ships put down 0 bodies."
     *
     * And while he lived he was a permanent −1 on `lineGathered`'s numerator
     * with a +1 still on its denominator, so every later quorum was that much
     * harder to make for a wound taken two areas ago.
     */
    const hurt = d.led(c).find((t) => t.body && !t.body.dead);
    assert(hurt, 'nobody left standing to wound');
    hurt.body.downed = true;
    d.recall(null, { keepStanding: true });
    assert(!hurt.body,
      `${hurt.name} was bleeding on the ground and the withdrawal left him there — the ships `
      + 'bring nobody for a man whose body is technically alive, and the bleed finishes him in '
      + 'an area he already survived');
    assert(d.led(c).filter((t) => t.body && !t.body.dead).length === after.length - 1,
      'the downed man took somebody standing off the field with him');
    /* AND HE IS FLOWN BACK. Counted against the men who actually have no body:
     * the second withdrawal above also released the two replacements bought
     * earlier out of `_inbound`, so they need ground again too. */
    const needing = d.led(c).filter((t) => !t.body || t.body.dead).length;
    const flown = d.deployAll({ byShip: true });
    assert(flown === needing,
      `${flown} bodies were put down for ${needing} men without one — the man carried off the `
      + 'last area was not flown back');
    assert(needing >= 1, 'nobody needed a ship, so this proves nothing about the wounded man');

    /* AND THE FULL WITHDRAWAL IS STILL A WITHDRAWAL. */
    d.recall();
    const end = d.led(c).filter((t) => t.body && !t.body.dead).length;
    assert(end === 0,
      `${end} bodies survived an end-of-run recall — \`keepStanding\` leaked into the door that `
      + 'takes an army off the field for good');
    return `${held.length} survivors kept their own bodies and their own ground · `
      + `${put} ships for ${bought.length} replacements · a man on his back is carried off and `
      + `flown back · the boundary asks for it and the two one-way doors do not`;
  });

  /**
   * THE THREE ARMY MODES ARE UNTOUCHED — the regression this change is most
   * likely to cause, so it is the one held down hardest. Command's army is the
   * MODE, and it is not the ally setting: a player who set the number to zero
   * and then chose Command still leads a campaign.
   */
  await check('Command, a skirmish and a campaign still lead an army whatever the setting says', async () => {
    for (const [mode, level] of [['command', 'geonosis'], ['skirmish', 'scoria']]) {
      const { w } = await world(mode, level, { allies: 0 });
      try {
        assert(w.command, `${mode} lost its army`);
        assert(w.command.campaign === true, `${mode} lost the area ladder`);
        assert(w.command.opening === 10, `${mode} opened with ${w.command.opening} instead of ten`);
        assert(w.command.roster.points > 0, `${mode} opened with an empty purse`);
      } finally { w.dispose?.(); }
    }
    return 'command and skirmish: army, crossing, ten strangers and a purse, with allies set to 0';
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  GAP 1 — the player composes the contingent                            */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE SHELF IS OPEN, THE SLIDER IS A PURSE, AND THE CHOICE REACHES THE FIELD.
   *
   * Three properties in one check because they are one feature and any of them
   * alone is a lie: a shelf you can see and cannot buy from, a purse with
   * nothing to spend it on, or a choice the deployment ignores.
   *
   * Driven through a bench director rather than eight Worlds — the question is
   * arithmetic (what does a purse buy) and building eight heightfields to ask it
   * would be half a minute for a multiply, which is the reason `bench` exists.
   * `Levels.js` is imported first because sixteen of the thirty-one archetypes
   * are registered by it and `musterCost` reads `threat` off them: without it
   * every rung prices at 1 and the whole ladder collapses into one number.
   */
  await check('the contingent is a purse, and the player says what it buys', async () => {
    await import('../../src/game/Levels.js');
    const { CommandDirector, ARMIES, LADDER_RUNGS, CONTINGENT_MIXED, musterCost, MAX_STRENGTH }
      = await import('../../src/game/Command.js');
    const dir = (unit) => new CommandDirector(bench(),
      { mode: 'waves', seed: 1, campaign: false, strength: 10, unit });

    /* THE WHOLE LADDER IS FOR SALE. Before this it was two rungs of seven —
     * `musterOffer` filtered on `t.at <= areaNumber` and a contingent's
     * `areaNumber` is 1 for the life of the run. */
    const offer = dir(0).musterOffer();
    assert(offer.units.length === ARMIES.republic.tiers.length,
      `the contingent's shelf sells ${offer.units.length} of `
      + `${ARMIES.republic.tiers.length} rungs`);
    /* …AND A CAMPAIGN'S IS STILL EARNED. The same method, the same ladder, the
     * area gate intact — `unlockAt` is one rule with two answers and not two
     * rules, so this is the clause that stops the fix from being a hole. */
    const camp = new CommandDirector(bench(), { mode: 'command', seed: 1, campaign: true });
    assert(camp.musterOffer().units.length === 2,
      `area 1 of a campaign sells ${camp.musterOffer().units.length} rungs, and the ladder opens two`);
    assert(!camp.recruit('atte'), 'a campaign bought a walker in the landing zone');
    assert(/area 4/.test(camp.refused || ''), `the campaign's refusal reads "${camp.refused}"`);

    /* THE PURSE IS WHAT THE SLIDER ALREADY MEANT, PRICED. Ten allies is ten
     * clone troopers' worth of points, so rung 0 is the shipped behaviour to
     * the body — which is what makes 0 a safe default for a control the player
     * may never find. */
    const line = dir(0);
    assert(line.roster.strength === 10, `rung 0 mustered ${line.roster.strength} of the 10 asked for`);
    assert(line.roster.living.every((t) => t.type === 'trooper'), 'rung 0 is not the line');
    assert(line.roster.points === 0, `${line.roster.points} points went unspent on a line of ten`);

    /* AND A HEAVIER CONTINGENT IS A SMALLER ONE. Every rung of the ladder,
     * driven: the roll changes, the number of bodies falls as the price rises,
     * and nothing is left in the purse that could have bought another body. */
    const rows = [];
    for (let u = CONTINGENT_MIXED; u < LADDER_RUNGS; u++) {
      const d = dir(u);
      const roll = {};
      for (const t of d.roster.living) roll[t.type] = (roll[t.type] || 0) + 1;
      const spent = d.roster.living.reduce((n, t) => n + musterCost(t.type), 0);
      assert(d.roster.strength >= 1, `rung ${u} mustered nobody at all`);
      assert(d.roster.strength <= MAX_STRENGTH, `rung ${u} fielded ${d.roster.strength}`);
      assert(spent + d.roster.points === 10 * musterCost('trooper'),
        `rung ${u} spent ${spent} and holds ${d.roster.points} of a 50-point purse`);
      const cheapest = musterCost(ARMIES.republic.tiers[0].type);
      assert(d.roster.points < cheapest,
        `rung ${u} left ${d.roster.points} points unspent and a body costs ${cheapest}`);
      if (u >= 0) {
        const want = ARMIES.republic.tiers[u].type;
        assert(roll[want] >= 1, `rung ${u} (${want}) bought none of it: ${JSON.stringify(roll)}`);
      } else {
        assert(Object.keys(roll).length > 1, `a mixed contingent came back as ${JSON.stringify(roll)}`);
      }
      rows.push(`${u}:${Object.entries(roll).map(([k, n]) => `${n}${k}`).join('+')}`);
    }

    /**
     * AND COMPOSITION DOES NOT BUY AN EASIER FIGHT — the property the whole
     * thing rests on, and the exploit it exists to close. `allyScale` used to
     * charge 0.055 a BODY, so one AT-TE and three troopers met a wave composed
     * for four men while ten troopers met one composed for ten. Priced in
     * muster points instead, every composition of one purse meets the same
     * wave: measured across the eight rungs the spread is under 3%.
     */
    const scales = [];
    for (let u = CONTINGENT_MIXED; u < LADDER_RUNGS; u++) scales.push(dir(u).allyScale());
    const lo = Math.min(...scales), hi = Math.max(...scales);
    assert(hi - lo < 0.05,
      `the same 50-point purse meets waves from ×${lo.toFixed(3)} to ×${hi.toFixed(3)} `
      + 'depending only on what it was spent on — composition is buying difficulty');
    return `${rows.join(' · ')} · wave price ×${lo.toFixed(3)}-${hi.toFixed(3)}`;
  });

  /**
   * …AND IT REACHES THE FIELD, in a mode that has no muster screen at all.
   *
   * The bench check above is arithmetic. This is the wiring: a setting written
   * on the options screen, read by `commandConfig`, spent by `_musterOpening`
   * and standing on the Ember Shelf in the Trial of Waves as a six-legged gun
   * platform the mode has never been able to field.
   */
  await check('a walker the player asked for is standing in the Trial of Waves', async () => {
    const { idleInput } = await import('./_coop.mjs');
    const { w } = await world('waves', 'scoria', { allies: 10, allyUnit: 6 });
    try {
      w.director.start(1);
      for (let i = 0; i < 30; i++) w.update(DT, idleInput());
      const roll = {};
      for (const t of w.command.roster.living) roll[t.type] = (roll[t.type] || 0) + 1;
      assert(roll.atte === 1, `the roster reads ${JSON.stringify(roll)} and no AT-TE`);
      const bodies = w.enemies.filter((e) => e.trooper && !e.dead);
      assert(bodies.some((e) => e.type === 'atte'), 'the walker is on the roll and not on the ground');
      assert(bodies.length === w.command.roster.strength,
        `${bodies.length} bodies for ${w.command.roster.strength} records`);
      return `${Object.entries(roll).map(([k, n]) => `${n}×${k}`).join(' + ')} on the field, `
        + `wave priced ×${w.command.allyScale().toFixed(2)}`;
    } finally { w.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  GAP 2 — whose men these are                                           */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE ORDER IS THE DEFAULT, THE PLAYER HAS THE LAST WORD, AND A CAMPAIGN HAS
   * NEITHER.
   *
   * The twenty-one-cell table is driven through `armyToLead` rather than
   * through twenty-one Worlds, because the rule IS that function and a World
   * would be four seconds of heightfield to call it. The wiring — that a World
   * actually reaches it, with the level's own declaration in hand — is driven
   * twice below, once where the choice must win and once where it must not.
   */
  await check('whose men these are: the order, the ground, or the player', async () => {
    const { armyToLead, ARMIES } = await import('../../src/game/Command.js');
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const rows = [];
    for (const order of ['jedi', 'sith', 'grey']) {
      const got = new Set();
      for (const key of LEVEL_ORDER) {
        got.add(armyToLead(order, { ground: LEVELS[key].armies }).id);
      }
      assert(got.size === 1, `a ${order} gets ${[...got].join('/')} depending on the ground`);
      rows.push(`${order}→${[...got][0]}`);
    }
    /* A Jedi leads clones and a Sith leads droids, on every ground, with nothing
     * asked. That is `sideForOrder`'s law and it is unchanged. */
    assert(armyToLead('jedi').id === 'republic' && armyToLead('sith').id === 'separatist',
      'the two orders no longer lead their own armies');
    /* THE GREY IS WHERE THE GROUND GETS TO SPEAK, and it is the only place.
     * Geonosis declares `['republic','separatist']`, so the answer there is the
     * Republic — the same answer the hard-coded `|| 'republic'` gave, arrived
     * at by reading the level. Flip the declaration and the Grey follows. */
    assert(armyToLead('grey', { ground: ['separatist', 'republic'] }).id === 'separatist',
      'a Grey on ground that declares the Confederacy first was still handed the Republic');
    assert(armyToLead('grey', { ground: undefined }).id === 'republic',
      'a Grey on ground that declares nothing lost the floor');
    assert(armyToLead('grey', { ground: ['nonsense'] }).id === 'republic',
      'a level naming an army that does not exist was believed');
    /* AND A CHOICE OUTRANKS BOTH — for the caller that is allowed to pass one. */
    assert(armyToLead('jedi', { choice: 'separatist' }).id === 'separatist',
      'the player asked for droids and got clones');
    assert(armyToLead('jedi', { choice: 'nonsense' }).id === 'republic',
      'a junk army id was taken as an answer instead of as no answer');
    return `${rows.join(' ')} · a Grey follows the ground · a choice outranks both`;
  });

  /**
   * THE WIRING, BOTH WAYS ROUND — and the second half is the important one.
   *
   * A contingent takes the player's answer. Command, a skirmish and a campaign
   * never even ask: `sideForOrder`'s note is right that a Jedi at the head of a
   * droid column is a bug wearing a menu, and the veto survives exactly where
   * the fiction it protects lives. Same setting, same order, two modes.
   */
  await check('a contingent takes the army you name; a campaign never does', async () => {
    const cases = [];
    for (const [mode, level, campaign] of [['waves', 'wood', false], ['command', 'geonosis', true]]) {
      const { w } = await world(mode, level, { allies: 6, allyArmy: 1, order: 'jedi' });
      try {
        assert(w.command.campaign === campaign, `${mode} is not the ${campaign ? 'campaign' : 'contingent'} it should be`);
        const want = campaign ? 'republic' : 'separatist';
        assert(w.command.army.id === want,
          `a Jedi in ${mode} who asked for the Confederacy leads ${w.command.army.id}, expected ${want}`);
        cases.push(`${mode}:${w.command.army.id}`);
      } finally { w.dispose?.(); }
    }
    return `${cases.join(' · ')} — the choice is a contingent's alone`;
  });

  /**
   * …AND THE ENEMY FOLLOWS THE ARMY YOU ARE LEADING, WHICH IS THE LIVE BUG.
   *
   * Note 1.2 — "when you're playing as the republic you shouldnt be fighting
   * against things that are canonically on your side" — was fixed in
   * `Waves.unlockedAt` and then quietly reopened by this very feature.
   * `CommandDirector.sideFor()` returns null, which switches the base class's
   * faction rule off, and the only thing left was a filter on the seven types
   * of the muster LADDER. Every Confederate body that is not a rung walked
   * straight through it.
   *
   * Measured before, twenty waves on each of the seven grounds: a Sith with six
   * allies met `acolyte` on five grounds, `walker` on three, and `dwarfspider`
   * and `hailfire` on Geonosis — ten (ground, body) pairs of their own army —
   * while the same Sith with the slider at zero met none. Two grounds are
   * driven here rather than seven, chosen as the two that carried eight of the
   * ten; `factions.mjs` holds the seven-ground version for the modes without a
   * contingent.
   */
  await check('turning allies on never turns your own army against you', async () => {
    const { factionOf } = await import('../../src/game/Databank.js');
    const rows = [];
    for (const order of ['jedi', 'sith']) {
      for (const level of ['mustafar', 'geonosis']) {
        const { w } = await world('waves', level, { allies: 6, order });
        try {
          const mine = w.command.army.id;
          const met = new Set();
          for (let k = 1; k <= 20; k++) for (const t of w.command.unlockedAt(k)) met.add(t);
          const own = [...met].filter((t) => factionOf(t) === mine);
          assert(!own.length,
            `a ${order} with a contingent is sent ${own.join(', ')} on ${level} — their own ${mine} hardware`);
          /* A FILTER NEVER EMPTIES THE FIELD. The other half of the same law:
           * a rule that removes half a pool and leaves nothing is a wave that
           * clears itself on the frame it starts.
           *
           * TWO AND NOT THREE, and the number is the LEVEL's rather than a
           * hedge: Mustafar's pool is seven Confederate bodies and exactly two
           * Republic ones, so a Sith leading droids there has two kinds of
           * enemy to meet and that is everything the ground authored. Geonosis,
           * which authors nine and thirteen, comes back with eight. */
          assert(met.size >= 2, `only ${met.size} kinds of body survive the filter on ${level}`);
          rows.push(`${order}/${level}:${met.size}`);
        } finally { w.dispose?.(); }
      }
    }
    return `${rows.join(' ')} kinds met, none of them the player's own`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  GAP 3 — the ground has to take them, and say so when it will not      */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * NOBODY IS SET DOWN INSIDE A WALL, A WRECK OR A STREAM.
   *
   * `deploy` tested two things about a placement — inside the heightfield, out
   * of the blade's arc — and never asked `spawnClear`, which is the predicate
   * `World.pickSpawn` and `Arrivals._sitePoint` were both fixed to ask and
   * which `Spawn.js` exists to hold. Measured over the seven shipped grounds, a
   * 24-body contingent deployed from eight anchors on each: 67 of 1,344
   * placements landed on ground `spawnClear` refuses, 5.0%, worst on the
   * Colosseum and scoria at 8.3% and in the Wood's water at 7.3%.
   *
   * Three grounds here rather than seven — the two worst and the wet one, which
   * between them carried 46 of the 67 — because each World is four seconds and
   * this check is measuring a rate, not a level.
   */
  await check('a deployed line stands on ground the game itself calls clear', async () => {
    const { spawnClear } = await import('../../src/game/Spawn.js');
    let placed = 0, bad = 0, refused = 0;
    const rows = [];
    for (const level of ['colosseum', 'scoria', 'wood']) {
      const { w, p } = await world('waves', level, { allies: 24 });
      try {
        const d = w.command;
        let onBad = 0, n = 0;
        for (let k = 0; k < 6; k++) {
          /* THE COMMANDER MOVES AND THE ARMY IS PUT DOWN AGAIN, which is what
           * `start` does at every ground change and `reinforce` does mid-fight.
           * One anchor would measure one piece of ground. */
          const a = (k / 6) * Math.PI * 2;
          p.position.set(Math.cos(a) * 30, 0, Math.sin(a) * 30);
          if (w.terrain) p.position.y = w.terrain.height(p.position.x, p.position.z);
          for (const t of d.roster.all) { if (t.body) t.body.dead = true; t.body = null; }
          d._inbound.clear();
          w.enemies.length = 0;
          d.deploy();
          refused += d.undeployed;
          for (const t of d.roster.living) {
            const q = t.body?.position;
            if (!q) continue;
            n++;
            if (!spawnClear(w, q.x, q.y, q.z)) onBad++;
          }
        }
        placed += n; bad += onBad;
        rows.push(`${level} ${onBad}/${n}`);
      } finally { w.dispose?.(); }
    }
    assert(placed > 300, `only ${placed} placements were taken — the drive is not measuring anything`);
    assert(bad === 0,
      `${bad} of ${placed} troopers were set down on ground spawnClear refuses `
      + '(inside a collider, or under the level\'s own water)');
    return `${rows.join(' · ')} on refused ground, ${refused} openly refused of ${placed + refused}`;
  });

  /**
   * …AND A REQUEST THAT CANNOT BE MET SAYS SO.
   *
   * The worst half of the gap was the silence. `deploy` ended `if (!e)
   * continue;` and a record with nowhere to stand simply stayed bodyless while
   * the roster panel went on printing its name — the defect `Player._refuse`
   * and `reinforce`'s NO REINFORCEMENTS both exist to stop.
   *
   * Driven on ground that is nothing but collider: one static box big enough to
   * swallow every ring the search can reach, so all six tries fail for all six
   * men and the refusal is the only possible outcome. The bench never reaches
   * `spawnEnemy`, which is the point — a placement that fails fails BEFORE a
   * body is built, so the stub does not have to be an Enemy.
   */
  await check('a line with nowhere to stand is refused out loud', async () => {
    const THREE = await import('three');
    const { CommandDirector } = await import('../../src/game/Command.js');
    const said = [];
    const solid = {
      center: new THREE.Vector3(0, 1, 0), radius: 600, disabled: false,
      invQuat: new THREE.Quaternion(), halfExtents: new THREE.Vector3(500, 60, 500),
    };
    const w = {
      ...bench(),
      physics: { staticBoxes: [solid], bodies: [] },
      spawnEnemy: () => { throw new Error('a body was built on ground that refused it'); },
      notify: (title, sub) => said.push(`${title}: ${sub}`),
    };
    const d = new CommandDirector(w, { mode: 'waves', seed: 1, campaign: false, strength: 6 });
    const n = d.deploy();
    assert(n === 0, `${n} bodies were placed inside a solid box`);
    assert(d.undeployed === 6, `deploy reported ${d.undeployed} unplaced of 6`);
    assert(said.length === 1, `${said.length} banners were raised for one failed deployment`);
    assert(/6 of 6/.test(said[0]), `the refusal reads "${said[0]}" and does not say how many`);
    /* AND IT IS NOT PERMANENT. Take the box away — the commander stepped off
     * the wall — and the same roster goes down on the same frame, with the
     * count back to zero, because `undeployed` is the LAST call and not a
     * latch. */
    solid.disabled = true;
    let built = 0;
    w.spawnEnemy = (type, pos) => { built++; return null; };
    d.deploy();
    assert(built === 6, `${built} of 6 bodies were attempted once the ground was clear`);
    assert(d.undeployed === 6, 'a spawn that returns nothing is not counted as unplaced');
    return `${said[0]} · cleared: 6 of 6 attempted`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  THE INTERLUDE                                                         */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE MUSTER HAD A SHOP AND NOT A STORY — FLAGSHIP §5.
   *
   *   "Between engagements: the muster. 60–90 s. Points in, bodies out, the
   *   roll of who lived, who was promoted, and who is on the fallen list. This
   *   quiet is where the run becomes a story. It must be real and it must have
   *   no input."
   *
   * The screen the checks above drive is the right screen for the DECISION and
   * it is the wrong one for that paragraph: it opens with the shelf, the purse,
   * the strength and the roll all on at once, the instant the area ends, so
   * everything that happened in the engagement you just fought arrives already
   * summed. Six men held, two did not, and one of them was the sergeant you had
   * been protecting for three areas — all of it one number going 9 → 7 in a
   * corner of a shop.
   *
   * `Session.interludeBeats` reads the director's own ledger and returns the
   * beats; `Menu._runInterlude` lands them one at a time with the shelf inert.
   * The three checks below are the three claims: it is REAL (every beat is an
   * event that was written down when it happened), it takes NO INPUT while it
   * runs, and it is BOUNDED.
   */
  await check('the quiet between engagements is read off the ledger, not assembled beside it', async () => {
    const { w } = await world('command', 'geonosis');
    const d = w.command;
    const { interludeBeats } = await import('../../src/game/Session.js');
    assert(d && d.crossing, 'the command world is not a crossing');

    /* Three men die through the shipped door — `onDeath` is what World calls
     * from `onEnemyKilled`, and it is the only thing that writes a `fell`. */
    const doomed = d.roster.living.slice(0, 3);
    for (const t of doomed) {
      const body = t.body || { trooper: t, position: w.player.position, team: 0, dead: false };
      body.trooper = t; body.dead = true;
      d.onDeath(body, null);
    }
    const fellNames = doomed.map((t) => t.name);

    /**
     * …and the area is held, which is the call that builds the interlude.
     *
     * A HANDLER IS INSTALLED FIRST, and that is not scaffolding — it is the
     * behaviour under test in the negative. With no `onMuster` the director
     * takes its documented fallback (`autoMuster` then `closeMuster`), and
     * `closeMuster` is the door that OPENS the next engagement, so it drops the
     * report on its way past. A run with no muster screen must not be left
     * holding a story nobody was told.
     */
    let handed = null;
    d.onMuster = (offer) => { handed = offer; };
    d._areaClear();
    const res = d._interlude;
    assert(handed && handed.interlude === res, 'the muster handler was not handed the report');
    assert(res && res.beats.length, 'holding an area produced no interlude at all');

    const kinds = res.beats.map((b) => b.kind);
    assert(kinds[0] === 'head', `the report opens on a ${kinds[0]} beat`);
    const told = res.beats.filter((b) => b.kind === 'fell').map((b) => b.text);
    for (const n of fellNames) {
      assert(told.includes(n), `${n} is on the fallen list and was never named`);
    }
    assert(told.length === fellNames.length,
      `${told.length} casualties told against ${fellNames.length} on the roll`);
    /* NOTHING IS INVENTED. Every beat that names a man names one on the roll,
     * and every `fell` beat has a log entry behind it. */
    const onRoll = new Set(d.roster.all.map((t) => t.name));
    for (const b of res.beats) {
      if (b.kind === 'head' || b.kind === 'tally') continue;
      assert(onRoll.has(b.text), `the report names ${b.text}, who is not on the roll`);
    }
    const logged = d.log.filter((e) => e.t === 'fell').map((e) => e.name);
    for (const n of told) assert(logged.includes(n), `${n} was reported dead and the ledger says otherwise`);

    /* THE TALLY IS THE PURSE AND THE LINE, and both are the roster's own. */
    const tally = res.beats.filter((b) => b.kind === 'tally');
    assert(tally.length === 2, `${tally.length} tally beats`);
    assert(tally[0].sub.includes(String(d.roster.points)),
      `the purse beat reads "${tally[0].sub}" against ${d.roster.points} points`);
    assert(tally[1].text.startsWith(String(d.roster.strength)),
      `the strength beat reads "${tally[1].text}" against ${d.roster.strength} standing`);

    /* AND IT CROSSES THE WIRE ON THE OFFER, so a peer tells the same story. */
    assert(d.musterOffer().interlude === res, 'the muster offer carries no interlude');

    /* THE LEDGER MARK MOVES. A second engagement must not re-tell the first. */
    d.closeMuster();
    assert(d._interlude === null, 'closing the muster left the last report standing');
    d._areaClear();
    const again = d._interlude;
    assert(!again.beats.some((b) => b.kind === 'fell' && fellNames.includes(b.text)),
      'the second interlude re-told the first engagement’s dead');

    w.dispose?.();
    return `${res.beats.length} beats over ${res.seconds}s: ${kinds.join(', ')}; `
      + `${told.length} named dead, all three off the ledger; the mark moves at closeMuster`;
  });

  await check('the quiet takes no input, and the shelf is on screen while it does', async () => {
    /**
     * "IT MUST HAVE NO INPUT" — driven on the real Menu and the real markup,
     * on an injected clock so the whole reveal runs without a real second
     * going by.
     *
     * The claim is not "the shop is hidden". It is deliberately visible and
     * inert: `.muster-units.waiting` is `pointer-events:none` and Advance is
     * `disabled`, so you can see what you are about to be allowed to spend and
     * you cannot spend it yet. Hiding it would make the report an interstitial
     * rather than the opening of the decision.
     *
     * WHAT IS DELIBERATELY NOT BLOCKED is Escape — `Screens` rule 1 — and the
     * check for that is in tools/checks/screens.mjs, which walks every state in
     * `LIVE` including this one.
     */
    const { interludeBeats } = await import('../../src/game/Session.js');
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');

    /* The CSS half of "no input" — a class the stylesheet does not act on is a
     * dimming with a live shop underneath it. */
    assert(/\.muster-units\.waiting\{[^}]*pointer-events:\s*none/.test(css),
      '.muster-units.waiting does not stop the pointer — the shelf is live under the report');

    const beats = interludeBeats(
      [{ t: 'fell', name: 'CT-1234', unit: 'Clone Trooper', rank: 'Cpl' },
       { t: 'promote', name: 'CT-5678', rank: 'Sgt' }],
      0, { name: 'The Open Plain', brief: 'flat ochre' },
      { got: 14, points: 22, strength: 9, max: 24 });

    const offer = {
      areaName: 'The Open Plain', next: { name: 'The Hailfire Line', brief: 'armour on the ridge' },
      points: 22, strength: 9, max: 24, area: 2, interlude: beats,
      roster: { army: 'republic', points: 22, strength: 9, fallen: 1,
                roll: [{ id: 't1', name: 'CT-5678', unit: 'Clone Trooper', rank: 'Sgt', rankTitle: 'Sergeant',
                         xp: 6, kills: 2, areas: 1, alive: true, diedIn: null }] },
      units: [{ type: 'trooper', label: 'Clone Trooper', cost: 5, threat: 1, have: 9, afford: true }],
    };

    let bought = 0, seconds = 0;
    const pending = [];
    const doc = makeDocument(html);
    const restore = doc.install();
    let told = 0, waitingAt0 = false, disabledAt0 = false, waitingAtEnd = true, disabledAtEnd = true;
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
      /* THE INJECTED CLOCK. Every beat is queued with the ms it asked for and
       * run by hand, so this measures the ORDER and the GATE rather than the
       * wall clock — which is the §2.6 rule about frames and seconds arriving
       * in a UI. */
      menu.showMuster(offer, {
        recruit: () => { bought++; return { offer, refused: null }; },
        done: () => {},
        schedule: (fn, ms) => { pending.push([ms, fn]); seconds = Math.max(seconds, ms); return pending.length; },
      });
      const units = doc.getElementById('muster-units');
      const advance = doc.getElementById('btn-muster-done');
      const list = doc.getElementById('muster-interlude');
      waitingAt0 = units.classList.contains('waiting');
      disabledAt0 = !!advance.disabled;
      assert(waitingAt0, 'the shelf was live from the first frame of the report');
      assert(disabledAt0, 'Advance was pressable before the report had said anything');
      assert(!list.classList.contains('hidden'), 'the report was drawn hidden');

      /* A CLICK ON THE SHELF WHILE THE REPORT RUNS BUYS NOTHING. The card is
       * only made activatable when it is affordable, so the honest test is the
       * one a player performs: press it. */
      const card = units.children[0];
      assert(card, 'the shelf drew no unit card');
      card.click();
      assert(bought === 0,
        `a unit was bought ${bought} time(s) during the quiet — the muster took input`);

      /* Now let the clock run. */
      pending.sort((a, b) => a[0] - b[0]);
      for (const [, fn] of pending) fn();
      told = list.children.length;
      waitingAtEnd = units.classList.contains('waiting');
      disabledAtEnd = !!advance.disabled;
      assert(told === beats.beats.length, `${told} beats landed of ${beats.beats.length}`);
      assert(!waitingAtEnd, 'the shelf never woke up');
      assert(!disabledAtEnd, 'Advance is still disabled after the last beat');
      card.click();
      assert(bought === 1, `after the report a purchase bought ${bought} time(s)`);
    } finally { restore(); }

    return `${told} beats over ${(seconds / 1000).toFixed(1)}s: shelf inert and Advance dead throughout `
      + `(0 purchases), both live on the last beat (1 purchase)`;
  });

  await check('the report is bounded — a wipe tells every name and still ends', async () => {
    /**
     * A quiet engagement and a massacre are not the same story and must not
     * take the same time to tell, so the length is derived. But a report that
     * scaled without limit would hold the screen for a minute and a half on the
     * run that has just gone worst, and one that TRUNCATED would drop exactly
     * the names the player is owed. `INTERLUDE.window` scales the holds
     * together instead: every beat is still told, a long report is faster
     * rather than shorter.
     */
    const { interludeBeats, INTERLUDE } = await import('../../src/game/Session.js');
    const area = { name: 'The Spire Approach', brief: 'under the spires' };
    const tally = { got: 26, points: 40, strength: 4, max: 24 };
    const rows = [];
    for (const n of [0, 1, 3, 6, 12, 24]) {
      const log = [];
      for (let i = 0; i < n; i++) log.push({ t: 'fell', name: `CT-${1000 + i}`, unit: 'Clone Trooper', rank: 'Trp' });
      const res = interludeBeats(log, 0, area, tally);
      /* `none` is the beat a clean engagement gets in place of a casualty — its
       * own kind, so it is neither red nor audible. See `interludeBeats`. */
      const named = res.beats.filter((b) => b.kind === 'fell' || b.kind === 'none');
      assert(named.length === Math.max(1, n),
        `${n} casualties produced ${named.length} beats — a name was dropped`);
      assert(res.beats.filter((b) => b.kind === 'fell').length === n,
        `${n} casualties and ${res.beats.filter((b) => b.kind === 'fell').length} fallen beats`);
      assert(res.seconds >= INTERLUDE.window[0] - 1e-6 && res.seconds <= INTERLUDE.window[1] + 1e-6,
        `${n} casualties ran ${res.seconds}s, outside ${INTERLUDE.window.join('–')}s`);
      /* Monotonic and gapless: beat k starts where beat k-1 ended. */
      let t = 0;
      for (const b of res.beats) {
        assert(Math.abs(b.at - t) < 0.01, `a beat starts at ${b.at}s with ${t}s told`);
        t += b.hold;
      }
      rows.push(`${n}→${res.seconds}s/${res.beats.length}`);
    }
    return `${rows.join(' · ')} — every name told, all inside ${INTERLUDE.window.join('–')}s`;
  });

}
