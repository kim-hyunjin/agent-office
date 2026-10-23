// One file's git diff in a large dialog, colored by line. Opened from the panel's worked-file chips;
// the patch comes from /sessions/:id/diff (working tree vs HEAD, or the session's last commit of it).
import { api } from './api.js';
import { esc, bindDialogClose } from './ui.js';

const dlg = document.getElementById('diff');
const nameEl = document.getElementById('d-name');
const metaEl = document.getElementById('d-meta');
const warnEl = document.getElementById('d-warn');
const body = document.getElementById('d-body');
const copyBtn = document.getElementById('d-copy');

let cur = null; // { id, file, t, patch }

bindDialogClose(dlg, document.getElementById('d-close'));
dlg.addEventListener('close', () => { cur = null; });
copyBtn.addEventListener('click', async () => {
  if (!cur) return;
  try { await navigator.clipboard.writeText(cur.patch); copyBtn.textContent = '복사됨 ✓'; }
  catch { copyBtn.textContent = '복사 실패'; }
  setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
});

const STATUS = {
  changed: 'HEAD 기준 작업 트리 변경',
  untracked: '새 파일 (아직 git에 추가되지 않음)',
  clean: 'HEAD와 차이 없음',
  missing: '파일이 없습니다',
};
const touchedAt = (s, file) => (s.files || []).find((f) => f.path === file)?.t ?? 0;

export function openDiff(s, file) {
  cur = { id: s.id, file, t: touchedAt(s, file), patch: '' };
  nameEl.textContent = file.split(/[\\/]/).pop();
  metaEl.textContent = file;
  warnEl.hidden = true;
  body.innerHTML = '';
  if (!dlg.open) dlg.showModal();
  load(s);
}

/** The session touched the open file again (a tool finished on it): fetch the diff anew. */
export function refreshDiff(s) {
  if (!dlg.open || cur?.id !== s.id) return;
  const t = touchedAt(s, cur.file);
  if (t > cur.t) { cur.t = t; load(s); }
}

async function load(s) {
  const { id, file } = cur;
  let d;
  try { d = await api(`/sessions/${encodeURIComponent(id)}/diff?file=${encodeURIComponent(file)}`); }
  catch (e) {
    if (cur?.id !== id || cur.file !== file) return;
    warnEl.textContent = e.message; warnEl.hidden = false;
    body.innerHTML = '';
    return;
  }
  if (cur?.id !== id || cur.file !== file) return;
  cur.patch = d.patch || '';
  const { html, add, del } = render(cur.patch);
  const status = d.status === 'committed' ? `작업 트리에 변경 없음 · 세션 중 마지막 커밋 "${d.commit?.subject || d.commit?.hash?.slice(0, 7) || ''}" 기준` : STATUS[d.status] || d.status;
  metaEl.textContent = [d.rel || file, status, cur.patch ? `+${add} −${del}` : ''].filter(Boolean).join(' · ');
  warnEl.textContent = d.truncated ? `diff가 너무 커서 앞부분 ${cur.patch.length.toLocaleString()}자만 보여줍니다.` : '';
  warnEl.hidden = !d.truncated;
  body.innerHTML = html || '<span class="l meta">(보여줄 diff가 없습니다)</span>';
  body.scrollTop = 0;
}

/** Unified diff → one block per line. Header lines (`---`/`+++`) count only before the first hunk. */
function render(patch) {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let add = 0, del = 0, header = true;
  const html = lines.map((line) => {
    let cls = 'ctx';
    if (line.startsWith('diff --git')) { header = true; cls = 'meta'; }
    else if (line.startsWith('@@')) { header = false; cls = 'hunk'; }
    else if (header || line.startsWith('\\ No newline')) cls = 'meta';
    else if (line.startsWith('+')) { cls = 'add'; add++; }
    else if (line.startsWith('-')) { cls = 'del'; del++; }
    return `<span class="l ${cls}">${esc(line)}</span>`;
  }).join('');
  return { html, add, del };
}
