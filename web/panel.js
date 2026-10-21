import { STATE_LABEL, STATE_COLOR } from './render.js';
import { FAMILIES, familyOf } from './sprites.js';
import { openReply, refreshReply } from './reply.js';

export const ICON = {
  Read: '📖', Grep: '🔍', Glob: '🔍', LS: '📂', Edit: '✏️', Write: '✏️', MultiEdit: '✏️', NotebookEdit: '✏️',
  Bash: '💻', WebFetch: '🌐', WebSearch: '🌐', Agent: '🤝', Task: '🤝', AskUserQuestion: '❓', Skill: '🧩', TodoWrite: '📝',
};
export const EV_ICON = {
  SessionStart: '🚪', SessionEnd: '🚪', UserPromptSubmit: '🗣️', Stop: '💬', PermissionRequest: '✋', Notification: '🔔',
  SubagentStart: '🧢', SubagentStop: '🧢', PostToolUseFailure: '⚠️', PreModelSwitch: '🔁', PostModelSwitch: '🔁',
};
const MODE_LABEL = { plan: '계획', auto: '자동', bypassPermissions: '자동 (bypass)', dontAsk: '자동 (dontAsk)', acceptEdits: '편집 승인', default: '기본' };
const BUSY = new Set(['thinking', 'reading', 'coding', 'terminal', 'searching', 'delegating', 'working']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read']);

export class Panel {
  constructor(el, { onOpen, onClose } = {}) {
    this.el = el;
    this.onOpen = onOpen;
    this.id = null;
    this.entries = new Map();
    this.onClose = onClose;
    el.querySelector('#p-close').addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (e.target === this.input) { this.input.blur(); return; }
      this.close();
    });
    this.drafts = new Map(); // sessionId -> unsent text
    this.input = el.querySelector('#p-input');
    this.composeMsg = el.querySelector('#p-compose-msg');
    this.sendBtn = el.querySelector('#p-send'); // cached: the composer moves into the reply dialog while it's open
    this.input.addEventListener('keydown', (e) => {
      // isComposing: Enter that commits a Hangul syllable must not send.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    el.querySelector('#p-compose').addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.isOpen = false;
    this.quitBtn = el.querySelector('#p-quit');
    this.quitBtn.addEventListener('click', () => this.quit());
    const last = el.querySelector('#p-last');
    last.addEventListener('click', () => { if (this.session) openReply(this.session); });
    last.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && this.session) { e.preventDefault(); openReply(this.session); } });
    this.timer = setInterval(() => { if (this.id && this.session) this.renderMeta(this.session); }, 1000);
  }

  async open(session) {
    if (this.id && this.id !== session.id) this.drafts.set(this.id, this.input.value);
    if (this.id !== session.id) { this.input.value = this.drafts.get(session.id) || ''; this.setComposeMsg(''); }
    this.id = session.id;
    this.session = session;
    this.entries = new Map();
    this.resetQuit();
    if (!this.isOpen) {
      this.isOpen = true;
      this.el.classList.add('open'); // slides in via CSS transition
      this.onOpen?.();
    }
    this.renderMeta(session);
    this.addEntries(session.log || []);
    try {
      const r = await fetch(`/sessions/${encodeURIComponent(session.id)}/log`);
      if (r.ok) { const d = await r.json(); if (this.id === session.id) this.addEntries(d.log || []); }
    } catch { /* server restarted — SSE will refill */ }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    if (this.el.contains(document.activeElement)) document.activeElement.blur();
    this.resetQuit();
    if (this.id) this.drafts.set(this.id, this.input.value);
    this.id = null;
    this.session = null;
    this.onClose?.();
  }

  update(session) {
    if (session.id !== this.id) return;
    this.session = session;
    this.renderMeta(session);
    this.addEntries(session.log || []);
    refreshReply(session);
  }

  remove(id) { this.drafts.delete(id); if (id === this.id) this.close(); }

  setComposeMsg(text, kind = '') {
    this.composeMsg.textContent = text;
    this.composeMsg.className = `msg ${kind}`;
  }

  /** Type the composer text into the session's Orca terminal. */
  async send() {
    const id = this.id, text = this.input.value.trim();
    if (!id || !text || this.sending || this.session?.state === 'waiting') return;
    this.sending = true;
    this.sendBtn.disabled = true;
    this.setComposeMsg('보내는 중…');
    try {
      const r = await fetch(`/sessions/${encodeURIComponent(id)}/prompt`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      this.drafts.delete(id);
      if (this.id === id) { this.input.value = ''; this.setComposeMsg('전달됨 ✓', 'ok'); }
    } catch (e) {
      if (this.id === id) this.setComposeMsg(e.message, 'err');
    } finally {
      this.sending = false;
      this.renderCompose(this.session);
    }
  }

  /**
   * End the session. First click arms, second click (within 4s) sends. Idle → `/exit` (clean
   * SessionEnd, tab stays); anything else → close the Orca terminal outright. Typing `/exit`
   * into a permission dialog could hit its default option, so only an idle prompt gets text.
   */
  async quit() {
    const s = this.session;
    if (!s || s.ended || this.quitting) return;
    const force = s.state !== 'idle';
    if (!this.quitArmed) {
      this.quitArmed = true;
      this.quitBtn.classList.add('armed');
      this.quitBtn.textContent = force ? `${BUSY.has(s.state) ? '작업 중' : '응답 대기'} — 강제 종료?` : '정말 퇴근?';
      this.quitBtn.title = force ? 'Orca 터미널 탭을 닫아 진행 중인 작업을 끊습니다' : '/exit 로 세션을 끝냅니다';
      this.quitTimer = setTimeout(() => this.resetQuit(), 4000);
      return;
    }
    this.resetQuit();
    this.quitting = true;
    this.quitBtn.disabled = true;
    this.setComposeMsg(force ? '터미널을 닫는 중…' : '퇴근 지시 중…');
    const id = s.id;
    try {
      const r = await fetch(`/sessions/${encodeURIComponent(id)}/close`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (this.id === id) this.setComposeMsg(force ? '터미널을 닫았습니다.' : '퇴근합니다 👋', 'ok');
    } catch (e) {
      if (this.id === id) this.setComposeMsg(e.message, 'err');
    } finally {
      this.quitting = false;
      this.quitBtn.disabled = false;
    }
  }

  resetQuit() {
    clearTimeout(this.quitTimer);
    this.quitArmed = false;
    if (!this.quitBtn) return;
    this.quitBtn.classList.remove('armed');
    this.quitBtn.textContent = '퇴근';
    this.quitBtn.title = '이 세션 종료';
  }

  renderCompose(s) {
    if (!s) return;
    this.quitBtn.hidden = !!s.ended;
    const off = !!s.ended, waiting = s.state === 'waiting';
    this.input.disabled = off;
    this.sendBtn.disabled = off || waiting || !!this.sending;
    this.input.placeholder = off ? '퇴근한 직원입니다.'
      : waiting ? '권한 승인·질문 응답 대기 중 — 터미널에서 먼저 답해주세요. (써 두고 나중에 보낼 수 있어요)'
      : `이 직원에게 지시…  (Enter 보내기 · Shift+Enter 줄바꿈)${s.orcaTerminal ? '' : '\nOrca 터미널 연결 전 — 보내면 자동으로 찾아봅니다.'}`;
  }

  renderMeta(s) {
    const q = (sel) => this.el.querySelector(sel);
    const now = Date.now();
    q('#p-name').textContent = s.name;
    q('#p-title').textContent = s.title || '';
    const badge = q('#p-state');
    badge.textContent = STATE_LABEL[s.state] || s.state;
    badge.style.background = STATE_COLOR[s.state] || '#888';
    const fam = FAMILIES[familyOf(s.model)];
    const tool = s.currentTool
      ? `<b>${esc(s.currentTool.name)}</b>${s.currentTool.target ? ' · ' + esc(s.currentTool.target) : ''} <span class="dim">(${fmtDur(now - s.currentTool.startedAt)})</span>${s.currentTool.detail ? `<div class="detail">${esc(s.currentTool.detail)}</div>` : ''}`
      : esc(STATE_LABEL[s.state] || '—');
    const turn = s.turnStartedAt && s.state !== 'idle' ? `툴 ${s.turnTools}회 · ${fmtDur(now - s.turnStartedAt)} 경과` : (s.turnStartedAt ? `마지막 턴: 툴 ${s.turnTools}회` : '—');
    const cost = s.cost ? `$${s.cost.usd.toFixed(2)} · <span class="add">+${s.cost.linesAdded}</span> / <span class="del">−${s.cost.linesRemoved}</span> 줄` : '—';
    q('#p-meta').innerHTML = [
      ['현재 작업', tool],
      ['이번 턴', turn],
      ['모델', `${esc(s.model || '—')}${fam.title ? ` <span class="tier">${fam.title}</span>` : ''}`],
      ['권한 모드', esc(MODE_LABEL[s.permissionMode] || s.permissionMode || '—')],
      ['비용 / 변경', cost],
      ['디렉터리', esc(s.cwd || '—')],
      ['가동 시간', `${fmtDur(now - s.startedAt)}${s.pid ? ` <span class="dim">· PID ${esc(s.pid)}</span>` : ''}`],
      ['세션', `<code>${esc(s.id)}</code>`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    const pr = q('#p-prompt');
    pr.textContent = s.lastPrompt || '';
    pr.hidden = !s.lastPrompt;
    const th = q('#p-thinking');
    const freshThinking = s.lastThinking && now - s.lastThinkingAt < 3 * 60_000 && s.state !== 'idle';
    th.textContent = freshThinking ? s.lastThinking : '';
    th.hidden = !freshThinking;

    const ag = q('#p-agents');
    const live = (s.subagents || []).filter((a) => !a.ended);
    ag.innerHTML = live.map((a) => `<div class="agent" style="--c:${STATE_COLOR[a.state] || '#888'}">
        <div class="agent-hd">🧢 <b>${esc(a.type || 'agent')}</b>${a.description ? ' · ' + esc(a.description) : ''} <em>${esc(STATE_LABEL[a.state] || a.state)}</em> <span class="dim">툴 ${a.toolCount || 0}회</span></div>
        ${a.currentTool ? `<div class="agent-tool">${esc(a.currentTool.name)}${a.currentTool.target ? ' · ' + esc(a.currentTool.target) : ''}${a.currentTool.detail ? ` <span class="dim">— ${esc(a.currentTool.detail)}</span>` : ''}</div>` : ''}
        ${a.task ? `<div class="agent-task" title="${esc(a.task)}">${esc(a.task)}</div>` : ''}
        ${a.lastThinking && now - a.lastThinkingAt < 3 * 60_000 ? `<div class="agent-think">💭 ${esc(a.lastThinking)}</div>` : ''}
      </div>`).join('');
    ag.hidden = !live.length;

    const lt = q('#p-last');
    lt.textContent = s.lastText || '';
    lt.hidden = !s.lastText;
    this.renderFiles();
    this.renderCompose(s);
  }

  renderFiles() {
    const el = this.el.querySelector('#p-files');
    const files = new Map(); // target -> { edited, read, t }
    for (const e of this.entries.values()) {
      if (e.ev !== 'PreToolUse' || !e.target) continue;
      const edited = EDIT_TOOLS.has(e.tool), read = READ_TOOLS.has(e.tool);
      if (!edited && !read) continue;
      const f = files.get(e.target) || { edited: false, read: false, t: 0, path: '' };
      f.edited ||= edited; f.read ||= read; f.t = Math.max(f.t, e.t);
      if (e.detail && !f.path) f.path = e.detail.split('  (')[0];
      files.set(e.target, f);
    }
    const list = [...files.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 14);
    el.innerHTML = list.length ? `<h3>작업한 파일</h3><div class="chips">${list.map(([name, f]) => `<span class="chip ${f.edited ? 'edited' : ''}" title="${esc(f.path || name)}">${f.edited ? '✏️' : '📖'} ${esc(name)}</span>`).join('')}</div>` : '';
  }

  addEntries(entries) {
    let added = false;
    for (const e of entries) {
      const key = `${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
      if (this.entries.has(key)) continue;
      this.entries.set(key, e);
      added = true;
    }
    if (added) { this.renderLog(); this.renderFiles(); }
  }

  renderLog() {
    const ul = this.el.querySelector('#p-log');
    const list = [...this.entries.values()].sort((a, b) => b.t - a.t).slice(0, 150);
    ul.innerHTML = list.map((e) => {
      const done = e.ev === 'PostToolUse' || e.ev === 'PostToolUseFailure';
      const icon = done ? (e.ev === 'PostToolUse' ? '✓' : '✗') : e.tool ? (ICON[e.tool] || '🔧') : (EV_ICON[e.ev] || '•');
      const dur = done && e.ms ? ` <small>${e.ms >= 1000 ? (e.ms / 1000).toFixed(1) + 's' : e.ms + 'ms'}</small>` : '';
      const head = esc(e.tool ? `${e.tool}${e.target ? ' · ' + e.target : ''}` : e.ev) + dur;
      const cls = e.ev === 'PostToolUseFailure' ? 'err' : e.ev === 'PreToolUse' ? 'pre' : '';
      const detail = e.detail ? `<span class="detail" title="${esc(e.detail)}">${esc(e.detail)}</span>` : '';
      const result = e.result ? `<span class="result" title="${esc(e.result)}">↳ ${esc(e.result)}${e.len > e.result.length ? ` <small>(${fmtLen(e.len)})</small>` : ''}</span>` : '';
      return `<li class="${cls}"><time>${fmtTime(e.t)}</time><span class="ic">${icon}</span><span class="head">${head}</span>${e.text ? `<span class="txt">${esc(e.text)}</span>` : ''}${detail}${result}</li>`;
    }).join('');
  }
}

export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function fmtTime(t) { return new Date(t).toTimeString().slice(0, 8); }
function fmtLen(n) { return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}자`; }
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${sec}초` : `${sec}초`;
}
