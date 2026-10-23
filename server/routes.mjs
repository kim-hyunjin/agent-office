// The HTTP API as a table: [method, path or RegExp, handler]. index.mjs matches in order; RegExp groups arrive
// as `params`, already %-decoded. Anything unmatched falls through to static files (GET) or 404.
import fs from 'node:fs';
import path from 'node:path';
import { MAX_BODY_BYTES, MAX_PROMPT_CHARS } from './config.mjs';
import { CAT_FAMILIES, BREED_KEY, DEFAULT_OFFICE_ID } from './store.mjs';
import { DEFAULT_OFFICE, cloneOffice, normalize, validate } from '../web/layout.js';
import { isName, MAX_NAME_CHARS, MAX_HIRES, WORKTREE_NAME_RE, MIN_CELL, MAX_CELL, isCell } from '../web/limits.js';
import { hasSkin, skinError } from './skins.mjs';
import { applyHook } from './reducer.mjs';
import { sendFile } from './static.mjs';
import { safeJsonParse, truncate, oneLine } from './util.mjs';
import { readBody, tooLarge, json, readJson, findSession, orcaError, isOwnHost } from './http.mjs';
import { fileDiff } from './diff.mjs';
import { scheduleFileSync } from './files.mjs';
import { listWorktrees, sendPrompt, closeSession, launchClaude, createWorktreeWithClaude } from './backends/orca.mjs';
import { backends } from './backends/index.mjs';

/** @returns {Array<[string, string | RegExp, (ctx: { req, res, url: URL, params: string[] }) => unknown]>} */
export function makeRoutes({ store, sse }) {
  // The office routes read the body first, so 403 / 413 / 400 win over a 404 for an unknown office.
  const officeCtx = async ({ req, res, params: [id] }) => {
    const office = store.office(id);
    const data = await readJson(req, res);
    if (!data) return null;
    if (!office) { json(res, 404, { error: '사무실이 없습니다.' }); return null; }
    return { id, office, data };
  };

  return [
    ['POST', '/hook', async ({ req, res }) => {
      if (req.headers.origin) { res.writeHead(403); res.end(); return; } // hooks never send Origin; browsers always do
      let body = '';
      try { body = await readBody(req, MAX_BODY_BYTES); } catch { tooLarge(req, res); return; }
      const ev = safeJsonParse(body);
      const s = ev ? applyHook(store, ev) : null;
      if (s && ev) {
        const ent = ev.agent_id ? s.subagents.get(String(ev.agent_id)) : s;
        const t = ev.tool_name ? ` ${ev.tool_name}${ent?.currentTool?.target ? ' · ' + ent.currentTool.target : ''}` : '';
        const who = ev.agent_id ? ` [agent ${String(ev.agent_id).slice(0, 8)}]` : '';
        console.log(`[hook] ${ev.hook_event_name}${t}  ${s.name} (${s.id.slice(0, 8)})${who} → ${ent?.state ?? s.state}`);
      }
      res.writeHead(204); res.end();
    }],
    ['GET', '/events', ({ req, res }) => sse.add(req, res, { type: 'snapshot', data: store.snapshot() })],
    ['GET', '/state', ({ res }) => json(res, 200, store.snapshot())],
    ['GET', '/backends', async ({ res }) => json(res, 200, await backends())],
    ['GET', '/healthz', ({ res }) => { res.writeHead(200); res.end('ok'); }],
    ['GET', /^\/sessions\/([^/]+)\/log$/, ({ res, params: [id] }) => {
      const s = findSession(store, res, id);
      if (!s) return;
      if (!s.ended) scheduleFileSync(store, s); // the panel just opened: freshen its worked files
      json(res, 200, { id: s.id, log: s.log.toArray() });
    }],
    ['GET', /^\/sessions\/([^/]+)\/reply$/, ({ res, url, params: [id] }) => {
      const s = findSession(store, res, id);
      if (!s) return;
      const agentId = url.searchParams.get('agent');
      const ent = agentId ? s.subagents.get(agentId) : s;
      if (!ent) { json(res, 404, { error: 'not found' }); return; }
      json(res, 200, { id: s.id, agentId, text: ent.replyText || ent.lastText || '', at: ent.lastTextAt });
    }],
    ['GET', /^\/sessions\/([^/]+)\/diff$/, async ({ req, res, url, params: [id] }) => {
      if (!isOwnHost(req)) { json(res, 403, { error: 'forbidden' }); return; } // whole files go out here: no DNS rebinding
      const s = findSession(store, res, id);
      if (!s) return;
      const file = String(url.searchParams.get('file') || '');
      const f = file ? s.files.get(path.normalize(file)) : null; // only files this session's tools touched
      if (!f) { json(res, 404, { error: '이 세션이 작업한 파일이 아닙니다.' }); return; }
      try {
        const d = await fileDiff(s.cwd, f.path, { since: s.startedAt - 60_000 });
        json(res, 200, { file: f.path, ...d });
      } catch (e) {
        json(res, e.code === 'not_repo' ? 409 : e.code === 'outside' ? 400 : 502, { error: e.message, code: e.code });
      }
    }],
    ['POST', /^\/sessions\/([^/]+)\/prompt$/, async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const s = findSession(store, res, id, { live: true, msg: '세션이 없거나 종료되었습니다.' });
      if (!s) return;
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
    }],
    ['POST', /^\/sessions\/([^/]+)\/close$/, async ({ req, res, params: [id] }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const s = findSession(store, res, id, { live: true, msg: '세션이 없거나 이미 종료되었습니다.' });
      if (!s) return;
      const force = data.force === true;
      // `/exit` is only safe at an idle prompt; the client re-asks with force otherwise.
      if (!force && s.state !== 'idle') { json(res, 409, { error: '작업 중이거나 응답 대기 중이라 /exit 를 보낼 수 없습니다. 강제 종료를 쓰세요.', code: 'busy' }); return; }
      try {
        await closeSession(store, s, { force });
        console.log(`[web] close${force ? ' (force)' : ''} → ${s.name} (${s.id.slice(0, 8)})`);
        json(res, 200, { ok: true });
      } catch (e) { orcaError(res, e); }
    }],
    ['GET', '/orca/worktrees', async ({ res }) => {
      try { json(res, 200, { worktrees: await listWorktrees() }); } catch (e) { orcaError(res, e); }
    }],
    ['POST', '/settings/together', async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const id = data.officeId == null ? null : String(data.officeId);
      if (id !== null && !store.office(id)) { json(res, 404, { error: '사무실이 없습니다.' }); return; }
      store.setTogether(id);
      console.log(`[web] ${id ? `everyone works in ${store.office(id).name}` : 'back to one office per repo'}`);
      json(res, 200, { ok: true });
    }],
    ['POST', /^\/offices\/([^/]+)\/layout$/, async (ctx) => {
      const o = await officeCtx(ctx);
      if (!o) return;
      const layout = normalize(o.data.layout), errs = validate(layout);
      if (errs.length) { json(ctx.res, 400, { error: errs.map((e) => e.msg).join(' / ') }); return; }
      store.setLayout(o.id, layout);
      console.log(`[web] layout saved: ${o.office.name}`);
      json(ctx.res, 200, { ok: true });
    }],
    ['POST', /^\/offices\/([^/]+)\/reset$/, async (ctx) => {
      const o = await officeCtx(ctx);
      if (!o) return;
      store.setLayout(o.id, cloneOffice(DEFAULT_OFFICE));
      json(ctx.res, 200, { ok: true });
    }],
    ['POST', /^\/offices\/([^/]+)$/, async (ctx) => {
      const o = await officeCtx(ctx);
      if (!o) return;
      const name = String(o.data.name ?? '').trim();
      if (!isName(name)) { json(ctx.res, 400, { error: `사무실 이름은 1–${MAX_NAME_CHARS}자여야 합니다.` }); return; }
      store.renameOffice(o.id, name);
      json(ctx.res, 200, { ok: true });
    }],
    ['DELETE', /^\/offices\/([^/]+)$/, async (ctx) => {
      const o = await officeCtx(ctx);
      if (!o) return;
      if (o.id === DEFAULT_OFFICE_ID) { json(ctx.res, 400, { error: '기본 사무실은 닫을 수 없습니다.' }); return; }
      store.deleteOffice(o.id);
      console.log(`[web] office closed: ${o.office.name}`);
      json(ctx.res, 200, { ok: true });
    }],
    ['POST', '/settings/cats', async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const fam = String(data.family || ''), breed = data.breed == null ? null : String(data.breed);
      if (!CAT_FAMILIES.includes(fam) || (breed !== null && (!BREED_KEY.test(breed) || !store.hasBreed(breed)))) { json(res, 400, { error: '잘못된 요청입니다.' }); return; }
      store.setCat(fam, breed);
      json(res, 200, { ok: true, cats: store.cats });
    }],
    ['POST', '/skins', async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const name = String(data.name ?? '').trim(), cellW = Number(data.cellW), cellH = Number(data.cellH);
      if (!isName(name)) { json(res, 400, { error: `스킨 이름은 1–${MAX_NAME_CHARS}자여야 합니다.` }); return; }
      if (!isCell(cellW) || !isCell(cellH)) { json(res, 400, { error: `칸 크기는 ${MIN_CELL}–${MAX_CELL}px이어야 합니다.` }); return; }
      const png = Buffer.from(String(data.png ?? '').replace(/^data:image\/png;base64,/, ''), 'base64');
      const err = skinError(png, cellW, cellH);
      if (err) { json(res, 400, { error: err }); return; }
      const skin = store.addSkin({ name, cellW, cellH }, png);
      console.log(`[web] skin uploaded: ${name} (${skin.id})`);
      json(res, 200, { ok: true, skin });
    }],
    ['GET', /^\/skins\/([a-z0-9]{10})\.png$/, ({ res, params: [id] }) => {
      const file = hasSkin(store.skins, id) ? store.skinFile(id) : null;
      if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      // ids are never reused, so the image under one can be cached for good
      sendFile(res, file, null, { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'max-age=31536000, immutable' });
    }],
    ['POST', /^\/skins\/([a-z0-9]{10})\/delete$/, async ({ req, res, params: [id] }) => {
      if (!(await readJson(req, res))) return; // body unused, but a same-origin JSON POST is the CSRF guard
      if (!store.removeSkin(id)) { json(res, 404, { error: '없는 스킨입니다.' }); return; }
      json(res, 200, { ok: true });
    }],
    ['POST', '/orca/launch', async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const worktreeId = String(data.worktreeId || '');
      const prompt = String(data.prompt ?? '').trim();
      const model = String(data.model || '').trim();
      const count = Number(data.count ?? 1);
      // newWorktree: branch a fresh worktree off the selected one per hire, named name / name-1, name-2, …
      const name = data.newWorktree ? String(data.newWorktree.name || '').trim() : null;
      if (!worktreeId || prompt.length > MAX_PROMPT_CHARS || (model && !/^[\w.\-\[\]]{1,80}$/.test(model))
        || !Number.isInteger(count) || count < 1 || count > MAX_HIRES || (name !== null && !WORKTREE_NAME_RE.test(name))) {
        json(res, 400, { error: '잘못된 요청입니다.' }); return;
      }
      try {
        const base = (await listWorktrees()).find((w) => w.id === worktreeId);
        if (!base) { json(res, 400, { error: '알 수 없는 워크트리입니다.' }); return; }
        if (name !== null && !base.branch && !base.head) { json(res, 400, { error: '기준 워크트리의 브랜치를 알 수 없습니다.' }); return; }
        // one at a time: Orca creates checkouts / tabs sequentially anyway, and a failure shouldn't hide the rest
        const started = [], errors = [];
        for (let i = 1; i <= count; i++) {
          const wtName = name === null ? null : count > 1 ? `${name}-${i}` : name;
          try {
            if (wtName) await createWorktreeWithClaude({ base, name: wtName, prompt, model });
            else await launchClaude({ worktreeId, prompt, model });
            started.push(wtName || base.path);
            console.log(`[web] launch claude in ${wtName ? `new worktree ${wtName} (from ${base.branch || base.head})` : base.path}${prompt ? ': ' + truncate(oneLine(prompt), 80) : ''}`);
          } catch (e) { errors.push(`${wtName || `#${i}`}: ${e.message}`); }
        }
        if (!started.length) { json(res, 502, { error: errors.join('\n') }); return; }
        json(res, 200, { ok: true, started: started.length, errors });
      } catch (e) { orcaError(res, e); }
    }],
  ];
}
