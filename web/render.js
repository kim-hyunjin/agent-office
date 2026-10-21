import { TILE, W, H, DESK_COUNT, deskPos, ROOMS, WHITEBOARD, PLAN_ZONE, LOUNGE, LOBBY, LIBRARY_ZONE, SIGN } from './tilemap.js';
import { sprite, animFor, drawGlyph, FAMILIES, familyOf, paletteFor } from './sprites.js';

const FONT = '"Galmuri11", "DotumChe", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
const SCREEN = {
  idle: '#1b1b24', offduty: '#1b1b24', thinking: '#263047', reading: '#2a2f3f', coding: '#2b6cff',
  terminal: '#0a120a', working: '#dfe6ee', searching: '#1e3a5f', delegating: '#3b4a7a', waiting: '#5a4a12',
};
export const STATE_LABEL = {
  idle: '대기', thinking: '생각 중', reading: '읽는 중', coding: '코딩 중', terminal: '터미널', searching: '검색 중',
  delegating: '위임 중', working: '작업 중', waiting: '응답 대기', offduty: '퇴근',
};
export const STATE_COLOR = {
  idle: '#8e9aaf', thinking: '#a78bfa', reading: '#60a5fa', coding: '#3b82f6', terminal: '#22c55e', searching: '#06b6d4',
  delegating: '#f59e0b', working: '#e5e7eb', waiting: '#fbbf24', offduty: '#6b7280',
};
const MODE_LABEL = { plan: '계획', auto: '자동', bypassPermissions: '자동', dontAsk: '자동', acceptEdits: '편집 승인', default: '' };
const AUTO_MODES = new Set(['auto', 'bypassPermissions', 'dontAsk']);
const BUBBLE_MS = 15000;
/** Screen-space font size: scales with the canvas but never below a readable floor. */
const fpx = (k, S) => Math.max(13, k * S);
const PLACE_LABEL = { meeting: (st) => ROOMS[st.room].name, plan: () => '기획 보드', library: () => '서가', lounge: () => '라운지', bullpen: () => '로비', exit: () => '퇴근 중' };

export function render(ctx, S, world, now) {
  const { bg, ents, sessions, hoverKey, selectedKey } = world;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bg, 0, 0);

  // who is at which desk right now
  const atDesk = new Map();
  for (const e of ents.values()) if (e.kind === 'employee' && e.station?.kind === 'desk' && e.phase !== 'leave') atDesk.set(e.station.desk, e.data);
  for (let i = 0; i < DESK_COUNT; i++) {
    const s = atDesk.get(i);
    drawDeskProps(ctx, deskPos(i), s ? s.state : 'offduty', now, s ? familyOf(s.model) : 'other', s ? s.permissionMode : null);
  }
  // meeting rooms: laptops in front of seated people
  for (const e of ents.values()) {
    if (e.station?.kind !== 'meeting' || e.phase !== 'seated') continue;
    const r = ROOMS[e.station.room];
    const st = e.station;
    const state = e.data?.state || 'idle';
    if (st.y < r.table.y) drawMiniLaptop(ctx, st.x * TILE + 4, r.table.y * TILE + 1, state, now);
    else if (st.y >= r.table.y + r.table.h) drawMiniLaptop(ctx, st.x * TILE + 4, (r.table.y + r.table.h) * TILE - 8, state, now);
    else if (st.x < r.table.x) drawMiniLaptop(ctx, r.table.x * TILE + 1, st.y * TILE + 4, state, now);
    else if (st.x >= r.table.x + r.table.w) drawMiniLaptop(ctx, (r.table.x + r.table.w) * TILE - 10, st.y * TILE + 4, state, now);
  }
  // whiteboard scribbles while someone is planning
  const planners = [...ents.values()].filter((e) => e.station?.kind === 'plan' && e.phase === 'seated');
  drawWhiteboard(ctx, planners.length, now);

  const list = [...ents.values()].sort((a, b) => a.y - b.y);
  for (const e of list) drawEntity(ctx, e, now, e.key === selectedKey, e.key === hoverKey);

  // screen-space text
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSign(ctx, S);
  drawZoneLabels(ctx, S, world);
  for (const s of sessions.values()) drawNameplate(ctx, S, s, ents.get(s.id));
  for (const e of list) drawEntityCaption(ctx, S, e);
  const placed = [];
  for (const e of list) drawBubble(ctx, S, e, now, placed);
  drawHUD(ctx, S, world, now);
  drawLegend(ctx, S, world, now);
}

// ---- furniture state ------------------------------------------------------------
function drawDeskProps(g, d, state, t, fam = 'other', mode = null) {
  const dx = d.desk.x * TILE, dy = d.desk.y * TILE;
  const kind = (FAMILIES[fam] || FAMILIES.other).monitor;
  const mx = dx + 8; // monitor block origin (desk is 48 wide; monitor on the left-center, keyboard right)
  if (kind === 'wide-gold') {
    g.fillStyle = '#d4a017'; g.fillRect(mx, dy + 1, 16, 10);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 1, dy + 2, 14, 8);
    g.fillStyle = '#d4a017'; g.fillRect(mx + 7, dy + 11, 3, 1);
  } else if (kind === 'silver') {
    g.fillStyle = '#c8d0d8'; g.fillRect(mx + 1, dy + 2, 14, 9);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 2, dy + 3, 12, 7);
    g.fillStyle = '#9aa3b2'; g.fillRect(mx + 7, dy + 11, 3, 1);
  } else if (kind === 'laptop') {
    g.fillStyle = '#2c2c36'; g.fillRect(mx + 4, dy + 4, 9, 6);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 5, dy + 5, 7, 4);
    g.fillStyle = '#44454f'; g.fillRect(mx + 3, dy + 10, 11, 2);
  } else {
    g.fillStyle = '#23242e'; g.fillRect(mx + 2, dy + 2, 13, 9);
    g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(mx + 3, dy + 3, 11, 7);
    g.fillStyle = '#3a3b47'; g.fillRect(mx + 7, dy + 11, 3, 1);
  }
  const sx = kind === 'wide-gold' ? mx + 2 : kind === 'laptop' ? mx + 6 : mx + 4;
  const sy = kind === 'wide-gold' ? dy + 3 : kind === 'laptop' ? dy + 6 : dy + 4;
  const rowsN = kind === 'laptop' ? 2 : 3;
  const maxW = kind === 'laptop' ? 5 : kind === 'wide-gold' ? 9 : 7;
  if (state === 'coding' || state === 'terminal' || state === 'working') {
    g.fillStyle = state === 'coding' ? '#bcd4ff' : state === 'terminal' ? '#5dff7a' : '#8a94a6';
    const sc = Math.floor(t / (AUTO_MODES.has(mode) ? 200 : 350)) % 3;
    const widths = [6, 4, 7, 3, 5];
    for (let i = 0; i < rowsN; i++) g.fillRect(sx, sy + i * 2, Math.min(maxW, widths[(i + sc) % widths.length]), 1);
  } else if (state === 'searching') {
    g.fillStyle = '#9bd3ff'; g.fillRect(sx + 1, sy + 1, Math.min(maxW, 5), 1); g.fillRect(sx + 1, sy + 3, Math.min(maxW, 7), 1);
  } else if (state === 'reading') {
    g.fillStyle = '#4a5068'; g.fillRect(sx + 1, sy + 1, Math.min(maxW, 7), 1); g.fillRect(sx + 1, sy + 3, Math.min(maxW, 5), 1);
  } else if (state === 'waiting' && Math.floor(t / 400) % 2) {
    g.fillStyle = '#ffd166'; g.fillRect(sx + 4, sy, 1, 3); g.fillRect(sx + 4, sy + 4, 1, 1);
  }
  // keyboard + mouse
  g.fillStyle = '#50545e'; g.fillRect(dx + 27, dy + 5, 11, 3);
  g.fillStyle = '#6b6f7a'; for (let i = 0; i < 5; i++) g.fillRect(dx + 28 + i * 2, dy + 6, 1, 1);
  g.fillStyle = '#50545e'; g.fillRect(dx + 40, dy + 5, 3, 3);
  // left side: mode / state props
  if (AUTO_MODES.has(mode) && state !== 'offduty') drawGlyph(g, 'bolt', dx + 3, dy + 3, t);
  else if (mode === 'acceptEdits' && state !== 'offduty') drawGlyph(g, 'check', dx + 2, dy + 4, t);
  if (state === 'idle' || state === 'offduty') {
    g.fillStyle = '#fafafa'; g.fillRect(dx + 44, dy + 9, 3, 3); g.fillStyle = '#6f4e37'; g.fillRect(dx + 44, dy + 9, 3, 1);
  } else if (state === 'reading' || state === 'searching') {
    g.fillStyle = '#fdfdfd'; g.fillRect(dx + 1, dy + 7, 6, 5); g.fillStyle = '#9aa3b2'; g.fillRect(dx + 2, dy + 8, 3, 1); g.fillRect(dx + 2, dy + 10, 3, 1);
    if (state === 'searching') { const bob = Math.floor(t / 300) % 2; g.fillStyle = '#e8eef5'; g.fillRect(dx + 44, dy + 3 - bob, 3, 3); g.fillStyle = '#5a3825'; g.fillRect(dx + 43, dy + 6 - bob, 1, 2); }
  } else if (state === 'delegating') {
    g.fillStyle = '#2d2d2d'; g.fillRect(dx + 1, dy + 8, 6, 3); g.fillStyle = '#ffd166'; g.fillRect(dx + 2 + (Math.floor(t / 250) % 3) * 2, dy + 9, 1, 1);
  } else if (state === 'waiting') {
    g.fillStyle = '#fdfdfd'; g.fillRect(dx + 1, dy + 7, 6, 5); g.fillStyle = '#e74c3c'; g.fillRect(dx + 2, dy + 8, 4, 1);
  }
}

function drawMiniLaptop(g, x, y, state, t) {
  g.fillStyle = '#2c2c36'; g.fillRect(x, y, 8, 5);
  g.fillStyle = SCREEN[state] || SCREEN.idle; g.fillRect(x + 1, y + 1, 6, 3);
  g.fillStyle = '#44454f'; g.fillRect(x - 1, y + 5, 10, 1);
  if ((state === 'coding' || state === 'terminal' || state === 'working') && Math.floor(t / 350) % 2) { g.fillStyle = state === 'terminal' ? '#5dff7a' : '#bcd4ff'; g.fillRect(x + 2, y + 2, 3, 1); }
}

function drawWhiteboard(g, planners, t) {
  if (!planners) return;
  const bx = WHITEBOARD.x * TILE + 2, by = 3;
  const phase = (t % 9000) / 9000;
  const strokes = [
    ['#2563eb', 0, 1, 18, 1], ['#2563eb', 0, 3, 12, 1], ['#dc2626', 22, 1, 10, 1], ['#dc2626', 22, 3, 14, 1],
    ['#16a34a', 40, 1, 8, 1], ['#16a34a', 40, 3, 16, 1], ['#2563eb', 0, 6, 26, 1], ['#dc2626', 30, 6, 20, 1], ['#16a34a', 54, 6, 20, 1],
    ['#111827', 58, 1, 1, 4], ['#111827', 70, 1, 1, 4], ['#111827', 58, 1, 13, 1], ['#111827', 58, 4, 13, 1],
  ];
  const n = Math.floor(phase * (strokes.length + 2));
  strokes.slice(0, n).forEach(([c, x, y, w, h]) => { g.fillStyle = c; g.fillRect(bx + x, by + y, w, h); });
}

// ---- entities ------------------------------------------------------------------
function drawEntity(g, e, t, selected, hovered) {
  const data = e.data || {};
  const state = e.phase === 'leave' ? 'offduty' : (data.state || 'idle');
  const moving = e.path && e.path.length > 0;
  const stationKind = e.phase === 'seated' ? e.station?.kind : null;
  const anim = animFor(state, moving, stationKind);
  const auto = e.kind === 'employee' && AUTO_MODES.has(data.permissionMode);
  const rate = anim === 'walk' ? 90 : anim === 'type' ? (auto ? 100 : 160) : anim === 'write' ? 500 : 450;
  const frame = Math.floor((t + e.seed) / rate);
  const img = sprite(e.pal, anim, frame);
  const isAsst = e.kind === 'assistant';
  // centered on the tile, feet on the shadow line
  const ox = Math.round((TILE - img.width) / 2), oy = 14 - img.height;
  const bob = !moving && (anim === 'idle' || anim === 'read' || anim === 'sit') && Math.floor((t + e.seed) / 700) % 2 ? 1 : 0;
  g.globalAlpha = e.alpha;
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(e.x + ox, e.y + 14, img.width, 2);
  if (selected || hovered) {
    g.fillStyle = selected ? 'rgba(255,209,102,0.55)' : 'rgba(255,255,255,0.35)';
    g.fillRect(e.x + ox - 2, e.y + oy - 2 + bob, img.width + 4, img.height + 4);
  }
  if (anim === 'walk' && e.dir < 0) {
    g.save(); g.translate(e.x + ox + img.width, e.y + oy); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore();
  } else g.drawImage(img, e.x + ox, e.y + oy + bob);
  if (anim === 'sit' || stationKind === 'lounge') drawGlyph(g, 'cup', e.x + ox + img.width, e.y + oy + img.height - 4 + bob, t + e.seed);
  // indicators above the head
  const gx = e.x + ox + Math.floor(img.width / 2) - 3, gy = e.y + oy - 4;
  if (!moving) {
    if (state === 'thinking') drawGlyph(g, 'dots', gx, gy, t + e.seed);
    else if (state === 'waiting') drawGlyph(g, 'bang', gx + 2, gy - 3, t);
    else if (state === 'terminal') drawGlyph(g, 'term', gx - 1, gy - 4, t + e.seed);
    else if (state === 'idle' && !isAsst && stationKind !== 'lounge') drawGlyph(g, 'zzz', gx + 4, gy - 2, t + e.seed);
    else if (state === 'delegating' && stationKind === 'desk' && e.planeTo) {
      const ph = ((t + e.seed) % 1600) / 1600;
      drawGlyph(g, 'plane', e.x + 8 + (e.planeTo.x - e.x - 8) * ph, e.y - 2 + (e.planeTo.y - e.y + 2) * ph - Math.sin(ph * Math.PI) * 8, t);
    }
  }
  if (!isAsst && e.phase !== 'leave') {
    if (auto) drawGlyph(g, 'bolt', e.x + ox - 4, e.y + oy, t);
    else if (data.permissionMode === 'acceptEdits') drawGlyph(g, 'check', e.x + ox - 6, e.y + oy + 1, t);
  }
  g.globalAlpha = 1;
}

// ---- text -------------------------------------------------------------------------
function drawSign(ctx, S) {
  ctx.font = `bold ${6.5 * S}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = '#2a2d45'; ctx.fillText('PAWGENTS OFFICE', (SIGN.x * TILE + SIGN.w * TILE / 2) * S, 8 * S);
  ctx.textAlign = 'left';
}

function drawZoneLabels(ctx, S, world) {
  ctx.font = `${fpx(4, S)}px ${FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const label = (text, x, y, strong = false) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(text, x * S + 1, y * S + 1);
    ctx.fillStyle = strong ? '#ffd166' : 'rgba(255,255,255,0.75)'; ctx.fillText(text, x * S, y * S);
  };
  ROOMS.forEach((r, i) => {
    const sid = world.rooms[i];
    const s = sid ? world.sessions.get(sid) : null;
    const n = s ? (s.subagents || []).filter((a) => !a.ended).length : 0;
    label(s ? `${r.name} · ${s.name}${n ? ` (+${n})` : ''}` : r.name, r.x * TILE + 2, r.y * TILE + 2, !!s);
  });
  label('기획 보드', PLAN_ZONE.x * TILE + 2, (PLAN_ZONE.y + PLAN_ZONE.h) * TILE - 6);
  label('서가', LIBRARY_ZONE.x * TILE + 2, LIBRARY_ZONE.y * TILE + 2);
  label('라운지', LOUNGE.x * TILE + 2, LOUNGE.y * TILE + 2);
  label('로비', LOBBY.x * TILE + 2, LOBBY.y * TILE + 2);
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + '…';
}
function toolText(d) {
  return d.currentTool ? `${d.currentTool.name}${d.currentTool.target ? ' · ' + d.currentTool.target : ''}` : (STATE_LABEL[d.state] || d.state);
}
function shadowText(ctx, text, x, y, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/** Name tag under the desk: name / current tool (or where they went) / rank · mode. */
function drawNameplate(ctx, S, s, e) {
  // ended sessions linger in the store for a while, but their desk is already free (maybe reassigned)
  if (s.ended || s.desk >= DESK_COUNT) return;
  const d = deskPos(s.desk);
  const px = (d.caption.x * TILE + 2) * S, py = (d.caption.y * TILE + 1) * S;
  const maxW = d.caption.w * TILE * S - 4 * S;
  const away = !e || e.station?.kind !== 'desk';
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = `bold ${fpx(4.8, S)}px ${FONT}`;
  shadowText(ctx, fitText(ctx, s.name, maxW), px, py, away ? 'rgba(255,255,255,0.6)' : '#fff');
  ctx.font = `${fpx(4.2, S)}px ${FONT}`;
  let line2, color;
  if (away && e?.station) { line2 = (PLACE_LABEL[e.station.kind] || (() => ''))(e.station); color = 'rgba(255,255,255,0.55)'; }
  else { line2 = toolText(s); color = STATE_COLOR[s.state] || '#fff'; }
  shadowText(ctx, fitText(ctx, line2, maxW), px, py + 5.6 * S, color);
  const title = (FAMILIES[familyOf(s.model)] || FAMILIES.other).title;
  const mode = MODE_LABEL[s.permissionMode];
  const line3 = [title, mode].filter(Boolean).join(' · ');
  if (line3) {
    ctx.font = `${fpx(3.6, S)}px ${FONT}`;
    shadowText(ctx, fitText(ctx, line3, maxW), px, py + 10.4 * S, away ? 'rgba(255,209,102,0.55)' : '#ffd166');
  }
}

/** Caption under a character that is away from its desk, and under every assistant. */
function drawEntityCaption(ctx, S, e) {
  if (e.phase === 'leave' || e.phase === 'fade' || !e.station) return;
  const d = e.data || {};
  const isAsst = e.kind === 'assistant';
  if (!isAsst && e.station.kind === 'desk') return;
  ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  const cx = (e.x + 8) * S, cy = (e.y + 16) * S;
  const maxW = 5 * TILE * S;
  if (isAsst) {
    ctx.font = `${fpx(3.8, S)}px ${FONT}`;
    shadowText(ctx, fitText(ctx, toolText(d), maxW), cx, cy, STATE_COLOR[d.state] || '#fff');
  } else {
    ctx.font = `bold ${fpx(4.4, S)}px ${FONT}`;
    shadowText(ctx, fitText(ctx, d.name || '', maxW), cx, cy, '#fff');
    ctx.font = `${fpx(3.8, S)}px ${FONT}`;
    const mode = MODE_LABEL[d.permissionMode];
    shadowText(ctx, fitText(ctx, `${mode ? mode + ' · ' : ''}${toolText(d)}`, maxW), cx, cy + 5.2 * S, STATE_COLOR[d.state] || '#fff');
  }
  ctx.textAlign = 'left';
}

function wrapText(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = '', lastSpace = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cand = line + ch;
    if (ctx.measureText(cand).width > maxW && line) {
      if (ch !== ' ' && lastSpace > 0 && line.length - lastSpace < 12) { lines.push(line.slice(0, lastSpace)); line = line.slice(lastSpace + 1) + ch; }
      else { lines.push(line); line = ch === ' ' ? '' : ch; }
      lastSpace = -1;
      if (lines.length === maxLines) { line = null; break; }
    } else { line = cand; if (ch === ' ') lastSpace = line.length - 1; }
  }
  if (line === null) lines[maxLines - 1] = fitText(ctx, lines[maxLines - 1] + '…', maxW);
  else if (line) lines.push(line);
  return lines;
}

function drawBubble(ctx, S, e, now, placed) {
  const data = e.data;
  if (!data || !data.lastText || now - data.lastTextAt > BUBBLE_MS || e.phase === 'leave') return;
  const age = now - data.lastTextAt;
  const alpha = Math.min(1, age / 200) * (age > BUBBLE_MS - 600 ? (BUBBLE_MS - age) / 600 : 1) * e.alpha;
  if (alpha <= 0) return;
  const fs = fpx(4.4, S);
  ctx.font = `${fs}px ${FONT}`;
  const maxW = 70 * S;
  const lines = wrapText(ctx, data.lastText, maxW, 3);
  const lh = fs * 1.25, pad = 2 * S;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const bh = lines.length * lh + pad * 2;
  const isAsst = e.kind === 'assistant';
  const headX = (e.x + 8) * S, headY = (e.y + (isAsst ? 5 : 2) - 7) * S;
  let bx = Math.round(headX - bw / 2), by = Math.round(headY - bh - 3 * S);
  bx = Math.max(2 * S, Math.min(W * S - bw - 2 * S, bx));
  if (by < 18 * S) by = 18 * S;
  for (const r of placed) if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) by = r.y - bh - S;
  placed.push({ x: bx, y: by, w: bw, h: bh });
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(ctx, bx + S, by + S, bw, bh, 3 * S); ctx.fill();
  ctx.fillStyle = '#fffdf7'; roundRect(ctx, bx, by, bw, bh, 3 * S); ctx.fill();
  ctx.strokeStyle = '#2a2d45'; ctx.lineWidth = Math.max(1, S / 2); ctx.stroke();
  const tx = Math.max(bx + 4 * S, Math.min(bx + bw - 4 * S, headX));
  ctx.fillStyle = '#fffdf7';
  ctx.beginPath(); ctx.moveTo(tx - 2 * S, by + bh); ctx.lineTo(tx + 2 * S, by + bh); ctx.lineTo(tx, by + bh + 3 * S); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#2a2d45'; ctx.beginPath(); ctx.moveTo(tx - 2 * S, by + bh); ctx.lineTo(tx, by + bh + 3 * S); ctx.lineTo(tx + 2 * S, by + bh); ctx.stroke();
  ctx.fillStyle = '#1f2233'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lh));
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function drawHUD(ctx, S, world, now) {
  const { sessions, connected } = world;
  let emp = 0, asst = 0, busy = 0;
  for (const s of sessions.values()) {
    if (s.ended) continue;
    emp++;
    if (s.state !== 'idle') busy++;
    for (const a of s.subagents) if (!a.ended) asst++;
  }
  const meetings = world.rooms.filter(Boolean).length;
  const fs = fpx(4.6, S);
  ctx.font = `bold ${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const text = `직원 ${emp}  ·  보조 ${asst}  ·  일하는 중 ${busy}${meetings ? `  ·  회의 ${meetings}` : ''}`;
  const w = ctx.measureText(text).width + 6 * S;
  ctx.fillStyle = 'rgba(20,22,40,0.85)'; roundRect(ctx, 1.5 * TILE * S, 2 * S, w + 4 * S, 10 * S, 2 * S); ctx.fill();
  ctx.fillStyle = connected ? '#22c55e' : '#ef4444'; ctx.fillRect(1.5 * TILE * S + 2.5 * S, 5.5 * S, 3 * S, 3 * S);
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(text, 1.5 * TILE * S + 7 * S, 7 * S);
  const clock = new Date(now).toTimeString().slice(0, 8);
  ctx.textAlign = 'right';
  const cw = ctx.measureText(clock).width + 6 * S;
  const cx = (WHITEBOARD.x - 1) * TILE * S - 2 * S;
  ctx.fillStyle = 'rgba(20,22,40,0.85)'; roundRect(ctx, cx - cw, 2 * S, cw, 10 * S, 2 * S); ctx.fill();
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(clock, cx - 3 * S, 7 * S);
  ctx.textAlign = 'left';
}

/** Model legend (bottom wall). */
function drawLegend(ctx, S, world) {
  const present = new Set(['fable', 'opus', 'sonnet', 'haiku']);
  for (const s of world.sessions.values()) if (!s.ended) present.add(familyOf(s.model));
  const fams = Object.keys(FAMILIES).filter((f) => present.has(f) && (f !== 'other' || [...world.sessions.values()].some((s) => !s.ended && familyOf(s.model) === 'other')));
  const fs = fpx(4, S);
  ctx.font = `${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const labelOf = (f) => [FAMILIES[f].label, FAMILIES[f].title, FAMILIES[f].breed].filter(Boolean).join(' ');
  const itemW = fams.map((f) => 8 * S + 3 * S + ctx.measureText(labelOf(f)).width + 6 * S);
  const totalW = itemW.reduce((a, b) => a + b, 0) + 4 * S;
  const x0 = (W - TILE) * S - totalW - 2 * S, y0 = (H - TILE) * S + 2 * S, h = 12 * S;
  ctx.fillStyle = 'rgba(20,22,40,0.85)'; roundRect(ctx, x0, y0, totalW, h, 2 * S); ctx.fill();
  let x = x0 + 3 * S;
  fams.forEach((f, i) => {
    const img = sprite(paletteFor('legend', 'employee', f === 'other' ? null : `claude-${f}`), 'idle', 0);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y0 + (h - img.height * S) / 2, img.width * S, img.height * S);
    ctx.restore();
    ctx.fillStyle = '#f3f4f6'; ctx.fillText(labelOf(f), x + 8 * S + 3 * S, y0 + h / 2);
    x += itemW[i];
  });
  drawNewButton(ctx, S, world, x0, y0, h);
}

/** "+ 새 직원" button just left of the legend. Its rect (office px) goes to world.newBtn for hit-testing. */
function drawNewButton(ctx, S, world, legendX, y0, h) {
  const label = '+ 새 직원';
  const w = ctx.measureText(label).width + 8 * S;
  const x = legendX - 3 * S - w;
  const hover = world.hoverKey === NEW_BTN;
  ctx.fillStyle = hover ? '#ffe08a' : 'rgba(255,209,102,0.92)'; roundRect(ctx, x, y0, w, h, 2 * S); ctx.fill();
  ctx.fillStyle = '#1f2233'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y0 + h / 2); ctx.textAlign = 'left';
  world.newBtn = { x: x / S, y: y0 / S, w: w / S, h: h / S };
}
export const NEW_BTN = '__new__';
