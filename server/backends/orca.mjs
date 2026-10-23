import { execFile } from 'node:child_process';
import path from 'node:path';
import { ORCA_BIN, BACKEND_PROBE_TTL_MS } from '../config.mjs';
import { isPidAlive } from '../util.mjs';

const orcaErr = (message, code) => Object.assign(new Error(message), { code });

/** Run `orca <args> --json` and return `result`. Throws Error(message) with `.code` on failure. */
function runOrca(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    // No shell: user text goes through argv untouched (orca.cmd would let cmd.exe reparse it).
    execFile(ORCA_BIN, [...args, '--json'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let out = null;
      try { out = JSON.parse(stdout); } catch { /* not json */ }
      if (out?.ok) { resolve(out.result); return; }
      reject(orcaErr(out?.error?.message || (err?.code === 'ENOENT' ? `orca CLI를 찾을 수 없습니다 (${ORCA_BIN})` : String(stderr || err?.message || 'orca failed').trim().slice(0, 300)),
        out?.error?.code || err?.code || 'orca_failed'));
    });
  });
}

let probed = null; // { at, result }: `orca worktree list` per hit would stall every /backends call
/** Is the Orca CLI installed and its app reachable? Cached for BACKEND_PROBE_TTL_MS. */
export async function probe() {
  if (probed && Date.now() - probed.at < BACKEND_PROBE_TTL_MS) return probed.result;
  let result;
  try { await runOrca(['worktree', 'list'], { timeoutMs: 5000 }); result = { available: true }; } catch (e) { result = { available: false, reason: e.message }; }
  probed = { at: Date.now(), result };
  return result;
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const normTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const within = (dir, root) => { const d = norm(dir), r = norm(root); return !!r && (d === r || d.startsWith(r + '/')); };

async function listTerminals() {
  const r = await runOrca(['terminal', 'list']);
  return r.terminals || [];
}

export async function listWorktrees() {
  const r = await runOrca(['worktree', 'list']);
  return (r.worktrees || [])
    .filter((w) => !w.isArchived && w.path)
    .map((w) => ({
      id: w.id,
      repoId: w.repoId || String(w.id).split('::')[0],
      head: w.head || '',
      path: w.path,
      repo: path.basename(w.path),
      name: w.displayName || '',
      branch: String(w.branch || '').replace(/^refs\/heads\//, ''),
      lastActivityAt: w.lastActivityAt || 0,
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Find the Orca terminal that runs session `s`. Hook-reported handle wins; otherwise
 * guess from the single live claude terminal whose worktree contains the session cwd,
 * breaking a tie by the tab title (Orca shows the claude session title there).
 */
async function resolveTerminal(store, s) {
  const terms = await listTerminals();
  if (s.orcaTerminal) {
    const t = terms.find((x) => x.handle === s.orcaTerminal);
    if (t) return t;
  }
  const claimed = new Set();
  for (const o of store.sessions.values()) if (o !== s && !o.ended && o.orcaTerminal) claimed.add(o.orcaTerminal);
  const cands = terms.filter((t) => t.agentIdentity === 'claude' && t.connected && t.writable && !claimed.has(t.handle) && within(s.cwd, t.worktreePath));
  const rivals = [...store.sessions.values()].filter((o) => o !== s && !o.ended && !o.orcaTerminal && cands.some((t) => within(o.cwd, t.worktreePath)));
  if (cands.length === 1 && !rivals.length) return cands[0];
  const title = normTitle(s.title);
  if (title && cands.length) {
    const hits = cands.filter((t) => normTitle(t.title) === title);
    const twin = [...store.sessions.values()].some((o) => o !== s && !o.ended && normTitle(o.title) === title);
    if (hits.length === 1 && !twin) return hits[0];
  }
  throw orcaErr(cands.length
    ? `이 세션의 Orca 터미널을 특정할 수 없습니다 (같은 worktree의 claude 탭 ${cands.length}개, 제목 일치 없음). 플러그인 설치 후 시작한 세션이면 프롬프트를 한 번 보내면 연결됩니다.`
    : 'Orca 터미널에서 실행 중인 세션이 아닙니다.', 'terminal_not_found');
}

export async function sendPrompt(store, s, text) {
  const t = await resolveTerminal(store, s);
  if (t.agentIdentity && t.agentIdentity !== 'claude') {
    throw orcaErr(`이 터미널은 claude가 아닌 ${t.agentIdentity}를 실행 중입니다.`, 'not_claude');
  }
  store.setTerminal(s, t.handle);
  return runOrca(['terminal', 'send', '--terminal', t.handle, '--text', text, '--enter']);
}

/**
 * End session `s`. Default types `/exit` (clean SessionEnd; the tab stays). `force` closes the
 * Orca terminal, killing whatever runs there — the only safe option when the TUI isn't at its prompt.
 */
export async function closeSession(store, s, { force = false } = {}) {
  const t = await resolveTerminal(store, s);
  store.setTerminal(s, t.handle);
  if (force) { launched.delete(t.handle); return runOrca(['terminal', 'close', '--terminal', t.handle]); }
  const r = await runOrca(['terminal', 'send', '--terminal', t.handle, '--text', '/exit', '--enter']);
  // A tab we opened has nothing left once claude exits; a user's own tab keeps its shell.
  if (launched.has(t.handle)) closeAfterExit(s, t.handle);
  return r;
}

// ---- permission mode (Shift+Tab in the TUI) --------------------------------------------------------------------
// The TUI only cycles modes with Shift+Tab, and no hook fires on a switch, so we read the mode off the rendered footer
// (the line under the input box) and press until it shows the one asked for.
const SHIFT_TAB = '\x1b[Z';
const MODE_PRESSES = 6, MODE_SETTLE_MS = 1500, MODE_POLL_MS = 150;
const FOOTER_MODES = [
  [/accept edits on/i, 'acceptEdits'], [/plan mode on/i, 'plan'], [/auto mode on/i, 'auto'],
  [/bypass permissions on/i, 'bypassPermissions'], [/don.?t ask (mode )?on/i, 'dontAsk'], [/manual mode on/i, 'default'], // newer TUIs name default "manual"
];
const isBorder = (line) => /^\s*[─━-]{20,}\s*$/.test(line);

/** The mode the TUI footer shows: a mode key, 'default' (no mode line), or null when no input box is on screen. */
export function footerMode(lines) {
  const tail = lines.slice(-12);
  const b = tail.findLastIndex(isBorder);
  if (b < 0) return null; // a menu, dialog or something else owns the screen
  const footer = tail.slice(b + 1).join('\n');
  for (const [re, mode] of FOOTER_MODES) if (re.test(footer)) return mode;
  return 'default';
}

async function screenMode(handle) {
  const r = await runOrca(['terminal', 'read', '--terminal', handle, '--screen']);
  return footerMode(r?.terminal?.tail || []);
}

export async function setMode(store, s, mode) {
  // dontAsk is never in the Shift+Tab cycle: refuse before pressing anything (cycling would leave some other mode on)
  if (mode === 'dontAsk' && s.permissionMode !== mode) throw orcaErr('dontAsk 모드는 터미널에서 Shift+Tab으로 켤 수 없습니다. claude --permission-mode dontAsk 로 시작해야 합니다.', 'mode_refused');
  if (s.state === 'waiting') throw orcaErr('권한 승인·질문 응답을 기다리는 중입니다. Shift+Tab이 다이얼로그에 들어갈 수 있어 터미널에서 먼저 답해주세요.', 'waiting');
  const t = await resolveTerminal(store, s);
  store.setTerminal(s, t.handle);
  let cur = await screenMode(t.handle);
  const seen = [];
  for (let i = 0; ; i++) {
    if (!cur) throw orcaErr('터미널 화면에서 Claude 입력창을 찾지 못했습니다. 메뉴나 다이얼로그가 열려 있으면 닫고 다시 시도해주세요.', 'mode_unknown');
    if (cur === mode) break;
    if (seen.includes(cur) || i >= MODE_PRESSES) {
      throw orcaErr(`이 세션의 Shift+Tab 순환에 '${mode}' 모드가 없습니다 (순환: ${seen.join(' → ')}).`, 'mode_refused');
    }
    seen.push(cur);
    await runOrca(['terminal', 'send', '--terminal', t.handle, '--text', SHIFT_TAB]);
    const prev = cur, end = Date.now() + MODE_SETTLE_MS;
    do { await new Promise((r) => setTimeout(r, MODE_POLL_MS)); cur = await screenMode(t.handle); } while (cur === prev && Date.now() < end);
  }
  s.permissionMode = mode;
  return { mode };
}

const launched = new Set(); // terminal handles opened by launchClaude (this server run)

function closeAfterExit(s, handle) {
  const deadline = Date.now() + 30_000;
  const tick = () => {
    if (s.pid && isPidAlive(s.pid) && Date.now() < deadline) { setTimeout(tick, 1000); return; }
    if (s.pid && isPidAlive(s.pid)) return; // didn't exit; leave the tab alone
    launched.delete(handle);
    runOrca(['terminal', 'close', '--terminal', handle]).catch((e) => console.error('[orca] close tab:', e.message));
  };
  setTimeout(tick, 1000);
}

/** The terminal handle an Orca launch opened, wherever the result nests it ({ kind: 'terminal', handle }). */
function launchedHandle(r, depth = 0) {
  if (!r || typeof r !== 'object' || depth > 4) return null;
  if (r.kind === 'terminal' && typeof r.handle === 'string') return r.handle;
  for (const v of Object.values(r)) { const h = launchedHandle(v, depth + 1); if (h) return h; }
  return null;
}

/** Run an Orca launch and remember the tab it opened, so closing that session can close the tab too. */
async function launchTracked(args, timeoutMs) {
  const r = await runOrca(args, { timeoutMs });
  const h = launchedHandle(r);
  if (h) launched.add(h);
  return r;
}

export async function launchClaude({ worktreeId, prompt, model }) {
  const args = ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${worktreeId}`];
  if (prompt) args.push('--prompt', prompt);
  if (model) args.push('--model', model);
  return launchTracked(args, 60_000);
}

/**
 * New worktree branched from `base` (its branch, or its commit when detached), recorded as its child,
 * with claude started in the first terminal. Repo setup hooks follow the repo's own policy.
 */
export async function createWorktreeWithClaude({ base, name, prompt, model }) {
  const args = ['worktree', 'create', '--name', name, '--repo', `id:${base.repoId}`, '--base-branch', base.branch || base.head,
    '--parent-worktree', `worktree:${base.id}`, '--agent', 'claude'];
  if (prompt) args.push('--prompt', prompt);
  if (model) args.push('--model', model);
  return launchTracked(args, 180_000);
}
