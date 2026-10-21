#!/usr/bin/env node
// Plugin SessionStart hook: starts the pawgents-office server in the background if it isn't running,
// then forwards the event (the server may not have been up for send.mjs to reach it).
// Prints NOTHING as a hook. `--open` (used by /pawgents-office:open) also prints the URL and opens a browser.
//   PAWGENTS_OFFICE_AUTOSTART=0 disables starting the server from the hook.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEvent, forward } from './send.mjs';

const PORT = Number(process.env.PAWGENTS_OFFICE_PORT || 17777);
const DATA_DIR = process.env.PAWGENTS_OFFICE_DATA || path.join(os.homedir(), '.pawgents-office');
const URL = `http://127.0.0.1:${PORT}`;
const SERVER = path.resolve(import.meta.dirname, '../server/index.mjs');

async function healthy() {
  try { return (await fetch(`${URL}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
}

// Concurrent starts are fine: the loser exits on EADDRINUSE and the winner writes server.pid.
async function ensureServer() {
  if (await healthy()) return true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await healthy()) return true;
  }
  return false;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* ignore */ }
}

if (process.argv.includes('--open')) {
  if (await ensureServer()) {
    openBrowser(URL);
    console.log(`pawgents-office is running at ${URL}`);
  } else {
    console.log(`pawgents-office failed to start on port ${PORT}. See ${path.join(DATA_DIR, 'server.log')}`);
  }
} else {
  try {
    const ev = await readEvent();
    if (process.env.PAWGENTS_OFFICE_AUTOSTART !== '0') await ensureServer();
    if (ev) await forward(ev);
  } catch { /* never fail the hook */ }
}
process.exit(0);
