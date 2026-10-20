import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PostModelSwitch', 'PostCompact',
];
export const SEND_SCRIPT = path.resolve(import.meta.dirname, 'send.mjs');
export const HOOK_COMMAND = `"${process.execPath}" "${SEND_SCRIPT}"`;
export const SETTINGS_FILE = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');

/** True if this hook handler is ours (points at this repo's hooks/send.mjs). */
export function isOurs(handler) {
  return handler && handler.type === 'command' && typeof handler.command === 'string' && handler.command.includes(SEND_SCRIPT);
}

export function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const text = fs.readFileSync(SETTINGS_FILE, 'utf8');
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${SETTINGS_FILE} is not valid JSON (${e.message}). Fix it by hand first; nothing was changed.`); }
}

export function backupSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${SETTINGS_FILE}.bak-${stamp}`;
  fs.copyFileSync(SETTINGS_FILE, bak);
  return bak;
}

export function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}
