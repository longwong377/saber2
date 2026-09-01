/**
 * A COMMAND DIRECTOR WITH AN ARMY ON THE GROUND, SHARED.
 *
 * command.mjs's own fixture, lifted where a second suite needed it: bodies are
 * STUBS rather than real `Enemy`s on purpose, because what these checks are
 * about is the roster, the licences and the rules, and a real Enemy drags a
 * rig, a ragdoll, cloth and a physics body in for every one of ten troops to
 * measure a boolean.
 *
 * The stub carries exactly the fields the director touches, which is a useful
 * assertion in itself: a director that quietly started reading a fifteenth
 * field fails here rather than in a browser.
 */
import * as THREE from 'three';
import * as Cmd from '../../src/game/Command.js';
import { LEVELS } from '../../src/game/Levels.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A world with the fields the director reads, and stub bodies — command.mjs's
 * own fixture and its argument: what this file is about is the ROSTER and the
 * rules, and a real `Enemy` drags a rig, a ragdoll and cloth in for every one
 * of ten troops to measure a boolean.
 */
export function cmdWorld() {
  const w = {
    scene: new THREE.Scene(),
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, surfaceAt: () => 'sand', slopeAt: () => 0, flush() {},
      crater() { w.craters = (w.craters | 0) + 1; },
      inBounds: (x, z) => Math.hypot(x, z) < 200,
    },
    settings: {}, difficulty: null, hpScale: 1, dmgScale: 1, time: 0,
    players: [], enemies: [], statics: [], props: [], doors: [],
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {},
      addStaticBox() { return null; }, removeStaticBox() {}, raycast: () => null },
    level: LEVELS.geonosis, run: null, takenBoons: new Set(),
    notes: [],
    notify(a, b) { this.notes.push([a, b]); },
    report() {},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type];
      const e = {
        id: 'e' + (w._n = (w._n | 0) + 1), type, A, world: w, team: 1,
        position: pos.clone ? pos.clone() : V(pos.x, pos.y, pos.z),
        velocity: new THREE.Vector3(), dead: false, hp: A.hp, maxHp: A.hp,
        speed: A.speed, attackDamage: A.damage ?? 0, mod: null, rig: null,
        group: null, wish: null, toTarget: null, facing: 0,
        _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0,
        _prevPos: new THREE.Vector3(),
        burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
        _move() {}, damage(n) { this.hp -= n; return this.hp <= 0; }, _syncBody() {},
      };
      w.enemies.push(e);
      return e;
    },
  };
  return w;
}

/**
 * A deployed army with a body commanding it and its squad numbers stamped.
 *
 * ── AND THE MODE IS A PARAMETER, BECAUSE IT DECIDES THREE FLAGS ─────────
 *
 * `new CommandDirector(w, { pool })` passes no mode, so `this.mode` falls to
 * `'command'` and the director comes up with `holdTheLine`, `lineAdvances` and
 * `downedMen` all FALSE. Every suite that used this fixture was therefore
 * measuring Command, and one of them — `muster.mjs`'s survivors check — was
 * asserting about THE LINE: the `!e.downed` term in `recall` is the one clause
 * that is The Line's alone, and it was tested inside a director where nothing
 * can go down, against a `downed` boolean the check wrote onto a stub itself.
 * Delete the whole downed mechanic from `Enemy.js` and that check still passed.
 *
 * The default is unchanged, so every existing caller measures exactly what it
 * measured before. `army('theline')` is the door that was missing.
 *
 * @param {string} [mode] the mode the director is built for. Absent is
 *        `'command'`, which is what it has always been.
 */
export function army(mode = undefined) {
  const w = cmdWorld();
  const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool, ...(mode ? { mode } : {}) });
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0 };
  w.players.push(me);
  w.player = me;
  d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  return { w, d, me, c: d.commander };
}

