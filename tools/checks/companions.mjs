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
    for (const id of K.COMPANION_ORDER) {
      const A = (await import('../../src/game/Enemy.js')).ARCHETYPES[K.COMPANION_KINDS[id].archetype];
      if (!A) continue;
      const { world, e } = await field(id, { xp: 99 });
      try {
        assert(e, `${id} would not field`);
        assert(e.speed <= cap + 1e-6,
          `a ${id} runs at ${e.speed.toFixed(2)} against a cap of ${cap.toFixed(2)} — it can outrun you`);
        rows.push(`${id} ${e.speed.toFixed(1)}`);
      } finally { world.unload(); }
    }
    assert(rows.length >= 6, `only ${rows.length} kinds have a body to measure`);
    return `${rows.length} bodies, cap ${cap.toFixed(2)} m/s: ${rows.join(', ')}`;
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
      return `silent solo, silent with no animal, and hosting it says: "${said.slice(0, 80)}…"`;
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
        assert(up, `area ${area + 1}: twenty seconds stood over it and it never got up`);

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


}
