import './dom-shim.mjs';
import * as THREE from 'three';
function stubEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16/9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return { scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4,0.7,0.5).normalize(),
    renderer: { info: { render:{calls:0,triangles:0}, memory:{geometries:0,textures:0} } },
    profiler: { begin(){},end(){},beginDraw(){},endDraw(){},dispose(){} },
    applyAtmosphere(){}, fitShadows(){}, flash(){}, hurt(){}, addHeat(){},
    setFocus(){}, setRadial(){}, setGrain(){}, setBloom(){}, setSense(){},
    setQuality(){}, setResolutionScale(){}, render(){} };
}
const { initPhysics } = await import("../src/physics/Rapier.js");
await initPhysics();
const { World } = await import('../src/game/World.js');
const { MODES } = await import('../src/game/Waves.js');
const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
console.log('fixedTheatre:', MODES.command.fixedTheatre);
for (const lvl of ['kamino','scoria']) {
  const w = new World(stubEngine(), { ...DEFAULT_SETTINGS, mode:'command', level: lvl, quality:'low' });
  await w.loadLevel(lvl);
  console.log(`asked ${lvl.padEnd(8)} -> levelKey=${w.levelKey}  name="${w.level.name}"  command=${!!w.command}  area="${w.command?.area?.name}"`);
  w.unload?.();
}
