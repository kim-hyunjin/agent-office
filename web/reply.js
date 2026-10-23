// Full agent reply in a large dialog, markdown rendered. Opened from the panel's last-reply card.
// The full text is fetched on demand (/sessions/:id/reply) — SSE only carries the short preview.
import { renderMarkdown } from './markdown.js';
import { api } from './api.js';
import { fmtTime, bindDialogClose } from './ui.js';

const dlg = document.getElementById('reply');
const nameEl = document.getElementById('r-name');
const metaEl = document.getElementById('r-meta');
const body = document.getElementById('r-body');
const copyBtn = document.getElementById('r-copy');

const compose = document.getElementById('p-compose');
const composeHome = compose.parentNode, composeNext = compose.nextSibling;

let cur = null; // { id, at, text }

bindDialogClose(dlg, document.getElementById('r-close'));
dlg.addEventListener('close', () => {
  cur = null;
  composeHome.insertBefore(compose, composeNext); // hand the composer back to the panel
});
copyBtn.addEventListener('click', async () => {
  if (!cur) return;
  try { await navigator.clipboard.writeText(cur.text); copyBtn.textContent = '복사됨 ✓'; }
  catch { copyBtn.textContent = '복사 실패'; }
  setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
});

export function openReply(s) {
  cur = { id: s.id, at: -1, text: '' };
  nameEl.textContent = s.name;
  metaEl.textContent = '';
  body.innerHTML = '';
  // Borrow the panel's composer (same input, draft and send state) so instructions can go out from here.
  dlg.append(compose);
  if (!dlg.open) dlg.showModal();
  load(s);
}

/** Keep an open dialog in sync when the same session answers again. */
export function refreshReply(s) {
  if (dlg.open && cur?.id === s.id && s.lastTextAt !== cur.at) load(s);
}

async function load(s) {
  const id = s.id;
  let d = null;
  try { d = await api(`/sessions/${encodeURIComponent(id)}/reply`); } catch { /* server unreachable — fall back to the preview below */ }
  if (cur?.id !== id) return;
  // The SSE preview is cut at 280 chars; say so rather than pass it off as the whole answer.
  const partial = !d;
  if (partial) d = { text: s.lastText || '', at: s.lastTextAt };
  cur = { id, at: d.at, text: d.text || '' };
  metaEl.textContent = [s.title, d.at ? `${fmtTime(d.at)} 답변` : ''].filter(Boolean).join(' · ');
  body.innerHTML = (partial && cur.text ? '<p class="warn">전체 답변을 불러오지 못해 앞부분 미리보기만 보여줍니다. 서버가 이 기능 이전 버전이면 재시작해 주세요.</p>' : '')
    + (cur.text ? renderMarkdown(cur.text) : '<p class="dim">아직 답변이 없습니다.</p>');
  body.scrollTop = 0;
}
