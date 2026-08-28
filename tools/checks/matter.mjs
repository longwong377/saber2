/**
 * BATTLEFRONT BORZ — WHAT "IT HAS PHYSICS" ACTUALLY MEANS, PER OBJECT.
 *
 * This file exists because of one sentence and what it hid.
 *
 * "there shouldn't be a single thing that doesn't have physics" — and the
 * answer given was a commit headed *"A falling tree is matter: the last thing
 * in the game that was not"*. That commit was real work and it was true of
 * COLLISION: a falling trunk became a kinematic body that crushes what is
 * under it, shoves crates and fells its neighbours. It was false of CUTTING.
 * `Forest.capsules()` read `STATE !== STANDING` and skipped, so for the two or
 * three seconds of a fall the blade was offered nothing and a swing passed
 * clean through the tree. The player found it by swinging at one.
 *
 * The lesson is not "that trunk was missed". It is that **"physics" is three
 * different questions and the tree answered two of them**, while every
 * instrument in the repository, and every summary written off those
 * instruments, asked only whichever one it happened to be looking at:
 *
 *   BODY     is it in the physics world — can it be walked into, shoved,
 *            landed on, hit by something else
 *   STRIKER  is it armed, so moving into something PRICES a blow
 *   BLADE    does it hand the solver a capsule — can it be CUT
 *
 * So this suite asks all three of everything a level actually contains and
 * fails on a silent no. A no is not always a defect — a hazard volume is not
 * meant to be cut, and several objects sit in `world.props` only so the loops
 * can find them — so the exemptions are a NAMED LIST below with a reason each.
 * A new prop that quietly cannot be cut is a red line here, not a discovery
 * three weeks later.
 *
 * WHY IT PROBES RATHER THAN ASKS ONCE. A forest and the destruction proxy cull
 * their capsule lists to what is near their own body, which in play follows
 * the blade. Asked once, wherever the harness left it, both answer zero — and
 * a zero here would read as "the blade cannot touch this", which is the same
 * false negative in the opposite direction. The proxy is walked to the level's
 * own content before an answer is believed.
 */
import { clocked } from './_shared.mjs';
import { bootWorld } from './_coop.mjs';

/**
 * THE OBJECTS THAT ARE ALLOWED TO ANSWER NO, and why each one is.
 *
 * Keyed by `kind`. Every entry is a sentence a player would accept if they
 * swung at the thing and nothing happened.
 */
const EXEMPT = {
  front: 'a manager: the mass ranks are drawn instances, and the men promote to real bodies at Mass.PROMOTE before you can reach them',
  levy: 'a manager: it owns conscripts, it is not a thing on the field',
  flight: 'a manager: it owns the flyers, it is not a thing on the field',
  riders: 'a manager: it owns mounted troops, it is not a thing on the field',
  mass: 'a manager: it lays the front, it is not a thing on the field',
  water: 'water is not something a blade parts, and it is a body so you can still stand in it',
  hazard: 'a volume, not a solid — it is the thing that hurts you, not a thing you hit',
};

/** Scenes, because what is in a world is the mode's doing. */
const SCENES = [
  { level: 'wood', mode: 'sandbox', warm: 0 },
  { level: 'geonosis', mode: 'waves', warm: 8 },
];

const idle = () => ({ act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => (o ? (o.x = 0, o.y = 0, o) : { x: 0, y: 0 }),
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} });

/** Where the level's own content is, for walking a culling proxy to it. */
function probePoints(world) {
  const out = [];
  const V = world.player?.position?.constructor;
  if (!V) return out;
  if (world.player) out.push(world.player.position.clone());
  for (const p of world.props || []) {
    if (p?.body?.position && p.kind !== 'forest') out.push(p.body.position.clone());
  }
  const forest = (world.props || []).find((p) => p?.kind === 'forest');
  if (forest?.data && forest.count) {
    const step = Math.max(1, forest.count >> 5);
    for (let i = 0; i < forest.count && out.length < 48; i += step) {
      const k = i * 15;
      out.push(new V(forest.data[k], forest.data[k + 2] + 1, forest.data[k + 1]));
    }
  }
  return out;
}

/** How many capsules this object offers the blade, asked where its content is. */
function bladeCapsules(o, probes) {
  const ask = () => {
    if (typeof o.capsules !== 'function') return -1;
    try { return (o.capsules([]) || []).length; } catch { return -2; }
  };
  let n = ask();
  if (n === 0 && o.body?.position && probes.length) {
    const was = o.body.position.clone();
    for (const pt of probes) {
      o.body.position.copy(pt);
      n = ask();
      if (n > 0) break;
    }
    o.body.position.copy(was);
  }
  return n;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('matter: everything solid on a level can be CUT, and the exceptions are named', async () => {
    const rows = [], excused = [];
    for (const { level, mode, warm } of SCENES) {
      const { world } = await bootWorld({ level, settings: { mode, difficulty: 'knight' } });
      try {
        const input = idle();
        for (let i = 0; i < warm * 60; i++) world.update(1 / 60, input);
        const probes = probePoints(world);
        for (const p of world.props || []) {
          if (!p) continue;
          const kind = String(p.kind || p.constructor?.name || 'unknown');
          const n = bladeCapsules(p, probes);
          assert(n !== -2, `${level}: ${kind}.capsules() threw — the blade solver walks this every frame`);
          if (n > 0) { rows.push(`${kind}:${n}`); continue; }
          assert(EXEMPT[kind],
            `${level}: a "${kind}" offers the blade ${n === -1 ? 'no capsules() at all' : 'zero capsules'} `
            + 'and is not on this file\'s exemption list — it is a solid the blade passes through, '
            + 'which is the falling-trunk defect wearing a different name. Fix it, or name it above '
            + 'with the sentence you would say to a player who swung at it');
          excused.push(`${kind} (${level})`);
        }
        /* AND EVERYTHING ALIVE IS ALL THREE. A body on the field with no
         * capsules is a soldier the blade cannot touch, which is the same
         * defect one layer over. */
        for (const e of world.enemies || []) {
          if (!e || e.dead) continue;
          const kind = String(e.type || e.kind || 'enemy');
          const n = bladeCapsules(e, probes);
          assert(n > 0, `${level}: a live ${kind} offers the blade ${n} capsules — it cannot be cut`);
          assert(e.body, `${level}: a live ${kind} has no physics body`);
          assert(typeof e.body.onContact === 'function',
            `${level}: a live ${kind} is not armed — moving into things prices nothing`);
        }
      } finally { world.unload?.(); world.dispose?.(); }
    }
    return `${rows.length} solid object(s) cuttable; excused: ${[...new Set(excused)].join(', ') || 'none'}`;
  });

  /**
   * THE ONE THE PLAYER FOUND, pinned at the level the claim was made at.
   *
   * `forest.mjs` proves the mechanism on a fixture — a capsule in the air, two
   * pieces from one cut, the top carrying the speed it was cut at. This is the
   * same fact asked of a REAL level, because the fixture would go on passing
   * if `attachForest` stopped handing the wood to the blade at all.
   */
  check('matter: a trunk in the air is cuttable on a real level, not just a fixture', async () => {
    const { world } = await bootWorld({ level: 'wood', settings: { mode: 'sandbox', difficulty: 'knight' } });
    try {
      const forest = (world.props || []).find((p) => p?.kind === 'forest');
      assert(forest, 'the wood has no forest in world.props');
      const player = world.player;
      forest.body.position.copy(player.position);
      const i = forest.nearestStanding(player.position, 80);
      assert(i >= 0, 'no standing tree anywhere near the player on the wood');
      forest.fell(i, 1, 0, 0.6);
      const input = idle();
      const foot = forest.hinge(i, player.position.clone()).y;
      const h0 = forest.tip(i, player.position.clone()).y - foot;
      let inAir = 0;
      for (let f = 0; f < 900 && forest.active.includes(i); f++) {
        world.update(1 / 60, input);
        forest.body.position.copy(forest.tip(i, player.position.clone()));
        const caps = forest.capsules([]).filter((c) => c.tree === i && c.falling);
        if (caps.length) inAir++;
        if (forest.tip(i, player.position.clone()).y - foot < h0 * 0.5) break;
      }
      assert(inAir > 10,
        `the trunk was offered to the blade on ${inAir} frames of its fall — a swing at a falling `
        + 'tree meets nothing');
      return `the blade is offered a real falling trunk on ${inAir} frames of one fall`;
    } finally { world.unload?.(); world.dispose?.(); }
  });
}
