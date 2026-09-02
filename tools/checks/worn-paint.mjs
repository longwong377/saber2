/**
 * Lived-in paint. — src/game/Command.js `PAINT`, src/game/DeckEdit.js §5
 *
 * "all the customization for the troopers is a little schoolyard crayony …
 *  it just feels like you're slabbing paint on them."
 *
 * It was: a rank was a box on the crown and two caps on the shoulders, a mark
 * a brick proud of each shin, a band a cube on the forearm, all in a flat
 * material with a glow. Every one of those was a THING placed on the armour.
 * A unit marking is a colour the plate has where the sprayer went, with a
 * chipped edge and dust in the creases — so the paint is per-vertex colour in
 * the plate's own geometry now, in body-local regions, and this file holds
 * that to five properties the header over `PAINT` promises:
 *
 *   · a painted trooper carries at least two distinct painted REGIONS;
 *   · a region's edge is not a straight line — the boundary wanders, and
 *     vertices inside it are chipped bare;
 *   · nothing the paint touched glows;
 *   · the same man painted as a live Enemy and as a parade figure wears the
 *     same regions, vertex for vertex, so the deck and the field agree;
 *   · a promotion re-paints without adding a mesh, and a droid takes the
 *     flash as panels with its photoreceptor untouched.
 *
 * And the deck's wash: a mark dialled on the flight deck arrives over the
 * merged buffer as a sweep, boot to crown, and not as an assignment.
 */
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import {
  RANKS, MARKS, ARMIES, CommandDirector, CommandRoster, Trooper, enlistBody, paintReport,
  regionDist, RANK_REGIONS, DROID_RANK_REGIONS, MARK_REGIONS, PAINT, PAINT_SLOTS_OF, prepPaint,
} from '../../src/game/Command.js';
import { buildFigure } from '../../src/game/Parade.js';
import * as Company from '../../src/game/Company.js';
import * as Edit from '../../src/game/DeckEdit.js';
import { MUSTER } from '../../src/game/Hangar.js';

const KEY = 'saber.company.v1';
const dir = CommandDirector.prototype;

/** How many meshes hang on a body. */
function meshCount(e) {
  let n = 0;
  (e.rig?.root || e.group).traverse((o) => { if (o.isMesh) n++; });
  return n;
}

/** Every material a paint record wrote into. */
function materialsOf(rec) {
  const out = new Set();
  for (const g of rec?.geos?.values?.() || []) out.add(g.mat);
  return [...out];
}

/** A veteran of the given xp with a mark and a band, as a parade figure. */
const figureOf = (xp, type = 'trooper', kind = 'flesh') => buildFigure({
  army: kind === 'steel' ? 'cis' : 'republic', type, kind, designation: 'WP-1', xp, wounds: 0,
  look: { mark: 'blood', band: 'sky' },
});

export async function run({ check, assert }) {
  check('worn-paint: a painted trooper carries distinct regions, in the vertices, on no added mesh', () => {
    const bare = figureOf(0);
    const fig = figureOf(12);
    assert(bare && fig, 'no figure built');
    const stub = fig._stub;
    assert(stub._cmdPaint && stub._cmdMark && stub._cmdBand, 'a Sergeant with a mark and a band is missing paint');
    assert(meshCount(fig) === meshCount(bare),
      `a painted man has ${meshCount(fig)} meshes and a bare one ${meshCount(bare)} — the paint is still bolted on`);
    assert(!(stub._modMeshes || []).length, 'the paint put meshes on _modMeshes');
    const regions = stub._cmdPaint.regions;
    assert(regions.length >= 2, `the rank paints ${regions.length} region(s): ${regions.join('+')}`);
    /* DISTINCT: the regions land on different bones, not one blob twice. */
    const bones = new Set();
    for (const g of stub._cmdPaint.geos.values()) bones.add(g.mesh.parent?.userData?.bone?.name || '?');
    assert(bones.size >= 2, `the rank's regions all sit on one bone: ${[...bones].join(',')}`);
    /* And the mark and the band are elsewhere entirely. */
    const rankGeos = new Set(stub._cmdPaint.geos.keys());
    for (const [slot, key] of [['mark', '_cmdMark'], ['band', '_cmdBand']]) {
      for (const geo of stub[key].geos.keys()) {
        assert(!rankGeos.has(geo), `the ${slot} shares a geometry with the rank paint`);
      }
    }
    /* IT IS IN THE CHANNEL: a painted vertex differs from an unpainted one. */
    let moved = 0;
    for (const [geo, g] of stub._cmdPaint.geos) {
      const col = geo.attributes.color;
      assert(col && col.count === g.count, 'a painted geometry has no colour channel');
      assert(g.mat.vertexColors, 'the plate material does not read its colour channel');
      for (let k = 0; k < g.idx.length; k++) {
        const i = g.idx[k];
        if (Math.abs(col.getX(i) - g.orig[k * 3]) > 1e-4 || Math.abs(col.getZ(i) - g.orig[k * 3 + 2]) > 1e-4) moved++;
      }
    }
    assert(moved > stub._cmdPaint.count * 0.9, `${moved} of ${stub._cmdPaint.count} painted vertices actually changed colour`);
    return `${regions.join('+')} on ${[...bones].join(',')}; mark ${stub._cmdMark.count} v, band ${stub._cmdBand.count} v; `
      + `${meshCount(fig)} meshes either way`;
  });

  check('worn-paint: a painted edge wanders and is chipped — it is not a line', () => {
    const fig = figureOf(4);
    const stub = fig._stub;
    const head = stub.rig.get('head');
    const crest = RANK_REGIONS.find((r) => r.id === 'crest');
    const rec = stub._cmdPaint;
    /* THE CREST STRIPE along the crown: for each slice of z, where the paint
     * stops in |x|. A sprayed edge stops at the same |x| in every slice; a
     * worn one does not. */
    const S = stub.A.scale, p = new THREE.Vector3(), m4 = new THREE.Matrix4();
    const edgeAt = new Map();
    let inside = 0, bare = 0, painted = 0;
    for (const [geo, g] of rec.geos) {
      if (g.mesh.parent !== head.obj) continue;
      const P = geo.attributes.position;
      g.mesh.updateMatrix(); m4.copy(g.mesh.matrix);
      const on = new Set(g.idx);
      for (let i = 0; i < P.count; i++) {
        p.fromBufferAttribute(P, i).applyMatrix4(m4);
        const d = regionDist(crest, p, S, head.length, 1);
        if (d <= 0) continue;
        inside++;
        if (!on.has(i)) { if (d > PAINT.chip * 0.3) bare++; continue; }
        painted++;
        const z = Math.round(p.z / 0.02);
        edgeAt.set(z, Math.max(edgeAt.get(z) ?? 0, Math.abs(p.x)));
      }
    }
    assert(painted > 40, `only ${painted} painted vertices on the crest`);
    const edges = [...edgeAt.values()];
    const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
    const variance = edges.reduce((a, b) => a + (b - mean) ** 2, 0) / edges.length;
    assert(edges.length >= 4 && variance > 1e-7,
      `the crest's edge sits at |x| ${mean.toFixed(4)} in every one of ${edges.length} slices (variance ${variance}) — a ruled line`);
    assert(bare > 0 && bare < inside * 0.5,
      `${bare} of ${inside} vertices inside the crest are chipped bare — none is a decal, half is no stripe`);
    return `crest edge wanders ±${Math.sqrt(variance).toFixed(4)} m over ${edges.length} slices; ${bare} of ${inside} inside vertices chipped bare`;
  });

  check('worn-paint: nothing the paint touched glows, and the colour leans toward the plate', () => {
    const fig = figureOf(20);
    const stub = fig._stub;
    let mats = 0;
    for (const key of Object.values(PAINT_SLOTS_OF)) {
      const rec = stub[key];
      assert(rec, `${key} missing`);
      assert(!(rec.emissiveIntensity > 0), `${key} records an emissive term`);
      for (const mat of materialsOf(rec)) {
        mats++;
        const glow = mat.emissive ? mat.emissive.r + mat.emissive.g + mat.emissive.b : 0;
        assert(!(glow * (mat.emissiveIntensity ?? 1) > 0),
          `${key} is painted on a material that glows (emissive 0x${mat.emissive.getHex().toString(16)} × ${mat.emissiveIntensity})`);
      }
    }
    /* FADED, not a swatch: the paint target is between the asked colour and
     * the plate on every channel — `PAINT.fade` of the way. */
    const asked = new THREE.Color(RANKS[3].color);
    const plate = prepPaint(stub).plate;
    const want = stub._cmdPaint.paint;
    for (let c = 0; c < 3; c++) {
      const a = asked.toArray()[c], pl = plate[c];
      assert((want[c] - a) * (pl - a) >= -1e-6 && Math.abs(want[c] - a) <= Math.abs(pl - a) + 1e-6,
        `channel ${c}: paint ${want[c].toFixed(3)} is not between the asked ${a.toFixed(3)} and the plate ${pl.toFixed(3)}`);
    }
    return `${mats} materials painted, none emissive; captain green faded ${(PAINT.fade * 100).toFixed(0)}% toward the plate`;
  });

  check('worn-paint: the man on the field and the man on the deck wear the same paint, vertex for vertex', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const t = new Trooper(ARMIES.republic, 'trooper', 'CT-7710', { attrs: null, traits: [], xp: 12 });
    assert(t.rank === 2, `xp 12 is rank ${t.rank}, not Sergeant`);
    t.look = { mark: 'blood', band: 'sky' };
    const e = new Enemy(world, 'trooper', new THREE.Vector3(6, 0, 0));
    const meshesBefore = meshCount(e);
    enlistBody(e, t, { director: dir, team: 0 });
    assert(e._cmdPaint && e._cmdMark && e._cmdBand, 'enlisting did not paint the body');
    assert(meshCount(e) === meshesBefore, 'enlisting added meshes for the paint');
    const field = paintReport(e);
    const deck = paintReport(figureOf(12)._stub);
    assert(field.length > 3, `the field report is ${field.join(' ')}`);
    assert(field.join(' ') === deck.join(' '),
      `the field and the deck disagree:\n  field ${field.join(' ')}\n  deck  ${deck.join(' ')}`);
    return `${field.length} lines agree: ${field.filter((l) => /regions/.test(l)).join(' ')}`;
  });

  check('worn-paint: a promotion re-paints in place — more plate, the same meshes and vertices', () => {
    const fig = figureOf(4);
    const stub = fig._stub;
    const verts = () => { let n = 0; fig.root.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count; }); return n; };
    const m0 = meshCount(fig), v0 = verts();
    const r1 = stub._cmdPaint.regions.length, c1 = stub._cmdPaint.count;
    assert(dir.repaint.call(null, stub, RANKS[4].color, 4), 'the commander\'s repaint painted nothing');
    assert(meshCount(fig) === m0 && verts() === v0,
      `a promotion changed the body: ${m0}→${meshCount(fig)} meshes, ${v0}→${verts()} vertices`);
    assert(stub._cmdPaint.regions.length > r1 && stub._cmdPaint.count > c1,
      `a Commander wears ${stub._cmdPaint.regions.length} regions / ${stub._cmdPaint.count} vertices against a Veteran's ${r1} / ${c1}`);
    assert(stub._cmdPaint.color.getHex() === RANKS[4].color, 'the record is not the commander\'s colour');
    /* And back down: the vertices the higher rank painted are restored. */
    assert(dir.repaint.call(null, stub, RANKS[1].color, 1), 'the demotion painted nothing');
    assert(stub._cmdPaint.count === c1 && stub._cmdPaint.regions.length === r1, 'a demotion did not restore the plate');
    /* The mark and the band survived both. */
    assert(stub._cmdMark.count > 0 && stub._cmdBand.count > 0, 'a repaint took the mark or the band off');
    return `Veteran ${r1} regions/${c1} v → Commander ${RANK_REGIONS.length} regions max → Veteran again; ${m0} meshes, ${v0} vertices throughout`;
  });

  check('worn-paint: a droid takes the flash as chipped panels and keeps its photoreceptor', () => {
    for (const type of ['b1', 'b2']) {
      const fig = figureOf(36, type, 'steel');
      assert(fig, `no ${type} figure`);
      const stub = fig._stub;
      assert(prepPaint(stub).kind === 'steel', `a ${type} was painted as a man in cloth`);
      assert(stub._cmdPaint && stub._cmdPaint.regions.length >= 3,
        `a commander ${type} wears ${stub._cmdPaint?.regions?.length} regions`);
      assert(stub._cmdPaint.regions.every((id) => DROID_RANK_REGIONS.some((r) => r.id === id)),
        `${type} painted from the wrong table: ${stub._cmdPaint.regions.join('+')}`);
      assert(stub._cmdMark && stub._cmdMark.regions.join() === MARK_REGIONS[0].id,
        `the ${type}'s mark is ${stub._cmdMark?.regions?.join('+')} — it fell back to the trunk`);
      const eye = fig.palette?.eye;
      assert(eye, `${type} has no photoreceptor material to protect`);
      for (const key of Object.values(PAINT_SLOTS_OF)) {
        for (const mat of materialsOf(stub[key])) assert(mat !== eye, `the ${type}'s photoreceptor took ${key}`);
      }
      assert(!eye.vertexColors, `the ${type}'s photoreceptor was switched to vertex colour`);
      /* Chipped: some vertices inside the breast panel are bare. */
      const chest = stub.rig.get('chest');
      const breast = DROID_RANK_REGIONS.find((r) => r.id === 'breast');
      let inside = 0, bare = 0;
      const p = new THREE.Vector3(), m4 = new THREE.Matrix4();
      for (const [geo, g] of stub._cmdPaint.geos) {
        if (g.mesh.parent !== chest.obj) continue;
        const on = new Set(g.idx), P = geo.attributes.position;
        g.mesh.updateMatrix(); m4.copy(g.mesh.matrix);
        for (let i = 0; i < P.count; i++) {
          p.fromBufferAttribute(P, i).applyMatrix4(m4);
          const d = regionDist(breast, p, stub.A.scale, chest.length, 1);
          if (d <= 0) continue;
          inside++;
          if (!on.has(i) && d > PAINT.chip * 0.3) bare++;
        }
      }
      assert(inside > 30 && bare > 0 && bare < inside * 0.5, `${type} breast panel: ${bare} of ${inside} chipped`);
    }
    return 'B1 and B2: rank on the droid table, mark on the shin, photoreceptor untouched, breast panels chipped';
  });

  check('worn-paint: on the deck a mark washes on over the merged buffer, boot to crown', async () => {
    /* A roll of real men on a store nobody else is using, the way
     * tools/checks/deckedit.mjs seeds one; the deck through the same door. */
    const had = globalThis.localStorage?.getItem(KEY) ?? null;
    const hadSlate = globalThis.localStorage?.getItem('saber.muster.v1') ?? null;
    localStorage.removeItem(KEY); localStorage.removeItem('saber.muster.v1');
    const army = ARMIES.republic;
    const roster = new CommandRoster(army);
    for (let i = 0; i < 4; i++) roster.enlist(army.tiers[0].type);
    Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const idle = idleInput();
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0, army: 'republic' } });
    try {
      const step = (n) => { for (let i = 0; i < n; i++) { world.update(1 / 60, idle); Edit.stepDeckEdit(world, 1 / 60); } };
      world.orders?.order?.('fallin');
      step(Math.round((MUSTER.formUp + 4) * 60));
      const c = world._company;
      const row = c?.men?.find((r) => r.merged?.skin && r.fig?._stub && !r.fig._stub._cmdMark);
      assert(row, 'no merged, unmarked man on the deck to paint');
      const stub = row.fig._stub;
      const look = Edit.applyEdit(world, 'mark', 'blood', { row });
      assert(look?.mark === 'blood', 'the store did not take the mark');
      const rec = stub._cmdMark;
      assert(rec?.geos?.size, 'the mark was not painted on the deck figure');
      /* A RECRUIT IS READIED FOR PAINT BY HIS FIRST MARK, so his geometry
       * grew under the bake he already folded into — `mergeFigure.update`
       * re-bakes him on the next frame (`spansMoved`). The wash is therefore
       * read as PROGRESS per painted vertex, off the sweep's own from/to, in
       * whatever buffer is drawing him on each frame. */
      const sweep = world._deckEdit?.sweeps?.find((s) => s.row === row);
      assert(sweep && sweep.entries.length === 1 && sweep.entries[0].vertex, 'no vertex wash was armed for the mark');
      const E = sweep.entries[0];
      const sample = () => {
        const skin = row.merged?.skin;
        if (!skin) return null;
        let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
        for (let i = 0; i < skin.meshes.length; i++) {
          const col = skin.meshes[i].geometry.attributes.color;
          let start = 0;
          for (const src of skin.sources[i]) {
            const g = E.geos.get(src.geometry);
            const cm = src.material.color;
            if (g) for (let k = 0; k < g.idx.length; k++) {
              const v = g.idx[k], o = k * 3;
              const from = cm.r * g.from[o] - cm.g * g.from[o + 1];
              const to = cm.r * g.to[o] - cm.g * g.to[o + 1];
              if (Math.abs(to - from) < 0.05) continue;
              const f = (col.getX(start + v) - col.getY(start + v) - from) / (to - from);
              sum += f; n++; if (f < lo) lo = f; if (f > hi) hi = f;
            }
            start += src.geometry.attributes.position.count;
          }
        }
        return n ? { mean: sum / n, lo, hi, n } : null;
      };
      step(1);
      const first = sample();
      assert(first && first.n > 100, `${first?.n || 0} mark vertices readable in the merged buffer one frame on`);
      assert(first.mean < 0.5, `one frame after the edit the mark is ${(first.mean * 100).toFixed(0)}% on — a pop`);
      const samples = [first];
      let split = 0;
      for (let i = 0; i < 90; i++) {
        step(1);
        const s = sample();
        if (!s) continue;
        samples.push(s);
        if (s.hi - s.lo > 0.3) split++;
        if (s.mean > 0.995 && s.hi - s.lo < 0.01) break;
      }
      const end = samples[samples.length - 1];
      const moving = samples.filter((s, i) => i > 0 && Math.abs(s.mean - samples[i - 1].mean) > 1e-3).length;
      assert(end.mean > 0.98 && end.hi > 0.98 && end.lo > 0.98,
        `the mark ended ${(end.mean * 100).toFixed(1)}% on (lo ${end.lo.toFixed(2)}, hi ${end.hi.toFixed(2)})`);
      assert(moving >= 5, `the mark moved on ${moving} frames — a sweep crossing a shin is a quarter second, not two states`);
      assert(split > 3, `the mark was never part-painted (${split} frames with a wet edge)`);
      for (let i = 1; i < samples.length; i++) {
        assert(samples[i].mean - samples[i - 1].mean > -1e-3, `the wash reversed at frame ${i}`);
      }
      /* AND WHAT IT LEAVES: buffer = plate colour × channel, so a re-bake
       * would reproduce it. */
      step(20);
      const agree = () => {
        const skin = row.merged.skin;
        let worst = 0;
        for (let i = 0; i < skin.meshes.length; i++) {
          const col = skin.meshes[i].geometry.attributes.color;
          let start = 0;
          for (const src of skin.sources[i]) {
            const g = E.geos.get(src.geometry);
            if (g) {
              const ch = src.geometry.attributes.color, cm = src.material.color;
              for (let k = 0; k < g.idx.length; k++) {
                const v = g.idx[k];
                worst = Math.max(worst, Math.abs(col.getX(start + v) - cm.r * ch.getX(v)));
              }
            }
            start += src.geometry.attributes.position.count;
          }
        }
        return worst;
      };
      const worst = agree();
      assert(worst < 1e-4, `the buffer and the channel disagree by ${worst} after the wash`);
      /* DIALLED OFF: it washes back to bare plate and the record goes. */
      Edit.applyEdit(world, 'mark', 'none', { row });
      step(Math.round(1.2 * 60));
      assert(!stub._cmdMark, 'the cleared mark left its record on the man');
      const worstOff = agree();
      assert(worstOff < 1e-4, `after clearing, the buffer and the channel disagree by ${worstOff}`);
      return `${moving} frames of movement, ${split} with a wet edge, ${(first.mean * 100).toFixed(0)}% → ${(end.mean * 100).toFixed(0)}% on; `
        + 'cleared back to bare plate, buffer and channel agreeing';
    } finally {
      world.unload?.();
      if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
      if (hadSlate == null) localStorage.removeItem('saber.muster.v1'); else localStorage.setItem('saber.muster.v1', hadSlate);
    }
  });

  check('worn-paint: the deck\'s own wash reads the records, not a bolt-on material', async () => {
    const src = await readFile(new URL('../../src/game/DeckEdit.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function wearPaint('), src.indexOf('/*  6. THE PART COMING IN'));
    assert(/_cmdMark|_cmdBand/.test(body) && /\.geos/.test(body), 'wearPaint does not read the paint records');
    assert(/renewPaint/.test(body), 'a plate recolour never re-fits the paint to the new plate');
    assert(/unpaint/.test(body), 'a cleared mark is never taken off the body');
    assert(!/_modMeshes/.test(body), 'the wash still looks for bolted-on meshes');
    return 'wearPaint/stepSweep drive the vertex records; renewPaint and unpaint are wired';
  });
}
