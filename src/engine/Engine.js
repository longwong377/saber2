/**
 * SABER — renderer, HDR pipeline, post stack.
 *
 * Scene renders into a multisampled half-float target so the blade and the
 * bolts stay bright above 1.0 and bloom picks them up honestly; ACES filmic
 * tonemapping brings it back down at the end. The composite pass is where the
 * frame gets its character — grain, chromatic aberration, vignette, heat haze
 * off the blade, and the desaturated pull of Force Sense.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { noiseTexture } from './Textures.js';
import { clamp, damp } from './MathUtil.js';

export const QUALITY = {
  low:    { shadow: 1024, msaa: 0, pixelRatio: 1.0,  bloom: true,  grass: 0.25, particles: 0.4, shadowDist: 34, viewDist: 380 },
  medium: { shadow: 2048, msaa: 2, pixelRatio: 1.0,  bloom: true,  grass: 0.55, particles: 0.7, shadowDist: 46, viewDist: 520 },
  high:   { shadow: 3072, msaa: 4, pixelRatio: 1.25, bloom: true,  grass: 1.0,  particles: 1.0, shadowDist: 60, viewDist: 700 },
  ultra:  { shadow: 4096, msaa: 4, pixelRatio: 1.5,  bloom: true,  grass: 1.5,  particles: 1.35, shadowDist: 78, viewDist: 900 },
};

/* ── composite shader ────────────────────────────────────────────────── */

const CompositeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    tNoise:      { value: null },
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain:      { value: 0.045 },
    uVignette:   { value: 0.42 },
    uAberration: { value: 0.7 },
    uSaturation: { value: 1.06 },
    uContrast:   { value: 1.04 },
    uLift:       { value: new THREE.Vector3(0.004, 0.006, 0.012) },
    uGain:       { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    uSense:      { value: 0 },      // Force Sense 0..1
    uHurt:       { value: 0 },      // damage flash 0..1
    uHeat:       { value: [] },     // vec4 x,y,radius,strength (screen space)
    uHeatCount:  { value: 0 },
    uRadial:     { value: 0 },      // radial blur amount
    uSharpen:    { value: 0.35 },
    uFlash:      { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, tNoise;
    uniform vec2 uResolution;
    uniform float uTime, uGrain, uVignette, uAberration, uSaturation, uContrast;
    uniform float uSense, uHurt, uRadial, uSharpen, uFlash;
    uniform vec3 uLift, uGain;
    uniform vec4 uHeat[6];
    uniform int uHeatCount;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

    void main(){
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // — heat haze: refractive wobble around hot emitters
      vec2 warp = vec2(0.0);
      for(int i=0;i<6;i++){
        if(i >= uHeatCount) break;
        vec4 h = uHeat[i];
        vec2 d = uv - h.xy;
        d.x *= uResolution.x / uResolution.y;
        float dist = length(d);
        float fall = smoothstep(h.z, 0.0, dist);
        if(fall <= 0.0) continue;
        float n1 = texture2D(tNoise, uv*3.0 + vec2(uTime*0.31, uTime*0.47)).r - 0.5;
        float n2 = texture2D(tNoise, uv*4.7 - vec2(uTime*0.23, uTime*0.19)).g - 0.5;
        warp += vec2(n1, n2) * fall * h.w * 0.028;
      }
      uv += warp;

      // — radial blur (Force Sense / impacts)
      vec3 col;
      if(uRadial > 0.001){
        vec3 acc = vec3(0.0);
        for(int i=0;i<6;i++){
          float t = float(i)/5.0;
          vec2 suv = mix(uv, vec2(0.5), t * uRadial * 0.16);
          acc += texture2D(tDiffuse, suv).rgb;
        }
        col = acc / 6.0;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // — chromatic aberration, stronger toward the corners
      float ca = uAberration * (0.0016 + r2 * 0.007) * (1.0 + uHurt*2.0);
      if(ca > 0.00001){
        col.r = texture2D(tDiffuse, uv + centred * ca).r;
        col.b = texture2D(tDiffuse, uv - centred * ca).b;
      }

      // — unsharp mask for micro contrast
      if(uSharpen > 0.001){
        vec2 tx = 1.0 / uResolution;
        vec3 blur = texture2D(tDiffuse, uv + vec2(tx.x,0.0)).rgb
                  + texture2D(tDiffuse, uv - vec2(tx.x,0.0)).rgb
                  + texture2D(tDiffuse, uv + vec2(0.0,tx.y)).rgb
                  + texture2D(tDiffuse, uv - vec2(0.0,tx.y)).rgb;
        col += (col - blur * 0.25) * uSharpen;
      }

      // — grade
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift;
      float luma = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // — Force Sense: cool, desaturated, silvered highlights
      if(uSense > 0.001){
        vec3 sense = mix(vec3(luma), col, 0.34);
        sense *= vec3(0.82, 0.94, 1.22);
        sense += pow(max(luma-0.55,0.0), 1.6) * vec3(0.35,0.5,0.75);
        col = mix(col, sense, uSense);
      }

      // — damage
      if(uHurt > 0.001){
        col = mix(col, col*vec3(1.5,0.28,0.3), uHurt*0.5);
      }
      col += uFlash;

      // — vignette
      float vig = 1.0 - uVignette * smoothstep(0.16, 0.86, r2*1.6);
      col *= vig;

      // — grain, gently animated, scaled by darkness so highlights stay clean
      float g = hash(gl_FragCoord.xy + fract(uTime)*vec2(311.0,271.0)) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.15, 0.95, luma));

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ══════════════════════════════════════════════════════════════════════ */

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY[quality] ? quality : 'high';
    const q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.06, q.viewDist);
    this.scene.add(this.camera);

    this.resolutionScale = 1;
    this._setupLights();
    this._setupComposer();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.heatSources = [];
    this._flash = 0;
    this._hurt = 0;
    this._sense = 0;
    this._radial = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _setupLights() {
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY[this.quality].shadow, QUALITY[this.quality].shadow);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.blurSamples = 12;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x60482e, 0.85);
    this.scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x9fc4ff, 0.45);
    this.fill.position.set(-1, 0.6, -0.8);
    this.scene.add(this.fill);

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.scene.add(this.sky);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Configure sky + sun + fog for a level mood. */
  applyAtmosphere(a) {
    const u = this.sky.material.uniforms;
    u.turbidity.value = a.turbidity ?? 6;
    u.rayleigh.value = a.rayleigh ?? 2.2;
    u.mieCoefficient.value = a.mie ?? 0.008;
    u.mieDirectionalG.value = a.mieG ?? 0.82;

    const phi = THREE.MathUtils.degToRad(90 - (a.elevation ?? 22));
    const theta = THREE.MathUtils.degToRad(a.azimuth ?? 140);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunPos);
    this.sunDir = sunPos.clone();

    this.sun.position.copy(sunPos).multiplyScalar(90);
    this.sun.color.set(a.sunColor ?? 0xfff0d8);
    this.sun.intensity = a.sunIntensity ?? 3.6;
    this.hemi.color.set(a.skyColor ?? 0xbcd8ff);
    this.hemi.groundColor.set(a.groundColor ?? 0x60482e);
    this.hemi.intensity = a.ambient ?? 0.85;
    this.fill.color.set(a.fillColor ?? 0x9fc4ff);
    this.fill.intensity = a.fillIntensity ?? 0.45;
    this.sky.visible = a.sky !== false;

    if (a.fog !== false) {
      this.scene.fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
    } else this.scene.fog = null;
    this.scene.background = a.sky === false ? new THREE.Color(a.bgColor ?? 0x0b0e14) : null;

    this.renderer.toneMappingExposure = a.exposure ?? 1.05;
    this.composite.uniforms.uLift.value.set(...(a.lift ?? [0.004, 0.006, 0.012]));
    this.composite.uniforms.uGain.value.set(...(a.gain ?? [1.02, 1.0, 0.98]));
    this.composite.uniforms.uSaturation.value = a.saturation ?? 1.06;
    this.bloom.strength = a.bloom ?? 0.62;

    this.refreshEnvironment();
  }

  /** Bake the current sky into an IBL probe. */
  refreshEnvironment() {
    if (this._envRT) this._envRT.dispose();
    const tmp = new THREE.Scene();
    const skyClone = this.sky.clone();
    if (this.scene.background instanceof THREE.Color) tmp.background = this.scene.background;
    if (this.sky.visible) tmp.add(skyClone);
    else tmp.background = new THREE.Color(0x11151d);
    this._envRT = this.pmrem.fromScene(tmp, 0.04);
    this.scene.environment = this._envRT.texture;
    this.scene.environmentIntensity = 0.85;
  }

  _setupComposer() {
    const q = QUALITY[this.quality];
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: THREE.HalfFloatType,
      samples: q.msaa,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.62, 0.78);
    this.composer.addPass(this.bloom);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.composite = new ShaderPass(CompositeShader);
    this.composite.material.uniforms.tNoise.value = noiseTexture(256);
    this.composite.material.uniforms.uHeat.value = Array.from({ length: 6 }, () => new THREE.Vector4());
    this.composite.renderToScreen = true;
    this.composer.addPass(this.composite);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return;
    this.quality = name;
    const q = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio) * this.resolutionScale);
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.camera.far = q.viewDist;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  setResolutionScale(s) {
    this.resolutionScale = clamp(s, 0.4, 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio) * this.resolutionScale);
    this.resize();
  }

  setBloom(on) { this.bloom.enabled = !!on; }
  setGrain(on) { this.composite.uniforms.uGrain.value = on ? 0.045 : 0; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.composite.uniforms.uResolution.value.set(size.x, size.y);
    this.bloom.resolution.set(size.x, size.y);
  }

  /** Keep the shadow frustum tight around the action. */
  fitShadows(center) {
    const d = QUALITY[this.quality].shadowDist;
    const cam = this.sun.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = d * 4.2;
    // snap to texel grid so shadows don't shimmer while walking
    const texel = (d * 2) / QUALITY[this.quality].shadow;
    const sx = Math.round(center.x / texel) * texel;
    const sz = Math.round(center.z / texel) * texel;
    this.sun.target.position.set(sx, center.y, sz);
    this.sun.position.copy(this.sunDir || new THREE.Vector3(0.5, 0.8, 0.3))
      .multiplyScalar(d * 2.2).add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }

  addHeat(screenX, screenY, radius, strength) {
    if (this.heatSources.length < 6) this.heatSources.push([screenX, screenY, radius, strength]);
  }

  flash(v) { this._flash = Math.max(this._flash, v); }
  hurt(v) { this._hurt = Math.max(this._hurt, v); }
  setSense(v) { this._senseTarget = v; }
  setRadial(v) { this._radialTarget = v; }

  render(dt) {
    const u = this.composite.uniforms;
    this.time += dt;
    u.uTime.value = this.time;

    this._flash = damp(this._flash, 0, 9, dt);
    this._hurt = damp(this._hurt, 0, 4.2, dt);
    this._sense = damp(this._sense, this._senseTarget || 0, 7, dt);
    this._radial = damp(this._radial, this._radialTarget || 0, 8, dt);
    u.uFlash.value = this._flash;
    u.uHurt.value = this._hurt;
    u.uSense.value = this._sense;
    u.uRadial.value = this._radial;

    const heat = u.uHeat.value;
    for (let i = 0; i < 6; i++) {
      const h = this.heatSources[i];
      if (h) heat[i].set(h[0], h[1], h[2], h[3]); else heat[i].set(0, 0, 0, 0);
    }
    u.uHeatCount.value = Math.min(6, this.heatSources.length);
    this.heatSources.length = 0;

    this.renderer.info.reset();
    this.composer.render(dt);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.pmrem?.dispose();
    this._envRT?.dispose();
    this.renderer.dispose();
  }
}
