// Small DOM and formatting helpers shared by the office, its panels and dialogs, and the words, colors and icons
// every view uses for a session (state, permission mode, tools, background work).
import { spriteSize } from './sprites.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtTime = (t) => new Date(t).toTimeString().slice(0, 8);
/** A status line under a form: kind '' | 'ok' | 'err' (styled by .msg in style.css). */
export const setMsg = (el, text, kind = '') => { el.textContent = text; el.className = `msg ${kind}`; };

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A drawable (sprite frame or skin frame) on a canvas, sized by its world size × zoom (uploaded skins carry a scale). */
export function pic(img, zoom = 1, canvas = document.createElement('canvas')) {
  const { w, h } = spriteSize(img);
  canvas.width = Math.round(w * zoom); canvas.height = Math.round(h * zoom);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A modal <dialog> closes from its × button and from a click on the backdrop. */
export function bindDialogClose(dlg, closeBtn) {
  closeBtn.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
}

// localStorage that never throws (blocked storage, private mode). Keys stay as they are: renaming one resets a setting.
export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

// ---- session display vocabulary ---------------------------------------------------
export const STATE_LABEL = {
  idle: '대기', thinking: '생각 중', reading: '읽는 중', coding: '코딩 중', terminal: '터미널', searching: '검색 중',
  delegating: '위임 중', working: '작업 중', waiting: '응답 대기', offduty: '퇴근',
};
export const STATE_COLOR = {
  idle: '#8e9aaf', thinking: '#a78bfa', reading: '#60a5fa', coding: '#3b82f6', terminal: '#22c55e', searching: '#06b6d4',
  delegating: '#f59e0b', working: '#e5e7eb', waiting: '#fbbf24', offduty: '#6b7280',
};
export const BUSY = new Set(['thinking', 'reading', 'coding', 'terminal', 'searching', 'delegating', 'working']);
export const MODE_LABEL = { plan: '계획', auto: '자동', bypassPermissions: '자동 (bypass)', dontAsk: '자동 (dontAsk)', acceptEdits: '편집 승인', default: '기본' };
export const ICON = {
  Read: '📖', Grep: '🔍', Glob: '🔍', LS: '📂', Edit: '✏️', Write: '✏️', MultiEdit: '✏️', NotebookEdit: '✏️',
  Bash: '💻', WebFetch: '🌐', WebSearch: '🌐', Agent: '🤝', Task: '🤝', AskUserQuestion: '❓', Skill: '🧩', TodoWrite: '📝',
};
export const EV_ICON = {
  SessionStart: '🚪', SessionEnd: '🚪', UserPromptSubmit: '🗣️', Stop: '💬', PermissionRequest: '✋', Notification: '🔔',
  SubagentStart: '🧢', SubagentStop: '🧢', PostToolUseFailure: '⚠️', PreModelSwitch: '🔁', PostModelSwitch: '🔁',
};

/** "Edit · office.js": a tool call as one line of plain text (callers escape it for HTML). */
export const toolText = (t) => `${t.name}${t.target ? ' · ' + t.target : ''}`;
/** Thinking text recent enough to show (3 min); most callers also hide it once the session is idle. */
export const thinkingFresh = (d, now) => !!d.lastThinking && now - d.lastThinkingAt < 3 * 60_000;

/** Turn ended, but background work (a shell, a monitor…) will wake the session again. */
export function awaitingBg(s) { return s.state === 'idle' && (s.bgTasks?.length > 0 || !!s.awaitingShell); }

/** "백그라운드 작업 대기 · npm test 외 1개" — what an idle session is waiting on. */
export function bgSummary(s) {
  const tasks = s.bgTasks || [];
  if (!tasks.length) return '백그라운드 셸 결과 대기';
  const t = tasks[0];
  const what = t.command || t.description || t.type || '작업';
  return `백그라운드 작업 대기 · ${what}${tasks.length > 1 ? ` 외 ${tasks.length - 1}개` : ''}`;
}
