import http from 'node:http';
import {
  PORT, HOST, MAX_BODY_BYTES, MAX_PROMPT_CHARS, GC_INTERVAL_MS, REGISTRY_POLL_MS, TRANSCRIPT_POLL_MS, STATE_FILE,
} from './config.mjs';
import { Store } from './store.mjs';
import { applyHook } from './reducer.mjs';
import { Sse } from './sse.mjs';
import { serveStatic } from './static.mjs';
import { pollRegistry } from './registry.mjs';
import { Tailer } from './transcript.mjs';
import { safeJsonParse, truncate, oneLine } from './util.mjs';
import { listWorktrees, sendPrompt, closeSession, launchClaude } from './orca.mjs';

const store = new Store();
store.load();
const sse = new Sse();
store.on((type, data) => sse.send(type, data));
const tailer = new Tailer(store);

// Boot: rebuild from the live session registry + transcripts before accepting clients.
pollRegistry(store);
tailer.tick();

function readBody(req, limit) {
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

function json(res, status, data) {
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

async function readJson(req, res) {
  if (!isOwnPage(req)) { json(res, 403, { error: 'forbidden' }); return null; }
  let body;
  try { body = await readBody(req, MAX_BODY_BYTES); } catch { json(res, 413, { error: 'body too large' }); return null; }
  const data = safeJsonParse(body);
  if (!data || typeof data !== 'object') { json(res, 400, { error: 'bad json' }); return null; }
  return data;
}

const orcaError = (res, e) => json(res, e.code === 'terminal_not_found' || e.code === 'not_claude' ? 409 : 502, { error: e.message, code: e.code });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/hook') {
      if (req.headers.origin) { res.writeHead(403); res.end(); return; } // hooks never send Origin; browsers always do
      let body = '';
      try { body = await readBody(req, MAX_BODY_BYTES); } catch { res.writeHead(413); res.end(); return; }
      const ev = safeJsonParse(body);
      const s = ev ? applyHook(store, ev) : null;
      if (s && ev) {
        const ent = ev.agent_id ? s.subagents.get(String(ev.agent_id)) : s;
        const t = ev.tool_name ? ` ${ev.tool_name}${ent?.currentTool?.target ? ' · ' + ent.currentTool.target : ''}` : '';
        const who = ev.agent_id ? ` [agent ${String(ev.agent_id).slice(0, 8)}]` : '';
        console.log(`[hook] ${ev.hook_event_name}${t}  ${s.name} (${s.id.slice(0, 8)})${who} → ${ent?.state ?? s.state}`);
      }
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === 'GET' && p === '/events') {
      sse.add(req, res, { type: 'snapshot', data: store.snapshot() });
      return;
    }
    if (req.method === 'GET' && p === '/state') { json(res, 200, store.snapshot()); return; }
    if (req.method === 'GET' && p === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    const m = req.method === 'GET' && p.match(/^\/sessions\/([^/]+)\/log$/);
    if (m) {
      const s = store.sessions.get(decodeURIComponent(m[1]));
      if (!s) { json(res, 404, { error: 'not found' }); return; }
      json(res, 200, { id: s.id, log: s.log.toArray() });
      return;
    }
    const pm = req.method === 'POST' && p.match(/^\/sessions\/([^/]+)\/prompt$/);
    if (pm) {
      const data = await readJson(req, res);
      if (!data) return;
      const s = store.sessions.get(decodeURIComponent(pm[1]));
      if (!s || s.ended) { json(res, 404, { error: '세션이 없거나 종료되었습니다.' }); return; }
      const text = String(data.text ?? '').trim();
      if (!text || text.length > MAX_PROMPT_CHARS) { json(res, 400, { error: `지시는 1–${MAX_PROMPT_CHARS}자여야 합니다.` }); return; }
      // A permission/question dialog would take our Enter as its default answer.
      if (s.state === 'waiting') { json(res, 409, { error: '권한 승인·질문 응답을 기다리는 중입니다. 터미널에서 먼저 답해주세요.', code: 'waiting' }); return; }
      try {
        const r = await sendPrompt(store, s, text);
        console.log(`[web] prompt → ${s.name} (${s.id.slice(0, 8)}): ${truncate(oneLine(text), 80)}`);
        store.emitSession(s);
        json(res, 200, { ok: true, accepted: r?.accepted ?? true });
      } catch (e) { orcaError(res, e); }
      return;
    }
    const cm = req.method === 'POST' && p.match(/^\/sessions\/([^/]+)\/close$/);
    if (cm) {
      const data = await readJson(req, res);
      if (!data) return;
      const s = store.sessions.get(decodeURIComponent(cm[1]));
      if (!s || s.ended) { json(res, 404, { error: '세션이 없거나 이미 종료되었습니다.' }); return; }
      const force = data.force === true;
      // `/exit` is only safe at an idle prompt; the client re-asks with force otherwise.
      if (!force && s.state !== 'idle') { json(res, 409, { error: '작업 중이거나 응답 대기 중이라 /exit 를 보낼 수 없습니다. 강제 종료를 쓰세요.', code: 'busy' }); return; }
      try {
        await closeSession(store, s, { force });
        console.log(`[web] close${force ? ' (force)' : ''} → ${s.name} (${s.id.slice(0, 8)})`);
        json(res, 200, { ok: true });
      } catch (e) { orcaError(res, e); }
      return;
    }
    if (req.method === 'GET' && p === '/orca/worktrees') {
      try { json(res, 200, { worktrees: await listWorktrees() }); } catch (e) { orcaError(res, e); }
      return;
    }
    if (req.method === 'POST' && p === '/orca/launch') {
      const data = await readJson(req, res);
      if (!data) return;
      const worktreeId = String(data.worktreeId || '');
      const prompt = String(data.prompt ?? '').trim();
      const model = String(data.model || '').trim();
      if (!worktreeId || prompt.length > MAX_PROMPT_CHARS || (model && !/^[\w.\-\[\]]{1,80}$/.test(model))) { json(res, 400, { error: '잘못된 요청입니다.' }); return; }
      try {
        const known = await listWorktrees();
        if (!known.some((w) => w.id === worktreeId)) { json(res, 400, { error: '알 수 없는 워크트리입니다.' }); return; }
        const r = await launchClaude({ worktreeId, prompt, model });
        console.log(`[web] launch claude in ${worktreeId.split('::').pop()}${prompt ? ': ' + truncate(oneLine(prompt), 80) : ''}`);
        json(res, 200, { ok: true, kind: r?.launch?.outcome?.kind || r?.outcome?.kind || null, promptOutcome: r?.launch?.prompt?.outcome || r?.prompt?.outcome || null });
      } catch (e) { orcaError(res, e); }
      return;
    }
    if (req.method === 'GET' && serveStatic(p, res)) return;
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is another agent-office running? Set AGENT_OFFICE_PORT to change it.`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`agent-office  →  http://${HOST}:${PORT}`);
  console.log(`desk memory: ${STATE_FILE}`);
  console.log(`sessions restored: ${store.sessions.size}`);
});

setInterval(() => store.gc(), GC_INTERVAL_MS).unref();
setInterval(() => pollRegistry(store), REGISTRY_POLL_MS).unref();
setInterval(() => tailer.tick(), TRANSCRIPT_POLL_MS).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { store.saveNow(); process.exit(0); });
}
