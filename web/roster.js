// Staff roster: a compact list of every working cat under the HUD — state at a glance, click a row for the
// detail panel, or send one home (two clicks, like the panel's 퇴근 button). Toggled from the HUD's "목록" button.
import { FAMILIES, familyOf, sprite } from './sprites.js';
import { closeSession } from './api.js';
import { esc, pic, STATE_LABEL, STATE_COLOR, BUSY, toolText } from './ui.js';

const ICON_ZOOM = 2;

export class Roster {
  /** onPick(id): open that session's detail panel. placeOf(id): where its cat is right now ('' = at its desk). */
  constructor(el, { onPick, placeOf }) {
    this.el = el;
    this.list = el.querySelector('#rs-list');
    this.countEl = el.querySelector('#rs-count');
    this.onPick = onPick;
    this.placeOf = placeOf;
    this.rows = new Map(); // id -> row elements
    this.armed = null;     // id whose 퇴근 button is waiting for the confirming click
    this.armTimer = null;
    this.pending = new Set(); // ids with a close request in flight or sent
    this.failed = new Map();  // id -> error message, shown in the row for a few seconds
    el.querySelector('#rs-close').addEventListener('click', () => this.close());
  }
  get isOpen() { return !this.el.hidden; }
  toggle(world, anchor) { if (this.isOpen) this.close(); else this.open(world, anchor); }
  /** anchor: viewport px {left, top} just under the HUD. */
  open(world, anchor) {
    this.el.style.left = `${Math.round(anchor.left)}px`;
    this.el.style.top = `${Math.round(anchor.top)}px`;
    this.el.hidden = false;
    this.update(world);
  }
  close() { this.el.hidden = true; this.disarm(); }

  update(world) {
    this.lastWorld = world;
    if (!this.isOpen) return;
    const live = [...world.sessions.values()].filter((s) => !s.ended)
      .sort((a, b) => (a.desk ?? 99) - (b.desk ?? 99) || String(a.name).localeCompare(String(b.name)));
    this.countEl.textContent = live.length;
    const keep = new Set(live.map((s) => s.id));
    for (const [id, r] of this.rows) if (!keep.has(id)) { r.li.remove(); this.rows.delete(id); this.pending.delete(id); }
    let empty = this.list.querySelector('.empty');
    if (!live.length && !empty) { empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = '근무 중인 직원이 없어요.'; this.list.append(empty); }
    if (live.length && empty) empty.remove();
    live.forEach((s, i) => {
      const r = this.rows.get(s.id) || this.makeRow(s);
      this.fill(r, s, world);
      if (this.list.children[i] !== r.li) this.list.insertBefore(r.li, this.list.children[i] || null);
    });
  }

  makeRow(s) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.innerHTML = '<canvas class="cat"></canvas><div class="info"><div class="top"><b class="name"></b><span class="badge"></span></div>'
      + '<div class="line dim"></div></div><button type="button" class="quit">퇴근</button>';
    const r = { li, icon: li.querySelector('.cat'), name: li.querySelector('.name'), badge: li.querySelector('.badge'), line: li.querySelector('.line'), quit: li.querySelector('.quit'), pal: null };
    li.addEventListener('click', () => this.onPick(s.id));
    li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.onPick(s.id); });
    r.quit.addEventListener('click', (ev) => { ev.stopPropagation(); this.quit(r.session); });
    this.rows.set(s.id, r);
    return r;
  }

  fill(r, s, world) {
    r.session = s;
    const pal = world.ents.get(s.id)?.pal;
    if (pal && pal !== r.pal) { // (re)draw the icon when the cat's palette is known or changes
      r.pal = pal;
      pic(sprite(pal, 'idle', 0), ICON_ZOOM, r.icon);
    }
    r.name.textContent = s.name || s.id.slice(0, 8);
    r.badge.textContent = STATE_LABEL[s.state] || s.state;
    r.badge.style.background = STATE_COLOR[s.state] || '#888';
    const f = FAMILIES[familyOf(s.model)];
    const subs = (s.subagents || []).filter((a) => !a.ended).length;
    const doing = s.currentTool ? toolText(s.currentTool) : '';
    const where = this.placeOf(s.id);
    const err = this.failed.get(s.id);
    r.line.classList.toggle('err', !!err);
    r.line.innerHTML = err ? `⚠ 퇴근 실패: ${esc(err)}`
      : [doing && esc(doing), where && `📍 ${esc(where)}`, subs && `보조 ${subs}`, f && esc([f.label, f.title].filter(Boolean).join(' '))].filter(Boolean).join(' · ');
    if (err) r.line.title = err; else r.line.removeAttribute('title');
    r.li.title = s.cwd || '';
    const busy = s.state !== 'idle';
    if (this.pending.has(s.id)) { r.quit.textContent = '퇴근 중…'; r.quit.disabled = true; r.quit.className = 'quit'; }
    else if (this.armed === s.id) { r.quit.textContent = busy ? '강제 종료?' : '정말 퇴근?'; r.quit.disabled = false; r.quit.className = 'quit armed'; }
    else { r.quit.textContent = '퇴근'; r.quit.disabled = false; r.quit.className = 'quit'; }
    r.quit.title = busy ? `${BUSY.has(s.state) ? '작업 중' : '응답 대기'} — Orca 터미널 탭을 닫아 끊습니다` : '/exit 로 세션을 끝냅니다';
  }

  /** First click arms (4s), second sends: idle → /exit, otherwise close the terminal (same rule as the panel). */
  async quit(s) {
    if (!s || this.pending.has(s.id)) return;
    if (this.armed !== s.id) {
      this.disarm();
      this.armed = s.id;
      this.armTimer = setTimeout(() => { this.disarm(); this.refreshRow(s.id); }, 4000);
      this.refreshRow(s.id);
      return;
    }
    this.disarm();
    this.pending.add(s.id);
    this.refreshRow(s.id);
    try {
      await closeSession(s.id, s.state !== 'idle');
      // the row disappears when the session ends; if it never does, let the button be used again
      setTimeout(() => { this.pending.delete(s.id); this.refreshRow(s.id); }, 20000);
    } catch (e) {
      this.pending.delete(s.id);
      this.failed.set(s.id, e.message);
      setTimeout(() => { this.failed.delete(s.id); this.refreshRow(s.id); }, 5000);
    }
    this.refreshRow(s.id);
  }
  disarm() { clearTimeout(this.armTimer); this.armed = null; }
  refreshRow(id) {
    const r = this.rows.get(id);
    if (r && r.session && this.lastWorld) this.fill(r, r.session, this.lastWorld);
  }
}
