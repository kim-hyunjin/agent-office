import { TILE, WALL_RISE, compile, DEFAULT_OFFICE } from './layout.js';
import { buildBackground } from './tilemap.js';
import { paletteFor, hashStr, familyOf, FAMILIES, setBreedChoices, setSkins, onSkinLoad, sprite } from './sprites.js';
import { step, clamp } from './anim.js';
import { render, STATE_LABEL, HUD_BTN } from './render.js';
import { Editor } from './editor.js';
import { openLegend, refreshLegend } from './legend.js';
import { Roster } from './roster.js';
import { openLauncher } from './launcher.js';
import { Panel, ICON, EV_ICON, esc, fmtTime, awaitingBg, bgSummary } from './panel.js';

const params = new URLSearchParams(location.search);
const PLAY_AFTER_MS = Number(params.get('playAfter') || 15) * 1000; // idle this long → off to play / lounge
const MEETING_LINGER_MS = 8000; // keep the meeting room this long after the last subagent finishes
const LIBRARY_LINGER_MS = 10000; // stay at the bookshelf this long after the last search, so back-to-back searches don't bounce

const canvas = document.getElementById('office');
const tabsEl = document.getElementById('tabs');
const barEl = document.getElementById('bar'); // office tabs + the tool buttons, above the office
const toolsEl = document.getElementById('tools');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const panel = new Panel(document.getElementById('panel'), {
  onOpen: () => refit(),
  onClose: () => { world.selectedKey = null; history.replaceState(null, '', location.pathname + location.search); refit(); },
});

/** Sticky slot allocator: a key keeps its slot until released. */
class Slots {
  constructor(spots) { this.spots = spots; this.owner = new Map(); this.of = new Map(); }
  take(key) {
    if (this.of.has(key)) return this.of.get(key);
    for (let i = 0; i < this.spots.length; i++) if (!this.owner.has(i)) { this.owner.set(i, key); this.of.set(key, i); return i; }
    return -1;
  }
  release(key) { const i = this.of.get(key); if (i === undefined) return; this.of.delete(key); this.owner.delete(i); }
  /** Move key to a random free slot other than its current one; keeps the current slot if none is free. */
  takeRandom(key) {
    const free = [];
    for (let i = 0; i < this.spots.length; i++) if (!this.owner.has(i)) free.push(i);
    if (!free.length) return this.of.get(key) ?? -1;
    this.release(key);
    const i = free[Math.floor(Math.random() * free.length)];
    this.owner.set(i, key); this.of.set(key, i);
    return i;
  }
  has(key) { return this.of.has(key); }
}

const dwellMs = (act) => (act === 'nap' || act === 'lounge' ? 20000 + Math.random() * 20000 : 7000 + Math.random() * 8000);

const world = {
  offices: [],         // [{ id, name, repos, layout }] from the server, one per repo
  officeId: null,      // the office on screen; only its sessions get cats
  together: null,      // office everyone works in regardless of repo (server setting), or null
  layoutJson: '',      // its layout as last applied, to spot changes
  geo: null,           // compiled layout (layout.js) of the office on screen
  bg: null,
  view: null,          // what is drawn: { geo, bg } of the live office, or of the editor's draft
  editing: false,
  sessions: new Map(), // id -> server session object
  ents: new Map(),     // key -> entity
  hoverKey: null,
  selectedKey: null,
  connected: false,
  // slot allocators over the layout's spots; rebuilt by applyLayout
  rooms: [],           // meeting room index -> session id
  roomSeats: [],
  plan: null, library: null, bullpen: null,
  funSpots: [],        // idle cats roam between these: the play area plus the lounge (sofa, coffee machine)
  play: null,
  near: new Map(),     // aisle -> Slots
};
let S = 3;

/** Switch to a layout: rebuild the background and every slot, then send each cat to its (new) station. */
function applyLayout(office) {
  const geo = compile(office);
  world.geo = geo;
  world.bg = buildBackground(geo);
  if (!world.editing) world.view = { geo, bg: world.bg };
  world.rooms = geo.meetings.map(() => null);
  world.roomSeats = geo.meetings.map((r) => new Slots(r.seats));
  world.plan = new Slots(geo.planSpots);
  world.library = new Slots(geo.librarySpots);
  world.funSpots = [...geo.playSpots, ...geo.loungeSpots.map((p) => ({ ...p, act: 'lounge' }))];
  world.play = new Slots(world.funSpots);
  world.bullpen = new Slots(geo.bullpenSpots);
  world.near = new Map();
  const now = Date.now();
  for (const e of world.ents.values()) {
    e.station = null;
    if (e.phase === 'fade') continue;
    const s = world.sessions.get(e.sessionId);
    if (!s) goTo(e, { kind: 'exit', ...geo.spawn });
    else if (e.kind === 'employee') goTo(e, sessionStation(s, e, now));
    else if (e.data && !e.data.ended) goTo(e, assistantStation(s, e.data));
  }
  if (S) resize();
}

const PANEL_W = 380; // keep in sync with #panel width in style.css
const PANEL_ANIM_MS = 220; // keep in sync with the #panel / #office.refit transitions
// Width the open panel takes from the office. On narrow windows the panel just covers it.
const panelRoom = () => ((panel.isOpen || editor.isOpen) && window.innerWidth >= PANEL_W * 2 ? PANEL_W : 0);

function fitScale() {
  const ticker = document.getElementById('ticker');
  const availW = window.innerWidth - 16 - panelRoom();
  const availH = window.innerHeight - 12 - (ticker.hidden ? 0 : ticker.offsetHeight) - barEl.offsetHeight;
  // Fill the space. Fractional scale is fine: text is drawn in screen space and pixel art stays nearest-neighbour.
  return clamp(Math.floor(Math.min(availW / world.view.geo.W, availH / world.view.geo.VIEW_H) * 20) / 20, 1, 8);
}

function placeTicker() {
  document.getElementById('ticker').style.right = `${panel.isOpen || editor.isOpen ? Math.min(PANEL_W, window.innerWidth) : 0}px`;
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
applyLayout(DEFAULT_OFFICE);

/** Pointer position in office (unscaled) pixels; CSS size can differ from the backing store mid-refit. */
function officeXY(ev) {
  const k = canvas.width / (canvas.clientWidth || canvas.width);
  return [(ev.offsetX * k) / S, (ev.offsetY * k) / S - WALL_RISE];
}

// ---- stations ------------------------------------------------------------------
// Two desks of a pod share one aisle column, so near-desk slots are keyed by the aisle, not the desk.
const NO_SLOTS = new Slots([]);
const nearSlots = (desk) => {
  if (!world.geo.desks[desk]) return NO_SLOTS; // no desk (overflow): assistants stand in the lobby
  const spots = world.geo.nearDeskSpots(desk);
  const key = `${spots[0].x}:${spots[0].y}`;
  let s = world.near.get(key);
  if (!s) { s = new Slots(spots); world.near.set(key, s); }
  return s;
};
const sameStation = (a, b) => a && b && a.kind === b.kind && a.x === b.x && a.y === b.y;

function releaseRoom(sid) {
  const r = world.rooms.indexOf(sid);
  if (r >= 0) { world.rooms[r] = null; world.roomSeats[r] = new Slots(world.geo.meetings[r].seats); }
}

/** Where should this session's employee be right now? */
function sessionStation(s, e, now) {
  const geo = world.geo;
  if (s.ended) { world.plan.release(s.id); world.library.release(s.id); world.play.release(s.id); releaseRoom(s.id); return { kind: 'exit', ...geo.spawn }; }
  const live = (s.subagents || []).filter((a) => !a.ended);
  if (live.length) e.lastLiveSub = now;
  const wantsRoom = live.length > 0 || (e.lastLiveSub && now - e.lastLiveSub < MEETING_LINGER_MS);
  if (wantsRoom) {
    let r = world.rooms.indexOf(s.id);
    if (r < 0) { r = world.rooms.indexOf(null); if (r >= 0) world.rooms[r] = s.id; }
    if (r >= 0) { world.plan.release(s.id); world.library.release(s.id); world.play.release(s.id); return { kind: 'meeting', room: r, ...geo.meetings[r].head }; }
  } else releaseRoom(s.id);
  const busyWithSubs = live.length > 0; // rooms full: stay at the desk with the assistants around
  if (s.permissionMode === 'plan') {
    const i = world.plan.take(s.id);
    if (i >= 0) { world.library.release(s.id); world.play.release(s.id); return { kind: 'plan', ...geo.planSpots[i] }; }
  } else world.plan.release(s.id);
  if (s.state === 'searching') e.lastSearch = now;
  if (e.lastSearch && now - e.lastSearch < LIBRARY_LINGER_MS && s.state !== 'idle') {
    const i = world.library.take(s.id);
    if (i >= 0) { world.play.release(s.id); return { kind: 'library', ...geo.librarySpots[i] }; }
  } else world.library.release(s.id);
  const idleFor = s.state === 'idle' ? now - s.stateSince : 0;
  // Turn ended but a background shell/monitor will wake it — waiting at the desk, not on a break.
  if (!busyWithSubs && !awaitingBg(s) && idleFor > PLAY_AFTER_MS) {
    if (!world.play.has(s.id) || now >= e.playUntil) { // time to wander to another spot
      const i = world.play.takeRandom(s.id);
      if (i >= 0) e.playUntil = now + dwellMs(world.funSpots[i].act);
    }
    const i = world.play.of.get(s.id);
    if (i !== undefined) { const p = world.funSpots[i]; return { kind: p.act === 'lounge' ? 'lounge' : 'play', ...p }; }
  } else world.play.release(s.id);
  const d = geo.desks[s.desk];
  if (d) { world.bullpen.release(`s:${s.id}`); return { kind: 'desk', desk: s.desk, ...d.chair }; }
  const i = world.bullpen.take(`s:${s.id}`);
  return { kind: 'bullpen', ...geo.bullpenSpots[Math.max(0, i)] };
}

/** Where should this subagent's assistant be? null = stay and fade. */
function assistantStation(s, a) {
  const key = a.agentId;
  const r = world.rooms.indexOf(s.id);
  if (r >= 0) {
    nearSlots(s.desk).release(key); world.bullpen.release(`a:${key}`);
    const i = world.roomSeats[r].take(key);
    const room = world.geo.meetings[r];
    if (i >= 0) return { kind: 'meeting', room: r, ...room.seats[i] };
    return { kind: 'meeting', room: r, x: room.x + room.w - 1, y: room.y + (hashStr(key) % room.h) };
  }
  for (const rs of world.roomSeats) rs.release(key);
  const i = nearSlots(s.desk).take(key);
  if (i >= 0) { world.bullpen.release(`a:${key}`); return { kind: 'near', ...world.geo.nearDeskSpots(s.desk)[i] }; }
  const b = world.bullpen.take(`a:${key}`);
  return { kind: 'bullpen', ...world.geo.bullpenSpots[Math.max(0, b)] };
}

function releaseAll(e) {
  const s = e.sessionId;
  if (e.kind === 'employee') { world.plan.release(s); world.library.release(s); world.play.release(s); world.bullpen.release(`s:${s}`); releaseRoom(s); }
  else { for (const rs of world.roomSeats) rs.release(e.agentId); nearSlots(e.desk).release(e.agentId); world.bullpen.release(`a:${e.agentId}`); }
}

function goTo(e, station, teleport = false) {
  if (sameStation(e.station, station)) return;
  e.station = station;
  if (teleport) { e.x = station.x * TILE; e.y = station.y * TILE; e.path = []; e.phase = 'seated'; return; }
  const cur = { x: Math.round(e.x / TILE), y: Math.round(e.y / TILE) };
  e.path = world.geo.findPath(cur, station) || [station];
  e.phase = station.kind === 'exit' ? 'leave' : 'enter';
  e.onArrive = () => { if (e.station.kind === 'exit') { releaseAll(e); world.ents.delete(e.key); } else e.phase = 'seated'; };
}

// ---- entities ------------------------------------------------------------------
function spawnEmployee(s, seated, now) {
  const e = {
    key: s.id, kind: 'employee', sessionId: s.id, desk: s.desk, data: s,
    pal: paletteFor(s.id, 'employee', s.model), seed: hashStr(s.id) % 1000,
    x: world.geo.spawn.x * TILE, y: world.geo.spawn.y * TILE, path: [], phase: 'enter', alpha: 1, station: null, lastLiveSub: 0, lastSearch: 0,
  };
  world.ents.set(e.key, e);
  goTo(e, sessionStation(s, e, now), seated);
  return e;
}
function spawnAssistant(s, a, parent, seated) {
  const e = {
    key: `${s.id}/${a.agentId}`, kind: 'assistant', sessionId: s.id, agentId: a.agentId, desk: s.desk, data: a,
    pal: paletteFor(a.agentId, 'assistant', a.model || s.model), seed: hashStr(a.agentId) % 1000,
    x: parent ? parent.x : world.geo.spawn.x * TILE, y: parent ? parent.y : world.geo.spawn.y * TILE, path: [], phase: 'enter', alpha: 1, station: null,
  };
  world.ents.set(e.key, e);
  goTo(e, assistantStation(s, a), seated);
  return e;
}
function fade(e, now) {
  if (e.phase === 'fade') return;
  e.phase = 'fade';
  e.fadeAt = now;
  e.path = [];
  releaseAll(e);
}

// ---- activity ticker (sessions of the office on screen) ---------------------------
const FEED_EVENTS = new Set(['PreToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'SessionStart', 'SessionEnd']);
const FEED_MAX = 500; // per office, so a busy office doesn't push a quiet one's history out
const feed = { seen: new Set(), items: [] };
function feedFrom(s) {
  let added = false;
  for (const e of s.log || []) {
    if (!FEED_EVENTS.has(e.ev)) continue;
    const key = `${s.id}|${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
    if (feed.seen.has(key)) continue;
    feed.seen.add(key);
    feed.items.push({ key, t: e.t, sid: s.id, officeId: s.officeId, name: s.name, agent: /^\[/.test(e.text || ''), e });
    added = true;
  }
  if (!added) return;
  feed.items.sort((a, b) => b.t - a.t);
  const per = new Map();
  feed.items = feed.items.filter((it) => {
    const o = feedOffice(it), n = (per.get(o) || 0) + 1;
    per.set(o, n);
    return n <= FEED_MAX;
  });
  if (s.officeId === world.officeId) renderFeed(true);
}
/** Redraw the ticker with the current office's items; `live` = new items arrived (animate, keep the scroll anchored). */
/** Sessions move between offices (gathering in one, splitting up): an item follows its session's current office. */
const feedOffice = (it) => world.sessions.get(it.sid)?.officeId ?? it.officeId;
function renderFeed(live) {
  const ul = document.getElementById('ticker-list');
  const box = ul.parentElement;
  const items = feed.items.filter((it) => feedOffice(it) === world.officeId);
  // keep the viewport anchored when the user has scrolled back into history
  const prevTop = box.scrollTop, prevH = box.scrollHeight;
  const newest = live ? items[0]?.key : null;
  ul.innerHTML = items.map((it) => {
    const e = it.e;
    const icon = e.tool ? (ICON[e.tool] || '🔧') : (EV_ICON[e.ev] || '•');
    let what;
    if (e.tool) what = `<b>${esc(e.tool)}</b>${e.target ? ' · ' + esc(e.target) : ''}${e.detail ? ` <span class="dim">— ${esc(e.detail)}</span>` : ''}`;
    else if (e.ev === 'UserPromptSubmit') what = `<span class="dim">지시:</span> ${esc(e.text || '')}`;
    else if (e.ev === 'Stop') what = `<span class="dim">답변:</span> ${esc(e.text || '')}`;
    else what = `${esc(e.ev)}${e.text ? ` <span class="dim">${esc(e.text)}</span>` : ''}`;
    const who = it.agent ? `${esc(it.name)} 🧢` : esc(it.name);
    return `<li class="${it.key === newest ? 'new' : ''}"><time>${fmtTime(e.t)}</time><span class="who ${it.agent ? 'agent' : ''}">${who}</span><span class="ic">${icon}</span><span class="what">${what}</span></li>`;
  }).join('');
  if (!live) box.scrollTop = 0;
  else if (prevTop > 0) box.scrollTop = prevTop + (box.scrollHeight - prevH);
}

const here = (s) => s.officeId === world.officeId;
function upsertSession(s, seated = false) {
  const now = Date.now();
  const moved = world.sessions.has(s.id) && world.sessions.get(s.id).officeId !== s.officeId;
  world.sessions.set(s.id, s);
  feedFrom(s);
  if (moved) renderFeed(false); // its history comes along to (or leaves) the office on screen
  if (!here(s)) { // works in another office: no cat here
    dropCats(s.id);
    panel.update(s);
    roster.update(world);
    renderTabs();
    return;
  }
  let e = world.ents.get(s.id);
  if (!e) { if (!s.ended) e = spawnEmployee(s, seated, now); }
  else {
    e.data = s;
    e.desk = s.desk;
    if (e.pal.fam !== familyOf(s.model)) e.pal = paletteFor(s.id, 'employee', s.model); // model switched mid-session
    goTo(e, sessionStation(s, e, now));
  }
  const seen = new Set();
  for (const a of s.subagents || []) {
    seen.add(a.agentId);
    const key = `${s.id}/${a.agentId}`;
    let ae = world.ents.get(key);
    if (!a.ended) {
      if (!ae) ae = spawnAssistant(s, a, e, seated);
      else {
        ae.data = a; ae.desk = s.desk;
        if (ae.pal.fam !== familyOf(a.model || s.model)) ae.pal = paletteFor(a.agentId, 'assistant', a.model || s.model);
        if (ae.phase !== 'fade') goTo(ae, assistantStation(s, a));
      }
    } else if (ae) { ae.data = a; fade(ae, now); }
  }
  for (const ae of world.ents.values()) {
    if (ae.kind === 'assistant' && ae.sessionId === s.id && !seen.has(ae.agentId)) fade(ae, now);
  }
  panel.update(s);
  roster.update(world);
  renderTabs();
}
/** Remove a session's cats at once (it works in another office now, or we switched away). */
function dropCats(id) {
  for (const e of [...world.ents.values()]) if (e.sessionId === id) { releaseAll(e); world.ents.delete(e.key); }
}
function removeSession(id) {
  const s = world.sessions.get(id);
  world.sessions.delete(id);
  const e = world.ents.get(id);
  if (e) goTo(e, { kind: 'exit', ...world.geo.spawn });
  for (const ae of world.ents.values()) if (ae.kind === 'assistant' && ae.sessionId === id) fade(ae, Date.now());
  panel.remove(id);
  roster.update(world);
  renderTabs();
  if (world.selectedKey === id) world.selectedKey = null;
  return s;
}

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
  if (JSON.stringify(cur.layout) !== world.layoutJson) { world.layoutJson = JSON.stringify(cur.layout); applyLayout(cur.layout); }
  renderTabs();
}
function preferredOffice() {
  let want = params.get('office');
  if (!want) try { want = localStorage.getItem(OFFICE_KEY); } catch { /* storage blocked */ }
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
  try { localStorage.setItem(OFFICE_KEY, id); } catch { /* storage blocked */ }
  if (params.has('office')) { params.set('office', id); history.replaceState(null, '', `?${params}${location.hash}`); }
  world.ents.clear();
  world.hoverKey = null;
  world.layoutJson = JSON.stringify(o.layout);
  applyLayout(o.layout);
  for (const s of world.sessions.values()) if (here(s) && !s.ended) upsertSession(s, true);
  renderFeed(false);
  roster.update(world);
  renderTabs();
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
  try {
    const r = await fetch('/settings/together', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ officeId }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  } catch (e) { btn.title = `실패: ${e.message}`; } finally { btn.disabled = false; }
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
  if (picked) { world.selectedKey = picked.id; panel.open(world.sessions.get(picked.id)); }
}
// Re-evaluate stations once a second (lounge timing, meeting/library linger).
setInterval(() => {
  const now = Date.now();
  for (const s of world.sessions.values()) {
    if (!here(s)) continue;
    const e = world.ents.get(s.id);
    if (e && e.phase !== 'leave') goTo(e, sessionStation(s, e, now));
    for (const a of s.subagents || []) {
      const ae = world.ents.get(`${s.id}/${a.agentId}`);
      if (ae && !a.ended && ae.phase !== 'fade') goTo(ae, assistantStation(s, a));
    }
  }
  roster.update(world); // places change as cats walk around
  renderTabs();
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

// ---- input ---------------------------------------------------------------------
function entAt(lx, ly) {
  let best = null;
  for (const e of world.ents.values()) {
    const isA = e.kind === 'assistant';
    const x0 = e.x + (isA ? 4 : 3), x1 = e.x + (isA ? 12 : 13), y0 = e.y + (isA ? 3 : 0), y1 = e.y + 16;
    if (lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1 && (!best || e.y > best.y)) best = e;
  }
  return best;
}
const PLACE = { desk: '자리', meeting: '회의실', plan: '기획 보드', library: '서가', lounge: '라운지', play: '놀이터', bullpen: '로비', near: '책상 옆', exit: '퇴근 중' };
function placeOf(e) {
  if (!e.station) return '';
  const k = e.station.kind;
  if (k === 'meeting') return world.geo.meetings[e.station.room]?.name || PLACE.meeting;
  return PLACE[k] || '';
}
// ---- roster (opened from the HUD) ----------------------------------------------------
const roster = new Roster(document.getElementById('roster'), {
  onPick: (id) => {
    const s = world.sessions.get(id);
    if (!s) return;
    if (!here(s)) switchOffice(s.officeId);
    world.selectedKey = id; panel.open(s); history.replaceState(null, '', `#s=${encodeURIComponent(id)}`);
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

const inRect = (b, [x, y]) => !!b && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
/** The HUD on the top wall is the one canvas-drawn button (its rect is written by render.js each frame). */
const buttonAt = (xy) => (inRect(world.hudBtn, xy) ? HUD_BTN : null);

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
  if (!e) { world.selectedKey = null; panel.close(); return; }
  world.selectedKey = e.key;
  const s = world.sessions.get(e.sessionId);
  if (s) { panel.open(s); history.replaceState(null, '', `#s=${encodeURIComponent(s.id)}`); }
});

// ---- tool buttons (above the office) ---------------------------------------------------
document.getElementById('t-new').addEventListener('click', () => openLauncher());
document.getElementById('t-legend').addEventListener('click', () => openLegend(world.sessions));
document.getElementById('t-edit').addEventListener('click', () => { // layout editor takes the panel's place
  if (editor.isOpen || !officeOf(world.officeId)) return;
  if (roster.isOpen) toggleRoster();
  panel.close();
  world.selectedKey = null;
  editor.open(officeOf(world.officeId));
});
{ // the legend button wears a cat, like the legend itself
  const icon = sprite(paletteFor('legend', 'employee', 'claude-fable'), 'idle', 0), c = document.createElement('canvas');
  c.width = icon.width; c.height = icon.height; c.style.width = `${icon.width}px`; c.style.height = `${icon.height}px`;
  c.getContext('2d').drawImage(icon, 0, 0);
  document.getElementById('t-legend').prepend(c);
}

// ---- loop ----------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // rAF time is page-relative; fadeAt and everything else use wall-clock ms
  const wall = Date.now();
  for (const e of [...world.ents.values()]) {
    step(e, dt);
    if (e.phase === 'fade') {
      e.alpha = 1 - (wall - e.fadeAt) / 1500;
      if (e.alpha <= 0) world.ents.delete(e.key);
    }
  }
  render(ctx, S, world, wall);
  if (editor.isOpen) editor.draw(ctx, S);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
