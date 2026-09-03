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

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  const K = await import('../../src/game/CompanionKinds.js');
  const Kn = await import('../../src/game/Kennel.js');
  const C = await import('../../src/game/Companions.js');

  /* ── what it may never become ─────────────────────────────────────── */

  check('companion: no rung buys a single point of anything that fights', async () => {
    /**
     * THE FIELD DOES NOT EXIST, AND THAT IS THE ASSERTION.
     *
     * Not "every multiplier is 1.00" — a field sitting at 1.00 is an
     * invitation with a comment on it, and `company.mjs` already records what
     * happened the last time a ladder carried one. COMPANY.md defends the
     * trooper RANKS spread on two grounds: it is averaged across twenty-four
     * bodies, and a fresh muster re-earns it inside one campaign. Neither half
     * holds for a companion — there is exactly ONE and it is with you in modes
     * that have no muster — so the rule here is stricter and is checked as an
     * absence.
     *
     * The forbidden names are the four axes a body fights on plus every word
     * this repository has used for a multiplier, so a row that renamed its way
     * around the rule still goes red.
     */
    const BANNED = /^(hp|maxhp|damage|dmg|armour|armor|toughness|pace|speed|mult|multiplier|scale|power|strength|bonus)$/i;
    for (const r of K.COMPANION_RANKS) {
      for (const f in r) {
        assert(!BANNED.test(f), `rung ${r.id} carries a "${f}" — the ladder has become a power ladder`);
      }
      assert(typeof r.leash === 'number' && r.leash > 0, `rung ${r.id} has no leash`);
      assert(Array.isArray(r.orders), `rung ${r.id} licenses nothing`);
    }
    /* AND IT IS MONOTONIC IN THE TWO THINGS IT DOES BUY, which is the shape
     * `command.mjs:833` pins for RANKS — more leash and never fewer orders. */
    for (let i = 1; i < K.COMPANION_RANKS.length; i++) {
      const a = K.COMPANION_RANKS[i - 1], b = K.COMPANION_RANKS[i];
      assert(b.leash > a.leash, `${b.id} does not reach further than ${a.id}`);
      assert(b.xp > a.xp, `${b.id} costs no more than ${a.id}`);
      for (const o of a.orders) assert(b.orders.includes(o), `${b.id} lost ${o}`);
    }
    return `${K.COMPANION_RANKS.length} rungs, ${K.COMPANION_RANKS.map((r) => r.leash).join('/')} m of leash, `
      + `${K.COMPANION_RANKS.map((r) => r.orders.length).join('/')} orders, and not one multiplier field`;
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
    for (const f of ['game/Kennel.js', 'game/Companions.js', 'game/CompanionKinds.js']) {
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
    return `3 files clean of all six words; dressCompanion writes exactly ${fields.join(', ')}`;
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
      let on = 0, off = 0;
      for (let i = 0; i < 30 * 8; i++) {
        p.hp = p.maxHp ?? 100; world.update(STEP, input);
        if (!e.target) continue;
        if (e.target === want) on++; else off++;
      }
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
    /* AND CO-OP DOES NOT FOLD AT ALL — no bond earned, no death recorded, and
     * a client's stored companion untouched. The conservative answer, and the
     * only one that cannot cause a durable loss the player did not cause. */
    Kn.save({ live: { ...rec }, fallen: [], runs: 0, lost: 0 });
    const none = Kn.keepCompanion({ netMode: 'host', _companions: { body0: { dead: true } } }, { won: false });
    assert(none === null && !!Kn.load().live, 'a session fold killed a companion');
    Kn.clear();
    return said.join('; ') + '; a session folds nothing';
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

  check('companion: the colours you pick reach the geometry, and an unknown id does not', async () => {
    /**
     * "you can customize their appearance to a degree"
     *
     * THIS LIGHTS CODE THAT HAS SHIPPED FOR MONTHS AND HAS NEVER BEEN REACHED.
     * `buildQuadruped` accepts `opts.hide`, `opts.plate`, `opts.belly` and
     * `opts.eye` and NOTHING in the tree had ever handed it anything but the
     * plan's own defaults — every creature in the game was wearing its factory
     * colours because there was no door.
     *
     * DRIVEN ONE SLOT AT A TIME. Painting all four at once and finding the
     * body changed would not tell you whether four slots are wired or one is:
     * so each is painted alone, and each has to move the body on its own and
     * move it DIFFERENTLY for a different colour.
     *
     * AND THE EYE IS EMISSIVE, which the first version of this missed
     * completely. It collected `material.color` only, so the eye slot read as
     * "adds nothing" and looked like a dead control — it is `emissiveMat`, and
     * its colour lives on `material.emissive`. A check that reads half the
     * material is a check that reports half the truth.
     */
    const { paintById } = await import('../../src/game/Bodies.js');
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
      const hues = (e) => {
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
      const put = (look) => hues(fieldCompanion(world, world.player, 'massiff', { rec: { xp: 9, look } }));
      const factory = put(undefined);
      const said = [];
      for (const f of K.COMPANION_LOOK.creature) {
        const a = [...put({ [f]: 'sky' })].filter((h) => !factory.has(h));
        const b = [...put({ [f]: 'blood' })].filter((h) => !factory.has(h));
        assert(a.length, `the ${f} slot changes nothing on the body — it is a dead control`);
        assert(a.join() !== b.join(),
          `the ${f} slot paints the same thing for Sky and for Blood — it stores a value and ignores it`);
        said.push(`${f} ${a.join()}/${b.join()}`);
      }
      /* THE SAME CHOICE IS THE SAME ANIMAL, twice running. */
      const r1 = [...put({ hide: 'sun' })].sort().join();
      const r2 = [...put({ hide: 'sun' })].sort().join();
      assert(r1 === r2, 'the same colour built two different bodies');
      /* AND AN ID THIS BUILD DOES NOT HAVE IS THE FACTORY HIDE, NOT BLACK.
       * `paintById` answers null for an unknown id and a null slot is simply
       * absent, which the builder reads as the plan's own colour — so a save
       * from a build with a wider palette degrades to the animal it was born
       * as rather than to a silhouette. */
      const bad = [...put({ hide: 'nonesuch' })].sort().join();
      assert(bad === [...factory].sort().join(),
        'an unknown colour id built something other than the factory animal');
      assert(paintById('nonesuch') === null, 'paintById invented a colour');
      return `${said.length} slots each move the body and move it differently `
        + `(${said.join(', ')}); the same pick is stable; an unknown id is the factory hide`;
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
     * FIELD IT FOR EVERYBODY, FOLD IT FOR NOBODY. `keepCompanion` returns
     * early in a session — no bond earned, no death recorded, no epitaph, and
     * a client's stored animal untouched. It neither gains a run nor loses its
     * life. That is the conservative answer and the only one that cannot cause
     * a durable loss the player did not cause.
     *
     * BUT A PLAYER WHO FINDS OUT AFTERWARDS HAS BEEN CHEATED OF AN EVENING,
     * which is the argument `notSaving()` makes one panel across. So it is
     * said on the screen where you host or join, the moment you do, and only
     * when there is an animal for it to be true of.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
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
      /* AND A CLIENT IS TOLD SOMETHING ELSE, because a client gets something
       * else: `fieldFromKennel` returns early on a client, since a body
       * spawned there is a GHOST no other screen has. "Your companion comes
       * with you" would be exactly the false promise this line prevents. */
      menu.netSession('client');
      const asClient = line();
      assert(/kennel|host/i.test(asClient) && asClient !== said,
        `a client is told "${asClient}", which is what the host is told`);
      menu.netSession('host');
      assert(/not kept|nothing that happens to it is kept/i.test(said),
        `hosting with a companion, the screen says "${said}"`);
      assert(/cannot be lost|will not earn/i.test(said),
        'it says the run is not kept but not that the animal is also safe — both halves matter');
      /* AND IT IS NOT SAID WHEN THERE IS NOTHING TO SAY IT ABOUT. */
      settings.companion = 'none';
      menu._syncKennelCoop();
      assert(!line(), `with no companion it still says "${line()}"`);
      menu.netSession(null);
      settings.companion = 'massiff';
      menu._syncKennelCoop();
      assert(!line(), 'it warns about a session when there is no session');
      return `silent solo, silent with no animal; hosting: "${said.slice(0, 60)}…"; `
        + `joining: "${asClient.slice(0, 60)}…"`;
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
      const gap = () => fig.root.position.distanceTo(p.position);
      /* IT ARRIVES AT YOUR HEEL. `callTheCompanion` runs while the ROOM is
       * built and the player is placed after it, so without the arrival snap
       * the body starts at the world origin — measured at 92.9 m, jogging in
       * from the far bulkhead every time you step off the lift. */
      assert(gap() < 6, `it came up in the lift and is ${gap().toFixed(1)} m away`);
      const sat = fig.sit;
      assert(sat > 0.8, `standing still beside you it is only ${sat.toFixed(2)} sat down`);

      /* IT FOLLOWS, and it stands up to do it. The deck's own walls stop the
       * player after a couple of metres in this fixture, which is enough:
       * what is measured is that the gap is HELD and that the sit lifts. */
      let minSit = 1, moved = 0;
      const from = p.position.clone();
      for (let i = 0; i < 30 * 3; i++) {
        p.position.x += 4 * STEP;
        world.update(STEP, input);
        minSit = Math.min(minSit, fig.sit);
        moved = p.position.distanceTo(from);
      }
      assert(moved > 1, `the fixture only moved the player ${moved.toFixed(2)} m — it proves nothing`);
      assert(minSit < 0.8, `it stayed ${minSit.toFixed(2)} sat down while you walked ${moved.toFixed(1)} m`);
      assert(gap() < 6, `after walking it is ${gap().toFixed(1)} m behind`);

      /* AND IT SITS BACK DOWN. */
      for (let i = 0; i < 30 * 5; i++) world.update(STEP, input);
      assert(fig.sit > 0.8, `you stopped and it is still only ${fig.sit.toFixed(2)} sat`);

      /* AND IT IS PUSHABLE AND CUTTABLE THROUGH A PUBLISHED EXTENSION POINT
       * NOTHING IN src/ HAD EVER WRITTEN. `Hangar.deckBladeTargets` already
       * reads `world._deckProps` with an absent-array guard and World.js
       * already consumes it; this is its first writer. */
      assert((world._deckProps || []).some((x) => x.kind === 'companion'),
        'it is not offered to the deck blade — you can walk through your own dog');
      return `arrived ${gap().toFixed(1)} m off your heel, sat ${sat.toFixed(2)}; walking `
        + `${moved.toFixed(1)} m stood it up to ${minSit.toFixed(2)}; stopping sat it again at `
        + `${fig.sit.toFixed(2)}; and it is on the deck's blade list`;
    } finally { world.unload(); Kn.clear(); }
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
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
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
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
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

}
