// Layout editor ("배치 편집"): edits a draft of the current office's layout on the canvas, with a side panel for
// the palette, the selection and the office's size. Rooms are dragged out as rectangles (walls follow), moved by
// their inside, resized by their corners; clicking a wall tile cycles door → open passage → wall. Clicking an outer
// wall moves the front door there (or drag the door along the walls). Furniture is placed from the palette and dragged around. Every change is validated (layout.js) and problem tiles turn red;
// saving sends the draft to the server, which pushes it to every open office.
import { TILE, WALL_RISE, ROOM_TYPES, ITEM_KINDS, DEFAULT_OFFICE, MIN_W, MIN_H, MAX_W, MAX_H, cloneOffice, normalize, compile, validate, itemRect, DOOR_SIDES, doorFor, doorTiles, hasWalls } from './layout.js';
import { contents, fixDoors, fixFrontDoor, itemAt, moveItem, moveRoom, onOuterWall, roomAt, roomName, wallRoomsAt } from './layout-edit.js';
import { clamp } from './anim.js';
import { buildBackground, FLOOR } from './tilemap.js';
import { api, post } from './api.js';
import { esc, setMsg, downloadBlob } from './ui.js';
import { MAX_NAME_CHARS } from './limits.js';

const $ = (id) => document.getElementById(id);
const uid = (p) => `${p}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
const UNDO_MAX = 100;
const SHARE_TYPE = 'pawgents-office-layout'; // marks an exported layout file

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
    const others = this.world.offices.filter((o) => o.id !== office.id);
    $('ed-from').innerHTML = `<option value="">${others.length ? '사무실 고르기…' : '다른 사무실이 없어요'}</option>`
      + others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    $('ed-from').disabled = !others.length;
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
    this.change(() => (this.sel.kind === 'room' ? moveRoom(this.draft, s, s.x + dx, s.y + dy, contents(this.draft, s)) : moveItem(this.draft, s, s.x + dx, s.y + dy)));
  }

  // ---- hit testing (tile coords) ----------------------------------------------------
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
    const cands = wallRoomsAt(this.draft, tx, ty);
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
      this.change(() => { moveItem(this.draft, it, tx - Math.floor((k.w - 1) / 2), ty); this.draft.items.push(it); });
      this.sel = { kind: 'item', id: it.id };
      this.syncPanel();
      return;
    }
    const corner = this.handleAt(px, py);
    if (corner) { const r = this.selected(); this.drag = { kind: 'resize', corner, r, orig: { x: r.x, y: r.y, w: r.w, h: r.h }, before }; return; }
    const it = itemAt(this.draft, tx, ty);
    if (it) { this.sel = { kind: 'item', id: it.id }; this.drag = { kind: 'item', it, dx: tx - it.x, dy: ty - it.y, before }; this.syncPanel(); return; }
    if (onOuterWall(this.draft, tx, ty)) { this.draft.door = doorFor(this.draft, tx, ty); this.drag = { kind: 'door', before }; this.refresh(); return; }
    if (this.cycleDoor(tx, ty)) return;
    const r = roomAt(this.draft, tx, ty);
    if (r) { this.sel = { kind: 'room', id: r.id }; this.drag = { kind: 'room', r, x0: tx - r.x, y0: ty - r.y, inside: contents(this.draft, r), before }; this.syncPanel(); return; }
    this.sel = null;
    this.syncPanel();
  }
  move(t) {
    this.hover = t;
    const d = this.drag;
    if (!d) { this.canvas.style.cursor = this.cursorAt(t); return; }
    if (d.kind === 'new-room') { d.x1 = t.tx; d.y1 = t.ty; return; }
    if (d.kind === 'door') this.draft.door = doorFor(this.draft, t.tx, t.ty);
    else if (d.kind === 'item') moveItem(this.draft, d.it, t.tx - d.dx, t.ty - d.dy);
    else if (d.kind === 'room') moveRoom(this.draft, d.r, t.tx - d.x0, t.ty - d.y0, d.inside);
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
      const r = { id: uid('r'), type: d.type, name: roomName(this.draft, d.type), x, y, w: Math.abs(d.x1 - d.x0) + 1, h: Math.abs(d.y1 - d.y0) + 1, doors: [] };
      if (r.w < 2 || r.h < 2) { this.msg('방은 2×2 칸 이상으로 끌어서 그려주세요.', 'err'); return; }
      this.change((dr) => { fixDoors(this.draft, r); dr.rooms.push(r); });
      this.sel = { kind: 'room', id: r.id };
      this.setTool('select');
      return;
    }
    if (d.kind === 'resize') fixDoors(this.draft, d.r);
    if (JSON.stringify(this.draft) !== d.before) { this.undo.push(d.before); if (this.undo.length > UNDO_MAX) this.undo.shift(); }
    this.refresh();
  }
  cursorAt(t) {
    if (this.tool !== 'select') return 'crosshair';
    if (this.handleAt(t.px, t.py)) return 'nwse-resize';
    if (itemAt(this.draft, t.tx, t.ty)) return 'move';
    if (onOuterWall(this.draft, t.tx, t.ty)) return this.world.view.geo.door.x === t.tx && this.world.view.geo.door.y === Math.max(0, t.ty) ? 'grab' : 'pointer';
    if (wallRoomsAt(this.draft, t.tx, t.ty).length || this.draft.rooms.some((r) => r.doors.some((d) => d.x === t.tx && d.y === t.ty))) return 'pointer';
    if (roomAt(this.draft, t.tx, t.ty)) return 'move';
    return 'default';
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
    // front door, and where a click on the outer wall would move it
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 * px;
    ctx.strokeRect(geo.door.x * TILE + px, geo.door.y * TILE + px, TILE - 2 * px, TILE - 2 * px);
    const h = this.hover;
    if (h && (!this.drag || this.drag.kind === 'door') && this.tool === 'select' && onOuterWall(this.draft, h.tx, h.ty) && !itemAt(this.draft, h.tx, h.ty)) {
      const g = doorTiles({ ...d, door: doorFor(d, h.tx, h.ty) }).door;
      ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(g.x * TILE, g.y * TILE, TILE, TILE);
    } else if (h && !this.drag) {
      if (this.tool.startsWith('item:')) {
        const k = ITEM_KINDS[this.tool.slice(5)], x = clamp(h.tx - Math.floor((k.w - 1) / 2), 1, d.w - 1 - k.w), y = k.wall ? 0 : clamp(h.ty, 1, d.h - 1 - k.h);
        ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.fillRect(x * TILE, (k.wall ? -1 : y) * TILE, k.w * TILE, (k.wall ? 2 : k.h) * TILE);
      } else if (this.tool === 'select') {
        const hi = itemAt(this.draft, h.tx, h.ty);
        if (hi && hi !== it) { const b = itemRect(hi); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = px; ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE); }
        else if (!hi && (wallRoomsAt(this.draft, h.tx, h.ty).length || geo.isDoor(h.tx, h.ty))) { ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2 * px; ctx.strokeRect(h.tx * TILE + px, h.ty * TILE + px, TILE - 2 * px, TILE - 2 * px); }
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
    $('ed-door-side').innerHTML = Object.entries(DOOR_SIDES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
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
      this.change((d) => {
        if (key === 'door') d.door = d.door?.side === 'left' || d.door?.side === 'right' ? { side: d.door.side, y: v } : { side: d.door?.side || 'bottom', x: v };
        else { d[key] = v; fixFrontDoor(d); }
      });
    });
    $('ed-door-side').addEventListener('change', () => this.change((d) => { // same spot along the new wall, as far as it goes
      const side = $('ed-door-side').value, at = d.door?.x ?? d.door?.y ?? 1;
      d.door = side === 'top' || side === 'bottom' ? { side, x: at } : { side, y: at };
      fixFrontDoor(d);
    }));
    num('ed-w', 'w'); num('ed-h', 'h'); num('ed-door', 'door');
    $('ed-name').maxLength = MAX_NAME_CHARS; // office name, same limit the server checks
    $('ed-name').addEventListener('input', () => { this.name = $('ed-name').value; this.syncPanel(); });
    $('ed-sel').addEventListener('input', (ev) => {
      const s = this.selected();
      if (!s) return;
      const f = ev.target.dataset.f;
      if (f === 'name') { s.name = ev.target.value; this.refresh(); return; } // typing: no undo step per key
      this.change(() => {
        if (f === 'type') { s.type = ev.target.value; delete s.walls; delete s.glass; fixDoors(this.draft, s); }
        else if (f === 'walls') { if (ev.target.checked === (ROOM_TYPES[s.type].walls ?? true)) delete s.walls; else s.walls = ev.target.checked; fixDoors(this.draft, s); }
        else if (f === 'glass') { if (ev.target.checked === !!ROOM_TYPES[s.type].glass) delete s.glass; else s.glass = ev.target.checked; }
      });
    });
    $('ed-sel').addEventListener('click', (ev) => { if (ev.target.dataset.f === 'remove') this.removeSelected(); });
    // walls on/off for every room at once (one undo step); a room that gets walls gets a door if it has none
    const allWalls = (on) => this.change((d) => {
      for (const r of d.rooms) {
        if (on === (ROOM_TYPES[r.type]?.walls ?? true)) delete r.walls; else r.walls = on;
        fixDoors(this.draft, r);
      }
    });
    $('ed-walls-on').addEventListener('click', () => allWalls(true));
    $('ed-walls-off').addEventListener('click', () => allWalls(false));
    $('ed-undo').addEventListener('click', () => this.undoOnce());
    $('ed-reset').addEventListener('click', () => { this.change((d) => Object.assign(d, cloneOffice(DEFAULT_OFFICE))); this.sel = null; this.syncPanel(); });
    // empty floor to start over: size and front door stay; one undo step brings it all back
    $('ed-clear').addEventListener('click', () => { this.change((d) => { d.rooms = []; d.items = []; }); this.sel = null; this.syncPanel(); });
    $('ed-cancel').addEventListener('click', () => this.close());
    $('ed-close').addEventListener('click', () => this.close());
    $('ed-save').addEventListener('click', () => this.save());
    $('ed-delete').addEventListener('click', () => this.closeOffice());
    // sharing: file / clipboard out, file / paste / another office in
    $('ed-export').addEventListener('click', () => this.exportFile());
    $('ed-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.shareText()); this.msg('배치를 복사했어요. 다른 사무실 편집 화면에서 Ctrl+V로 붙여넣으세요.', 'ok'); }
      catch { this.msg('클립보드에 쓸 수 없어요. 파일로 내보내기를 써주세요.', 'err'); }
    });
    $('ed-import').addEventListener('click', () => $('ed-file').click());
    $('ed-file').addEventListener('change', async () => {
      const f = $('ed-file').files[0];
      $('ed-file').value = '';
      if (f) this.importText(await f.text(), `${f.name}의`);
    });
    $('ed-from').addEventListener('change', () => {
      const o = this.world.offices.find((x) => x.id === $('ed-from').value);
      $('ed-from').value = '';
      if (o) this.importLayout(o.layout, `'${o.name}' 사무실의`);
    });
    document.addEventListener('paste', (ev) => {
      if (!this.isOpen || ev.target.closest?.('input, textarea')) return;
      const text = ev.clipboardData?.getData('text');
      if (text) { ev.preventDefault(); this.importText(text, '붙여넣은'); }
    });
  }

  // ---- sharing --------------------------------------------------------------------------
  /** The draft as a shareable JSON document (also what the file holds). */
  shareText() {
    return JSON.stringify({ type: SHARE_TYPE, v: 1, name: this.name.trim() || this.office.name, layout: normalize(this.draft) }, null, 2);
  }
  exportFile() {
    const name = (this.name.trim() || this.office.name).replace(/[\\/:*?"<>|\s]+/g, '-');
    const file = `pawgents-office-${name}.json`;
    downloadBlob(new Blob([this.shareText()], { type: 'application/json' }), file);
    this.msg(`${file} 로 내보냈어요.`, 'ok');
  }
  /** Shared JSON (or a bare layout) → draft. `from` reads like "붙여넣은" / "x.json의". */
  importText(text, from) {
    let data;
    try { data = JSON.parse(text); } catch { this.msg(`${from} 내용이 배치 JSON이 아니에요.`, 'err'); return; }
    const layout = data?.type === SHARE_TYPE ? data.layout : data;
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.rooms) || !Array.isArray(layout.items)) { this.msg(`${from} 내용에 배치가 없어요.`, 'err'); return; }
    this.importLayout(layout, from);
  }
  importLayout(layout, from) {
    const next = normalize(cloneOffice(layout));
    if (!Number.isInteger(next.w) || !Number.isInteger(next.h) || next.w < MIN_W || next.h < MIN_H || next.w > MAX_W || next.h > MAX_H) {
      this.msg(`${from} 배치는 사무실 크기가 ${MIN_W}×${MIN_H} – ${MAX_W}×${MAX_H} 칸을 벗어나요.`, 'err');
      return;
    }
    this.change((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, next); });
    this.sel = null;
    this.msg(`${from} 배치를 불러왔어요. 확인하고 저장하세요. (Ctrl+Z: 되돌리기)`, 'ok');
    this.syncPanel();
  }
  syncPanel() {
    const d = this.draft;
    if (!d) return;
    for (const b of this.el.querySelectorAll('button[data-tool]')) b.classList.toggle('on', b.dataset.tool === this.tool);
    const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ''; };
    setVal('ed-name', this.name); setVal('ed-w', d.w); setVal('ed-h', d.h); setVal('ed-door', d.door?.x ?? d.door?.y); setVal('ed-door-side', d.door?.side || 'bottom');
    for (const [id, lo, hi] of [['ed-w', MIN_W, MAX_W], ['ed-h', MIN_H, MAX_H]]) { $(id).min = lo; $(id).max = hi; }
    $('ed-door').min = 1; $('ed-door').max = ((d.door?.side === 'left' || d.door?.side === 'right' ? d.h : d.w) || MIN_W) - 2;
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
          <label>이름 <input data-f="name" maxlength="${MAX_NAME_CHARS}"></label>
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
  msg(text, cls = '') { setMsg($('ed-msg'), text, cls); }

  async save() {
    if (this.errs.length || this.saving) return;
    this.saving = true; this.syncPanel(); this.msg('저장 중…');
    const id = encodeURIComponent(this.office.id);
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
      await api(`/offices/${encodeURIComponent(this.office.id)}`, { method: 'DELETE', body: {} }); // the server wants a JSON body here (CSRF guard)
      this.close();
    } catch (e) { this.msg(`닫기 실패: ${e.message}`, 'err'); }
  }
}
