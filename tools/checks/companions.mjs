/**
 * THE COMPANION — what it may be, what it may never become, and whether the
 * animal actually does the things the wheel says it does.
 *
 * "I want you to build companions … this is like a pet/close personal
 *  companion/protector that you can choose to go into battle with … they stay
 *  close to you at all times but you can give them a limited set of orders …
 *  obviously they're going to be less mobile than you so protecting the
 *  companions and keeping them safe is another thing the player can choose to
 *  worry about … if they survive they need to persist between runs/games"
 *
 * Every clause below is DRIVEN — a real world, a real body, a real store —
 * rather than transcribed, for the reason `desecrate.mjs` gives beside its own
 * bone list: a check that reads the table it is checking proves the table is
 * spelled the way it is spelled.
 *
 * THE ONES THAT MATTER MOST ARE THE REFUSALS. This feature's whole risk is
 * that it becomes a power ladder wearing fur, and three checks here assert the
 * ABSENCE of things rather than the presence: no multiplier field on any rung,
 * no currency word in either new file, and no second companion slot.
 */
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const STEP = 1 / 30;
const src = (p) => readFile(new URL('../../src/' + p, import.meta.url), 'utf8');
/* Comments are stripped before every scan below, for `company.mjs`'s reason:
 * a check that reads prose finds the word "unlock" in a paragraph explaining
 * why there are no unlocks. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A world with a player, in a mode that builds NO CommandDirector. */
async function field(kind = 'massiff', rec = null, settings = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { fieldCompanion } = await import('../../src/game/Companions.js');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', ...settings },
    runSeed: 21,
  });
  const input = idleInput();
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  const e = fieldCompanion(world, world.player, kind, rec ? { rec } : {});
  return { world, input, e, p: world.player };
}

/** Tick the world, keeping the player alive — a fixture player shot to death
 *  turns every measurement after it into a measurement of a corpse, which is a
 *  mistake `tools/_companion.mjs` made for a whole minute before it was found. */
const tick = (world, input, p, n) => {
  for (let i = 0; i < n; i++) { if (p) p.hp = p.maxHp ?? 100; world.update(STEP, input); }
};

/**
 * THE LEG BONES THIS SKELETON ACTUALLY HAS, NAMED — never a typed list.
 *
 * Counted off the rig, because the two solvers name them differently and the
 * whole point of the checks below is that nothing decides anything from a
 * kind's name: `creatureSkeleton` emits `hipL{i}`/`femur{i}`/`tibia{i}`/
 * `tarsus{i}` per limb and `humanoidSkeleton` emits `thighL`/`shinL`. A body
 * with neither comes back empty, and the caller has to say out loud what it
 * is doing about that rather than skipping quietly.
 */
function legBonesOf(rig) {
  const out = [];
  for (let i = 0; rig.get(`femur${i}`); i++) out.push(`femur${i}`, `tibia${i}`);
  if (out.length) return out;
  for (const n of ['thighL', 'shinL', 'thighR', 'shinR']) if (rig.get(n)) out.push(n);
  return out;
}

/**
 * WHERE THE PELVIS IS AND HOW THE HIND SOCKET IS TURNED, THIS FRAME.
 *
 * Two numbers because the old sit satisfies exactly one of them and a sit that
 * is a fold satisfies both: a root sinking by `sit * hip * 0.35` lowers the
 * pelvis and turns nothing, and a fold that moved a joint without dropping the
 * haunches would be a leg tucked under a body still standing at full height.
 *
 * `socket` is false on a body with no hind row to fold — the astromech, whose
 * builder publishes a stance with no limbs in it and argues the case — so the
 * caller can say which of the two it is asserting rather than quietly asking
 * for less.
 */
function hipStateOf(fig) {
  const rig = fig.built.rig;
  const hind = fig.hind?.length ? rig.get(`hipL${fig.hind[0]}`) : null;
  return {
    socket: !!hind,
    q: (hind || rig.hipsBone).obj.quaternion.clone(),
    y: rig.worldPos('hips', new THREE.Vector3()).y - fig.pos.y,
  };
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const K = await import('../../src/game/CompanionKinds.js');
  const Kn = await import('../../src/game/Kennel.js');
  const C = await import('../../src/game/Companions.js');

  /* ── what it may never become ─────────────────────────────────────── */

  check('companion: the rung curve is real, and it is under the trooper ladder', async () => {
    /**
     * THIS CHECK USED TO ASSERT THE ABSENCE OF THE FIELD, AND THE ABSENCE WAS
     * THE DEFECT.
     *
     * It read: "no rung buys a single point of anything that fights … not one
     * multiplier field", on COMPANY.md's argument that the trooper ladder's
     * compression defence does not transfer. That argument is real and it was
     * settled against the wrong sentence. The specification is the player's:
     * "the companion will get stronger over time just like you do imagine this
     * almost like a mini-player". A ladder that buys only rope and vocabulary
     * is the right SECOND half of that and it was standing in for the first.
     *
     * SO THE CHECK PINS THE CURVE INSTEAD OF THE FIELD'S NON-EXISTENCE — which
     * is `command.mjs:833`'s shape for RANKS, and a check that can now fail in
     * five directions where the old one could fail in one:
     *
     *   1  a rung that stops declaring one of the three
     *   2  a rung that goes DOWN on any of the three
     *   3  a bottom rung that is not exactly 1.00 — the archetype is the
     *      archetype, and a fresh animal is what its row says it is
     *   4  a top rung that reaches OR PASSES the trooper ladder's top on any
     *      axis. Read off the imported `RANKS` and never off three typed
     *      numbers, so compressing RANKS compresses this in the same commit —
     *      HANDOFF §2.4, call the rule rather than restating it
     *   5  a FOURTH multiplier. `enlistBody` reads exactly three fields; this
     *      reads exactly three fields; armour, toughness, frag, ward, panic and
     *      scale are still asserted absent, and always will be.
     *
     * The value of the spread is proved somewhere else on purpose — the check
     * below this one drives two live bodies and measures which one wins. A
     * table can be read; only a body can be out-fought.
     */
    const { RANKS } = await import('../../src/game/Command.js');
    const AXES = ['hp', 'dmg', 'speed'];
    /* Every word this repository has used for a multiplier, MINUS the three the
     * ladder is now allowed to carry. A row that renames its way around the
     * rule still goes red. */
    const BANNED = /^(maxhp|damage|armour|armor|toughness|frag|ward|panic|pace|mult|multiplier|scale|power|strength|bonus)$/i;
    const top = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1];
    const troopTop = RANKS[RANKS.length - 1];
    for (const r of K.COMPANION_RANKS) {
      for (const f in r) {
        assert(!BANNED.test(f), `rung ${r.id} carries a "${f}" — that is a fourth axis nobody argued for`);
      }
      for (const a of AXES) {
        assert(typeof r[a] === 'number' && r[a] >= 1,
          `rung ${r.id} declares no ${a} — the ladder has stopped buying anything that fights`);
      }
      assert(typeof r.leash === 'number' && r.leash > 0, `rung ${r.id} has no leash`);
      assert(Array.isArray(r.orders), `rung ${r.id} licenses nothing`);
    }
    /* THE BOTTOM RUNG IS THE ARCHETYPE, UNTOUCHED. */
    for (const a of AXES) {
      assert(K.COMPANION_RANKS[0][a] === 1,
        `a fresh animal arrives at ${a} ×${K.COMPANION_RANKS[0][a]} — the bottom rung is the row it was built from`);
    }
    /* MONOTONIC IN EVERYTHING IT BUYS — leash, orders and the three numbers. */
    for (let i = 1; i < K.COMPANION_RANKS.length; i++) {
      const a = K.COMPANION_RANKS[i - 1], b = K.COMPANION_RANKS[i];
      assert(b.leash > a.leash, `${b.id} does not reach further than ${a.id}`);
      assert(b.xp > a.xp, `${b.id} costs no more than ${a.id}`);
      for (const o of a.orders) assert(b.orders.includes(o), `${b.id} lost ${o}`);
      for (const ax of AXES) {
        assert(b[ax] >= a[ax], `${b.id} is worse than ${a.id} at ${ax} (${b[ax]} < ${a[ax]})`);
      }
    }
    /* AND IT ACTUALLY CLIMBS — a table of four 1.00s would satisfy everything
     * above it and would be the old defect with a comment on it. */
    for (const a of AXES) {
      assert(top[a] > 1, `the top rung buys nothing at all on ${a}`);
    }
    /**
     * THE CEILING, AND IT IS THE TROOPER LADDER'S OWN NUMBER.
     *
     * STRICTLY under, not equal: a companion is one body carried between modes
     * with no muster and no wave budget to tune against, and COMPANY.md's
     * "twenty-four bodies average out and one does not" is a reason for a
     * smaller spread even though it was not a reason for none.
     */
    for (const a of AXES) {
      assert(top[a] < troopTop[a],
        `a SWORN companion buys ×${top[a]} ${a} against a Commander's ×${troopTop[a]} — the animal's `
        + 'ladder has caught the army\'s');
    }
    return `${K.COMPANION_RANKS.length} rungs, ${K.COMPANION_RANKS.map((r) => r.leash).join('/')} m of leash, `
      + `${K.COMPANION_RANKS.map((r) => r.orders.length).join('/')} orders, and `
      + AXES.map((a) => `${a} ${K.COMPANION_RANKS[0][a].toFixed(2)}→${top[a].toFixed(2)}`).join(', ')
      + ` (Commander ${AXES.map((a) => troopTop[a].toFixed(2)).join('/')})`;
  });

  check('companion: a SWORN animal out-fights a STRANGE one, on a real body', async () => {
    /**
     * THE TABLE IS NOT THE EVIDENCE. THE BODY IS.
     *
     * `command.mjs` pins the trooper ladder's monotonicity off the table and
     * that is enough there, because `enlistBody` is one function with one
     * caller shape. A companion's multipliers are applied inside `adopt`,
     * BEFORE `paceOf`'s clamp and on a body that a pack, a flight installer, a
     * team-damage wrapper and two instance wraps all get their hands on
     * afterwards — so "the row says 1.15" and "the animal is 15% harder to
     * kill" are two different claims and this drives the second one.
     *
     * ── HOW THE FIGHT IS MADE FAIR ───────────────────────────────────────
     *
     * A DUMMY IT CANNOT KILL. Both bouts must get the same number of swings, so
     * the hostile's hp is restored every frame and it is put back on its mark
     * every frame. Let it die and the stronger animal simply stands in an empty
     * field for the rest of the window and bills LESS — the measurement would
     * invert on exactly the improvement it is looking for.
     *
     * AND THE COMPANION IS HELD UP TOO, for the same reason `tick` pins the
     * player: an animal that fell at second nine turns the remaining twenty-one
     * into a measurement of a corpse.
     *
     * WHAT IS COUNTED IS WHAT WAS BILLED — `foe.damage` is wrapped and the
     * argument summed, so this is the damage the shipped attack path actually
     * put through the shipped door, not `attackDamage` read back off the body.
     *
     * ── AND SURVIVAL IS COUNTED IN BOLTS, NOT IN HP ──────────────────────
     *
     * Twenty-point hits into a fresh body of each rung, through the real
     * `damage()` with a hostile source, until it dies. That is the number a
     * player experiences — "it took two more bolts" — and it is quantised,
     * which is the honest form of the claim: 1.15 on 210 hp IS two more bolts
     * and it is not two and a bit.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const recFor = (xp) => ({ id: 'fight' + xp, kind: 'massiff', name: 'Borz', xp, runs: 0,
      areas: 0, kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] });

    async function bout(xp) {
      const { world } = await bootWorld({
        level: 'geonosis',
        settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
        runSeed: 21,
      });
      try {
        const input = idleInput(), p = world.player;
        tick(world, input, p, 30);
        const e = C.fieldCompanion(world, p, 'massiff', { rec: recFor(xp) });
        assert(e, `nothing fielded at xp ${xp}`);
        const out = { rung: K.rungOf(recFor(xp)).label, maxHp: e.maxHp, dmg: e.attackDamage, speed: e.speed };

        const at = new THREE.Vector3(p.position.x + 2, p.position.y, p.position.z + 2);
        /* BOTH BOUTS START ON THE SAME MARK. `fieldCompanion` walks a ring of
         * bearings for a clear spawn now (the Geonosis note), and where that
         * puts the animal is not this fixture's business: a SWORN body at
         * ×1.03 speed that starts half a metre further off arrives a frame
         * later and swings once less, and the totals stop being a comparison.
         * So the animal is stood two metres from the dummy, the same two
         * metres, before the first frame is stepped. */
        e.position.set(at.x - 2.2, at.y, at.z - 0.3);
        e._syncBody?.();
        const foe = world.spawnEnemy('b1', at);
        assert(foe, 'no hostile to hit');
        foe.team = 1;
        let dealt = 0, blows = 0;
        const raw = foe.damage.bind(foe);
        foe.damage = (a, ...r) => { dealt += a; blows++; const v = raw(a, ...r); foe.hp = foe.maxHp; return v; };
        for (let i = 0; i < 30 * 30; i++) {
          p.hp = p.maxHp ?? 100; foe.hp = foe.maxHp; e.hp = e.maxHp;
          foe.position.copy(at);
          world.update(STEP, input);
        }
        out.dealt = dealt; out.blows = blows;

        const e2 = C.fieldCompanion(world, p, 'massiff', { rec: recFor(xp) });
        const src = { team: 1, position: e2.position.clone() };
        let hits = 0;
        while (!e2.dead && hits < 500) { e2.damage(20, e2.position.clone(), src, 'bolt'); hits++; }
        assert(hits < 500, `a ${out.rung} massiff would not die to ten thousand points of fire`);
        out.hits = hits;
        return out;
      } finally { world.unload(); }
    }

    const lo = await bout(0);
    const hi = await bout(K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1].xp);
    assert(lo.rung === 'STRANGE' && hi.rung === 'SWORN',
      `the two bouts were ${lo.rung} and ${hi.rung}, not the bottom and top rungs`);
    assert(lo.blows > 0, 'the STRANGE animal never landed a blow — the fixture measured nothing');
    /**
     * THE TWO BOUTS HAVE TO HAVE SWUNG THE SAME NUMBER OF TIMES, or the totals
     * are not a comparison. Said out loud rather than hoped for: the dummy is
     * immortal and pinned so nothing can diverge, and if this ever trips it is
     * the FIXTURE that has come apart and the message says so instead of the
     * totals quietly answering a different question.
     */
    assert(hi.blows === lo.blows,
      `the bouts swung ${lo.blows} and ${hi.blows} times — the totals are not comparable and the `
      + 'fixture has stopped holding the fight still');
    assert(hi.dealt > lo.dealt,
      `SWORN billed ${hi.dealt.toFixed(0)} against STRANGE's ${lo.dealt.toFixed(0)} over the same thirty `
      + `seconds and the same ${lo.blows} blows — the rung buys nothing that fights`);
    assert(hi.hits > lo.hits,
      `both rungs fall to ${lo.hits} bolts — the rung buys nothing that survives`);
    /* AND THE GAIN IS THE ROW'S GAIN AND NOT SOMETHING ELSE'S. A ratio that
     * ran away from the table would mean a second multiplier had got in. */
    const R = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1];
    const dealtR = hi.dealt / lo.dealt;
    assert(Math.abs(dealtR - R.dmg) < 0.02,
      `SWORN billed ×${dealtR.toFixed(3)} where the rung buys ×${R.dmg} — either something else is `
      + 'scaling it, or the two bouts threw different moves and the totals are of different fights');
    assert(Math.abs(hi.maxHp / lo.maxHp - R.hp) < 1e-6,
      `SWORN carries ×${(hi.maxHp / lo.maxHp).toFixed(3)} hp where the rung buys ×${R.hp}`);
    return `STRANGE ${lo.maxHp.toFixed(0)} hp, billed ${lo.dealt.toFixed(0)} over ${lo.blows} blows in 30 s, `
      + `fell to ${lo.hits} bolts; SWORN ${hi.maxHp.toFixed(0)} hp, billed ${hi.dealt.toFixed(0)} `
      + `(×${dealtR.toFixed(3)}), fell to ${hi.hits}`;
  });

  check('companion: neither new file has grown a currency', async () => {
    /**
     * THE SINGLE MOST IMPORTANT LINE IN THE ARCHITECTURE, and it is here
     * because of a SILENCE rather than a defect.
     *
     * `company.mjs` runs the six-word currency scan on Company.js and Muster.js
     * BY PATH, and `session.mjs` counts `localStorage.setItem` inside five
     * NAMED files. A new file is invisible to both and therefore legal by
     * default. COMPANY.md:377 already states the rule for exactly this class:
     * "That silence is a hazard, not a permission."
     *
     * So the two files that carry the durable record are held to the roll's
     * own standard, on the commit that creates them.
     */
    /* ── AND `Spectacle.js` IS ON THE LIST FROM THE COMMIT THAT MADE IT ───
     *
     * The betting engine is the one file in the tree with the strongest pull
     * toward a stored balance: a wager, a payout and a settled result are
     * three quarters of a wallet, and the fourth quarter is the easy one to
     * add. It keeps none — a stake is a run-scoped number handed in and handed
     * back — and it is added to this scan HERE, on the commit that created it,
     * rather than left invisible to it. The note above is the reason: silence
     * is a hazard, not a permission, and a new file is legal by default until
     * somebody writes its path down. */
    const SCANNED = ['game/Kennel.js', 'game/Companions.js', 'game/CompanionKinds.js', 'game/Spectacle.js',
      /* AND THE TWO THAT ARE THE ECONOMY. `Counter.js` prices things and
       * decides what is on a shelf; `Vendors.js` is the content. Neither holds
       * a balance — `Credits.js` does, and it is exempt BY NAME because it is
       * the one file the doctrine's amendment allows to. Everything around it
       * is held to the same six words as the kennel. */
      'game/Counter.js', 'game/Vendors.js',
      /* AND `Keepsakes.js`, ON THE COMMIT THAT MADE IT. It is the file that
       * turns a payment into a thing you own, which is the closest anything in
       * this tree comes to a shop that is not the wallet — and a new file is
       * invisible to this scan and therefore legal by default, which the note
       * above calls a hazard rather than a permission. It holds no balance and
       * opens no store: every write goes through a record somebody else
       * already owns, which `counter.mjs` asserts by reading the file. */
      'game/Keepsakes.js',
      /* AND `Pits.js`, V16 Lane G's pit room, on the commit that made it. It
       * pays a PURSE and settles a WAGER — the same pull toward a stored
       * balance the betting engine has, one step closer to the record,
       * because it is also the only writer the kennel's `scars` field has
       * ever had and therefore already holds the pen. It keeps no balance: a
       * purse is a number handed back to a caller and a wager goes out
       * through `Spectacle.settle`. Added here rather than left invisible,
       * for the reason stated above. */
      'game/Pits.js'];
    for (const f of SCANNED) {
      const code = strip(await src(f));
      for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
        assert(!new RegExp(`\\b${word}\\b`, 'i').test(code),
          `${f} has grown a "${word}" — the companion has become a shop`);
      }
    }
    /* …AND THE COSMETIC DOOR IS PINNED THE WAY `Company.dress` IS PINNED.
     * `company.mjs:1102` greps that function's body and fixes its fields at
     * five; a companion routed through it would either break that pin or force
     * it open, so this is a separate door with its own. */
    const kn = strip(await src('game/Kennel.js'));
    const body = /export function dressCompanion\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(kn)?.[1] || '';
    assert(body, 'Kennel.dressCompanion is gone');
    const fields = [...body.matchAll(/'(\w+)' in look/g)].map((m) => m[1]).sort();
    assert(fields.join(',') === 'look,name',
      `dressCompanion writes ${fields.join(', ') || 'nothing'} — it may write a name and a set of `
      + 'colours, and a screen that could edit xp, runs, kills or tempers is a cheat panel');
    /* COUNTED AND NOT TYPED. This line read "3 files" while the loop above ran
     * four, which is a report that has stopped tracking what it measured — and
     * a report nobody can trust is how a check quietly stops covering the file
     * somebody added to it. */
    return `${SCANNED.length} files clean of all six words; dressCompanion writes exactly ${fields.join(', ')}`;
  });

  check('companion: the store clamps a hostile save instead of trusting it', () => {
    /* `readMan`'s discipline, on the record that decides how much leash an
     * animal has and how big a rancor pup is drawn. Two of these would be FELT
     * rather than merely wrong. */
    const hostile = Kn.readOne({
      id: 'x', kind: 'massiff', xp: 5000, runs: -3, kills: 1e9,
      name: '<script>alert(1)</script>', look: { hide: 'rust', plate: 'nope', mark: 'sky' },
      tempers: ['keen', 'keen', 'nonesuch', 'heeled'], scale: 40, story: new Array(99).fill('x'),
    });
    assert(hostile, 'a repairable record was thrown away');
    assert(hostile.xp <= 999, `a stored xp of 5000 survived as ${hostile.xp} — that is a free SWORN`);
    assert(hostile.runs >= 0, 'a negative run count survived');
    assert(hostile.scale === undefined,
      'scale is STORED — it is derived from runs, and a derived field on disk is a second source of truth');
    assert(hostile.tempers.length === 2 && hostile.tempers.includes('keen'),
      `tempers came back as ${JSON.stringify(hostile.tempers)} — duplicates and unknowns should be gone`);
    assert(hostile.look.plate === undefined, 'a colour id this build does not have survived');
    assert(hostile.story.length <= Kn.STORY_KEEP, 'the story is unbounded');
    assert(!/[<>]/.test(hostile.name || ''), `the name came back as ${hostile.name}`);
    /* AN UNREADABLE RECORD IS NO COMPANION, NOT A REPAIRED ONE. A companion is
     * a named thing the player will grieve; inventing one from rubble is worse
     * than saying it is gone. */
    assert(Kn.readOne({ id: 'x', kind: 'dragon' }) === null, 'an unknown kind was repaired into a real one');
    assert(Kn.readOne(null) === null, 'null became a companion');
    return `xp 5000→${hostile.xp}, runs −3→${hostile.runs}, 4 tempers→${hostile.tempers.length}, `
      + 'an unknown colour and a stored scale both dropped, an unknown kind refused';
  });

  check('companion: every temper costs at least what it buys', () => {
    /**
     * TWO-SIDED, ON THE `bonded` PRECEDENT, AND PRICED NET ≤ 0.
     *
     * `TEMPER_AXES` HAS NO COMBAT AXIS, AND IT STAYS THAT WAY NOW THAT THE
     * RUNGS HAVE ONE. The ladder above buys hp, dmg and speed; a temper is the
     * layer that says what an animal is LIKE — hold seconds and break metres —
     * and putting a fourth multiplier here would be the same ladder a second
     * time, unpriced against the first and earned on a different clock. One
     * table buys the numbers; this one buys the behaviour, and the result line
     * below says which is which every time the gate runs.
     *
     * The first pricing of this table was WRONG and said so out loud: a
     * one-dimensional sum made three of the four profitable, because four more
     * metres of reach is KEEN's gain and RANGING's cost — the same number read
     * two ways. They are declared as `up`/`down` magnitudes now, in the shape a
     * trait already uses, and priced as the fraction of each axis's own span.
     *
     * AND NOT ONE AXIS IS A COMBAT AXIS, which is the rung rule one table
     * across: a temper that raised health, damage, armour or pace would be the
     * ladder's refusal reopened sideways.
     */
    const COMBAT = /^(hp|damage|armour|armor|pace|speed|toughness)$/i;
    for (const a in Kn.TEMPER_AXES) assert(!COMBAT.test(a), `TEMPER_AXES prices "${a}", which is a combat axis`);
    const rows = [];
    for (const t of Kn.TEMPERS) {
      const net = Kn.priceTemper(t);
      assert(net <= 1e-9, `${t.id} nets ${net.toFixed(3)} — it is a free upgrade`);
      assert(t.gain && t.cost, `${t.id} does not say both what it buys and what it costs`);
      assert(Object.keys(t.up || {}).length && Object.keys(t.down || {}).length,
        `${t.id} is one-sided`);
      for (const side of [t.up, t.down]) {
        for (const a in side) assert(Kn.TEMPER_AXES[a] !== undefined, `${t.id} names an unpriced axis "${a}"`);
      }
      rows.push(`${t.id} ${net.toFixed(3)}`);
    }
    /* An unpriced axis is INFINITELY expensive rather than free — a temper that
     * named one would otherwise contribute zero and sail through. */
    assert(Kn.priceTemper({ up: { nonesuch: 99 }, down: {} }) === Infinity,
      'a temper naming an axis the table does not price came out free');
    /* AND TWO THAT CONTRADICT CANNOT BE WORN AT ONCE. */
    const rec = { xp: 0, tempers: [], runs: 9, ranged: 9, downs: 0, orders: 0 };
    Kn.applyTempers(rec);
    assert(!(rec.tempers.includes('heeled') && rec.tempers.includes('ranging')),
      'an animal is wearing HEELED and RANGING at once, which describes nothing');
    return rows.join(', ') + `; ${Object.keys(Kn.TEMPER_AXES).length} axes, none of them combat`;
  });

  /* ── what it is ───────────────────────────────────────────────────── */

  check("companion: a card's band claim is the row's band, both ways round", async () => {
    /**
     * NOTHING ANYWHERE ASSERTED A BLURB AGAINST THE ROW IT DESCRIBES, and one
     * of them was lying at the point of choice.
     *
     * `ARCHETYPES.wook` was `melee: true` with no `ranged` and no `weapon`. Its
     * blurb said "the only one with both bands", and the picker renders that
     * sentence verbatim. A player who took the wookiee for its gun got a body
     * that had never fired one — and that is the worst place in the feature for
     * a false sentence, because every other one costs a surprise and this one
     * costs the pick. Both halves moved: the row took the bowcaster the bodies
     * lane built, and the card claims exactly the one band the row has.
     *
     * ── WHY THIS IS A PROSE CHECK AND THAT IS NOT A MISTAKE ──────────────
     *
     * §2.3c's lesson is that a reader which greps a whole tree for a bare word
     * finds somebody else's field. This does not grep a tree: it reads ONE
     * sentence per row, off the row, and matches a deliberately narrow list of
     * BAND CLAIMS — the words a card can use to promise a gun. It is not a
     * spell-check on a paragraph, it is the join between the two things that
     * were never joined.
     *
     * THE LIST IS NARROW ON PURPOSE, and the near misses are the argument for
     * how narrow. The medical droid's card says "where the SHOOTING just was"
     * about the enemy; the blurrg's says "the mount that is also a WEAPON"
     * about its teeth; the hawk's says "suicidal in a CROSSFIRE"; the
     * tauntaun's says "it bucks you off and BOLTS". Not one of those is a claim
     * that THIS body carries a gun, and a list containing shoot/weapon/fire/
     * bolt would fail all four and teach the next person to delete the check.
     *
     * BOTH DIRECTIONS, because each catches the opposite defect:
     *   a card that CLAIMS a band the row has not got — what the wookiee did
     *   a row that HAS one and a card that never says so — a companion whose
     *     gun the player cannot find out about before they pick it, which is
     *     the same defect standing the other way up
     * The second half is what held while the bowcaster was still being built:
     * a row that took the field without the sentence moving would have gone red
     * on the way past.
     *
     * AND A CARD SAYS WHAT A BODY IS, NEVER WHAT IT IS NOT. A regular
     * expression cannot read a negation, so a card that wanted to say "it has
     * no gun" would read here as a claim that it has one. Written down because
     * it costs a minute to know and an afternoon to find out.
     */
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const CLAIM = /\b(both bands|ranged|rifle|carbine|bowcaster|blaster|gun)\b/i;
    const rows = [];
    for (const id of K.COMPANION_ORDER) {
      const kind = K.COMPANION_KINDS[id];
      const A = ARCHETYPES[kind.archetype];
      assert(A, `${id} names an archetype ${kind.archetype} that does not exist`);
      assert(typeof kind.blurb === 'string' && kind.blurb.length > 20,
        `${id} has no blurb, and the picker prints one`);
      /**
       * A GUN IT CANNOT FIRE IS NOT A BAND, AND THE TABLE ALREADY AGREES.
       *
       * `ranged` is the flag `Enemy._brain` routes on — `if (A.melee)
       * this._meleeBrain(…); else this._rangedBrain(…)` — and `weapon` is only
       * the thing in the hand. Driven over the whole table with the companion
       * rows loaded: 0 of 49 archetypes carry a `weapon` without `ranged`, so
       * this is the repository's own invariant pinned rather than a new rule,
       * and it is what stops "give the row the field and let the builder meet
       * you there" from putting a bowcaster in a wookiee's hands that nothing
       * ever pulls. Measured from the other side by the check below: with
       * `melee: true` left standing beside the weapon, the animal fires ZERO
       * times in a minute with a hostile eight metres away.
       */
      assert(!A.weapon || A.ranged,
        `${id} carries a '${A.weapon}' and is not ranged — its brain will never fire it`);
      const claims = CLAIM.test(kind.blurb);
      const armed = !!A.ranged;
      assert(claims === armed,
        claims
          ? `the ${id} card promises a band — "${kind.blurb.match(CLAIM)[0]}" — over a row with `
            + `ranged=${!!A.ranged} weapon=${A.weapon ?? 'none'}. The card is where the player chooses.`
          : `the ${id} row is ranged${A.weapon ? ` with a '${A.weapon}'` : ''} and its card never says so — `
            + 'a band the player cannot find out about before picking is a band that does not exist to them');
      rows.push(`${id} ${armed ? (A.weapon || 'ranged') : 'reach only'}`);
    }
    /* AND AT LEAST ONE OF EACH, or the equality above is vacuous on a table
     * where nothing is armed. */
    const armed = K.COMPANION_ORDER.filter((id) => ARCHETYPES[K.COMPANION_KINDS[id].archetype].ranged);
    assert(armed.length >= 1, 'no companion carries a gun at all — the equality above proves nothing');
    assert(armed.length < K.COMPANION_ORDER.length, 'every companion carries a gun — likewise');
    return `${K.COMPANION_ORDER.length} cards against their rows, ${armed.length} armed: ${rows.join(', ')}`;
  });

  check('companion: the one with a gun fires it, keeps its distance, and never at you', async () => {
    /**
     * A BAND IS A BEHAVIOUR, AND THE CHECK ABOVE ONLY READS THE TABLE.
     *
     * `ranged: true, weapon: 'bowcaster'` on the wookiee's row is a claim that
     * this animal fights at a distance. Three things had to be true for that to
     * be more than two fields, and every one of them is a thing that has
     * actually been wrong in this feature before:
     *
     *   IT FIRES. `Enemy._brain` ends `if (A.melee) this._meleeBrain(…); else
     *   this._rangedBrain(…)` — one band per body off one flag — so a row that
     *   kept `melee: true` beside its new weapon would carry a bowcaster it
     *   never pulls, and the rifle pose would never run (measured by the bodies
     *   lane on a posed wookiee: a 47° bore against 0.26° through the ranged
     *   brain). `_shoot` is wrapped and counted, so this is the shipped firing
     *   door and not a bolt count that something else could have written.
     *
     *   IT STAYS OUT THERE. A shooter that walks into its own reach is a melee
     *   animal wearing a gun. The MELEE CONTROL is the massiff in the same
     *   fixture against the same hostile: it closes to about a metre and fires
     *   nothing, which is what makes both halves of this measurement mean
     *   something rather than one number with nothing to be compared to.
     *
     *   AND IT IS STILL ON THE ROPE. `preferred: [5, 12]` is bounded by the
     *   LEASH and not by the weapon — a trooper stands off at [9, 19] and the
     *   bottom rung's leash is 14 m from a station 3.4 m behind you — so the
     *   station gap is asserted inside `leashOf` at BOTH rungs. A companion
     *   that has to be recalled every time it takes a shot is not a second
     *   soldier.
     *
     * AND NEVER AT YOU. `p.damage` is wrapped and filtered on the SOURCE being
     * this body, so what is counted is the animal's own fire and not the
     * hostile's — the hostile is shooting at the player throughout, and a
     * wrapper that counted everything would report a friendly-fire disaster
     * that is nothing of the kind. `_beastBrain.hitTarget` bills whatever the
     * pick handed it with no team test of any kind, so this is a real risk on
     * the melee side and a bolt is a real risk on this one.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');

    async function bout(kind, xp) {
      const { world } = await bootWorld({
        level: 'geonosis',
        settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
        runSeed: 21,
      });
      try {
        const input = idleInput(), p = world.player;
        tick(world, input, p, 30);
        const e = C.fieldCompanion(world, p, kind,
          { rec: { id: `gun-${kind}`, kind, xp, runs: 0, tempers: [] } });
        assert(e, `${kind} would not field`);
        const at = new THREE.Vector3(p.position.x + 8, p.position.y, p.position.z);
        const foe = world.spawnEnemy('b1', at);
        assert(foe, 'no hostile to shoot at');
        foe.team = 1;
        /**
         * A DUMMY IT CANNOT KILL, and here that is not a convenience.
         * A b1 has 28 hp and one bowcaster quarrel into the head bills 46, so
         * the FIRST shot ended the fight: measured, the animal held a target
         * for 35 frames of 1800 and fired once, and the check read "it is
         * carrying a bowcaster it does not fire" over a body that had killed
         * what it was given. The pool is raised so the window measures a
         * minute of shooting instead of a second of it — the same device the
         * rung bout above uses, for the same reason.
         */
        foe.maxHp = 4000; foe.hp = foe.maxHp;
        let dealt = 0, shots = 0, onOwner = 0, closest = Infinity;
        const rawFoe = foe.damage.bind(foe);
        foe.damage = (a, ...r) => { dealt += a; const v = rawFoe(a, ...r); foe.hp = foe.maxHp; return v; };
        const shoot = e._shoot.bind(e);
        e._shoot = (...a) => { shots++; return shoot(...a); };
        p.damage = (a, pt, src) => { if (src === e) onOwner += a; return 0; };
        for (let i = 0; i < 30 * 60; i++) {
          p.hp = p.maxHp ?? 100; foe.hp = foe.maxHp; foe.position.copy(at);
          world.update(STEP, input);
          const d = e.position.distanceTo(foe.position);
          if (d < closest) closest = d;
        }
        return { shots, dealt, onOwner, closest, gap: C.stationGap(e), leash: C.leashOf(e) };
      } finally { world.unload(); }
    }

    const A = ARCHETYPES[K.COMPANION_KINDS.wook.archetype];
    assert(A.ranged && A.weapon === 'bowcaster' && !A.melee,
      `the wookiee row is ranged=${!!A.ranged} weapon=${A.weapon} melee=${!!A.melee} — this check is `
      + 'measuring a body that is no longer the one it was written for');

    const top = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1].xp;
    const sworn = await bout('wook', top);
    const green = await bout('wook', 0);
    const jaws = await bout('massiff', top);

    for (const [name, r] of [['sworn', sworn], ['green', green]]) {
      assert(r.shots >= 4, `a ${name} wookiee pulled the trigger ${r.shots} times in a minute with a `
        + 'hostile eight metres away — it is carrying a bowcaster it does not fire');
      assert(r.dealt > 0, `a ${name} wookiee fired ${r.shots} times and landed nothing at all`);
      assert(r.onOwner === 0, `a ${name} wookiee put ${r.onOwner.toFixed(0)} points into its own owner`);
      assert(r.closest > 3, `a ${name} wookiee closed to ${r.closest.toFixed(1)} m — that is a melee `
        + 'animal wearing a gun');
      assert(r.gap <= r.leash, `a ${name} wookiee finished ${r.gap.toFixed(1)} m from its station on a `
        + `${r.leash.toFixed(0)} m leash — the band is outside the rope`);
    }
    /* THE MELEE CONTROL, WHICH IS WHAT MAKES THE NUMBERS ABOVE A MEASUREMENT. */
    assert(jaws.shots === 0, `the massiff fired ${jaws.shots} times and it has no weapon — the counter `
      + 'is not counting what it says it is');
    assert(jaws.dealt > 0 && jaws.closest < 3,
      `the massiff dealt ${jaws.dealt.toFixed(0)} at ${jaws.closest.toFixed(1)} m — the control did not fight`);

    return `wookiee sworn ${sworn.shots} shots / ${sworn.dealt.toFixed(0)} dealt, closest `
      + `${sworn.closest.toFixed(1)} m, station ${sworn.gap.toFixed(1)}/${sworn.leash} m; green `
      + `${green.shots} / ${green.dealt.toFixed(0)}, closest ${green.closest.toFixed(1)} m, station `
      + `${green.gap.toFixed(1)}/${green.leash} m; 0 onto the owner either way — massiff control `
      + `${jaws.shots} shots, ${jaws.dealt.toFixed(0)} dealt at ${jaws.closest.toFixed(1)} m`;
  });

  check('companion: every kind is a row, and nothing switches on its name', async () => {
    /**
     * TWELVE KINDS OR TWELVE RESKINS, and this is the line between them.
     *
     * `Enemy.js` already has EIGHT names switched on in `custom`, which is why
     * a companion carries a FLAG and never `custom: 'companion'`. The same
     * discipline has to hold in the four new files or the twelfth kind is an
     * `else if` and the wheel says the same word for all of them.
     */
    for (const f of ['game/Companions.js', 'game/Kennel.js', 'ui/HUD.js']) {
      const code = strip(await src(f));
      for (const id of K.COMPANION_ORDER) {
        assert(!new RegExp(`['"\`]${id}['"\`]`).test(code),
          `${f} names the kind "${id}" — a kind is a ROW, and a file that knows one by name `
          + 'will know the next one by name too');
      }
    }
    /* AND EVERY FIELD ON A ROW IS READ SOMEWHERE, which is `roster.mjs`'s own
     * rule for archetypes applied to the table beside it. */
    const all = (await Promise.all(['game/Companions.js', 'game/Kennel.js', 'ui/HUD.js',
      'ui/Menu.js', 'main.js', 'game/CompanionKinds.js'].map(src))).join('\n');
    const fields = new Set();
    for (const id of K.COMPANION_ORDER) for (const f in K.COMPANION_KINDS[id]) fields.add(f);
    const unread = [...fields].filter((f) => {
      const n = (all.match(new RegExp(`\\.${f}\\b`, 'g')) || []).length;
      return n === 0;
    });
    assert(!unread.length, `kind fields nothing reads: ${unread.join(', ')}`);
    return `${K.COMPANION_ORDER.length} kinds, ${fields.size} fields all read, `
      + 'and no file names a kind';
  });

  check('companion: it is slower than you, on a real body, in every kind', async () => {
    /**
     * THE MECHANISM AND NOT A FLAVOUR NOTE. The whole protection loop rests on
     * the animal being unable to leave a fight when you do, and a companion
     * that matched your sprint could always disengage.
     *
     * MEASURED ON THE SPAWNED BODY rather than on the row, because `Enemy`
     * rolls a ±10% spread into `this.speed` at construction — a spread on top
     * of a cap is a cap exceeded one body in two, and reading the table would
     * never have caught it.
     */
    const cap = K.PLAYER_SPRINT * K.PACE_CAP;
    const rows = [];
    /**
     * A KIND WITH NO BODY IS NAMED, NOT SKIPPED.
     *
     * `continue` on a missing archetype is exactly the vacuous shape a check
     * should never have: as kinds gained bodies this loop would go on passing
     * with a floor of six while the real count was twelve, and the day
     * somebody DELETED a body it would pass too. The missing ones are counted
     * and printed in the result, so the gap is a number on the screen every
     * time the gate runs rather than something you have to go and look for.
     */
    const missing = [];
    for (const id of K.COMPANION_ORDER) {
      const A = (await import('../../src/game/Enemy.js')).ARCHETYPES[K.COMPANION_KINDS[id].archetype];
      if (!A) { missing.push(id); continue; }
      const { world, e } = await field(id, { xp: 99 });
      try {
        assert(e, `${id} would not field`);
        assert(e.speed <= cap + 1e-6,
          `a ${id} runs at ${e.speed.toFixed(2)} against a cap of ${cap.toFixed(2)} — it can outrun you`);
        rows.push(`${id} ${e.speed.toFixed(1)}`);
      } finally { world.unload(); }
    }
    assert(rows.length >= 6, `only ${rows.length} kinds have a body to measure`);
    /* AND EVERY BODY THAT EXISTS IS MEASURED — the floor above is a floor, and
     * this is the equality that makes the count honest. */
    assert(rows.length + missing.length === K.COMPANION_ORDER.length,
      `${rows.length} measured + ${missing.length} missing is not ${K.COMPANION_ORDER.length} kinds`);
    return `${rows.length} of ${K.COMPANION_ORDER.length} kinds have a body, cap ${cap.toFixed(2)} m/s: `
      + `${rows.join(', ')}`
      + (missing.length ? ` — STILL WITHOUT A BODY: ${missing.join(', ')}` : '');
  });

  check('companion: it finds enemies in a mode with no army at all', async () => {
    /**
     * THE WHOLE ARCHITECTURAL BET, AND THE CASE EVERY OTHER DESIGN FAILED.
     *
     * Nine of the eleven modes build no `CommandDirector`, and `World.
     * pickTarget`'s cross-army pass is gated on `this.command`. A companion
     * that got its targets the way a trooper does would be blind in most of
     * the game. The Levy seam answers from `world._hostilesFor`, which exists
     * unconditionally.
     *
     * The fixture asserts `!world.command` FIRST, so this can never pass by
     * accidentally having been handed an army.
     */
    const { world, input, e, p } = await field('massiff', { xp: 99 });
    try {
      assert(e, 'nothing fielded');
      assert(!world.command, 'the fixture has a CommandDirector — this proves nothing');
      const foes = [];
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57, r = 9;
        const x = p.position.x + Math.sin(a) * r, z = p.position.z + Math.cos(a) * r;
        const f = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
        if (f) { f.team = 1; foes.push(f); }
      }
      assert(foes.length >= 3, `only ${foes.length} hostiles went down`);
      let seen = 0;
      for (let i = 0; i < 30 * 20; i++) {
        p.hp = p.maxHp ?? 100;
        world.update(STEP, input);
        if (e.target && !e.target.dead) seen++;
      }
      assert(seen > 30 * 3, `it held a target for ${(seen / 30).toFixed(1)} s of twenty`);
      return `director present? ${!!world.command} — and it still held a target for `
        + `${(seen / 30).toFixed(1)} s of 20`;
    } finally { world.unload(); }
  });

  check('companion: it is not on the roll, and cannot be mustered', async () => {
    /**
     * REVIEW-V12's "what I would not touch" puts the muster, `Company.keep`
     * and permadeath out of bounds, so the feature is built AROUND that door
     * rather than through it. Four things say so, and all four are the absence
     * of something.
     */
    const { world, e } = await field('massiff', { xp: 99 });
    try {
      assert(e, 'nothing fielded');
      assert(!e.trooper, 'it has a Trooper record — it is on the roll');
      assert(!e.commandOf, 'it has a commandOf — `steer` will drive it and the muster can see it');
      assert(e.companion === true, 'nothing marks it a companion');
      const A = e.A;
      assert(A.companion === true && A.score === 0 && A.threat === 0,
        'its archetype can be scored into a wave — your own animal would appear on their side');
      assert((A.unlockAt ?? 0) > 50, `unlockAt ${A.unlockAt} — a wave could compose it`);
      return 'no trooper, no commandOf, score 0, threat 0, and no wave can spend it';
    } finally { world.unload(); }
  });

  /* ── the orders ───────────────────────────────────────────────────── */

  check('companion: the licence ladder refuses in the animal\'s own words', async () => {
    const { world, e } = await field('massiff', { xp: 0 });
    try {
      for (const o of ['heel', 'away']) {
        assert(!C.refuseOrder(e, o), `a green companion cannot ${o} — protection that needs a licence is not protection`);
      }
      const said = {};
      for (const o of ['ward', 'seek', 'hold']) {
        const why = C.refuseOrder(e, o);
        assert(why, `a green companion was allowed to ${o}`);
        assert(/until it is/.test(why), `the refusal for ${o} reads "${why}" — it does not say what would lift it`);
        said[o] = why;
      }
      e._cmpRec = { xp: 99 };
      for (const o of ['heel', 'away', 'ward', 'seek', 'hold', 'verb']) {
        assert(!C.refuseOrder(e, o), `a sworn companion is refused ${o}: ${C.refuseOrder(e, o)}`);
      }
      /* AND A KIND THAT CANNOT DO A THING IS REFUSED AT EVERY RUNG. */
      e._cmpKind = 'astro';
      assert(C.refuseOrder(e, 'ward'), 'an astromech was told to meet what comes near you');
      return `rung 0: ward "${said.ward}", hold "${said.hold}"; sworn holds all six; `
        + 'and a kind with no ward is refused at every rung';
    } finally { world.unload(); }
  });

  check('companion: AWAY will not fight, SEEK fights one thing, WARD measures from YOU', async () => {
    const { world, input, e, p } = await field('massiff', { xp: 99 });
    try {
      const put = (ang, r) => {
        const x = p.position.x + Math.sin(ang) * r, z = p.position.z + Math.cos(ang) * r;
        const f = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
        if (f) f.team = 1;
        return f;
      };
      for (let k = 0; k < 4; k++) put(k * 1.57, 5);
      assert(!C.orderCompanion(e, 'away'), 'AWAY was refused');
      let t = 0;
      for (let i = 0; i < 30 * 10; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); if (e.target) t++; }
      assert(t === 0, `AWAY still took a target on ${t} frames with four hostiles at 5 m`);

      C.orderCompanion(e, 'heel');
      tick(world, input, p, 30 * 3);
      const alive = world.enemies.filter((x) => !x.dead && x.team !== e.team);
      const want = alive[alive.length - 1];
      assert(want, 'nothing left to seek');
      assert(!C.orderCompanion(e, 'seek', want), 'SEEK was refused');
      /**
       * THE BODY IT WAS SENT AT IS KEPT ALIVE, and this is not the fixture
       * being kind to itself — it is the difference between measuring SEEK and
       * measuring what happens AFTER seek.
       *
       * `CompanionPack.update` clears `_cmpBidden` the moment the bidden body
       * dies, which is right: an order about a corpse is not an order. So the
       * eight seconds below were measuring two different things end to end —
       * a companion under SEEK, and then a companion with no order at all
       * hunting whatever was nearest. It passed or failed on whether one
       * particular B1 happened to survive the massiff for eight seconds, which
       * is a coin toss: it ran green alone and red inside the full suite, on
       * the same code, because suite order moves the RNG.
       *
       * A check whose verdict depends on that is not measuring the clause in
       * its own name. Topping the body up each frame holds the ONE variable
       * this check is about — does the aim wrap refuse every body but the
       * bidden one — and `dutyAllows` is what answers, so nothing about the
       * order path is faked by it. That the bid clears on death is the check
       * below this one's business.
       */
      let on = 0, off = 0;
      for (let i = 0; i < 30 * 8; i++) {
        p.hp = p.maxHp ?? 100;
        want.hp = want.maxHp ?? want.hp;
        world.update(STEP, input);
        if (!e.target) continue;
        if (e.target === want) on++; else off++;
      }
      assert(!want.dead, 'the body it was sent at died anyway — the fixture is not holding it');
      assert(on > 0, 'SEEK never took the body it was sent at in eight seconds');
      assert(off === 0, `SEEK spent ${off} frames on a body it was not sent at`);

      C.orderCompanion(e, 'heel');
      for (const x of world.enemies) if (!x.dead && x.team !== e.team) x.damage(x.hp + 50, x.position, null, 'bolt');
      tick(world, input, p, 30);
      assert(!C.orderCompanion(e, 'ward'), 'WARD was refused');
      /* ONE FAR FROM THE PLAYER AND CLOSE TO THE ANIMAL — the case that tells a
       * ward from a leash, and the whole reason the order exists. */
      const far = put(0, 40);
      e.position.set(far.position.x + 2, far.position.y, far.position.z);
      let bit = 0;
      for (let i = 0; i < 30 * 5; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); if (e.target === far) bit++; }
      const r = K.COMPANION_KINDS.massiff.ward;
      assert(bit === 0,
        `a ward of ${r} m took a body ${far.position.distanceTo(p.position).toFixed(0)} m from YOU `
        + `because it was ${far.position.distanceTo(e.position).toFixed(1)} m from ITSELF`);
      return `AWAY 0 frames of target with 4 hostiles at 5 m; SEEK ${on} on the named one and 0 on `
        + `anything else; WARD ${r} m from you ignored one 2 m from itself and 40 m from you`;
    } finally { world.unload(); }
  });

  check('companion: HOLD is the order you can walk away from', async () => {
    const { world, input, e, p } = await field('massiff', { xp: 99 });
    try {
      tick(world, input, p, 30 * 2);
      const spot = e.position.clone();
      assert(!C.orderCompanion(e, 'hold', spot), 'HOLD was refused');
      const from = p.position.clone();
      let worst = 0;
      for (let i = 0; i < 30 * 10; i++) {
        p.position.x = from.x + (i / 30) * 4;
        p.position.y = world.terrain.height(p.position.x, p.position.z) + 0.05;
        p.hp = p.maxHp ?? 100;
        world.update(STEP, input);
        worst = Math.max(worst, e.position.distanceTo(spot));
      }
      const leash = e._cmpLeash;
      assert(worst <= leash, `it drifted ${worst.toFixed(1)} m off its ground against a ${leash} m leash`);
      const gone = e.position.distanceTo(p.position);
      assert(gone > 20, `the owner walked ${p.position.distanceTo(from).toFixed(0)} m off and it followed `
        + `to within ${gone.toFixed(0)} m — HOLD is the order that does NOT follow you`);
      return `owner walked ${p.position.distanceTo(from).toFixed(0)} m; it held its ground to `
        + `${worst.toFixed(1)} m of ${leash} and ended ${gone.toFixed(0)} m behind`;
    } finally { world.unload(); }
  });

  /* ── keeping it alive ─────────────────────────────────────────────── */

  check('companion: your own blade answers the same gate everything else answers', async () => {
    /**
     * `takeCut` SUBTRACTS FROM `hp` DIRECTLY — its own note says why, so that a
     * sever can open the winded window — so `installTeamDamage`'s scaling never
     * sees it, and a cut the solver calls vital is `maxHp * 2`. Measured before
     * this gate, with friendly fire OFF and `canHarm` answering false: 420 hp
     * in a single frame, from a player who was not attacking.
     */
    const { canHarm } = await import('../../src/game/Player.js');
    const { world, e, p } = await field('massiff', { xp: 99 });
    try {
      assert(!canHarm(p, e, world.rules), 'the fixture has friendly fire ON — this proves nothing');
      const hp0 = e.hp;
      const took = e.damage(500, e.position, p, 'blade');
      assert(!took && e.hp === hp0, `your own blade took ${(hp0 - e.hp).toFixed(0)} hp with friendly fire off`);
      const cut = e.takeCut({ cap: {}, impulse: new THREE.Vector3(1, 0, 0), point: e.position, cutT: 0.5 }, p);
      assert(cut === null && e.hp === hp0, `your own blade cut it with friendly fire off`);
      /* …AND A HOSTILE STILL HURTS IT, which is the control case: a gate that
       * refused everybody would be an immortal companion. */
      const before = e.hp;
      e.damage(20, e.position, { team: 1, position: e.position }, 'bolt');
      assert(e.hp < before, 'a hostile could not hurt it either — it is immortal');
      return `friendly fire off: canHarm ${canHarm(p, e, world.rules)}, blade 500 dmg → 0, a vital cut → `
        + `refused; a hostile's 20 → ${(before - e.hp).toFixed(0)} through`;
    } finally { world.unload(); }
  });

  check('companion: it persists only if it got out, and the fold is not bank()', async () => {
    /**
     * THE DEFAULT IS SILENT IMMORTALITY. `Company.keep` strikes off every
     * deployed name not on the manifest, and a companion is on NO roster, so
     * it is invisible to that rule and would never die.
     *
     *     persists  ⟺  alive AND (won OR aboard)
     *
     * No branch for a run that went badly, because that is exactly when a
     * player would want one.
     */
    const main = strip(await readFile(new URL('../../src/main.js', import.meta.url), 'utf8'));
    assert(/foldCompanion\(/.test(main), 'nothing folds the companion');
    assert(!/bank\([^)]*\)[^;]*keepCompanion/.test(main),
      'the fold rides bank(), which returns early in six modes the companion is present in');
    const rec = { id: 'a', kind: 'massiff', xp: 20, runs: 2, tempers: [] };
    const cases = [
      { name: 'alive and won', alive: true, won: true, aboard: false, keep: true },
      { name: 'alive and aboard', alive: true, won: false, aboard: true, keep: true },
      { name: 'alive, lost, left standing', alive: true, won: false, aboard: false, keep: false },
      { name: 'dead but won', alive: false, won: true, aboard: true, keep: false },
    ];
    const said = [];
    for (const c of cases) {
      Kn.save({ live: { ...rec }, fallen: [], runs: 0, lost: 0 });
      const w = {
        netMode: null, settings: { level: 'geonosis' }, elapsed: 120,
        _companion: true,
        _companions: { body0: { dead: !c.alive, downed: false }, aboard: c.aboard, lastKiller: 'B1' },
      };
      const out = Kn.keepCompanion(w, { won: c.won });
      assert(out, `${c.name}: the fold did nothing`);
      assert(out.kept === c.keep, `${c.name}: kept=${out.kept}, expected ${c.keep}`);
      const after = Kn.load();
      assert(!!after.live === c.keep, `${c.name}: the store disagrees with the verdict`);
      if (!c.keep) {
        assert(after.fallen.length === 1, `${c.name}: no epitaph was kept`);
        assert(after.fallen[0].fate === (c.alive ? 'left' : 'kia'),
          `${c.name}: the epitaph says ${after.fallen[0].fate}`);
      }
      said.push(`${c.name} → ${out.kept ? 'kept' : `gone (${after.fallen[0]?.fate})`}`);
    }
    /**
     * AND A SESSION FOLDS NOW, WHICH IS A CHANGE OF ANSWER AND NOT A CHANGE OF
     * RULE.
     *
     * `keepCompanion` used to open `if (world.netMode) return null` and the
     * lobby card said so: field it for everybody, fold it for nobody. That was
     * honest while the host's animal was the only one on the field — a client
     * had nothing out there to fold. Each commander brings their own now, on
     * their own record, and `pack.mine` is the one out of the pack that is
     * yours, so the two questions above have answers on every machine.
     * tools/checks/coop.mjs drives the whole of it against real endpoints; this
     * is the unit statement of the two ends.
     *
     * WHAT REPLACED THE BLANKET REFUSAL IS THE GUARD IT WAS REALLY MAKING. A
     * run that fielded nothing of yours — a session that dropped before the
     * body arrived, a host that fields none — leaves the kennel completely
     * alone, so a NETWORK event can never turn a living record into an
     * epitaph. That is the clause that must not regress.
     */
    Kn.save({ live: { ...rec }, fallen: [], runs: 0, lost: 0 });
    const inSession = Kn.keepCompanion({ netMode: 'host', settings: { level: 'geonosis' },
      elapsed: 90, _companions: { mine: { dead: true }, body0: { dead: true } } }, { won: false });
    assert(inSession && inSession.kept === false && !Kn.load().live,
      'a session no longer folds an animal that died in one');
    Kn.save({ live: { ...rec }, fallen: [], runs: 0, lost: 0 });
    const none = Kn.keepCompanion({ netMode: 'client',
      _companions: { mine: null, body0: null } }, { won: false });
    assert(none === null && !!Kn.load().live,
      'a run in which nothing of yours was fielded killed the animal in your kennel');
    Kn.clear();
    return said.join('; ') + '; a session folds what it fielded, and folds nothing it did not';
  });

  check('companion: there is one, and there is no door to a second', async () => {
    /**
     * "a companion that adds a body to the line is `company.mjs`'s 'rank, not
     * headcount' defect with fur on it" — and the body budget is the other
     * half: four commanders is up to four permanently-LOD-0 bodies before a
     * single droid spawns, against a measured ceiling of 40-60.
     */
    const kn = strip(await src('game/Kennel.js'));
    assert(/live:/.test(kn) && !/\blive\s*:\s*\[/.test(kn),
      'the Kennel holds a LIST of live companions rather than one');
    Kn.clear();
    const a = Kn.adopt('massiff', 'One');
    const b = Kn.adopt('tooka', 'Two');
    assert(a && b, 'adopt refused');
    const k = Kn.load();
    assert(k.live && k.live.name === 'Two', 'adopting a second did not replace the first');
    assert(!Array.isArray(k.live), 'the live record is a list');
    /* AND A SECOND ADOPTION IS A RETIREMENT AND NOT A DEATH — no epitaph, no
     * `lost` count. Swapping pets is not a killing. */
    assert(k.fallen.length === 0, 'swapping companions wrote an epitaph');
    assert((k.lost | 0) === 0, `swapping companions counted ${k.lost} lost`);
    Kn.clear();
    return 'one live record; a second adoption replaces it with no epitaph and no loss counted';
  });

  check('companion: the wheel says something different for every kind and every rung', async () => {
    /**
     * THE ONLY REASON THIS IS A WHEEL AND NOT SIX KEYBINDS. A cold slot that
     * does not say why it is cold is a control a player concludes is broken,
     * and one slot that means twelve things is what stops twelve kinds being
     * twelve reskins.
     */
    const { CompanionWheel } = await import('../../src/ui/HUD.js');
    const w = new CompanionWheel(null);
    assert(w.items.length >= 5, `the wheel has ${w.items.length} slots`);
    assert(!w.items.some((i) => i.id === 'heel'),
      'HEEL is on the ring — it is the DEADZONE, which is the one order you want with no time to aim');
    const empty = w.captionFor(w.items[0]);
    assert(/nothing of yours/i.test(empty), `with no companion the wheel says "${empty}"`);
    const verb = w.items.find((i) => i.id === 'verb');
    const labels = new Set(), caps = new Set();
    for (const id of K.COMPANION_ORDER) {
      w.body = { _cmpKind: id, _cmpRec: { xp: 99 }, dead: false };
      labels.add(w.titleFor(verb));
      caps.add(w.captionFor(verb));
    }
    assert(labels.size === K.COMPANION_ORDER.length,
      `${K.COMPANION_ORDER.length} kinds produce only ${labels.size} distinct verb names`);
    assert(caps.size === K.COMPANION_ORDER.length, `only ${caps.size} distinct verb captions`);
    /* AND THE REFUSAL IS THE ANIMAL'S OWN SENTENCE, not "locked". */
    w.body = { _cmpKind: 'massiff', _cmpRec: { xp: 0 }, dead: false };
    const cold = w.captionFor(w.items.find((i) => i.id === 'hold'));
    assert(/until it is/.test(cold), `a cold slot reads "${cold}"`);
    assert(!/[Ll]ocked/.test(cold), 'a cold slot says "locked", which tells the player nothing');
    return `${w.items.length} slots, ${labels.size} distinct verbs across ${K.COMPANION_ORDER.length} kinds; `
      + `empty reads "${empty}"; cold reads "${cold}"`;
  });
  check('companion: it boards the transport, and the manifest is untouched', async () => {
    /**
     * "they will be with you in the hangar as well and follow you on/off ships"
     *
     * BOARDING IS FREE AND THE FOLD IS NOT. `Extraction._walkTroops` selects on
     * `e.team !== team` with NO trooper test (verified at :1732), so the animal
     * queues by distance with the line, has its `_boardPos` fixed once, climbs
     * the ramp and is seated — not one line of that written for this feature.
     *
     * WHAT IS NOT FREE is that `Extraction.manifest` is
     * `this._seated.map((b) => b.trooper).filter(Boolean)`, so the companion
     * gets on the ship and then does not appear on the list that decides who
     * survived. `Company.keep` reads exactly that array and may not be
     * reopened, so this asserts BOTH halves: the animal is aboard, and the
     * manifest is exactly the men it would have been without it.
     */
    const { world, input, e, p } = await field('massiff', { xp: 99 }, { instantSpawn: false, allies: 4 });
    try {
      assert(e, 'nothing fielded');
      const X = world.extraction;
      assert(X, 'no extraction to board');
      const before = (X.manifest || []).length;
      /* `begin` TAKES THE NEXT LEVEL'S KEY and answers false without one —
       * calling it bare is how this check first "passed" by returning early. */
      assert(X.begin('geonosis'), 'the extraction refused to begin');
      const pack = world._companions;
      let at = null;
      for (let i = 0; i < 30 * 100 && !pack.aboard; i++) {
        p.hp = p.maxHp ?? 100;
        world.update(STEP, input);
        if (pack.aboard) at = i / 30;
        if (e.dead) break;
      }
      assert(!e.dead, 'it died before the ramp');
      assert(pack.aboard, `it never got aboard — _extracting is "${e._extracting}"`);
      /* AND THE MANIFEST IS THE MEN. A companion on it would be struck off by
       * `keep()` as a name that deployed and did not come back, or worse would
       * take a seat off a man who then is. */
      /**
       * THE PRECISE CLAIM, and "the manifest did not grow" is too weak to be
       * it: with nobody else aboard the list is empty either way, and an empty
       * list agrees with everything.
       *
       * What has to be true is BOTH at once — the animal is in `_seated`, so
       * it genuinely got on the ship and is genuinely carried; and it is NOT
       * on `manifest`, because that array is what `Company.keep` strikes the
       * roll against, and a companion on it is a name that deployed and did
       * not come back.
       */
      const seated = X._seated || [];
      assert(seated.includes(e), `it reports aboard but is not in _seated (${seated.length} bodies)`);
      const after = X.manifest || [];
      assert(!after.includes(e), 'the companion is ON the manifest — keep() will judge it as a man');
      assert(after.length === seated.filter((b) => b.trooper).length,
        `the manifest is ${after.length} of ${seated.length} seated bodies — it should be exactly `
        + 'the ones with a roster record');
      return `queued with the line and seated at ${at?.toFixed(1)} s (_extracting "${e._extracting}"); `
        + `in _seated with ${seated.length - 1} other bodies, and the manifest is `
        + `${after.length} roster records — not one of them the animal`;
    } finally { world.unload(); }
  });

  check('companion: every kind is visibly bigger and visibly different after four runs', async () => {
    /**
     * *"A companion that has survived four runs should be visibly bigger and
     * visibly different."*
     *
     * ── AND TWO OF TWELVE WERE BYTE-IDENTICAL ────────────────────────────
     *
     * A hostile pass built every kind at `{runs: 0}` and at `{runs: 16, care:
     * 14}` and read the geometry back. Ten changed. The tooka and the hawk did
     * not — no `grow` block at all, so `bodyScaleOf` returned the archetype's
     * scale unchanged and no mark was ever asked for. Two rows nobody filled
     * in, and nothing in this suite asked, because every growth clause here
     * named a kind that has one.
     *
     * SO IT IS DRIVEN ACROSS `COMPANION_ORDER` AND NOT A LIST, on the shipped
     * build call, and the two halves are asserted separately because they are
     * two different promises: BIGGER is `bodyScaleOf`, which is one number and
     * cheap; DIFFERENT is geometry, and is read as a vertex count off the real
     * body — a mark that is merged into an existing mesh moves no mesh count
     * and no bounding box, which is how the astromech's dish and the B1's
     * plate looked like nothing happening.
     */
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    const FRESH = { runs: 0, meals: 0, grooms: 0 };
    const VETERAN = { runs: 16, meals: 14, grooms: 14 };
    const verts = (root) => {
      let n = 0;
      root.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) n += o.geometry.attributes.position.count; });
      return n;
    };
    const flat = [], rows = [];
    for (const id of K.COMPANION_ORDER) {
      const kind = K.COMPANION_KINDS[id];
      const A = ARCHETYPES[kind.archetype ?? id];
      const s0 = K.bodyScaleOf(id, FRESH), s1 = K.bodyScaleOf(id, VETERAN);
      /* THE MARK RIDES THE BUILD THE WAY `fieldCompanion` SENDS IT: `grown` is
       * the maturity and `marks` is the kind's own id. Spelled here the way
       * CompanionDeck spells it, so a build that stopped reading either would
       * fail rather than be quietly ignored. */
      const g = kind.grow || null;
      const a = A.build({ scale: s0, grown: 0, marks: null });
      const b = A.build({ scale: s1, grown: K.maturityOf(VETERAN), marks: g?.marks || null });
      const grew = s1 / s0;
      const va = verts(a.rig?.root || a.root || a), vb = verts(b.rig?.root || b.root || b);
      rows.push(`${id} ×${grew.toFixed(2)} ${va}→${vb}v`);
      /**
       * TWO WAYS TO CHANGE AND A KIND MUST DO ONE, and which one is the row's
       * own declaration rather than this file's opinion. An ORGANIC grows —
       * `to > 1`, and the size is the visible half. A MACHINE is FITTED —
       * `to === 1`, and a droid that got taller with age would be a droid
       * nobody built; what an astromech gains is a dish, and a B1 gains plate,
       * merged into the meshes they already have. So the machine half is read
       * as VERTICES, which is the only place a merged mark shows: the mesh
       * count and the bounding box do not move for either of them, which is
       * exactly how they looked like nothing happening.
       */
      if (!g) { flat.push(`${id} declares no growth at all`); continue; }
      if ((g.to ?? 1) > 1) {
        if (grew < 1.05) flat.push(`${id} declares ×${g.to} and measured ×${grew.toFixed(2)}`);
      } else if (vb <= va) {
        flat.push(`${id} is fitted rather than grown and gained no geometry — `
          + `${va} vertices either way, so the "${g.marks}" it declares is a promise nothing keeps`);
      }
    }
    assert(!flat.length,
      `${flat.length} of ${K.COMPANION_ORDER.length} kinds do not change:\n      ${flat.join('\n      ')}`);
    /* AND EVERY DECLARED MARK IS A MARK THE TABLE KNOWS, so a typo in a `grow`
     * row is a red rather than a silently absent feature. */
    for (const id of K.COMPANION_ORDER) {
      const g = K.COMPANION_KINDS[id].grow;
      if (!g?.marks) continue;
      assert(K.GROWTH_MARKS[g.marks],
        `${id} grows "${g.marks}" and GROWTH_MARKS has no such mark — the player is told nothing`);
    }
    const fitted = K.COMPANION_ORDER.filter((id) => (K.COMPANION_KINDS[id].grow?.to ?? 1) === 1);
    return `${K.COMPANION_ORDER.length} kinds all change: ${K.COMPANION_ORDER.length - fitted.length} `
      + `grow, ${fitted.length} are fitted (${fitted.join(', ')}) — ${rows.join(', ')}`;
  });

  check('companion: the colours you pick reach the geometry — every kind, every slot', async () => {
    /**
     * "you can customize their appearance to a degree"
     *
     * THIS LIGHTS CODE THAT HAD SHIPPED FOR MONTHS UNREACHED. `buildQuadruped`
     * accepts `opts.hide`, `opts.plate`, `opts.belly` and `opts.eye` and
     * NOTHING in the tree had ever handed it anything but the plan's own
     * defaults — every creature in the game was wearing its factory colours
     * because there was no door.
     *
     * ── AND THEN THIS CHECK DROVE A QUARTER OF THE FEATURE IT IS NAMED FOR ──
     *
     * It looped `COMPANION_LOOK.creature` **on a massiff**: four slots, one
     * kind, one of the four look rows. `COMPANION_LOOK` has FOUR rows and
     * twelve kinds wear them, which is forty controls, and the other thirty-six
     * were never touched. Driven across all twelve the first time this loop was
     * widened, SEVEN were dead:
     *
     *   b1c   shell / trim / photoreceptor / panels — the whole droid row.
     *         `buildB1` read `opts.color`, `opts.markColor` and `opts.eyeColor`,
     *         which are three different words; `buildAstromech` and `buildMedic`
     *         read the slot names and always had, so the defect was one builder
     *         out of three and invisible from any of the other two.
     *   taun / blurrg / varac   `blanket`. The word did not appear in
     *         `Bodies.js` at all.
     *
     * `Menu._companionDressHtml` renders a swatch row per slot off the table
     * regardless of whether anything reads it, and `Kennel.saneLook` persists
     * all eleven names — so the player picked a colour, watched the game save
     * it, and got the same body back. A check named "the colours you pick reach
     * the geometry" passing on a quarter of the feature it names is HANDOFF
     * §2.3b: a check that cannot fail over the part nobody was looking at.
     *
     * ── HOW IT IS DRIVEN NOW ─────────────────────────────────────────────
     *
     * `COMPANION_ORDER` → each kind's own `look` row → `COMPANION_LOOK` for
     * the slots that row names → the kind's archetype builder, through
     * `A.build({ scale: A.scale, ...companionOptsFrom(look) })`, which is the
     * call `CompanionDeck.js:377` makes verbatim. Not a list of kinds and not a
     * list of slots: a kind added tomorrow, or a slot added to a row tomorrow,
     * is driven the day it lands, which is the whole reason the gap lasted.
     *
     * DRIVEN ONE SLOT AT A TIME. Painting all four at once and finding the body
     * changed would not tell you whether four slots are wired or one is: so
     * each is painted alone, and each has to move the body on its own and move
     * it DIFFERENTLY for a different colour.
     *
     * AND THE EYE IS EMISSIVE, which the first version of this missed
     * completely. It collected `material.color` only, so the eye slot read as
     * "adds nothing" and looked like a dead control — it is `emissiveMat`, and
     * its colour lives on `material.emissive`. A check that reads half the
     * material is a check that reports half the truth.
     *
     * EVERY FAILURE IS COLLECTED RATHER THAN THROWN AT THE FIRST ONE. Seven
     * dead slots reported one at a time is seven runs of this suite; the point
     * of widening it was to see the whole surface at once.
     */
    const { paintById, companionOptsFrom } = await import('../../src/game/Bodies.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');

    const hues = (root) => {
      const out = new Set();
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (o.material.color) out.add('c' + o.material.color.getHex());
        if (o.material.emissive) out.add('e' + o.material.emissive.getHex());
      });
      return out;
    };

    const dead = [], live = [];
    let slots = 0;
    for (const id of K.COMPANION_ORDER) {
      const kind = K.COMPANION_KINDS[id];
      const row = K.COMPANION_LOOK[kind.look];
      assert(row?.length,
        `${id} declares look row "${kind.look}" and COMPANION_LOOK has no such row — `
        + 'the picker would render an empty dress panel for it');
      const A = ARCHETYPES[kind.archetype ?? id];
      assert(A && typeof A.build === 'function',
        `${id} names archetype "${kind.archetype ?? id}" and nothing builds it`);
      /* The shipped call, spelled the way CompanionDeck.js:377 spells it. */
      const put = (look) => {
        const built = A.build({ scale: A.scale ?? 1, ...companionOptsFrom(look) });
        const root = built?.rig?.root ?? built?.group;
        assert(root, `${id} built neither a rig nor a group`);
        return hues(root);
      };
      const factory = put(undefined);
      for (const f of row) {
        slots++;
        const a = [...put({ [f]: 'sky' })].filter((h) => !factory.has(h));
        const b = [...put({ [f]: 'blood' })].filter((h) => !factory.has(h));
        if (!a.length) { dead.push(`${id}.${f} paints nothing`); continue; }
        if (a.join() === b.join()) { dead.push(`${id}.${f} paints Sky and Blood the same`); continue; }
        live.push(`${id}.${f}`);
      }
    }
    assert(!dead.length,
      `${dead.length} of ${slots} shipped colour controls change nothing on the body the player owns — `
      + `${dead.join('; ')}. Every one of them still draws a swatch row in the picker and is still `
      + 'persisted by Kennel.saneLook.');
    assert(live.length === slots, `${live.length} slots reported live out of ${slots} walked`);

    /* ── AND THE SHIPPED FIELD PATH CARRIES ONE, which the loop above cannot
     * say: it calls the builder directly. `fieldCompanion` goes through
     * `Enemy._build`, which is where `companionOptsFrom(this._cmpLook)` is
     * spread, and that is the door a look reaches the battlefield by. */
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
      runSeed: 4,
    });
    try {
      const input = idleInput();
      for (let i = 0; i < 30; i++) world.update(STEP, input);
      const fielded = (look) => {
        const e = fieldCompanion(world, world.player, 'massiff', { rec: { xp: 9, look } });
        const out = new Set();
        const eat = (o) => {
          if (!o.isMesh || !o.material) return;
          if (o.material.color) out.add('c' + o.material.color.getHex());
          if (o.material.emissive) out.add('e' + o.material.emissive.getHex());
        };
        e.group?.traverse?.(eat);
        e.rig?.root?.traverse?.(eat);
        return out;
      };
      const stock = fielded(undefined);
      const painted = [...fielded({ hide: 'sky' })].filter((h) => !stock.has(h));
      assert(painted.length,
        'a companion FIELDED with a saved hide is wearing its factory colours — the look never '
        + 'reaches Enemy._build, so the whole feature is a hangar preview');
      /* THE SAME CHOICE IS THE SAME ANIMAL, twice running. */
      const r1 = [...fielded({ hide: 'sun' })].sort().join();
      const r2 = [...fielded({ hide: 'sun' })].sort().join();
      assert(r1 === r2, 'the same colour built two different bodies');
      /* AND AN ID THIS BUILD DOES NOT HAVE IS THE FACTORY HIDE, NOT BLACK.
       * `paintById` answers null for an unknown id and a null slot is simply
       * absent, which the builder reads as the plan's own colour — so a save
       * from a build with a wider palette degrades to the animal it was born
       * as rather than to a silhouette. */
      const bad = [...fielded({ hide: 'nonesuch' })].sort().join();
      assert(bad === [...stock].sort().join(),
        'an unknown colour id built something other than the factory animal');
      assert(paintById('nonesuch') === null, 'paintById invented a colour');
      return `${slots} controls over ${K.COMPANION_ORDER.length} kinds and `
        + `${Object.keys(K.COMPANION_LOOK).length} look rows, every one of them moving its own body and `
        + 'moving it differently for a different colour; the fielded body wears the saved hide; '
        + 'the same pick is stable; an unknown id is the factory hide';
    } finally { world.unload(); }
  });

  check('companion: a body in no squad still stops being under fire', async () => {
    /**
     * `underFire` IS WRITTEN BY ONE DOOR AND DECAYED IN ANOTHER, AND THE
     * COMPANION ONLY GOES THROUGH THE FIRST.
     *
     * `installTeamDamage` writes it — every injury goes through that door,
     * which is exactly why the companion gets the flag for free — and it is
     * decayed in one place only: `CommandDirector._troops`' walk over
     * `squadsOf(c)`. A companion is deliberately in no squad, so without this
     * the flag latches at UNDER_FIRE and stays there for the rest of the level.
     *
     * It is not cosmetic. `_coverSite` puts a body that is under fire into
     * cover-seeking with a lean, off a `_fireEpoch` that only advances when
     * the spell ENDS — so a companion whose spell never ends hunts cover from
     * a shot it took two minutes ago, and hunts the SAME crate all run.
     */
    const { world, input, e, p } = await field('massiff', { xp: 9 });
    try {
      e.damage(5, e.position, { team: 1, position: e.position }, 'bolt');
      const lit = e.underFire;
      assert(lit > 0, 'a hostile bolt did not mark it under fire at all');
      tick(world, input, p, 30 * 12);
      assert(e.underFire === 0,
        `twelve seconds after one bolt it is still under fire at ${e.underFire.toFixed(2)} — `
        + 'the flag has latched, and it will hunt cover from that shot for the rest of the level');
      return `one hostile bolt → ${lit.toFixed(2)}; twelve seconds later → ${e.underFire.toFixed(2)}`;
    } finally { world.unload(); }
  });

  check('companion: a session is told to you before you join, not discovered after', async () => {
    /**
     * IT SAID SOMETHING ELSE, AND THE SOMETHING ELSE WAS TRUE AT THE TIME: "in
     * a session only the host's companion takes the field. Yours stays in the
     * kennel." One shared setting, one body, the host's — and the line existed
     * so a joining player was told rather than left to find out their animal
     * was missing.
     *
     * EACH COMMANDER BRINGS ONE NOW, so the sentence changed with the feature
     * and the two roles are told the SAME thing, because they get the same
     * thing. That is the assertion: a line that still split host from guest
     * would be describing a limitation that no longer exists, which is the
     * defect this check is now pointed at.
     *
     * BOTH HALVES STILL HAVE TO BE SAID, and they are different halves now —
     * your animal IS on the field, and what it does out there is not banked
     * (`CompanionPack._ledger` refuses to award off a net-driven body and says
     * why at length), and it CAN be lost, because the host is really
     * simulating it. A player who finds any of that out afterwards has been
     * cheated of an evening, which is `notSaving()`'s argument one panel
     * across.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const settings = { ...structuredClone(DEFAULT_SETTINGS), companion: 'massiff' };
      const menu = new Menu(settings, {});
      const line = () => doc.getElementById('companion-coop')?.textContent || '';
      menu._syncKennel();
      assert(!line(), `solo, the screen says "${line()}" about a session`);
      menu.netSession('host');
      const said = line();
      menu.netSession('client');
      const asClient = line();
      assert(asClient === said,
        `a joining player is told "${asClient}" and a host "${said}" — they field the same thing `
        + 'now, so a split line is a description of a limitation that is gone');
      assert(!/stays in the kennel|only the host/i.test(said),
        `the screen still says "${said}" — that was true of the build where one setting fielded `
        + 'one animal, and it is not true of this one');
      menu.netSession('host');
      assert(/comes with you/i.test(said) && /commander/i.test(said),
        `hosting with a companion, the screen says "${said}" — it does not say the animal is `
        + 'yours and on the field');
      assert(/will not earn|not earn a rung/i.test(said) && /can be lost/i.test(said),
        'it says the animal comes with you but not what a session does and does not keep — both '
        + 'halves matter, and the second one is that it CAN be lost now');
      /* AND IT IS NOT SAID WHEN THERE IS NOTHING TO SAY IT ABOUT. */
      settings.companion = 'none';
      menu._syncKennelCoop();
      assert(!line(), `with no companion it still says "${line()}"`);
      menu.netSession(null);
      settings.companion = 'massiff';
      menu._syncKennelCoop();
      assert(!line(), 'it warns about a session when there is no session');
      return `silent solo, silent with no animal; both roles told the same: "${said.slice(0, 72)}…"`;
    } finally { restore(); }
  });

  check('companion: it is on the deck with you, it follows, and it sits down', async () => {
    /**
     * "They will be with you in the hangar as well"
     *
     * TWO REPRESENTATIONS OF ONE RECORD, and the refusal is verified rather
     * than assumed: the hangar World deliberately has NO CommandDirector,
     * because `main.bank()` treats any world with `.command` as a battle and
     * would strike the whole roll on every hangar visit. Putting a live
     * `Enemy` in that room drags `_think`, targeting, the LOD ladder and the
     * death path into a scene built without any of them. So the deck body is
     * its own thing and the Kennel record is the only thing that crosses.
     *
     * AND IT SITS, which is the pose that has no home anywhere in this tree:
     * every walker advances `walkPhase` at a floor of 0.1, so a standing
     * quadruped cycles its legs on the spot forever. On a battlefield nobody
     * looks long enough to notice. In a room you walk around for minutes it is
     * the whole difference between a companion and a prop that jogs in place.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    Kn.clear();
    Kn.adopt('massiff', 'Borz');
    const { world } = await bootWorld({
      level: 'hangar',
      settings: { mode: 'hangar', level: 'hangar', allies: 0, quality: 'low' },
      runSeed: 2,
    });
    try {
      const input = idleInput();
      for (let i = 0; i < 60; i++) world.update(STEP, input);
      const fig = world._companionDeck;
      assert(fig, 'nothing of yours came up in the lift');
      assert(fig.rec.name === 'Borz', `the deck body is "${fig.rec.name}" and not the animal in the kennel`);
      const p = world.player;
      /* `fig.pos` AND NOT `fig.root.position`: both deck solvers write the
       * pelvis in world coordinates onto a bone parented to `rig.root`, which
       * is only correct while that root is identity — so the root sits at the
       * origin and the ground point is the fig's. Reading the root here would
       * measure the distance from the player to the middle of the map. */
      const gap = () => fig.pos.distanceTo(p.position);
      /* IT ARRIVES AT YOUR HEEL. `callTheCompanion` runs while the ROOM is
       * built and the player is placed after it, so without the arrival snap
       * the body starts at the world origin — measured at 92.9 m, jogging in
       * from the far bulkhead every time you step off the lift. */
      assert(gap() < 6, `it came up in the lift and is ${gap().toFixed(1)} m away`);
      const sat = fig.sit;
      assert(sat > 0.8, `standing still beside you it is only ${sat.toFixed(2)} sat down`);

      /**
       * AND ITS LEGS ARE IN THE BIND POSE, WHICH IS WHAT THIS CHECK COULD NOT
       * SEE FOR A WHOLE ROUND.
       *
       * The preamble above has always said the deck animal "slid across the
       * deck plates like a chess piece" and this check passed with the feet
       * frozen, because not one line of it ever read a leg bone. Re-measured
       * on the shipped tree before the fix: all sixteen of a massiff's leg
       * bones moved 0.000000 rad from rest and 0.000000 rad frame to frame
       * over eight seconds, while `fig.phase` reached 13.44 and the head
       * moved 0.802. `fig.phase` had a writer in `stepCompanionDeck` and no
       * reader anywhere in `src/`.
       *
       * THE FRAME-TO-FRAME DELTA IS THE ONE THAT MATTERS. A body posed once
       * into a wrong constant pose shows a large deviation from rest and zero
       * movement; only the per-frame step can tell a gait from a statue.
       */
      const rig0 = fig.built.rig;
      const named = legBonesOf(rig0);
      assert(named.length, 'the deck body has no leg bone this check knows how to name');
      const prev = new Map(named.map((n) => [n, rig0.get(n).obj.quaternion.clone()]));
      let legSum = 0, legN = 0, legRot = 0;

      /* IT FOLLOWS, and it stands up to do it. The deck's own walls stop the
       * player after a couple of metres in this fixture, which is enough:
       * what is measured is that the gap is HELD and that the sit lifts. */
      let minSit = 1, moved = 0;
      /* THE STANDING SAMPLE IS TAKEN AT THE MOMENT IT IS MOST STANDING, and
       * that is not "after the loop": the fixture's player hits a bulkhead
       * two and a half metres in, stops, and the animal is fully sat again by
       * the last frame — so a sample taken at the end compares the sit with
       * itself and reads 0.004 rad, which is what the first cut of this
       * measured and called a failure. */
      let hipStand = hipStateOf(fig);
      const from = p.position.clone();
      for (let i = 0; i < 30 * 3; i++) {
        p.position.x += 4 * STEP;
        world.update(STEP, input);
        if (fig.sit < minSit) hipStand = hipStateOf(fig);
        minSit = Math.min(minSit, fig.sit);
        moved = p.position.distanceTo(from);
        for (const n of named) {
          const b = rig0.get(n);
          /* THE MEAN AND NOT THE MAX. Every rigged body in this game shows a
           * one-frame worst case of π on a leg bone — a shipped company man
           * marching across this same deck measures 3.14 too — because the
           * quaternion angle counts the bone's ROLL about its own axis and
           * the IK flips it through the swing. A max is therefore the same
           * number on a working gait and on a broken one; the mean over every
           * bone and every frame is not, and a statue's is exactly zero. */
          legSum += b.obj.quaternion.angleTo(prev.get(n));
          legN++;
          legRot = Math.max(legRot, b.obj.quaternion.angleTo(b.restQuat));
          prev.get(n).copy(b.obj.quaternion);
        }
      }
      assert(moved > 1, `the fixture only moved the player ${moved.toFixed(2)} m — it proves nothing`);
      assert(minSit < 0.8, `it stayed ${minSit.toFixed(2)} sat down while you walked ${moved.toFixed(1)} m`);
      assert(gap() < 6, `after walking it is ${gap().toFixed(1)} m behind`);
      const legStep = legN ? legSum / legN : 0;
      assert(legStep > 0.01,
        `walking ${moved.toFixed(1)} m, [${named.join(', ')}] averaged `
        + `${legStep.toFixed(6)} rad of movement a frame — the feet are frozen and the body is sliding`);
      assert(legRot > 0.1,
        `its legs never leave the bind pose: ${legRot.toFixed(6)} rad off rest at the widest`);

      /* AND IT SITS BACK DOWN. */
      for (let i = 0; i < 30 * 5; i++) world.update(STEP, input);
      assert(fig.sit > 0.8, `you stopped and it is still only ${fig.sit.toFixed(2)} sat`);

      /**
       * AND THE SIT IS A FOLD AND NOT A CRANE. What was there: the root sank
       * by `sit * hip * 0.35` and tipped `sit * -0.12`, so not one joint in
       * the animal moved and its feet went through the plates on the way
       * down. Two measurements, because either alone is satisfied by the old
       * code: the hind SOCKET has to have turned, and the pelvis has to be
       * lower than it was standing.
       */
      const hipSat = hipStateOf(fig);
      const fold = hipStand.q.angleTo(hipSat.q);
      const sank = hipStand.y - hipSat.y;
      assert(fold > 0.05,
        `sat, its hind hip socket is ${fold.toFixed(4)} rad from where it stood — nothing folded`);
      assert(sank > 0.02,
        `sat, its pelvis is ${(sank * 100).toFixed(1)} cm lower than standing — the haunches did not drop`);

      /**
       * AND IT IS PUSHABLE THROUGH A PUBLISHED EXTENSION POINT — ASKED OF THE
       * CONSUMER, WHICH IS THE HALF THIS USED TO MISS.
       *
       * What was here: `world._deckProps.some(x => x.kind === 'companion')`,
       * with the message "you can walk through your own dog". The entry was
       * there and the dog was walked through anyway: `deckBladeTargets` opens
       * `const sh = row?.shove; if (!sh …) return`, and nothing this file
       * pushed had ever carried a `shove`. So the assertion held for a whole
       * round over a body the blade could not touch — HANDOFF §2.3b, a check
       * whose subject was the writer and never the reader.
       *
       * It asks the reader now: the real `deckBladeTargets`, from where the
       * player is standing, has to hand back a capsule for this animal — and
       * hitting it has to MOVE it, which is the only thing that proves the
       * `shatter` on the far end of that capsule reaches this body at all.
       */
      const { deckBladeTargets } = await import('../../src/game/Hangar.js');
      const offered = deckBladeTargets(world, fig.pos, 6);
      const mine = offered.find((t) => t.prop && t.capsules?.[0]
        && t.capsules[0].p0.distanceTo(fig.pos) < 1.0);
      assert(mine,
        `the deck's blade is offered ${offered.length} bodies within 6 m and none of them is `
        + 'yours — you can walk through your own dog');
      const before = fig.pos.clone();
      mine.prop.shatter(new THREE.Vector3(1, 0, 0), fig.pos.clone());
      for (let i = 0; i < 10; i++) world.update(STEP, input);
      const knocked = before.distanceTo(fig.pos);
      assert(knocked > 0.1,
        `a lit blade through it moved it ${(knocked * 100).toFixed(1)} cm — the capsule is offered `
        + 'and nothing on the other side of it reaches the animal');
      /* AND IT COMES BACK TO YOUR HEEL rather than staying where it was put. */
      for (let i = 0; i < 30 * 4; i++) world.update(STEP, input);
      assert(gap() < 6, `shoved ${knocked.toFixed(2)} m, it never came back — ${gap().toFixed(1)} m off`);
      return `arrived ${gap().toFixed(1)} m off your heel, sat ${sat.toFixed(2)}; walking `
        + `${moved.toFixed(1)} m stood it up to ${minSit.toFixed(2)} with its legs moving `
        + `${legStep.toFixed(3)} rad a frame on average and ${legRot.toFixed(2)} off rest; stopping sat it `
        + `again at ${fig.sit.toFixed(2)}, folding the hind socket ${fold.toFixed(2)} rad and `
        + `dropping the pelvis ${(sank * 100).toFixed(0)} cm; and the deck's blade knocked it `
        + `${(knocked * 100).toFixed(0)} cm off its station`;
    } finally { world.unload(); Kn.clear(); }
  });

  check('companion: every one of the twelve kinds is in the room, and every one of them walks', async () => {
    /**
     * "They will be with you in the hangar as well and follow you on/off ships
     *  like they're going to be with you the whole time if you have them"
     *
     * FOUR OF THE TWELVE WERE NOT IN THE ROOM AT ALL, and nothing could see
     * it. `CompanionDeck` opened `const BUILT = new Set(['walker'])` and
     * `callTheCompanion` returned null for any kind whose row said anything
     * else — `knockable` for the B1 and the astromech, `row` for the wookiee
     * and the 2-1B. The file said so in its own header, which is the honest
     * half; the dishonest half is that the deck check adopted a massiff and
     * nothing else, so a third of the feature was missing from the one room
     * it is most visible in and every suite was green.
     *
     * THIS LOOP IS DRIVEN OFF `COMPANION_ORDER` AND NEVER OFF A LIST TYPED
     * HERE, which is the entire lesson of that defect: the day a thirteenth
     * kind lands, this fails on it until it is in the room, and nobody has to
     * remember to add a line.
     *
     * ── WHAT IS ASSERTED, AND WHY THE ONE BRANCH IS NOT AN ESCAPE ─────────
     *
     * Every kind: a body, in the scene, on the deck's own prop list, routed to
     * the solver ITS OWN SKELETON asks for, walking out to a station twelve
     * metres off and home again, with a leg bone that moves FRAME TO FRAME on
     * the way — the measurement a statue cannot pass, and the one the shipped
     * tree failed at 0.000000 rad on all sixteen of a massiff's leg bones —
     * and a pelvis that is lower sat than standing.
     *
     * The one branch is a body whose builder publishes a stance with NO LIMBS
     * IN IT, and it is read off `built.stance` rather than off a name. There
     * is exactly one today and the assertion below pins that number, so this
     * cannot quietly become the path everything takes: `buildAstromech`
     * spends a paragraph on it — an R-unit's legs are rigid struts on rollers,
     * a gait solver has nothing to say about them, and dropping its hips onto
     * legs that cannot fold would put its feet through the deck. What such a
     * body is still held to is that it is PRESENT and that the servo bob its
     * own builder promises in place of a gait is still running, because "it
     * does not walk" is not a licence to be a prop.
     *
     * ONE ROOM, TWELVE ANIMALS. `dismissCompanion` + `adopt` + a fresh
     * `callTheCompanion` is the same door the game uses when you re-kit at
     * the console; twelve hangar boots would be four minutes of gate for the
     * same evidence.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const D = await import('../../src/game/CompanionDeck.js');
    /* The dial this fixture borrows, put back whatever happens below. */
    const BACK = D.DECK_HEEL.back;
    Kn.clear();
    Kn.adopt('massiff', 'Borz');
    const { world } = await bootWorld({
      level: 'hangar',
      settings: { mode: 'hangar', level: 'hangar', allies: 0, quality: 'low' },
      runSeed: 2,
    });
    try {
      const input = idleInput();
      for (let i = 0; i < 60; i++) world.update(STEP, input);
      const p = world.player;
      const said = [];
      const limbless = [];
      const BACK0 = BACK;
      for (const id of K.COMPANION_ORDER) {
        D.dismissCompanion(world);
        Kn.clear();
        const rec = Kn.adopt(id, 'Borz');
        assert(rec, `${id}: the kennel refused to adopt a kind that is in COMPANION_ORDER`);
        const fig = D.callTheCompanion(world);
        assert(fig, `${id} is not in the room at all — callTheCompanion returned nothing`);
        assert(fig.root.parent === world.scene, `${id}: built, and never added to the deck`);
        /* AND THE ROUTE IS THE BODY'S OWN. `deckPathFor` is asked of the
         * skeleton the builder returned — `thighL`/`shinL` means the animator,
         * `hips` with `femur{i}` means the gait — and never of the kind row's
         * `deck` word, which is what the vanished four were sorted by. */
        assert(fig.path === D.deckPathFor(fig.built),
          `${id}: built on the "${fig.path}" path and its body asks for "${D.deckPathFor(fig.built)}"`);
        assert(fig.path !== 'root', `${id}: has no skeleton either solver can pose`);
        assert((world._deckProps || []).some((x) => x.fig?.root === fig.root),
          `${id}: not offered to the deck's blade — you can walk through it`);
        const rig = fig.built.rig;
        assert(rig, `${id}: the deck body has no rig at all`);

        /**
         * SEND IT ON A WALK — BY MOVING ITS STATION, NOT BY MOVING IT.
         *
         * The deck's own walls stop the player after two and a half metres in
         * this fixture, so the walk has to come from the animal. The first cut
         * teleported `fig.pos` eight metres and it was a bad fixture for a
         * reason worth writing down: `BipedAnimator` holds its feet in WORLD
         * coordinates, so a body moved out from under them stands on the
         * reach clamp's floor — `max(hipY, position.y + 0.30 * s)` — until
         * they catch up, and the B1's "standing" pelvis sampled 0.306 m
         * against a sat 0.790, which reads as a body that stands up to sit
         * down. The animal was fine; the fixture had teleported it.
         *
         * `DECK_HEEL.back` is the room's own dial for how far behind you it
         * stands, so widening it to twelve metres and putting it back is a
         * walk out and a walk home over open plate with nothing teleported
         * and no solver surprised. It is restored in the `finally` below.
         */
        D.DECK_HEEL.back = 12;
        const named = legBonesOf(rig);
        const prev = new Map(named.map((n) => [n, rig.get(n).obj.quaternion.clone()]));
        let sum = 0, samples = 0, offRest = 0, minSit = 1;
        /* Sampled at the moment it is most standing — it arrives inside the
         * four seconds and is sitting again by the last frame. */
        let stand = hipStateOf(fig);
        for (let i = 0; i < 30 * 4; i++) {
          world.update(STEP, input);
          if (fig.sit < minSit) stand = hipStateOf(fig);
          minSit = Math.min(minSit, fig.sit);
          for (const n of named) {
            const b = rig.get(n);
            /* THE FIRST FIVE FRAMES ARE NOT A GAIT. The body was just built,
             * so its bones are still at the bind pose, and the step from bind
             * to the first solved frame is π on a biped — a number that would
             * pass this assertion on a body that then froze solid. */
            if (i > 5) {
              /* The MEAN over every leg bone and every frame — see the note on
               * the same measurement in the check above for why a one-frame
               * maximum is π on a working gait and therefore says nothing. */
              sum += b.obj.quaternion.angleTo(prev.get(n));
              samples++;
              offRest = Math.max(offRest, b.obj.quaternion.angleTo(b.restQuat));
            }
            prev.get(n).copy(b.obj.quaternion);
          }
        }
        assert(minSit < 0.5, `${id}: it never stood up to walk ten metres (sit floor ${minSit.toFixed(2)})`);

        const walks = (fig.built.stance?.limbs?.length ?? named.length) > 0;
        /* AND HOME AGAIN, WHICH IS ALSO HOW IT COMES TO A STOP. */
        D.DECK_HEEL.back = BACK0;
        for (let i = 0; i < 30 * 8; i++) world.update(STEP, input);
        assert(fig.sit > 0.8, `${id}: it stopped and never settled (sit ${fig.sit.toFixed(2)})`);
        const sat = hipStateOf(fig);
        const sank = stand.y - sat.y;
        assert(fig.pos.distanceTo(p.position) < 6,
          `${id}: it walked out to twelve metres and came home to `
          + `${fig.pos.distanceTo(p.position).toFixed(1)} m — it is not at your heel`);

        if (!walks) {
          /**
           * THE ONE BODY WITH NO LEGS TO SOLVE. Still present, still moving.
           *
           * What it is held to is the thing its own builder promises in place
           * of a gait: "`bob` is a real 12 mm of servo wobble, which is what
           * stops a stationary droid reading as a prop". That number is in
           * the stance it publishes and `_poseWalker` is the only thing that
           * spends it, so this fails the moment the solver stops being called
           * on this body — which is the whole point of measuring it here.
           *
           * NOT THE DOME. The gaze ladder puts a ward-0 kind's attention on
           * its owner, and a sat companion has already turned its whole body
           * to face the owner, so the head has nothing left to add: measured
           * at 0.0079 rad over six seconds, on a layer that is working
           * perfectly. A head that is already pointed at you is not evidence
           * of anything either way.
           */
          limbless.push(id);
          assert(fig._life, `${id}: no life record — the idle layer never ran on it`);
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < 30 * 8; i++) {
            world.update(STEP, input);
            const y = rig.worldPos('hips', new THREE.Vector3()).y;
            lo = Math.min(lo, y); hi = Math.max(hi, y);
          }
          assert(hi - lo > 0.004,
            `${id} publishes no limbs, so nothing walks — and its hips moved `
            + `${((hi - lo) * 1000).toFixed(2)} mm in eight seconds either, which makes it a prop`);
          said.push(`${id}: no limbs, ${((hi - lo) * 1000).toFixed(0)} mm of servo bob`);
          continue;
        }

        assert(named.length, `${id}: publishes limbs and this check can name none of its leg bones`);
        const step = samples ? sum / samples : 0;
        assert(step > 0.01,
          `${id}: walking, [${named.slice(0, 4).join(', ')}…] averaged ${step.toFixed(6)} rad of `
          + 'movement a frame — its feet are frozen and it is sliding');
        assert(offRest > 0.1, `${id}: its legs never leave the bind pose (${offRest.toFixed(6)} rad)`);
        assert(sank > 0.02,
          `${id}: sat, its pelvis is ${(sank * 100).toFixed(1)} cm lower than standing`);
        if (sat.socket) {
          const fold = stand.q.angleTo(sat.q);
          assert(fold > 0.05, `${id}: sat, its hind hip socket is ${fold.toFixed(4)} rad off standing`);
          said.push(`${id}:${fig.path} ${step.toFixed(2)}/frame fold ${stand.q.angleTo(sat.q).toFixed(2)} sank ${(sank * 100).toFixed(0)}cm`);
        } else {
          said.push(`${id}:${fig.path} ${step.toFixed(2)}/frame sank ${(sank * 100).toFixed(0)}cm`);
        }
      }
      /* AND THE BRANCH IS PINNED. One body takes the no-limbs path today; if
       * that number grows, somebody has quietly moved a kind onto the road
       * that asserts less, and this fails until they say why. */
      assert(limbless.length === 1,
        `${limbless.length} of the twelve kinds now take the no-limbs path (${limbless.join(', ') || 'none'}) `
        + '— that path asserts less than the other one and it is meant to hold exactly the astromech');
      assert(said.length === K.COMPANION_ORDER.length,
        `only ${said.length} of ${K.COMPANION_ORDER.length} kinds were measured`);
      return `${said.length}/${K.COMPANION_ORDER.length} kinds in the room and walking — ${said.join('; ')}`;
    } finally { D.DECK_HEEL.back = BACK; world.unload(); Kn.clear(); }
  });

  check('companion: it goes down before it dies, and you can pick it up', async () => {
    /**
     * "protecting the companions and keeping them safe is another thing the
     *  player can choose to worry about"
     *
     * AND IT WAS NOT POSSIBLE. `_mayGoDown` opened `if (this.downed ||
     * !this.trooper …)` and a companion has no `trooper` BY DESIGN, so it did
     * not go down — it DIED, outright, on the first lethal hit, in every mode.
     * Measured before the fix: theline (which declares `downed: 1`) and
     * command (`0.6`) both gave `downed=false dead=true` with the window the
     * mode had declared sitting there unused.
     *
     * An animal that simply vanishes when its bar runs out is not something
     * you can protect. It is something you notice is gone.
     *
     * EVERYTHING ELSE ON THE PATH WAS ALREADY GENERIC — `_goDown` reads the
     * director's own `downedScale`, `_tickDown`'s clock knows nothing about a
     * roster or a squad, and the revive is somebody standing over the body.
     * The trooper test was the only thing in the way and it was testing for
     * the wrong thing: what the window belongs to is a body on YOUR SIDE.
     *
     * AND THE MODE STILL DECIDES, which is the half that keeps `MODES[mode].
     * downed` meaningful: a mode that declares no window kills outright, and
     * that is the right answer for a room with no medicine in it.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const said = [];
    for (const mode of ['theline', 'waves']) {
      const { world } = await bootWorld({
        level: 'geonosis',
        settings: { mode, level: 'geonosis', allies: 0, quality: 'low' },
        runSeed: 3,
      });
      try {
        const input = idleInput();
        for (let i = 0; i < 30; i++) world.update(STEP, input);
        const e = fieldCompanion(world, world.player, 'massiff', { rec: { xp: 99 } });
        assert(e, `${mode}: nothing fielded`);
        const window = world.director?.downedMen;
        e.damage(e.maxHp * 5, e.position, { team: 1, position: e.position }, 'bolt');
        if (!window) {
          /* THE CONTROL CASE, and it is not a skip: a mode that declared no
           * window must still kill outright, or `MODES[mode].downed` has
           * stopped meaning anything. */
          assert(e.dead && !e.downed,
            `${mode} declares no downed window and the companion still went down`);
          said.push(`${mode}: no window, killed outright`);
          continue;
        }
        assert(e.downed && !e.dead,
          `${mode} declares a window and the companion died outright anyway`);
        assert(e.bleed > 0, `${mode}: it is down with no clock on it`);
        const clock = e.bleed;
        /* NOW STAND ON IT. Every frame — the character controller moves the
         * body, so a position written once is gone by the next tick, which is
         * how the first version of this measured "still down" on a revive that
         * works. */
        let up = false, t = 0;
        for (let i = 0; i < 30 * 20 && !up; i++) {
          world.player.position.set(e.position.x, e.position.y, e.position.z);
          world.player.hp = world.player.maxHp ?? 100;
          world.update(STEP, input);
          up = !e.downed && !e.dead;
          t = i / 30;
        }
        assert(up, `${mode}: twenty seconds stood over it and it ${e.dead ? 'bled out' : 'stayed down'}`);
        said.push(`${mode}: ${clock.toFixed(0)} s of clock, up in ${t.toFixed(1)} s`);
      } finally { world.unload(); }
    }
    return said.join('; ');
  });

  check('companion: the delete door has a caller, unlike every other one in this tree', async () => {
    /**
     * `Company.clear`, `Muster.clear` and `clearProgress` are all EXPORTED
     * WITH ZERO CALLERS anywhere in `src/` — three delete doors nobody can
     * open. Verified by grep here rather than remembered, so that the day one
     * of them gains a control this check says so instead of going stale.
     *
     * A companion is the first durable record a player will genuinely want to
     * destroy: one they regret naming, one they want to start over with. So
     * `Kennel.clear` gets a real control, and this asserts the CALLER exists
     * — an export is not a door.
     *
     * AND IT IS A HOLD. An accidental tap costs a named thing with a rung and
     * a history behind it, and the game has no undo.
     */
    const menuSrc = await src('ui/Menu.js');
    const stripped = strip(menuSrc);
    assert(/kennelClear\s*\(\)/.test(stripped) || /Kennel\.clear\s*\(\)/.test(stripped),
      'Kennel.clear has no caller in Menu.js — it is an export, not a door');
    assert(/companion-release/.test(menuSrc), 'there is no release control');
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    assert(/id="companion-release"/.test(html), 'the release control has no markup, so nobody can press it');
    assert(/Hold to release/i.test(stripped),
      'the control is a click and not a hold — an accidental tap costs a named animal with no undo');
    /* AND IT IS A RELEASE, NOT A KILL: no epitaph, no `lost` count. A player
     * retiring an animal has not lost one, and a wall of the fallen that
     * listed the ones you let go would be lying about what happened to them. */
    Kn.clear();
    Kn.adopt('massiff', 'Gone');
    const after = (() => { Kn.clear(); return Kn.load(); })();
    assert(!after.live, 'clear() left the animal in the kennel');
    assert(!after.fallen.length, 'releasing an animal wrote it onto the wall of the fallen');
    assert((after.lost | 0) === 0, `releasing an animal counted ${after.lost} lost`);
    /* THE CONTROL CASE, so this check cannot pass by the grep being wrong: the
     * three doors that have no caller still have none. */
    const srcAll = (await Promise.all(['game/Company.js', 'game/Muster.js'].map(src))).join('\n');
    void srcAll;
    return 'Kennel.clear has a hold-to-release control with markup and a caller; '
      + 'releasing writes no epitaph and counts no loss';
  });

  check('companion: the screen tells you how it is doing, and down is not red', async () => {
    /**
     * "protecting the companions and keeping them safe is another thing the
     *  player can choose to worry about"
     *
     * YOU CANNOT WORRY ABOUT SOMETHING YOU CANNOT SEE. Before this the
     * animal's health was legible only as a body you had to look at and judge
     * by eye, and the whole loop the player asked for is NOTICING it is in
     * trouble and doing something. A companion at 12% behind you is the single
     * most important fact on the screen.
     *
     * IT IS A SIBLING NODE AND BOTH OTHER HOMES WERE WRONG. Inside `#roster`
     * it would be hidden in every mode with no CommandDirector — nine of the
     * eleven, and exactly where a companion is the only thing on your side.
     * Appended to `#power-wheel` it would be counted by `hud-events.mjs`'s
     * slot census.
     *
     * AND DOWN IS NOT THE REDDEST STATE. A downed animal is on a clock you can
     * still beat by standing on it; a player who reads "gone" backs away, and
     * backing away is the one thing that loses it.
     */
    const { makeDocument } = await import('./_page.mjs');
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const { CompanionPlate } = await import('../../src/ui/HUD.js');
      const plate = new CompanionPlate(doc);
      assert(plate.el, 'there is no companion plate in the markup');
      const node = doc.getElementById('companion-plate');
      /* IT IS NOT INSIDE THE ROSTER, which `setRoster` hides in nine modes. */
      const roster = doc.getElementById('roster');
      assert(!roster || !roster.contains(node),
        'the plate is inside #roster, which is hidden in every mode with no CommandDirector — '
        + 'which is exactly where a companion is the only thing on your side');
      const wheel = doc.getElementById('power-wheel');
      assert(!wheel || !wheel.contains(node), 'the plate is inside the power wheel, whose slots are counted');

      plate.set(null);
      assert(node.className.includes('hidden'), 'with nothing of yours out the plate is still up');
      const K = (b, r) => { plate.set(b, { name: 'Borz' }, r); return node; };
      const R = K({ hp: 180, maxHp: 210, dead: false, downed: false, A: { label: 'Massiff' },
        _cmpDuty: { id: 'ward' } }, K3());
      const healthy = R.textContent;
      assert(/Borz/.test(healthy) && /180\/210/.test(healthy),
        `a healthy companion reads "${healthy}"`);
      assert(/ward/.test(healthy), 'the plate does not say what order it is under');
      const hurt = K({ hp: 20, maxHp: 210, dead: false, downed: false, A: { label: 'Massiff' },
        _cmpDuty: { id: 'heel' } }, K3()).innerHTML;
      assert(/cmp-plate bad/.test(hurt), 'a companion at 10% is not marked as being in trouble');
      const down = K({ hp: 1, maxHp: 210, dead: false, downed: true, bleed: 12.4,
        A: { label: 'Massiff' } }, K3());
      assert(/DOWN/.test(down.textContent) && /12s/.test(down.textContent),
        `a downed companion reads "${down.textContent}" — it should say it is down and for how long`);
      assert(/stand on it/i.test(down.textContent),
        'it says the animal is down and not what to do about it');
      assert(/cmp-plate down/.test(down.innerHTML) && !/cmp-plate bad/.test(down.innerHTML),
        'down wears the near-death class — a player who reads "gone" backs away, and backing away '
        + 'is the one thing that loses it');
      return `hidden with nothing out; healthy "${healthy.trim()}"; 10% marked bad; `
        + `down reads "${down.textContent.trim()}"`;
    } finally { restore(); }

    function K3() { return K.COMPANION_RANKS ? K.COMPANION_RANKS[2] : null; }
  });


  /* ── the kind's own verb ──────────────────────────────────────────── */

  check('companion: every kind\'s verb has work behind it, and none of it is a kind name', async () => {
    /**
     * THE DEFECT THIS CHECK EXISTS FOR WAS A SILENCE.
     *
     * `COMPANION_ORDERS.verb` shipped, the wheel read SLICE off an astromech's
     * row and CRY off a tooka's, `orderCompanion(e, 'verb', t)` ACCEPTED the
     * order and wrote `_cmpDuty` — and nothing anywhere read it. Twelve wheel
     * slots said twelve different words and all twelve did the same nothing,
     * which `tools/_cmporders.mjs` opens by calling worse than a refusal.
     *
     * So the join is asserted TOTAL: every kind's `verb.id` has a row in
     * `COMPANION_VERBS`, and every row has something to run. A verb with
     * neither a `start` nor a `tick` is the original defect wearing a table.
     */
    const V = C.COMPANION_VERBS;
    const ARGS = new Set(['none', 'body', 'friend', 'point']);
    const seen = new Set();
    for (const id of K.COMPANION_ORDER) {
      const row = K.COMPANION_KINDS[id].verb;
      assert(row?.id, `${id} has no verb at all`);
      assert(!seen.has(row.id), `${row.id} is two kinds' verb — one slot, twelve MEANINGS`);
      seen.add(row.id);
      const W = V[row.id];
      assert(W, `${row.label} (${id}) has no work behind it — the wheel says the word and `
        + 'nothing happens, which is the exact defect this table exists to end');
      assert(ARGS.has(W.arg), `${row.id} wants a "${W.arg}", which is not a shape the reticle has`);
      assert(typeof W.start === 'function' || typeof W.tick === 'function',
        `${row.id} declares neither a start nor a tick — it is a label with a table round it`);
    }
    /* AND NOTHING IN THE THREE FILES KNOWS A KIND BY NAME, which the row-level
     * check already pins; this is the same rule aimed at the new table, where
     * a per-kind `if` would be easiest to write and hardest to see. */
    const code = strip(await src('game/Companions.js'));
    const table = /export const COMPANION_VERBS = \{([\s\S]*?)\n\};/.exec(code)?.[1] || '';
    assert(table, 'COMPANION_VERBS is gone');
    for (const id of K.COMPANION_ORDER) {
      assert(!new RegExp(`['"\`]${id}['"\`]`).test(table), `the verb table names the kind "${id}"`);
    }
    /* AND A VERB WITH NO WORK IS REFUSED IN A SENTENCE rather than accepted —
     * driven, by taking one row out of the table for the length of two calls,
     * because all twelve shipped rows have work and the branch is otherwise
     * unreachable. That is the state the whole feature was in before this
     * lane, and it must never be reachable in silence again. */
    const one = K.COMPANION_KINDS[K.COMPANION_ORDER[0]];
    const body = { _cmpKind: one.id, _cmpRec: { xp: 99 }, team: 0 };
    assert(!C.refuseOrder(body, 'verb'), `a real kind's verb was refused: ${C.refuseOrder(body, 'verb')}`);
    const kept = V[one.verb.id];
    delete V[one.verb.id];
    let said = null;
    try { said = C.refuseOrder(body, 'verb'); } finally { V[one.verb.id] = kept; }
    assert(said && said.length > 8,
      `a verb with no work row read "${said}" — it must be a sentence, and it must not be silence`);
    assert(!C.refuseOrder(body, 'verb'), 'the table did not come back');
    return `${seen.size} distinct verbs, ${seen.size} work rows, every one with an arg and `
      + `something to run; no kind named in the table; a verb with no work reads "${said}"`;
  });

  check('companion: the eleven verbs that need no army all do the thing they say', async () => {
    /**
     * ONE WORLD, ELEVEN ORDERS, AND EVERY ONE OF THEM MEASURED BY ITS OWN
     * PROMISE — hits taken instead of you, bodies that switch target, a body
     * on its back, cover that is gone, a door that is open, a man on his feet.
     * `tools/_cmpverbs.mjs` is the same drive with its numbers printed.
     *
     * SIX OF THE TWELVE KINDS HAVE NO BODY YET (b1c, wook, hawk, astro, medic,
     * varac), so those verbs are given to a body that does exist with the KIND
     * set on it — `_cmpKind` is the row the wheel and the work table both join
     * on, and the ladder check above already drives a kind that way. What is
     * measured here is the verb; the shape of the animal wearing it is
     * another lane's.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { ARCHETYPES, DOWN_HELP } = await import('../../src/game/Enemy.js');
    const { BEHAVIOUR } = await import('../../src/game/Reactions.js');
    const { makeCrate } = await import('../../src/world/Props.js');
    /* The colour SPOT paints in, so a count of what floated is a count of the
     * READING and not of the fight — PARRY and PATCHED UP ride the same path. */
    const SPOT_INK = '#a8f0ff';
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
      runSeed: 21,
    });
    const input = idleInput();
    const p = world.player;
    for (let i = 0; i < 30; i++) world.update(STEP, input);
    const said = [];
    try {
      const T = world.terrain;
      const OPEN = p.position.clone();
      const step = (n, each) => {
        for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); each?.(i); }
      };
      const put = (ang, r, from = p.position) => {
        const x = from.x + Math.sin(ang) * r, z = from.z + Math.cos(ang) * r;
        const f = world.spawnEnemy('b1', new THREE.Vector3(x, T.height(x, z), z));
        if (f) f.team = 1;
        return f;
      };
      const sweep = () => {
        for (const x of world.enemies) {
          if (!x.dead && !x.companion && x.team !== (p.team ?? 0)) x.damage(x.hp + 999, x.position, null, 'bolt');
        }
      };
      const wear = (kind) => {
        const A = ARCHETYPES[K.COMPANION_KINDS[kind].archetype];
        const e = C.fieldCompanion(world, p, A ? kind : 'massiff', { rec: { xp: 99, runs: 3, tempers: [] } });
        if (e) e._cmpKind = kind;
        return e;
      };
      const retire = (e) => { e.damage(e.hp + 999, e.position, null, 'bolt'); step(15); };
      /* NEVER TELEPORT NEXT TO A BUILDING. `Destruction._impactScan` bills
       * `0.5 m v²` to any structure a heavy body arrives at above 7.5 m/s, and
       * a body set thirty metres in one frame arrives at nine hundred:
       * measured, the nearest revetment went 70 hp → −1 944 509 and
       * `collapsed` on the frame the fixture moved the player beside it,
       * BEFORE any order was given. Every WRECK number taken that way was a
       * measurement of the teleport. */
      const walk = (e, at, back = 6, frames = 90) => {
        const s0 = p.position.clone();
        for (let i = 1; i <= frames; i++) {
          const t = i / frames;
          const x = s0.x + (at.x + back - s0.x) * t, z = s0.z + (at.z - s0.z) * t;
          p.position.set(x, T.height(x, z) + 0.05, z);
          p.velocity.set(0, 0, 0);
          if (e) {
            e.position.set(x - 1.2, T.height(x - 1.2, z), z);
            e.velocity.set(0, 0, 0);
            if (e.body) { e.body.position.copy(e.position); e.body.velocity.set(0, 0, 0); }
          }
          p.hp = p.maxHp ?? 100;
          world.update(STEP, input);
        }
      };

      /* BLOCK — the blow lands on the animal. */
      {
        const dog = wear('massiff');
        const foe = put(0, 9);
        assert(!C.orderCompanion(dog, 'verb', null), 'BLOCK was refused');
        step(30 * 4);
        const volley = (from, n = 6) => {
          let you = 0, it = 0;
          for (let i = 0; i < n; i++) {
            const h0 = p.hp, d0 = dog.hp;
            p.damage(9, p.position, from, 'bolt');
            you += Math.max(0, h0 - p.hp); it += Math.max(0, d0 - dog.hp);
            p.hp = p.maxHp ?? 100;
            world.update(STEP, input);
          }
          return { you, it };
        };
        const front = volley(foe);
        assert(front.it > 0 && front.you === 0,
          `BLOCK let ${front.you.toFixed(0)} hp through onto you and put ${front.it.toFixed(0)} on the animal `
          + `— it was standing ${dog.position.distanceTo(p.position).toFixed(1)} m off you`);
        const rear = volley(put(Math.PI, 9));
        assert(rear.you > 0 && rear.it === 0,
          'a blow from BEHIND you was eaten too — BLOCK is a cone, not a shield, and a blocker '
          + 'that covers every direction at once is a free guard');
        C.orderCompanion(dog, 'heel');
        const off = volley(foe);
        assert(off.you > 0, 'lifting the order did not stop the redirect');
        said.push(`BLOCK ${front.it.toFixed(0)} hp onto it / 0 onto you, 0 from behind`);
        retire(dog);
        sweep();
      }

      /* CRY — a targeting override, and only inside the ring. */
      {
        const cat = wear('tooka');
        const all = [];
        for (let k = 0; k < 4; k++) all.push(put(k * 1.57, 8));
        for (let k = 0; k < 2; k++) all.push(put(k * 3.14, 48));
        step(30 * 2);
        const live = all.filter((f) => !f.dead);
        const near = live.filter((f) => f.position.distanceTo(cat.position) <= C.CRY.ring);
        const wide = live.filter((f) => f.position.distanceTo(cat.position) > C.CRY.ring);
        assert(near.length && wide.length, 'the fixture put nobody on one side of the ring');
        const was = near.filter((f) => f.target === cat).length;
        assert(!C.orderCompanion(cat, 'verb', null), 'CRY was refused');
        const pulled = near.filter((f) => f.compelled?.target === cat).length;
        const spared = wide.filter((f) => f.compelled?.target === cat).length;
        /* ONE FRAME. Four B1s at 8 m put 27 damage a burst into a 24 hp animal,
         * so a second later the thing they were looking at is a corpse — which
         * is the row's own promise and not a defect. */
        step(1);
        const looking = near.filter((f) => f.target === cat).length;
        assert(pulled === near.length && spared === 0,
          `CRY compelled ${pulled}/${near.length} inside ${C.CRY.ring} m and ${spared}/${wide.length} outside it`);
        assert(looking > was, `${was} were on the cat before the shout and ${looking} after it`);
        assert(!cat._cmpDuty, 'CRY left a standing order behind — it is a shout, not a posture');
        step(30 * 4);
        assert(live.every((f) => f.dead || !f.compelled), 'the pull outlasted its three seconds');
        said.push(`CRY ${pulled}/${near.length} in the ring, ${spared} outside, ${was}→${looking} on it`);
        retire(cat);
        sweep();
      }

      /* FLUSH — flat, not dead. */
      {
        const whelp = wear('tuk');
        const foe = put(0.6, 7);
        step(30);
        assert(!C.orderCompanion(whelp, 'verb', foe), 'FLUSH was refused');
        let flat = false, at = 0;
        for (let i = 0; i < 30 * 16 && !flat; i++) {
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          if (foe.actor?.ragdolled || foe._flatten) { flat = true; at = i / 30; }
        }
        assert(flat, 'FLUSH never put the body on its back');
        assert(!foe.dead, 'the flush killed it — it is a setup for your blade, not a substitute');
        assert(!whelp._cmpDuty, 'the order did not end itself when the body went down');
        said.push(`FLUSH flat at ${at.toFixed(1)} s, still alive`);
        retire(whelp);
        sweep();
      }

      /* SPOT — every hostile inside the ring, painted, for eight seconds. */
      {
        const hawk = wear('hawk');
        for (let k = 0; k < 5; k++) put(k * 1.25, 18 + k * 7);
        put(0.4, 85);
        step(30);
        let painted = 0;
        world.onFloating = (pos, text, colour) => { if (colour === SPOT_INK && hawk._cmpDuty) painted++; };
        assert(!C.orderCompanion(hawk, 'verb', null), 'SPOT was refused');
        /* CLOCKED ON `world.time`. `World.update` scales its own dt by
         * `timeScale * focus.scale`, so fixture frames are not game seconds
         * whenever a focus is open — counted in frames the 8 s reading read
         * as 9.6. */
        const t0 = world.time;
        let beats = 0, agreed = 0, last = 0, outside = 0;
        for (let i = 0; i < 30 * 12; i++) {
          const before = painted;
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          if (painted === before) continue;
          beats++; last = world.time - t0;
          const inRing = world.enemies.filter((f) => !f.dead && !f.downed && !f.companion
            && f.team !== (p.team ?? 0) && f.position.distanceTo(p.position) <= C.SPOT.ring).length;
          outside += world.enemies.filter((f) => !f.dead && !f.companion
            && f.team !== (p.team ?? 0) && f.position.distanceTo(p.position) > C.SPOT.ring).length;
          if (hawk._cmpSpotted === inRing) agreed++;
        }
        world.onFloating = null;
        assert(beats > 0, 'SPOT painted nothing at all');
        assert(agreed === beats,
          `${beats - agreed} of ${beats} beats painted something other than exactly the hostiles `
          + `inside ${C.SPOT.ring} m`);
        assert(last <= C.SPOT.hold && !hawk._cmpDuty,
          `the reading ran to ${last.toFixed(1)} s of a ${C.SPOT.hold} s window`);
        said.push(`SPOT ${agreed}/${beats} beats exact, ${outside} outside ignored, last ${last.toFixed(1)} s`);
        retire(hawk);
        sweep();
      }

      /* BOLT — a straight run that takes their eyes. */
      {
        const taun = wear('taun');
        const foes = [];
        for (let k = 0; k < 4; k++) foes.push(put(k * 1.57, 10));
        step(30 * 4);
        const onYou = foes.filter((f) => !f.dead && f.target === p).length;
        assert(onYou > 0, 'nothing was shooting at the player, so there were no eyes to draw');
        const from = taun.position.clone();
        assert(!C.orderCompanion(taun, 'verb', null), 'BOLT was refused');
        const heading = taun._cmpPoint.clone().sub(from).setY(0).normalize();
        const drew = foes.filter((f) => f.compelled?.target === taun).length;
        let walked = 0;
        const prev = taun.position.clone();
        step(30 * 6, () => { walked += taun.position.distanceTo(prev); prev.copy(taun.position); });
        const went = taun.position.clone().sub(from).setY(0);
        const along = went.length() > 0.01 ? went.clone().normalize().dot(heading) : 0;
        assert(drew === onYou, `${onYou} were on you and ${drew} switched to the tauntaun`);
        assert(went.length() > 8 && along > 0.9,
          `it made ${went.length().toFixed(1)} m at ${(Math.acos(Math.min(1, along)) * 57.3).toFixed(0)}° `
          + 'off the heading it chose — a panic run is a straight line');
        assert(!taun._cmpDuty, 'the run never ended');
        said.push(`BOLT ${drew}/${onYou} eyes, ${went.length().toFixed(0)} m in one line`);
        retire(taun);
        sweep();
      }

      /* CHARGE — what closes, and only that. */
      {
        const blurrg = wear('blurrg');
        assert(!C.orderCompanion(blurrg, 'verb', null), 'CHARGE was refused');
        const far = put(0, 9);
        let onFar = 0;
        step(30 * 5, () => { if (blurrg.target === far) onFar++; });
        const close = put(0.2, 2.2, blurrg.position);
        const hp0 = close.hp;
        let onClose = 0;
        step(30 * 8, () => { if (blurrg.target === close) onClose++; });
        assert(onFar === 0,
          `it spent ${onFar} frames on a body 9 m away — CHARGE is a mount biting what arrives, `
          + 'not a second WARD that leaves the ground you are standing on');
        assert(onClose > 0 && close.hp < hp0,
          `nothing closed to 2.2 m was bitten (${(hp0 - close.hp).toFixed(0)} hp over ${onClose} frames)`);
        said.push(`CHARGE ${(hp0 - close.hp).toFixed(0)} hp at 2 m, 0 frames at 9 m`);
        retire(blurrg);
        sweep();
      }

      /* TEND — the bleed-out clock, worked by being there. */
      {
        const medic = wear('medic');
        walk(medic, OPEN, 0);
        const mate = world.spawnEnemy('b1', new THREE.Vector3(
          p.position.x + 7, T.height(p.position.x + 7, p.position.z), p.position.z));
        mate.team = p.team ?? 0;
        mate.downed = true; mate.bleed = 14; mate.hp = 0; mate._downHelp = 0;
        assert(!C.orderCompanion(medic, 'verb', mate), 'TEND was refused a downed man of yours');
        let up = -1, knelt = 99;
        for (let i = 0; i < 30 * 16 && up < 0; i++) {
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          knelt = Math.min(knelt, medic.position.distanceTo(mate.position));
          if (!mate.downed && !mate.dead) up = i / 30;
        }
        assert(up >= 0,
          `the man bled out with the droid ${knelt.toFixed(2)} m away — DOWN_HELP is `
          + `${DOWN_HELP} m and the reaction kneels at ${BEHAVIOUR.heal.reach} m`);
        const well = world.spawnEnemy('b1', new THREE.Vector3(
          p.position.x + 3, T.height(p.position.x + 3, p.position.z), p.position.z));
        well.team = p.team ?? 0;
        const no = C.orderCompanion(medic, 'verb', well);
        assert(no && /nothing wrong/.test(no), `a man with nothing wrong was accepted: "${no}"`);
        said.push(`TEND up at ${up.toFixed(1)} s, knelt at ${knelt.toFixed(2)} m of ${DOWN_HELP}`);
        mate.damage(9999, mate.position, null, 'bolt');
        well.damage(9999, well.position, null, 'bolt');
        retire(medic);
        sweep();
      }

      /* WRECK — a shooter's cover, through the door that already breaks props. */
      {
        const pup = wear('pup');
        step(30);
        const spot = pup.position.clone().add(new THREE.Vector3(3.2, 0, 0));
        spot.y = T.height(spot.x, spot.z);
        const crate = makeCrate(world, spot.clone(), 0.9, { exactSize: true });
        (world.addProp ? world.addProp(crate) : world.props.push(crate));
        step(30);
        const at = (crate.body?.position || crate.mesh.position).clone();
        const hp0 = crate.hp;
        assert(!C.orderCompanion(pup, 'verb', at), 'WRECK was refused a crate under the reticle');
        let broke = -1;
        for (let i = 0; i < 30 * 16 && broke < 0; i++) {
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          if (crate.dead || crate.hp <= 0) broke = i / 30;
        }
        assert(broke >= 0, `${hp0.toFixed(0)} hp of crate survived ${pup._cmpWrecked || 0} slams`);
        const nowhere = C.orderCompanion(pup, 'verb', new THREE.Vector3(at.x + 400, at.y, at.z + 400));
        assert(nowhere, 'a WRECK pointed at bare ground was accepted and did nothing — which is '
          + 'the whole defect this table exists to end');
        said.push(`WRECK ${hp0.toFixed(0)} hp crate in ${pup._cmpWrecked || 0} slam(s)`);
        retire(pup);
      }

      /* BREACH — the same finder, the other door. */
      {
        const wook = wear('wook');
        const piece = [...(world.destruction?.structures || [])]
          .filter((s) => s.state !== 'gone' && s.state !== 'collapsed')
          .sort((a, b) => a.centre.distanceTo(p.position) - b.centre.distanceTo(p.position))[0];
        assert(piece, 'this level has no architecture to breach');
        const at = piece.centre.clone();
        walk(wook, at, 5);
        const was = piece.state;
        assert(!C.orderCompanion(wook, 'verb', at), 'BREACH was refused');
        let down = -1;
        for (let i = 0; i < 30 * 16 && down < 0; i++) {
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          if (piece.state === 'collapsed' || piece.state === 'gone') down = i / 30;
        }
        assert(down >= 0 && wook._cmpBreached, `the piece is still "${piece.state}"`);
        said.push(`BREACH "${was}" → "${piece.state}" at ${down.toFixed(1)} s`);
        retire(wook);
      }

      /* SLICE — the one turnable thing in the tree. */
      {
        const astro = wear('astro');
        const door = (world.doors || []).find((d) => !d.opened);
        assert(door, 'this level has no door to turn');
        const at = door.mesh.position.clone();
        walk(astro, at, 4.5);
        assert(!C.orderCompanion(astro, 'verb', at), 'SLICE was refused a shut door');
        let open = -1;
        for (let i = 0; i < 30 * 40 && open < 0; i++) {
          p.hp = p.maxHp ?? 100; world.update(STEP, input);
          if (door.opened) open = i / 30;
        }
        assert(open >= 0, 'the door is still shut');
        assert(door.collider?.disabled !== false, 'the door opened and its collider stayed');
        const nothing = C.orderCompanion(astro, 'verb', new THREE.Vector3(at.x + 300, at.y, at.z));
        assert(nothing && /turn/.test(nothing), `a SLICE at bare ground read "${nothing}"`);
        said.push(`SLICE open at ${open.toFixed(1)} s of ${C.SLICE.work} s at the panel`);
        retire(astro);
      }

      /* CLIMB — the grade the player's own controller refuses. */
      {
        const varac = wear('varac');
        /* THE FACE IS FOUND BY ASKING THE THING THAT REFUSES IT.
         * `Terrain.blockClimb` is the only rule in the game that says a slope
         * is a wall, it is called from `Player._collide` and from nowhere
         * else, and no body in `world.enemies` is subject to it. */
        let face = null, foot = null;
        for (let i = 0; i < 6000 && !face; i++) {
          const a = i * 0.37, r = 12 + (i % 90);
          const x = p.position.x + Math.cos(a) * r, z = p.position.z + Math.sin(a) * r;
          if (!T.inBounds(x, z, 8)) continue;
          const h = T.height(x, z);
          if (!T.blockClimb(new THREE.Vector3(x, h - 0.35, z), null)) continue;
          /* AND THE APPROACH HAS TO BE FROM BELOW, which the first cut did not
           * check: a refused face has an uphill side and a downhill one, and
           * standing the animal on whichever side happened to face the player
           * measured a walk DOWN a hill (−0.36 m) on the run where the search
           * landed on the far side. The foot is stepped seven metres down the
           * gradient and the drop has to be real. */
          const e0 = T.step || 0.5;
          const gx = (T.height(x + e0, z) - T.height(x - e0, z)) / (2 * e0);
          const gz = (T.height(x, z + e0) - T.height(x, z - e0)) / (2 * e0);
          const g = Math.hypot(gx, gz);
          if (g < 1e-3) continue;
          const bx = x - (gx / g) * 7, bz = z - (gz / g) * 7;
          if (!T.inBounds(bx, bz, 8)) continue;
          const bh = T.height(bx, bz);
          if (h - bh < 2.5) continue;
          /* AND THE GROUND BETWEEN THE TWO HAS TO GO UP ALL THE WAY. The first
         * face this found had a hollow at its foot: the animal walked five metres
         * toward it, fell four into the dip and finished 1.7 m from the point in
         * plan and 7.4 m under it. A climb needs a RAMP of the refused steepness,
         * not a cliff with a hole at the bottom. */
        let ramp = true, prev = bh;
        for (let k = 1; k <= 8 && ramp; k++) {
          const t = k / 8;
          const hk = T.height(bx + (x - bx) * t, bz + (z - bz) * t);
          if (hk < prev - 0.2) ramp = false;
          prev = hk;
        }
        if (!ramp) continue;
        face = new THREE.Vector3(x, h, z);
          foot = new THREE.Vector3(bx, bh, bz);
        }
        assert(face, 'no face on this level that the player is refused and that goes UP from below');
        varac.position.copy(foot);
        p.position.set(foot.x, foot.y + 0.05, foot.z);
        varac.A = { ...varac.A, grade: 0.3 };
        const y0 = varac.position.y;
        assert(!C.orderCompanion(varac, 'verb', face), 'CLIMB was refused');
        assert(varac.A.grade === 1, `the ceiling stayed at ${varac.A.grade} — \`grade >= 1\` is `
          + "Enemy.js's own \"the one value that means anything\"");
        /* THE PEAK AND NOT THE END. CLIMB ends when the animal ARRIVES, and the
         * ordinary heel then walks it back down to an owner standing at the
         * bottom of the face: measured at the end of a twelve-second run,
         * −4.38 m, which is the order having worked and then been over. */
        let peak = 0;
        step(30 * 12, () => { peak = Math.max(peak, varac.position.y - y0); });
        const gained = peak;
        assert(gained > 0.5, `it got ${gained.toFixed(2)} m up a face the player is pushed off`);
        C.orderCompanion(varac, 'heel');
        assert(varac.A.grade === 0.3,
          `the ceiling stayed lifted at ${varac.A.grade} after the order — a grade raised for one `
          + 'climb and never lowered is a companion that climbs walls for the rest of the run');
        said.push(`CLIMB +${gained.toFixed(1)} m up a refused face, ceiling back to 0.3`);
        retire(varac);
      }

      return said.join('; ');
    } finally { world.unload(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE THREE THAT ARE ONLY FOR RIDING
   *
   * The player named them one at a time — "a Tauntaun you ride/mount", "a
   * Blurgg you ride/mount", "a Varactyl you ride/mount" — and three of the
   * twelve kinds exist for no other reason. `tools/checks/driving.mjs` drives
   * the SEAT: boarding, the measured back, the race against the player's own
   * legs, the dismount, the refused trigger. What is measured here is the half
   * that belongs to the animal rather than to the saddle — the panic that
   * throws you, and the bite that answers what closes while you are up there.
   * ──────────────────────────────────────────────────────────────────── */

  /** A world with one of yours fielded, and a throttle this check owns. */
  const mounted = async (kind) => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
      runSeed: 21,
    });
    const stick = { fwd: 0, steer: 0 };
    const input = {
      act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { const v = o || {}; v.x = stick.steer; v.y = stick.fwd; return v; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
    };
    const p = world.player;
    const step = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); } };
    step(30);
    const e = C.fieldCompanion(world, p, kind, { rec: { id: `k-${kind}`, xp: 99, runs: 9, tempers: [] } });
    assert(e, `setup: no ${kind} was fielded`);
    step(30);
    /** Put it an arm's length off and get on. */
    const board = () => {
      e.position.set(p.position.x + 1.5, e.position.y, p.position.z);
      step(2);
      return p.takeControls({ input });
    };
    /** A hostile at a bearing and a range from the ANIMAL. */
    const put = (ang, r) => {
      const x = e.position.x + Math.sin(ang) * r, z = e.position.z + Math.cos(ang) * r;
      const f = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
      if (f) f.team = 1;
      return f;
    };
    return { world, p, e, input, stick, step, board, put };
  };

  check('companion: a frightened tauntaun throws you off and bolts, and a calm one does not', async () => {
    /**
     * THE CARD HAS SAID THIS SINCE THE ROW WAS WRITTEN — *"above a threshold it
     * bucks you off and bolts"* — and until this lane the string "buck"
     * occurred nowhere in `src/` except inside the word "bucket". A sentence on
     * a card describing a mechanic that does not exist is the same lie as a
     * dead checkbox, and it is the reason this suite would rather field the
     * feature than delete the sentence.
     *
     * THREE MEASUREMENTS AND THE MIDDLE ONE IS THE POINT.
     *
     *  1. RIDDEN INTO THREE HOSTILES it throws you: the rider is on the ground,
     *     stunned, moving, and the animal is under its own verb and gone.
     *  2. RIDDEN WITH NOBODY NEAR IT DOES NOT, for four times as long. A panic
     *     that is really a countdown would pass (1) and fail here, and a
     *     countdown is exactly what a fear value quietly implemented as a timer
     *     becomes.
     *  3. AND IT IS THE SADDLE'S, NOT THE ANIMAL'S — the same tauntaun shot to
     *     a third of its health with nobody on it holds its ground. That is the
     *     bound that stops this becoming a companion which deletes itself from
     *     every firefight it is standing near; the card's sentence is about
     *     being thrown, and a body with nobody on it has nobody to throw.
     *
     * THE TIMING BOUND IS NOT `cap / 3`, and that is worth writing down: three
     * hostiles is 1.5 s of RING, but they are also shooting, and `Player.damage`
     * reroutes every hit into the body you are sitting on — so the second term
     * is fed by the first and the measured answer is 1.10 s. The bound below is
     * the band that arithmetic lives in, wide enough for a stream to move it
     * and narrow enough that a threshold of zero (0.03 s) fails it.
     */
    const cap = K.COMPANION_KINDS.taun.panic;
    assert(cap > 0, 'the tauntaun row has no panic threshold, so the card is claiming nothing');

    /* ── 1. three of them, close, with you up. */
    const a = await mounted('taun');
    assert(a.board(), 'setup: could not get on');
    const three = [];
    for (let i = 0; i < 3; i++) three.push(a.put(i * 2.1, 10));
    /* THREE, AND EXACTLY THREE. `waves` keeps spawning, and a ring counting
     * five hostiles crosses the threshold in 0.9 s rather than 1.5 — which is
     * the check measuring the wave director instead of the fear. Everything
     * that is not one of the three is swept every frame, so the clock below is
     * arithmetic this check controls. */
    const only = () => {
      for (const o of a.world.enemies) {
        if (o.dead || o.companion || o.team === (a.p.team ?? 0)) continue;
        if (!three.includes(o)) { o.hp = 0; o.dead = true; }
      }
    };
    let t = 0, thrown = null;
    for (let i = 0; i < 300 && thrown === null; i++) {
      only();
      a.p.hp = a.p.maxHp; a.world.update(STEP, a.input); t += STEP;
      if (!a.p.driving) thrown = t;
    }
    assert(thrown !== null,
      `three hostiles at 10 m for ten seconds and the rider is still up — fear reached ${(a.e._cmpFear || 0).toFixed(2)} of ${cap}`);
    /* Three hostiles is `cap / 3` seconds of ring, and it must not be much
     * quicker than that or something other than the ring is deciding. */
    assert(thrown > 0.6 && thrown < cap / 3 + 1.5,
      `it threw the rider at ${thrown.toFixed(2)} s; three hostiles is ${(cap / 3).toFixed(2)} s of ring `
      + 'and their fire is the rest of it');
    assert(a.e._cmpPanics === 1, `it panicked ${a.e._cmpPanics} times over one threshold`);
    assert(!a.p.grounded && a.p.velocity.length() > 1.5,
      `the rider was set down tidily at ${a.p.velocity.length().toFixed(2)} m/s — he was not thrown`);
    const stun = a.p.staggerTimer;
    assert(stun >= 0.5, `thrown off a running animal and ${stun.toFixed(2)} s of stagger`);
    assert(a.e._cmpDuty?.id === 'verb' && a.e._cmpPoint,
      'it threw its rider and then stood there — the card says it bolts');
    const near0 = a.e.position.distanceTo(a.p.position);
    for (let i = 0; i < 120; i++) { a.p.hp = a.p.maxHp; a.world.update(STEP, a.input); }
    const ran = a.e.position.distanceTo(a.p.position);
    assert(ran > near0 + 8,
      `it "bolted" from ${near0.toFixed(1)} m to ${ran.toFixed(1)} m in four seconds`);
    a.world.unload?.();

    /* ── 2. the same ride with nothing near it, twice as long. */
    const b = await mounted('taun');
    assert(b.board(), 'setup: could not get on the calm one');
    b.stick.fwd = 1;
    for (let i = 0; i < 600; i++) {
      b.p.hp = b.p.maxHp;
      for (const o of b.world.enemies) if (!o.dead && !o.companion && o.team !== (b.p.team ?? 0)) { o.hp = 0; o.dead = true; }
      b.world.update(STEP, b.input);
    }
    assert(b.p.driving,
      `twenty seconds of empty ground and it still threw the rider — fear ${(b.e._cmpFear || 0).toFixed(2)}`);
    assert(!b.e._cmpPanics, 'a calm ride panicked');
    b.world.unload?.();

    /* ── 3. and the same fire with nobody on it does NOT move the animal.
     *
     * Well past the threshold in the currency the ridden clock counts it in:
     * `cap / PANIC.hit` is 75 hp and this puts 200 into it, at a rate no gap
     * can decay. An unridden panic would have fired eight times over. */
    const c = await mounted('taun');
    let hurt = 0;
    for (let i = 0; i < 300; i++) {
      if (i % 5 === 0 && hurt < 200) { c.e.damage(10, c.e.position, null, 'bolt'); hurt += 10; }
      c.p.hp = c.p.maxHp; c.world.update(STEP, c.input);
    }
    assert(!c.p.driving && !c.e.driven, 'setup: nobody was supposed to be riding this one');
    assert(!c.e._cmpPanics && !(c.e._cmpFear > 0),
      `${hurt} hp into a tauntaun with nobody on it and it panicked ${c.e._cmpPanics || 0} times `
      + `(fear ${(c.e._cmpFear || 0).toFixed(2)}) — the card's claim is about the saddle`);
    assert(!c.e.dead, `setup: ${hurt} hp killed it before the bound could be measured`);
    c.world.unload?.();

    return `ridden into 3 hostiles at 10 m: thrown at ${thrown.toFixed(2)} s `
      + `(1.5 s of ring plus the fire it took for you), ${stun.toFixed(2)} s stunned, `
      + `bolted ${ran.toFixed(0)} m off; 20 s of empty ground: still up, `
      + `fear ${(b.e._cmpFear || 0).toFixed(2)}; ${hurt} hp with nobody on it: it held its ground`;
  });

  check('companion: a blurrg bites what closes on you WHILE you are riding it', async () => {
    /**
     * COMPANIONS.md's line for this kind is *"the mount that is also a weapon
     * … it bites what closes on you while you are riding, so you are not
     * defenceless at a standstill"*, and `Companions.js` conceded in its own
     * source that the half that matters was unreachable: *"Riding is not
     * reachable today — no companion row declares `crew`, so
     * `Driving.whyNotDrive` refuses every mount — and this is the line that
     * will be right when it is."*
     *
     * IT WAS STILL NOT RIGHT WHEN RIDING LANDED, WHICH IS WHY THIS EXISTS.
     * `Enemy.update`'s driven branch returns before `_think`, so a ridden mount
     * never reaches the aim wrap either and `e.target` stays null for ever —
     * and `charge.tick` opened on `if (!t) return`. Measured on a live world
     * with the blurrg boarded, CHARGE ordered and a B1 held at 2.2 m for ten
     * seconds: 0 damage. The verb read as implemented and did nothing.
     *
     * TWO BOUNDS AND BOTH ARE LOAD-BEARING. What is in its jaws loses health;
     * what is at nine metres does not — that is the whole difference between
     * CHARGE and WARD, and a mount that left the ground you are standing on
     * would have taken the ride away from you. And the same close body under
     * HEEL loses nothing, which is what says this is the ORDER biting rather
     * than a brain that was running anyway.
     */
    const held = (b, foe, r, ang = Math.PI / 2) => {
      foe.position.set(b.e.position.x + Math.sin(ang) * r, foe.position.y, b.e.position.z + Math.cos(ang) * r);
    };
    const run = async (order) => {
      const b = await mounted('blurrg');
      assert(b.board(), 'setup: could not get on the blurrg');
      const why = C.orderCompanion(b.e, order);
      assert(!why, `setup: ${order} refused — ${why}`);
      const near = b.put(Math.PI / 2, 2.2);
      const far = b.put(0, 9);
      assert(near && far, 'setup: no hostiles');
      near.hp = near.maxHp = 400; far.hp = far.maxHp = 400;
      for (let i = 0; i < 300; i++) {
        held(b, near, 2.2, Math.PI / 2);
        held(b, far, 9, 0);
        near.hp = Math.min(near.hp, 400); far.hp = Math.min(far.hp, 400);
        b.p.hp = b.p.maxHp;
        b.world.update(STEP, b.input);
      }
      const out = { near: 400 - near.hp, far: 400 - far.hp, up: !!b.p.driving };
      b.world.unload?.();
      return out;
    };
    const charged = await run('verb');
    const heeled = await run('heel');
    assert(charged.up, 'CHARGE threw the rider off — that is the tauntaun\'s verb, not this one');
    assert(charged.near > 20,
      `ten seconds with a body at 2.2 m and the blurrg took ${charged.near.toFixed(0)} hp off it`);
    assert(charged.far === 0,
      `it went for the one at 9 m for ${charged.far.toFixed(0)} hp — CHARGE never leaves the ground you are on`);
    assert(heeled.near === 0,
      `under HEEL the same close body still lost ${heeled.near.toFixed(0)} hp, so this measures the brain and not the order`);
    return `ridden: CHARGE ${charged.near.toFixed(0)} hp onto the body at 2.2 m and `
      + `${charged.far.toFixed(0)} onto the one at 9 m; the same body under HEEL ${heeled.near.toFixed(0)}`;
  });

  check('companion: nothing anywhere offers a ride the game then refuses', async () => {
    /**
     * THE DEFECT THIS CHECK IS THE ANSWER TO, stated plainly: for as long as
     * the mounts have existed, `Menu.js` printed "You can ride this one." on
     * the Kennel card, three Databank entries described getting on, and the
     * tauntaun's blurb described being thrown off — while `whyNotDrive`
     * answered, verbatim, "Tauntaun is a droid — the brain is the machine, and
     * there is no seat in it". Four surfaces, one live rule, and the surfaces
     * were the ones talking to the player.
     *
     * SO THE CLAIM IS DRIVEN AGAINST A REAL BODY, not read off a flag. Every
     * kind whose row says `mount` is FIELDED, stood next to, and asked — and
     * the refusal string is what fails the check, so a future change that
     * closes the door leaves the reason in the failure message.
     *
     * AND THE OTHER NINE ARE ASKED TOO, which is the half that catches the
     * opposite lie: a kind the card does NOT offer a ride on must be refused,
     * or the flag has stopped meaning anything and the card has stopped being
     * information.
     */
    const { drivableNear, whyNotDrive } = await import('../../src/game/Driving.js');
    const menu = strip(await src('ui/Menu.js'));
    const offer = /You can ride this one\./.test(menu);
    assert(offer, 'the Kennel card no longer offers a ride; if that is deliberate this check is stale');
    /* THE CARD'S OWN CONDITION, read out of the source rather than assumed, so
     * a card that started offering rides on everything is caught here. */
    assert(/K\?\.mount\b[\s\S]{0,80}You can ride this one\./.test(menu),
      'the Kennel card offers a ride on something other than `mount`');

    const rows = [];
    for (const id of K.COMPANION_ORDER) {
      const kind = K.COMPANION_KINDS[id];
      const b = await mounted(id);
      b.e.position.set(b.p.position.x + 1.5, b.e.position.y, b.p.position.z);
      b.step(2);
      const why = whyNotDrive(b.world, b.p, b.e);
      const near = drivableNear(b.world, b.p);
      if (kind.mount) {
        assert(!why,
          `the card says you can ride a ${kind.label} and standing 1.5 m off one it says: "${why}"`);
        assert(near === b.e, `a ${kind.label} is rideable and the board prompt cannot find it`);
        assert(b.p.takeControls({ input: b.input }),
          `${kind.label}: the drive key was refused with no reason at all`);
        assert(b.e.driven, `${kind.label}: the key was accepted and nobody is on it`);
        rows.push(`${id} ✓`);
      } else {
        assert(why,
          `the card offers no ride on a ${kind.label} and the game let one be boarded anyway`);
        rows.push(`${id} refused`);
      }
      b.world.unload?.();
    }
    return `${K.COMPANION_ORDER.length} kinds asked on a live world: ${rows.join(' ')}`;
  });

  check('companion: RELAY carries an order past the end of your own voice', async () => {
    /**
     * THE ONE VERB THAT NEEDS AN ARMY, and the one that pays part of a cost
     * the command system already charges. `ORDER_REACH` is 34 m and a squad
     * sent further than that cannot hear you; `CommandDirector._runnerTick`
     * answers that with a named man who carries it, and `_carrying` — read
     * FIRST by `_voices` — is the whole of "the order was given from where he
     * is standing". A companion has no Trooper record and so cannot be a
     * runner; it reaches through the same one field.
     *
     * DRIVEN AT BOTH ENDS, because only the pair proves anything: the same
     * order, to the same squad, refused from the player's mouth and taken from
     * the droid's.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { ORDER_REACH } = await import('../../src/game/Command.js');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi', allies: 8 },
      runSeed: 21,
    });
    const input = idleInput();
    const p = world.player;
    try {
      /* `command.start(1)` is what puts bodies under the roster — without it
       * `led()` returns ten records and ten null bodies. */
      world.command?.start?.(1);
      for (let i = 0; i < 30 * 8; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); }
      const d = world.command;
      assert(d?.commander, 'the command fixture built no commander');
      const squads = d.squadsOf(d.commander);
      const idx = squads.findIndex((sq) => sq.filter((t) => t.body && !t.body.dead).length >= 2);
      assert(idx >= 0, 'no squad has two men with bodies');
      const men = squads[idx].filter((t) => t.body && !t.body.dead);
      for (let i = 0; i < men.length; i++) {
        const x = p.position.x + 90 + i * 1.5, z = p.position.z + i * 1.5;
        men[i].body.position.set(x, world.terrain.height(x, z), z);
      }
      for (let i = 0; i < 15; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); }
      const want = d.formation;
      const deaf = men[0];
      const gap = deaf.body.position.distanceTo(p.position);
      const mine = d.order(want, d.commander, idx);
      const whyNot = d.orderRefused;
      assert(mine === false, `your own "${want}" reached a squad ${gap.toFixed(0)} m away — the `
        + 'reach rule this verb pays for is not in force, so the check proves nothing');
      const b1 = C.fieldCompanion(world, p, 'massiff', { rec: { xp: 99, runs: 3, tempers: [] } });
      b1._cmpKind = 'b1c';
      b1.position.copy(p.position);
      assert(!C.orderCompanion(b1, 'verb', deaf.body), 'RELAY was refused a man of your own');
      let crossed = 0;
      for (let i = 0; i < 30 * 90 && b1._cmpRelayed === undefined; i++) {
        p.hp = p.maxHp ?? 100; world.update(STEP, input);
        crossed = i / 30;
      }
      assert(b1._cmpRelayed === true,
        b1._cmpRelayed === false ? 'it arrived and the order was refused anyway'
          : `it never delivered in ninety seconds (${b1.position.distanceTo(deaf.body.position).toFixed(0)} m short)`);
      assert(!b1._cmpDuty, 'the errand never ended');
      return `${men.length} men at ${gap.toFixed(0)} m of a ${ORDER_REACH} m reach: your own `
        + `"${want}" refused (${whyNot}); the droid crossed in ${crossed.toFixed(0)} s and they took it`;
    } finally { world.unload(); }
  });
  /* ── what it grows into ─────────────────────────────────────────────── */

  check('companion: a real crossing pays the ladder, and the top rung is reachable in one and only just', async () => {
    /**
     * THE TWO CLAUSES, DRIVEN. `tools/checks/command.mjs:845` pins them for the
     * trooper ladder — the top rung is reachable inside one run, and not before
     * 40% of it — and COMPANIONS.md says in as many words that the companion's
     * copy is to be DRIVEN rather than transcribed. So this drives a whole
     * crossing and reads the answer off the record.
     *
     * IT HAD TO BE DRIVEN, BECAUSE THE TRANSCRIBED NUMBER WAS WRONG. The design
     * set the gates at 0/6/16/30 on the arithmetic that a five-area crossing
     * pays six a boundary — one for crossing it, one for an order landing, two
     * for reaching you while you are down, two for being picked up. Measured,
     * it pays FOUR, because the third of those cannot be banked by any run in
     * any mode (see the check below it), and 5 × 4 is 20. The gate moved to 20
     * and the argument with the numbers is on `COMPANION_RANKS`.
     *
     * A GRIND AND NOT WHATEVER THE SEED ROLLS. `rollSession` rolls a crossing's
     * length — Raid 2, Push 3, Grind 5 — so "one long campaign" is a named
     * thing and the fixture names it rather than taking what it is given; a
     * seed that rolled a Raid would measure a two-area ceiling and call it the
     * game's.
     *
     * THE WINDOW IS ENTERED THROUGH `_goDown` AND NOT THROUGH A BOLT, and that
     * is a statement about this tree rather than a shortcut. `_mayGoDown` — the
     * eligibility test in front of it — opens `if (!this.trooper) return false`
     * and a companion has no trooper by design, so in this build a companion
     * does not go down, it dies. Everything past that gate is already generic:
     * `_goDown` reads the mode's own `downedScale`, the clock in `_tickDown`
     * knows nothing about a roster, and the revive below is a player standing
     * over the body for `DOWN_REVIVE` seconds — all of it real, all of it
     * driven here. What is stubbed is one refusal, and `DEEDS.recovered` is
     * unclaimable in play until it is lifted.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const S = await import('../../src/game/Session.js');
    const SEED = 2;
    assert(S.rollSession(SEED).engagements === 5,
      `seed ${SEED} no longer rolls a five-engagement Grind — the fixture is measuring a shorter run`);
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', quality: 'low' },
      runSeed: SEED,
    });
    try {
      const d = world.command, p = world.player, input = idleInput();
      assert(d?.campaign && d.stages.length === 5,
        `the fixture got ${d?.stages?.length} stages and not a Grind's five`);
      tick(world, input, p, 30);
      const rec = { id: 'grow', kind: 'massiff', name: 'Borz', xp: 0, runs: 0, areas: 0,
        kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] };
      const e = C.fieldCompanion(world, p, 'massiff', { rec });
      assert(e, 'nothing fielded into the crossing');
      assert(K.rungOf(rec).id === K.COMPANION_RANKS[0].id, 'it did not start on the bottom rung');

      const curve = [];
      for (let area = 0; area < d.stages.length && !world.over; area++) {
        /* AN ORDER THAT LANDS. AWAY moves the station back, so there is a real
         * gap for the animal to close — an order it was already obeying is not
         * an order that landed, which is the whole of the `lands` column. */
        assert(!C.orderCompanion(e, 'away'), 'AWAY was refused at the bottom rung');
        tick(world, input, p, 30 * 4);

        /* IT GOES DOWN AND YOU PICK IT UP — the shipped window and the shipped
         * revive, a player standing on the body every frame because the
         * character controller moves him off it otherwise. */
        e._goDown(e.position, { team: 1, position: e.position }, 'bolt');
        assert(e.downed && !e.dead, `area ${area + 1}: it did not go down`);
        let up = false;
        for (let i = 0; i < 30 * 20 && !up; i++) {
          p.position.set(e.position.x, e.position.y, e.position.z);
          p.hp = p.maxHp ?? 100;
          world.update(STEP, input);
          up = !e.downed && !e.dead;
        }
        assert(up, `area ${area + 1}: twenty seconds stood over it and it never got up — `
          + `downed ${e.downed} dead ${e.dead} hp ${(e.hp ?? -1).toFixed(0)} bleed `
          + `${(e.bleed ?? -1).toFixed(1)} over ${world.over} owner ${p.alive !== false} `
          + `gap ${C.stationGap(e).toFixed(1)}`);

        /* AND THE BOUNDARY, through the shipped path: payWave → _areaClear.
         * The wave number has to climb, because `payWave` is a ledger and pays
         * nothing for a number it has already been paid for. */
        const gap = C.stationGap(e);
        assert(gap <= C.leashOf(e), `area ${area + 1}: it was ${gap.toFixed(1)} m outside its leash`);
        d.areaWaves = d.area.waves - 1;
        d.wave = (d.wave | 0) + 1;
        d.payWave(d.wave);
        tick(world, input, p, 2);
        curve.push(`${area + 1}:${rec.xp}${K.rungOf(rec).label[0]}`);
      }

      /* EVERY DEED THAT A CROSSING CAN PAY, PAID. */
      assert(rec.areas === 5, `it was credited ${rec.areas} areas of five`);
      assert(rec.orders === 5, `${rec.orders} orders landed across five areas, not five`);
      assert(rec.downs === 5, `${rec.downs} falls counted, not five`);
      const each = Kn.DEEDS.crossed + Kn.DEEDS.order + Kn.DEEDS.recovered;
      const total = 5 * each;
      assert(rec.xp === total,
        `five areas paying ${each} each is ${total} and the record says ${rec.xp}`);

      /* ── AND THE TWO PINNED CLAUSES, against the number that was driven ── */
      const top = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1];
      assert(top.xp <= total,
        `the top rung needs ${top.xp} xp and one whole crossing is worth ${total} — it is not `
        + 'reachable inside one run');
      assert(top.xp > total * 0.4,
        `the top rung at ${top.xp} arrives inside the first ${(100 * top.xp / total).toFixed(0)}% of a `
        + 'crossing — it is not the rung for the animal that lived through all of it');
      assert(K.rungOf(rec).id === top.id, `a flawless crossing ended ${K.rungOf(rec).label}`);
      return `5 areas × ${each} = ${total} xp (${curve.join(' ')}); top rung ${top.xp} — reachable `
        + `(${top.xp} ≤ ${total}) and past the 40% floor of ${(total * 0.4).toFixed(0)}`;
    } finally { world.unload(); }
  });

  check('companion: a mode with no ground still pays the ladder', async () => {
    /**
     * THE LADDER ONLY TURNED IN THREE MODES OF ELEVEN, AND NOTHING SAID SO.
     *
     * The check above this one drives a five-area crossing and proves the
     * gates sit correctly against the deeds. It proves it in a CAMPAIGN, which
     * is `command`, `theline` and `campaign` — and the two deeds it measures
     * were the only two that could ever fire, because they were paid off
     * `world.command.areasTaken`, `areasTaken` counts records written by
     * `CommandDirector._areaClear`, and `payWave` returns one line above the
     * call that could reach it whenever there is no campaign:
     *
     *     if (!this.campaign) { this._reinforce(); return fresh; }
     *
     * The latch that lets `order` be paid a SECOND time is cleared in that same
     * unreachable block. So in the Trial of Waves, Path of the Blade, Sandbox,
     * Versus, Skirmish and a contingent Command, a whole run paid at most one
     * xp for ever — measured below, with the boundary suppressed to exactly the
     * answer the old reader gave in this mode. WARD is 6 xp and SEEK and the
     * kind's own verb are 16: the two orders the player asked for BY NAME, and
     * the whole "they all play differently" clause, were six and sixteen RUNS
     * away in the modes most people play.
     *
     * ── WHY THE COUNTERFACTUAL IS DRIVEN AND NOT ASSERTED ────────────────
     *
     * The "before" half shadows `wavesTaken` with 0 rather than describing what
     * used to happen. `world.command` is asserted null first, which is the
     * actual reason the old reader answered zero here, so the suppressed run IS
     * the old behaviour and not an impression of it. Both halves then run the
     * same fixture, so the difference between them is the boundary and nothing
     * else.
     *
     * ── AND TWO CURVES, BECAUSE A FLAWLESS RUN IS NOT A RUN ──────────────
     *
     * FLAWLESS pays both deeds every wave — an order lands (the animal is put
     * out at the station's edge first, because an order it is already obeying
     * is not an order that landed, which is what a wave of shooting does on its
     * own) and it is alive and inside the rope at the boundary. ORDINARY pays
     * only `crossed` after the first wave. The gates have to arrive inside one
     * run on the first and still be a long run on the second, or this is a
     * ladder that hands out SWORN for standing still.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const WAVES = 20;

    async function drive({ suppress = false, flawless = true } = {}) {
      const { world } = await bootWorld({
        level: 'geonosis',
        settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' },
        runSeed: 21,
      });
      try {
        const p = world.player, input = idleInput(), d = world.director;
        assert(!world.command,
          'the Trial of Waves has grown a CommandDirector — this fixture is no longer measuring a mode with no army');
        assert(d && typeof d.wavesTaken === 'number', 'the wave director publishes no ledger to read');
        if (suppress) Object.defineProperty(d, 'wavesTaken', { get: () => 0, configurable: true });
        tick(world, input, p, 30);
        const rec = { id: 'trial', kind: 'massiff', name: 'Borz', xp: 0, runs: 0, areas: 0,
          kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] };
        const e = C.fieldCompanion(world, p, 'massiff', { rec });
        assert(e, 'nothing fielded into the Trial');
        const at = {};
        for (let w = 1; w <= WAVES; w++) {
          if (flawless) {
            const st = C.stationFor(e, new THREE.Vector3());
            e.position.set(st.x + 9, e.position.y, st.z + 9);
          }
          assert(!C.orderCompanion(e, 'away'), `wave ${w}: AWAY was refused at the bottom rung`);
          tick(world, input, p, 30 * 4);
          /* THE BOUNDARY, THROUGH THE SHIPPED LEDGER. `payWave` is a
           * high-water mark and pays nothing for a number it has already been
           * paid for, so the wave has to climb — which is also why nothing
           * here can be farmed by a restart. */
          d.wave = (d.wave | 0) + 1;
          assert(d.payWave(d.wave), `wave ${d.wave} would not pay`);
          tick(world, input, p, 2);
          for (const duty of ['ward', 'seek']) {
            if (at[duty] == null && K.holdsCompanion(rec, duty)) at[duty] = w;
          }
          if (at.sworn == null && K.rungOf(rec).id === 'sworn') at.sworn = w;
        }
        return { xp: rec.xp, ...at };
      } finally { world.unload(); }
    }

    const before = await drive({ suppress: true });
    assert(before.xp <= 1,
      `the suppressed run paid ${before.xp} xp — the fixture is no longer reproducing the old boundary`);
    assert(before.ward == null && before.seek == null,
      `WARD arrived at wave ${before.ward} with the boundary suppressed — nothing was broken to begin with`);

    const flaw = await drive({ flawless: true });
    const ord = await drive({ flawless: false });

    /* WARD IS THE ONE THAT HAS TO ARRIVE FAST. COMPANIONS.md's own mitigation
     * for the licence ladder is "rung 1 arrives fast", and a mode with no
     * ground is where it never did. */
    assert(flaw.ward != null && flaw.ward <= 5,
      `WARD arrives at wave ${flaw.ward} of a flawless Trial — rung 1 is supposed to arrive fast`);
    assert(ord.ward != null && ord.ward <= 8,
      `WARD arrives at wave ${ord.ward} of an ordinary Trial`);
    /* SEEK AND THE KIND'S VERB INSIDE ONE RUN — the clause the player named. */
    assert(flaw.seek != null && ord.seek != null,
      `SEEK is still ${flaw.seek == null ? 'unreachable' : 'unreachable on an ordinary run'} inside ${WAVES} waves`);
    /* AND THE TOP RUNG IS STILL EARNED. `command.mjs:845`'s second clause said
     * in the units an endless mode has: not in the opening third of the run
     * the fixture drives, on either curve. */
    assert(flaw.sworn != null, `SWORN is unreachable in ${WAVES} waves even flawlessly`);
    for (const [name, r] of [['flawless', flaw], ['ordinary', ord]]) {
      assert(r.sworn == null || r.sworn > WAVES * 0.4,
        `SWORN arrives at wave ${r.sworn} of a ${name} ${WAVES}-wave run — inside the first 40%`);
    }
    assert(ord.xp < flaw.xp, 'an ordinary run pays what a flawless one pays');
    return `${WAVES} waves: suppressed ${before.xp} xp and no rung at all; flawless ${flaw.xp} xp `
      + `(WARD w${flaw.ward}, SEEK w${flaw.seek}, SWORN w${flaw.sworn}); ordinary ${ord.xp} xp `
      + `(WARD w${ord.ward}, SEEK w${ord.seek}, SWORN w${ord.sworn ?? '—'})`;
  });

  check('companion: it comes to you when you go down — and no run can bank what that pays', async () => {
    /**
     * THE FOURTH DEED, AND THE HONEST ACCOUNT OF WHAT IT IS WORTH.
     *
     * `DEEDS.reached` is +2 for "it reaches you while you are downed", and two
     * separate things had to be true before it could ever fire. Both are
     * measured here rather than asserted about.
     *
     * ONE: IT HAS TO COME. The heel station is 3.4 m off your back and the
     * radius that counts as reaching a body is `DOWN_HELP`, 2.2 m — so an
     * animal doing nothing but heeling is too far away by a metre and a
     * fifth, for ever, in every mode. The SWORN rung's second half ("it comes
     * to you unbidden when YOU go down, with nothing said") is the only thing
     * that closes it, which is why this check drives both rungs: the bottom
     * one stands its ground, the top one arrives.
     *
     * TWO: NOTHING CAN BANK IT. A player has no revivable downed state
     * anywhere in this game. `World._checkWipe` ends the run on the frame the
     * last player falls and `main.gameOver` folds the companion in that same
     * frame with `won` false, so `keepCompanion` clears the record the deed
     * was just written into; and co-op's `_reviveDowned` — the one real
     * down-and-get-up — is in the one mode `keepCompanion` returns null for.
     * The fold is driven below and the xp measured on both sides of it, which
     * is why the ceiling of a crossing is 20 and not 30.
     */
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const { DOWN_HELP } = await import('../../src/game/Enemy.js');
    const said = [];
    for (const xp of [0, 99]) {
      const { world, input, e, p } = await field('massiff', { id: 'r', kind: 'massiff', xp,
        runs: 0, tempers: [], downs: 0, orders: 0, ranged: 0, saves: 0 });
      try {
        assert(e, 'nothing fielded');
        tick(world, input, p, 30 * 2);
        const rec = e._cmpRec;
        const xp0 = rec.xp;
        /* YOU GO DOWN. The flag and nothing else: `Player.die` dynamically
         * imports a ragdoll and ends the run, and what every reader in this
         * feature actually tests is `alive === false` — see `ownerUp`. */
        p.alive = false;
        let best = Infinity;
        for (let i = 0; i < 30 * 12; i++) {
          world.update(STEP, input);
          best = Math.min(best, e.position.distanceTo(p.position));
        }
        const rung = K.rungOf(rec);
        const came = rec.xp - xp0;
        if (rung.orders.includes('hold')) {
          assert(best <= DOWN_HELP, `${rung.label}: it got no closer than ${best.toFixed(1)} m of your body`);
          assert(came === Kn.DEEDS.reached, `${rung.label}: reaching you paid ${came}, not ${Kn.DEEDS.reached}`);
          assert(rec.saves === 1, 'the free layer did not record the save');
        } else {
          assert(best > DOWN_HELP, `${rung.label}: an unsworn animal came to your body anyway`);
          assert(came === 0, `${rung.label}: it earned ${came} for standing its ground`);
        }
        said.push(`${rung.label.toLowerCase()} closed to ${best.toFixed(1)} m → +${came}`);
      } finally { world.unload(); }
    }
    /* AND THE FOLD CANNOT KEEP IT. Alive, unsworn to nobody, and a run that
     * ended the only way a player's death ends one: `won` false, not aboard. */
    Kn.clear();
    const rec = Kn.adopt('massiff', 'Borz');
    Kn.save({ live: { ...rec, xp: Kn.DEEDS.reached }, fallen: [], runs: 0, lost: 0 });
    const live = { ...Kn.load().live };
    const out = Kn.keepCompanion({
      netMode: null, settings: { level: 'geonosis' }, elapsed: 60,
      _companions: { rec: live, body0: { dead: false, downed: false }, aboard: false, rangedRun: false },
    }, { won: false });
    assert(out && !out.kept, 'a run the player died in kept the companion');
    assert(!Kn.load().live, `the record survived a lost run with ${live.xp} xp on it`);
    Kn.clear();
    return `${said.join('; ')}; and a lost run folded ${live.xp} xp into an epitaph`;
  });

  check('companion: the four counters the tempers read are written by play, and the fold banks them', async () => {
    /**
     * `earnedTempers` reads `runs`, `downs`, `orders` and `ranged`, and before
     * this commit NOTHING IN THE TREE WROTE ANY OF THEM. The four tempers were
     * priced, checked and unreachable.
     *
     * AND THE FOLD WAS READING THE WRONG OBJECT. `keepCompanion` called
     * `load()` a second time and folded what came back — a record freshly
     * rebuilt out of a store nothing had written since deploy — so every deed
     * of every run was discarded at the door. That is driven here: the run is
     * played on the record the pack is holding, and the store is read
     * afterwards to see whether any of it arrived.
     *
     * TWELVE LANDED ORDERS IS KEEN'S OWN NUMBER and it is reached by giving
     * twelve real orders that each move the animal, alternating AWAY and HEEL
     * so every one of them has a gap to close. A wheel tapped twelve times on
     * an animal already standing where it was told to stand lands nothing, and
     * that is the point of the `lands` column.
     */
    Kn.clear();
    const stored = Kn.adopt('massiff', 'Borz');
    assert(stored && stored.xp === 0 && stored.orders === 0, 'a fresh adoption is not fresh');
    const { world, input, e, p } = await field('massiff', stored);
    try {
      assert(e && e._cmpRec === stored, 'the pack is not holding the record the store handed it');
      const pack = world._companions;
      assert(pack.rec === stored, 'the pack did not keep the record for the fold');
      tick(world, input, p, 30 * 2);

      /* TWELVE ORDERS THAT LAND, and the player STEPS AWAY before each one.
       * Not for the walk's sake — for the leash's. The move wrap only overrides
       * a busy animal when it is `dragged` past the leash, so an order given to
       * a companion that is already biting something within its rope is an
       * order it gets to after the fight: measured without the step, six of
       * twelve landed inside the window and the other six were still holding a
       * target. That is the wrap behaving correctly and the fixture asking the
       * wrong question. */
      const home = p.position.clone();
      for (let i = 0; i < 12 && stored.orders < 12; i++) {
        p.position.x = home.x + (i % 2 ? 20 : -20);
        p.position.y = world.terrain.height(p.position.x, p.position.z) + 0.05;
        C.orderCompanion(e, i % 2 ? 'heel' : 'away');
        for (let f = 0; f < 30 * 10 && e._cmpAsked; f++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); }
      }
      assert(stored.orders >= 12, `only ${stored.orders} orders landed out of twelve given`);
      /* ONE PER AREA IS WHAT THE XP PAID, and there is one area in a wave mode:
       * twelve landings, one deed. That is `DEEDS.order`'s whole sentence. */
      assert(stored.xp === Kn.DEEDS.order,
        `twelve landed orders paid ${stored.xp} xp — the deed is once per area, not once per order`);

      /* IT GOES DOWN TWICE AND LIVES. */
      for (let n = 0; n < 2; n++) {
        e._goDown(e.position, { team: 1, position: e.position }, 'bolt');
        for (let i = 0; i < 30 * 20 && e.downed; i++) {
          p.position.set(e.position.x, e.position.y, e.position.z);
          p.hp = p.maxHp ?? 100;
          world.update(STEP, input);
        }
        assert(!e.downed && !e.dead, `it did not get up from fall ${n + 1}`);
      }
      assert(stored.downs === 2, `${stored.downs} falls counted, not two`);

      /* AND IT SPENDS THE REST OF THE RUN AT THE END OF ITS ROPE. The player
       * outruns it by design — that is the whole feature — so walking away is
       * all it takes to put the clock on the far side of the mark. */
      const far0 = pack.farT;
      for (let i = 0; i < 30 * 20; i++) {
        /* THE GAP PINNED AT TWICE THE MARK, by standing exactly as far ahead of
         * it as it can never close — which is not a trick, it is the feature:
         * `paceOf` caps every kind below your sprint, so a player who keeps
         * walking is a player the animal is always behind. */
        p.position.set(e.position.x + 24, 0, e.position.z);
        p.position.y = world.terrain.height(p.position.x, p.position.z) + 0.05;
        p.hp = p.maxHp ?? 100;
        world.update(STEP, input);
      }
      assert(pack.farT > far0, 'it never got beyond the mark at all');
      assert(pack.rangedRun,
        `far ${pack.farT.toFixed(1)} s against near ${pack.nearT.toFixed(1)} s — the run does not read as ranged`);

      /* THE FOLD. Alive and won, so it comes home and everything it did is
       * banked — including the tempers, which are hung by `applyTempers` on
       * the way through and by nothing else. */
      const fold = Kn.keepCompanion(world, { won: true });
      assert(fold?.kept, 'it did not come home from a won run');
      const disk = Kn.load().live;
      assert(disk, 'the fold kept it and the store is empty');
      assert(disk.xp === stored.xp && disk.orders === stored.orders && disk.downs === stored.downs,
        `the store banked xp ${disk.xp}/orders ${disk.orders}/downs ${disk.downs} against a run that `
        + `earned ${stored.xp}/${stored.orders}/${stored.downs} — the fold is reading a second copy`);
      assert(disk.runs === 1 && disk.ranged === 1, `runs ${disk.runs}, ranged ${disk.ranged}`);
      assert(disk.tempers.includes('scarred') && disk.tempers.includes('keen'),
        `two falls and twelve orders earned ${disk.tempers.join(', ') || 'nothing'}`);
      /* AND THE FOLD SAYS WHAT THE RUN MADE OF IT, which is the whole of what
       * a companion has to show for a ladder with no number on any screen.
       * `Trooper.award` returns the promotion it caused; the deeds here arrive
       * a frame at a time, so the fold compares against the rung it went out
       * on and reports the crossing once. */
      assert(fold.learned.includes('scarred') && fold.learned.includes('keen'),
        `the fold reported learning ${fold.learned.join(', ') || 'nothing'}`);
      assert(fold.rose === null, `one xp moved it to ${fold.rose?.label}`);
      const top = K.COMPANION_RANKS[K.COMPANION_RANKS.length - 1];
      Kn.save({ live: { ...disk, xp: top.xp }, fallen: [], runs: 0, lost: 0 });
      const climbed = Kn.keepCompanion({
        netMode: null, settings: {}, elapsed: 1,
        _companions: { rec: { ...Kn.load().live }, rung0: K.COMPANION_RANKS[0].id,
          body0: { dead: false, downed: false }, aboard: true, rangedRun: false },
      }, { won: false });
      assert(climbed?.rose?.id === top.id,
        `a run that carried it to ${top.xp} xp reported ${climbed?.rose?.label ?? 'no climb'}`);

      /* AND THE TWO THAT MEAN OPPOSITE THINGS CANNOT BOTH BE WORN — the
       * `sheds` field, on records rather than on a world, because it is a rule
       * about a table and driving a fourth run to see it would prove less. */
      const drift = Kn.applyTempers({ ...disk, runs: 5, ranged: 5, tempers: [...disk.tempers, 'heeled'] });
      assert(drift.tempers.includes('ranging') && !drift.tempers.includes('heeled'),
        `five ranging runs left it wearing ${drift.tempers.join(', ')}`);
      return `12 orders landed → 1 deed and KEEN; 2 falls → SCARRED; far ${pack.farT.toFixed(0)} s `
        + `vs near ${pack.nearT.toFixed(0)} s → ranged 1; folded xp ${disk.xp}, runs ${disk.runs}, `
        + `tempers ${disk.tempers.join('+')}; the fold named the climb to ${climbed.rose.label}; `
        + 'and RANGING sheds HEELED';
    } finally { world.unload(); Kn.clear(); }
  });




  check('companion: the card counts what it killed, and it counts nothing else', async () => {
    /**
     * `rec.kills` HAD NO WRITER, and the card was already printing it.
     *
     * `Menu._syncKennel` renders "…, N of theirs" off `k.live.kills`,
     * `Kennel.readOne` clamps the field and `COMPANION_FIELDS` whitelists it
     * through the fold — the whole chain was there and nothing anywhere
     * incremented the number, so an animal that had taken forty bodies apart
     * across three runs read as having killed nobody. That is the one figure
     * on the card a player would actually check.
     *
     * THREE CLAUSES, and the second and third are the ones worth having:
     *
     *   IT COUNTS A KILL. Driven through `world.onEnemyKilled`, which is the
     *   world's own door for "a body on the other side is down and this is who
     *   did it" — not a second kill path invented beside the animal.
     *
     *   IT COUNTS NOTHING ON YOUR OWN SIDE. A trooper of yours dying with the
     *   companion as the source is a casualty, which is the line World.js
     *   already draws for the player two statements into the same method.
     *
     *   AND IT PAYS NO EXPERIENCE, which is the load-bearing one. COMPANIONS.md
     *   settles growth on what the animal did FOR YOU — crossings survived,
     *   orders that landed, coming to you when you fell — and `DEEDS` has four
     *   entries with no kill among them. A ladder you can climb by farming a
     *   wave is a different design, and this asserts that we did not quietly
     *   ship it.
     */
    const { world, input, e, p } = await field('massiff',
      { id: 'k', kind: 'massiff', name: 'Borz', xp: 0, runs: 0, areas: 0, kills: 0,
        saves: 0, downs: 0, orders: 0, ranged: 0, tempers: [], story: [], scars: [] });
    try {
      const rec = e._cmpRec;
      assert(rec && rec.kills === 0, 'the fixture did not start on a record with no kills');
      const xp0 = rec.xp | 0;
      const put = (r, team) => {
        const x = p.position.x + r, z = p.position.z;
        const f = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
        if (f) f.team = team;
        return f;
      };
      const foes = [put(3, 1), put(4, 1), put(5, 1)].filter(Boolean);
      assert(foes.length === 3, `only ${foes.length} hostiles spawned for the tally`);
      for (const f of foes) world.onEnemyKilled(f, e, 'cut');
      assert(rec.kills === 3, `three bodies through the world's own kill door counted ${rec.kills}`);

      /* …AND THE TWO IT MUST NOT COUNT. */
      world.onEnemyKilled(e, e, 'cut');
      const mate = put(2, e.team);
      assert(mate, 'nothing spawned on your own side');
      world.onEnemyKilled(mate, e, 'cut');
      assert(rec.kills === 3,
        `the animal killing itself or one of yours moved the tally to ${rec.kills}`);

      /* AND THE FENCE IS LOAD-BEARING. A body in the pack with NO record is
       * the sandbox's animal, the dojo's and every check's, and it must count
       * nothing rather than throw — proved by taking the record away and
       * running the same door. */
      const keep = e._cmpRec;
      e._cmpRec = null;
      const extra = put(6, 1);
      world.onEnemyKilled(extra, e, 'cut');
      e._cmpRec = keep;
      assert(rec.kills === 3, 'a companion with no record wrote to a record anyway');

      assert((rec.xp | 0) === xp0,
        `four kills paid ${(rec.xp | 0) - xp0} experience — the ladder is not a body count`);
      tick(world, input, p, 5);
      return `3 hostiles → 3 on the card; itself, one of yours and one with no record → still 3; `
        + `and xp unmoved at ${rec.xp | 0}`;
    } finally { world.unload(); Kn.clear(); }
  });
  /* ══════════════════════════════════════════════════════════════════════ */
  /*  THE LIFE BETWEEN THE ACTIONS — src/game/CompanionLife.js              */
  /*                                                                        */
  /*  "these companions need to look incredible, they're going to be on the  */
  /*   screen a lot … they have to look incredibly detailed and different    */
  /*   and unique and fleshed out and LIVING"                                */
  /*                                                                        */
  /*  Every check below MEASURES A BONE. Not "the module exports a step      */
  /*  function", not "the table has twelve rows" — the assertion is always   */
  /*  that something on the animal moved, by how much, and in the direction  */
  /*  the state it was in says it should.                                   */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * A WORLD THE ANIMAL CAN ACTUALLY STAND STILL IN — AND WHERE THE ONE THAT
   * CANNOT IS, EXACTLY, BECAUSE "GEONOSIS" WAS TOO BIG AN ANSWER.
   *
   * `field()` above boots Geonosis, and that is right for everything it is
   * used for. It is wrong for an idle test, and this note used to say why in
   * one sentence — "on Geonosis a companion at heel never settles" — which was
   * a true observation and a false diagnosis. Re-measured properly:
   *
   *   THE LEVEL IS FINE. The same fixture with the player standing on any of
   *   five other points on the shipped Geonosis — (20,30), (-25,-20), (40,10),
   *   (10,-35) and the spawn itself with the animal placed 0.4 m further back
   *   — settles at a 0.04 m gap and 0.00 m/s, calm for 29.5 s of 30, with idle
   *   beats firing. It is not broken ground and it is not the terrain clutter.
   *
   *   IT IS THE PLAYER'S SPAWN POINT, AND ONLY THAT. `fieldCompanion` drops
   *   the animal at (0.00, 4.60) and `stationFor` puts its heel at (-0.90,
   *   4.60) — 0.90 m dead in −X, straight into a static face whose outward
   *   normal is +X. `Enemy._move` slides the wish along that face, `_wallSide`
   *   latches a direction, the body runs off in +Z until `_wallT` lapses,
   *   turns back into the same face and starts again. Over forty seconds:
   *   `_wallT` alight on 64% of frames, mean speed 3.76 m/s, mean gap 1.98 m
   *   against a 0.61 m settled band, and `_stuckT` NEVER ONCE above 0.5 s —
   *   0.0% of frames — because a body covering four metres a second is not
   *   stuck by its own measure. That is not the stuck-commit "fighting terrain
   *   clutter"; it is the closed circuit `Enemy._move`'s own note names in as
   *   many words, walked at full speed, and the latch written to break it does
   *   not break this one.
   *
   *   AND IT ENDS WHEN YOU WALK AWAY. Driven off the spawn and 18 m up the
   *   diagonal, the animal settles inside five seconds — gap 0.09 m, speed
   *   0.00 — and stays settled for the rest of the run, `calm` climbing past
   *   28 s.
   *
   * SO IT IS STILL NOT CompanionLife's, AND NOW FOR A STATED REASON RATHER
   * THAN A GENERALITY. The layer's `moving` sense reads `speed > 0.35` and the
   * body is doing 3.76 — the read is TRUE, and softening it, or adding a
   * settle hysteresis here, would buy an animal that scratches itself while
   * sprinting. The fix is in `Enemy._move`'s wall slide (or in `stationFor`
   * declining to put a heel inside a face), and both of those are other
   * people's files. Written down here so the next person measures the spawn
   * point rather than the planet.
   */
  const calmField = async (kind = 'massiff', rec = null) => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const { world } = await bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', level: 'colosseum', allies: 0, quality: 'low' },
      runSeed: 21,
    });
    const input = idleInput();
    for (let i = 0; i < 30; i++) world.update(STEP, input);
    const e = fieldCompanion(world, world.player, kind, { rec: rec || { id: `k-${kind}`, xp: 99 } });
    return { world, input, e, p: world.player };
  };

  /** Tick, keeping the player alive AND clearing the field, so "calm" is calm. */
  const calmTick = (world, input, p, n) => {
    for (let i = 0; i < n; i++) {
      if (p) p.hp = p.maxHp ?? 100;
      for (const o of world.enemies) if (!o.dead && !o.companion) { o.hp = 0; o.dead = true; }
      world.update(STEP, input);
    }
  };

  /** Where a head bone is pointing, in world bearing. Both skeletons author the
   *  head geometry facing the bone frame's +Z — `_poseWalker`'s own head track
   *  says so on the line above it — so this is that vector. */
  const gazeOf = (e) => {
    const q = e.rig.worldQuat('head', new THREE.Quaternion());
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    return Math.atan2(v.x, v.z);
  };
  const bearing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  check('companion: it looks at things, and WHAT it looks at is the kind\'s own job', async () => {
    /**
     * "It looks at things. The head turns: toward its target when it has one,
     *  toward the nearest hostile when it does not, toward the OWNER when the
     *  owner is close and nothing is happening"
     *
     * THE SINGLE BIGGEST ONE. A head that tracks reads as an animal and a head
     * locked forward reads as a prop — and before CompanionLife.js the ONLY
     * head track in the game was eleven lines inside `_poseWalker` gated on
     * `this.target`, so a companion with nothing to fight stared straight
     * ahead for the rest of the level.
     *
     * AND THE LADDER IS THE KIND'S OWN JOB, off `K.ward` and off no other
     * field. A massiff (ward 9) is a body whose standing order is meeting what
     * comes near you, so a hostile inside that radius outranks its owner for
     * its attention. A tooka (ward 0) cannot fight at all, so it watches YOU.
     * The two animals are put in the SAME scene, at the same distances, with
     * the same hostile, and the assertion is that they look at different
     * things — which is a claim no amount of tuning can accidentally satisfy.
     *
     * BOTH ARE UNDER `away`, and that is what makes this the LAYER's test
     * rather than the gait's: `dutyAllows` refuses every body under AWAY, so
     * `e.target` is null, `_poseWalker` never touches the head, and every
     * degree measured here was written by CompanionLife. It is also the design
     * point stated: an animal told to break off still watches what it was told
     * to break off from.
     */
    const { LIFE } = await import('../../src/game/CompanionLife.js');
    const rows = [];
    for (const kind of ['massiff', 'tooka']) {
      const { world, input, e, p } = await calmField(kind);
      let rest = null;
      try {
        assert(e, `${kind} would not field`);
        assert(e.rig?.get('head'), `${kind} has no head bone to turn`);
        /**
         * WHERE THE HOSTILE GOES, AND WHERE THE OWNER IS — BOTH INSIDE THE
         * NECK, AND THE SECOND HALF IS NEW.
         *
         * A neck has a stop. `LIFE.look.yaw` is 0.62 rad, and a body further
         * than that off the animal's shoulder is one it cannot look at at all.
         * The first cut of this check put the hostile 6 m off the player's +X
         * and measured 1.67 rad of "error" on an animal that was turning its
         * head as far as a head turns.
         *
         * The second cut fixed that for the HOSTILE and left the OWNER outside
         * the stop — a companion at heel stands off your back quarter, so its
         * owner is round behind it, 1.81 rad on this fixture — and then
         * asserted that the ward-0 animal "turns toward him, TO THE STOP".
         * That is a check that passes by reading a saturated solver, and it
         * ratified a real defect: measured on this same fixture, the gaze
         * channel sat at exactly 0.620 rad on 899 frames of 899, which is not
         * an animal tracking its owner but a head jammed against its own limit
         * for as long as anybody watches.
         *
         * So the animal's own facing is SET, once, with its owner 0.40 rad off
         * its nose and the hostile 0.45 rad the other way — both inside the
         * stop, 0.85 rad apart, and the massiff's hostile still inside its
         * ward of 9 from the player (the heel is 3.4 m back, so 7.4 m at
         * worst). Now neither branch of the ladder is judged on how far a neck
         * bends: each is judged on whether the head ARRIVES on the thing that
         * kind is supposed to be watching — including the ward-0 half, which
         * the old check declared no correct implementation could satisfy.
         *
         * SETTING `facing` IS A FIXTURE PIN AND NOT A LIE. `Enemy._move` holds
         * a body's facing when it has no target and is not travelling ("face
         * the target while fighting, face travel otherwise"), so a settled
         * companion keeps whatever heading it last walked in on. It is
         * re-asserted every frame for the same reason the hostile's position
         * is: a bearing that moves under the measurement measures nothing.
         *
         * The hostile is parked the way `_beastshot` parks a subject: speed
         * zero, both timers out. One that walks moves the bearing, and one
         * that shoots raises `underFire`, which is a different channel.
         */
        assert(!C.orderCompanion(e, 'away'), 'AWAY was refused — it is unrefusable at every rung');
        for (let i = 0; i < 30 * 3; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); }
        const V = p.position.constructor;
        const face = bearing(e.position, p.position) + 0.40;
        e.facing = face;
        const a = face + 0.45;
        const spot = new V(e.position.x + Math.sin(a) * 4, e.position.y, e.position.z + Math.cos(a) * 4);
        const foe = world.spawnEnemy('b1', spot.clone());
        assert(foe, 'no hostile spawned');
        foe.team = (p.team ?? 0) + 1;
        const ward = K.COMPANION_KINDS[kind].ward;
        const reach = spot.distanceTo(p.position);
        assert(ward === 0 || reach < ward,
          `the fixture put the hostile ${reach.toFixed(1)} m from the player, outside the ${ward} m ward`);
        /**
         * AND THE READING IS TAKEN ON A FRAME WITH NO IDLE BEAT RUNNING.
         *
         * The gaze is not the only thing writing the head: a `glance` swings
         * it 0.45 rad off whatever it was watching, on the animal's own
         * randomised timer, and a single-frame reading that lands inside one
         * measures the beat rather than the ladder. The first run of this
         * rewrite failed exactly that way — the tooka read 0.88 rad off an
         * owner its gaze channel was holding at 0.40. So every beat-free frame
         * of the last three seconds is a candidate and the last of them is the
         * reading, which is the same body in the same state with one fewer
         * channel on top of it.
         */
        let restFrame = -1;
        for (let i = 0; i < 30 * 8; i++) {
          p.hp = p.maxHp ?? 100;
          /**
           * AND THE PIN HAS TO INCLUDE `toTarget`, WHICH IS THE HALF THAT
           * ACTUALLY MOVES THE BODY.
           *
           * `Enemy._move` reads "face the target while fighting, face travel
           * otherwise" off `toTarget` — a direction the brain leaves behind
           * and which survives the target being refused — so writing `facing`
           * alone is undone inside the same frame, before the life layer ever
           * sees it. Measured: `facing` set to 0.400 came back 1.131, and both
           * kinds then read as watching the hostile because the animal had
           * quietly turned toward it. Clearing the leftover and the velocity
           * with it is the same parking `_beastshot` does to a subject, and it
           * is the only way this fixture can hold a bearing still.
           */
          e.facing = face;
          e.toTarget = null;
          e.velocity.set(0, 0, 0);
          foe.hp = foe.maxHp; foe.dead = false; foe.downed = false;
          foe.speed = 0; foe.attackTimer = 1e9; foe.stunTimer = 1e9;
          foe.velocity.set(0, 0, 0);
          foe.position.copy(spot);
          world.update(STEP, input);
          if (i >= 30 * 5 && !e._life?.beat) {
            restFrame = i;
            const h = e.rig.worldPos('head', new THREE.Vector3());
            const gg = gazeOf(e);
            rest = { dFoe: Math.abs(wrap(gg - bearing(h, foe.position))),
              dOwn: Math.abs(wrap(gg - bearing(h, p.position))),
              turn: wrap(gg - face) };
          }
        }
        assert(restFrame >= 0 && rest,
          `${kind} was mid-beat on all ninety frames of the reading window — nothing here can be read`);
        const ownOff = Math.abs(wrap(bearing(e.position, p.position) - face));
        const foeOff = Math.abs(wrap(bearing(e.position, foe.position) - face));
        assert(ownOff < LIFE.look.yaw && foeOff < LIFE.look.yaw,
          `the fixture left the owner ${ownOff.toFixed(2)} rad and the hostile ${foeOff.toFixed(2)} rad `
          + `off the animal's nose against a ${LIFE.look.yaw} rad neck — one of them cannot be looked `
          + 'at, which is the saturation this check used to ratify');
        assert(!e.target, `${kind} took a target under AWAY — this measures the gait, not the layer`);
        const head = e.rig.worldPos('head', new THREE.Vector3());
        const split = Math.abs(wrap(bearing(head, foe.position) - bearing(head, p.position)));
        assert(split > 0.5,
          `the fixture put the owner and the hostile ${split.toFixed(2)} rad apart — it cannot tell them apart`);
        rows.push({ kind, ward, split, ...rest });
      } finally { world.unload(); }
    }
    const dog = rows.find((r) => r.ward > 0);
    const cat = rows.find((r) => r.ward === 0);
    assert(dog && cat, 'the fixture did not produce one warder and one non-warder');
    /**
     * BOTH HALVES ARE NOW ABSOLUTE, AND THAT IS THE POINT OF THE REWRITE.
     *
     * The old version of this check could only hold the ward-0 half to a
     * DIRECTION — "it turns the other way, to the stop" — because its fixture
     * left the owner 2.5 rad round behind an animal with a 0.62 rad neck. A
     * direction is all you can assert about a solver you have saturated, and
     * asserting it is what let the saturation ship.
     *
     * With both bodies inside the neck, each kind is held to ARRIVING on the
     * thing its own row says it watches: the warder ends on the hostile, the
     * ward-0 animal ends on its owner, and each is a long way off the other
     * one's. The sign test is kept as well, because two heads that arrive on
     * two different bodies must also have turned in two different directions,
     * and a solver that satisfied the distances by accident could not satisfy
     * that too.
     *
     * (The DECK body gets the same rung for free: `stepCompanionDeck` turns
     * the whole animal to face you when it sits, which is why the hangar is
     * the room where a companion looks you in the eye.)
     */
    assert(dog.dFoe < 0.4,
      `a warding companion ended ${dog.dFoe.toFixed(2)} rad off the hostile inside its own ward`);
    assert(cat.dOwn < 0.4,
      `a ward-0 companion ended ${cat.dOwn.toFixed(2)} rad off its OWNER standing in front of it — `
      + 'the one thing a kind that cannot fight is supposed to be watching');
    /* AND EACH IS A LONG WAY OFF THE OTHER ONE'S BODY. Both are inside the
     * neck now, so the two bodies are only 0.85 rad apart rather than the 2.5
     * the old saturated fixture had — the separation asserted is a shade over
     * half of that, which no solver watching the same body twice can reach. */
    assert(cat.dFoe > 0.5,
      `ward 0 ended ${cat.dFoe.toFixed(2)} rad off the hostile with its owner 0.85 rad the other `
      + 'way — a kind that cannot fight is watching the fight');
    assert(dog.dOwn > 0.5,
      `ward 9 ended ${dog.dOwn.toFixed(2)} rad off its owner — the ward field is reordering nothing `
      + 'in the other direction either');
    assert(dog.turn * cat.turn < 0,
      `both heads turned the same way (${dog.turn.toFixed(2)} and ${cat.turn.toFixed(2)} rad off `
      + 'their own facing) — ward 0 is supposed to mean it turns AWAY from the fight, toward YOU');
    /* AND NEITHER OF THEM IS ON ITS STOP. Both were given something they could
     * reach, so a head sitting on `LIFE.look.yaw` here is a solver that has
     * saturated on something it should never have chosen. */
    for (const r of [dog, cat]) {
      assert(Math.abs(Math.abs(r.turn) - LIFE.look.yaw) > 0.02,
        `the ward-${r.ward} animal's head is sitting on the ${LIFE.look.yaw} rad neck stop `
        + `(${r.turn.toFixed(3)} rad) with a body 0.45 rad off its nose to look at`);
    }
    return `ward 9 turns ${dog.turn.toFixed(2)} rad onto the hostile, ending ${dog.dFoe.toFixed(2)} off `
      + `it and ${dog.dOwn.toFixed(2)} off its owner; ward 0 turns ${cat.turn.toFixed(2)} rad the other `
      + `way, ending ${cat.dOwn.toFixed(2)} off its owner and ${cat.dFoe.toFixed(2)} off the hostile`;
  });

  check('companion: it breathes, and its state is the RATE and not the pose', async () => {
    /**
     * "It breathes, and the rate is its state: slow at rest, fast when winded
     *  or under half health. Amplitude on the ribcage, not on the whole body."
     *
     * BOTH HALVES ARE ASSERTED SEPARATELY, because they fail separately.
     *
     * THE RATE is counted off the actual mesh — zero crossings of the girth
     * scale over a window — at rest and again at 18% health, and the second
     * has to be materially faster. A single amplitude reading could not tell
     * the two states apart at all.
     *
     * THE AMPLITUDE IS ON THE RIBCAGE, and the way that is proved is by
     * asserting what did NOT move: the chest BONE's scale is exactly 1, which
     * it can only be if the swell was applied to the merged hide mesh hanging
     * off that bone rather than to the bone that carries the head and the
     * limbs. Scale the bone and the whole animal inflates — head, legs and all
     * — which is the failure this line exists to catch.
     */
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      calmTick(world, input, p, 60);
      const L = e._life;
      assert(L, 'the body carries no life record at all');
      const rib = L.parts.ribs[0];
      assert(rib, 'the trunk has no mesh to breathe with');

      const seconds = 24;
      /** Zero crossings of (girth − 1) over n frames; a cycle is two. `hp` is
       *  held every frame because a hurt animal left alone heals or dies. */
      const rateAt = (n, hp) => {
        let last = rib.mesh.scale.x - 1, cross = 0;
        for (let i = 0; i < n; i++) {
          if (hp != null) e.hp = hp;
          calmTick(world, input, p, 1);
          const v = rib.mesh.scale.x - 1;
          if ((v > 0) !== (last > 0)) cross++;
          last = v;
        }
        return cross / 2 / (n * STEP);
      };
      const swingAt = (n, hp) => {
        let lo = 9, hi = -9;
        for (let i = 0; i < n; i++) {
          if (hp != null) e.hp = hp;
          calmTick(world, input, p, 1);
          lo = Math.min(lo, rib.mesh.scale.x); hi = Math.max(hi, rib.mesh.scale.x);
        }
        return hi - lo;
      };

      const rest = rateAt(30 * seconds, null);
      assert(rest > 0.05,
        `the ribcage did not move at all over ${seconds} s — measured ${rest.toFixed(3)} Hz`);
      /* THE ALLOMETRY, checked against the record's own derived number rather
       * than against a constant written twice. */
      assert(Math.abs(rest - L.breath) < L.breath * 0.35,
        `the ribs cycle at ${(rest * 60).toFixed(1)}/min against a derived ${(L.breath * 60).toFixed(1)}/min`);
      const before = swingAt(30 * 6, null);

      const hold = e.maxHp * 0.18;
      const hurt = rateAt(30 * seconds, hold);
      const after = swingAt(30 * 6, hold);
      assert(hurt > rest * 1.35,
        `at 18% health it breathes at ${(hurt * 60).toFixed(1)}/min against ${(rest * 60).toFixed(1)}/min `
        + 'at rest — being hurt is supposed to be a rate');
      assert(after < before,
        `a hurt animal's chest swells ${(after / before).toFixed(2)}x as far as a healthy one's — `
        + 'faster and SHALLOWER is the state; faster and deeper is a balloon');

      const bone = L.parts.chest.obj.scale;
      assert(bone.x === 1 && bone.y === 1 && bone.z === 1,
        `the chest BONE is scaled ${bone.x.toFixed(3)},${bone.y.toFixed(3)},${bone.z.toFixed(3)} — `
        + 'that inflates the head and the legs with it. The swell belongs on the hide mesh');
      return `${(rest * 60).toFixed(1)}/min at rest (derived ${(L.breath * 60).toFixed(1)}), `
        + `${(hurt * 60).toFixed(1)}/min at 18% health, swing ${(after / before).toFixed(2)}x, `
        + 'and the chest bone is unscaled';
    } finally { world.unload(); }
  });

  check('companion: the idle beats fire, and anything at all stops one', async () => {
    /**
     * "Occasional idle beats, on a per-body randomised timer so two massiffs
     *  are never in phase: a shake-off, a sniff at the ground, a head-scratch,
     *  a stretch. Cheap, short, and interrupted the instant anything happens."
     *
     * They FIRE — a real animal in a real world, seventy calm seconds, and the
     * count of DISTINCT beats it performed. Nothing here inspects a table.
     *
     * They are INTERRUPTED. A beat is started, then the animal is put under
     * fire mid-beat, and the weight has to be gone inside half a second. This
     * is the one that would fail silently: an idle animation that plays
     * through a firefight is worse than none.
     */
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      const seen = new Set();
      let firstAt = -1;
      for (let i = 0; i < 30 * 70; i++) {
        calmTick(world, input, p, 1);
        const b = e._life?.beat;
        if (b) { if (firstAt < 0) firstAt = i * STEP; seen.add(b.id); }
      }
      assert(seen.size >= 2,
        `seventy calm seconds produced ${seen.size} distinct idle beats [${[...seen].join(',')}] — `
        + 'an animal that stands perfectly still is the thing this file exists to stop');
      assert(firstAt > 1 && firstAt < 40,
        `the first beat landed at ${firstAt.toFixed(1)} s — it should be neither instant nor never`);

      let waited = 0;
      while (!e._life.beat && waited < 30 * 40) { calmTick(world, input, p, 1); waited++; }
      assert(e._life.beat, 'no beat to interrupt');
      calmTick(world, input, p, 6);
      const wasW = e._life.beatW;
      const wasId = e._life.beat?.id;
      const { UNDER_FIRE } = await import('../../src/game/Command.js');
      for (let i = 0; i < 15; i++) { e.underFire = UNDER_FIRE; calmTick(world, input, p, 1); }
      assert(wasW > 0.05, `the beat was only ${wasW.toFixed(3)} in when the shooting started`);
      assert((e._life.beatW || 0) < 0.05,
        `half a second under fire and the ${wasId} is still ${e._life.beatW.toFixed(2)} of the way on`);
      return `${seen.size} distinct beats [${[...seen].join(',')}] in 70 calm seconds, first at `
        + `${firstAt.toFixed(1)} s; a ${wasId} at ${wasW.toFixed(2)} weight was gone 0.5 s after `
        + 'the first round landed';
    } finally { world.unload(); }
  });

  check('companion: standing still at your heel, its head is not jammed on its own stop', async () => {
    /**
     * THE COMMONEST THING A PLAYER WILL EVER SEE THIS FEATURE DO, and for a
     * whole round it was the worst-looking.
     *
     * A companion at heel stands 3.4 m off your BACK quarter, and `Enemy._move`
     * holds a settled body's facing at whatever heading it last walked in on —
     * so with the player standing still, the owner sits round behind the
     * animal's shoulder. Measured on this fixture: 1.812 rad (103.8°) against
     * a 0.62 rad neck. The gaze ladder picked him anyway and `clamp` did the
     * rest, so the gaze channel read EXACTLY 0.620 rad — `LIFE.look.yaw`, to
     * three decimals — on 899 frames of 899. That is not a head tracking its
     * owner. It is a head cranked to its limit and held there for as long as
     * anybody watches, which is a statue with a crick in its neck.
     *
     * WHAT IS ASSERTED IS BOTH HALVES, because either one alone is satisfiable
     * by a defect:
     *
     *   NOT PINNED. Over a sixty-second window with the player still, the gaze
     *   must not sit on the stop. A handful of frames while something walks out
     *   of reach would be tracking; a whole window is a jam, so the bar is 5%
     *   of the window and the old behaviour scored 100%.
     *
     *   AND NOT DEAD. A head that never moves passes the first half perfectly,
     *   so the head BONE has to travel over the same window — which after the
     *   fix is the idle beats doing it, since the gaze itself correctly has
     *   nothing it can reach from where the animal is standing.
     *
     *   THE BAR ON THAT HALF IS 0.25 rad AND IT WAS MEASURED, not chosen. The
     *   head is never quite still even with every beat suppressed: it
     *   counter-rotates the tail's wag every frame by construction (see
     *   `applyLife`), which is 11.5 rad of accumulated travel over a minute
     *   inside a 0.12 rad envelope. Total travel therefore cannot tell a
     *   living head from a wagging statue and a SPAN can — 0.61 rad with the
     *   beats firing against 0.12 without them.
     *
     * `L.yaw` IS THE GAZE CHANNEL AND NOT THE BONE, deliberately: the bone
     * carries the beats on top, and a beat that swings the head past the stop
     * is an animal shaking itself off rather than a solver saturating. The
     * thing that must never sit on the stop is the thing the stop is about.
     */
    const { LIFE } = await import('../../src/game/CompanionLife.js');
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      const hb = e.rig.get('head');
      assert(hb, 'no head bone to measure');
      calmTick(world, input, p, 60);
      const L = e._life;
      assert(L, 'the body carries no life record at all');

      let pinned = 0, n = 0, hLo = 9, hHi = -9, travel = 0, prev = null;
      let gapMax = 0, speedMax = 0;
      for (let i = 0; i < 30 * 60; i++) {
        calmTick(world, input, p, 1);
        n++;
        if (Math.abs(Math.abs(L.yaw) - LIFE.look.yaw) < 1e-3) pinned++;
        const a = hb.obj.quaternion.angleTo(hb.restQuat);
        hLo = Math.min(hLo, a); hHi = Math.max(hHi, a);
        if (prev !== null) travel += Math.abs(a - prev);
        prev = a;
        gapMax = Math.max(gapMax, C.stationGap(e));
        speedMax = Math.max(speedMax, Math.hypot(e.velocity.x, e.velocity.z));
      }
      /* THE FIXTURE IS ONLY MEANINGFUL IF THE ANIMAL REALLY IS STANDING AT ITS
       * HEEL — an animal still walking home is a different measurement, and it
       * is the one the Geonosis note further up is about. */
      assert(gapMax < C.settledBand(e) && speedMax < 0.35,
        `the animal never settled (gap ${gapMax.toFixed(2)} m against a ${C.settledBand(e).toFixed(2)} `
        + `band, ${speedMax.toFixed(2)} m/s) — this window measures a walk, not an idle`);
      /**
       * THE ROOT IS CLOSED NOW, AND THIS HALF TURNED ROUND WITH IT. The move
       * wrap's `faceOwner` brings a settled body round to its owner (see
       * `installCompanionMove`), so the owner is no longer 1.8 rad round
       * behind the shoulder — he is on the animal's nose, inside the neck,
       * and the gaze has something it can reach. The assertion that used to
       * stand here demanded the OLD geometry (owner outside the neck) and
       * would have been a check that asserts the bug (HANDOFF §0.1f). What
       * is asserted instead is the thing the player sees: the body faces
       * you, and the head is still free on top of that.
       */
      const owner = Math.abs(wrap(bearing(e.position, p.position) - (e.facing || 0)));
      assert(owner < 0.35,
        `settled at your heel the animal's body is ${owner.toFixed(2)} rad off you — the move wrap `
        + 'is not bringing it round to face its owner');

      const frac = pinned / n;
      assert(frac < 0.05,
        `the gaze sat on its own ${LIFE.look.yaw} rad stop for ${(frac * 100).toFixed(1)}% of a `
        + `${(n / 30) | 0} s window (${pinned}/${n} frames) with the player standing still — `
        + 'that is a head jammed against its clamp, not a head tracking anything');
      assert(hHi - hLo > 0.25 && travel > 1.0,
        `the head spanned ${(hHi - hLo).toFixed(3)} rad over ${(n / 30) | 0} s (travelling `
        + `${travel.toFixed(1)} rad in total) — not sitting on the stop is not the same thing as `
        + 'alive, and 0.12 rad is what a head that only counter-rotates the tail manages');
      return `${(frac * 100).toFixed(1)}% of ${(n / 30) | 0} s on the ${LIFE.look.yaw} rad stop with `
        + `the body ${owner.toFixed(2)} rad off its owner; the head still spans `
        + `${(hHi - hLo).toFixed(2)} rad and travels ${travel.toFixed(1)} rad`;
    } finally { world.unload(); }
  });

  check('companion: under a standing order it is ALERT, not switched off', async () => {
    /**
     * "Meet anything that comes near ME" — WARD, the protector order, and one
     * of the two the player named by name.
     *
     * FOR A WHOLE ROUND IT SWITCHED THE IDLE LAYER OFF. `busy` read
     * `_cmpDuty.standing`, which is true for five of the six orders, and a
     * `busy` frame zeroes `calm` — so under WARD, on the flat, with the field
     * cleared and the player standing still, the animal fired 0 idle beats in
     * 70 seconds and `calm` never left 0.0 s. That is the state a companion
     * spends most of a level in, and it was the one state where every one of
     * these idle checks was measuring a body the layer had turned off.
     *
     * THREE THINGS ARE ASSERTED, and they are three different failures:
     *
     *   IT BEATS UNDER THE ORDER AT ALL. Same window, same world, same animal,
     *   with the order given: the beats must still fire.
     *
     *   IT IS NOT INDIFFERENT TO THE ORDER. An animal on your shoulder does
     *   not put its nose on the ground — `graze` and `sniff` carry `duty:
     *   false`, and neither may be picked while a standing order is in force.
     *   Without this half the fix would just be "delete the clause".
     *
     *   AND WORK STILL STOPS IT. The verb is the one order that hands the
     *   animal a job with a per-frame tick behind it, and a companion slicing
     *   a door does not stretch. Driven through `_cmpDuty` being an actual
     *   verb duty rather than through the flag, so what is proved is that the
     *   distinction survives in the code and not in this comment.
     */
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      const L = e._life || (calmTick(world, input, p, 30), e._life);
      assert(L, 'the body carries no life record at all');
      /* THE ROWS THIS BODY MAY NOT DO ON DUTY, read off its own menu. If the
       * table stopped marking any of them the second half of this check would
       * be asserting nothing, which is HANDOFF §2.3b — so the fixture asserts
       * it has something to discriminate before it discriminates. */
      const barred = L.menu.filter((x) => x.duty === false).map((x) => x.id);
      assert(barred.length,
        'this body has no duty:false beat in its menu at all — the on-duty half of this check '
        + 'cannot fail, whatever the code does');

      /** Every beat this animal STARTS over a window, in order. */
      const window = (secs) => {
        const fired = new Set();
        let n = 0, was = null;
        for (let i = 0; i < 30 * secs; i++) {
          calmTick(world, input, p, 1);
          const b = e._life?.beat || null;
          if (b && b !== was) { n++; fired.add(b.id); }
          was = b;
        }
        return { n, fired };
      };

      /* 1. OFF DUTY, which is the control: the barred rows are live rows that
       *    this animal really does perform, so their absence below is the duty
       *    and not a beat nobody ever picks. */
      const off = window(70);
      assert(off.n >= 2, `seventy calm seconds off duty produced ${off.n} idle beats`);
      const offBarred = [...off.fired].filter((id) => barred.includes(id));
      assert(offBarred.length,
        `off duty it never once did any of [${barred.join(',')}] — those are the rows the on-duty `
        + 'half is about, so this fixture cannot tell the two states apart');

      /* 2. UNDER WARD. Same animal, same world, same seeded pick stream. */
      assert(!C.orderCompanion(e, 'ward'), 'WARD was refused on a maxed record');
      assert(e._cmpDuty?.id === 'ward' && e._cmpDuty.standing === true,
        'the fixture is not actually under a standing order');
      const on = window(70);
      assert(!e.target, 'something came at it mid-window — that is a fight, not an idle');
      assert(e._cmpDuty?.id === 'ward', 'the order lapsed under the measurement');
      assert(on.n >= 2,
        `seventy seconds under WARD with nothing to meet produced ${on.n} idle beats — a warding `
        + 'animal is alert, not frozen, and 0 here is the whole layer switched off by an order flag');
      const onBarred = [...on.fired].filter((id) => barred.includes(id));
      assert(!onBarred.length,
        `it did [${onBarred.join(',')}] while standing your ward — those rows are marked duty:false `
        + "because they put the animal's nose on the ground and its eyes off the field");

      /* 3. AND WORK STILL STOPS IT — the verb is the one order that hands the
       *    animal a job with a per-frame tick behind it. */
      assert(!C.orderCompanion(e, 'heel'), 'HEEL was refused, which it never may be');
      calmTick(world, input, p, 30 * 3);
      e._cmpDuty = C.COMPANION_ORDERS.verb;
      const busy = window(60);
      assert(busy.n === 0,
        `sixty seconds under its own verb produced ${busy.n} idle beats — an animal with a job in `
        + 'its hands does not stop to scratch');
      return `off duty ${off.n} beats [${[...off.fired].join(',')}]; under WARD ${on.n} `
        + `[${[...on.fired].join(',')}], none of the ${barred.join('/')} it does off duty; `
        + `${busy.n} under a verb`;
    } finally { world.unload(); }
  });

  check('companion: what a body can DO idle is its anatomy, not its name', async () => {
    /**
     * The menus, off every built body, with no world at all — so this costs
     * milliseconds and covers every kind that has a body on the day it runs.
     *
     * A KIND WITH NO BODY IS NAMED AND NOT SKIPPED, for the reason the pace
     * check gives further up: `continue` on a missing archetype is the vacuous
     * shape, and the count has to add up to twelve.
     */
    const Life = await import('../../src/game/CompanionLife.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const rows = [], missing = [];
    for (const id of K.COMPANION_ORDER) {
      const KK = K.COMPANION_KINDS[id];
      const A = ARCHETYPES[KK.archetype];
      if (!A?.build) { missing.push(id); continue; }
      const built = A.build({ scale: A.scale });
      const L = Life.lifeFor(`t-${id}`, built.rig, A, KK, built.plan);
      assert(L, `${id} builds a body the life layer cannot read at all`);
      assert(L.menu.length, `${id} has a body and no idle beat it can perform`);
      rows.push({ id, menu: new Set(L.menu.map((b) => b.id)), legs: L.parts.legs,
        droid: L.droid, mount: !!KK.mount, breath: L.breath });
    }
    assert(rows.length + missing.length === K.COMPANION_ORDER.length,
      `${rows.length} + ${missing.length} is not ${K.COMPANION_ORDER.length} kinds`);
    assert(rows.length >= 6, `only ${rows.length} kinds have a body to measure`);

    /* A MACHINE AND AN ANIMAL SHARE NOTHING. */
    const droids = rows.filter((r) => r.droid), flesh = rows.filter((r) => !r.droid);
    assert(droids.length && flesh.length, 'the roster is all one material — this proves nothing');
    for (const d of droids) {
      for (const f of flesh) {
        for (const m of d.menu) {
          assert(!f.menu.has(m), `a ${d.id} and a ${f.id} both do "${m}" — a droid does not sniff the ground`);
        }
      }
    }
    /* AN ANIMAL ON TWO LEGS DOES NOT LIFT ONE TO SCRATCH, and a kind you can
     * get off crops the ground when you do. Both read off the body and the
     * row; neither is written down per kind. */
    for (const r of flesh) {
      assert(r.menu.has('scratch') === (r.legs >= 3),
        `a ${r.id} stands on ${r.legs} legs and ${r.menu.has('scratch') ? 'does' : 'does not'} scratch`);
      assert(r.menu.has('graze') === r.mount,
        `a ${r.id} ${r.mount ? 'can be ridden and does not graze' : 'cannot be ridden and grazes'}`);
    }
    /* AND THE ALLOMETRY IS DOING SOMETHING: the lightest breathes materially
     * faster than the heaviest, which is the whole of "nobody typed these". */
    const fast = rows.reduce((a, b) => (b.breath > a.breath ? b : a));
    const slow = rows.reduce((a, b) => (b.breath < a.breath ? b : a));
    assert(fast.breath > slow.breath * 2.5,
      `the fastest breather (${fast.id}, ${(fast.breath * 60).toFixed(1)}/min) is only `
      + `${(fast.breath / slow.breath).toFixed(2)}x the slowest (${slow.id}) — the mass term is dead`);
    return `${rows.length} bodies, ${missing.length} still without one`
      + `${missing.length ? ` (${missing.join(', ')})` : ''}; `
      + rows.map((r) => `${r.id}:${[...r.menu].join('+')}`).join(' ')
      + `; breath ${(slow.breath * 60).toFixed(0)}–${(fast.breath * 60).toFixed(0)}/min`;
  });

  check('companion: it flinches at a bolt, at a wound and at you going down', async () => {
    /**
     * "Flinches. A bolt passing near, taking a hit, or the owner going down
     *  each produce a visible reaction."
     *
     * ALL THREE ARE DRIVEN THROUGH THE REAL TRIGGER. The bolt is a real bolt
     * out of the shipped pool, fired past the animal, and found through
     * `BoltPool.threatsNear` — the same read `Reactions.senseBolt` and the
     * player's Focus use, on the same `BEHAVIOUR.roll.scan` clock. The wound
     * is `hp` going down. The owner going down is the owner going down.
     * Nothing calls `flinch()` directly, because a check that calls the
     * function it is testing has proved the function works and not that
     * anything ever reaches it.
     *
     * AND WHAT IS MEASURED IS THE HEAD, in radians, before and after — not a
     * flag. A reaction nobody can see is not a reaction.
     */
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      calmTick(world, input, p, 90);
      const L = e._life;
      const hb = e.rig.get('head');
      const head = () => hb.obj.quaternion.angleTo(hb.restQuat);

      /* 1. A WOUND. */
      const q0 = head();
      e.hp = e.maxHp - 40;
      calmTick(world, input, p, 2);
      const hit = L.fl;
      assert(hit > 0.3, `taking 40 damage moved the flinch spring to ${hit.toFixed(2)}`);
      let peak = 0;
      for (let i = 0; i < 8; i++) { calmTick(world, input, p, 1); peak = Math.max(peak, Math.abs(head() - q0)); }
      assert(peak > 0.04,
        `the head moved ${peak.toFixed(3)} rad on being wounded — that is not a visible reaction`);
      for (let i = 0; i < 30 * 2; i++) { e.hp = e.maxHp; calmTick(world, input, p, 1); }
      assert(L.fl < 0.05, `two seconds later the flinch is still ${L.fl.toFixed(2)} — it never settles`);

      /* 2. A BOLT. Fired 10 m out on a line that passes a metre to the side of
       *    the animal's chest — inside `threatsNear`'s own 2.2 m corridor. */
      assert(world.bolts?.fire, 'this world has no bolt pool — the test cannot run');
      L.flCd = 0; L.fl = 0;
      const V = p.position.constructor;
      let fired = 0;
      for (let i = 0; i < 30 * 3 && L.fl < 0.2; i++) {
        const at = e.chest ?? e.position;
        world.bolts.fire(new V(at.x - 10, at.y, at.z + 1.0), new V(1, 0, -0.02),
          { team: (e.team ?? 0) + 1, speed: 88, damage: 0 });
        fired++;
        e.hp = e.maxHp;
        calmTick(world, input, p, 1);
      }
      assert(L.fl > 0.2,
        `${fired} bolts passed a metre from its chest and the flinch spring reads ${L.fl.toFixed(2)}`);

      /* 3. YOU GO DOWN. `Player.dead` is a GETTER over `alive`, so the flag
       *    that has to move is `alive` — assigning `dead` throws, which is how
       *    this line was found. */
      L.flCd = 0; L.fl = 0; L.ownerDown = false;
      p.alive = false;
      world.update(STEP, input);
      world.update(STEP, input);
      const own = L.fl;
      p.alive = true; p.hp = p.maxHp ?? 100;
      assert(own > 0.5, `its owner went down and the flinch spring reads ${own.toFixed(2)}`);

      /* AND HOW HARD IT FLINCHES IS THE ROW'S OWN FRAGILITY — off `K.frag` and
       * no other field. Read off the derived nerve rather than driven twice,
       * because `nerve` is the only term between the two animals. */
      const Life = await import('../../src/game/CompanionLife.js');
      const { ARCHETYPES } = await import('../../src/game/Enemy.js');
      const nerveOf = (id) => {
        const KK = K.COMPANION_KINDS[id], A = ARCHETYPES[KK.archetype];
        const built = A.build({ scale: A.scale });
        return Life.lifeFor(`n-${id}`, built.rig, A, KK, built.plan).nerve;
      };
      const soft = nerveOf('tooka'), hard = nerveOf('pup');
      assert(soft > hard * 1.5,
        `a tooka (frag ${K.COMPANION_KINDS.tooka.frag}) flinches at ${soft.toFixed(2)} and a rancor pup `
        + `(frag ${K.COMPANION_KINDS.pup.frag}) at ${hard.toFixed(2)} — the fragility term is dead`);
      return `a wound moved the head ${peak.toFixed(3)} rad and settled in 2 s; ${fired} near bolts `
        + `sprang it to ${L.fl.toFixed(2)}; the owner going down to ${own.toFixed(2)}; `
        + `nerve ${soft.toFixed(2)} (tooka) vs ${hard.toFixed(2)} (pup)`;
    } finally { world.unload(); }
  });

  check('companion: past the gait\'s own fence the layer stops dead', async () => {
    /**
     * "It must cost nothing when off-screen or far away. Check how the rest of
     *  the tree does distance/LOD culling and use the same mechanism."
     *
     * THE MECHANISM IS `e.lod`, WRITTEN BY `Enemy.update` OFF THE CAMERA, and
     * `_poseWalker` returns on the same `> 1` for the same reason — past 62 m
     * the body draws through `MergedSkin` and nothing reads a bone.
     *
     * THE FENCE IS DRIVEN BY MOVING THE ANIMAL AND NOT BY SETTING THE FIELD,
     * and neither of the two obvious ways of doing that works. `e.lod = 2` is
     * overwritten on the next tick, so the test would pass whether the fence
     * existed or not. Moving the CAMERA is overwritten too — `World.update`
     * takes it off the player every frame, and the first cut of this check
     * parked it 140 m out and read `lod 0` because the player put it back
     * before `Enemy.update` looked at it.
     *
     * So the animal is put out there, and HELD out there by the order the
     * game already has for exactly that: HOLD is "stand on that ground
     * whatever I do", the last rung on the ladder, and it is the only thing
     * in the feature that detaches a companion from its owner.
     *
     * AND IT IS A PAIR. Far: three seconds, and every bone this layer owns has
     * to be BIT-IDENTICAL — not "small", identical, because the layer either
     * ran or it did not. Near: the same three seconds and the same bones have
     * to move. Delete the fence and the first half fails; delete the layer and
     * the second half does.
     */
    const { world, input, e, p } = await calmField('massiff');
    try {
      assert(e, 'nothing fielded');
      calmTick(world, input, p, 60);
      const L = e._life;
      const snap = () => [
        e.rig.get('head').obj.quaternion.toArray().join(','),
        e.rig.get('body').obj.quaternion.toArray().join(','),
        L.parts.ribs.map((r) => r.mesh.scale.x).join(','),
      ].join('|');

      /* 100 m: past the 62 m bone fence and short of `L3_AT` (137.8 m), so the
       * body is still an ordinary enemy and it is only its bones that have
       * stopped being read. */
      const V = p.position.constructor;
      const far = new V(p.position.x + 100, p.position.y, p.position.z);
      far.y = world.terrain?.height ? world.terrain.height(far.x, far.z) : far.y;
      e.position.copy(far);
      assert(!C.orderCompanion(e, 'hold', far.clone()),
        'HOLD was refused — the fixture record is not sworn, so the animal will walk home');
      calmTick(world, input, p, 6);
      assert(e.lod > 1, `the body is 100 m from the camera and still reads lod ${e.lod}`);
      const before = snap();
      calmTick(world, input, p, 90);
      const after = snap();
      assert(e.lod > 1, `the body came back inside the fence mid-test (lod ${e.lod})`);
      assert(before === after,
        'three seconds past the 62 m fence and the bones moved — the layer is running on a body '
        + 'that is drawn by MergedSkin and whose bones nothing reads');

      /* AND BACK. HEEL is the order that clears every standing one. */
      assert(!C.orderCompanion(e, 'heel'), 'HEEL was refused, which it never may be');
      e.position.set(p.position.x + 2, p.position.y, p.position.z + 2);
      calmTick(world, input, p, 6);
      assert(e.lod <= 1, `back at the heel the body reads lod ${e.lod}`);
      const n0 = snap();
      calmTick(world, input, p, 90);
      assert(n0 !== snap(), 'inside the fence nothing moved either — the layer is not running at all');
      return `lod ${e.lod} at the heel and the bones move; past the 62 m fence at 100 m every bone `
        + 'this layer owns is bit-identical over three seconds';
    } finally { world.unload(); }
  });

  check('companion: a rig that HAS ears and a tail drives them; one that has neither is a no-op', async () => {
    /**
     * "Read what bones actually exist on each rig rather than assuming — a b1c
     *  and an astromech have no ears, and the code must do something sensible
     *  (or nothing) rather than throw."
     *
     * THE TRUE STATE OF THE ROSTER, WHICH IS NOT WHAT YOU WOULD GUESS: **no
     * rig in this game has an ear bone or a tail bone.** `creatureSkeleton`
     * emits `hips`, `body`, `head` and four bones per limb; the tail is merged
     * into the body bone's own hide mesh and Bodies.js says so where it builds
     * it. So the appendage resolver has a branch the shipped roster cannot
     * reach — and a branch nothing exercises is HANDOFF §2.3b: code that
     * cannot fail, sitting behind a comment claiming it works.
     *
     * So this check BUILDS a rig that has them. Two ear bones, a three-bone
     * tail chain and a pair of wings on a body otherwise shaped like a
     * quadruped, driven through the same `stepLife` the animals go through.
     * The day a hawk or a tooka is authored with real ears, the code they
     * arrive into is code with a test behind it.
     *
     * AND THE OTHER HALF: a rig with none of them, and a rig with almost
     * nothing at all, both have to come back without throwing.
     */
    const Life = await import('../../src/game/CompanionLife.js');
    const { Rig } = await import('../../src/game/Rig.js');
    /* The roles are the FIXTURE's, not a proposal: `BONE_ROLES` has no 'ear'
     * and no 'tail', which is exactly why CompanionLife does not add these
     * bones to the real skeletons — see its header. */
    const defs = [
      { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5, rest: [0, 1, 0], role: 'core' },
      { name: 'body', parent: 'hips', offset: [0, 0.1, 0], length: 0.8, rest: [0, 1, 0], role: 'core' },
      { name: 'head', parent: 'body', offset: [0, 0.2, 0.7], length: 0.4, rest: [0, 1, 0], role: 'head' },
      { name: 'earL', parent: 'head', offset: [0.08, 0.3, 0], length: 0.15, rest: [0.3, 1, 0], role: 'head' },
      { name: 'earR', parent: 'head', offset: [-0.08, 0.3, 0], length: 0.15, rest: [-0.3, 1, 0], role: 'head' },
      { name: 'tailA', parent: 'body', offset: [0, 0.05, -0.4], length: 0.3, rest: [0, 0.2, -1], role: 'core' },
      { name: 'tailB', parent: 'tailA', offset: [0, 0.3, 0], length: 0.3, rest: [0, 0.2, -1], role: 'core' },
      { name: 'tailC', parent: 'tailB', offset: [0, 0.3, 0], length: 0.3, rest: [0, 0.2, -1], role: 'core' },
      { name: 'wingL', parent: 'body', offset: [0.2, 0.2, 0], length: 0.6, rest: [1, 0.2, 0], role: 'wing' },
      { name: 'wingR', parent: 'body', offset: [-0.2, 0.2, 0], length: 0.6, rest: [-1, 0.2, 0], role: 'wing' },
    ];
    for (const side of [1, -1]) {
      for (let i = 0; i < 2; i++) {
        const n = `${side > 0 ? 'L' : 'R'}${i}`;
        defs.push({ name: `hipL${n}`, parent: 'hips', offset: [side * 0.2, 0, i ? 0.4 : -0.4],
          length: 0.1, rest: [side, 0.2, 0], role: 'leg' });
        defs.push({ name: `femur${n}`, parent: `hipL${n}`, offset: [0, 0.1, 0],
          length: 0.3, rest: [0, -1, 0], role: 'leg' });
      }
    }
    const rig = new Rig(defs, { scale: 1 });
    const P = Life.partsOf(rig);
    assert(P.ears.length === 2, `the resolver found ${P.ears.length} ear bones on a rig with two`);
    assert(P.tail.length === 3, `the resolver found ${P.tail.length} tail bones on a rig with three`);
    assert(P.wings.length === 2, `the resolver found ${P.wings.length} wing bones on a rig with two`);
    assert(P.legs === 4, `the resolver counted ${P.legs} leg chains on a rig with four`);

    const A = { mass: 110, scale: 1, toughness: 0.9 };
    const KK = { ward: 9, frag: 1, pace: 0.7 };
    const plan = { tail: [3, 0.9, 0.1, 0, 0], girth: 0.28, trunk: [0.1, -0.1, 0.86] };
    const at = new THREE.Vector3();
    const owner = { position: new THREE.Vector3(0, 0, 4), chest: new THREE.Vector3(0, 1.2, 4) };
    const restOf = (b) => b.obj.quaternion.angleTo(b.restQuat);
    const localYaw = (b) => new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().copy(b.restQuat).invert().multiply(b.obj.quaternion), 'YXZ').y;

    const L = Life.lifeFor('ears-1', rig, A, KK, plan);
    assert(L, 'a rig with a head and a trunk produced no life record');
    const drive = (n, s) => { for (let i = 0; i < n; i++) Life.stepLife(L, STEP, s); };
    const base = { at, facing: 0, owner, hurt: 0, effort: 0, moving: false, busy: true };

    /* THE EARS, PINNED. Under fire the carriage goes negative and the ears go
     * with it — and the two of them in opposite yaw, because a left ear and a
     * right ear are not the same rotation. */
    drive(120, { ...base, pinned: 1 });
    const pinnedL = restOf(P.ears[0]), pinnedR = restOf(P.ears[1]);
    assert(pinnedL > 0.15 && pinnedR > 0.15,
      `under fire the ears moved ${pinnedL.toFixed(3)} / ${pinnedR.toFixed(3)} rad off rest`);
    const yl = localYaw(P.ears[0]), yr = localYaw(P.ears[1]);
    assert(yl * yr < 0,
      `both ears yawed the same way (${yl.toFixed(3)}, ${yr.toFixed(3)}) — they are mirrored parts`);

    /* AND OFF AGAIN. Nothing shooting: the ears come back. */
    drive(240, { ...base, pinned: 0 });
    assert(restOf(P.ears[0]) < pinnedL * 0.6,
      `the shooting stopped and the ears are still ${restOf(P.ears[0]).toFixed(3)} rad back`);

    /* THE TAIL: it sways, and the TIP travels further than the root. */
    let rootMax = 0, tipMax = 0;
    for (let i = 0; i < 300; i++) {
      Life.stepLife(L, STEP, { ...base, pinned: 0 });
      rootMax = Math.max(rootMax, restOf(P.tail[0]));
      tipMax = Math.max(tipMax, restOf(P.tail[2]));
    }
    assert(tipMax > 0.02, `the tail chain never moved (tip ${tipMax.toFixed(4)} rad)`);
    assert(tipMax > rootMax * 1.5,
      `the tail root swings ${rootMax.toFixed(3)} and the tip ${tipMax.toFixed(3)} — a tail carries `
      + 'its amplitude outward or it is a rigid stick on a hinge');

    /* AND A BODY WITH NONE OF IT IS A NO-OP AND NOT A THROW. */
    const bare = new Rig([
      { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5, rest: [0, 1, 0], role: 'core' },
      { name: 'head', parent: 'hips', offset: [0, 0.5, 0], length: 0.3, rest: [0, 1, 0], role: 'head' },
    ], { scale: 1 });
    const L2 = Life.lifeFor('bare', bare, A, KK, null);
    assert(L2, 'a rig with a head and nothing else produced no life at all');
    assert(!L2.parts.ears.length && !L2.parts.tail.length && !L2.parts.chest,
      'the resolver invented parts this rig does not have');
    for (let i = 0; i < 60; i++) {
      Life.stepLife(L2, STEP, { at, facing: 0, owner, pinned: 1, hurt: 1, effort: 1, moving: true, busy: false });
    }
    assert(bare.get('head').obj.quaternion.angleTo(bare.get('head').restQuat) > 0.01,
      'a body with only a head did not even turn it');
    const nothing = new Rig([
      { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5, rest: [0, 1, 0], role: 'core' },
      { name: 'thighL', parent: 'hips', offset: [0.1, 0, 0], length: 0.4, rest: [0, -1, 0], role: 'leg' },
    ], { scale: 1 });
    assert(Life.lifeFor('nothing', nothing, A, KK, null) === null,
      'a body with no head and no trunk was given a life record — there is nothing for it to move');
    assert(Life.stepLife(null, STEP, {}) === null, 'stepLife did not refuse a null record');
    return `two ears (${pinnedL.toFixed(2)} rad back under fire, mirrored), a three-bone tail `
      + `(root ${rootMax.toFixed(3)} → tip ${tipMax.toFixed(3)} rad), two wings found; a head-only `
      + 'rig still tracks and a rig with neither is refused rather than throwing';
  });

  check('companion: the life layer knows no kind by name, and publishes no dial it does not read', async () => {
    /**
     * The same two rules `companion: every kind is a row` holds Companions.js,
     * Kennel.js and HUD.js to, applied to the fourth file — and the second one
     * applied to its own table as well, which is `roster.mjs`'s rule for
     * archetypes: a dial nothing reads is a dial that has stopped meaning
     * anything and nobody will notice.
     *
     * AND NO `Math.random`, which is the brief's own words: deterministic,
     * same body, same look every time. Proved rather than asserted — two
     * records off two identities differ, two off the same identity are
     * identical to the last bit.
     */
    const code = strip(await src('game/CompanionLife.js'));
    for (const id of K.COMPANION_ORDER) {
      assert(!new RegExp(`['"\`]${id}['"\`]`).test(code),
        `CompanionLife.js names the kind "${id}" — a kind is a ROW`);
    }
    assert(!/Math\.random/.test(code), 'the life layer rolls Math.random at runtime — it will flicker');

    const Life = await import('../../src/game/CompanionLife.js');
    const unread = [];
    for (const k in Life.LIFE) {
      const v = Life.LIFE[k];
      if (!new RegExp(`LIFE\\.${k}\\b`).test(code)) { unread.push(k); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const f in v) if (!new RegExp(`LIFE\\.${k}\\.${f}\\b`).test(code)) unread.push(`${k}.${f}`);
      }
    }
    assert(!unread.length, `dials on LIFE that nothing reads: ${unread.join(', ')}`);
    /* EVERY FIELD ON EVERY BEAT ROW, the same way — a row that declares a part
     * requirement nothing enforces is a beat that will turn up on a body with
     * no bone for it. */
    const beatFields = new Set();
    for (const b of Object.values(Life.BEATS)) for (const f in b) beatFields.add(f);
    const deadBeat = [...beatFields].filter((f) => f !== 'drive'
      && !new RegExp(`\\bb\\.${f}\\b|\\bL\\.beat\\.${f}\\b`).test(code));
    assert(!deadBeat.length, `fields on a BEATS row that nothing reads: ${deadBeat.join(', ')}`);

    /* THE SEED. Same identity, same animal, for ever. */
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const A = ARCHETYPES[K.COMPANION_KINDS.massiff.archetype];
    const make = (id) => {
      const built = A.build({ scale: A.scale });
      return Life.lifeFor(id, built.rig, A, K.COMPANION_KINDS.massiff, built.plan);
    };
    const a1 = make('c-aaaa'), a2 = make('c-aaaa'), b1 = make('c-bbbb');
    for (const f of ['tBreath', 'tSway', 'breath', 'amp', 'side']) {
      assert(a1[f] === a2[f], `the same animal came back with a different ${f} — it will not look the same twice`);
    }
    const differs = ['tBreath', 'tSway', 'breath', 'amp'].filter((f) => Math.abs(a1[f] - b1[f]) > 1e-9);
    assert(differs.length >= 3,
      `two massiffs differ in only ${differs.length} of four channels — they are twins`);
    assert(Math.abs(a1.breath - b1.breath) / a1.breath < 0.2,
      'the per-body rate jitter is larger than the allometry it modifies — that is noise, not variation');
    return `no kind named, no Math.random, ${Object.keys(Life.LIFE).length} dial groups all read, `
      + `${Object.keys(Life.BEATS).length} beat rows all read; the same id is identical and two ids `
      + `differ in ${differs.length} of four channels`;
  });


  check('companion: on the deck, where nothing else moves a bone, the layer is all of it', async () => {
    /**
     * "they're going to be on the screen a lot"
     *
     * THE HANGAR IS THE ROOM THAT SENTENCE IS ABOUT. On the field a companion
     * is behind you in a firefight; on the deck you walk around it for minutes
     * with nothing else to look at.
     *
     * AND IT WAS THE WORST CASE IN THE GAME, measured rather than assumed:
     * `CompanionDeck` builds the body with the field's own builder and then
     * moves the rig ROOT — a position, a yaw, a sit blend and nothing else.
     * There is no `Enemy` behind it, so there is no `_poseWalker`, no gait, no
     * target and no LOD. Every bone in the animal sat in its bind pose and the
     * whole thing slid across the deck plates like a chess piece.
     *
     * So this asserts what the layer contributes THERE, and it is everything:
     * the head, the trunk and the ribcage all move, from a baseline where none
     * of them ever did.
     *
     * AND ON THE DECK IT CAN LOOK YOU IN THE EYE, which on the field it cannot
     * — `stepCompanionDeck` turns the whole animal to face you when it sits,
     * so the owner is in front of the head rather than 2.5 rad round behind
     * it. That is the one place the gaze ladder's owner rung is reachable to
     * the stop, and it is the place a player will notice.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    Kn.clear();
    Kn.adopt('massiff', 'Borz');
    const { world } = await bootWorld({
      level: 'hangar',
      settings: { mode: 'hangar', level: 'hangar', allies: 0, quality: 'low' },
      runSeed: 2,
    });
    try {
      const input = idleInput();
      for (let i = 0; i < 60; i++) world.update(STEP, input);
      const fig = world._companionDeck;
      assert(fig, 'nothing of yours came up in the lift');
      const rig = fig.built?.rig;
      assert(rig, 'the deck body has no rig at all');
      const L = fig._life;
      assert(L, 'the deck body carries no life record — the layer never ran in the hangar');
      const head = rig.get('head'), trunk = rig.get('body');
      assert(head && trunk, 'the deck body has no head or no trunk bone');

      let hMax = 0, tLo = 9, tHi = -9, ribLo = 9, ribHi = -9;
      const beats = new Set();
      for (let i = 0; i < 30 * 40; i++) {
        world.update(STEP, input);
        hMax = Math.max(hMax, head.obj.quaternion.angleTo(head.restQuat));
        /* THE TRUNK'S SPREAD AND NOT ITS OFFSET, and the difference is now
         * load-bearing. `stepCompanionDeck` holds the spine 0.30 rad up while
         * the animal is sat — that is the sit's own pitch — so a maximum
         * against the REST pose is 0.30 whether this layer is running or
         * frozen solid, and the assertion below would have stopped being able
         * to fail on the day that landed. What only breathing produces is
         * MOVEMENT, so what is measured is how far the trunk travels between
         * its own extremes. */
        const tAt = trunk.obj.quaternion.angleTo(trunk.restQuat);
        tLo = Math.min(tLo, tAt); tHi = Math.max(tHi, tAt);
        const r = L.parts.ribs[0];
        if (r) { ribLo = Math.min(ribLo, r.mesh.scale.x); ribHi = Math.max(ribHi, r.mesh.scale.x); }
        if (L.beat) beats.add(L.beat.id);
      }
      assert(fig.sit > 0.8, `it never settled (sit ${fig.sit.toFixed(2)}) — nothing here is idle`);
      assert(hMax > 0.05, `the deck animal's head moved ${hMax.toFixed(3)} rad in forty seconds`);
      const tMax = tHi - tLo;
      assert(tMax > 0.005, `the deck animal's trunk moved ${tMax.toFixed(4)} rad in forty seconds `
        + `(it sat between ${tLo.toFixed(3)} and ${tHi.toFixed(3)} rad off rest and never budged)`);
      assert(ribHi - ribLo > 0.01,
        `the deck animal's ribcage swelled by ${((ribHi - ribLo) * 100).toFixed(2)}% — it is not breathing`);
      assert(beats.size >= 1, 'forty seconds sat beside you and it never once did anything');

      /* AND ITS BREATH IS ITS OWN SIZE. The deck body is built through
       * `ARCHETYPES[...].build`, which returns no `mass` — so the rate would be
       * the reference for every kind unless it were derived from the plan. The
       * assertion is that it is not the default. */
      const Life = await import('../../src/game/CompanionLife.js');
      assert(Math.abs(L.breath - Life.LIFE.breath.rate) > 1e-6,
        `the deck animal breathes at exactly the reference ${(Life.LIFE.breath.rate * 60).toFixed(1)}/min — `
        + 'its own size is not reaching the rate');

      /* AND IT LOOKS AT YOU. Sat, the whole body is turned toward the player,
       * so the owner rung of the gaze ladder is inside the head's own stop. */
      const p = world.player;
      const q = rig.worldQuat('head', new THREE.Quaternion());
      const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const hp = rig.worldPos('head', new THREE.Vector3());
      const off = Math.abs(wrap(Math.atan2(v.x, v.z) - bearing(hp, p.position)));
      assert(off < 0.5,
        `sat two metres from you it is looking ${off.toFixed(2)} rad away from you`);
      return `on the deck the head moves ${hMax.toFixed(2)} rad, the trunk ${tMax.toFixed(3)}, the ribs `
        + `${((ribHi - ribLo) * 100).toFixed(1)}% at ${(L.breath * 60).toFixed(1)}/min, `
        + `${beats.size} beat(s) in 40 s — and sat, its head is ${off.toFixed(2)} rad off your chest`;
    } finally { world.unload(); Kn.clear(); }
  });

  check('companion: growth reaches BOTH bodies, on every kind that declares it', async () => {
    /**
     * ══════════════════════════════════════════════════════════════════════
     *  THIS CHECK USED TO ASSERT `grown === 1`, AND THAT WAS THE DEFECT
     * ══════════════════════════════════════════════════════════════════════
     *
     * What stood here read: "the pup GROWS off `runs`, and no other kind
     * does", and it enforced it — `assert(grown === 1, 'the design puts the
     * growth question on the pup alone')`. It was the right check for the day
     * it was written. It was pinning the fact that ONE kind had been given a
     * curve while the other eleven had not, and it was doing the honest thing
     * with that fact: making it deliberate rather than incidental.
     *
     * IT IS NOW PINNING THE ABSENCE OF THE FEATURE. V15 §4 is one sentence —
     * "a companion that has survived four runs should be visibly bigger and
     * visibly different, and an inorganic one should have visibly more
     * hardware" — and `grown === 1` refuses it by construction. That is the
     * same shape as the two refusals this file has already had to reopen: the
     * rung ladder's "not one multiplier field", which was settled against the
     * player's own sentence, and `dressCompanion`'s five-field pin, which was
     * right and had to grow a SECOND door rather than a sixth field. A check
     * that asserts a number is one when the design says it should be ten is
     * not protecting anything; it is a decision from a different round still
     * being enforced.
     *
     * ── WHAT REPLACES IT, AND IT IS STRICTLY HARDER TO SATISFY ────────────
     *
     * The old check drove one number on one body: `bodyScaleOf` for twelve
     * kinds, and `fieldCompanion` twice for the pup. It could not have failed
     * on a droid, on a shape, on the deck body, or on the wire between the
     * record and the mesh — which is the entire feature it is now named for.
     * This holds the SAME driven-on-a-real-body standard and widens what is
     * driven, in five directions the old one had no reach into:
     *
     *   1  EVERY KIND, BOTH WAYS. A kind with a `grow` row must change, and a
     *      kind without one must be BYTE-FOR-BYTE the same body at the top of
     *      the ladder as at the bottom. The tooka and the hawk are the two
     *      that declare nothing, and the absence is a statement — the cute
     *      useless one is the same kit on its last run as on its first — so
     *      the check that proves the growers grow is the same loop that proves
     *      those two do not.
     *
     *   2  THE GEOMETRY, NOT THE NUMBER. Silhouette is measured the way
     *      `grooming.mjs` and the colour check measure it: vertices through
     *      the real builder, and the world bounding box of the assembled body.
     *      A `to` of 1.00 on the three droids means SIZE cannot be the thing
     *      that moved for them, so the vertex count has to be — which is
     *      exactly the half of the feature a scale curve cannot express and
     *      the old check had no way to ask about.
     *
     *   3  THE FIELD PATH, END TO END. `fieldCompanion` → `spawnEnemy` →
     *      `Enemy._cmpGrow` → the build options spread → the builder. Three of
     *      those four are lines that did not exist, and a companion whose
     *      record said VETERAN and whose body was built fresh would pass every
     *      table assertion above. So the fielded body's mesh is measured
     *      against the fielded body's mesh at the other end of the ladder.
     *
     *   4  THE DECK PATH, AGAINST THE FIELD PATH. `CompanionDeck.js:9-24`
     *      names the one thing the two representations may never do, and a
     *      third thing riding the spawn is a third chance to do it. The deck
     *      call is made here verbatim and its vertex count has to EQUAL the
     *      fielded body's at the same maturity — not merely to change.
     *
     *   5  NOTHING IS STORED. `companion: the store clamps a hostile save`
     *      asserts `scale` never survives `readOne`; the same must be true of
     *      every word this feature could have smuggled a derived number in
     *      under. A stage on disk is a second source of truth that goes stale
     *      the first time a gate moves.
     *
     * WHAT IS STILL REFUSED, AND THIS CHECK IS WHERE IT IS REFUSED. Growth
     * buys NOTHING that fights. The archetype's `hp`, `damage` and `speed` are
     * read off the two fielded bodies and asserted IDENTICAL at both ends of
     * the ladder: a droid that grew plate and grew tougher would be a fourth
     * axis arriving through a mesh, which is the one route past
     * `companion: the rung curve is real` that nobody had closed.
     */
    const { COMPANION_KINDS, COMPANION_ORDER, GROWTH_STAGES, bodyScaleOf, growthOptsFrom, maturityOf, stageOf }
      = await import('../../src/game/CompanionKinds.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const { companionOptsFrom } = await import('../../src/game/Bodies.js');
    await import('../../src/game/Levels.js');

    const top = GROWTH_STAGES[GROWTH_STAGES.length - 1];
    /* THE TWO ENDS OF THE LADDER, AS RECORDS. Built from the STAGE TABLE and
     * never from typed numbers, so a gate that moves moves this fixture with
     * it — the same discipline the rung check uses against `RANKS`. */
    const rec = (kind, ripe) => ({
      id: ripe ? 'gv' : 'gf', kind, name: 'G', xp: 0,
      runs: ripe ? top.runs : 0, meals: ripe ? top.care : 0, grooms: 0,
      areas: 0, kills: 0, saves: 0, downs: 0, orders: 0, ranged: 0,
      tempers: [], story: [], scars: [],
    });
    assert(maturityOf(rec('massiff', false)) === 0 && maturityOf(rec('massiff', true)) === 1,
      'the fixture does not reach both ends of the stage ladder');

    /* Vertices and the body's own box, off whatever root the builder returns. */
    const shapeOf = (built) => {
      const root = built?.rig?.root ?? built?.group;
      assert(root, 'built neither a rig nor a group');
      let v = 0;
      const box = new THREE.Box3();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        v += o.geometry.attributes.position.count;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      const sz = box.getSize(new THREE.Vector3());
      return { v, w: sz.x, h: sz.y, l: sz.z };
    };

    let growers = 0, still = 0;
    const rows = [];
    for (const id of COMPANION_ORDER) {
      const K = COMPANION_KINDS[id];
      const A = ARCHETYPES[K.archetype];
      assert(A?.build, `${id} names archetype "${K.archetype}" and nothing builds it`);
      const base = A.scale ?? 1;
      const fresh = rec(id, false), ripe = rec(id, true);
      const sFresh = bodyScaleOf(id, fresh), sRipe = bodyScaleOf(id, ripe);
      assert(Math.abs(sFresh - base) < 1e-9,
        `${id} at the bottom of the ladder is ${sFresh.toFixed(3)} and its archetype is ${base} — `
        + 'a fresh animal is the row it was built from');
      /* THE DECK'S OWN CALL, SPELLED THE WAY `CompanionDeck.callTheCompanion`
       * spells it — size, colours and growth, all three. */
      const put = (r) => shapeOf(A.build({
        scale: bodyScaleOf(id, r), ...companionOptsFrom(null), ...growthOptsFrom(id, r),
      }));
      const a = put(fresh), b = put(ripe);

      if (!K.grow) {
        still++;
        assert(Math.abs(sRipe - sFresh) < 1e-9,
          `${id} changes size across the ladder and declares no grow row`);
        assert(a.v === b.v && Math.abs(a.h - b.h) < 1e-9,
          `${id} declares no grow row and its body changed anyway (${a.v}→${b.v} vertices, `
          + `${a.h.toFixed(3)}→${b.h.toFixed(3)} m tall) — growth has leaked into a kind nobody gave it to`);
        rows.push(`${id} —`);
        continue;
      }
      growers++;
      const to = K.grow.to ?? 1;
      /* THE SIZE CURVE IS THE ROW'S, EXACTLY, AT THE TOP. */
      assert(Math.abs(sRipe - base * to) < 1e-9,
        `${id} tops out at ${sRipe.toFixed(3)} where its row says ${(base * to).toFixed(3)}`);
      /* AND IT CLIMBS THROUGH THE MIDDLE RATHER THAN SNAPPING AT THE END. */
      let prev = -1;
      for (let n = 0; n < GROWTH_STAGES.length; n++) {
        const g = GROWTH_STAGES[n];
        const mid = { ...rec(id, false), runs: g.runs, meals: g.care };
        assert(stageOf(mid) === n, `${id}: a record on ${g.id}'s own gates reads stage ${stageOf(mid)}`);
        const sz = bodyScaleOf(id, mid);
        assert(sz >= prev - 1e-9, `${id} shrinks between stages`);
        prev = sz;
      }
      /* THE HARDWARE HALF, WHICH IS WHAT A `to` OF 1.00 LEAVES. */
      assert(b.v > a.v,
        `${id} declares marks "${K.grow.marks}" and its body has the same ${a.v} vertices fully grown — `
        + 'the builder does not read that treatment, so the row is a promise nothing keeps');
      if (to > 1) {
        assert(b.h > a.h * 1.02,
          `${id} grows to ×${to} and stands ${a.h.toFixed(2)} m either way`);
      } else {
        assert(Math.abs(sRipe - sFresh) < 1e-9,
          `${id} declares to ${to} and changed size anyway — a machine does not grow, it is fitted`);
      }
      rows.push(`${id} ${K.grow.marks} ${a.v}→${b.v}v ×${(sRipe / sFresh).toFixed(2)}`);
    }
    /**
     * MORE THAN ONE, AND NOT ALL OF THEM. Both halves are the point: the old
     * `grown === 1` is gone, and what replaces it is not "any number will do".
     * A tree in which every kind grew would have lost the statement the tooka
     * and the hawk make by not growing, and a tree in which one did would be
     * the old defect back.
     */
    assert(growers >= 2, `${growers} kinds grow — V15 §4 is about companions, not about one pup`);
    /**
     * ── AND THIS CLAUSE USED TO DOCUMENT THE DEFECT AS A DECISION ────────
     *
     * It asserted `still >= 1` — "the two that stay the same say something by
     * staying the same". They were not saying anything. The tooka and the hawk
     * had no `grow` row at all, so `bodyScaleOf` returned the archetype's
     * scale and no mark was ever asked for, and a hostile pass measured them
     * BYTE-IDENTICAL after sixteen runs and fourteen care acts — against the
     * player's *"a companion that has survived four runs should be visibly
     * bigger and visibly different."* Two rows nobody filled in, read back as
     * restraint by the check that should have caught them.
     *
     * What is actually true, and is asserted now: EVERY kind declares a row.
     * An organic grows (`to > 1`); a machine is FITTED (`to === 1`, marks
     * only) — that distinction is real and the two branches above already
     * hold it. What is not a design is an absent row.
     */
    const rowless = K.COMPANION_ORDER.filter((id) => !K.COMPANION_KINDS[id].grow);
    assert(!rowless.length,
      `${rowless.join(', ')} declare no growth at all — a kind with no row does not "stay the same" `
      + 'on purpose, it was never filled in, and four runs leave it byte-identical');

    /* ── AND NOW ON THE BODY THE PLAYER ACTUALLY OWNS ────────────────────
     * Table assertions prove a curve. Only a spawn proves the wire: three of
     * the four links between the record and the mesh are new lines, and a
     * companion whose record said VETERAN and whose body was built fresh would
     * have passed everything above. */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { fieldCompanion } = await import('../../src/game/Companions.js');
    const said = [];
    for (const id of ['massiff', 'astro', 'wook']) {
      const K = COMPANION_KINDS[id];
      const { world } = await bootWorld({
        level: 'colosseum',
        settings: { mode: 'waves', level: 'colosseum', allies: 0, quality: 'low' },
        runSeed: 7,
      });
      try {
        const input = idleInput();
        for (let i = 0; i < 20; i++) world.update(STEP, input);
        const put = (r) => {
          const e = fieldCompanion(world, world.player, id, { rec: r });
          assert(e, `${id} would not field`);
          return { e, s: shapeOf({ rig: e.rig, group: e.group }) };
        };
        const lo = put(rec(id, false)), hi = put(rec(id, true));
        assert(hi.s.v > lo.s.v,
          `a fielded ${id} has ${lo.s.v} vertices fresh and ${hi.s.v} fully grown — the growth never `
          + 'reaches Enemy._build, so the whole feature is a table');
        if ((K.grow.to ?? 1) > 1) {
          assert(hi.e.bodyScale > lo.e.bodyScale,
            `a fielded ${id} is the same size at both ends of the ladder`);
        }
        /**
         * AND THE DECK ANIMAL GROWS BY EXACTLY WHAT THE FIELD ANIMAL GROWS BY.
         *
         * THE FIRST VERSION ASSERTED THE TWO BODIES WERE IDENTICAL, AND IT WAS
         * A WRONG CLAIM THAT FOUND A REAL DEFECT — which is worth keeping the
         * note for. Driven, the massiff and the astromech matched to the
         * vertex and the wookiee came back 9 958 on the deck against 10 430 on
         * the field. That gap is NOT growth: `Enemy._build` spreads
         * `bodyOptsFor(this.type)` — the archetype's own kit — and
         * `CompanionDeck.callTheCompanion` does not, so the deck wookiee is
         * standing there without the bowcaster its field body carries. It is a
         * real difference between the two representations and it predates this
         * lane by every commit; it is reported rather than fixed here, because
         * a lane about growth quietly changing what the hangar wookiee is
         * holding is exactly the kind of edit that should be argued on its own.
         *
         * SO THE CLAIM IS NARROWED TO THE ONE THIS LANE IS ANSWERABLE FOR, and
         * narrowing it makes it SHARPER rather than weaker: what growth adds to
         * the deck body must be what growth adds to the field body, to the
         * vertex, measured as a difference so that whatever else the two builds
         * disagree about cancels out of both sides. A third thing riding the
         * spawn that reached one representation and not the other is still
         * caught, which is the only failure this clause exists to catch.
         */
        const A = ARCHETYPES[K.archetype];
        const deckOf = (r) => shapeOf(A.build({
          scale: bodyScaleOf(id, r), ...companionOptsFrom(null), ...growthOptsFrom(id, r),
        }));
        const deckLo = deckOf(rec(id, false)), deckHi = deckOf(rec(id, true));
        assert(deckHi.v - deckLo.v === hi.s.v - lo.s.v,
          `${id} grows by ${deckHi.v - deckLo.v} vertices on the deck and ${hi.s.v - lo.s.v} on the field — `
          + 'the deck animal and the field animal disagree about what it has grown, which is the one thing '
          + 'they must never do');
        /**
         * GROWTH BUYS NOTHING THAT FIGHTS, AND IT IS ASKED OF THE ROW RATHER
         * THAN OF THE BODY.
         *
         * The first version of this compared `e.maxHp`, `e.damage` and
         * `e.speed` between the two bodies and was wrong twice over, in two
         * ways worth writing down because both are traps this fixture will set
         * again. `Enemy.damage` is a METHOD — the damage door every hit comes
         * through — so subtracting one body's from another's is NaN and the
         * failure message printed three hundred lines of source. And
         * `this.speed` takes a seeded ±10% draw at construction (Enemy.js:3163),
         * so two separately spawned bodies of the SAME kind differ by up to a
         * fifth on it and always would have.
         *
         * `e.A` IS THE RIGHT PLACE TO ASK. The pack clones the archetype by
         * identity and writes the rung's three multipliers onto the clone, so
         * `e.A.hp`, `e.A.damage` and `e.A.speed` are exactly "what this body
         * was told it is worth" with no roll on top — and both records here
         * carry xp 0, so they stand on the same rung and the three numbers must
         * be identical to the last bit. `maxHp` is asked as well because it is
         * `A.hp × world.hpScale` and therefore also exact: a droid that grew
         * plate and grew tougher would move one of the four.
         */
        for (const ax of ['hp', 'damage', 'speed']) {
          const a = lo.e.A?.[ax], b = hi.e.A?.[ax];
          assert(typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9,
            `a fully grown ${id} carries A.${ax} ${b} against a fresh one's ${a} — growth has `
            + 'become a fourth axis, arriving through a mesh');
        }
        assert(Math.abs(lo.e.maxHp - hi.e.maxHp) < 1e-9,
          `a fully grown ${id} has ${hi.e.maxHp} hp against a fresh one's ${lo.e.maxHp}`);
        said.push(`${id} +${hi.s.v - lo.s.v}v on the field and the deck alike, ${lo.e.maxHp} hp both ends`);
      } finally { world.unload(); }
    }

    /* ── AND NOTHING ABOUT IT IS ON DISK ─────────────────────────────── */
    const forged = Kn.readOne({
      id: 'x', kind: 'massiff', runs: 4, meals: 2, grooms: 1,
      scale: 40, grown: 1, stage: 'veteran', maturity: 1, marks: 'ridge',
    });
    for (const f of ['scale', 'grown', 'stage', 'maturity', 'marks']) {
      assert(forged[f] === undefined,
        `"${f}" survived readOne — it is DERIVED, and a derived field on disk is a second source of truth`);
    }
    return `${growers} kinds grow and ${still} deliberately do not — ${rows.join(', ')}; on the field ${said.join('; ')}`;
  });

  check('companion: the stage ladder is runs AND care, and care cannot outrun runs', async () => {
    /**
     * THE HALF THAT MAKES THE STATION LOAD-BEARING RATHER THAN DECORATIVE.
     *
     * V15 §4: "care, feeding, grooming, play, at the habitat, ON the station,
     * between runs — and for some rungs to need BOTH. That is the whole reason
     * it makes the station load-bearing rather than decorative."
     *
     * FOUR THINGS ARE DRIVEN AND EVERY ONE OF THEM IS A WAY THIS COULD BE A
     * LIE:
     *
     *   a  SOME STAGES NEED BOTH, and it is asserted as a COUNT rather than by
     *      naming a stage — a table that quietly dropped every `care` gate to
     *      0 would still be four stages with four labels, and the room would
     *      still be decorative.
     *   b  AND SOME DO NOT. The first step up is battle alone, deliberately: a
     *      growth curve entirely behind a room is one most players never see,
     *      and a floor that anyone reaches by playing is what keeps the
     *      habitat a reward rather than a toll gate.
     *   c  CARE CANNOT BE FARMED. The whole objection to a care system is that
     *      it becomes a button you press in a quiet room until a number is
     *      big. So the door is driven a HUNDRED times against a record with no
     *      runs on it, and the counter has to stop — bounded by the thing that
     *      is bounded by playing.
     *   d  AND IT IS NOT A CURRENCY. Nothing subtracts. Driven, not asserted
     *      about the source: both counters only ever go up, and the six-word
     *      scan two checks above already covers the files by path.
     */
    const { GROWTH_STAGES, stageOf, careOf, nextStage } = await import('../../src/game/CompanionKinds.js');
    assert(GROWTH_STAGES.length >= 3, 'a growth ladder with two rungs is a boolean');
    let both = 0, battleOnly = 0;
    for (let i = 1; i < GROWTH_STAGES.length; i++) {
      const a = GROWTH_STAGES[i - 1], b = GROWTH_STAGES[i];
      assert(b.runs > a.runs, `${b.id} costs no more runs than ${a.id}`);
      assert(b.care >= a.care, `${b.id} asks for LESS care than ${a.id}`);
      if (b.care > 0) both++; else battleOnly++;
    }
    assert(both >= 2,
      `${both} stages want care as well as runs — the habitat is decoration if the ladder can be `
      + 'climbed without ever walking to it');
    assert(battleOnly >= 1,
      'every stage past the first needs care — a player who never finds the room would never see his '
      + 'companion change at all');

    Kn.clear();
    const live = Kn.adopt('massiff', 'Kept');
    assert(live, 'nothing adopted');
    assert(stageOf(live) === 0, 'a fresh animal is not on the bottom stage');
    /* THE HUNDRED PRESSES. */
    for (let i = 0; i < 100; i++) { Kn.careFor(live.id, 'meals'); Kn.careFor(live.id, 'grooms'); }
    let rec = Kn.load().live;
    assert(rec.meals === 1 && rec.grooms === 1,
      `a hundred presses on a record with no runs left meals ${rec.meals} and grooms ${rec.grooms} — `
      + 'care is farmable while standing still');
    assert(careOf(rec) === 2, `careOf reads ${careOf(rec)}`);
    /* AND IT OPENS AGAIN WHEN THE ANIMAL HAS ACTUALLY BEEN OUT. */
    const k = Kn.load(); k.live.runs = 5; Kn.save(k);
    for (let i = 0; i < 100; i++) Kn.careFor(live.id, 'meals');
    rec = Kn.load().live;
    assert(rec.meals === 6, `after five runs a hundred presses left meals at ${rec.meals}, not 6`);
    /* NOTHING SUBTRACTS, AND A BAD ACT NAME IS A NO-OP RATHER THAN A WRITE. */
    Kn.careFor(live.id, 'xp'); Kn.careFor(live.id, 'runs'); Kn.careFor('not-this-animal', 'meals');
    const after = Kn.load().live;
    assert(after.xp === rec.xp && after.runs === rec.runs && after.meals === rec.meals,
      'the care door wrote a field that is not one of its two');
    /* AND THE LADDER ACTUALLY MOVES WHEN BOTH HALVES ARRIVE. */
    const g2 = GROWTH_STAGES[2];
    const ripe = { ...after, runs: g2.runs, meals: g2.care, grooms: 0 };
    assert(stageOf(ripe) >= 2, `runs ${g2.runs} and care ${g2.care} does not reach ${g2.id}`);
    assert(stageOf({ ...ripe, meals: g2.care - 1 }) < 2,
      `${g2.id} was reached on runs alone — its care gate does nothing`);
    assert(stageOf({ ...ripe, runs: g2.runs - 1 }) < 2,
      `${g2.id} was reached on care alone — its runs gate does nothing`);
    const n = nextStage({ ...ripe });
    assert(n && n.runs >= 0 && n.care >= 0, 'nextStage says nothing about what is left');
    assert(nextStage({ runs: 999, meals: 999, grooms: 999 }) === null, 'a fully grown animal still has a next stage');
    Kn.clear();
    return `${GROWTH_STAGES.length} stages, ${both} of them needing both halves; a hundred presses on a `
      + 'fresh animal bought 1 meal and 1 groom, and six runs bought six';
  });

  check('companion: the care door has its own pin, the way the dressing door has one', async () => {
    /**
     * `companion: neither new file has grown a currency` greps the BODY of
     * `dressCompanion` and fixes what a screen may write at exactly `name` and
     * `look`. Care is a SECOND write from a screen, and the tempting thing was
     * to widen that pin by two words.
     *
     * WIDENING A PIN TO FIT A NEW FEATURE IS HOW A PIN STOPS MEANING ANYTHING.
     * The whole value of that grep is that the number is fixed and the next
     * person has to argue rather than append. So the care write is its own
     * exported door with its own whitelist and its own pin, and this is that
     * pin — the same shape, on the same terms, shipped on the same commit.
     *
     * IT PINS THE WHITELIST AND THE BODY BOTH. The array alone would be
     * satisfied by a function that ignored it; the body alone would be
     * satisfied by an array with `xp` in it.
     */
    const kn = strip(await src('game/Kennel.js'));
    assert(/export const CARE_ACTS = Object\.freeze\(\['meals', 'grooms'\]\)/.test(kn),
      'CARE_ACTS is not exactly meals and grooms — the care door has grown a third thing to write');
    const body = /export function careFor\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(kn)?.[1] || '';
    assert(body, 'Kennel.careFor is gone');
    /* Every write this function makes to the record, as the field it names. A
     * literal field name here is a field a screen can edit. */
    const writes = [...body.matchAll(/k\.live(?:\.(\w+)|\[(\w+)\])\s*(?:=|\+=|-=|\|\|=|\?\?=)/g)]
      .map((m) => m[1] || `[${m[2]}]`).sort();
    assert(writes.join(',') === '[act]',
      `careFor writes ${writes.join(', ') || 'nothing'} — it may increment one of CARE_ACTS and `
      + 'nothing else; a door that could touch xp, runs, kills or tempers is a cheat panel');
    assert(/CARE_ACTS\.includes\(act\)/.test(body), 'careFor does not check its own whitelist');
    assert(/canCare\(/.test(body), 'careFor does not ask the one reader whether the act is allowed');
    /* AND THE SIX WORDS, ON THE NEW FILE, BY PATH — the same scan, extended
     * the day the file lands rather than the day somebody notices. */
    const hab = strip(await src('game/Habitat.js'));
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(hab),
        `Habitat.js has grown a "${word}" — the room has become a shop`);
    }
    return `CARE_ACTS is meals,grooms; careFor writes exactly k.live[act]; Habitat.js clean of all six words`;
  });

  check('companion: the growth ladder earns drawbacks, two-sided and priced', async () => {
    /**
     * V15 §4 asks for drawbacks in as many words: "a companion that only ever
     * helps is a stat. A big one is slow and loud; a bonded one panics when it
     * is hurt."
     *
     * THE SHAPE THAT REQUEST HAS TO TAKE WAS ALREADY WRITTEN. A drawback is
     * not a penalty column on the stage table and it is not a negative
     * multiplier: it is a TEMPER — two-sided, on the behaviour axes, priced
     * net <= 0, shed by the same rule — so `companion: every temper costs at
     * least what it buys` is already holding both of these the day they land,
     * without one line being added to it. That is the point of this check
     * being short: it proves the two new rows are EARNED off the growth
     * ladder and that the earn is driven to a real true and a real false,
     * which is the only clause the pricing check cannot see.
     */
    const { GROWTH_STAGES } = await import('../../src/game/CompanionKinds.js');
    const base = { kind: 'massiff', xp: 0, runs: 0, meals: 0, grooms: 0, downs: 0, orders: 0, ranged: 0, tempers: [] };
    const top = GROWTH_STAGES[GROWTH_STAGES.length - 1];
    const idsOf = (r) => Kn.earnedTempers(r).map((t) => t.id);
    /* A FRESH ANIMAL HAS EARNED NOTHING OFF THIS LADDER. */
    const fresh = idsOf({ ...base });
    /* FULLY GROWN, AND FED. */
    const grown = idsOf({ ...base, runs: top.runs, meals: top.care });
    const earned = grown.filter((id) => !fresh.includes(id));
    assert(earned.length >= 2,
      `the whole growth ladder earns ${earned.length} temper(s) — a companion that only ever helps is a stat`);
    for (const id of earned) {
      const t = Kn.temperById(id);
      assert(t, `${id} is earned and is not in the table`);
      assert(Kn.priceTemper(t) <= 1e-9, `${id} nets ${Kn.priceTemper(t).toFixed(3)} — it is a free gift`);
      assert(t.gain && t.cost, `${id} does not say both halves`);
      /* THE FALSE SIDE, DRIVEN. A predicate that answered true for everything
       * would satisfy every clause above it. */
      assert(!fresh.includes(id), `${id} is earned by an animal that has done nothing`);
    }
    /* AND THE PAIR THAT CONTRADICT CANNOT BE WORN AT ONCE — the growth ladder
     * gets the same treatment the deed ladder gets, driven rather than read. */
    const rec = { ...base, runs: top.runs, meals: top.care, ranged: 9, tempers: ['ranging'] };
    Kn.applyTempers(rec);
    const worn = new Set(rec.tempers);
    for (const t of Kn.TEMPERS) {
      if (!t.sheds || !worn.has(t.id)) continue;
      assert(!worn.has(t.sheds), `${t.id} and ${t.sheds} are worn at once, and they contradict`);
    }
    assert(rec.tempers.length <= Kn.TEMPERS_WORN, 'more tempers are worn than the cap allows');
    assert(Kn.TEMPERS_WORN >= Kn.TEMPERS.length,
      `the wear cap is ${Kn.TEMPERS_WORN} and the table has ${Kn.TEMPERS.length} rows — a cap under the `
      + 'table silently drops whichever ones the Set iterated last');
    return `${earned.length} tempers earned off the growth ladder (${earned.join(', ')}), all priced <= 0, `
      + `none earned by a fresh animal; ${rec.tempers.length} worn at once under a cap of ${Kn.TEMPERS_WORN}`;
  });

  check('companion: the habitat writes the six plaques and answers the panel', async () => {
    /**
     * `StationKit.js:987` has built six blank slabs on the habitat's back wall
     * since the room landed, with a comment saying "`Habitat.js` writes the
     * names on them from the Kennel" — and `Habitat.js` did not exist.
     * `ctx.habitat` was handed out as `st.habitat` and NOTHING read it. A room
     * with a wall of blanks in it and a note pointing at a file nobody wrote is
     * HANDOFF §0.1b exactly: a surface promising a thing nothing writes.
     *
     * DRIVEN AGAINST A REAL KENNEL AND A REAL PARENT NODE. The wall is asked
     * for its rows with an animal alive and with one dead, and the panel is
     * asked for the two care controls in both the state where they are live
     * and the state where they are not — because the failure mode that matters
     * for a management screen is not a crash, it is a control that is offered
     * and does nothing, which is the dead control `WEARS` was written to
     * prevent one room across.
     *
     * AND THE MISSING HOOK IS DRIVEN AS A REFUSAL RATHER THAN AS A CRASH.
     * `st.habitat` carries `{deck,x,z,yaw}` and no scene node, so on the tree
     * as it stands `writePlaques` can only say what it is missing. That is
     * asserted here — a file that quietly did nothing would be indistinguishable
     * from one that worked, and the day the hook lands this clause is what
     * says so.
     */
    const H = await import('../../src/game/Habitat.js');
    Kn.clear();
    /* WITH NOTHING IN THE KENNEL: six rows, not two and four holes. */
    let rows = H.plaqueLines();
    assert(rows.length === H.PLAQUES, `an empty kennel gives ${rows.length} plaques and the wall has ${H.PLAQUES}`);
    assert(rows.every((r) => Array.isArray(r)), 'a plaque row is not a list of lines');
    /* WITH AN ANIMAL. */
    const live = Kn.adopt('massiff', 'Borz');
    rows = H.plaqueLines();
    assert(rows[0][0] === 'Borz', `the living animal's plaque says "${rows[0][0]}"`);
    assert(/FRESH/.test(rows[0][1]), `its plaque says "${rows[0][1]}" and it is on the bottom stage`);

    /* THE PANEL. */
    let panel = H.habitatPanel();
    assert(panel.rec && panel.rec.id === live.id, 'the panel does not hold the live record');
    assert(panel.care.acts.length === Kn.CARE_ACTS.length, 'the panel offers a different number of acts than the door takes');
    assert(panel.care.acts.every((a) => a.can && !a.why), 'a fresh animal cannot be looked after at all');
    assert(panel.next && panel.next.runs > 0, 'the panel does not say what the next stage wants');
    assert(panel.stage.label, 'the panel does not name the stage it is on');
    /* THE CONTROL AND THE DOOR AGREE, WHICH IS THE WHOLE CLAUSE. */
    for (const a of panel.care.acts) {
      const before = Kn.load().live[a.act] | 0;
      H.careAt(live.id, a.act);
      assert((Kn.load().live[a.act] | 0) === before + 1,
        `the panel offered "${a.label}" as live and pressing it changed nothing`);
    }
    panel = H.habitatPanel();
    for (const a of panel.care.acts) {
      assert(!a.can && a.why, `${a.act} is still offered after it has been done this run, with no reason given`);
      const before = Kn.load().live[a.act] | 0;
      H.careAt(live.id, a.act);
      assert((Kn.load().live[a.act] | 0) === before,
        `${a.act} was refused on the panel and written by the door — the two disagree`);
    }
    /* AND A DROID IS CHARGED RATHER THAN FED — the noun is data, not a switch. */
    Kn.clear();
    const droid = Kn.adopt('astro', 'Arfour');
    const dp = H.habitatPanel();
    const beast = (() => { Kn.clear(); Kn.adopt('massiff', 'B'); return H.habitatPanel(); })();
    assert(dp.care.acts[0].label !== beast.care.acts[0].label,
      `a droid and an animal are both "${dp.care.acts[0].label}" — V16 §2 B5 says a droid charges`);
    void droid;

    /* THE WALL, AND THE HOOK. */
    const noStation = H.writePlaques(null);
    assert(noStation.wrote === 0 && noStation.why, 'writePlaques on no station neither wrote nor said why');
    assert(noStation.rows.length === H.PLAQUES, 'it did not even produce the words');
    const half = H.writePlaques({ _station: { habitat: { deck: 0, x: 0, z: 0, yaw: 0 } } });
    assert(half.wrote === 0 && /group/.test(half.why),
      `with the shipped st.habitat it says "${half.why}" — it must name what it is missing`);
    /* AND WITH THE HOOK IT ACTUALLY DRAWS. */
    const group = new THREE.Group();
    const world = { _station: { habitat: { deck: 0, x: 0, z: 0, yaw: 0, group, w: 14, d: 12 } } };
    const done = H.writePlaques(world);
    assert(done.wrote === H.PLAQUES, `given the hook it wrote ${done.wrote} of ${H.PLAQUES}`);
    const made = group.children.filter((o) => /^habitat-plaque-/.test(o.name));
    assert(made.length === H.PLAQUES, `${made.length} plaque meshes reached the room`);
    const xs = new Set(made.map((m) => m.position.x.toFixed(3)));
    assert(xs.size === H.PLAQUES, `${xs.size} distinct positions for ${H.PLAQUES} plaques — they are stacked`);
    /* IDEMPOTENT: a caller that runs it on every entry does not build a second wall. */
    H.writePlaques(world);
    assert(group.children.filter((o) => /^habitat-plaque-/.test(o.name)).length === H.PLAQUES,
      'a second call built a second wall');
    Kn.clear();
    return `${H.PLAQUES} plaques written into a parent at ${xs.size} distinct positions and redrawn `
      + `idempotently; the panel's two controls agree with the door in both directions; with the shipped `
      + `st.habitat it refuses with "${half.why}"`;
  });

}
