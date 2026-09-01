/**
 * BATTLEFRONT BORZ — INSPECTING AND CHANGING ONE MAN ON THE DECK.
 *
 * `hangar.mjs` holds the SHAPE of the room and `deckplay.mjs` holds what the
 * Force can do in it. This holds the section of `HANGAR-SPEC.md` headed
 * "CUSTOMISING THEM, IN FRONT OF YOU", which was `·` — not started — on every
 * line of it, and which an audit found had been *imported* rather than built:
 * `turnTo` sat in `Hangar.js`'s import list with no caller, `Parade.TURN` and
 * `turnState` had no live consumer, the four `DeckAudio` cues were called by
 * nothing but their own unit test, and there was no raycast of any kind
 * anywhere on the deck.
 *
 * ── AND THE HOLE THAT LET ALL OF THAT SIT THERE ──────────────────────────
 *
 * A headless `bootWorld` on the hangar has an EMPTY COMPANY ROLL. `dressHangar`
 * ends in `callTheCompany`, which reads `Company.loadAll()` and returns `null`
 * the moment no army has a man on it — so on a clean store the deck builds the
 * room, calls the company, gets nobody, and every check that has ever booted
 * this level has measured a formation of zero men. `stepCompany` iterates an
 * empty array, the merge never runs, and no assertion about a body on this
 * deck could have failed even if the body had been deleted.
 *
 * SO THIS FILE SEEDS A ROLL BEFORE IT BOOTS, through the real doors —
 * `CommandRoster.enlist` for the men and `Company.keep` for the withdrawal that
 * puts them on the roll — and restores the player's own store afterwards. That
 * is the one line of setup without which none of this measures anything, and it
 * is why the code under test has never been seen by a check before.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE WOULD CATCH A REAL REGRESSION ─────
 *
 *   THE PICK TAKES THE MAN UNDER THE CROSSHAIR. Every man in the line is
 *     aimed at in turn through the real camera rig, and the pick must answer
 *     him and not the file beside him — 2.1 m away, which is `MUSTER.interval`
 *     and is the whole tolerance a box-based pick has to live inside.
 *   THE PAINT IS A SWEEP AND NOT A POP. This is the check the brief's bold
 *     type asks for. The colour is sampled out of the MERGED VERTEX BUFFER —
 *     the thing actually drawn — across many frames, and has to climb
 *     monotonically over more than one frame, take between 0.6 and 1.0 s, and,
 *     mid-wash, have painted SOME of the armour and not the rest. A colour
 *     assignment fails all three, and the last one is what tells a wash from a
 *     cross-fade.
 *   AN EDIT SURVIVES THE STORE. Made on the deck, read back through
 *     `Company.load`, which is the same door the Company tab reads.
 *   THE TWO SURFACES CANNOT DRIFT. The menu's list of editable fields is read
 *     OUT OF `Menu.js`'S SOURCE — every `write({…})` in `_wireCompanyEdits` and
 *     `_wireDressing` — and compared for set equality with `DeckEdit.EDIT_OPS`.
 *     "Everything doable here is doable in the main menu" then cannot rot on
 *     either side without this going red.
 */

import { readFile } from 'node:fs/promises';
import { ARMIES, CommandRoster } from '../../src/game/Command.js';
import * as Company from '../../src/game/Company.js';
import { functionBody } from './_source.mjs';
import * as Edit from '../../src/game/DeckEdit.js';
import { SALUTE, TURN, stagger } from '../../src/game/Parade.js';
import { MUSTER } from '../../src/game/Hangar.js';

const KEY = 'saber.company.v1';
const src = (p) => new URL(`../../src/${p}`, import.meta.url);

/**
 * A roll of `n` real veterans, on a store nobody else is using.
 *
 * Through `CommandRoster.enlist` and `Company.keep` rather than by writing a
 * blob, for the reason every other fixture in this repository gives: a
 * hand-written record is a record with today's fields in it, and the day
 * `readMan` gains a required one the fixture is the only man in the game
 * without it.
 */
function seedRoll(n = 6) {
  const army = ARMIES.republic;
  const r = new CommandRoster(army);
  for (let i = 0; i < n; i++) r.enlist(army.tiers[0].type);
  return Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
}

/** Run `fn` against a store holding only our roll, and put the player's back. */
async function withRoll(n, fn) {
  const had = globalThis.localStorage?.getItem(KEY) ?? null;
  const hadSlate = globalThis.localStorage?.getItem('saber.muster.v1') ?? null;
  localStorage.removeItem(KEY);
  localStorage.removeItem('saber.muster.v1');
  const roll = seedRoll(n);
  try { return await fn(roll); } finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    if (hadSlate == null) localStorage.removeItem('saber.muster.v1');
    else localStorage.setItem('saber.muster.v1', hadSlate);
  }
}

/** The deck, through the same door `enterHangar` uses, with the roll standing. */
async function deck() {
  const { bootWorld } = await import('./_coop.mjs');
  return bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0, army: 'republic' },
  });
}

/**
 * Step the world the way `HangarDirector.update` will once the edit layer is
 * wired into it: the company first, the edit layer after.
 *
 * The ORDER is the thing this helper exists to state. `stepCompany` ends each
 * man with `merged.update(c.t)`, and that runs `syncPaint`, which rewrites any
 * span whose source material has moved. A wash that wrote the merged buffer
 * BEFORE it would be overwritten by a flat colour on the same frame, and the
 * sweep check below would read a pop. If the line in `Hangar.js` ever goes in
 * above `stepCompany` instead of below it, this file is where that is caught.
 */
function drive(world, seconds, input) {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    world.update(dt, input);
    Edit.stepDeckEdit(world, dt);
  }
  return n;
}

/** Form the company up and let every man fold into his merged skin. */
function formUp(world, idle) {
  /* `MUSTER.formUp` plus one bake a frame for the whole company plus a
   * margin — `BAKES_PER_FRAME` is 1, so twenty-four men need twenty-four
   * frames after the last of them halts. */
  drive(world, MUSTER.formUp + 4, idle);
}

/**
 * Stand the player in front of a man and point him at his chest.
 *
 * `aimDir` is `(0,0,-1)` through `YXZ(pitch, yaw)`, so the yaw that looks along
 * a horizontal `d` is `atan2(-dx, -dz)`; `deckplay.mjs`'s `aimAt` carries the
 * long version of why getting that backwards measures nothing. Iterated for the
 * same reason it is there: in third person the ray leaves `camera.pos`, which
 * is three metres behind the head and moves as the yaw does.
 */
function standBefore(world, row, back, THREE, idle) {
  const p = world.player;
  const at = row.fig.root.position;
  const chest = new THREE.Vector3(at.x, (row.man.hip || 0.95) * 1.35, at.z);
  /* IN FRONT OF HIM, on the side the player's own spawn is: the company faces
   * aft, so a man inspected from the front is inspected from -z of the line. */
  const from = new THREE.Vector3(at.x, 0, at.z - back);
  p.position.copy(from);
  p.velocity.set(0, 0, 0);
  p.body?.setTransform?.(new THREE.Vector3(from.x, from.y + 0.9, from.z), null);
  const look = () => {
    const eye = p.camera.pos ?? p.position;
    const d = new THREE.Vector3().subVectors(chest, eye).normalize();
    p.camera.yaw = Math.atan2(-d.x, -d.z);
    p.camera.pitch = Math.max(-1.28, Math.min(1.16, Math.asin(d.y)));
  };
  for (let i = 0; i < 4; i++) { look(); drive(world, 0.1, idle); }
  look();
  drive(world, 2 / 60, idle);
}

/**
 * THE COLOUR ACTUALLY BEING DRAWN, per vertex, for one source material.
 *
 * Read out of the merged skin's own colour attribute rather than off the
 * material, because the material is exactly what a pop would move and a wash
 * deliberately does not: `mergeFigure` absorbs `material.color` into this
 * buffer at bake time, so the buffer IS the paint on the man. Returns the mean
 * and the two extremes, which is what tells a wash (some painted, some not)
 * from a cross-fade (everything the same intermediate colour).
 */
function bufferColour(row, mat) {
  const skin = row.merged?.skin;
  if (!skin) return null;
  let n = 0, sum = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < skin.meshes.length; i++) {
    const col = skin.meshes[i].geometry.attributes.color;
    let start = 0;
    for (const s of skin.sources[i]) {
      const count = s.geometry.attributes.position.count;
      if (s.material === mat) {
        for (let v = 0; v < count; v++) {
          /* THE RED CHANNEL, because every assertion below is about a paint
           * that moves it and nothing else in the room writes this buffer. */
          const r = col.getX(start + v);
          sum += r; n++;
          if (r < lo) lo = r;
          if (r > hi) hi = r;
        }
      }
      start += count;
    }
  }
  return n ? { mean: sum / n, lo, hi, n } : null;
}

/** The material a paint field lands on, asked the way `DeckEdit` asks it. */
function plateOf(row) {
  return row.fig?.palette?.plate ?? null;
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  const { idleInput } = await import('./_coop.mjs');
  const idle = idleInput();
  /**
   * SERIALISED, AND IT IS LOAD-BEARING HERE MORE THAN ANYWHERE.
   *
   * `verify.mjs` starts every async body at once and settles them at the end,
   * and every clause in this file writes the SAME localStorage key while a
   * whole World stands on the deck reading it. Two of these interleaved would
   * each be inspecting the other's company.
   */
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The pick                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: the crosshair picks the man it is on, not the file beside him', async () =>
    withRoll(6, async () => {
      const { world } = await deck();
      try {
        const c = world._company;
        assert(c && c.men.length === 6,
          `the deck stood ${c ? c.men.length : 0} men for a roll of six — the seed did not reach `
          + 'callTheCompany, and every assertion below would be measuring an empty room');
        formUp(world, idle);

        /* EVERY MAN IN THE LINE, one at a time. The files are `MUSTER.interval`
         * apart, so this is the whole tolerance the pick has. */
        const missed = [];
        for (const row of c.men) {
          standBefore(world, row, 2.4, THREE, idle);
          const got = Edit.pickMan(world);
          if (got !== row) {
            missed.push(`${row.rec.designation} -> ${got ? got.rec.designation : 'nobody'}`);
          }
        }
        assert(!missed.length,
          `${missed.length} of ${c.men.length} picks took the wrong man at ${MUSTER.interval} m `
          + `interval: ${missed.join(', ')}`);

        /* AND IT IS BOUNDED. `REACH` is the close-focus framing expressed as
         * the only thing that can compose a shot without taking the camera:
         * step back past it and the line is a line again. */
        const one = c.men[Math.floor(c.men.length / 2)];
        standBefore(world, one, Edit.REACH + 6, THREE, idle);
        assert(Edit.pickMan(world) === null,
          `a man ${(Edit.REACH + 6).toFixed(0)} m away was picked — the pick reaches past REACH `
          + `(${Edit.REACH} m) and "camera close-focus" is a sniper scope`);

        return `${c.men.length}/${c.men.length} picked at ${MUSTER.interval} m interval, `
          + `refused at ${(Edit.REACH + 6).toFixed(0)} m`;
      } finally { world.unload(); }
    }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The focus                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: he breaks attention, turns, salutes and HOLDS — and snaps back', async () =>
    withRoll(4, async () => {
      const { world } = await deck();
      try {
        formUp(world, idle);
        const c = world._company;
        /* A MAN OFF THE END OF THE LINE, so the player standing in front of him
         * is standing off the axis the rest of the company faces — which is the
         * only way there is a turn to measure at all. `turnTo` resolves the
         * point to a yaw once, and a man already square to you turns zero. */
        const row = c.men[0];
        standBefore(world, row, 2.2, THREE, idle);
        const home = row.fig.root.position.clone();

        assert(Edit.focusKey(world), 'the focus key picked nobody standing 2.2 m from a man');
        const st = Edit.editState(world);
        assert(st.held === row, 'the focus key held the wrong man');
        assert(row.man.turn, '`turnTo` was never called — the one bullet the dead import is for');
        assert(row.man.saluteAt != null, 'he was selected and did not salute');

        /* THE HOLD. Both sequences unwind by themselves — `TURN.total` is
         * 2.43 s and `SALUTE.total` is 2.56 — so a man who is still turned and
         * still saluting after four seconds is being HELD rather than having
         * been started. This is the assertion that separates "he salutes" from
         * "he salutes, holds". */
        drive(world, 4.0, idle);
        const t = c.t + stagger(row.man);
        assert(row.man.turn && t - row.man.turn.at < TURN.swing + TURN.hold,
          'the turn ran out after four seconds — he broke off looking at you on his own');
        const u = t - row.man.saluteAt;
        assert(u >= SALUTE.up && u <= SALUTE.up + SALUTE.hold,
          `the salute is ${u.toFixed(2)} s in against a ${SALUTE.hold} s hold — it is not being held`);

        /* HE IS OUT OF THE LINE. `Menu._stagePick` steps the picked man
         * forward 0.55 on the stage; this is that, on the deck, in metres. */
        const out = row.fig.root.position.distanceTo(home);
        assert(out > Edit.STEP_OUT * 0.9,
          `he stepped ${out.toFixed(2)} m out of the line against ${Edit.STEP_OUT} — he did not `
          + 'break attention, he only saluted');

        /* AND THE DESELECT IS A SNAP. The pose sequences are gone on the very
         * next frame; the walk back is a pace, because a man teleporting
         * half a metre sideways is a different sentence. */
        Edit.releaseMan(world);
        assert(row.man.turn === null && row.man.saluteAt === null,
          'deselect left the turn or the salute running — it is supposed to be a snap');
        drive(world, 1.2, idle);
        const back = row.fig.root.position.distanceTo(home);
        assert(back < 0.02, `he is ${back.toFixed(2)} m off his mark a second after being put down`);

        /* AND PICKING A SECOND MAN PUTS THE FIRST ONE BACK. There is one step
         * for the whole layer; a man left standing 0.55 m out of the line
         * because you looked at somebody else is a formation with a hole in
         * it, and it would only ever be seen from behind. */
        const other = c.men[1];
        Edit.holdMan(world, row);
        drive(world, 0.5, idle);
        assert(row.fig.root.position.distanceTo(home) > Edit.STEP_OUT * 0.9, 'he did not step out again');
        Edit.holdMan(world, other);
        assert(row.fig.root.position.distanceTo(home) < 0.02,
          'picking a second man left the first one standing out of the line');
        Edit.releaseMan(world);
        drive(world, 1.2, idle);

        return `held 4.0 s turned and saluting, stepped ${out.toFixed(2)} m out, `
          + `back on his mark within ${back.toFixed(3)} m`;
      } finally { world.unload(); }
    }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The sweep — the one the brief puts in bold                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: paint arrives as a wash over the armour, not as an assignment', async () =>
    withRoll(3, async () => {
      const { world } = await deck();
      try {
        formUp(world, idle);
        const c = world._company;
        const row = c.men[0];
        standBefore(world, row, 2.2, THREE, idle);
        Edit.focusKey(world);

        const mat = plateOf(row);
        assert(mat, 'the figure has no `plate` material — the palette this reads has moved');
        assert(row.merged?.skin,
          'the man never folded into a merged skin, so there is no drawn buffer to measure — '
          + 'the bake budget or the halt has changed');
        const before = bufferColour(row, mat);
        assert(before && before.n > 200,
          `${before ? before.n : 0} plate vertices in the merged buffer — nothing to wash`);

        /* PAINT HIM BLOOD. `PAINTS.blood` is 0xb4382c: red 0.70 in sRGB, and
         * whatever the plate was it is not that. */
        const wrote = Edit.applyEdit(world, 'paint', { color: 'blood' });
        assert(wrote?.paint?.color === 'blood', 'the store did not take the paint');

        /* THE FIRST FRAME MUST NOT BE THE ANSWER. This is the pop test, stated
         * as directly as it can be stated. */
        drive(world, 1 / 60, idle);
        const first = bufferColour(row, mat);
        const target = new THREE.Color(0xb4382c);
        const goal = target.r;
        assert(Math.abs(first.mean - goal) > Math.abs(before.mean - goal) * 0.5,
          `one frame after the edit the armour is already ${first.mean.toFixed(3)} against a `
          + `target of ${goal.toFixed(3)} (from ${before.mean.toFixed(3)}) — this is a pop`);

        /* SAMPLED ACROSS THE WHOLE PROGRESSION. Monotone toward the target,
         * strictly more than one frame of it, and mid-wash SOME of the armour
         * painted and some of it not — which is what makes it a wash crossing
         * the plate rather than the whole man cross-fading. */
        const samples = [first];
        let frames = 1, split = 0;
        const up = goal > before.mean;
        for (let i = 0; i < 120; i++) {
          drive(world, 1 / 60, idle);
          const s = bufferColour(row, mat);
          samples.push(s);
          frames++;
          /* THE WET EDGE. Mid-wash the extremes must straddle: part of him is
           * the new colour and part of him is still the old one. A cross-fade
           * has lo === hi on every single frame. */
          if (Math.abs(s.hi - s.lo) > 0.05) split++;
          /* DONE IS FLAT AND ON TARGET, not merely near it on average: a wash
           * that is half old colour and half new has the right MEAN in the
           * middle of its own travel, and stopping there would measure the
           * sweep as shorter than it is. */
          if (Math.abs(s.mean - goal) < 0.005 && Math.abs(s.hi - s.lo) < 0.005) break;
        }
        const moving = samples.filter((s, i) => i > 0
          && Math.abs(s.mean - samples[i - 1].mean) > 1e-4).length;
        assert(moving > 8,
          `the colour moved on ${moving} frames — a sweep is a progression, not two states`);
        for (let i = 1; i < samples.length; i++) {
          const d = samples[i].mean - samples[i - 1].mean;
          assert(up ? d >= -1e-4 : d <= 1e-4,
            `the wash reversed at sample ${i} (${samples[i - 1].mean.toFixed(4)} -> `
            + `${samples[i].mean.toFixed(4)}) — it is not monotonic`);
        }
        assert(split > 4,
          `the armour was never part-painted (${split} frames with a wet edge) — every vertex `
          + 'moved together, which is a cross-fade of the whole man and not a wash over him');
        const secs = frames / 60;
        assert(secs >= 0.55 && secs <= 1.1,
          `the wash took ${secs.toFixed(2)} s — the brief asks for a wash you can see, and the `
          + 'cue under it is 0.62 s long');
        /* THE LAST TWO FRAMES. The edge clears the crown a little before the
         * clock runs out — the top of the helmet is under `hi` by the soft
         * edge's own width — so the buffer goes flat a frame or two before
         * the wash hands its colour over. Driven out, because what is
         * asserted below is the state it LEAVES BEHIND. */
        drive(world, 0.2, idle);
        const end = bufferColour(row, mat);
        assert(Math.abs(end.mean - goal) < 0.01 && Math.abs(end.hi - end.lo) < 0.02,
          `the wash finished at ${end.mean.toFixed(3)} spread ${(end.hi - end.lo).toFixed(3)} — it `
          + 'did not land flat on the target');
        /* AND THE SOURCE MATERIAL IS WHERE IT ENDS UP, so the shipped
         * `syncPaint` can reproduce the buffer and a re-bake keeps the colour. */
        assert(Math.abs(mat.color.r - goal) < 0.01,
          'the wash never handed the final colour to the source material — a re-merge would '
          + 'wash it straight back off');

        return `${moving} frames of movement over ${secs.toFixed(2)} s, ${split} of them with a `
          + `wet edge, landing flat at ${end.mean.toFixed(3)}`;
      } finally { world.unload(); }
    }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The part that arrives                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: an attachment falls in from off frame before it is on him', async () =>
    withRoll(3, async () => {
      const { world } = await deck();
      try {
        formUp(world, idle);
        const c = world._company;
        const row = c.men[0];
        standBefore(world, row, 2.2, THREE, idle);
        Edit.focusKey(world);

        const opts = Edit.optionsFor(row).filter((o) => o.op === 'kit' && o.value);
        assert(opts.length, 'this chassis wears nothing — `wearableFor` has changed under this');
        const was = row.fig;
        const st = Edit.editState(world);
        Edit.applyEdit(world, 'kit', { [opts[0].field]: opts[0].value });

        assert(st.drops.length === 1, 'a kit change put nothing in the air');
        const drop = st.drops[0];
        const high = drop.mesh.position.y - row.fig.root.position.y;
        assert(high > 3.5,
          `the part started ${high.toFixed(1)} m above him — "off-frame" means above the top of `
          + 'the frame for a player standing inside REACH of him');
        assert(row.fig === was, 'the part was still in the air and the body had already changed');

        let steps = 0, last = drop.mesh.position.y;
        while (st.drops.length && steps < 200) {
          drive(world, 1 / 60, idle);
          steps++;
          if (st.drops.length) {
            assert(drop.mesh.position.y <= last + 1e-6, 'the falling part went back up');
            last = drop.mesh.position.y;
          }
        }
        assert(steps > 8, `the part landed in ${steps} frames — that is a reveal, not a drop`);
        assert(row.fig !== was, 'the part landed and the man is wearing nothing new');
        assert(Company.load('republic').men.find((m) => m.designation === row.rec.designation)
          ?.look?.kit?.[opts[0].field] === opts[0].value,
          'the part landed on the body and never reached the roll');
        return `${opts[0].label} fell ${high.toFixed(1)} m over ${steps} frames, then went on`;
      } finally { world.unload(); }
    }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The store                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: what you change on the deck is on the roll when you leave it', async () =>
    withRoll(3, async () => {
      const { world } = await deck();
      try {
        formUp(world, idle);
        const c = world._company;
        const row = c.men[0];
        const key = row.rec.designation;
        standBefore(world, row, 2.2, THREE, idle);
        Edit.focusKey(world);

        Edit.renameMan(world, 'Ladder');
        Edit.applyEdit(world, 'mark', 'blood');
        Edit.applyEdit(world, 'band', 'sky');
        Edit.paintMan(world, 'color', 'jungle');
        const kit = Edit.optionsFor(row).find((o) => o.op === 'kit' && o.value);
        Edit.attachPart(world, kit.field, kit.value);

        /* READ BACK THROUGH THE STORE'S OWN DOOR, not off the object the deck
         * is holding: `Company.load` re-parses what was written, which is the
         * only thing that proves the write survived being a save file. */
        const m = Company.load('republic').men.find((x) => x.designation === key);
        assert(m, 'the man is not on the roll at all after being edited');
        assert(m.look?.callsign === 'Ladder', `callsign came back ${m.look?.callsign}`);
        assert(m.look?.mark === 'blood', `mark came back ${m.look?.mark}`);
        assert(m.look?.band === 'sky', `band came back ${m.look?.band}`);
        assert(m.look?.paint?.color === 'jungle', `paint came back ${m.look?.paint?.color}`);
        assert(m.look?.kit?.[kit.field] === kit.value, `kit came back ${m.look?.kit?.[kit.field]}`);

        /* AND THE ONE THING THAT IS NOT WRITTEN THE INSTANT IT IS MADE. Every
         * other op goes through `Company.dress` on the keypress, so the deck
         * never holds an unsaved change; a name being TYPED is the exception
         * and is what `leaveDeck` is for. */
        Edit.beginNaming(world);
        /* THE FIELD OPENS ON WHAT HE IS ALREADY CALLED, which is what a rename
         * is: `Menu`'s own callsign input is rendered with the stored value in
         * it, and a deck field that opened empty would make every rename a
         * retype. */
        assert(Edit.editState(world).naming.text === 'Ladder',
          'the callsign field did not open on the name he already has');
        for (let i = 0; i < 6; i++) Edit.typeName(world, 'Backspace');
        for (const ch of 'Hevy') Edit.typeName(world, ch);
        assert(Company.load('republic').men.find((x) => x.designation === key).look.callsign === 'Ladder',
          'a half-typed name reached the store before it was committed');
        const n = Edit.leaveDeck(world);
        assert(Company.load('republic').men.find((x) => x.designation === key).look.callsign === 'Hevy',
          'the name being typed when the player walked off the deck was lost');
        assert(n >= 6, `${n} edits counted for six made`);
        assert(Edit.editState(world).held === null, 'leaving the deck left a man still held');
        return `callsign, mark, band, paint and kit all on the roll; ${n} edits, name committed on the way out`;
      } finally { world.unload(); }
    }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The two surfaces                                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckedit: every change plays its own one-shot', async () =>
    withRoll(3, async () => {
      /**
       * ══ THE FOUR CUES THAT HAD NO CALLER ══════════════════════════════════
       *
       * "Every change plays a one-shot audio cue so the menu feels tactile."
       *
       * `cuePaint`, `cueAttach`, `cueDetach` and `cueName` are written,
       * measured and commented at length in `DeckAudio.js`, and until this
       * layer existed the only thing that had ever called them was their own
       * unit test. That is the exact failure this whole effort is correcting —
       * a part built to a spec and never joined up — so it is asserted here
       * rather than assumed, by spying on the ONE door all four go through.
       *
       * `audio.shape` and not the cue functions themselves: a spy on the cue
       * would pass on a build where the cue had been emptied out.
       */
      const { audio } = await import('../../src/engine/Audio.js');
      const { world } = await deck();
      const shape = audio.shape;
      const heard = [];
      audio.shape = (o) => { heard.push(o?.dur ?? 0); return null; };
      try {
        formUp(world, idle);
        const row = world._company.men[0];
        standBefore(world, row, 2.2, THREE, idle);
        Edit.focusKey(world);

        const seen = {};
        const count = (k, fn) => { heard.length = 0; fn(); seen[k] = heard.length; };
        count('name', () => Edit.renameMan(world, 'Ladder'));
        count('paint', () => Edit.paintMan(world, 'color', 'blood'));
        const kit = Edit.optionsFor(row).find((o) => o.op === 'kit' && o.value);
        count('attach', () => Edit.attachPart(world, kit.field, kit.value));
        /* The attach cue is the LANDING and not the keypress — see the drop
         * check — so it is counted after the part has fallen. */
        const at = heard.length;
        heard.length = 0;
        drive(world, 1.2, idle);
        seen.attach = heard.length;
        const off = Edit.optionsFor(row).find((o) => o.op === 'kit' && o.field === kit.field
          && (o.value === null || o.value === false));
        heard.length = 0;
        Edit.attachPart(world, off.field, off.value);
        drive(world, 1.2, idle);
        seen.detach = heard.length;

        for (const k of ['name', 'paint', 'attach', 'detach']) {
          assert(seen[k] > 0,
            `changing ${k} on the deck made no sound — DeckAudio's cue${k} is back to having no `
            + 'caller, which is the state this layer exists to fix');
        }
        return `name ${seen.name}, paint ${seen.paint}, attach ${seen.attach} (${at} on the press), `
          + `detach ${seen.detach}`;
      } finally { audio.shape = shape; world.unload(); }
    }));

  check('deckedit: the wheel walks the whole surface, and a notch is an edit', async () =>
    withRoll(3, async () => {
      /**
       * THE OPTION SPACE, ENUMERATED AGAINST THE GAME'S OWN TABLES.
       *
       * `EDIT_OPS` says WHICH fields the deck may write; this says the deck
       * offers every VALUE of them that the menu draws a control for. The
       * expected count is derived from `MARKS`, `PAINTS`, `PAINT_SLOTS`,
       * `KIT_FIELDS` and `wearableFor` — the five tables `Menu._dressingHtml`
       * builds its rows out of — so a swatch added to the game appears on both
       * surfaces or the count disagrees here.
       */
      const { MARKS } = await import('../../src/game/Command.js');
      const { PAINTS, PAINT_SLOTS, KIT_FIELDS, wearableFor } =
        await import('../../src/game/Bodies.js');
      const { world } = await deck();
      try {
        formUp(world, idle);
        const row = world._company.men[0];
        const kind = row.rec.kind === 'steel' ? 'steel' : 'flesh';
        const can = wearableFor(row.rec.type, kind);
        const paintRows = (PAINT_SLOTS[kind] || []).filter(([f]) => can.paint.includes(f)).length;
        const kitVals = can.kit.reduce((n, f) => n + (KIT_FIELDS[kind][f]?.values.length || 0), 0);
        /* Two mark rows, every paint slot times the palette plus "as issued",
         * and every legal value of every kit field. */
        const want = MARKS.length * 2 + paintRows * (PAINTS.length + 1) + kitVals;
        const list = Edit.optionsFor(row);
        assert(list.length === want,
          `the wheel offers ${list.length} changes and the tables describe ${want} — the deck and `
          + 'the Company tab are drawing different palettes');

        standBefore(world, row, 2.2, THREE, idle);
        Edit.focusKey(world);
        const before = JSON.stringify(row.rec.look || null);
        assert(Edit.wheelEdit(world, 1), 'a wheel notch with a man held did nothing at all');
        /* A NOTCH IS DIALLED, NOT APPLIED — see `WHEEL_DWELL`. Ninety options
         * applied as the cursor went past them would write the save ninety
         * times and rain ninety plates on the man. */
        assert(JSON.stringify(row.rec.look || null) === before,
          'the wheel wrote on the notch — spinning it through the palette would write the save '
          + 'once per option and drop a part from the sky for every kit row it crossed');
        drive(world, 0.4, idle);
        assert(JSON.stringify(row.rec.look || null) !== before,
          'the wheel settled and still never wrote anything');
        /* AND IT DOES NOT ANSWER WITH NOBODY HELD, so the notch goes back to
         * being the grip's distance control the moment the man is put down. */
        Edit.releaseMan(world);
        assert(Edit.wheelEdit(world, 1) === false,
          'the wheel claimed a notch with no man selected — it would be stealing the grip control');
        return `${list.length} changes on the wheel, matching the tables`;
      } finally { world.unload(); }
    }));

  check('deckedit: the deck edits exactly what the menu edits', async () => {
    /**
     * ══ THE ONE THAT STOPS THE TWO DRIFTING ═══════════════════════════════
     *
     * "Everything you change is saved on leaving, and everything doable here is
     *  doable in the main menu."
     *
     * Both halves are enumerated rather than asserted about. The deck's half is
     * `EDIT_OPS`. The menu's half is read out of `Menu.js`'s SOURCE — the
     * argument keys of every `write({…})` inside `_wireCompanyEdits` and
     * `_wireDressing`, which is the one door that page changes a man through —
     * so a sixth field added to the Company tab lands here as a failure naming
     * itself, and a field removed from the deck does the same.
     *
     * Through `functionBody` and not a character window: `_source.mjs`'s header
     * counts nineteen checks in this suite that read a function by slicing a
     * hand-written number of characters, two of which had silently expired.
     */
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const ops = new Set();
    for (const sig of ['  _wireCompanyEdits(', '  _wireDressing(']) {
      const body = functionBody(menu, sig);
      for (const m of body.matchAll(/write\(\{\s*([A-Za-z_$][\w$]*)/g)) ops.add(m[1]);
    }
    assert(ops.size >= 4,
      `only ${ops.size} editable fields found in Menu.js — the scrape has stopped matching and `
      + 'this check is now comparing the deck against nothing');
    const deckOps = new Set(Edit.EDIT_OPS);
    const missing = [...ops].filter((o) => !deckOps.has(o));
    const extra = [...deckOps].filter((o) => !ops.has(o));
    assert(!missing.length,
      `the menu can change ${missing.join(', ')} and the deck cannot — "everything doable here is `
      + 'doable in the main menu" now only runs one way');
    assert(!extra.length,
      `the deck can change ${extra.join(', ')} and the menu cannot — the sentence runs the other `
      + 'way too, and the menu is the surface that has to keep up');
    return `${[...deckOps].sort().join(', ')} on both surfaces`;
  });
}
