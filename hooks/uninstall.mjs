#!/usr/bin/env node
// Removes agent-office hooks from ~/.claude/settings.json, leaving everything else intact.
import { SETTINGS_FILE, isOurs, readSettings, backupSettings, writeSettings } from './_common.mjs';

let settings;
try { settings = readSettings(); } catch (e) { console.error(e.message); process.exit(1); }

let removed = 0;
if (settings.hooks && typeof settings.hooks === 'object') {
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h) => !isOurs(h));
      removed += before - g.hooks.length;
      if (g.hooks.length) kept.push(g);
    }
    if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
}

if (!removed) { console.log(`No agent-office hooks found in ${SETTINGS_FILE} — nothing to do.`); process.exit(0); }
const bak = backupSettings();
writeSettings(settings);
console.log(`Removed ${removed} agent-office hook entr${removed === 1 ? 'y' : 'ies'} from ${SETTINGS_FILE}`);
if (bak) console.log(`  backup: ${bak}`);
