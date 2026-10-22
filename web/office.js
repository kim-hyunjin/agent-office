import {
  TILE, W, VIEW_H, WALL_RISE, SPAWN, DESK_COUNT, deskPos, nearDeskSpots, ROOMS, PLAN_SPOTS, LIBRARY_SPOTS, LOUNGE_SPOTS, PLAY_SPOTS, BULLPEN_SPOTS,
  findPath, buildBackground,
} from './tilemap.js';
import { paletteFor, hashStr, familyOf, FAMILIES } from './sprites.js';
import { step, clamp } from './anim.js';
import { render, STATE_LABEL, NEW_BTN, LEGEND_BTN, HUD_BTN } from './render.js';
import { openLegend } from './legend.js';
import { Roster } from './roster.js';
import { openLauncher } from './launcher.js';
import { Panel, ICON, EV_ICON, esc, fmtTime, awaitingBg, bgSummary } from './panel.js';

const params = new URLSearchParams(location.search);
const PLAY_AFTER_MS = Number(params.get('playAfter') || 15) * 1000; // idle this long → off to play / lounge
const MEETING_LINGER_MS = 8000; // keep the meeting room this long after the last subagent finishes
const LIBRARY_LINGER_MS = 10000; // stay at the bookshelf this long after the last search, so back-to-back searches don't bounce

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const panel = new Panel(document.getElementById('panel'), {
  onOpen: () => refit(),
  onClose: () => { world.selectedKey = null; history.replaceState(null, '', location.pathname); refit(); },
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

// Idle cats roam: the play area plus the lounge (sofa, coffee machine).
const FUN_SPOTS = [...PLAY_SPOTS, ...LOUNGE_SPOTS.map((p) => ({ ...p, act: 'lounge' }))];
const dwellMs = (act) => (act === 'nap' || act === 'lounge' ? 20000 + Math.random() * 20000 : 7000 + Math.random() * 8000);

const world = {
  bg: buildBackground(),
  sessions: new Map(), // id -> server session object
  ents: new Map(),     // key -> entity
  hoverKey: null,
  selectedKey: null,
  connected: false,
  rooms: ROOMS.map(() => null),            // room index -> session id
  roomSeats: ROOMS.map((r) => new Slots(r.seats)),
  plan: new Slots(PLAN_SPOTS),
  library: new Slots(LIBRARY_SPOTS),
  play: new Slots(FUN_SPOTS),             // idle cats roam between these
  bullpen: new Slots(BULLPEN_SPOTS),
  near: new Map(),                         // desk -> Slots
};
let S = 3;

const PANEL_W = 380; // keep in sync with #panel width in style.css
const PANEL_ANIM_MS = 220; // keep in sync with the #panel / #office.refit transitions
// Width the open panel takes from the office. On narrow windows the panel just covers it.
const panelRoom = () => (panel.isOpen && window.innerWidth >= PANEL_W * 2 ? PANEL_W : 0);

function fitScale() {
  const ticker = document.getElementById('ticker');
  const availW = window.innerWidth - 16 - panelRoom();
  const availH = window.innerHeight - 12 - (ticker.hidden ? 0 : ticker.offsetHeight);
  // Fill the space. Fractional scale is fine: text is drawn in screen space and pixel art stays nearest-neighbour.
  return clamp(Math.floor(Math.min(availW / W, availH / VIEW_H) * 20) / 20, 1, 8);
}

function placeTicker() {
  document.getElementById('ticker').style.right = `${panel.isOpen ? Math.min(PANEL_W, window.innerWidth) : 0}px`;
}

/** Fit the office to the window at once (backing store + CSS size). */
function resize() {
  clearTimeout(refitTimer);
  canvas.classList.remove('refit');
  S = fitScale();
  canvas.width = Math.round(W * S); canvas.height = Math.round(VIEW_H * S);
  canvas.style.width = `${canvas.width}px`; canvas.style.height = `${canvas.height}px`;
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
  canvas.style.width = `${Math.round(W * s)}px`; canvas.style.height = `${Math.round(VIEW_H * s)}px`;
  clearTimeout(refitTimer);
  refitTimer = setTimeout(resize, PANEL_ANIM_MS + 20);
}
window.addEventListener('resize', resize);
resize();

/** Pointer position in office (unscaled) pixels; CSS size can differ from the backing store mid-refit. */
function officeXY(ev) {
  const k = canvas.width / (canvas.clientWidth || canvas.width);
  return [(ev.offsetX * k) / S, (ev.offsetY * k) / S - WALL_RISE];
}

// ---- stations ------------------------------------------------------------------
// Two desks of a pod share one aisle column, so near-desk slots are keyed by the aisle, not the desk.
const nearSlots = (desk) => {
  const spots = nearDeskSpots(desk);
  const key = `${spots[0].x}:${spots[0].y}`;
  let s = world.near.get(key);
  if (!s) { s = new Slots(spots); world.near.set(key, s); }
  return s;
};
const sameStation = (a, b) => a && b && a.kind === b.kind && a.x === b.x && a.y === b.y;

function releaseRoom(sid) {
  const r = world.rooms.indexOf(sid);
  if (r >= 0) { world.rooms[r] = null; world.roomSeats[r] = new Slots(ROOMS[r].seats); }
}

/** Where should this session's employee be right now? */
function sessionStation(s, e, now) {
  if (s.ended) { world.plan.release(s.id); world.library.release(s.id); world.play.release(s.id); releaseRoom(s.id); return { kind: 'exit', ...SPAWN }; }
  const live = (s.subagents || []).filter((a) => !a.ended);
  if (live.length) e.lastLiveSub = now;
  const wantsRoom = live.length > 0 || (e.lastLiveSub && now - e.lastLiveSub < MEETING_LINGER_MS);
  if (wantsRoom) {
    let r = world.rooms.indexOf(s.id);
    if (r < 0) { r = world.rooms.indexOf(null); if (r >= 0) world.rooms[r] = s.id; }
    if (r >= 0) { world.plan.release(s.id); world.library.release(s.id); world.play.release(s.id); return { kind: 'meeting', room: r, ...ROOMS[r].head }; }
  } else releaseRoom(s.id);
  const busyWithSubs = live.length > 0; // rooms full: stay at the desk with the assistants around
  if (s.permissionMode === 'plan') {
    const i = world.plan.take(s.id);
    if (i >= 0) { world.library.release(s.id); world.play.release(s.id); return { kind: 'plan', ...PLAN_SPOTS[i] }; }
  } else world.plan.release(s.id);
  if (s.state === 'searching') e.lastSearch = now;
  if (e.lastSearch && now - e.lastSearch < LIBRARY_LINGER_MS && s.state !== 'idle') {
    const i = world.library.take(s.id);
    if (i >= 0) { world.play.release(s.id); return { kind: 'library', ...LIBRARY_SPOTS[i] }; }
  } else world.library.release(s.id);
  const idleFor = s.state === 'idle' ? now - s.stateSince : 0;
  // Turn ended but a background shell/monitor will wake it — waiting at the desk, not on a break.
  if (!busyWithSubs && !awaitingBg(s) && idleFor > PLAY_AFTER_MS) {
    if (!world.play.has(s.id) || now >= e.playUntil) { // time to wander to another spot
      const i = world.play.takeRandom(s.id);
      if (i >= 0) e.playUntil = now + dwellMs(FUN_SPOTS[i].act);
    }
    const i = world.play.of.get(s.id);
    if (i !== undefined) { const p = FUN_SPOTS[i]; return { kind: p.act === 'lounge' ? 'lounge' : 'play', ...p }; }
  } else world.play.release(s.id);
  if (s.desk < DESK_COUNT) { world.bullpen.release(`s:${s.id}`); const d = deskPos(s.desk); return { kind: 'desk', desk: s.desk, ...d.chair }; }
  const i = world.bullpen.take(`s:${s.id}`);
  return { kind: 'bullpen', ...BULLPEN_SPOTS[Math.max(0, i)] };
}

/** Where should this subagent's assistant be? null = stay and fade. */
function assistantStation(s, a) {
  const key = a.agentId;
  const r = world.rooms.indexOf(s.id);
  if (r >= 0) {
    nearSlots(s.desk).release(key); world.bullpen.release(`a:${key}`);
    const i = world.roomSeats[r].take(key);
    const room = ROOMS[r];
    if (i >= 0) return { kind: 'meeting', room: r, ...room.seats[i] };
    return { kind: 'meeting', room: r, x: room.x + room.w - 1, y: room.y + (hashStr(key) % room.h) };
  }
  for (const rs of world.roomSeats) rs.release(key);
  const i = nearSlots(s.desk).take(key);
  if (i >= 0) { world.bullpen.release(`a:${key}`); return { kind: 'near', ...nearDeskSpots(s.desk)[i] }; }
  const b = world.bullpen.take(`a:${key}`);
  return { kind: 'bullpen', ...BULLPEN_SPOTS[Math.max(0, b)] };
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
  e.path = findPath(cur, station) || [station];
  e.phase = station.kind === 'exit' ? 'leave' : 'enter';
  e.onArrive = () => { if (e.station.kind === 'exit') { releaseAll(e); world.ents.delete(e.key); } else e.phase = 'seated'; };
}

// ---- entities ------------------------------------------------------------------
function spawnEmployee(s, seated, now) {
  const e = {
    key: s.id, kind: 'employee', sessionId: s.id, desk: s.desk, data: s,
    pal: paletteFor(s.id, 'employee', s.model), seed: hashStr(s.id) % 1000,
    x: SPAWN.x * TILE, y: SPAWN.y * TILE, path: [], phase: 'enter', alpha: 1, station: null, lastLiveSub: 0, lastSearch: 0,
  };
  world.ents.set(e.key, e);
  goTo(e, sessionStation(s, e, now), seated);
  return e;
}
function spawnAssistant(s, a, parent, seated) {
  const e = {
    key: `${s.id}/${a.agentId}`, kind: 'assistant', sessionId: s.id, agentId: a.agentId, desk: s.desk, data: a,
    pal: paletteFor(a.agentId, 'assistant', a.model || s.model), seed: hashStr(a.agentId) % 1000,
    x: parent ? parent.x : SPAWN.x * TILE, y: parent ? parent.y : SPAWN.y * TILE, path: [], phase: 'enter', alpha: 1, station: null,
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

// ---- activity ticker (all sessions) ---------------------------------------------
const FEED_EVENTS = new Set(['PreToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'SessionStart', 'SessionEnd']);
const FEED_MAX = 500;
const feed = { seen: new Set(), items: [] };
function feedFrom(s) {
  let added = false;
  for (const e of s.log || []) {
    if (!FEED_EVENTS.has(e.ev)) continue;
    const key = `${s.id}|${e.t}|${e.ev}|${e.tool || ''}|${e.target || ''}`;
    if (feed.seen.has(key)) continue;
    feed.seen.add(key);
    feed.items.push({ key, t: e.t, name: s.name, agent: /^\[/.test(e.text || ''), e });
    added = true;
  }
  if (!added) return;
  feed.items.sort((a, b) => b.t - a.t);
  feed.items.length = Math.min(feed.items.length, FEED_MAX);
  const ul = document.getElementById('ticker-list');
  const box = ul.parentElement;
  // keep the viewport anchored when the user has scrolled back into history
  const prevTop = box.scrollTop, prevH = box.scrollHeight;
  const newest = feed.items[0]?.key;
  ul.innerHTML = feed.items.map((it) => {
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
  if (prevTop > 0) box.scrollTop = prevTop + (box.scrollHeight - prevH);
}

function upsertSession(s, seated = false) {
  const now = Date.now();
  world.sessions.set(s.id, s);
  feedFrom(s);
  let e = world.ents.get(s.id);
  if (!e) { if (!s.ended) e = spawnEmployee(s, seated, now); }
  else {
    e.data = s;
    e.desk = s.desk;
    if (e.pal.fam !== familyOf(s.model)) e.pal = paletteFor(s.id, 'employee', s.model);
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
}
function removeSession(id) {
  const s = world.sessions.get(id);
  world.sessions.delete(id);
  const e = world.ents.get(id);
  if (e) goTo(e, { kind: 'exit', ...SPAWN });
  for (const ae of world.ents.values()) if (ae.kind === 'assistant' && ae.sessionId === id) fade(ae, Date.now());
  panel.remove(id);
  roster.update(world);
  if (world.selectedKey === id) world.selectedKey = null;
  return s;
}
let firstSnapshot = true;
function applySnapshot(snap) {
  const ids = new Set();
  const seated = firstSnapshot;
  firstSnapshot = false;
  for (const s of snap.sessions) { ids.add(s.id); upsertSession(s, seated && !s.ended); }
  for (const id of [...world.sessions.keys()]) if (!ids.has(id)) removeSession(id);
  const m = location.hash.match(/^#s=([^&]+)/);
  if (seated && m) {
    const want = decodeURIComponent(m[1]);
    const s = [...world.sessions.values()].find((x) => x.id.startsWith(want));
    if (s) { world.selectedKey = s.id; panel.open(s); }
  }
}
// Re-evaluate stations once a second (lounge timing, meeting/library linger).
setInterval(() => {
  const now = Date.now();
  for (const s of world.sessions.values()) {
    const e = world.ents.get(s.id);
    if (e && e.phase !== 'leave') goTo(e, sessionStation(s, e, now));
    for (const a of s.subagents || []) {
      const ae = world.ents.get(`${s.id}/${a.agentId}`);
      if (ae && !a.ended && ae.phase !== 'fade') goTo(ae, assistantStation(s, a));
    }
  }
  roster.update(world); // places change as cats walk around
}, 1000);

// ---- SSE -----------------------------------------------------------------------
let everConnected = false;
function connect() {
  const es = new EventSource('/events');
  es.addEventListener('snapshot', (ev) => { world.connected = true; applySnapshot(JSON.parse(ev.data)); });
  es.addEventListener('session', (ev) => upsertSession(JSON.parse(ev.data)));
  es.addEventListener('remove', (ev) => removeSession(JSON.parse(ev.data).id));
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
  if (k === 'meeting') return ROOMS[e.station.room].name;
  return PLACE[k] || '';
}
// ---- roster (opened from the HUD) ----------------------------------------------------
const roster = new Roster(document.getElementById('roster'), {
  onPick: (id) => {
    const s = world.sessions.get(id);
    if (!s) return;
    world.selectedKey = id; panel.open(s); history.replaceState(null, '', `#s=${encodeURIComponent(id)}`);
  },
  placeOf: (id) => { const e = world.ents.get(id); return e && e.station?.kind !== 'desk' ? placeOf(e) : ''; },
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
/** Canvas-drawn buttons on the bottom wall (rects are written by render.js each frame). */
const buttonAt = (xy) => (inRect(world.newBtn, xy) ? NEW_BTN : inRect(world.legendBtn, xy) ? LEGEND_BTN : inRect(world.hudBtn, xy) ? HUD_BTN : null);

canvas.addEventListener('mousemove', (ev) => {
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
  const xy = officeXY(ev);
  const btn = buttonAt(xy);
  if (btn === NEW_BTN) { openLauncher(); return; }
  if (btn === LEGEND_BTN) { openLegend(world.sessions); return; }
  if (btn === HUD_BTN) { toggleRoster(); return; }
  const e = entAt(...xy);
  if (!e) { world.selectedKey = null; panel.close(); return; }
  world.selectedKey = e.key;
  const s = world.sessions.get(e.sessionId);
  if (s) { panel.open(s); history.replaceState(null, '', `#s=${encodeURIComponent(s.id)}`); }
});

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
