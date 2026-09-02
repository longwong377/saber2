/**
 * THE HUB — every run starts on the flight deck and comes back to it.
 *
 * The player's V12 note: "I want you to start every game (other than
 * sandbox/training) in the hangar… all modes should end with flying back into
 * the hangar and getting off… even if you're in the main menu and start a
 * mode you still have to go through the hangar." And on the seam: "the
 * transition from leaving with your troops in the hangar and getting to the
 * planet is kind of janky like it isn't seamless… when you look back you
 * don't see any detailed capital ship… all I see is a large rectangle."
 *
 * main.js is a top-level script that boots an Engine against WebGL2, so its
 * routing is READ (the same way session.mjs reads it); the flight and the
 * exterior are DRIVEN on a booted hangar world.
 */
import { readFile } from 'node:fs/promises';
import { DECK } from '../../src/game/Hangar.js';
import { FLIGHT, PHASE, flightPhase, depart, embarkCompany } from '../../src/game/DeckFlight.js';
import { setExteriorSeen, EXTERIOR_FAR, CAPITAL_SCALE } from '../../src/game/DeckExterior.js';

const ROOT = new URL('../../', import.meta.url);
const src = (p) => readFile(new URL(p, ROOT), 'utf8');
const body = (s, name) => {
  const i = s.indexOf(name);
  if (i < 0) return '';
  /* The body's brace is the one after the signature's closing paren, not the
   * first brace — `deploy(opts = {})` has one in its defaults. */
  const sig = name.includes('(') && !name.includes('=>');
  let depth = 0, j = s.indexOf('{', sig ? s.indexOf(')', i + name.length - 1) : i + name.length);
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}' && --depth === 0) return s.slice(i, k + 1);
  }
  return s.slice(i);
};

async function deck(run = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 }, run });
  return { world, idle: idleInput() };
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { run: step } = await import('./_coop.mjs');

  check('hub: Ignite on a fighting mode is a door onto the deck, and only the deck deploys', async () => {
    const main = await src('src/main.js');
    const hf = body(main, 'function hangarFirst()');
    assert(hf, 'main.js has no hangarFirst()');
    for (const room of ["'hangar'", "'sandbox'", 'dojo', 'insertion === false']) {
      assert(hf.includes(room), `hangarFirst does not exempt ${room}`);
    }
    assert(hf.includes('!net.isHost'), 'a co-op client would be sent to its own deck instead of the host\'s start');
    const dep = body(main, 'async function deploy(opts');
    assert(dep, 'deploy() takes no options');
    const gate = dep.indexOf('if (!opts.fromDeck && hangarFirst())');
    assert(gate >= 0 && gate < dep.indexOf('saveSettings'), 'deploy does not route to the deck before it does anything else');
    assert(dep.includes("enterHangar(null, { launch: true })"), 'the routed deploy does not enter the hangar');
    const door = body(main, 'world.onDeckDeploy = () =>');
    assert(door.includes('fromDeck: true'), 'the deck\'s deploy does not say it is from the deck');
    assert(door.includes('captureStill()'), 'the deck\'s deploy does not capture a still for the seam');
    assert(door.includes('lookRel'), 'the deck\'s deploy does not hand the look over');
    /* Every playable mode: which way does it go? */
    const { MODES, playableModes } = await import('../../src/game/Waves.js');
    const viaDeck = [], direct = [];
    for (const key of playableModes()) {
      const M = MODES[key];
      (key === 'sandbox' || key === 'hangar' || M.dojo || M.insertion === false ? direct : viaDeck).push(key);
    }
    assert(viaDeck.length >= 6, `only ${viaDeck.length} modes route through the deck`);
    assert(direct.every((k) => ['sandbox', 'training', 'hangar'].includes(k)), `a fighting mode skips the deck: ${direct.join(', ')}`);
    return `via the deck: ${viaDeck.join(', ')} · straight in: ${direct.join(', ')}`;
  });

  check('hub: every ending you are standing for flies home, and the seam is a still of the bay', async () => {
    const main = await src('src/main.js');
    const go = body(main, 'function gameOver(stats)');
    const hw = go.slice(go.indexOf('const homeward'), go.indexOf('if (homeward)'));
    assert(hw.includes('alive') && !hw.includes("stats.ended === 'withdrew'") && !hw.includes('|| won'),
      'homeward is still gated on a win or a withdrawal');
    const scr = await src('src/ui/Screens.js');
    const ld = body(scr, 'loading(frac = 0');
    assert(ld.includes("classList.add('still')") && ld.includes('backgroundImage'), 'Screens.loading does not take a still');
    const css = await src('styles.css');
    assert(/#loading\.still\{background-size:cover/.test(css), 'no full-bleed rule for the still');
    return 'homeward on alive alone; loading(frac, label, {still}) paints the last frame';
  });

  check('hub: the run out keeps the bay open, goes far, and the ship stands round the deck', async () => {
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const ex = world._deckExterior;
      assert(ex && ex.group, 'no capital hull dressed round the deck');
      assert(!ex.group.visible, 'the exterior is drawn while the eye is inside the room');
      assert(ex.model.scale.x === CAPITAL_SCALE, `the exterior is at scale ${ex.model.scale.x}, not real size`);
      /* The mouth sits on the aperture: the model's bounding box spans the lip. */
      const box = new THREE.Box3().setFromObject(ex.model);
      assert(box.min.z < DECK.lip && box.max.z > DECK.lip - 1, `the hull does not straddle the lip: z ${box.min.z.toFixed(0)}..${box.max.z.toFixed(0)}`);
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      assert(span > 400, `the hull spans ${span.toFixed(0)} m — that does not dwarf a 160 m aperture`);
      /* Fly. */
      embarkCompany(world);
      const p = world.player;
      const st = world._deckFlight;
      assert(depart(world), 'depart refused');
      let t = 0;
      while (flightPhase(world) !== PHASE.OUT && t < 40) { step(world, 0.05, idle); t += 0.05; }
      assert(flightPhase(world) === PHASE.OUT, `never reached OUT (${flightPhase(world)})`);
      /* Three seconds out: doors open, the exterior on, the far plane raised. */
      for (let i = 0; i < 60; i++) step(world, 0.05, idle);
      const u = st.model?.userData;
      const cam = world.engine?.camera;
      assert(!u?.doorL || u.doorL.position.z > 1.9, `the doors are shut ${(u.doorL.position.z).toFixed(2)} three seconds out`);
      assert(ex.seen && ex.group.visible, 'the exterior is not shown with the eye past the lip');
      if (cam) assert(cam.far >= EXTERIOR_FAR, `far plane ${cam.far} with a 700 m hull behind you`);
      assert(p.riding, 'the player is not aboard');
      /* The end of the run: sealed, far out, and the deploy raised once. */
      let raised = 0;
      world.onDeckDeploy = () => { raised++; };
      while (flightPhase(world) !== PHASE.GONE && t < 80) { step(world, 0.05, idle); t += 0.05; }
      assert(raised === 1, `onDeckDeploy raised ${raised} times`);
      assert(!u?.doorL || u.doorL.position.z < 0.05, 'the bay is not sealed at the end of the run');
      const out = st.group.position.z - DECK.lip;
      assert(out > FLIGHT.outRange * 0.95, `only ${out.toFixed(0)} m out at the end of the run`);
      return `hull ${span.toFixed(0)} m across the lip; doors open to the last ${FLIGHT.outSeal} s; ${out.toFixed(0)} m out; far ${cam?.far}`;
    } finally { world.unload(); }
  });

  check('hub: a withdrawal climbs out of the atmosphere with you aboard, and ends in space', async () => {
    const X = await import('../../src/game/Extraction.js');
    const { bootWorld, idleInput, run: step } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'theline', level: 'geonosis', order: 'jedi', quality: 'low', instantSpawn: true },
      runSeed: 7,
    });
    try {
      const input = idleInput();
      step(world, 0.3, input);
      const p = world.player;
      const ground = world.terrain.height(p.position.x, p.position.z);
      let ended = null;
      world.onGameOver = (st) => { ended = st; };
      assert(world.withdraw(), 'the withdrawal refused');
      const X0 = world.extraction;
      /* Fly the whole thing. The ramp waits for him; `lastCall` pulls him
       * aboard, which is the shipped behaviour for a player who does not walk. */
      const seen = new Set();
      let t = 0;
      while (X0.active && t < 200) {
        step(world, 0.05, input); t += 0.05;
        if (X0.phase) seen.add(X0.phase);
      }
      assert(seen.has('away'),
        `the withdrawal never climbed out — phases: ${[...seen].join(', ')}`);
      assert(ended, 'the run never ended');
      assert(ended.ended === 'withdrew', `the run ended as ${ended.ended}`);
      /* THE TWO THINGS THE PLAYER REPORTED. He must not be standing on the
       * ground he left, and the sequence must have reached space. */
      const up = p.position.y - ground;
      assert(up > 800, `the run ended ${up.toFixed(0)} m above the ground — he fell out of the ship`);
      assert(p.riding, 'he was put down before the run ended');
      return `phases ${[...seen].join(' → ')}; ended at ${(up / 1000).toFixed(1)} km, still aboard`;
    } finally { world.unload?.(); }
  });

  check('hub: nothing in a flight can be skipped', async () => {
    const ex = await src('src/game/Extraction.js');
    const df = await src('src/game/DeckFlight.js');
    for (const [name, text] of [['Extraction.js', ex], ['DeckFlight.js', df]]) {
      const hits = [...text.matchAll(/act\??\.?\(\s*'jump'\s*\)/g)];
      assert(!hits.length, `${name} still reads the skip key ${hits.length} time(s)`);
    }
    /* AND THE REASON, so it is not put back: a skip key read as a HELD state
     * rather than an edge does not stop at its own sequence. One press during
     * the deck's fly-out ran on into the world built a moment later, where
     * the orbit and the entry read the same key the same way — three
     * sequences skipped across two worlds, which is the "you completely skip
     * entering the atmosphere and landing" the player saw. */
    assert(/NO SKIP/.test(ex) && /NO SKIP/.test(df), 'the reason is not written down');
    return 'no jump-to-skip in either flight';
  });

  check('hub: hiding the exterior gives the far plane back, never below the deck\'s own', async () => {
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const cam = world.engine?.camera;
      if (!cam) return 'no camera in this harness';
      const before = cam.far;
      setExteriorSeen(world, true);
      assert(cam.far >= EXTERIOR_FAR, `far ${cam.far}`);
      setExteriorSeen(world, false);
      assert(cam.far >= Math.min(before, 1008) && cam.far <= Math.max(before, 1008), `far came back as ${cam.far} (was ${before})`);
      return `far ${before} → ${EXTERIOR_FAR} → ${cam.far}`;
    } finally { world.unload(); }
  });
}
