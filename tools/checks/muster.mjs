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
 * ── WHAT A FULL VERSION WOULD STILL NEED, and none of it is wired here ──
 *
 * THE PLAYER CANNOT COMPOSE THE CONTINGENT. It is `opening` bodies of the
 *   cheapest rung and nothing else, because the shelf that sells the other six
 *   — sniper, jet, ARC, officer, the AT-TE — is `musterOffer`, and `musterOffer`
 *   is gated on the AREA a contingent does not have. A full version puts that
 *   shelf on the deploy screen with a points budget instead of a body count,
 *   and `musterCost` is already the price list it would spend.
 *
 * THE ARMY IS ALWAYS THE ONE YOUR ORDER NAMES. `sideForOrder` is right — a Jedi
 *   at the head of a droid army is a bug wearing a menu — but it also means the
 *   contingent on the Wood, the Drifts and the Warship is a Republic clone
 *   platoon wherever it lands. Allies drawn from the LEVEL's own pool would fit
 *   the ground; that is a roster decision nobody has made, not a wiring one.
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
 * SMALL GROUND PLACES FEWER MEN. Driven on the Colosseum in `duel`, four allies
 *   asked put TWO on the field: `deploy` fans bodies behind the commander on a
 *   4-8 m ring and `spawnClear` refuses the rest. It is not silent — the roster
 *   says four and the field shows two — and a full version needs a placement
 *   pass that widens the ring in a room rather than dropping the difference.
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
    return `5 held over 60 clears · 2 lost, back to 5 in ${clears} clears`;
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
}
