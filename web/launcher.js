// "새 직원" dialog: start a claude session in an Orca worktree via the server's /orca/launch.
// Opened from the canvas button next to the model legend (render.js drawNewButton).
const dlg = document.getElementById('launcher');
const form = document.getElementById('l-form');
const sel = document.getElementById('l-worktree');
const model = document.getElementById('l-model');
const prompt = document.getElementById('l-prompt');
const msg = document.getElementById('l-msg');
const submit = document.getElementById('l-submit');

const LAST_KEY = 'agent-office:last-worktree';
const store = {
  get() { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(LAST_KEY, v); } catch { /* private mode */ } },
};

function setMsg(text, kind = '') { msg.textContent = text; msg.className = `msg ${kind}`; }

async function loadWorktrees() {
  sel.disabled = true;
  sel.innerHTML = '<option value="">불러오는 중…</option>';
  try {
    const r = await fetch('/orca/worktrees');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    const list = d.worktrees || [];
    if (!list.length) throw new Error('Orca에 등록된 워크트리가 없습니다.');
    const last = store.get();
    sel.innerHTML = list.map((w) => {
      const label = `${w.repo}${w.branch ? ` · ${w.branch}` : ''}${w.name && w.name !== w.branch ? ` (${w.name})` : ''}`;
      return `<option value="${esc(w.id)}" title="${esc(w.path)}"${w.id === last ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    sel.disabled = false;
  } catch (e) {
    sel.innerHTML = '<option value="">—</option>';
    setMsg(e.message, 'err');
  }
}

export function openLauncher() {
  if (dlg.open) return;
  setMsg('');
  submit.disabled = false;
  dlg.showModal();
  loadWorktrees();
  prompt.focus();
}
document.getElementById('l-cancel').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sel.value || submit.disabled) return;
  submit.disabled = true;
  setMsg('Orca에서 시작하는 중…');
  try {
    const r = await fetch('/orca/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ worktreeId: sel.value, model: model.value.trim(), prompt: prompt.value.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    store.set(sel.value);
    prompt.value = '';
    setMsg('시작됨 — 곧 로비로 들어옵니다.', 'ok');
    setTimeout(() => dlg.close(), 900);
  } catch (err) {
    setMsg(err.message, 'err');
    submit.disabled = false;
  }
});

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
