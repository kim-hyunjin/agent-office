// Worktrees without Orca: plain `git worktree` over the repos the office already knows.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repoOf } from '../repo.mjs';

const run = promisify(execFile);
// git prints forward slashes; compare ignoring slash style, trailing slash and (on Windows) case
const norm = (p) => { const n = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? n.toLowerCase() : n; };

/** Parse `git worktree list --porcelain` into launcher rows; bare and prunable entries can't host a session. */
export function parseWorktrees(text, repoRoot) {
  const out = [];
  String(text || '').split(/\r?\n\s*\r?\n/).forEach((block, i) => {
    const w = { path: '', head: '', branch: '', skip: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) w.path = line.slice(9);
      else if (line.startsWith('HEAD ')) w.head = line.slice(5);
      else if (line.startsWith('branch ')) w.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'bare' || line.startsWith('prunable')) w.skip = true;
    }
    if (!w.path || w.skip) return;
    out.push({ id: w.path, path: w.path, repoRoot, repo: path.basename(repoRoot), branch: w.branch, head: w.head, isMain: i === 0 || norm(w.path) === norm(repoRoot), name: '' });
  });
  return out;
}

/** Repo roots to list: the offices' repos (minus the 'default' bucket) plus live sessions' repos, if they still exist. */
export function repoRoots(store) {
  const keys = new Set(store.offices.flatMap((o) => o.repos).filter((k) => k !== 'default'));
  for (const s of store.sessions.values()) if (!s.ended && s.cwd) { const k = repoOf(s.cwd).key; if (k !== 'default') keys.add(k); }
  return [...keys].filter((k) => { try { return fs.statSync(k).isDirectory(); } catch { return false; } });
}

export async function listGitWorktrees(roots) {
  const results = await Promise.allSettled(roots.map(async (root) => parseWorktrees((await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { timeout: 5000, windowsHide: true })).stdout, root)));
  const seen = new Set(), all = [];
  for (const r of results) if (r.status === 'fulfilled') for (const w of r.value) if (!seen.has(norm(w.path))) { seen.add(norm(w.path)); all.push(w); }
  return all.sort((a, b) => a.repo.localeCompare(b.repo) || b.isMain - a.isMain || a.path.localeCompare(b.path));
}

/** New worktree on a new branch `name`, next to the repo as `<repo>-<name>`. */
export async function addWorktree({ repoRoot, name, base }) {
  const dir = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${name}`);
  try { await run('git', ['-C', repoRoot, 'worktree', 'add', '-b', name, dir, base], { timeout: 60_000, windowsHide: true }); } catch (e) {
    throw Object.assign(new Error((e.stderr || e.message).trim().slice(0, 300)), { code: 'git_failed' });
  }
  return { path: dir, branch: name };
}
