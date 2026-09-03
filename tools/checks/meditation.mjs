/**
 * BATTLEFRONT BORZ — the body that meditates.
 *
 * "at the start of this project I asked that when you use the holocron in
 * game you should sit cross legged and meditate as if you're connecting to
 * the force… I doubt the character is actually sitting on the floor cross
 * legged. Also you should be able to choose from a couple different
 * meditation poses in the Jedi customization screen."
 *
 * They doubted correctly: the commune was the crouch key held for a second,
 * so the figure crouched, and the Holocron opened over a Jedi in a half-squat.
 * What is measured here is the thing the sentence asks for, on the real rig
 * and the real Player:
 *
 *   · every pose in MEDITATION_POSES puts the built Jedi somewhere finite and
 *     DIFFERENT — feet, hands and head all move between any two of them — and
 *     the lotus's pelvis is on the floor rather than at hip height;
 *   · a live Player asked to sit sinks over MEDITATION_EASE and stands back
 *     up to the gait's own pelvis when asked to stand, with the walk intact;
 *   · the choice is a SETTING with the three things controls.mjs demands of
 *     one (a default, a reader, a control), it is personal on the wire, and
 *     the commune in main.js feeds it to the body on both sides of the world
 *     stopping;
 *   · the Holocron over a live world leaves the frame's left third clear and
 *     the camera pulls back to put the body in it, and gives the frame back.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { buildJedi } from '../../src/game/Bodies.js';
import { standPreviewFigure, DEFAULT_SETTINGS, SETTING_READERS } from '../../src/ui/Menu.js';
import { MEDITATION_POSES, meditationPose, poseMeditation } from '../../src/game/Rig.js';
import { CameraRig, MEDITATION_EASE } from '../../src/game/Player.js';
import { LOCAL_KEYS } from '../../src/net/Net.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');
const JOINTS = ['hips', 'head', 'footL', 'footR', 'handL', 'handR'];

/** A built Jedi, stood up on y = 0 by the game's own solver. */
function figure() {
  const built = buildJedi({ scale: 1 });
  const scene = new THREE.Scene();
  scene.add(built.rig.root);
  standPreviewFigure(built.rig);
  return built.rig;
}
const joints = (rig) => {
  const out = {};
  for (const j of JOINTS) out[j] = rig.worldPos(j, new THREE.Vector3());
  out.crown = rig.tipPos('head', new THREE.Vector3());
  return out;
};
const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

export async function run({ check, assert }) {
  check('meditation: every pose is a different, finite body, and the lotus sits on the floor', () => {
    assert(MEDITATION_POSES.length >= 4, `${MEDITATION_POSES.length} poses — the player asked for the three named and "any others"`);
    for (const id of ['lotus', 'kneel', 'pray']) {
      assert(MEDITATION_POSES.some((p) => p.id === id), `the player asked for '${id}' by description and it is not in the table`);
    }
    const rig = figure();
    const stand = joints(rig);
    const got = new Map();
    for (const P of MEDITATION_POSES) {
      standPreviewFigure(rig);
      const used = poseMeditation(rig, P.id, 1, { position: new THREE.Vector3(), facing: 0, time: 0.4 });
      assert(used.id === P.id, `asked for ${P.id}, posed ${used.id}`);
      const J = joints(rig);
      for (const [k, v] of Object.entries(J)) {
        assert(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `${P.id}: ${k} is ${fmt(v)}`);
      }
      /* Every pose is a pose: the hands are somewhere the standing figure's
       * are not. The feet and the head too, except for the one pose that
       * stands — whose feet stay under it by design and whose HANDS are the
       * whole of it. */
      const moved = (a, b) => a.distanceTo(b) > 0.08;
      assert(moved(J.handL, stand.handL) && moved(J.handR, stand.handR), `${P.id} leaves the hands where the gait had them`);
      if (P.id !== 'pray') {
        assert(moved(J.head, stand.head), `${P.id} leaves the head at standing height`);
        assert(moved(J.footL, stand.footL) || moved(J.footR, stand.footR), `${P.id} leaves both feet in the stance`);
      }
      got.set(P.id, J);
    }
    /* …and different from EACH OTHER: two ids that produce one body are one
     * card the player was offered twice. */
    const ids = [...got.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = got.get(ids[i]), B = got.get(ids[j]);
        const apart = JOINTS.filter((k) => A[k].distanceTo(B[k]) > 0.05);
        assert(apart.length >= 2, `${ids[i]} and ${ids[j]} differ in ${apart.length} joint(s) — the same pose under two names`);
      }
    }
    const L = got.get('lotus'), K = got.get('kneel'), Pr = got.get('pray'), F = got.get('float');
    assert(L.hips.y < 0.35, `the lotus's pelvis is ${L.hips.y.toFixed(2)} m up — that is not sitting on the floor`);
    assert(L.footL.z > 0.1 && L.footR.z > 0.1 && Math.sign(L.footL.x) !== Math.sign(stand.footL.x),
      `the lotus's feet are at ${fmt(L.footL)} / ${fmt(L.footR)} — not crossed in front`);
    assert(K.footR.y < 0.12 && K.footR.z < -0.3 && K.hips.y > 0.35 && K.hips.y < 0.6,
      `the kneel's hips are ${K.hips.y.toFixed(2)} up over a back foot at ${fmt(K.footR)}`);
    assert(K.head.y < stand.head.y - 0.4, 'the kneel does not bow the head');
    assert(Pr.handL.y > stand.crown.y && Pr.handR.y > stand.crown.y && Pr.handL.distanceTo(Pr.handR) < 0.12,
      `the prayer's hands are at ${fmt(Pr.handL)} / ${fmt(Pr.handR)} — not joined above the head`);
    assert(Math.abs(Pr.hips.y - stand.hips.y) < 0.03, 'the prayer does not stay standing');
    if (F) assert(F.hips.y > L.hips.y + 0.12 && F.footL.y > 0.15, `levitation hovers at ${F.hips.y.toFixed(2)} against the lotus's ${L.hips.y.toFixed(2)}`);
    return MEDITATION_POSES.map((P) => {
      const J = got.get(P.id);
      return `${P.id}: hips ${J.hips.y.toFixed(2)} hands ${J.handL.y.toFixed(2)} crown ${J.crown.y.toFixed(2)}`;
    }).join(' · ');
  });

  check('meditation: the blend is a real ease — half way is half way, and zero touches nothing', () => {
    const rig = figure();
    const stand = joints(rig);
    poseMeditation(rig, 'lotus', 0, { position: new THREE.Vector3(), facing: 0 });
    const zero = joints(rig);
    for (const k of JOINTS) assert(zero[k].distanceTo(stand[k]) < 1e-6, `blend 0 moved ${k}`);
    poseMeditation(rig, 'lotus', 1, { position: new THREE.Vector3(), facing: 0 });
    const full = joints(rig);
    standPreviewFigure(rig);
    poseMeditation(rig, 'lotus', 0.5, { position: new THREE.Vector3(), facing: 0 });
    const half = joints(rig);
    const y = half.hips.y, lo = Math.min(stand.hips.y, full.hips.y), hi = Math.max(stand.hips.y, full.hips.y);
    assert(y > lo + 0.1 && y < hi - 0.1, `at blend 0.5 the pelvis is at ${y.toFixed(2)}, between ${lo.toFixed(2)} and ${hi.toFixed(2)}`);
    /* And facing: the same pose turned a quarter turn is the same pose. */
    standPreviewFigure(rig);
    poseMeditation(rig, 'kneel', 1, { position: new THREE.Vector3(3, 0, -2), facing: Math.PI / 2 });
    const turned = joints(rig);
    assert(turned.hips.distanceTo(new THREE.Vector3(3, 0, -2)) < 0.7, `posed at (3,0,-2) the pelvis is at ${fmt(turned.hips)}`);
    assert(turned.footL.x - 3 > 0.2, `facing +x the kneel's front foot is at ${fmt(turned.footL)} — the pose did not turn`);
    return `stand ${stand.hips.y.toFixed(2)} → half ${y.toFixed(2)} → lotus ${full.hips.y.toFixed(2)}; turned pelvis at ${fmt(turned.hips)}`;
  });

  check('meditation: a live Player sits down over the ease, and stands back up into the gait', async () => {
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const input = H.idleInput();
    const p = world.player;
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);
    const hips = () => p.rig.worldPos('hips', new THREE.Vector3()).y - p.position.y;
    const standing = hips();
    p.setMeditation(1, 'lotus');
    assert(p.meditating === 0, 'asking to sit posed the body before a frame ran');
    let frames = 0;
    const trace = [];
    while (p.meditating < 1 && frames < 200) { world.update(1 / 60, input); frames++; if (frames % 6 === 0) trace.push(hips().toFixed(2)); }
    const t = frames / 60;
    assert(Math.abs(t - MEDITATION_EASE) < 0.06, `the body took ${t.toFixed(2)} s to sit against MEDITATION_EASE = ${MEDITATION_EASE}`);
    const seated = hips();
    assert(seated < 0.35, `seated, the pelvis is ${seated.toFixed(2)} above the feet`);
    /* Under a stopped world the frame comes from `meditateFrame`. */
    world.paused = true;
    for (let i = 0; i < 30; i++) p.meditateFrame(1 / 60, world.time + i / 60);
    const still = hips();
    assert(Math.abs(still - seated) < 0.05 && Number.isFinite(still), `under the Holocron the pelvis drifted ${seated.toFixed(2)} → ${still.toFixed(2)}`);
    world.paused = false;
    /* And up again. */
    p.setMeditation(0);
    frames = 0;
    while (p.meditating > 0 && frames < 200) { world.update(1 / 60, input); frames++; }
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    const back = hips();
    assert(Math.abs(back - standing) < 0.06, `stood up, the pelvis is ${back.toFixed(2)} against ${standing.toFixed(2)} before`);
    /* The gait still walks: push forward for a second and the body moves. */
    const x0 = p.position.clone();
    const walk = { ...input, moveAxis: (o) => { o.x = 0; o.y = 1; return o; } };
    for (let i = 0; i < 60; i++) world.update(1 / 60, walk);
    const went = p.position.distanceTo(x0);
    assert(went > 0.8, `after the meditation a second of walking moved the body ${went.toFixed(2)} m`);
    assert(Number.isFinite(hips()), 'the gait came back with a NaN in it');
    return `stand ${standing.toFixed(2)} → seated ${seated.toFixed(2)} in ${t.toFixed(2)} s (${trace.join(' ')}) → back ${back.toFixed(2)}, walked ${went.toFixed(1)} m`;
  });

  check('meditation: the pose is a setting with a default, a reader, a control, and it stays on your own machine', async () => {
    const d = DEFAULT_SETTINGS.meditation;
    assert(typeof d === 'string' && MEDITATION_POSES.some((p) => p.id === d), `the default '${d}' is not a pose`);
    assert(meditationPose('no-such-pose').id === MEDITATION_POSES[0].id, 'an unknown id does not fall back to the first pose');
    assert(SETTING_READERS.meditation, 'no reader declared');
    const [file, expr] = SETTING_READERS.meditation;
    assert((await read('src/' + file)).includes(expr), `${file} does not read ${expr}`);
    assert(LOCAL_KEYS.meditation, 'the pose is not in Net.LOCAL_KEYS — a host could sit everybody down');
    const menu = await read('src/ui/Menu.js');
    assert(/_cardRow\('meditation-list',\s*'h-meditation',\s*'meditation',\s*MEDITATION_POSES/.test(menu),
      'the Jedi tab has no pose row off MEDITATION_POSES');
    const html = await read('index.play.html');
    assert(html.includes('id="meditation-list"') && html.includes('id="h-meditation"'), 'the row has no markup');
    assert(/_previewMeditation\(/.test(menu) && /s\.pose\)\s*poseMeditation\(/.test(menu),
      'the preview does not take the pose while a card is hovered');
    /* The commune feeds it to the body — on both sides of the world stopping. */
    const main = await read('src/main.js');
    assert(/setMeditation\(1,\s*settings\.meditation\)/.test(main), 'the open Holocron never asks the body to sit');
    assert(/meditateFrame\(dt/.test(main), 'the seated body gets no frame while the world is stopped');
    assert(/setMeditation\(0\)/.test(main), 'closing the Holocron never asks the body to stand');
    assert(/communePrompt\.charge \/ COMMUNE\.hold/.test(main) && /driveMeditation\(dt,\s*clamp\(/.test(main),
      'the hold does not ease the body down with the ring');
    return `default '${d}', read in ${file}, card row + hover preview, LOCAL_KEYS: "${LOCAL_KEYS.meditation}"`;
  });

  check('meditation: over a live world the Holocron leaves the body\'s third clear, and the camera goes to it', async () => {
    const css = await read('styles.css');
    const dock = /#meditation\.over-world\{[^}]*justify-content:flex-end/.test(css);
    const width = /#meditation\.over-world \.med-wrap\{[^}]*width:min\((\d+)px,\s*(\d+)vw\)/.exec(css);
    assert(dock, 'over the world the Holocron is still centred on the frame — the body is behind it');
    assert(width && Number(width[2]) <= 70, `the docked Holocron is ${width ? width[2] + 'vw' : 'unbounded'} wide — nothing of the frame is left`);
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
    const rig = new CameraRig(cam);
    const before = { d: rig.targetDistance, h: rig.height, sh: rig.shoulder, yaw: rig.yaw, pitch: rig.pitch };
    rig.firstPerson = true;
    rig.beginMeditationShot();
    assert(!rig.firstPerson, 'the shot stayed inside the head');
    assert(rig.targetDistance > before.d + 0.8, `the boom went ${before.d} → ${rig.targetDistance}`);
    assert(rig.shoulder > before.sh + 0.5, `the shoulder offset went ${before.sh} → ${rig.shoulder} — the body sits under the panel`);
    const target = new THREE.Vector3();
    for (let i = 0; i < 120; i++) rig.update(1 / 60, target, {});
    const drift = Math.abs(rig.yaw - before.yaw), boom = rig.distance;
    assert(drift > 0.3, `two seconds in, the yaw has drifted ${drift.toFixed(2)} rad — the shot is over the shoulder`);
    assert(boom > before.d + 0.8, `the boom is at ${boom.toFixed(2)}`);
    rig.endMeditationShot();
    assert(rig.targetDistance === before.d && rig.height === before.h && rig.shoulder === before.sh
      && rig.yaw === before.yaw && rig.pitch === before.pitch && rig.firstPerson === true,
      'ending the shot did not give every number back');
    assert(rig.endMeditationShot() === false, 'ending twice is not idempotent');
    return `docked right at ≤${width[2]}vw; boom ${before.d} → ${boom.toFixed(2)}, yaw +${drift.toFixed(2)} rad, all restored`;
  });
}
