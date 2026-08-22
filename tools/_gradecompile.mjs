/**
 * COMPILE THE COMPOSITE SHADER, and nothing else.
 *
 * Written because splitting the tone curve into its own GLSL unit
 * (`GRADE_GLSL` in src/engine/Engine.js) shipped a shader that did not
 * compile: `uContrast` ended up declared twice, once in the fragment's own
 * uniform block and once in the unit. Nothing in the harness noticed — there
 * is no GL context under Node — and `tools/checks/_glsl.mjs` cannot notice
 * either, because its interpreter takes uniforms from the caller's env and has
 * no opinion about whether they were declared.
 *
 * What DID notice was `lighting.mjs`'s booted-Engine shadow check, which
 * reported "0 of 76800 pixels changed": a dead shader draws the same frame
 * whatever you do to the scene, so a difference test reads as a total absence
 * of shadows. That is a good check doing its job and a terrible error message
 * to debug from, and it costs a browser boot and a real level.
 *
 * This costs about three seconds and prints the driver's own info log.
 *
 *   node --import ./tools/register.mjs tools/_gradecompile.mjs
 */
import { chromium } from 'playwright-core';

const { CompositeShader } = await import('../src/engine/Engine.js');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const out = await page.evaluate(({ fs, vs }) => {
  const gl = document.createElement('canvas').getContext('webgl');
  /* three prepends the attributes and matrices every ShaderMaterial gets; the
   * fragment needs nothing prepended, which is the half being tested. */
  const PRE = 'attribute vec3 position;attribute vec2 uv;'
    + 'uniform mat4 projectionMatrix, modelViewMatrix;\n';
  const one = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? 'OK' : gl.getShaderInfoLog(s).replace(/\0/g, '');
  };
  return { vertex: one(gl.VERTEX_SHADER, PRE + vs), fragment: one(gl.FRAGMENT_SHADER, fs) };
}, { fs: CompositeShader.fragmentShader, vs: CompositeShader.vertexShader });

console.log(`vertex   ${out.vertex}`);
console.log(`fragment ${out.fragment}`);
await browser.close();
process.exit(out.vertex === 'OK' && out.fragment === 'OK' ? 0 : 1);
