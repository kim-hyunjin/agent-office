import fs from 'node:fs';
import path from 'node:path';
import { MAX_REPLY_CHARS } from './config.mjs';

export function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Assistant text kept verbatim (markdown intact) for the reply dialog. */
export function replyText(s) {
  return truncate(String(s ?? '').trim(), MAX_REPLY_CHARS);
}

/** Strip code fences / markdown noise so a bubble reads naturally. */
export function cleanText(s, n = 280) {
  s = String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');
  return truncate(oneLine(s), n);
}

/** Short human target for a tool call: file name, command head, pattern... */
export function summarizeToolInput(tool, input) {
  if (!input || typeof input !== 'object') return '';
  const fp = input.file_path || input.notebook_path || input.path;
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return fp ? path.basename(String(fp)) : '';
    case 'Bash':
      return truncate(oneLine(input.description || input.command || ''), 40);
    case 'Grep': case 'Glob':
      return truncate(String(input.pattern || ''), 40);
    case 'Agent': case 'Task':
      return truncate(String(input.description || input.subagent_type || ''), 40);
    case 'WebFetch':
      try { return new URL(String(input.url)).hostname; } catch { return ''; }
    case 'WebSearch':
      return truncate(String(input.query || ''), 40);
    case 'Skill':
      return truncate(String(input.skill || ''), 40);
    default: {
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v) return truncate(oneLine(v), 40);
      }
      return '';
    }
  }
}

/** Longer human description of a tool call for tooltips / log details (≤ 300 chars). */
export function detailForTool(tool, input) {
  if (!input || typeof input !== 'object') return '';
  const fp = input.file_path || input.notebook_path || input.path || '';
  const n = (v) => (typeof v === 'string' ? v.length : 0);
  let d = '';
  switch (tool) {
    case 'Read': d = `${fp}${input.offset ? ` (from line ${input.offset}${input.limit ? `, ${input.limit} lines` : ''})` : ''}`; break;
    case 'Edit': d = `${fp}  (${n(input.old_string)}자 → ${n(input.new_string)}자${input.replace_all ? ', 전체 치환' : ''})`; break;
    case 'MultiEdit': d = `${fp}  (${Array.isArray(input.edits) ? input.edits.length : '?'}곳)`; break;
    case 'Write': d = `${fp}  (${n(input.content)}자)`; break;
    case 'NotebookEdit': d = `${fp}  cell ${input.cell_id ?? ''}`; break;
    case 'Bash': d = oneLine(input.command || ''); if (input.description) d = `${input.description} — ${d}`; break;
    case 'Grep': d = `/${input.pattern}/${input.path ? ' in ' + input.path : ''}${input.glob ? ' (' + input.glob + ')' : ''}`; break;
    case 'Glob': d = `${input.pattern}${input.path ? ' in ' + input.path : ''}`; break;
    case 'Agent': case 'Task': d = `${input.subagent_type ? '[' + input.subagent_type + '] ' : ''}${input.description || ''}${input.prompt ? ' — ' + oneLine(input.prompt) : ''}`; break;
    case 'WebFetch': d = `${input.url || ''}${input.prompt ? ' — ' + oneLine(input.prompt) : ''}`; break;
    case 'WebSearch': d = String(input.query || ''); break;
    case 'Skill': d = `${input.skill || ''} ${input.args || ''}`; break;
    case 'AskUserQuestion': d = Array.isArray(input.questions) ? input.questions.map((q) => q?.question).filter(Boolean).join(' / ') : ''; break;
    case 'TodoWrite': d = Array.isArray(input.todos) ? input.todos.map((t) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'} ${t.content}`).join('  ') : ''; break;
    default: d = Object.entries(input).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${k}: ${oneLine(v)}`).join('  ');
  }
  return truncate(oneLine(d), 300);
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

/** Read up to `bytes` from the end of a file. Returns { text, start, size }. */
export function readTail(file, bytes) {
  let fd;
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - bytes);
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    return { text: buf.toString('utf8'), start, size: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Read bytes [from, size) of a file. */
export function readFrom(file, from) {
  let fd;
  try {
    const st = fs.statSync(file);
    if (st.size <= from) return { text: '', size: st.size };
    const len = st.size - from;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, from);
    return { text: buf.toString('utf8'), size: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Claude Code encodes the project dir by replacing non-alphanumerics with '-'. */
export function projectDirName(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}
