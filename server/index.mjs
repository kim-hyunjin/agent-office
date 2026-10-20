import http from 'node:http';
import {
  PORT, HOST, MAX_BODY_BYTES, GC_INTERVAL_MS, REGISTRY_POLL_MS, TRANSCRIPT_POLL_MS, STATE_FILE,
} from './config.mjs';
import { Store } from './store.mjs';
import { applyHook } from './reducer.mjs';
import { Sse } from './sse.mjs';
import { serveStatic } from './static.mjs';
import { pollRegistry } from './registry.mjs';
import { Tailer } from './transcript.mjs';
import { safeJsonParse } from './util.mjs';

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/hook') {
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
