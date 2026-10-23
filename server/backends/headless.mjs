// Headless backend: sessions run by `claude -p` (stream-json), each owned by a detached runner (server/headless-runner.mjs).
// The server only talks to runners over their local socket, so it can restart without touching the sessions.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PORT, DATA_DIR, RUN_DIR, PROJECTS_DIR, CLAUDE_BIN, BACKEND_PROBE_TTL_MS,
  HEADLESS_LAUNCH_WAIT_MS, HEADLESS_EARLY_EXIT_MS, RUNNER_CMD_TIMEOUT_MS, RUNNER_RECONNECT_MS, RUNNER_RECONNECT_TRIES,
} from '../config.mjs';
import { pipePath, runFile, encode, newFeed, feed, runnerArgv, parseRunnerArgv } from './protocol.mjs';
import { isPidAlive, projectDirName, safeJsonParse, readSafe, truncate, oneLine } from '../util.mjs';

const RUNNER_PATH = fileURLToPath(new URL('../headless-runner.mjs', import.meta.url));
const NOT_FOUND = 'claude CLI를 찾을 수 없습니다 (PAWGENTS_OFFICE_CLAUDE_BIN 으로 경로를 지정할 수 있어요)';
const DETACHED_MSG = '러너에 연결되지 않은 세션입니다. 잠시 후 다시 시도해주세요.';
const isWin = process.platform === 'win32';
const err = (message, code) => Object.assign(new Error(message), { code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** sid -> { sock, info, feedState, waiters: Map<cmdType, [{resolve, reject, timer}]>, pending: Map (Step 5: permission requests), retries, lastStderr, killing } */
export const runners = new Map();
let stopping = false; // shutdown(): sockets close on purpose, don't reconnect or end sessions

// ---- claude binary -----------------------------------------------------------------------------------------------
let resolved = null;
const isShim = (f) => /\.(cmd|bat)$/i.test(f);
// An npm .cmd shim would make cmd.exe reparse argv; run its cli.js with our node instead when it's there.
function fromShim(file) {
  const cli = path.join(path.dirname(file), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  return fs.existsSync(cli) ? { file: process.execPath, prefix: [cli], shell: false } : { file, prefix: [], shell: true };
}
/** How to start claude: { file, prefix, shell }. Cached until a probe fails (so installing claude later is noticed). */
export function resolveClaude() {
  if (resolved) return resolved;
  if (process.env.PAWGENTS_OFFICE_CLAUDE_BIN) resolved = isShim(CLAUDE_BIN) ? fromShim(CLAUDE_BIN) : { file: CLAUDE_BIN, prefix: [], shell: false };
  else if (isWin) {
    const hits = String(spawnSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h)), shim = hits.find(isShim);
    resolved = exe ? { file: exe, prefix: [], shell: false } : shim ? fromShim(shim) : { file: 'claude', prefix: [], shell: false };
  } else resolved = { file: CLAUDE_BIN, prefix: [], shell: false };
  return resolved;
}
const quote = (c, a) => c.shell && /\s/.test(a) ? `"${a}"` : a; // same rule as the runner: shell:true joins argv with spaces

let probed = null; // { at, result }
/** Is claude runnable, and which version (gates --permission-prompts)? Cached for BACKEND_PROBE_TTL_MS. */
export async function probe() {
  if (probed && Date.now() - probed.at < BACKEND_PROBE_TTL_MS) return probed.result;
  const c = resolveClaude();
  const result = await new Promise((resolve) => execFile(quote(c, c.file), [...c.prefix, '--version'].map((a) => quote(c, a)), { timeout: 5000, windowsHide: true, shell: c.shell }, (e, stdout, stderr) => {
    const v = /(\d+\.\d+\.\d+)/.exec(String(stdout));
    if (!e && v) resolve({ available: true, version: v[1], bin: c.prefix[0] || c.file });
    else resolve({ available: false, reason: e?.code === 'ENOENT' ? NOT_FOUND : truncate(oneLine(stderr || e?.message || 'claude --version failed'), 300) });
  }));
  if (!result.available) resolved = null;
  probed = { at: Date.now(), result };
  return result;
}

// ---- runner env --------------------------------------------------------------------------------------------------
// Set when the office server was started from inside a claude session (ensure-server hook): the child claude would think
// it's nested, and the headless session would be tied to that session's Orca terminal.
const STRIP_ENV = new Set(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ORCA_TERMINAL_HANDLE']);
export function stripClaudeEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (STRIP_ENV.has(isWin ? k.toUpperCase() : k)) delete out[k]; // Windows env names are case-insensitive
  return out;
}
/** Env for the runner (and so claude and its hooks): our port and data dir, so the plugin hooks report to this server. */
export const childEnv = (env = process.env) => ({ ...stripClaudeEnv(env), PAWGENTS_OFFICE_PORT: String(PORT), PAWGENTS_OFFICE_DATA: DATA_DIR });

// ---- runner connection -------------------------------------------------------------------------------------------
function attach(store, h) {
  const s = store.getOrCreateSession(h.sid, { cwd: h.cwd, pid: h.claudePid, model: h.model, startedAt: h.startedAt, backend: 'headless', permissionMode: h.permissionMode });
  store.setBackend(s, 'headless'); // registry or a hook may have created it first
  if (h.claudePid && !s.pid) s.pid = h.claudePid;
  s.transcriptPath ||= path.join(PROJECTS_DIR, projectDirName(h.cwd), `${h.sid}.jsonl`);
  store.emitSession(s);
  return s;
}

function forgetRunFile(sid) {
  try { fs.unlinkSync(runFile(sid)); } catch {}
  if (!isWin) try { fs.unlinkSync(pipePath(sid)); } catch {}
}

function endIfLive(store, sid, reason) {
  const s = store.sessions.get(sid);
  if (s && !s.ended) { store.endSession(s, reason); store.emitSession(s); }
}

function settle(r, key, fn) {
  const q = key ? r.waiters.get(key) : [...r.waiters.values()].find((x) => x.length);
  const w = q?.shift();
  if (!w) return;
  clearTimeout(w.timer); fn(w);
}
function rejectAll(r, e) {
  for (const q of r.waiters.values()) for (const w of q.splice(0)) { clearTimeout(w.timer); w.reject(e); }
}

/** Connect to a runner's socket; resolves with its hello (attached to the store unless claude is already gone). */
function connect(store, sid, info, { onExit } = {}) {
  return new Promise((resolve, reject) => {
    const r = { sock: null, info, feedState: newFeed(), waiters: new Map(), pending: runners.get(sid)?.pending ?? new Map(), retries: 0, lastStderr: null, killing: false };
    const sock = r.sock = net.connect({ path: pipePath(sid) });
    let helloed = false, gotExit = false;
    const helloTimer = setTimeout(() => { if (!helloed) { sock.destroy(); reject(err('runner did not say hello', 'ETIMEDOUT')); } }, RUNNER_CMD_TIMEOUT_MS);
    const onMsg = (m) => {
      if (m.type === 'hello') {
        if (helloed) return;
        helloed = true; clearTimeout(helloTimer);
        r.info = { ...info, claudePid: m.claudePid ?? info.claudePid };
        if (m.alive !== false) { runners.set(sid, r); attach(store, m); } // a dead claude gets no cat; its exit follows
        resolve(m);
        return;
      }
      if (!helloed) return;
      const s = store.sessions.get(sid);
      if (m.type === 'event') {
        if (m.kind === 'stderr') { r.lastStderr = typeof m.line === 'string' ? m.line : r.lastStderr; return; }
        if (!s || s.ended) return;
        if (m.kind === 'init' && m.model && !s.model) s.model = m.model;
        else if (m.kind === 'result' && m.isError) {
          store.log(s, { ev: 'Notification', text: `오류: ${m.subtype || 'error'}` });
          if (s.state !== 'idle') store.setState(s, 'idle'); // no Stop hook follows a failed turn
        } else if (m.kind === 'denied') store.log(s, { ev: 'PermissionRequest', tool: m.tool || '?', text: '→ 거부됨(응답 없음)' });
        else return;
        store.emitSession(s);
      } else if (m.type === 'exit') {
        gotExit = true;
        if (runners.get(sid) === r) runners.delete(sid);
        rejectAll(r, err('claude가 종료되었습니다.', 'headless_exit'));
        const tail = Array.isArray(m.stderrTail) ? m.stderrTail : [];
        // Step 5: finish r.pending permission requests here (deny), or their hooks hang until timeout
        endIfLive(store, sid, r.killing ? 'killed' : m.code ? `claude 종료 (code ${m.code}): ${truncate(oneLine(tail.at(-1) || r.lastStderr || ''), 200)}` : 'process exited');
        onExit?.(m);
      } else if (m.type === 'ack') settle(r, m.for, (w) => m.ok ? w.resolve(m) : w.reject(err(m.error || 'runner refused', 'headless_exit')));
      else if (m.type === 'status') settle(r, 'status', (w) => w.resolve(m));
      else if (m.type === 'error') settle(r, null, (w) => w.reject(err(m.message || 'runner error', 'headless_exit')));
    };
    sock.setEncoding('utf8');
    sock.on('data', (d) => feed(r.feedState, d, onMsg));
    sock.on('error', (e) => { if (!helloed) { clearTimeout(helloTimer); reject(e); } });
    sock.on('close', () => {
      clearTimeout(helloTimer);
      rejectAll(r, err(DETACHED_MSG, 'detached'));
      if (!helloed) return reject(err('runner closed the connection', 'ECONNRESET'));
      if (runners.get(sid) === r) runners.delete(sid);
      if (gotExit || stopping) return;
      reconnect(store, sid, r.info); // runner still up (we dropped, it didn't)? try again; otherwise the session is over
    });
  });
}

async function reconnect(store, sid, info) {
  for (let i = 0; i < RUNNER_RECONNECT_TRIES && isPidAlive(info.pid); i++) {
    await sleep(RUNNER_RECONNECT_MS);
    if (stopping || runners.has(sid)) return;
    try { await connect(store, sid, info); return; } catch {}
  }
  if (stopping || runners.has(sid)) return;
  endIfLive(store, sid, 'runner exited');
  forgetRunFile(sid);
}

/** Send a command and wait for the runner's answer (ack / status). */
function command(sid, cmd) {
  const r = runners.get(sid);
  if (!r) return Promise.reject(err(DETACHED_MSG, 'detached'));
  return new Promise((resolve, reject) => {
    const key = cmd.type, q = r.waiters.get(key) ?? [];
    r.waiters.set(key, q);
    const w = { resolve, reject, timer: setTimeout(() => { const i = q.indexOf(w); if (i >= 0) q.splice(i, 1); reject(err('러너가 응답하지 않습니다.', 'detached')); }, RUNNER_CMD_TIMEOUT_MS) };
    q.push(w); // acks come back in order, so per-type FIFO pairs them up
    try { r.sock.write(encode(cmd)); } catch (e) { clearTimeout(w.timer); q.splice(q.indexOf(w), 1); reject(err(DETACHED_MSG, 'detached')); }
  });
}

// ---- launch ------------------------------------------------------------------------------------------------------
async function waitRunFile(sid) {
  const end = Date.now() + HEADLESS_LAUNCH_WAIT_MS;
  while (Date.now() < end) {
    const info = safeJsonParse(readSafe(runFile(sid))); // ENOENT / partial read -> null, keep polling
    if (info?.sid === sid) return info;
    await sleep(100);
  }
  return null;
}

const exitReason = (m) => (Array.isArray(m?.stderrTail) ? m.stderrTail.join(' ') : '').slice(0, 300) || 'claude가 바로 종료되었습니다';

/** Start a runner + claude in `cwd`, wait until it's clearly up, then send the first prompt. Resolves with the session. */
export async function launch(store, { cwd, prompt, model, permissionMode }) {
  const p = await probe();
  if (!p.available) throw err(p.reason, 'headless_unavailable');
  const sid = randomUUID();
  // settingsFile: Step 5 (permission hook) fills this in via ensureSettingsFile()
  const spec = { sid, cwd, model: model || null, permissionMode: permissionMode || 'default', settingsFile: null, claude: resolveClaude(), version: p.version };
  parseRunnerArgv(runnerArgv(spec)); // fail here, with a stack, rather than in a detached runner nobody watches
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const child = spawn(process.execPath, [RUNNER_PATH, ...runnerArgv(spec)], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv(), cwd });
  child.on('error', () => {}); // shows up as a missing run file below
  child.unref();
  const info = await waitRunFile(sid);
  if (!info) throw err('러너가 시작되지 않았습니다', 'headless_exit');
  let exited = null, wake = null;
  const hello = await connect(store, sid, info, { onExit: (m) => { exited = m; wake?.(); } });
  if (hello.alive === false) throw err(exitReason(hello), 'headless_exit');
  if (!exited) await new Promise((r) => { wake = r; setTimeout(r, HEADLESS_EARLY_EXIT_MS); }); // not logged in / bad flag: claude dies right away
  if (exited) throw err(exitReason(exited), 'headless_exit');
  if (prompt) await command(sid, { type: 'prompt', text: prompt });
  return store.sessions.get(sid);
}

export const has = (sid) => runners.has(sid);
export const sendPrompt = (store, s, text) => command(s.id, { type: 'prompt', text });

/** Default: close claude's stdin (it finishes the turn, runs SessionEnd, exits). force: kill the process tree now. */
export function closeSession(store, s, { force = false } = {}) {
  if (!force) return command(s.id, { type: 'close' });
  // Step 5: deny every pending permission request first, or the turn stays blocked on the hook
  const r = runners.get(s.id);
  if (r) r.killing = true;
  return command(s.id, { type: 'kill' });
}

// ---- server lifecycle --------------------------------------------------------------------------------------------
/** Boot: reconnect to every runner that outlived the previous server. Returns how many sessions came back. */
export async function restore(store) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const files = fs.readdirSync(RUN_DIR).filter((f) => /^[0-9a-f-]{36}\.json$/i.test(f));
  const results = await Promise.all(files.map(async (f) => {
    const sid = f.slice(0, -5), info = safeJsonParse(readSafe(path.join(RUN_DIR, f)));
    if (!info || info.sid !== sid || !Number.isInteger(info.pid)) return 0; // half-written or foreign: leave it
    if (!isPidAlive(info.pid)) { forgetRunFile(sid); return 0; }
    for (let i = 0; ; i++) {
      try { return (await connect(store, sid, info)).alive === false ? 0 : 1; } catch (e) {
        // no pipe / nobody listening: the pid was reused by something else, so retrying won't help
        if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED' || i + 1 >= RUNNER_RECONNECT_TRIES) { forgetRunFile(sid); console.error(`[headless] ${sid.slice(0, 8)}: runner unreachable (${e.code || e.message}), forgotten`); return 0; }
        await sleep(RUNNER_RECONNECT_MS);
      }
    }
  }));
  return results.reduce((a, b) => a + b, 0);
}

/** Server exit: drop our sockets only. Runners and their claude keep going until the next server reconnects. */
export function shutdown() {
  stopping = true;
  for (const r of runners.values()) r.sock?.destroy();
}
