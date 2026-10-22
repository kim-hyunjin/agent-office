// Layout editor ("배치 편집"): edits a draft of the current office's layout on the canvas, with a side panel for
// the palette, the selection and the office's size. Rooms are dragged out as rectangles (walls follow), moved by
// their inside, resized by their corners; clicking a wall tile cycles door → open passage → wall. Furniture is
// placed from the palette and dragged around. Every change is validated (layout.js) and problem tiles turn red;
// saving sends the draft to the server, which pushes it to every open office.
import { TILE, WALL_RISE, ROOM_TYPES, ITEM_KINDS, DEFAULT_OFFICE, MIN_W, MIN_H, MAX_W, MAX_H, cloneOffice, compile, validate, itemRect, ringRect } from './layout.js';
import { buildBackground, FLOOR } from './tilemap.js';
import { esc } from './panel.js';

const $ = (id) => document.getElementById(id);
const uid = (p) => `${p}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hasWalls = (r) => (ROOM_TYPES[r.type]?.walls ?? true) && r.walls !== false;
const UNDO_MAX = 100;

export class Editor {
  /** onResize(): the canvas size or the space beside it changed. */
  constructor({ world, canvas, officeXY, onResize }) {
    this.world = world;
    this.canvas = canvas;
    this.officeXY = officeXY;
    this.onResize = onResize;
    this.el = $('editor');
    this.office = null;   // the office being edited (server copy)
    this.draft = null;    // its layout, edited in place
    this.undo = [];
    this.tool = 'select'; // 'select' | 'room:<type>' | 'item:<kind>'
    this.sel = null;      // { kind: 'room' | 'item', id }
    this.drag = null;
    this.hover = null;    // tile under the pointer
    this.errs = [];
    this.buildPalette();
    this.bindPanel();
    this.bindCanvas();
  }
  get isOpen() { return !!this.office; }

  open(office) {
    this.office = office;
    this.draft = cloneOffice(office.layout);
    this.name = office.name;
    this.undo = []; this.sel = null; this.tool = 'select'; this.drag = null; this.armedDelete = false; this.shown = false;
    this.el.hidden = false;
    this.world.editing = true;
    $('ed-title').textContent = office.name;
    $('ed-delete').hidden = office.id === 'default';
    this.msg('');
    this.refresh();
  }
  close() {
    if (!this.office) return;
    this.office = null;
    this.el.hidden = true;
    this.world.editing = false;
    this.world.view = { geo: this.world.geo, bg: this.world.bg };
    this.canvas.style.cursor = 'default';
    this.onResize();
  }

  // ---- draft --------------------------------------------------------------------
  /** Recompile + redraw the draft, re-validate, sync the panel. */
  refresh() {
    const d = this.draft;
    const sizeOk = Number.isInteger(d.w) && Number.isInteger(d.h) && d.w >= MIN_W && d.h >= MIN_H && d.w <= MAX_W && d.h <= MAX_H;
    this.errs = validate(d);
    if (sizeOk) {
      const prev = this.world.view?.geo;
      const geo = compile(d);
      this.world.view = { geo, bg: buildBackground(geo) };
      if (!prev || prev.W !== geo.W || prev.H !== geo.H || !this.shown) { this.shown = true; this.onResize(); }
    }
    this.syncPanel();
  }
  /** Change the draft as one undo step. */
  change(fn) {
    this.undo.push(JSON.stringify(this.draft));
    if (this.undo.length > UNDO_MAX) this.undo.shift();
    fn(this.draft);
    this.refresh();
  }
  undoOnce() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.draft = JSON.parse(prev);
    if (this.sel && !this.selected()) this.sel = null;
    this.refresh();
  }
  selected() {
    if (!this.sel) return null;
    return (this.sel.kind === 'room' ? this.draft.rooms : this.draft.items).find((x) => x.id === this.sel.id) || null;
  }
  removeSelected() {
    const s = this.selected();
    if (!s) return;
    this.change((d) => {
      if (this.sel.kind === 'room') d.rooms = d.rooms.filter((r) => r !== s);
      else d.items = d.items.filter((it) => it !== s);
    });
    this.sel = null;
    this.syncPanel();
  }
  nudge(dx, dy) {
    const s = this.selected();
    if (!s) return;
    this.change(() => (this.sel.kind === 'room' ? this.moveRoom(s, s.x + dx, s.y + dy, this.contents(s)) : this.moveItem(s, s.x + dx, s.y + dy)));
  }

  // ---- geometry helpers -------------------------------------------------------------
  /** Where a new or reshaped room gets its door: middle of its bottom wall, else the top, else a side. */
  autoDoor(r) {
    const { h, w } = this.draft;
    const mx = r.x + Math.floor(r.w / 2), my = r.y + Math.floor(r.h / 2);
    if (r.y + r.h < h - 1) return { x: mx, y: r.y + r.h };
    if (r.y - 1 > 0) return { x: mx, y: r.y - 1 };
    if (r.x + r.w < w - 1) return { x: r.x + r.w, y: my };
    return { x: r.x - 1, y: my };
  }
  /** Keep only doors still on the room's ring (corners excluded); a walled room always keeps one. */
  fixDoors(r) {
    const g = ringRect(r);
    r.doors = r.doors.filter((d) => inRect(g, d.x, d.y) && !inRect(r, d.x, d.y)
      && !((d.x === g.x || d.x === g.x + g.w - 1) && (d.y === g.y || d.y === g.y + g.h - 1)));
    if (hasWalls(r) && !r.doors.length) r.doors.push(this.autoDoor(r));
  }
  /** Furniture standing entirely inside a room moves with it. */
  contents(r) {
    return this.draft.items.filter((it) => {
      if (ITEM_KINDS[it.kind].wall) return false;
      const b = itemRect(it);
      return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    }).map((it) => ({ it, dx: it.x - r.x, dy: it.y - r.y }));
  }
  moveRoom(r, x, y, inside) {
    const { w, h } = this.draft;
    x = clamp(x, 1, w - 1 - r.w); y = clamp(y, 1, h - 1 - r.h);
    const dx = x - r.x, dy = y - r.y;
    r.x = x; r.y = y;
    for (const d of r.doors) { d.x += dx; d.y += dy; }
    for (const c of inside) { c.it.x = x + c.dx; c.it.y = y + c.dy; }
  }
  moveItem(it, x, y) {
    const k = ITEM_KINDS[it.kind], { w, h } = this.draft;
    it.x = clamp(x, 1, w - 1 - k.w);
    it.y = k.wall ? 0 : clamp(y, 1, h - 1 - k.h);
  }

  // ---- hit testing (tile coords) ----------------------------------------------------
  itemAt(tx, ty) {
    const layer = (it) => (ITEM_KINDS[it.kind].wall ? 2 : ITEM_KINDS[it.kind].floor ? 0 : 1);
    let best = null;
    for (const it of this.draft.items) {
      const k = ITEM_KINDS[it.kind];
      if (!k) continue;
      const y = k.wall && ty < 0 ? 0 : ty; // wall items also catch clicks on the raised wall above row 0
      if (inRect(itemRect(it), tx, y) && (!best || layer(it) >= layer(best))) best = it;
    }
    return best;
  }
  roomAt(tx, ty) {
    let best = null;
    for (const r of this.draft.rooms) if (inRect(r, tx, ty) && (!best || r.w * r.h < best.w * best.h)) best = r;
    return best;
  }
  /** Walled rooms whose wall runs through this tile (not a corner, not the outer wall, not inside a room). */
  wallRoomsAt(tx, ty) {
    const { w, h } = this.draft;
    if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1 || this.roomAt(tx, ty)) return [];
    return this.draft.rooms.filter((r) => {
      if (!hasWalls(r)) return false;
      const g = ringRect(r);
      return inRect(g, tx, ty) && !((tx === g.x || tx === g.x + g.w - 1) && (ty === g.y || ty === g.y + g.h - 1));
    });
  }
  /** Corner handle of the selected room under the pointer (office px). */
  handleAt(px, py) {
    const r = this.sel?.kind === 'room' && this.selected();
    if (!r) return null;
    const near = (a, b) => Math.abs(a - b) <= 4;
    for (const [c, x, y] of [['nw', r.x, r.y], ['ne', r.x + r.w, r.y], ['sw', r.x, r.y + r.h], ['se', r.x + r.w, r.y + r.h]]) {
      if (near(px, x * TILE) && near(py, y * TILE)) return c;
    }
    return null;
  }
  /** Cycle a wall tile: wall → door → open passage → wall. A door already there belongs to its room. */
  cycleDoor(tx, ty) {
    const owner = this.draft.rooms.find((r) => r.doors.some((d) => d.x === tx && d.y === ty));
    const cands = this.wallRoomsAt(tx, ty);
    const room = owner || cands.find((r) => r.id === this.sel?.id) || cands[0];
    if (!room) return false;
    this.change(() => {
      const d = room.doors.find((x) => x.x === tx && x.y === ty);
      if (!d) room.doors.push({ x: tx, y: ty });
      else if (!d.open) d.open = true;
      else room.doors = room.doors.filter((x) => x !== d);
    });
    return true;
  }

  // ---- canvas input -------------------------------------------------------------------
  tileOf(ev) {
    const [x, y] = this.officeXY(ev);
    return { px: x, py: y, tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
  }
  bindCanvas() {
    const c = this.canvas;
    c.addEventListener('mousedown', (ev) => { if (this.isOpen && ev.button === 0) this.down(this.tileOf(ev)); });
    c.addEventListener('mousemove', (ev) => { if (this.isOpen) this.move(this.tileOf(ev)); });
    window.addEventListener('mouseup', () => { if (this.isOpen) this.up(); });
    c.addEventListener('mouseleave', () => { if (this.isOpen && !this.drag) this.hover = null; });
    c.addEventListener('contextmenu', (ev) => { if (this.isOpen) { ev.preventDefault(); this.setTool('select'); } });
    document.addEventListener('keydown', (ev) => {
      if (!this.isOpen || ev.target.closest?.('input, select, textarea')) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); this.undoOnce(); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.removeSelected(); }
      else if (ev.key === 'Escape') { ev.stopImmediatePropagation(); if (this.tool !== 'select') this.setTool('select'); else { this.sel = null; this.syncPanel(); } }
      else if (ev.key.startsWith('Arrow')) {
        ev.preventDefault();
        this.nudge({ ArrowLeft: -1, ArrowRight: 1 }[ev.key] || 0, { ArrowUp: -1, ArrowDown: 1 }[ev.key] || 0);
      }
    }, true);
  }
  down({ px, py, tx, ty }) {
    const before = JSON.stringify(this.draft);
    if (this.tool.startsWith('room:')) { this.drag = { kind: 'new-room', type: this.tool.slice(5), x0: tx, y0: ty, x1: tx, y1: ty }; return; }
    if (this.tool.startsWith('item:')) {
      const kind = this.tool.slice(5), k = ITEM_KINDS[kind];
      const it = { id: uid('i'), kind, x: tx, y: ty };
      this.change(() => { this.moveItem(it, tx - Math.floor((k.w - 1) / 2), ty); this.draft.items.push(it); });
      this.sel = { kind: 'item', id: it.id };
      this.syncPanel();
      return;
    }
    const corner = this.handleAt(px, py);
    if (corner) { const r = this.selected(); this.drag = { kind: 'resize', corner, r, orig: { x: r.x, y: r.y, w: r.w, h: r.h }, before }; return; }
    const it = this.itemAt(tx, ty);
    if (it) { this.sel = { kind: 'item', id: it.id }; this.drag = { kind: 'item', it, dx: tx - it.x, dy: ty - it.y, before }; this.syncPanel(); return; }
    if (this.cycleDoor(tx, ty)) return;
    const r = this.roomAt(tx, ty);
    if (r) { this.sel = { kind: 'room', id: r.id }; this.drag = { kind: 'room', r, x0: tx - r.x, y0: ty - r.y, inside: this.contents(r), before }; this.syncPanel(); return; }
    this.sel = null;
    this.syncPanel();
  }
  move(t) {
    this.hover = t;
    const d = this.drag;
    if (!d) { this.canvas.style.cursor = this.cursorAt(t); return; }
    if (d.kind === 'new-room') { d.x1 = t.tx; d.y1 = t.ty; return; }
    if (d.kind === 'item') this.moveItem(d.it, t.tx - d.dx, t.ty - d.dy);
    else if (d.kind === 'room') this.moveRoom(d.r, t.tx - d.x0, t.ty - d.y0, d.inside);
    else if (d.kind === 'resize') {
      const o = d.orig, { w, h } = this.draft;
      // the opposite corner stays put; the dragged one snaps to the nearest tile edge
      const ex = clamp(Math.round(t.px / TILE), 1, w - 1), ey = clamp(Math.round(t.py / TILE), 1, h - 1);
      let x0 = d.corner.includes('w') ? ex : o.x, x1 = d.corner.includes('w') ? o.x + o.w : ex;
      let y0 = d.corner.includes('n') ? ey : o.y, y1 = d.corner.includes('n') ? o.y + o.h : ey;
      if (x1 - x0 < 2) { if (d.corner.includes('w')) x0 = x1 - 2; else x1 = x0 + 2; }
      if (y1 - y0 < 2) { if (d.corner.includes('n')) y0 = y1 - 2; else y1 = y0 + 2; }
      Object.assign(d.r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    this.refresh();
  }
  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'new-room') {
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      const r = { id: uid('r'), type: d.type, name: this.roomName(d.type), x, y, w: Math.abs(d.x1 - d.x0) + 1, h: Math.abs(d.y1 - d.y0) + 1, doors: [] };
      if (r.w < 2 || r.h < 2) { this.msg('방은 2×2 칸 이상으로 끌어서 그려주세요.', 'err'); return; }
      this.change((dr) => { this.fixDoors(r); dr.rooms.push(r); });
      this.sel = { kind: 'room', id: r.id };
      this.setTool('select');
      return;
    }
    if (d.kind === 'resize') this.fixDoors(d.r);
    if (JSON.stringify(this.draft) !== d.before) { this.undo.push(d.before); if (this.undo.length > UNDO_MAX) this.undo.shift(); }
    this.refresh();
  }
  cursorAt(t) {
    if (this.tool !== 'select') return 'crosshair';
    if (this.handleAt(t.px, t.py)) return 'nwse-resize';
    if (this.itemAt(t.tx, t.ty)) return 'move';
    if (this.wallRoomsAt(t.tx, t.ty).length || this.draft.rooms.some((r) => r.doors.some((d) => d.x === t.tx && d.y === t.ty))) return 'pointer';
    if (this.roomAt(t.tx, t.ty)) return 'move';
    return 'default';
  }
  roomName(type) {
    const label = ROOM_TYPES[type].label;
    if (type !== 'meeting') return label;
    const used = new Set(this.draft.rooms.map((r) => r.name));
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(`${label} ${c}`)) return `${label} ${c}`;
    return label;
  }

  // ---- overlay -------------------------------------------------------------------------
  draw(ctx, S) {
    const geo = this.world.view.geo, d = this.draft;
    ctx.save();
    ctx.setTransform(S, 0, 0, S, 0, WALL_RISE * S);
    const px = 1 / S;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = 1; x < geo.MAP_W; x++) ctx.fillRect(x * TILE, 0, px, geo.H);
    for (let y = 1; y < geo.MAP_H; y++) ctx.fillRect(0, y * TILE, geo.W, px);
    // problems
    ctx.fillStyle = 'rgba(239,68,68,0.45)';
    for (const e of this.errs) for (const t of e.tiles) ctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
    // rooms: dashed outline, selected one solid with corner handles
    ctx.lineWidth = 2 * px;
    for (const r of d.rooms) {
      const on = this.sel?.id === r.id;
      ctx.setLineDash(on ? [] : [4 * px, 3 * px]);
      ctx.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.55)';
      ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      if (on) {
        ctx.fillStyle = '#ffd166';
        for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) ctx.fillRect(x * TILE - 2.5, y * TILE - 2.5, 5, 5);
      }
    }
    ctx.setLineDash([]);
    // selected / hovered furniture
    const it = this.sel?.kind === 'item' && this.selected();
    if (it) { const b = itemRect(it); ctx.strokeStyle = '#ffd166'; ctx.strokeRect(b.x * TILE, (ITEM_KINDS[it.kind].wall ? -1 : b.y) * TILE, b.w * TILE, (ITEM_KINDS[it.kind].wall ? 2 : b.h) * TILE); }
    const h = this.hover;
    if (h && !this.drag) {
      if (this.tool.startsWith('item:')) {
        const k = ITEM_KINDS[this.tool.slice(5)], x = clamp(h.tx - Math.floor((k.w - 1) / 2), 1, d.w - 1 - k.w), y = k.wall ? 0 : clamp(h.ty, 1, d.h - 1 - k.h);
        ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(x * TILE, (k.wall ? -1 : y) * TILE, k.w * TILE, (k.wall ? 2 : k.h) * TILE);
      } else if (this.tool === 'select') {
        const hi = this.itemAt(h.tx, h.ty);
        if (hi && hi !== it) { const b = itemRect(hi); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = px; ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE); }
        else if (!hi && (this.wallRoomsAt(h.tx, h.ty).length || geo.isDoor(h.tx, h.ty))) { ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2 * px; ctx.strokeRect(h.tx * TILE + px, h.ty * TILE + px, TILE - 2 * px, TILE - 2 * px); }
      } else {
        ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(h.tx * TILE, h.ty * TILE, TILE, TILE);
      }
    }
    if (this.drag?.kind === 'new-room') {
      const g = this.drag, x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1);
      const a = FLOOR[g.type]?.[0] || '#cdb089';
      ctx.globalAlpha = 0.6; ctx.fillStyle = a; ctx.fillRect(x * TILE, y * TILE, (Math.abs(g.x1 - g.x0) + 1) * TILE, (Math.abs(g.y1 - g.y0) + 1) * TILE); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 * px; ctx.strokeRect(x * TILE, y * TILE, (Math.abs(g.x1 - g.x0) + 1) * TILE, (Math.abs(g.y1 - g.y0) + 1) * TILE);
    }
    // room names, screen space
    ctx.setTransform(1, 0, 0, 1, 0, WALL_RISE * S);
    ctx.font = `11px ${getComputedStyle(document.body).fontFamily}`; ctx.textBaseline = 'top';
    for (const r of d.rooms) {
      const type = ROOM_TYPES[r.type]?.label || r.type;
      const label = r.name.startsWith(type) ? r.name : `${r.name} · ${type}`; // "회의실 A", not "회의실 A · 회의실"
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(20,22,40,0.8)'; ctx.fillRect(r.x * TILE * S + 3, r.y * TILE * S + 3, w, 16);
      ctx.fillStyle = this.sel?.id === r.id ? '#ffd166' : '#e8eaf2'; ctx.fillText(label, r.x * TILE * S + 7, r.y * TILE * S + 6);
    }
    ctx.restore();
  }

  // ---- panel -----------------------------------------------------------------------------
  buildPalette() {
    const swatch = (t) => { const f = FLOOR[t]; return `<i class="sw" style="background:${f ? f[0] : '#cdb089'}"></i>`; };
    $('ed-rooms').innerHTML = Object.entries(ROOM_TYPES).map(([t, v]) => `<button type="button" data-tool="room:${t}">${swatch(t)}${esc(v.label)}</button>`).join('');
    $('ed-items').innerHTML = Object.entries(ITEM_KINDS).map(([k, v]) => `<button type="button" data-tool="item:${k}" title="${v.w}×${v.h} 칸${v.wall ? ' · 위쪽 벽' : ''}">${esc(v.label)}</button>`).join('');
  }
  setTool(t) {
    this.tool = this.tool === t && t !== 'select' ? 'select' : t; // clicking the active tool again drops it
    if (this.tool !== 'select') this.sel = null;
    this.syncPanel();
  }
  bindPanel() {
    this.el.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-tool]'); if (b) this.setTool(b.dataset.tool); });
    const num = (id, key) => $(id).addEventListener('change', () => {
      const v = Number($(id).value);
      this.change((d) => { if (key === 'door') d.door = { x: v }; else d[key] = v; });
    });
    num('ed-w', 'w'); num('ed-h', 'h'); num('ed-door', 'door');
    $('ed-name').addEventListener('input', () => { this.name = $('ed-name').value; this.syncPanel(); });
    $('ed-sel').addEventListener('input', (ev) => {
      const s = this.selected();
      if (!s) return;
      const f = ev.target.dataset.f;
      if (f === 'name') { s.name = ev.target.value; this.refresh(); return; } // typing: no undo step per key
      this.change(() => {
        if (f === 'type') { s.type = ev.target.value; delete s.walls; delete s.glass; this.fixDoors(s); }
        else if (f === 'walls') { if (ev.target.checked === (ROOM_TYPES[s.type].walls ?? true)) delete s.walls; else s.walls = ev.target.checked; this.fixDoors(s); }
        else if (f === 'glass') { if (ev.target.checked === !!ROOM_TYPES[s.type].glass) delete s.glass; else s.glass = ev.target.checked; }
      });
    });
    $('ed-sel').addEventListener('click', (ev) => { if (ev.target.dataset.f === 'remove') this.removeSelected(); });
    $('ed-undo').addEventListener('click', () => this.undoOnce());
    $('ed-reset').addEventListener('click', () => { this.change((d) => Object.assign(d, cloneOffice(DEFAULT_OFFICE))); this.sel = null; this.syncPanel(); });
    $('ed-cancel').addEventListener('click', () => this.close());
    $('ed-close').addEventListener('click', () => this.close());
    $('ed-save').addEventListener('click', () => this.save());
    $('ed-delete').addEventListener('click', () => this.closeOffice());
  }
  syncPanel() {
    const d = this.draft;
    if (!d) return;
    for (const b of this.el.querySelectorAll('button[data-tool]')) b.classList.toggle('on', b.dataset.tool === this.tool);
    const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ''; };
    setVal('ed-name', this.name); setVal('ed-w', d.w); setVal('ed-h', d.h); setVal('ed-door', d.door?.x);
    for (const [id, lo, hi] of [['ed-w', MIN_W, MAX_W], ['ed-h', MIN_H, MAX_H]]) { $(id).min = lo; $(id).max = hi; }
    $('ed-door').min = 1; $('ed-door').max = (d.w || MIN_W) - 2;
    // selection
    const s = this.selected(), box = $('ed-sel');
    box.hidden = !s;
    if (s && this.sel.kind === 'room') {
      const t = ROOM_TYPES[s.type] || {};
      const walls = hasWalls(s), glass = s.glass ?? !!t.glass;
      const key = `room|${s.id}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = `<h3>선택한 방</h3>
          <label>이름 <input data-f="name" maxlength="30"></label>
          <label>종류 <select data-f="type">${Object.entries(ROOM_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
          <div class="checks"><label class="check"><input type="checkbox" data-f="walls"> 벽</label><label class="check"><input type="checkbox" data-f="glass"> 유리벽</label></div>
          <p class="dim doors"></p>
          <button type="button" data-f="remove">방 지우기</button>`;
      }
      const q = (f) => box.querySelector(`[data-f="${f}"]`);
      if (document.activeElement !== q('name')) q('name').value = s.name;
      q('type').value = s.type; q('walls').checked = walls; q('glass').checked = glass; q('glass').disabled = !walls;
      box.querySelector('.doors').textContent = walls
        ? `문 ${s.doors.filter((x) => !x.open).length}개 · 통로 ${s.doors.filter((x) => x.open).length}개 — 벽 칸을 누르면 문 → 통로 → 벽 순으로 바뀝니다. 모서리를 끌면 크기가 바뀝니다.`
        : '벽 없는 구역입니다. 모서리를 끌면 크기가 바뀝니다.';
    } else if (s) {
      const k = ITEM_KINDS[s.kind];
      box.dataset.key = `item|${s.id}`;
      box.innerHTML = `<h3>선택한 가구</h3><p>${esc(k.label)} <span class="dim">· ${k.w}×${k.h} 칸 · (${s.x}, ${s.y})</span></p><button type="button" data-f="remove">가구 지우기</button>`;
    } else box.dataset.key = '';
    // problems
    $('ed-errs').innerHTML = this.errs.map((e) => `<li>${esc(e.msg)}</li>`).join('');
    $('ed-ok').hidden = this.errs.length > 0;
    $('ed-save').disabled = this.errs.length > 0 || this.saving || !this.name.trim();
    $('ed-undo').disabled = !this.undo.length;
    $('ed-hint').textContent = this.tool.startsWith('room:') ? '사무실 위에서 끌어서 방을 그리세요. (Esc: 취소)'
      : this.tool.startsWith('item:') ? '놓을 곳을 누르세요. 여러 개 놓을 수 있어요. (Esc·우클릭: 그만 놓기)'
        : '가구·방을 끌어서 옮기고, Delete로 지우고, 방향키로 한 칸씩 움직여요. Ctrl+Z: 되돌리기';
  }
  msg(text, cls = '') { const m = $('ed-msg'); m.textContent = text; m.className = `msg ${cls}`; }

  async save() {
    if (this.errs.length || this.saving) return;
    this.saving = true; this.syncPanel(); this.msg('저장 중…');
    const id = encodeURIComponent(this.office.id);
    const post = async (url, body, method = 'POST') => {
      const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    };
    try {
      const name = this.name.trim();
      if (name !== this.office.name) await post(`/offices/${id}`, { name });
      await post(`/offices/${id}/layout`, { layout: this.draft });
      this.saving = false;
      this.close(); // the server pushes the new layout to every open office
    } catch (e) {
      this.saving = false;
      this.msg(`저장 실패: ${e.message}`, 'err');
      this.syncPanel();
    }
  }
  /** Two clicks: close this office; its repos and staff move to the default office. */
  async closeOffice() {
    const b = $('ed-delete');
    if (!this.armedDelete) {
      this.armedDelete = true; b.textContent = '정말 닫기?'; b.classList.add('armed');
      setTimeout(() => { this.armedDelete = false; b.textContent = '사무실 닫기'; b.classList.remove('armed'); }, 4000);
      return;
    }
    try {
      const r = await fetch(`/offices/${encodeURIComponent(this.office.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      this.close();
    } catch (e) { this.msg(`닫기 실패: ${e.message}`, 'err'); }
  }
}
