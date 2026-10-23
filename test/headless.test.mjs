// Tests for the headless backend: git worktree parsing, repo discovery, the runner protocol, and the runner itself (with a fake claude).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pipePath, runFile, encode, newFeed, feed, parseCommand, parseClaudeLine, buildClaudeArgs, versionAtLeast, userMessageLine, runnerArgv, parseRunnerArgv, MAX_LINE_BYTES } from '../server/backends/protocol.mjs';
import { RUN_DIR, MAX_PROMPT_CHARS } from '../server/config.mjs';
import { parseWorktrees, repoRoots } from '../server/backends/git.mjs';

const fixture = [
  'worktree C:/Users/x/repo', 'HEAD aaa111', 'branch refs/heads/main', '',
  'worktree C:/Users/x/repo-feature', 'HEAD bbb222', 'branch refs/heads/feature/x', '',
  'worktree C:/Users/x/repo-detached', 'HEAD ccc333', 'detached', '',
  'worktree C:/Users/x/repo.git', 'bare', '',
  'worktree C:/Users/x/repo-gone', 'HEAD ddd444', 'branch refs/heads/gone', 'prunable gitdir file points to non-existent location', '',
].join('\n');

test('parseWorktrees reads branches, detached heads and the main worktree; skips bare and prunable', () => {
  const ws = parseWorktrees(fixture, 'C:/Users/x/repo');
  assert.equal(ws.length, 3);
  assert.deepEqual(ws.map((w) => w.isMain), [true, false, false]);
  assert.deepEqual(ws.map((w) => w.branch), ['main', 'feature/x', '']);
  assert.deepEqual(ws.map((w) => w.head), ['aaa111', 'bbb222', 'ccc333']);
  assert.ok(ws.every((w) => w.repo === 'repo' && w.repoRoot === 'C:/Users/x/repo' && w.id === w.path && w.name === ''));
  assert.equal(ws[1].path, 'C:/Users/x/repo-feature');
});

test('repoRoots keeps only existing directories and drops the default bucket', () => {
  const here = process.cwd();
  const store = { offices: [{ repos: ['default', here.toLowerCase(), here + '-nope'] }], sessions: new Map() };
  const roots = repoRoots(store);
  assert.deepEqual(roots, [here.toLowerCase()]);
});

test('feed splits NDJSON across chunks, drops oversize and non-JSON lines', () => {
  const got = [], st = newFeed(), on = (o) => got.push(o);
  feed(st, '{"a":1}\n{"b"', on); feed(st, ':2}\n', on);
  feed(st, '{"c":3}\n{"d":4}\nnot json\n\n[1]\n', on);
  feed(st, '{"x":"' + 'y'.repeat(MAX_LINE_BYTES + 10), on); feed(st, 'zz"}\n{"e":5}\n', on); // oversize line spanning chunks
  feed(st, '{"big":"' + 'y'.repeat(MAX_LINE_BYTES) + '"}\n{"f":6}\n', on); // oversize line inside one chunk
  assert.equal(st.rem, '');
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, [1], { e: 5 }, { f: 6 }]);
  assert.equal(encode({ t: 1 }), '{"t":1}\n');
});

test('parseCommand accepts the four commands and rejects the rest', () => {
  assert.deepEqual(parseCommand({ type: 'prompt', text: '  hi  ' }), { type: 'prompt', text: 'hi' });
  for (const t of ['close', 'kill', 'status']) assert.deepEqual(parseCommand({ type: t, extra: 1 }), { type: t });
  for (const bad of [null, 'prompt', {}, { type: 'prompt' }, { type: 'prompt', text: '   ' }, { type: 'prompt', text: 5 }, { type: 'prompt', text: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, { type: 'nope' }]) assert.equal(parseCommand(bad), null);
});

test('parseClaudeLine keeps init, result and permission denials only', () => {
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'init', model: 'claude-x', session_id: 's', cwd: '/' }), { kind: 'init', model: 'claude-x', sessionId: 's' });
  assert.deepEqual(parseClaudeLine({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, permission_denials: [{ tool_name: 'Bash' }], result: 'x' }), { kind: 'result', isError: false, subtype: 'success', costUsd: 0.5, denials: ['Bash'] });
  assert.deepEqual(parseClaudeLine({ type: 'result', subtype: 'error_during_execution', is_error: true }), { kind: 'result', isError: true, subtype: 'error_during_execution', costUsd: null, denials: [] });
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit' }), { kind: 'denied', tool: 'Edit' });
  assert.deepEqual(parseClaudeLine({ type: 'system', subtype: 'permission_denied', tool: 'Write' }), { kind: 'denied', tool: 'Write' });
  for (const o of [null, 'x', { type: 'assistant' }, { type: 'user' }, { type: 'rate_limit_event' }, { type: 'system', subtype: 'hook_started' }]) assert.equal(parseClaudeLine(o), null);
});

test('buildClaudeArgs: exact argv, permission-mode and version gates, validation', () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', sid];
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.258' }), base);
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.259 (Claude Code)', permissionMode: 'default' }), [...base, '--permission-prompts', 'none']);
  const settings = path.resolve('s.json');
  assert.deepEqual(buildClaudeArgs({ sid, version: '2.1.309', model: 'opus[1m]', permissionMode: 'acceptEdits', settingsFile: settings }),
    [...base, '--model', 'opus[1m]', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--settings', settings]);
  assert.equal(versionAtLeast('3.0.0', '2.1.259'), true);
  assert.equal(versionAtLeast('2.0.999', '2.1.259'), false);
  assert.equal(versionAtLeast(null, '2.1.259'), false);
  assert.throws(() => buildClaudeArgs({ sid: '../x' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'a b' }));
  assert.throws(() => buildClaudeArgs({ sid, model: 'x&calc' }));
  assert.throws(() => buildClaudeArgs({ sid, permissionMode: 'yolo' }));
  assert.throws(() => buildClaudeArgs({ sid, settingsFile: 'relative.json' }));
  assert.equal(userMessageLine('hi'), '{"type":"user","message":{"role":"user","content":"hi"}}\n');
});

test('runner argv round-trips and rejects garbage', () => {
  const spec = { sid: randomUUID(), cwd: process.cwd(), model: null, permissionMode: 'auto', settingsFile: null, claude: { file: 'claude', prefix: [], shell: false }, version: '2.1.309' };
  assert.deepEqual(parseRunnerArgv(runnerArgv(spec)), spec);
  assert.throws(() => parseRunnerArgv(['{nope']));
  assert.throws(() => parseRunnerArgv([]));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, sid: '..\\..\\evil' })));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, claude: { file: 'claude', prefix: [1], shell: false } })));
  assert.throws(() => parseRunnerArgv(runnerArgv({ ...spec, cwd: 3 })));
});

test('pipePath and runFile per platform', () => {
  const sid = randomUUID();
  if (process.platform === 'win32') assert.equal(pipePath(sid), `\\\\.\\pipe\\pawgents-office-${sid}`);
  else assert.equal(pipePath(sid), path.join(RUN_DIR, `${sid}.sock`));
  assert.equal(runFile(sid), path.join(RUN_DIR, `${sid}.json`));
  assert.throws(() => pipePath('x'));
});

// Real runner over a real pipe, with test/fixtures/fake-claude.mjs as claude. DATA_DIR points at a temp dir via env.
test('runner: hello, prompt -> ack + result, status, close -> exit 0, run file removed', { timeout: 30_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'po-')); // short: POSIX sun_path is ~104 bytes
  const sid = randomUUID(), run = path.join(tmp, 'run', `${sid}.json`);
  const fixture = path.resolve(import.meta.dirname, 'fixtures/fake-claude.mjs');
  const spec = { sid, cwd: tmp, model: null, permissionMode: 'default', settingsFile: null, claude: { file: process.execPath, prefix: [fixture], shell: false }, version: '2.1.309' };
  const runner = spawn(process.execPath, [path.resolve(import.meta.dirname, '../server/headless-runner.mjs'), ...runnerArgv(spec)], { env: { ...process.env, PAWGENTS_OFFICE_DATA: tmp }, stdio: 'ignore' });
  const runnerExit = new Promise((r) => runner.on('exit', (code) => r(code)));
  const until = async (fn, what, ms = 10_000) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${what}`); await new Promise((r) => setTimeout(r, 50)); } };
  let sock;
  try {
    const info = await until(() => { try { return JSON.parse(fs.readFileSync(run, 'utf8')); } catch { return null; } }, 'run file');
    assert.equal(info.sid, sid); assert.equal(info.pid, runner.pid); assert.equal(typeof info.claudePid, 'number');
    if (process.platform !== 'win32') assert.equal(info.pipe, path.join(tmp, 'run', `${sid}.sock`));
    const msgs = [], st = newFeed();
    sock = net.connect({ path: info.pipe });
    sock.setEncoding('utf8');
    sock.on('data', (d) => feed(st, d, (o) => msgs.push(o)));
    sock.on('error', () => {});
    const waitFor = (pred, what) => until(() => msgs.find(pred), what);
    const hello = await waitFor((m) => m.type === 'hello', 'hello');
    assert.equal(hello.alive, true); assert.equal(typeof hello.claudePid, 'number'); assert.equal(hello.sid, sid);
    sock.write(encode({ type: 'prompt', text: 'hi' }));
    assert.equal((await waitFor((m) => m.type === 'ack' && m.for === 'prompt', 'ack')).ok, true);
    const res = await waitFor((m) => m.type === 'event' && m.kind === 'result', 'result');
    assert.equal(res.isError, false); assert.equal(res.costUsd, 0.001);
    assert.ok([...hello.recent, ...msgs.filter((m) => m.type === 'event')].some((e) => e.kind === 'init' && e.sessionId === sid)); // init may predate our connection: then it's in hello.recent
    sock.write(encode({ type: 'status' }));
    assert.equal((await waitFor((m) => m.type === 'status', 'status')).alive, true);
    sock.write(encode({ type: 'bogus' }));
    await waitFor((m) => m.type === 'error', 'error');
    sock.write(encode({ type: 'close' }));
    assert.equal((await waitFor((m) => m.type === 'exit', 'exit')).code, 0);
    assert.equal(await Promise.race([runnerExit, new Promise((r) => setTimeout(() => r('timeout'), 10_000).unref())]), 0);
    assert.equal(fs.existsSync(run), false);
  } finally {
    sock?.destroy();
    if (runner.exitCode === null && runner.signalCode === null) runner.kill();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
