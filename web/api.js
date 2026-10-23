// Same-origin JSON calls. The server answers errors as { error } (Korean, shown to the user as is).
/** body !== undefined: sent as JSON (some routes need the JSON content-type even with an empty body — CSRF guard). */
export async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let d = {};
  try { const text = await r.text(); if (text) d = JSON.parse(text); } catch { /* empty or non-JSON body */ }
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d ?? {};
}
export const post = (url, body = {}) => api(url, { method: 'POST', body });

/** Send a session home. force: close its Orca terminal tab instead of typing /exit (it isn't idle). */
export const closeSession = (id, force) => post(`/sessions/${encodeURIComponent(id)}/close`, { force });

/** Answer a headless session's parked permission request (reqId from s.pendingPermissions). */
export const decidePermission = (id, reqId, allow) => post(`/sessions/${encodeURIComponent(id)}/permission`, { id: reqId, allow });
