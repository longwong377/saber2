/**
 * BATTLEFRONT BORZ — blaster bolts.
 *
 * Bolts are swept segments, not points: every frame each bolt is tested as the
 * line it actually travelled, against the quad each blade actually swept. That
 * is what makes deflection honest — a fast blade and a fast bolt cannot pass
 * through each other because neither is ever sampled as a snapshot.
 */

import * as THREE from 'three';
import { segmentSegment } from '../physics/Physics.js';
import { clamp, lerp, makeRng } from '../engine/MathUtil.js';
import { depthAlong, OPAQUE, SCATTER } from './Smoke.js';

const rng = makeRng(606);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
// The zone solve runs INSIDE guardIntercept, whose `out` is usually one of the
// vectors above — so it gets its own, or it would overwrite the very point it
// is deciding about.
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
/* The screen's contact, kept apart from `_v4`: `guardIntercept` is asked
 * AFTER the screen on the same bolt and writes its own answer into `_v4`,
 * so a shared scratch would hand the screen the guard's point on every
 * bolt that reached both. */
const _screenPt = new THREE.Vector3();
const _gA = new THREE.Vector3(), _gB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const BOLT_COLORS = {
  red:   0xff2a18,
  green: 0x4dff2a,
  blue:  0x35b0ff,
  gold:  0xffb020,
  white: 0xf0f4ff,
};

export class BoltPool {
  constructor(scene, max = 420) {
    this.max = max;
    this.bolts = [];
    for (let i = 0; i < max; i++) {
      this.bolts.push({
        active: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(),
        vel: new THREE.Vector3(), color: new THREE.Color(), life: 0, damage: 10,
        owner: null, team: 1, deflected: false, turned: false, deflector: null, speed: 90,
        // Fired off the wire rather than by anything on this machine. See
        // `World._spawnNetBolts` and the billing rule in `World._boltHurt`.
        replicated: false,
        length: 1.1, radius: 0.05, homing: 0, target: null, big: false,
        // How much cloud this bolt has crossed so far. See the smoke block in
        // update(): optical depth accumulates along a path and so does this.
        smokeDepth: 0,
        // While `held` the bolt is stuck to a blade: it does not fly, does not
        // hit anything, and does not age. See update().
        held: null, heldT: 0,
        // Stamped by the directional guard on the frame it answers this bolt,
        // and read by Combat.captureSnapshot. It rides on the BOLT rather than
        // on the hit descriptor because World rebuilds that descriptor from
        // three fields on its way to the snapshot, and a parry that lost its
        // flag in transit would grade as an ordinary block.
        guardZone: null,
      });
    }
    this.head = 0;

    const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
    geo.rotateX(Math.PI / 2);       // along +Z
    // vertexColors turns on USE_COLOR, which multiplies by a `color` attribute
    // before instanceColor is applied — without it every bolt renders black.
    geo.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, opacity: 1,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    // soft halo around each bolt
    const hgeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    hgeo.rotateX(Math.PI / 2);
    const hmat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        attribute vec3 instanceColorH;
        void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz);
          vC = instanceColorH; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(vC * f * 0.9, f * 0.55); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.halo = new THREE.InstancedMesh(hgeo, hmat, max);
    this.halo.geometry.setAttribute('instanceColorH',
      new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.frustumCulled = false;
    this.halo.count = 0;
    scene.add(this.halo);

    this.onDeflect = null;
    this.onImpact = null;
  }

  fire(origin, dir, opts = {}) {
    let b = null;
    for (let i = 0; i < this.max; i++) {
      const c = this.bolts[(this.head + i) % this.max];
      if (!c.active) { b = c; this.head = (this.head + i + 1) % this.max; break; }
    }
    if (!b) return null;
    b.active = true;
    b.smokeDepth = 0;
    b.pos.copy(origin); b.prev.copy(origin);
    b.speed = opts.speed ?? 88;
    b.vel.copy(dir).normalize().multiplyScalar(b.speed);
    b.color.set(opts.color ?? BOLT_COLORS.red);
    b.life = opts.life ?? 3.2;
    b.damage = opts.damage ?? 11;
    b.owner = opts.owner ?? null;
    b.team = opts.team ?? 1;
    b.deflected = false;
    // Fired by a mind that is not its owner's. See Player.forceCompel and the
    // friendly-fire branch in World._boltHitTest.
    b.turned = !!opts.turned;
    /**
     * SOMEBODY ELSE'S MACHINE ALREADY FIRED THIS ONE.
     *
     * Reset here rather than only set at the one call site that raises it,
     * because a bolt is a POOLED object: `deflected` is cleared two lines up
     * for exactly this reason, and a flag that survived into the next shot out
     * of the same slot would tell `World._boltHurt` that a local trooper's
     * round belongs to the host.
     */
    b.replicated = !!opts.replicated;
    b.deflector = null;
    b.big = !!opts.big;
    b.length = opts.length ?? (b.big ? 2.0 : 1.15);
    b.radius = opts.radius ?? (b.big ? 0.085 : 0.05);
    b.homing = opts.homing ?? 0;
    b.target = opts.target ?? null;
    b.held = null; b.heldT = 0;
    b.guardZone = null;
    return b;
  }

  /**
   * Arrest a bolt on a blade. It stops dead where it was caught and rides the
   * blade until it is thrown — which is what buys the player the 250 ms in
   * which the camera is theirs again.
   *
   * `bladeT` is where along the blade it stuck; `radial` is the small offset
   * out from the blade axis that keeps a stack of three from occupying the
   * same cubic centimetre.
   */
  hold(bolt, saber, bladeT, radial = null) {
    // Keep the direction it was travelling: a caught bolt points the way it
    // came in, arrested, rather than picking a fresh orientation out of the air.
    const dir = new THREE.Vector3().copy(bolt.vel);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1); else dir.normalize();
    bolt.held = {
      saber, dir, bladeT: clamp(bladeT, 0.05, 0.98),
      radial: radial ? radial.clone() : new THREE.Vector3(),
    };
    bolt.heldT = 0;
    bolt.vel.set(0, 0, 0);
    return bolt;
  }

  /** Let go: the bolt becomes a live projectile again, aimed by the caller. */
  release(bolt, dir, speed) {
    bolt.held = null;
    bolt.heldT = 0;
    bolt.guardZone = null;      // a bolt leaving the blade is a fresh projectile
    bolt.vel.copy(dir).normalize().multiplyScalar(speed);
    bolt.prev.copy(bolt.pos);
    return bolt;
  }

  /**
   * @param ctx.blades   [{ saber, owner, team }]
   * @param ctx.hitTest  (bolt, from, to) => { point, normal, victim, bone, t } | null
   */
  update(dt, ctx) {
    let n = 0;
    const colors = this.mesh.instanceColor.array;
    const hcolors = this.halo.geometry.attributes.instanceColorH.array;

    for (const b of this.bolts) {
      if (!b.active) continue;

      // ── caught: pinned to the blade, inert, and drawn as something held
      if (b.held) {
        const sab = b.held.saber;
        // A blade that goes out drops what it was carrying, and a bolt with no
        // blade under it is gone — not left hanging in the air at zero velocity.
        if (!sab || sab.ignition < 0.4) { b.held = null; b.active = false; continue; }
        b.heldT += dt;
        sab.pointAt(b.held.bladeT, b.pos).add(b.held.radial);
        b.prev.copy(b.pos);
        // A caught bolt does NOT age. The catch window owns its lifetime, and a
        // bolt evaporating out of the player's blade mid-hold would look like
        // the game dropping it.
        if (n < this.max) n = this._drawHeld(b, n, colors, hcolors);
        continue;
      }

      b.life -= dt;
      if (b.life <= 0) { b.active = false; continue; }

      b.prev.copy(b.pos);
      if (b.homing > 0 && b.target) {
        _v1.subVectors(b.target, b.pos).normalize();
        b.vel.lerp(_v1.multiplyScalar(b.speed), clamp(b.homing * dt, 0, 1)).setLength(b.speed);
      }
      b.pos.addScaledVector(b.vel, dt);

      /**
       * ── THROUGH THE SMOKE, and it happens before anything can be hit.
       *
       * A blaster bolt is a plasma packet and smoke degrades it rather than
       * stopping it, so what this reads is the optical depth of the cloud the
       * bolt's own path just crossed — see src/game/Smoke.js, which owns the
       * model so that a shooter deciding whether it can SEE a target and a
       * bolt deciding what it is worth on ARRIVAL cannot answer out of two.
       *
       * Three effects and each is doing a different job. It loses damage, so
       * cover is cover. It is deflected, because a bolt that arrived on target
       * for three points would still be a HIT, and not being hit is most of
       * what the player laid the smoke for. And past `OPAQUE` it is absorbed
       * outright, which is what makes a thick bank a wall rather than a tax.
       *
       * Nothing here asks who fired: the player standing in their own smoke is
       * exactly as hard to hit as the line shooting into it, which is the only
       * version of this that is a decision rather than a free win.
       */
      if (b.damage > 0) {
        const depth = depthAlong(b.prev, b.pos);
        if (depth > 0) {
          /* DEPTH IS CUMULATIVE ALONG THE PATH and the absorption test has to
           * be too. A bolt at 90 m/s crosses 1.5 m in a frame, which is 0.24 of
           * depth through a full bank — so a per-frame test against `OPAQUE`
           * could never fire at any speed a blaster actually shoots, and the
           * thick middle of a smoke screen would have been a 93% tax rather
           * than a wall. The damage term was already right by construction,
           * because multiplying exp(-d) frame by frame is exp(-sum). */
          b.smokeDepth += depth;
          if (b.smokeDepth >= OPAQUE) { b.active = false; continue; }
          const k = Math.exp(-depth);
          b.damage *= k;
          /* Scattered about an axis perpendicular to travel, picked off the
           * bolt's own position so a stream through one cloud sprays rather
           * than all bending the same way — and without touching the shared
           * RNG, which the wave director's reproducibility depends on. */
          const a = (b.pos.x * 12.9898 + b.pos.z * 78.233) % 6.2831853;
          _v1.set(Math.cos(a), 0.35, Math.sin(a)).cross(b.vel).normalize();
          if (_v1.lengthSq() > 0.5) b.vel.applyAxisAngle(_v1, depth * SCATTER);
        }
      }

      // ── blades first: a deflection has to beat a body hit
      let consumed = false;
      if (ctx.blades) {
        for (const entry of ctx.blades) {
          const sab = entry.saber;
          if (!sab || sab.ignition < 0.6) continue;
          if (b.deflector === entry.owner && b.deflected) continue;
          const hit = intersectBladeSweep(b.prev, b.pos, sab, _v4);
          if (hit) {
            if (this.onDeflect) this.onDeflect(b, entry, hit, _v4.clone());
            consumed = true;
            break;
          }
          // ── the guards this blade is holding. Two of them, and they are
          // different animals.
          //
          //   the DIRECTIONAL ZONE the player is choosing right now, which
          //   travels with them and turns with them, and
          //
          //   the auto-guard CONE a successful deflect opened behind them,
          //   which stays pointing down the line the last bolt came in on
          //   precisely so that it keeps covering you while you look away.
          //
          /* ── THE SCREEN IS ASKED BEFORE THE SIDE TEST, AND THAT IS THE
           * WHOLE OF WHAT IT IS FOR ─────────────────────────────────────
           *
           * The two guards below are hostile-only, and rightly: they answer
           * fire aimed at the man holding the blade, and your own returns must
           * be free to leave. The screen answers fire aimed at somebody ELSE
           * on your side, and there a bolt is a bolt.
           *
           * MEASURED, and it is the reason this line moved. One Command
           * battle on Geonosis, seed 3, 150 game-seconds, every hit on a body
           * of the player's own side counted at `_boltHitTest` with the
           * owner's team read off the bolt: **47 hits, 569.8 damage, and every
           * single one of them fired by a body on the player's OWN team.** Not
           * one hostile bolt reached a trooper. The seven men FLAGSHIP §7's
           * whole argument is about are killed by their own line, because a
           * Jedi standing in a rank is what brings the horde in among it and
           * a rank firing into a melee fires through its own men.
           *
           * So a screen that only answered hostile fire would have answered
           * none of the fire that was killing anybody. `screenIntercept`'s
           * third gate is what keeps this honest — the bolt has to be going
           * INTO one of his men — so a trooper firing outward is untouched and
           * only the crossfire is caught.
           */
          let screenAt = 0;
          if (entry.screen && !(b.deflected && b.deflector === entry.owner)) {
            screenAt = screenIntercept(b.prev, b.pos, entry.screen, _screenPt);
          }
          // Hostile bolts only — your own returns must be free to leave.
          const hostile = b.team !== entry.team;
          if (!screenAt && !hostile) continue;
          // The controller is reached through the owner rather than handed in,
          // so no caller has to remember to publish it and an owner without one
          // (every enemy) simply has no zone.
          const zone = entry.owner && entry.owner.control ? entry.owner.control.guard : null;
          let g = null;
          /* THE TWO GUARDS ARE NOT ASKED ABOUT A FRIENDLY BOLT AT ALL, and a
           * version that let them answer one would be worse than a no-op:
           * `_onBoltDeflect` stands down on "already ours" and returns, but
           * `consumed` is set for the frame by then — so the bolt phases
           * through the guard AND skips its own hit test. That is the exact
           * defect the note over that early return records having found in
           * PvP, and reaching this block with a same-side bolt is a new way
           * into it. */
          if (hostile) {
            if (zone && zone.active && guardIntercept(b.prev, b.pos, zone, _v4)) g = zone;
            else if (entry.guard && guardIntercept(b.prev, b.pos, entry.guard, _v4)) g = entry.guard;
          }
          /* THE ORDINARY GUARDS WIN. A contact the blade could actually have
           * met is met, and billed on the ordinary ladder; the screen is only
           * the answer for a bolt that was never coming here at all.
           * `entry.screen` is absent for every blade whose owner has no bar to
           * pay with — see World._bladeEntries — which is what keeps this from
           * being a free aura round every enemy duellist on the field. */
          if (g) screenAt = 0;
          else if (!screenAt) continue;
          else _v4.copy(_screenPt);
          /* `auto` is FALSE for a screen and that is not a detail: the
           * auto-guard cone answers off a parked blade by design, and a screen
           * that inherited that would grade every contact a DEFLECT whatever
           * the player was doing. A screened bolt earns its rung the ordinary
           * way, off `driven`. */
          let bladeT = 0.55, auto = !screenAt;
          _gA.copy(_v4);
          if (g === zone) {
            // Report the contact ON THE BLADE, not out on the guard sphere. The
            // sphere is where the RULE fired; the blade is where the player is
            // looking, and everything downstream — the spark, the surface
            // normal, the origin of the return — is measured off `point`. A
            // block that happens half a metre from the weapon does not read as
            // a block, which is the one thing tools/motion.mjs can see.
            const res = segmentSegment(b.prev, b.pos, sab.base, sab.tip, _gB, _gA);
            bladeT = clamp(res.t, 0.08, 0.96);
            // A PARRY is the only thing here that is caught rather than
            // scattered: `auto` is the flag captureSnapshot reads to say the
            // contact was answered rather than merely met.
            auto = !!zone.parry;
            b.guardZone = { zone: zone.zone, parry: auto, age: zone.parryAge ?? 0 };
          } else b.guardZone = null;
          if (this.onDeflect) {
            this.onDeflect(b, entry, { bladeT, point: _gA.clone(), auto, screen: screenAt }, _gA.clone());
          }
          // The stamp lives for exactly one callback and not a frame longer.
          // captureSnapshot reads it synchronously inside onDeflect and copies
          // what it needs into the snapshot, which is what survives to the
          // throw. Leaving it on the bolt would be a live parry flag riding a
          // bolt that is now on YOUR team and heading for an enemy blade — and
          // that blade's own captureSnapshot would read it and be handed a free
          // RETURN off a guard it never held.
          b.guardZone = null;
          consumed = true;
          break;
        }
      }
      if (!b.active) continue;
      // Caught THIS frame: draw it held straight away. Falling through to the
      // ordinary draw would point it along a velocity that is now zero, and
      // skipping the draw would blink it out for a frame at the exact moment
      // the player is meant to see it stick.
      if (b.held) {
        if (n < this.max) n = this._drawHeld(b, n, colors, hcolors);
        continue;
      }

      // ── world / bodies (a bolt that just turned on a blade gets this frame free)
      if (!consumed && ctx.hitTest) {
        const res = ctx.hitTest(b, b.prev, b.pos);
        if (res) {
          if (this.onImpact) this.onImpact(b, res);
          b.active = false;
          continue;
        }
      }

      if (!b.active) continue;
      if (b.pos.lengthSq() > 900 * 900) { b.active = false; continue; }

      // ── draw
      if (n < this.max) {
        _v1.copy(b.vel).normalize();
        _q.setFromUnitVectors(_v3.set(0, 0, 1), _v1);
        _s.set(b.radius, b.radius, b.length);
        _m.compose(b.pos, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        colors[n * 3] = b.color.r * 3.2; colors[n * 3 + 1] = b.color.g * 3.2; colors[n * 3 + 2] = b.color.b * 3.2;
        _s.set(b.radius * 3.4, b.radius * 3.4, b.length * 1.25);
        _m.compose(b.pos, _q, _s);
        this.halo.setMatrixAt(n, _m);
        hcolors[n * 3] = b.color.r; hcolors[n * 3 + 1] = b.color.g; hcolors[n * 3 + 2] = b.color.b;
        n++;
      }
    }

    this.mesh.count = n;
    this.halo.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    this.halo.geometry.attributes.instanceColorH.needsUpdate = true;
  }

  /**
   * A caught bolt, drawn as something arrested rather than something flying.
   *
   * Three readable differences from a live bolt: it is a third of the length
   * (it has stopped, so it has no streak), it is fatter, and it breathes at
   * 22 Hz — fast enough to read as electrical crackle at 60 fps rather than as
   * a slow pulse. Colour is pushed toward white on the peaks, which is what
   * separates "held on the blade" from "sitting next to the blade".
   */
  _drawHeld(b, n, colors, hcolors) {
    const crackle = 0.5 + 0.5 * Math.sin(b.heldT * 138);      // 22 Hz
    const grip = clamp(b.heldT / 0.05, 0, 1);                 // snap-to over 50 ms
    _q.setFromUnitVectors(_v3.set(0, 0, 1), b.held.dir);
    const len = b.length * lerp(1, 0.34, grip);
    const rad = b.radius * (1.6 + crackle * 0.5);
    _s.set(rad, rad, len);
    _m.compose(b.pos, _q, _s);
    this.mesh.setMatrixAt(n, _m);
    const hot = 3.2 + crackle * 2.6;
    const w = crackle * 0.45;                                  // bleach toward white
    colors[n * 3] = (b.color.r + w) * hot;
    colors[n * 3 + 1] = (b.color.g + w) * hot;
    colors[n * 3 + 2] = (b.color.b + w) * hot;
    _s.set(rad * (4.2 + crackle * 2.2), rad * (4.2 + crackle * 2.2), len * 1.9);
    _m.compose(b.pos, _q, _s);
    this.halo.setMatrixAt(n, _m);
    hcolors[n * 3] = b.color.r + w; hcolors[n * 3 + 1] = b.color.g + w; hcolors[n * 3 + 2] = b.color.b + w;
    return n + 1;
  }

  /** Bolts that will reach `point` soon — used by AI dodging and by assist. */
  threatsNear(point, radius, out = []) {
    out.length = 0;
    for (const b of this.bolts) {
      // A bolt already stuck to a blade is answered. Leaving it in the threat
      // list dragged the assist onto a bolt that was not going anywhere and
      // held Focus open on a danger that had passed.
      if (!b.active || b.held) continue;
      _v1.subVectors(point, b.pos);
      const along = _v1.dot(_v2.copy(b.vel).normalize());
      if (along < 0 || along > radius) continue;
      const perp = _v1.addScaledVector(_v2, -along).length();
      if (perp > 2.2) continue;
      out.push({ bolt: b, eta: along / b.speed, point: b.pos, dist: along, offset: perp });
    }
    out.sort((a, c) => a.eta - c.eta);
    return out;
  }

  clear() {
    for (const b of this.bolts) { b.active = false; b.held = null; }
    this.mesh.count = 0; this.halo.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.halo.geometry.dispose(); this.halo.material.dispose();
    this.mesh.parent?.remove(this.mesh);
    this.halo.parent?.remove(this.halo);
  }
}

/* ── swept blade intersection ────────────────────────────────────────── */

const _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3();

/**
 * Test a bolt's swept segment against the quad the blade swept this frame.
 * `bladeT` is the fraction along the blade (0 = emitter, 1 = tip); the caller
 * uses it to grade the deflection, because tips return bolts and hilts don't.
 */
export function intersectBladeSweep(from, to, saber, outPoint) {
  const r = 0.075 + saber.coreWidth * 0.05;
  /**
   * THE SLICE COUNT IS THE BLADE'S TRAVEL, NOT A CONSTANT — and it was a
   * constant here long after the same defect was fixed on the body-contact
   * path. `BladeContactSolver.solve` carries the note: fixed sampling dropped
   * severance from 100 % to 38 % between 240 Hz and 10 Hz. This is that bug
   * with a bolt in it, and it survived because the ordinary guards below
   * answer most of what it drops, so it never read as a whiffed block.
   *
   * Four fixed poses put the tip samples `travel / 3` apart while each covers
   * only ±r, so a gap opens the moment `travel / 3 > 2r`. With L = 1.15 m and
   * r ≈ 0.076 m that is w > 23.9 rad/s at 60 Hz and w > 12.0 rad/s at 30 Hz,
   * against an angular cap of 42 (SaberController). Measured gap at the tip:
   *
   *   120 Hz   none at any speed the cap allows
   *    60 Hz   0.115 m at w = 42
   *    30 Hz   0.166 m at w = 25,  0.384 m at w = 42
   *
   * What that costs is not usually the block. It is the GRADE: a bolt the
   * sweep drops falls to the zone test below, which answers it off
   * `zone.parry` instead of off tip speed — so a player who earned a RETURN
   * with a fast tip is quietly paid a DEFLECT, and only on slow machines.
   * Free Blade and Hold-to-Blade have no zone to fall to and lose the contact
   * outright.
   *
   * Spacing is half the capture radius, floored at the old 3 so nothing about
   * a slow blade moves, and capped at 64 to bound the worst frame.
   */
  const travel = Math.max(
    saber.base.distanceTo(saber.prevBase),
    saber.tip.distanceTo(saber.prevTip),
  );
  /* AND THE BROAD PHASE IS WHAT PAYS FOR IT. Every bolt in the air was already
   * tested against every blade four times a frame with no reject in front of
   * it. The displacement along the blade is affine in t, so no point on it
   * moves further than `travel`: a bolt further than r + travel from the START
   * pose cannot be reached before the end of the frame. A bolt nowhere near
   * the fight now costs one test rather than four, which is where the finer
   * sampling on the few bolts that ARE near the blade comes from. Measured on
   * a 0.4 rad flick with 8 bolts on the blade and 120 in the air elsewhere:
   *
   *   near the blade    183 -> 757 ns/bolt     (the finer sampling)
   *   nowhere near it   155 ->  46 ns/bolt     (the reject)
   *   the frame        20.06 -> 11.55 us
   *
   * so the correctness came with 42 % off the frame rather than a bill. */
  const reach = r + travel;
  if (segmentSegment(from, to, saber.prevBase, saber.prevTip, _a1, _b1).distSq > reach * reach) return null;
  const SLICES = clamp(Math.ceil(travel / Math.max(1e-3, r * 0.5)), 3, 64);
  let best = null;
  for (let i = 0; i <= SLICES; i++) {
    const k = i / SLICES;
    _v5.lerpVectors(saber.prevBase, saber.base, k);
    _v6.lerpVectors(saber.prevTip, saber.tip, k);
    const res = segmentSegment(from, to, _v5, _v6, _a1, _b1);
    if (res.distSq < r * r && (!best || res.s < best.boltT)) {
      best = { boltT: res.s, bladeT: res.t, point: _a1.clone(), bladePoint: _b1.clone(), slice: k };
    }
  }
  if (!best) return null;
  if (outPoint) outPoint.copy(best.bladePoint);
  return best;
}

/**
 * Where a bolt's swept segment first enters a guard, or null.
 *
 * A guard is a sphere of radius `radius` around `origin` with a cone of
 * half-angle `cone` cut out of it about `axis`. Both halves matter. The cone
 * alone would be a hitscan — a bolt merely POINTED your way from 40 m out would
 * qualify, and the auto-guard would be reaching across the map. The sphere is
 * what makes it a guard: the bolt has to actually arrive at you.
 *
 * Written as a ray/sphere solve rather than a distance test because a bolt at
 * 63 m/s covers a metre a frame, so where in the frame it crossed the guard is
 * the difference between catching it and catching the air behind it.
 */
export function guardIntercept(from, to, guard, out = new THREE.Vector3()) {
  const o = guard.origin, R = guard.radius;
  _v1.subVectors(to, from);
  const len = _v1.length();
  if (len < 1e-9) return null;
  _v1.multiplyScalar(1 / len);
  _v2.subVectors(from, o);
  const b = _v2.dot(_v1);
  const c = _v2.lengthSq() - R * R;
  let s;
  if (c <= 0) s = 0;                                  // started inside — take the near end
  else {
    if (b > 0) return null;                           // travelling away from the sphere
    const disc = b * b - c;
    if (disc < 0) return null;                        // misses the sphere entirely
    s = -b - Math.sqrt(disc);
    if (s < 0 || s > len) return null;                // does not reach it this frame
  }
  out.copy(from).addScaledVector(_v1, s);
  if (guard.rose != null) return guardZoneAccepts(from, _v1, guard) ? out : null;
  _v3.subVectors(out, o);
  const d = _v3.length();
  if (d < 1e-6) return out;                           // dead centre is inside every cone
  _v3.multiplyScalar(1 / d);
  return _v3.dot(guard.axis) >= Math.cos(guard.cone) ? out : null;
}

/**
 * WHERE A BOLT ON ITS WAY INTO ONE OF YOUR OWN MEN CROSSES YOUR REACH, or null.
 *
 * FLAGSHIP §6's suppression, pointed at the man beside you instead of at your
 * own chest — see `SCREEN` in Combat.js for why this exists at all and what it
 * costs. This half is pure geometry and knows nothing about a bar: the caller
 * hands over a reach it has already decided it can afford, which is what keeps
 * this file free of any dependency on Player, Combat or the controller (the
 * same rule `ZONE_ROSE_ENTRIES` below is duplicated under).
 *
 * Three tests, in the order that rejects most bolts soonest:
 *
 *   1. the swept segment crosses the sphere of radius `reach` about `origin` —
 *      the same ray/sphere solve `guardIntercept` uses, for the same reason it
 *      is a solve rather than a distance test: a bolt covers a metre a frame.
 *   2. THE MAN is inside `sector` of `axis`. You cannot bring a guard behind
 *      you and you cannot screen behind you; the arc handed in is the guard's
 *      own. It is the man's bearing and NOT the bolt's crossing point, and
 *      that is not a nicety — measured on a real Command battle, testing the
 *      crossing took the screen from a mechanic to a curiosity: **16 bolts in
 *      a 250-second battle.** The fire that kills your line comes from INSIDE
 *      the line, so it enters the reach at the muzzle of the man who fired it,
 *      and half the rank is standing behind you. The honest question is which
 *      men you are covering, and a man is covered when you are facing him.
 *   3. AND IT IS ACTUALLY GOING TO HIT SOMEBODY. Each entry of `bodies` is a
 *      sphere the caller measured off a real body, and clearing it only makes
 *      the bolt a CANDIDATE: `screen.hits` then asks the body itself. This is
 *      the test that makes the mechanic a screen and not an aura, and the
 *      sphere alone was not enough to make it — measured on a real Command
 *      battle, the bound sphere wraps every capsule a body presents and so
 *      stands about a metre off the chest, which took **128 bolts screened for
 *      8 fewer arriving**. Sixteen near misses answered for every shot that
 *      was going to land is the aura wearing the mechanic's name.
 *
 * @returns the distance from `origin` to THE MAN IT SAVED, in metres, or 0 for
 *          no intercept — a distance rather than a boolean because the price is
 *          a distance, and asking for the geometry a second time at billing
 *          time would read it off a body that has moved.
 *
 * THE MAN AND NOT THE CONTACT, and the first cut had it the other way. A bolt
 * arrives from outside the reach, so it crosses the sphere AT THE RIM: measured
 * through the shipped path, every screened bolt in a one-bolt test billed 5.6
 * Force — `SCREEN.reach` times the rate, the maximum, whoever it was for and
 * wherever he was standing. That deletes the whole economy the price by the
 * metre exists to create. What the Force is reaching for is the MAN, so his
 * distance is what it costs, and the man at your shoulder is cheap again.
 */
export function screenIntercept(from, to, screen, out = new THREE.Vector3()) {
  const R = screen.reach;
  const bodies = screen.bodies;
  if (!(R > 0) || !bodies || !bodies.length) return 0;
  const o = screen.origin;
  _s1.subVectors(to, from);
  const len = _s1.length();
  if (len < 1e-9) return 0;
  _s1.multiplyScalar(1 / len);
  _s2.subVectors(from, o);
  const b = _s2.dot(_s1);
  const c = _s2.lengthSq() - R * R;
  let t;
  if (c <= 0) t = 0;                                   // already inside the reach
  else {
    if (b > 0) return 0;                               // travelling away
    const disc = b * b - c;
    if (disc < 0) return 0;
    t = -b - Math.sqrt(disc);
    if (t < 0 || t > len) return 0;                    // does not get there this frame
  }
  out.copy(from).addScaledVector(_s1, t);
  // 2 and 3 are asked together, per man: he has to be in front of you AND the
  // bolt has to be on its way into him. The line is followed from the contact
  // rather than from the muzzle, so a bolt that has already passed a man is not
  // on its way into him.
  const margin = screen.margin || 0;
  const hits = screen.hits;
  const cosArc = Math.cos(screen.sector);
  for (const m of bodies) {
    _s3.set(m.x - o.x, m.y - o.y, m.z - o.z);
    const reach = _s3.length();
    if (reach > 1e-6 && _s3.multiplyScalar(1 / reach).dot(screen.axis) < cosArc) continue;
    _s2.set(m.x - out.x, m.y - out.y, m.z - out.z);
    const along = _s2.dot(_s1);
    if (along <= 0) continue;                          // behind the contact
    const r = m.r + margin;
    if (_s2.lengthSq() - along * along > r * r) continue;
    /* The sphere said maybe; the body says yes or no. `hits` is the caller's
     * own bone test — the same one that will resolve this bolt if the screen
     * lets it through — held on the descriptor rather than passed per call so
     * this stays allocation-free on the hot path. */
    if (!hits || hits(m, out, _s1, along + r)) {
      const dx = m.x - o.x, dy = m.y - o.y, dz = m.z - o.z;
      return Math.max(1e-3, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return 0;
}

/**
 * Does a directional guard ZONE answer this bolt?
 *
 * The sphere above has already decided that the bolt actually arrives at you.
 * This decides which of the four zones it arrives THROUGH, and it is deliberately
 * a function of the bolt's LINE and nothing else — not of where the bolt happens
 * to be this frame. A block answers the shot, and the shot is a line; the bearing
 * to a bolt swings through ninety degrees over the last two metres of its flight,
 * so classifying on it would change a bolt's zone under the player's hands while
 * they were already answering it.
 *
 * The bearing used is where the line crosses the guard sphere, computed from the
 * INFINITE line so that a bolt which began the frame already inside the sphere
 * gets the same answer as one that did not:
 *
 *     q  = the offset of the line from the chest at its closest approach
 *     n̂  = (q − u·√(R² − |q|²)) / R
 *
 * For a shooter off to your side that is just −velocity, the direction the shot
 * came from. For a shooter you are looking straight at, −velocity is dead ahead
 * and says nothing, and n̂ instead resolves to WHERE ON YOU the shot was placed,
 * at θ = asin(miss / R). Both are the same formula; which one you are reading is
 * decided by the geometry rather than by a special case.
 *
 * Then:
 *   · inside `centre` — a bolt on your own centreline. ANY zone answers it, and
 *     none of them is more correct than another: a blade held anywhere in front
 *     of your chest is across the line of a shot coming down your sightline.
 *     Every frontal shot that would actually hit your torso is in here, because
 *     asin(0.4 / 1.4) = 16.6° and the disc is 20°.
 *   · beyond `reach` — behind your shoulder line. No zone answers it.
 *   · otherwise — the rose sector decides, widened by the tier's tolerance.
 */
export function guardZoneAccepts(from, u, guard) {
  const o = guard.origin, R = guard.radius;
  // closest approach of the line to the chest
  _g1.subVectors(o, from);
  const along = _g1.dot(u);
  _g2.copy(from).addScaledVector(u, along).sub(o);     // q
  const m2 = _g2.lengthSq();
  if (m2 >= R * R) return false;
  _g3.copy(_g2).addScaledVector(u, -Math.sqrt(R * R - m2)).multiplyScalar(1 / R);
  // into the aim frame, then the same yaw/pitch the guard itself is written in
  _g3.applyQuaternion(guard.inv);
  const theta = Math.acos(clamp(-_g3.z, -1, 1));
  if (theta > guard.reach) return false;
  if (theta <= guard.centre) return true;
  const yaw = Math.atan2(_g3.x, -_g3.z);
  const pitch = Math.asin(clamp(_g3.y, -1, 1));
  let d = (Math.atan2(pitch, yaw) - guard.rose) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= guard.half;
}

/**
 * The zone a guard descriptor WOULD have to be holding to answer this line.
 *
 * Exactly one, for every line that reaches the sphere at all: the four sectors
 * tile the rose. Inside the centre disc there is no meaningful bearing, so the
 * answer is 'centre' — which every zone accepts and none of them owns. Exported
 * for the HUD and for the checks; the resolution above never calls it, because
 * the resolution has to be a single test rather than a classify-then-compare.
 */
export function guardZoneOf(from, to, guard, out = {}) {
  const o = guard.origin, R = guard.radius;
  _g1.subVectors(to, from);
  const len = _g1.length();
  if (len < 1e-9) { out.zone = null; return out; }
  _g1.multiplyScalar(1 / len);
  _g2.subVectors(o, from);
  const along = _g2.dot(_g1);
  _g2.copy(from).addScaledVector(_g1, along).sub(o);
  const m2 = _g2.lengthSq();
  out.miss = Math.sqrt(m2);
  if (m2 >= R * R) { out.zone = null; return out; }
  _g3.copy(_g2).addScaledVector(_g1, -Math.sqrt(R * R - m2)).multiplyScalar(1 / R);
  _g3.applyQuaternion(guard.inv);
  out.theta = Math.acos(clamp(-_g3.z, -1, 1));
  const yaw = Math.atan2(_g3.x, -_g3.z);
  const pitch = Math.asin(clamp(_g3.y, -1, 1));
  out.rose = Math.atan2(pitch, yaw);
  if (out.theta > (guard.reach ?? Math.PI)) { out.zone = null; return out; }
  if (out.theta <= (guard.centre ?? 0)) { out.zone = 'centre'; return out; }
  let best = null, bestD = Infinity;
  for (const [z, c] of ZONE_ROSE_ENTRIES) {
    let d = (out.rose - c) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    d = Math.abs(d);
    if (d < bestD - 1e-12) { bestD = d; best = z; }
  }
  out.zone = best;
  out.error = bestD;
  return out;
}

/**
 * The rose bearings of the four zones, duplicated here rather than imported so
 * that Bolts stays free of any dependency on the controller. SaberController's
 * ZONE_ROSE is the same table and tools/checks/directional.mjs fails the build
 * if the two ever drift apart.
 */
const ZONE_ROSE_ENTRIES = [
  ['right', 0], ['high', Math.PI / 2], ['left', Math.PI], ['low', -Math.PI / 2],
];

/**
 * Test a segment against a capsule (used for bolt-vs-limb and blade-vs-limb).
 * Returns the fraction along the capsule axis, or null.
 */
export function segmentCapsule(p0, p1, c0, c1, radius) {
  const res = segmentSegment(p0, p1, c0, c1, _a1, _b1);
  if (res.distSq > radius * radius) return null;
  return { t: res.t, s: res.s, point: _b1.clone(), hitPoint: _a1.clone(), dist: Math.sqrt(res.distSq) };
}
