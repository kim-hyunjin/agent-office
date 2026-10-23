import { WALL_RISE, DEFAULT_OFFICE, inRect } from './layout.js';
import { paletteFor, familyOf, FAMILIES, setBreedChoices, setSkins, onSkinLoad, sprite } from './sprites.js';
import { clamp } from './anim.js';
import { render, STATE_LABEL, HUD_BTN } from './render.js';
import { Editor } from './editor.js';
import { openLegend, refreshLegend } from './legend.js';
import { Roster } from './roster.js';
import { openLauncher } from './launcher.js';
import { Panel, awaitingBg, bgSummary } from './panel.js';
import { post } from './api.js';
import { esc, pic, storage } from './ui.js';
import { feedFrom, renderFeed } from './feed.js';
import { world, applyLayout, here, syncSession, exitSession, dropCats, retarget, fadeStep, entAt, placeOf } from './world.js';

const params = new URLSearchParams(location.search);

const canvas = document.getElementById('office');
const tabsEl = document.getElementById('tabs');
const barEl = document.getElementById('bar'); // office tabs + the tool buttons, above the office
const toolsEl = document.getElementById('tools');
const stageEl = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const panel = new Panel(document.getElementById('panel'), {
  onOpen: () => refit(),
  onClose: () => { world.selectedKey = null; history.replaceState(null, '', location.pathname + location.search); refit(); },
});

let S = 3;

const PANEL_W = 380; // keep in sync with #panel width in style.css
const PANEL_ANIM_MS = 220; // keep in sync with the #panel / #office.refit transitions
// Width the open panel takes from the office. On narrow windows the panel just covers it.
const panelRoom = () => ((panel.isOpen || editor.isOpen) && window.innerWidth >= PANEL_W * 2 ? PANEL_W : 0);

// Whole-number zoom, like pixel-art games: every art pixel is the same size on screen. Fit: at least MIN_SCALE, more
// when the window has room; an office bigger than the window scrolls instead of shrinking its pixels. The −/+ buttons
// pin a zoom instead (remembered per browser); the zoom button between them goes back to fitting.
const MIN_SCALE = 2, MAX_SCALE = 8;
let zoom = null; // pinned scale, or null: fit the window
{ const z = Math.round(Number(storage.get('pawgents.zoom'))); zoom = z >= 1 ? Math.min(z, MAX_SCALE) : null; }
function fitScale() {
  if (zoom) return zoom;
  const ticker = document.getElementById('ticker');
  const availW = window.innerWidth - 16 - panelRoom();
  const availH = window.innerHeight - 12 - (ticker.hidden ? 0 : ticker.offsetHeight) - barEl.offsetHeight;
  return clamp(Math.floor(Math.min(availW / world.view.geo.W, availH / world.view.geo.VIEW_H)), MIN_SCALE, MAX_SCALE);
}
const zoomBtn = document.getElementById('t-zoom');
function setZoom(z) {
  zoom = z ? clamp(z, 1, MAX_SCALE) : null;
  if (zoom) storage.set('pawgents.zoom', zoom); else storage.remove('pawgents.zoom');
  resize();
}
document.getElementById('t-zoom-out').addEventListener('click', () => setZoom(S - 1));
document.getElementById('t-zoom-in').addEventListener('click', () => setZoom(S + 1));
zoomBtn.addEventListener('click', () => setZoom(null));
function showZoom() {
  zoomBtn.textContent = `${S}×`;
  zoomBtn.classList.toggle('pinned', !!zoom);
  zoomBtn.title = zoom ? '눌러서 창 크기에 맞추기' : '창 크기에 맞춘 배율';
  document.getElementById('t-zoom-out').disabled = S <= 1;
  document.getElementById('t-zoom-in').disabled = S >= MAX_SCALE;
}

/** The ticker (bottom) and the panel (right) float over the page: pad the page so the office can scroll out from under them. */
function placeTicker() {
  const ticker = document.getElementById('ticker'), side = panel.isOpen || editor.isOpen ? Math.min(PANEL_W, window.innerWidth) : 0;
  ticker.style.right = `${side}px`;
  stageEl.style.paddingBottom = `${(ticker.hidden ? 0 : ticker.offsetHeight) + 4}px`;
  stageEl.style.paddingRight = `${side + 4}px`;
}

/** Fit the office to the window at once (backing store + CSS size). */
function resize() {
  clearTimeout(refitTimer);
  canvas.classList.remove('refit');
  S = fitScale();
  canvas.width = Math.round(world.view.geo.W * S); canvas.height = Math.round(world.view.geo.VIEW_H * S);
  canvas.style.width = `${canvas.width}px`; canvas.style.height = `${canvas.height}px`;
  barEl.style.width = canvas.style.width;
  toolsEl.classList.toggle('off', editor.isOpen); // the editor has its own buttons
  showZoom();
  placeTicker();
}

/**
 * Panel opened/closed: ease the CSS size toward the new fit (left edge stays put while it grows
 * or shrinks), then re-rasterize at that size so pixels and text are crisp again.
 */
let refitTimer = null;
function refit() {
  placeTicker();
  const s = fitScale();
  if (s === S && !canvas.classList.contains('refit')) return;
  canvas.classList.add('refit');
  canvas.style.width = `${Math.round(world.view.geo.W * s)}px`; canvas.style.height = `${Math.round(world.view.geo.VIEW_H * s)}px`;
  barEl.style.width = canvas.style.width;
  clearTimeout(refitTimer);
  refitTimer = setTimeout(resize, PANEL_ANIM_MS + 20);
}
window.addEventListener('resize', resize);
const editor = new Editor({ world, canvas, officeXY, onResize: () => resize() });
applyLayout(DEFAULT_OFFICE); resize();

/** Pointer position in office (unscaled) pixels; CSS size can differ from the backing store mid-refit. */
function officeXY(ev) {
  const k = canvas.width / (canvas.clientWidth || canvas.width);
  return [(ev.offsetX * k) / S, (ev.offsetY * k) / S - WALL_RISE];
}

const refreshLists = () => { roster.update(world); renderTabs(); };
function upsertSession(s, seated = false) {
  const now = Date.now();
  const moved = world.sessions.has(s.id) && world.sessions.get(s.id).officeId !== s.officeId;
  world.sessions.set(s.id, s);
  feedFrom(s);
  if (moved) renderFeed(false); // its history comes along to (or leaves) the office on screen
  if (here(s)) syncSession(s, seated, now);
  else dropCats(s.id); // works in another office: no cat here
  panel.update(s);
  refreshLists();
}
function removeSession(id) {
  const s = world.sessions.get(id);
  world.sessions.delete(id);
  exitSession(id);
  panel.remove(id);
  refreshLists();
  if (world.selectedKey === id) world.selectedKey = null;
  return s;
}
/** Show a session in the panel; `key` is the cat to highlight (an assistant's, when it was clicked). */
function select(s, { key = s.id, hash = true } = {}) {
  world.selectedKey = key;
  panel.open(s);
  if (hash) history.replaceState(null, '', `#s=${encodeURIComponent(s.id)}`);
}
function deselect() { world.selectedKey = null; panel.close(); }

// ---- offices ---------------------------------------------------------------------
const OFFICE_KEY = 'pawgents-office:office';
const officeOf = (id) => world.offices.find((o) => o.id === id);
/** Server list changed: keep the current office (or pick one), re-lay it out if its layout changed, redraw the tabs. */
function setOffices(list, together = null) {
  world.offices = list;
  world.together = officeOf(together) ? together : null;
  if (world.together && world.officeId !== world.together) { editor.close(); switchOffice(world.together); return; }
  const cur = officeOf(world.officeId);
  if (!cur) { switchOffice(preferredOffice()); return; }
  if (JSON.stringify(cur.layout) !== world.layoutJson) { world.layoutJson = JSON.stringify(cur.layout); applyLayout(cur.layout); resize(); }
  renderTabs();
}
function preferredOffice() {
  let want = params.get('office');
  if (!want) want = storage.get(OFFICE_KEY);
  if (officeOf(want)) return want;
  // otherwise the busiest office
  const n = (o) => [...world.sessions.values()].filter((s) => !s.ended && s.officeId === o.id).length;
  return [...world.offices].sort((a, b) => n(b) - n(a))[0]?.id;
}
/** Show another office: its layout, with its staff already at their places. */
function switchOffice(id) {
  const o = officeOf(id);
  if (!o) return;
  world.officeId = id;
  storage.set(OFFICE_KEY, id);
  if (params.has('office')) { params.set('office', id); history.replaceState(null, '', `?${params}${location.hash}`); }
  world.ents.clear();
  world.hoverKey = null;
  world.layoutJson = JSON.stringify(o.layout);
  applyLayout(o.layout); resize();
  for (const s of world.sessions.values()) if (here(s) && !s.ended) upsertSession(s, true);
  renderFeed(false);
  refreshLists();
}
/**
 * Tabs above the office, one per office, with head count and a dot when someone works (yellow: waiting on you),
 * and a button to gather everyone here / split up again. Gathered: only the shared office's tab. Hidden with one office.
 */
function renderTabs() {
  const hidden = world.offices.length < 2 && !world.together;
  if (tabsEl.hidden !== hidden) { tabsEl.hidden = hidden; tabsEl.dataset.html = ''; if (hidden) resize(); }
  if (hidden) return;
  const shown = !tabsEl.dataset.html; // first fill: the office shrinks to make room
  const offices = world.together ? world.offices.filter((o) => o.id === world.together) : world.offices;
  const html = offices.map((o) => {
    const staff = [...world.sessions.values()].filter((s) => !s.ended && s.officeId === o.id);
    const dot = staff.some((s) => s.state === 'waiting') ? '<i class="dot wait"></i>' : staff.some((s) => s.state !== 'idle') ? '<i class="dot"></i>' : '';
    const title = o.repos.filter((r) => r !== 'default').join('\n') || '저장소 밖에서 일하는 세션';
    return `<button type="button" data-id="${esc(o.id)}" class="${o.id === world.officeId ? 'on' : ''}" title="${esc(title)}">${esc(o.name)}<span class="n">${staff.length}</span>${dot}</button>`;
  }).join('') + (world.together
    ? '<button type="button" class="act" data-act="split" title="저장소마다 각자의 사무실로 돌아갑니다">↔ 저장소별로 나누기</button>'
    : '<button type="button" class="act" data-act="gather" title="모든 세션이 지금 보고 있는 사무실에 모여서 일합니다">⇢ 이 사무실에 모두 모이기</button>');
  if (html !== tabsEl.dataset.html) { tabsEl.innerHTML = html; tabsEl.dataset.html = html; }
  if (shown) resize();
}
tabsEl.addEventListener('click', (ev) => {
  const act = ev.target.closest('button[data-act]');
  if (act) { setTogether(act.dataset.act === 'gather' ? world.officeId : null, act); return; }
  const b = ev.target.closest('button[data-id]');
  if (b && b.dataset.id !== world.officeId) { editor.close(); switchOffice(b.dataset.id); }
});
/** Gather everyone in one office (null: split up by repo). The server moves the staff and pushes the result. */
async function setTogether(officeId, btn) {
  btn.disabled = true;
  try { await post('/settings/together', { officeId }); } catch (e) { btn.title = `실패: ${e.message}`; } finally { btn.disabled = false; }
}
let firstSnapshot = true;
/** Breed or skin choices changed (snapshot or a 'settings' push): redraw every cat with its family's look. */
function applyCatChoices({ cats, skins }) {
  setBreedChoices(cats);
  setSkins(skins);
  repaintCats();
}
// a skin finished loading: families picking it switch from their default breed to it
onSkinLoad(() => repaintCats());
function repaintCats() {
  for (const e of world.ents.values()) {
    const s = world.sessions.get(e.sessionId);
    if (!s) continue;
    if (e.kind === 'employee') e.pal = paletteFor(s.id, 'employee', s.model);
    else e.pal = paletteFor(e.agentId, 'assistant', e.data?.model || s.model);
  }
  roster.update(world);
  refreshLegend();
}
function applySnapshot(snap) {
  applyCatChoices(snap);
  const seated = firstSnapshot;
  firstSnapshot = false;
  if (seated) for (const s of snap.sessions) world.sessions.set(s.id, s); // so the first office pick sees who works where
  const m = seated && location.hash.match(/^#s=([^&]+)/);
  const picked = m && snap.sessions.find((x) => x.id.startsWith(decodeURIComponent(m[1])));
  world.offices = snap.offices;
  if (picked && officeOf(picked.officeId)) { world.together = officeOf(snap.together) ? snap.together : null; switchOffice(picked.officeId); }
  else setOffices(snap.offices, snap.together);
  const ids = new Set();
  for (const s of snap.sessions) { ids.add(s.id); upsertSession(s, seated && !s.ended); }
  for (const id of [...world.sessions.keys()]) if (!ids.has(id)) removeSession(id);
  if (picked) select(world.sessions.get(picked.id), { hash: false });
}
// Re-evaluate stations once a second (lounge timing, meeting/library linger).
setInterval(() => {
  retarget(Date.now());
  refreshLists(); // places change as cats walk around
}, 1000);

// ---- SSE -----------------------------------------------------------------------
let everConnected = false;
function connect() {
  const es = new EventSource('/events');
  es.addEventListener('snapshot', (ev) => { world.connected = true; applySnapshot(JSON.parse(ev.data)); });
  es.addEventListener('session', (ev) => upsertSession(JSON.parse(ev.data)));
  es.addEventListener('remove', (ev) => removeSession(JSON.parse(ev.data).id));
  es.addEventListener('settings', (ev) => applyCatChoices(JSON.parse(ev.data)));
  es.addEventListener('offices', (ev) => { const d = JSON.parse(ev.data); setOffices(d.offices, d.together); });
  es.onopen = () => {
    world.connected = true;
    if (everConnected) fetch('/state').then((r) => r.json()).then(applySnapshot).catch(() => {});
    everConnected = true;
  };
  es.onerror = () => { world.connected = false; };
}
connect();

// ---- roster (opened from the HUD) ----------------------------------------------------
const roster = new Roster(document.getElementById('roster'), {
  onPick: (id) => {
    const s = world.sessions.get(id);
    if (!s) return;
    if (!here(s)) switchOffice(s.officeId);
    select(s);
  },
  placeOf: (id) => {
    const s = world.sessions.get(id);
    if (s && !here(s)) return officeOf(s.officeId)?.name || ''; // works in another office
    const e = world.ents.get(id);
    return e && e.station?.kind !== 'desk' ? placeOf(e) : '';
  },
});
/** Viewport position just under the HUD's left edge. */
function rosterAnchor() {
  const r = canvas.getBoundingClientRect(), k = r.width / canvas.width, b = world.hudBtn;
  return { left: r.left + b.x * S * k, top: r.top + (b.y + b.h + WALL_RISE + 2) * S * k };
}
function toggleRoster() {
  roster.toggle(world, rosterAnchor());
  world.rosterOpen = roster.isOpen;
}
document.getElementById('rs-close').addEventListener('click', () => { world.rosterOpen = false; });
window.addEventListener('resize', () => { if (roster.isOpen) roster.open(world, rosterAnchor()); });

// ---- input ---------------------------------------------------------------------
function describe(e) {
  const s = world.sessions.get(e.sessionId);
  if (!s) return '';
  const where = placeOf(e);
  const toolLine = (d) => d.currentTool ? `<span class="st">${esc(STATE_LABEL[d.state] || d.state)}</span> · <b>${esc(d.currentTool.name)}</b>${d.currentTool.target ? ' · ' + esc(d.currentTool.target) : ''}${d.currentTool.detail ? `<div class="detail">${esc(d.currentTool.detail)}</div>` : ''}` : `<span class="st">${esc(STATE_LABEL[d.state] || d.state)}</span>`;
  const think = (d) => d.lastThinking && Date.now() - d.lastThinkingAt < 3 * 60_000 && d.state !== 'idle' ? `<div class="think">💭 ${esc(d.lastThinking)}</div>` : '';
  if (e.kind === 'assistant') {
    const a = e.data;
    return `<b>🧢 ${esc(a.type || 'agent')}</b> <span class="dim">보조 · ${esc(s.name)}${where ? ' · ' + where : ''}</span>`
      + (a.description ? `<div>${esc(a.description)}</div>` : '')
      + (a.task ? `<div class="task">${esc(a.task)}</div>` : '')
      + `<div>${toolLine(a)}</div>${think(a)}`;
  }
  const tier = FAMILIES[familyOf(s.model)].title;
  return `<b>${esc(s.name)}</b>${tier ? ` <span class="st">${tier}</span>` : ''}${where ? ` <span class="dim">· ${where}</span>` : ''}${s.title ? `<br>${esc(s.title)}` : ''}`
    + (s.lastPrompt ? `<div class="task">지시: ${esc(s.lastPrompt)}</div>` : '')
    + `<div>${toolLine(s)}${s.permissionMode ? ` <span class="dim">· ${esc(s.permissionMode)}</span>` : ''}</div>${think(s)}`
    + (awaitingBg(s) ? `<div class="task">⏳ ${esc(bgSummary(s))}</div>` : '')
    + `<div class="dim">${esc(s.cwd)}${s.model ? ' · ' + esc(s.model) : ''}</div>`;
}

/** The HUD on the top wall is the one canvas-drawn button (its rect is written by render.js each frame). */
const buttonAt = ([x, y]) => (world.hudBtn && inRect(world.hudBtn, x, y) ? HUD_BTN : null);

canvas.addEventListener('mousemove', (ev) => {
  if (editor.isOpen) { world.hoverKey = null; tip.hidden = true; return; } // the editor handles the pointer
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn) { world.hoverKey = btn; canvas.style.cursor = 'pointer'; tip.hidden = true; return; }
  const e = entAt(...xy);
  world.hoverKey = e ? e.key : null;
  canvas.style.cursor = e ? 'pointer' : 'default';
  if (e) {
    tip.innerHTML = describe(e);
    tip.hidden = false;
    const r = canvas.getBoundingClientRect();
    let tx = r.left + ev.offsetX + 14, ty = r.top + ev.offsetY + 14;
    if (tx + tip.offsetWidth > window.innerWidth - 8) tx = r.left + ev.offsetX - tip.offsetWidth - 8;
    if (ty + tip.offsetHeight > window.innerHeight - 8) ty = r.top + ev.offsetY - tip.offsetHeight - 8;
    tip.style.left = `${tx}px`; tip.style.top = `${ty}px`;
  } else tip.hidden = true;
});
canvas.addEventListener('mouseleave', () => { world.hoverKey = null; tip.hidden = true; });
canvas.addEventListener('click', (ev) => {
  if (editor.isOpen) return;
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn === HUD_BTN) { toggleRoster(); return; }
  const e = entAt(...xy);
  if (!e) { deselect(); return; }
  const s = world.sessions.get(e.sessionId);
  if (s) select(s, { key: e.key }); else world.selectedKey = e.key;
});

// ---- tool buttons (above the office) ---------------------------------------------------
document.getElementById('t-new').addEventListener('click', () => openLauncher());
document.getElementById('t-legend').addEventListener('click', () => openLegend(world.sessions));
document.getElementById('t-edit').addEventListener('click', () => { // layout editor takes the panel's place
  if (editor.isOpen || !officeOf(world.officeId)) return;
  if (roster.isOpen) toggleRoster();
  deselect();
  editor.open(officeOf(world.officeId));
});
{ // the legend button wears a cat, like the legend itself
  document.getElementById('t-legend').prepend(pic(sprite(paletteFor('legend', 'employee', 'claude-fable'), 'idle', 0)));
}

// ---- loop ----------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // rAF time is page-relative; fadeAt and everything else use wall-clock ms
  const wall = Date.now();
  fadeStep(wall, dt);
  render(ctx, S, world, wall);
  if (editor.isOpen) editor.draw(ctx, S);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
