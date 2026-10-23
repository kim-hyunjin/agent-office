// Request plumbing shared by the routes: bodies, JSON replies, the same-origin guard.
import { PORT, MAX_BODY_BYTES } from './config.mjs';
import { safeJsonParse } from './util.mjs';

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}

// Endpoints that type into terminals must come from our own page: a same-origin JSON POST.
// Host check blocks DNS rebinding; Origin + JSON content-type block cross-site form/fetch posts.
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function isOwnPage(req) {
  const host = req.headers.host || '';
  return OWN_HOSTS.has(host) && req.headers.origin === `http://${host}`
    && /^application\/json(;|$)/i.test(req.headers['content-type'] || '');
}

/** The JSON body of a same-origin request, or null after answering 403 / 413 / 400. */
export async function readJson(req, res) {
  if (!isOwnPage(req)) { json(res, 403, { error: 'forbidden' }); return null; }
  let body;
  try { body = await readBody(req, MAX_BODY_BYTES); } catch { json(res, 413, { error: 'body too large' }); return null; }
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

export const orcaError = (res, e) => json(res, e.code === 'terminal_not_found' || e.code === 'not_claude' ? 409 : 502, { error: e.message, code: e.code });
