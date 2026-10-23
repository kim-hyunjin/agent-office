// "새 직원" dialog: start a claude session in an Orca worktree via the server's /orca/launch.
// Opened from the #t-new toolbar button.
const dlg = document.getElementById('launcher');
const form = document.getElementById('l-form');
const sel = document.getElementById('l-worktree');
const model = document.getElementById('l-model');
const prompt = document.getElementById('l-prompt');
const msg = document.getElementById('l-msg');
const submit = document.getElementById('l-submit');
const newWt = document.getElementById('l-new');
const newHint = document.getElementById('l-new-hint');
const nameRow = document.getElementById('l-name-row');
const nameIn = document.getElementById('l-name');
const countIn = document.getElementById('l-count');
const countHint = document.getElementById('l-count-hint');
const MAX_HIRES = 5; // keep in sync with server/index.mjs
const NAME_RE = /^[A-Za-z0-9][\w.\-]{0,59}$/;
let worktrees = [];

const LAST_KEY = 'pawgents-office:last-worktree';
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
    worktrees = list;
    const last = store.get();
    sel.innerHTML = list.map((w) => {
      const label = `${w.repo}${w.branch ? ` · ${w.branch}` : ''}${w.name && w.name !== w.branch ? ` (${w.name})` : ''}`;
      return `<option value="${esc(w.id)}" title="${esc(w.path)}"${w.id === last ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    sel.disabled = false;
    syncForm();
  } catch (e) {
    sel.innerHTML = '<option value="">—</option>';
    setMsg(e.message, 'err');
  }
}

/** Explain what the current choices will do: which branch a new worktree comes from, and how hires are spread. */
function syncForm() {
  const base = worktrees.find((w) => w.id === sel.value);
  const from = base ? base.branch || (base.head ? base.head.slice(0, 7) : '') : '';
  newHint.textContent = from ? `(${from} 에서 분기)` : '(선택한 워크트리의 브랜치에서 분기)';
  nameRow.hidden = !newWt.checked;
  const n = Math.min(MAX_HIRES, Math.max(1, Math.floor(Number(countIn.value) || 1)));
  const nm = nameIn.value.trim() || '이름';
  countHint.textContent = newWt.checked
    ? (n > 1 ? `(워크트리 ${n}개: ${nm}-1 … ${nm}-${n}, 한 명씩)` : '(새 워크트리 1개)')
    : (n > 1 ? `(같은 워크트리에 탭 ${n}개)` : '');
}
sel.addEventListener('change', syncForm);
countIn.addEventListener('input', syncForm);
nameIn.addEventListener('input', syncForm);
newWt.addEventListener('change', () => {
  if (newWt.checked && !nameIn.value.trim()) nameIn.value = `cat-${Math.random().toString(36).slice(2, 6)}`;
  syncForm();
  if (newWt.checked) nameIn.select();
});

export function openLauncher() {
  if (dlg.open) return;
  // every open starts from the defaults (the worktree list still preselects the last one used)
  newWt.checked = false; nameIn.value = ''; countIn.value = '1'; model.value = ''; prompt.value = '';
  setMsg('');
  submit.disabled = false;
  syncForm();
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
  const count = Math.floor(Number(countIn.value));
  if (!(count >= 1 && count <= MAX_HIRES)) { setMsg(`인원은 1~${MAX_HIRES}명이에요.`, 'err'); return; }
  const name = nameIn.value.trim();
  if (newWt.checked && !NAME_RE.test(name)) { setMsg('워크트리 이름은 영문·숫자·. _ - 만, 60자까지 쓸 수 있어요.', 'err'); return; }
  submit.disabled = true;
  setMsg(newWt.checked ? `워크트리를 만들고 ${count}명 채용하는 중… (조금 걸려요)` : `Orca에서 ${count}명 시작하는 중…`);
  try {
    const r = await fetch('/orca/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeId: sel.value, model: model.value.trim(), prompt: prompt.value.trim(), count,
        newWorktree: newWt.checked ? { name } : null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    store.set(sel.value);
    if (d.errors?.length) { // some hires failed: keep the dialog open with what went wrong
      setMsg(`${d.started}명 시작, ${d.errors.length}명 실패:\n${d.errors.join('\n')}`, 'err');
      submit.disabled = false;
      return;
    }
    setMsg(`${d.started}명 시작됨 — 곧 로비로 들어옵니다.`, 'ok');
    setTimeout(() => dlg.close(), 900);
  } catch (err) {
    setMsg(err.message, 'err');
    submit.disabled = false;
  }
});

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
