// Request plumbing shared by the routes: bodies, JSON replies, the same-origin guard.
import { PORT, MAX_BODY_BYTES } from './config.mjs';
import { safeJsonParse } from './util.mjs';

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Stop reading but keep the socket open: the 413 still has to reach the client (see tooLarge).
      if (size > limit) { req.removeAllListeners('data'); req.pause(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Answer 413 and close the connection once the reply has gone out; the unread rest of the body dies with the socket. */
export function tooLarge(req, res, data) {
  res.on('finish', () => req.destroy());
  const headers = { Connection: 'close' };
  if (data) Object.assign(headers, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.writeHead(413, headers);
  res.end(data ? JSON.stringify(data) : undefined);
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}

// Endpoints that type into terminals must come from our own page: a same-origin JSON POST.
// Host check blocks DNS rebinding; Origin + JSON content-type block cross-site form/fetch posts.
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
/** The Host header names us (not a DNS-rebound name): enough for GETs that hand out source code. */
export const isOwnHost = (req) => OWN_HOSTS.has(req.headers.host || '');
function isOwnPage(req) {
  const host = req.headers.host || '';
  return isOwnHost(req) && req.headers.origin === `http://${host}`
    && /^application\/json(;|$)/i.test(req.headers['content-type'] || '');
}

/** The JSON body of a same-origin request, or null after answering 403 / 413 / 400. */
export async function readJson(req, res) {
  if (!isOwnPage(req)) { json(res, 403, { error: 'forbidden' }); return null; }
  let body;
  try { body = await readBody(req, MAX_BODY_BYTES); } catch { tooLarge(req, res, { error: 'body too large' }); return null; }
  const data = safeJsonParse(body);
  if (!data || typeof data !== 'object') { json(res, 400, { error: 'bad json' }); return null; }
  return data;
}

/** Session `id`, or null after answering 404 with `msg`; `live` also turns away ended sessions. */
export function findSession(store, res, id, { live = false, msg = 'not found' } = {}) {
  const s = store.sessions.get(id);
  if (!s || (live && s.ended)) { json(res, 404, { error: msg }); return null; }
  return s;
}

// Backend failures the user can act on (wrong tab, claude died, runner not attached, git refused) are 409; the rest is upstream trouble.
export const BACKEND_ERROR_STATUS = { terminal_not_found: 409, not_claude: 409, headless_exit: 409, detached: 409, headless_unavailable: 409, git_failed: 409, ENOENT: 502 };
export const backendStatus = (code) => BACKEND_ERROR_STATUS[code] ?? 502;
export const backendError = (res, e) => json(res, backendStatus(e?.code), { error: e?.message || String(e), code: e?.code });
