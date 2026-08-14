/**
 * A static server for local play. No build step — this just hands the browser
 * the same files that would sit on any static host.
 *
 *   node tools/serve.mjs [port]
 *
 * It is deliberately small, but "small" has to stop short of lying about what
 * the files are. Two things it used to get wrong, both of which only the one
 * non-procedural asset in the project could see:
 *
 *   THE TYPE. The MIME table had ten extensions in it and `.mp3` was not one of
 *   them, so `assets/music/theme.mp3` — the 28 MB soundtrack, the only file
 *   here that is not generated in code — went out as `application/octet-stream`.
 *
 *   THE RANGE. Every request was answered with a 200 and the whole body, read
 *   into memory with readFile. A media element asks for byte ranges, Safari
 *   REFUSES an <audio>/<video> source from a server that does not honour them
 *   (it opens with `Range: bytes=0-1` and wants a 206 back), and a 28 MB file
 *   buffered per request is a 28 MB allocation per seek. Measured against this
 *   server before the fix: `GET /assets/music/theme.mp3` with
 *   `Range: bytes=0-1` returned `HTTP/1.1 200`, `application/octet-stream`, no
 *   Accept-Ranges, no Content-Range, and 29,400,953 bytes of body.
 *
 * The handler is exported so tools/checks/music.mjs can drive it directly on an
 * ephemeral port rather than assert on the shape of this file.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.wasm': 'application/wasm',
  // The score, and the two containers a replacement is most likely to arrive in.
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};

/** `bytes=0-1`, `bytes=500-`, `bytes=-500` → {start, end} inside `size`. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {                       // the LAST n bytes
    const n = Number(m[2]);
    if (!(n > 0)) return null;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

export function handler(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  const size = statSync(file).size;
  const head = {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    // Advertised on everything, because a client cannot ask for a range it has
    // not been told it may ask for.
    'Accept-Ranges': 'bytes',
  };
  const range = req.headers?.range ? parseRange(req.headers.range, size) : null;
  // A Range header this server cannot satisfy is a 416, not a silent whole
  // file: a media element that gets the whole file back from a range request
  // has no way to tell that its seek did not happen.
  if (req.headers?.range && !range) {
    res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  head['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (range) head['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, head);
  if (req.method === 'HEAD' || size === 0) { res.end(); return; }
  // Streamed, not buffered: the score is 28 MB and a seek is a new request.
  const s = createReadStream(file, { start, end });
  s.on('error', () => { try { res.destroy(); } catch {} });
  s.pipe(res);
}

/** Only listen when this file is the thing that was run. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handler).listen(PORT, () => {
    console.log(`\n  SABER is running.\n\n    http://localhost:${PORT}\n`);
  });
}
