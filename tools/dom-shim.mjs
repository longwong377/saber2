/**
 * A DOM stub just wide enough for the procedural content pipeline to run under
 * Node. The texture foundry only needs a canvas it can write pixels into; none
 * of the logic under test cares what those pixels look like.
 */

/**
 * Map the browser's bare specifiers before anything asks for one.
 *
 * `npm run verify` passes --import ./tools/register.mjs and everything resolves.
 * Run the file the obvious way — `node tools/verify.mjs` — and it does not, and
 * the failure is quiet in the worst possible way: `three` still resolves, out of
 * node_modules, so the suite runs and reports; only `rapier` is missing, and
 * initPhysics() deliberately swallows its own failure so a browser without WASM
 * can still reach the menu. The result was 34 physics tests all failing with
 * "Rapier is not initialised" and nothing on screen saying why.
 *
 * Registering here fixes it because every entry point imports this module first
 * and Rapier is reached through a DYNAMIC import, which resolves after this has
 * run. Static `three` imports are already resolved by now, but the vendored
 * build and the node_modules one are both r169, so that path was never the bug.
 */
import { register } from 'node:module';
if (!globalThis.__saberResolverRegistered) {
  globalThis.__saberResolverRegistered = true;
  register('./three-resolver.mjs', import.meta.url);
}

class Ctx2D {
  constructor(canvas) { this.canvas = canvas; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  putImageData() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  fillRect() {} clearRect() {} strokeRect() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} quadraticCurveTo() {}
  bezierCurveTo() {} arc() {} arcTo() {} rect() {} ellipse() {}
  fill() {} stroke() {} clip() {}
  save() {} restore() {} translate() {} rotate() {} scale() {} setTransform() {} transform() {}
  drawImage() {} measureText() { return { width: 0 }; } fillText() {} strokeText() {}
}

class Canvas {
  constructor() { this.width = 1; this.height = 1; this.style = {}; }
  getContext(kind) { return kind === '2d' ? (this._ctx ||= new Ctx2D(this)) : null; }
  toDataURL() { return 'data:,'; }
  addEventListener() {} removeEventListener() {}
}

class Elem {
  constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
  setAttribute() {} getAttribute() { return null; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) { return tag === 'canvas' ? new Canvas() : new Elem(tag); },
    createElementNS(_ns, tag) { return this.createElement(tag); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    head: new Elem('head'), body: new Elem('body'),
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.HTMLCanvasElement === 'undefined') globalThis.HTMLCanvasElement = Canvas;
if (typeof globalThis.ImageBitmap === 'undefined') globalThis.ImageBitmap = class {};
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = Canvas;
if (typeof globalThis.localStorage === 'undefined') {
  /* A WHOLE Storage, not the three methods the game happens to call. `key(i)`
   * and `length` are how anything ENUMERATES what is saved, and without them a
   * caller can read and write a key it already knows the name of and can never
   * ask what is there — which is exactly what `_shared.mjs` needs in order to
   * hand the next suite the storage this one was given. A suite that drives a
   * rebind through a real Menu calls `saveBindings`, and every later suite's
   * `new Input` reads that table back. */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}
