// "모델 안내" dialog: which cat stands for which model, opened from the canvas button in the bottom-right corner
// (render.js drawLegendButton). Every coat variant is shown, plus the kittens (subagents) and the receptionist.
import { FAMILIES, familyOf, sprite, coatPalette, RECEPTIONIST_PAL } from './sprites.js';
import { esc } from './panel.js';

const dlg = document.getElementById('legend');
const body = document.getElementById('lg-body');
const MONITOR = { 'wide-gold': '금색 와이드 모니터', silver: '실버 모니터', normal: '일반 모니터', laptop: '노트북' };
const ZOOM = 4;

document.getElementById('lg-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop

/** A sprite frame as a scaled-up <canvas>. */
function cat(pal, anim = 'idle') {
  const img = sprite(pal, anim, 0);
  const c = document.createElement('canvas');
  c.width = img.width * ZOOM; c.height = img.height * ZOOM;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function row(cats, title, lines) {
  const li = document.createElement('li');
  const pics = document.createElement('div');
  pics.className = 'cats';
  pics.append(...cats);
  const text = document.createElement('div');
  text.innerHTML = `<b>${title}</b>${lines.map((l) => `<div class="dim">${l}</div>`).join('')}`;
  li.append(pics, text);
  return li;
}

export function openLegend(sessions) {
  const count = {};
  for (const s of sessions.values()) if (!s.ended) { const f = familyOf(s.model); count[f] = (count[f] || 0) + 1; }
  const list = document.createElement('ul');
  for (const [fam, f] of Object.entries(FAMILIES)) {
    const n = count[fam] || 0;
    list.append(row(
      f.coats.map((_, i) => cat(coatPalette(fam, i))),
      esc([f.label, f.title, f.breed].filter(Boolean).join(' · ')),
      [esc(MONITOR[f.monitor] || f.monitor), n ? `지금 ${n}명 근무 중` : '지금 근무 중인 직원 없음'],
    ));
  }
  list.append(
    row(['fable', 'opus', 'sonnet', 'haiku'].map((fam) => cat(coatPalette(fam, 0, 'assistant'))), '보조 직원 (서브에이전트)',
      ['부모 직원과 같은 품종의 새끼 고양이. 회의실이나 책상 옆에서 일해요.']),
    row([cat(RECEPTIONIST_PAL)], '안내원', ['로비 카운터에 상주하는 벵갈 고양이(헤드셋). 세션과는 무관해요.']),
  );
  body.replaceChildren(list);
  dlg.showModal();
}
