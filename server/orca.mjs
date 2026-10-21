import { execFile } from 'node:child_process';
import path from 'node:path';
import { ORCA_BIN } from './config.mjs';
import { isPidAlive } from './util.mjs';

/** Run `orca <args> --json` and return `result`. Throws Error(message) with `.code` on failure. */
export function runOrca(args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    // No shell: user text goes through argv untouched (orca.cmd would let cmd.exe reparse it).
    execFile(ORCA_BIN, [...args, '--json'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let out = null;
      try { out = JSON.parse(stdout); } catch { /* not json */ }
      if (out?.ok) { resolve(out.result); return; }
      const e = new Error(out?.error?.message || (err?.code === 'ENOENT' ? `orca CLI를 찾을 수 없습니다 (${ORCA_BIN})` : String(stderr || err?.message || 'orca failed').trim().slice(0, 300)));
      e.code = out?.error?.code || err?.code || 'orca_failed';
      reject(e);
    });
  });
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const within = (dir, root) => { const d = norm(dir), r = norm(root); return !!r && (d === r || d.startsWith(r + '/')); };

export async function listTerminals() {
  const r = await runOrca(['terminal', 'list']);
  return r.terminals || [];
}

export async function listWorktrees() {
  const r = await runOrca(['worktree', 'list']);
  return (r.worktrees || [])
    .filter((w) => !w.isArchived && w.path)
    .map((w) => ({
      id: w.id,
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
 * guess from the single live claude terminal whose worktree contains the session cwd.
 */
export async function resolveTerminal(store, s) {
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
  const e = new Error(cands.length
    ? `이 세션의 Orca 터미널을 특정할 수 없습니다 (후보 ${cands.length}개). 세션에서 프롬프트를 한 번 보내면 연결됩니다.`
    : 'Orca 터미널에서 실행 중인 세션이 아닙니다.');
  e.code = 'terminal_not_found';
  throw e;
}

export async function sendPrompt(store, s, text) {
  const t = await resolveTerminal(store, s);
  if (t.agentIdentity && t.agentIdentity !== 'claude') {
    const e = new Error(`이 터미널은 claude가 아닌 ${t.agentIdentity}를 실행 중입니다.`); e.code = 'not_claude'; throw e;
  }
  s.orcaTerminal = t.handle;
  return runOrca(['terminal', 'send', '--terminal', t.handle, '--text', text, '--enter']);
}

/**
 * End session `s`. Default types `/exit` (clean SessionEnd; the tab stays). `force` closes the
 * Orca terminal, killing whatever runs there — the only safe option when the TUI isn't at its prompt.
 */
export async function closeSession(store, s, { force = false } = {}) {
  const t = await resolveTerminal(store, s);
  s.orcaTerminal = t.handle;
  if (force) { launched.delete(t.handle); return runOrca(['terminal', 'close', '--terminal', t.handle]); }
  const r = await runOrca(['terminal', 'send', '--terminal', t.handle, '--text', '/exit', '--enter']);
  // A tab we opened has nothing left once claude exits; a user's own tab keeps its shell.
  if (launched.has(t.handle)) closeAfterExit(s, t.handle);
  return r;
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

export async function launchClaude({ worktreeId, prompt, model }) {
  const args = ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${worktreeId}`];
  if (prompt) args.push('--prompt', prompt);
  if (model) args.push('--model', model);
  const r = await runOrca(args, { timeoutMs: 60_000 });
  const outcome = r?.launch?.outcome || r?.outcome;
  if (outcome?.kind === 'terminal' && outcome.handle) launched.add(outcome.handle);
  return r;
}
