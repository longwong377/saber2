/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE LIFT — how you arrive on the deck, and how you leave it for the menu
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's words, and they are the whole design:
 *
 *   "right now you just teleport in the front of the hangar when you spawn in
 *    but I want a very short solo elevator ride (it has windows where you see
 *    you're going either up or down at immense speeds like the ground you're
 *    covering is insane) anywhere after a short ride the elevator door opens
 *    and you have to actually walk out of the elevator and into the hangar
 *    (the elevator door closes and leaves)"
 *
 *   "maybe when you're in the hangar calling for an elevator and getting in
 *    the elevator and doing the ride takes you back to the main menu"
 *
 * ── WHAT IT IS ─────────────────────────────────────────────────────────────
 *
 * A car set into the bulkhead's own thickness, its floor the deck plate, its
 * doors on the deck side. The spawn is INSIDE it. For `RIDE.ride` seconds the
 * shaft streams past two windows — a rank of lit bars on each side, moving at
 * a speed that ramps up and back down, against a dark shaft wall — and then
 * the car stops with a bump, chimes, and the doors part. The player walks out
 * on his own feet; nothing moves him. When he is clear the doors close and the
 * car goes: the windows go dark, the call lamp goes red.
 *
 * To leave, he walks back to the doors and presses the deck's one interact
 * key. The lamp goes amber, the car arrives, the doors open; he steps in, the
 * doors close, the shaft streams the OTHER way, and `world.onDeckLeave` is
 * raised — which `main.js` answers with the menu.
 *
 * ── WHY THE CAR NEVER MOVES ────────────────────────────────────────────────
 *
 * The ride is entirely the windows. Moving a room the player is standing in
 * through a heightfield is a body falling out of it (see `Extraction`'s notes
 * on seats), and a lift that genuinely climbs 40 m needs 40 m of shaft over a
 * deck that has a ceiling. What sells a lift is the shaft going past, the
 * acceleration you feel in it, and the doors — so the bars move and the car
 * does not, and the player's whole body is the ordinary walking body on the
 * ordinary deck for every frame of it.
 *
 * ── WHERE THE SHAFT IS HIDDEN ──────────────────────────────────────────────
 *
 * Inside the bulkhead mass. The car's side walls are solid except for the
 * panes, the doors are solid when the shaft is moving, and the lobby recess
 * `Hangar.liftLobby` cuts is exactly one car wide — so from the deck there is
 * no line of sight into the shaft at any door state, and from the car there
 * is none out of it except through the panes. `tools/checks/decklift.mjs`
 * fires the rays that prove both.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio } from '../engine/Audio.js';
import { clamp, smoothstep } from '../engine/MathUtil.js';
import { deckMats } from './DeckKit.js';
/* `DECK`/`LIFT` are read inside functions only: Hangar.js imports this file,
 * so at evaluation time both are in the temporal dead zone. See the note over
 * `frame()` in DeckLife.js for the trap. */
import { DECK, LIFT } from './Hangar.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);

/**
 * THE TIMINGS. `ride` is the number that decides how the room is entered:
 * long enough to look out of a window and read the speed, short enough that
 * a player who has been here before is not made to wait. Both rides are the
 * same length; the one out is the same lift.
 */
export const RIDE = {
  /** Seconds before the bars start to move: the doors have just shut. */
  settle: 0.5,
  /** Seconds of shaft going past. */
  ride: 4.4,
  /** How long the doors take to open or close. */
  doors: 1.1,
  /** Seconds after the player is clear before the doors close behind him. */
  linger: 1.4,
  /** How long a called car takes to arrive. */
  arrive: 2.6,
  /** The shaft's cruising speed past the window, in metres a second. */
  speed: 46,
  /** How far from the doors the call key is listened for. */
  reach: 5.5,
};

/** The states, in the order a visit meets them. */
export const STATE = {
  RIDE: 'ride', STOP: 'stop', OPENING: 'opening', OUT: 'out', CLOSING: 'closing',
  AWAY: 'away', CALLED: 'called', ARRIVING: 'arriving', WAIT: 'wait', SEAL: 'seal',
  LEAVE: 'leave', GONE: 'gone',
};

/**
 * Build the car and start the ride. Call after `dressHangar` (the lobby it
 * sits in is the kit's) and before the first frame. Returns the state that
 * `stepDeckLift` reads, also hung on `world._deckLift`.
 *
 * @param opts.arrive   the ride is skipped and the doors open at once — a
 *                      player who came in on a ship is not in the lift.
 */
export function dressDeckLift(world, opts = {}) {
  const prev = world._deckLift;
  if (prev && prev.car?.parent) return prev;
  const M = deckMats(world._deckFaction);
  const L = LIFT;
  const cx = L.x, cz = L.z, hw = L.halfW, hd = L.halfD, H = L.height;
  const car = new THREE.Group();
  car.name = 'deck-lift';

  /* ── THE CAR. Walls with a pane cut into each side, a back wall with a
   * rail, a ceiling with its light, the floor plate's edge strip. Built as a
   * few meshes rather than through the kit because two of them move. */
  const mesh = (mat, w, h, d, x, y, z, parent = car) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const paneY0 = 1.05, paneY1 = 3.45;
  for (const s of [-1, 1]) {
    const x = cx + s * hw;
    mesh(M.hull, 0.24, paneY0, hd * 2, x, paneY0 / 2, cz);
    mesh(M.hull, 0.24, H - paneY1, hd * 2, x, (H + paneY1) / 2, cz);
    /* Pane posts, three, which is what makes the window read as a window. */
    for (const dz of [-hd + 0.12, 0, hd - 0.12]) mesh(M.hull, 0.26, paneY1 - paneY0, 0.24, x, (paneY0 + paneY1) / 2, cz + dz);
    /* The rail under the pane. */
    mesh(M.glowDim, 0.08, 0.08, hd * 2 - 0.4, x - s * 0.24, paneY0 + 0.06, cz);
  }
  mesh(M.hull, hw * 2 + 0.48, H, 0.24, cx, H / 2, cz - hd);
  mesh(M.glowDim, hw * 2 - 0.6, 0.08, 0.08, cx, 1.1, cz - hd + 0.16);
  mesh(M.hull, hw * 2 + 0.48, 0.24, hd * 2 + 0.48, cx, H + 0.12, cz);
  /* The ceiling light: unlit, so the car is the brightest box in the room
   * the moment the doors part — that is what a lit doorway on a dark deck is. */
  const lamp = mesh(M.glow, 1.6, 0.06, hd * 2 - 1.0, cx, H - 0.04, cz);
  /* AND A LIGHT IN THE CAR. The unlit strip is what you see; this is what it
   * does to the walls. The first frame of this room was a black box with a
   * pale strip on its lid, because the deck's lamps are twenty metres away
   * and the bulkhead is between them and the car. One point light, short
   * range, on the level's list so it goes with the level. */
  const glow = new THREE.PointLight(0xdbe6fb, 90, 12, 2);
  glow.position.set(cx, H - 0.5, cz);
  world.scene.add(glow);
  world.levelLights?.push(glow);
  /* The floor's edge strip, flush. */
  mesh(M.glowDim, hw * 2 - 0.3, 0.02, 0.10, cx, 0.02, cz + hd - 0.30);
  /* The panes: dark glass, transparent enough to see the shaft through. */
  const glass = new THREE.MeshBasicMaterial({ color: 0x0c1220, transparent: true, opacity: 0.32,
    depthWrite: false, side: THREE.DoubleSide });
  glass.userData.saberNoInk = true;
  const panes = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(hd * 2 - 0.3, paneY1 - paneY0);
    g.rotateY(s * Math.PI / 2);
    const p = new THREE.Mesh(g, glass);
    p.position.set(cx + s * (hw - 0.02), (paneY0 + paneY1) / 2, cz);
    car.add(p);
    panes.push(p);
  }

  /* ── THE SHAFT the panes look into. A dark wall a little outboard of each
   * pane, rails on it, and the bars that stream. All of it inside the
   * bulkhead's thickness, so nothing on the deck can see it. */
  const shaft = new THREE.Group();
  shaft.name = 'deck-lift-shaft';
  const SPAN = 48;
  for (const s of [-1, 1]) {
    mesh(M.deep, 0.3, SPAN + 12, hd * 2 + 1.2, cx + s * (hw + 2.4), 0, cz, shaft);
    mesh(M.hull, 0.6, SPAN + 12, 0.5, cx + s * (hw + 1.9), 0, cz - hd - 0.2, shaft);
    mesh(M.hull, 0.6, SPAN + 12, 0.5, cx + s * (hw + 1.9), 0, cz + hd + 0.2, shaft);
  }
  const N = 30;
  const barMat = new THREE.MeshBasicMaterial({ color: 0xbfd4ee, toneMapped: false });
  barMat.userData.saberNoInk = true;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.16, hd * 2 + 0.6), barMat, N * 2);
  bars.frustumCulled = false;
  bars.name = 'deck-lift-bars';
  shaft.add(bars);
  world.scene.add(car);
  world.scene.add(shaft);
  world.statics.push(car, shaft);

  /* ── THE DOORS. Two leaves that slide outboard. */
  const doors = [];
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.position.set(cx + s * hw / 2, 0, L.door + 0.14);
    mesh(M.hull, hw - 0.04, H, 0.26, 0, H / 2, 0, leaf);
    mesh(M.glowDim, 0.06, H - 0.6, 0.30, -s * (hw / 2 - 0.10), H / 2, 0, leaf);
    mesh(M.dark, hw - 0.6, 0.9, 0.30, 0, 1.2, 0, leaf);
    car.add(leaf);
    doors.push(leaf);
  }
  /* ── THE CALL LAMP on the lobby's panel, red while the car is away. */
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x3adf7a, toneMapped: false });
  lampMat.userData.saberNoInk = true;
  const call = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.12), lampMat);
  call.position.set(cx + hw + 1.6, 1.55, L.door + 0.68);
  car.add(call);

  /* ── THE COLLIDERS. The car's walls and roof are permanent; the door pair
   * is one box that exists only while the leaves are shut. */
  const P = world.physics;
  const q = new THREE.Quaternion();
  const solids = [];
  if (P?.addStaticBox) {
    const box = (x, y, z, hx, hy, hz) => P.addStaticBox(new THREE.Vector3(x, y, z),
      new THREE.Vector3(hx, hy, hz), q, { friction: 0.7 });
    for (const s of [-1, 1]) solids.push(box(cx + s * (hw + 0.12), H / 2, cz, 0.16, H / 2 + 0.2, hd + 0.3));
    solids.push(box(cx, H / 2, cz - hd - 0.12, hw + 0.4, H / 2 + 0.2, 0.16));
    solids.push(box(cx, H + 0.14, cz, hw + 0.4, 0.16, hd + 0.3));
  }

  const st = {
    car, shaft, bars, doors, panes, lamp, lampMat, call, solids,
    N, SPAN,
    /** 0 shut, 1 open. */
    open: 0,
    /** The shaft's speed past the window this frame, signed: + is the car
     *  going up. */
    v: 0,
    /** Where the bar rank is in its wrap, metres. */
    scroll: 0,
    state: opts.arrive ? STATE.OPENING : STATE.RIDE,
    t: 0,
    /** Set once the player has been told how to call the car. */
    told: false,
    /** True from the frame the leaving ride ends; `onDeckLeave` fires once. */
    left: false,
    doorBox: null,
    dir: 1,
  };
  world._deckLift = st;
  setDoors(world, st, opts.arrive ? 0 : 0);
  /* The doors start shut on a ride and the box goes with them. */
  if (!opts.arrive) shutDoors(world, st);
  layBars(st, 0);
  if (!opts.arrive) {
    /* The hum of a car in a shaft: a low band that lasts the ride. */
    audio.noise?.({ dur: RIDE.settle + RIDE.ride, gain: 0.09, type: 'lowpass', freq: 160, q: 0.6,
      pos: _v.set(cx, 1.6, cz) });
  }
  return st;
}

/** Put the door-pair collider in. */
function shutDoors(world, st) {
  if (st.doorBox || !world.physics?.addStaticBox) return;
  const L = LIFT;
  st.doorBox = world.physics.addStaticBox(new THREE.Vector3(L.x, L.height / 2, L.door + 0.14),
    new THREE.Vector3(L.halfW + 0.2, L.height / 2 + 0.2, 0.2), new THREE.Quaternion(), { friction: 0.6 });
}

/** …and take it out. */
function freeDoors(world, st) {
  if (!st.doorBox) return;
  world.physics?.removeStaticBox?.(st.doorBox);
  st.doorBox = null;
}

/** Slide the leaves to `k` (0 shut, 1 open). */
function setDoors(world, st, k) {
  st.open = clamp(k, 0, 1);
  const e = smoothstep(0, 1, st.open);
  const L = LIFT;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    st.doors[i].position.x = L.x + s * (L.halfW / 2 + e * (L.halfW + 0.4));
  }
}

/** Lay the bar rank at scroll `s`, wrapped over SPAN. */
function layBars(st, s) {
  const L = LIFT;
  const pitch = st.SPAN / st.N;
  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? -1 : 1;
    for (let i = 0; i < st.N; i++) {
      let y = ((i * pitch + s) % st.SPAN + st.SPAN) % st.SPAN - st.SPAN / 2;
      _v.set(L.x + sx * (L.halfW + 1.2), y + L.height / 2, L.z);
      st.bars.setMatrixAt(side * st.N + i, _m.compose(_v, _q.identity(), _s));
    }
  }
  st.bars.instanceMatrix.needsUpdate = true;
}

/** Is the player standing inside the car? */
function inCar(world) {
  const p = world.player?.position;
  if (!p) return false;
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW - 0.1 && p.z > L.z - L.halfD && p.z < L.door - 0.15;
}

/** Is the player near enough to the doors, on the deck side, to call the car? */
export function atTheDoors(world) {
  const p = world.player?.position;
  if (!p) return false;
  const L = LIFT;
  return Math.abs(p.x - L.x) < L.halfW + 2.5 && p.z > L.door - 0.2 && p.z < L.door + RIDE.reach;
}

/**
 * The deck's interact key, at the doors. Returns true when it was spent here,
 * so the caller (DeckEdit.focusKey) does not also try to pick a man.
 */
export function liftKey(world) {
  const st = world?._deckLift;
  if (!st || !atTheDoors(world)) return false;
  if (st.state === STATE.AWAY) {
    st.state = STATE.CALLED; st.t = 0;
    st.lampMat.color.setHex(0xffb347);
    world.notify?.('LIFT CALLED', 'the car is on its way');
    audio.tone?.({ freq: 660, freqEnd: 720, dur: 0.14, gain: 0.12, pos: _v.set(LIFT.x, 1.6, LIFT.door) });
    return true;
  }
  if (st.state === STATE.WAIT) {
    world.notify?.('STEP IN', 'the car takes you to the bridge');
    return true;
  }
  return false;
}

/** Whether the lift is currently the thing holding the player. For checks and the HUD. */
export function liftBusy(world) {
  const s = world?._deckLift?.state;
  return s === STATE.RIDE || s === STATE.STOP || s === STATE.SEAL || s === STATE.LEAVE;
}

/**
 * One frame. Allocates nothing.
 */
export function stepDeckLift(world, dt) {
  const st = world?._deckLift;
  if (!st || !(dt > 0) || !st.car?.parent) return;
  st.t += dt;
  const L = LIFT;
  const pos = _v.set(L.x, 1.6, L.z);

  switch (st.state) {
    case STATE.RIDE: {
      /* The speed profile: nothing while the doors settle, a hard ramp up, a
       * cruise, and a longer ramp down — a lift decelerates for longer than it
       * accelerates because the stop has to be gentle enough to stand
       * through. */
      const t = st.t - RIDE.settle;
      const T = RIDE.ride;
      let k = 0;
      if (t > 0) k = smoothstep(0, 0.9, t) * (1 - smoothstep(T - 1.4, T, t));
      st.v = st.dir * RIDE.speed * k;
      /* The shaft goes DOWN past the window when the car goes up. */
      st.scroll -= st.v * dt;
      layBars(st, st.scroll);
      /* The car's light dips under load on the way up, the way a real one does. */
      st.lampMat.color.setHex(0x3adf7a);
      if (t >= T) {
        st.state = STATE.STOP; st.t = 0; st.v = 0;
        audio.thud?.(pos, 0.5);
        world.player?.camera?.addShake?.(0.22);
        /* The chime: two notes, a fifth apart. */
        audio.tone?.({ freq: 784, dur: 0.16, gain: 0.14, pos });
        setTimeout(() => audio.tone?.({ freq: 1175, dur: 0.22, gain: 0.12, pos }), 170);
      }
      break;
    }
    case STATE.STOP: {
      if (st.t >= 0.55) {
        st.state = STATE.OPENING; st.t = 0;
        freeDoors(world, st);
        audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
        world.notify?.('THE FLIGHT DECK', 'walk out — your company is on the deck', 'flavour');
      }
      break;
    }
    case STATE.OPENING: {
      setDoors(world, st, st.t / RIDE.doors);
      if (st.t >= RIDE.doors) { setDoors(world, st, 1); st.state = STATE.OUT; st.t = 0; }
      break;
    }
    case STATE.OUT: {
      /* Doors open; waiting for him to be clear of the threshold. `t` is
       * reset while he stands in the car, so a player who lingers is not shut
       * in. */
      const p = world.player?.position;
      const clear = p && (p.z > L.door + 1.2 || Math.abs(p.x - L.x) > L.halfW + 1.0);
      if (!clear) st.t = 0;
      else if (st.t >= RIDE.linger) {
        st.state = STATE.CLOSING; st.t = 0;
        audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
      }
      break;
    }
    case STATE.CLOSING: {
      setDoors(world, st, 1 - st.t / RIDE.doors);
      if (st.t >= RIDE.doors) {
        setDoors(world, st, 0);
        shutDoors(world, st);
        st.state = STATE.AWAY; st.t = 0;
        /* The car goes: the lamp goes red and the shaft streams behind the
         * shut doors, which nobody can see and which is why the lamp is the
         * tell. */
        st.lampMat.color.setHex(0xff3418);
        audio.noise?.({ dur: 2.6, gain: 0.06, type: 'lowpass', freq: 150, q: 0.6, pos });
      }
      break;
    }
    case STATE.AWAY: {
      /* The shaft keeps moving for a while behind the doors, then rests. */
      st.v = st.t < 2.6 ? st.dir * RIDE.speed * smoothstep(0, 0.6, st.t) * (1 - smoothstep(1.8, 2.6, st.t)) : 0;
      st.scroll -= st.v * dt;
      if (st.v) layBars(st, st.scroll);
      /* Tell him once how to leave, when he first comes back to the doors. */
      if (!st.told && atTheDoors(world)) {
        st.told = true;
        world.notify?.('THE LIFT', 'inspect key at the doors calls the car — it takes you to the bridge');
      }
      break;
    }
    case STATE.CALLED: {
      if (st.t >= RIDE.arrive) {
        st.state = STATE.ARRIVING; st.t = 0;
        st.lampMat.color.setHex(0x3adf7a);
        audio.thud?.(pos, 0.35);
        audio.tone?.({ freq: 784, dur: 0.16, gain: 0.12, pos });
        freeDoors(world, st);
      } else {
        /* The car coming: the shaft streams the other way behind the doors. */
        st.v = -st.dir * RIDE.speed * smoothstep(0, 0.5, st.t) * (1 - smoothstep(RIDE.arrive - 1.0, RIDE.arrive, st.t));
        st.scroll -= st.v * dt;
        layBars(st, st.scroll);
      }
      break;
    }
    case STATE.ARRIVING: {
      setDoors(world, st, st.t / RIDE.doors);
      if (st.t >= RIDE.doors) { setDoors(world, st, 1); st.state = STATE.WAIT; st.t = 0; }
      break;
    }
    case STATE.WAIT: {
      if (inCar(world)) {
        if (st.t >= 0.6) {
          st.state = STATE.SEAL; st.t = 0;
          world.notify?.('TO THE BRIDGE', 'hold on');
          audio.noise?.({ dur: RIDE.doors, gain: 0.07, type: 'bandpass', freq: 420, q: 1.2, pos });
        }
      } else st.t = 0;
      break;
    }
    case STATE.SEAL: {
      setDoors(world, st, 1 - st.t / RIDE.doors);
      if (st.t >= RIDE.doors) {
        setDoors(world, st, 0);
        shutDoors(world, st);
        st.state = STATE.LEAVE; st.t = 0;
        audio.noise?.({ dur: RIDE.settle + RIDE.ride, gain: 0.09, type: 'lowpass', freq: 160, q: 0.6, pos });
      }
      break;
    }
    case STATE.LEAVE: {
      /* The same ride, the other way, and it ends on the menu rather than on
       * a door: main.js takes the world down under the streaming shaft. */
      const t = st.t - RIDE.settle;
      const T = RIDE.ride * 0.62;
      let k = 0;
      if (t > 0) k = smoothstep(0, 0.9, t);
      st.v = -st.dir * RIDE.speed * k;
      st.scroll -= st.v * dt;
      layBars(st, st.scroll);
      if (t >= T && !st.left) {
        st.left = true;
        st.state = STATE.GONE;
        world.onDeckLeave?.();
      }
      break;
    }
    default: break;
  }
}

/** The state name, for a HUD or a check. */
export function liftState(world) { return world?._deckLift?.state ?? null; }

/**
 * Tear the car down without waiting for `World.unload`: the meshes are on
 * `statics` and go with the level, but the door collider is a static box the
 * level does not know about.
 */
export function undressDeckLift(world) {
  const st = world?._deckLift;
  if (!st) return;
  freeDoors(world, st);
  for (const b of st.solids) world.physics?.removeStaticBox?.(b);
  st.solids.length = 0;
  world._deckLift = null;
}
