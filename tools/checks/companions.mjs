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
}
