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
 *   THE VALIDATOR. `Cache-Control: no-cache` went out on everything, with no
 *   ETag and no Last-Modified anywhere in the file — and `no-cache` without a
 *   validator is strictly worse than sending no Cache-Control at all, because
 *   it forbids the heuristic freshness a browser would otherwise give a static
 *   file and then offers nothing to revalidate with. Measured in Chromium
 *   against this server: first load 73 responses, 200x73, 304x0, 7,132,433
 *   bytes; F5 in the same context, 73 responses, 200x73, 304x0, 7,132,433
 *   bytes — byte for byte identical, 0 of 72 resources served from cache. The
 *   browser was never given anything it could ask about. Of the three servers
 *   index.html suggests when the page is opened from file://, the other two
 *   both answer conditional requests; this one now does too.
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

/**
 * What this exact file, right now, is — `"<mtime-ms>-<size>"`, in hex.
 *
 * Both halves come off the `statSync` the handler already does, so it costs
 * nothing: a rebuilt file changes its mtime, an edited one almost always
 * changes its size too, and either moves the tag. Weak (`W/`) because the two
 * numbers say the file is the same file, not that it is byte-identical — which
 * is exactly the guarantee a static dev server can make, and enough for the
 * only thing anyone does with it here, which is skip a body it already holds.
 */
export function etagOf(stat) {
  return `W/"${Math.round(stat.mtimeMs).toString(16)}-${stat.size.toString(16)}"`;
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
  const stat = statSync(file);
  const size = stat.size;
  const etag = etagOf(stat);
  const head = {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    // `no-cache` means REVALIDATE, not "do not store" — so it needs something
    // to revalidate WITH, and for four years it had neither of the two things
    // that can play that part. Both go out now, and the 304 below is what makes
    // them mean anything.
    'Cache-Control': 'no-cache',
    'ETag': etag,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
    // Advertised on everything, because a client cannot ask for a range it has
    // not been told it may ask for.
    'Accept-Ranges': 'bytes',
  };

  /*
   * THE CONDITIONAL, and it is checked before the Range is.
   *
   * RFC 9110 §13.2.2: If-None-Match takes precedence over If-Modified-Since,
   * and a range request whose precondition fails is answered with the 304 and
   * not with a 206 of a body the client already has. `If-None-Match: *` matches
   * anything that exists, and a client may send a LIST of tags — so this
   * compares against every one of them rather than string-equalling the header.
   * A weak comparison is the right one here (both sides are W/-tagged and the
   * spec requires the weak comparator for If-None-Match anyway).
   */
  const inm = req.headers?.['if-none-match'];
  const ims = req.headers?.['if-modified-since'];
  const weak = (t) => String(t).trim().replace(/^W\//, '');
  const matched = inm
    ? (inm.trim() === '*' || inm.split(',').some(t => weak(t) === weak(etag)))
    // Second-resolution, so the file's own sub-second mtime is floored before
    // the comparison — otherwise a file saved at .400 is "newer" than the
    // header a browser echoed back from the same response, for ever.
    : (ims ? Math.floor(stat.mtimeMs / 1000) * 1000 <= Date.parse(ims) : false);
  if (matched && (req.method === 'GET' || req.method === 'HEAD')) {
    // A 304 carries no body and no Content-Length of its own.
    res.writeHead(304, {
      'Cache-Control': head['Cache-Control'], 'ETag': etag,
      'Last-Modified': head['Last-Modified'], 'Accept-Ranges': 'bytes',
    });
    res.end();
    return;
  }

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
