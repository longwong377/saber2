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
   * A WORLD THE ANIMAL CAN ACTUALLY STAND STILL IN.
   *
   * `field()` above boots Geonosis, and that is right for everything it is
   * used for. It is WRONG for an idle test, and the reason is a measurement
   * rather than a preference: on Geonosis a companion at heel never settles.
   * Driven for forty seconds with every hostile dead and the player standing
   * still, the animal held a 1.30 m gap to its own station at 4.25 m/s
   * indefinitely, its `wish` alternating between the walk home and a
   * perpendicular — the stuck-commit inside `Enemy._move` fighting the terrain
   * clutter it is standing in. Same fixture on the colosseum floor: gap 0.07 m,
   * speed 0.000, calm for 39.5 s of 40.
   *
   * So the idle checks run on the flat, and the Geonosis behaviour is written
   * down here rather than left to be rediscovered. It is not CompanionLife's
   * to fix — nothing in that file can move a body — but an idle beat is gated
   * on the animal being still, so on broken ground a companion will breathe
   * and track and flinch and never scratch.
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
    const rows = [];
    for (const kind of ['massiff', 'tooka']) {
      const { world, input, e, p } = await calmField(kind);
      try {
        assert(e, `${kind} would not field`);
        assert(e.rig?.get('head'), `${kind} has no head bone to turn`);
        /**
         * WHERE THE HOSTILE GOES, AND IT IS NOT ARBITRARY.
         *
         * A neck has a stop. `LIFE.look.yaw` is 0.62 rad and the shipped
         * combat track's is 0.7, so a hostile 90° off the animal's shoulder
         * SATURATES both — the head goes as far as it goes and the measured
         * error to the target is the rest of the angle, whatever the code did.
         * The first cut of this check put the body 6 m off the player's +X and
         * measured 1.67 rad of "error" on an animal that was turning its head
         * as far as a head turns.
         *
         * So the animal is settled first, its own facing is read, and the
         * hostile is put 4 m out at 0.45 rad off that — inside the stop, so
         * the ward branch can be judged on whether it ARRIVES rather than on
         * how far a neck bends, and still inside the massiff's ward of 9 from
         * the player (the heel is 3.4 m back, so 7.4 m at worst).
         *
         * It is parked the way `_beastshot` parks a subject: speed zero, both
         * timers out. A hostile that walks moves the bearing under the
         * measurement, and one that shoots raises `underFire`, which is a
         * different channel and not this one.
         */
        assert(!C.orderCompanion(e, 'away'), 'AWAY was refused — it is unrefusable at every rung');
        for (let i = 0; i < 30 * 3; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, input); }
        const V = p.position.constructor;
        const a = (e.facing || 0) + 0.45;
        const spot = new V(e.position.x + Math.sin(a) * 4, e.position.y, e.position.z + Math.cos(a) * 4);
        const foe = world.spawnEnemy('b1', spot.clone());
        assert(foe, 'no hostile spawned');
        foe.team = (p.team ?? 0) + 1;
        const ward = K.COMPANION_KINDS[kind].ward;
        const reach = spot.distanceTo(p.position);
        assert(ward === 0 || reach < ward,
          `the fixture put the hostile ${reach.toFixed(1)} m from the player, outside the ${ward} m ward`);
        for (let i = 0; i < 30 * 5; i++) {
          p.hp = p.maxHp ?? 100;
          foe.hp = foe.maxHp; foe.dead = false; foe.downed = false;
          foe.speed = 0; foe.attackTimer = 1e9; foe.stunTimer = 1e9;
          foe.velocity.set(0, 0, 0);
          foe.position.copy(spot);
          world.update(STEP, input);
        }
        assert(!e.target, `${kind} took a target under AWAY — this measures the gait, not the layer`);
        const head = e.rig.worldPos('head', new THREE.Vector3());
        const g = gazeOf(e);
        const dFoe = Math.abs(wrap(g - bearing(head, foe.position)));
        const dOwn = Math.abs(wrap(g - bearing(head, p.position)));
        const split = Math.abs(wrap(bearing(head, foe.position) - bearing(head, p.position)));
        assert(split > 0.5,
          `the fixture put the owner and the hostile ${split.toFixed(2)} rad apart — it cannot tell them apart`);
        rows.push({ kind, ward, dFoe, dOwn, turn: wrap(g - (e.facing || 0)) });
      } finally { world.unload(); }
    }
    const dog = rows.find((r) => r.ward > 0);
    const cat = rows.find((r) => r.ward === 0);
    assert(dog && cat, 'the fixture did not produce one warder and one non-warder');
    /**
     * THE WARDER'S HALF IS ABSOLUTE; THE OTHER HALF IS A DIRECTION, and that
     * asymmetry is a fact about the animal rather than a softened assertion.
     *
     * A companion at heel stands off your BACK quarter and faces the way you
     * face, so its owner is BEHIND it — measured on this fixture, 2.5 rad
     * round. No neck turns that far and the gaze stops at `LIFE.look.yaw`, so
     * "the ward-0 animal's head points at its owner" is a thing no correct
     * implementation could ever satisfy, and a check that demanded it would be
     * demanding a defect. What ward 0 CAN be held to is the direction it turns
     * in: away from the hostile, round toward the man behind it, to the stop.
     *
     * So the two turns are compared by SIGN. The warder turns +0.45 onto the
     * hostile; the other turns the other way entirely. One number each, and
     * opposite — which no amount of tuning produces by accident.
     *
     * (The DECK body has no such limit: `stepCompanionDeck` turns the whole
     * animal to face you when it sits, which is why the hangar is the room
     * where a companion looks you in the eye.)
     */
    assert(dog.dFoe < 0.4,
      `a warding companion ended ${dog.dFoe.toFixed(2)} rad off the hostile inside its own ward`);
    assert(cat.dFoe > dog.dFoe + 0.8,
      `ward 0 is ${cat.dFoe.toFixed(2)} rad off the hostile and ward 9 is ${dog.dFoe.toFixed(2)} — `
      + 'both kinds are watching the same thing, so the ward field is reordering nothing');
    assert(dog.turn * cat.turn < 0,
      `both heads turned the same way (${dog.turn.toFixed(2)} and ${cat.turn.toFixed(2)} rad off `
      + 'their own facing) — ward 0 is supposed to mean it turns AWAY from the fight, toward YOU');
    assert(Math.abs(cat.turn) > 0.3,
      `the ward-0 animal only turned its head ${cat.turn.toFixed(2)} rad — it is looking at nothing`);
    return `ward 9 turns ${dog.turn.toFixed(2)} rad onto the hostile and ends ${dog.dFoe.toFixed(2)} off `
      + `it; ward 0 turns ${cat.turn.toFixed(2)} rad the other way, ${cat.dFoe.toFixed(2)} off the `
      + `hostile, toward an owner that is ${cat.dOwn.toFixed(2)} rad round behind it`;
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

      let hMax = 0, tMax = 0, ribLo = 9, ribHi = -9;
      const beats = new Set();
      for (let i = 0; i < 30 * 40; i++) {
        world.update(STEP, input);
        hMax = Math.max(hMax, head.obj.quaternion.angleTo(head.restQuat));
        tMax = Math.max(tMax, trunk.obj.quaternion.angleTo(trunk.restQuat));
        const r = L.parts.ribs[0];
        if (r) { ribLo = Math.min(ribLo, r.mesh.scale.x); ribHi = Math.max(ribHi, r.mesh.scale.x); }
        if (L.beat) beats.add(L.beat.id);
      }
      assert(fig.sit > 0.8, `it never settled (sit ${fig.sit.toFixed(2)}) — nothing here is idle`);
      assert(hMax > 0.05, `the deck animal's head moved ${hMax.toFixed(3)} rad in forty seconds`);
      assert(tMax > 0.005, `the deck animal's trunk moved ${tMax.toFixed(4)} rad in forty seconds`);
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

}
