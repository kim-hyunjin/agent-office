#!/usr/bin/env node
// Claude Code hook: forwards the stdin JSON payload to the pawgents-office server.
// Prints NOTHING (hook stdout can be injected into Claude's context) and always exits 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PAWGENTS_OFFICE_PORT || 17777);
const DEBUG = process.env.PAWGENTS_OFFICE_DEBUG === '1';

function log(msg) {
  if (!DEBUG) return;
  try {
    const dir = process.env.PAWGENTS_OFFICE_DATA || path.join(os.homedir(), '.pawgents-office');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'hook.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* ignore */ }
}

const clip = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);

function shrink(ev) {
  if (ev.tool_response !== undefined) {
    const r = ev.tool_response;
    let text = '';
    if (typeof r === 'string') text = r;
    else if (r && typeof r === 'object') text = typeof r.stdout === 'string' ? r.stdout + (r.stderr ? '\n' + r.stderr : '') : (JSON.stringify(r) || '');
    ev.tool_response_len = text.length;
    ev.tool_response_head = text.slice(0, 400);
    delete ev.tool_response;
  }
  for (const k of ['prompt', 'message', 'error', 'compact_summary', 'custom_instructions']) {
    if (typeof ev[k] === 'string') ev[k] = clip(ev[k], 2000);
  }
  // Kept whole for the reply dialog; the server caps it (MAX_REPLY_CHARS) well under MAX_BODY_BYTES.
  ev.last_assistant_message = clip(ev.last_assistant_message, 200_000);
  if (ev.tool_input && typeof ev.tool_input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(ev.tool_input)) {
      if (typeof v === 'string') out[k] = clip(v, 500);
      else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    }
    ev.tool_input = out;
  }
  // Stop lists in-flight background work (shells, monitors…): "paused waiting for it", not "done".
  if (Array.isArray(ev.background_tasks)) {
    ev.background_tasks = ev.background_tasks.slice(0, 10).map((t) => ({
      id: t?.id, type: t?.type, status: t?.status, description: clip(t?.description, 200), command: clip(t?.command, 200),
    }));
  } else delete ev.background_tasks;
  for (const k of ['session_crons', 'permission_suggestions']) delete ev[k];
  return ev;
}

export async function readEvent() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let ev;
  try { ev = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { log('bad json'); return null; }
  return ev && typeof ev === 'object' ? ev : null;
}

export async function forward(ev) {
  shrink(ev);
  // Set by Orca in its managed terminals; lets the office type into this session.
  if (process.env.ORCA_TERMINAL_HANDLE) ev.orca_terminal = process.env.ORCA_TERMINAL_HANDLE;
  try {
    await fetch(`http://127.0.0.1:${PORT}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(1000),
    });
    log(`sent ${ev.hook_event_name} ${ev.tool_name || ''}`);
  } catch (e) {
    log(`send failed: ${e.message}`);
  }
}

if (import.meta.main) {
  readEvent().then((ev) => ev && forward(ev)).catch(() => {}).finally(() => process.exit(0));
}
