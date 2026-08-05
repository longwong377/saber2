/**
 * Maps the browser importmap's bare specifiers onto the vendored files so the
 * same source runs unmodified under Node for testing. No node_modules, no
 * build step, one copy of the engine.
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolvePath(HERE, '..', 'vendor', 'three');

export async function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: pathToFileURL(resolvePath(VENDOR, 'three.module.js')).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    return { url: pathToFileURL(resolvePath(VENDOR, specifier.slice('three/addons/'.length))).href, shortCircuit: true };
  }
  return next(specifier, context);
}
