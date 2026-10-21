#!/usr/bin/env node
// Stops a background pawgents-office server (one started by the plugin hook or /pawgents-office:open).
import fs from 'node:fs';
import { PID_FILE, PORT } from '../server/config.mjs';

let pid;
try { pid = Number(fs.readFileSync(PID_FILE, 'utf8')); } catch { /* no pid file */ }
if (!pid) { console.log(`pawgents-office is not running (no ${PID_FILE}).`); process.exit(0); }
try {
  process.kill(pid);
  console.log(`Stopped pawgents-office (pid ${pid}, port ${PORT}).`);
} catch (e) {
  console.log(e.code === 'ESRCH' ? `pawgents-office (pid ${pid}) was not running.` : `Could not stop pid ${pid}: ${e.message}`);
}
try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
