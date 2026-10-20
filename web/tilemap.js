// Office layout: 32×20 tiles of 16px. Zones: meeting rooms + lobby (left), bench desks (center),
// planning whiteboard / library / lounge (right). Also exposes walkability + BFS path finding.
export const TILE = 16;
export const MAP_W = 32;
export const MAP_H = 20;
export const W = MAP_W * TILE;
export const H = MAP_H * TILE;

export const DESK_COUNT = 16;
export const DOOR = { x: 3, y: 19 };
export const SPAWN = { x: 3, y: 18 };

// ---- zones ----------------------------------------------------------------------
export const ROOMS = [
  { id: 0, name: '회의실 A', x: 1, y: 1, w: 8, h: 5, door: { x: 9, y: 4 }, table: { x: 3, y: 3, w: 4, h: 2 }, head: { x: 2, y: 3 },
    seats: [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 2, y: 4 }] },
  { id: 1, name: '회의실 B', x: 1, y: 7, w: 8, h: 5, door: { x: 9, y: 10 }, table: { x: 3, y: 9, w: 4, h: 2 }, head: { x: 2, y: 9 },
    seats: [{ x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }, { x: 3, y: 11 }, { x: 4, y: 11 }, { x: 5, y: 11 }, { x: 6, y: 11 }, { x: 7, y: 9 }, { x: 7, y: 10 }, { x: 2, y: 10 }] },
];
export const LOBBY = { x: 1, y: 13, w: 9, h: 6 };
export const RECEPTION = { x: 2, y: 14, w: 3 };
export const BULLPEN_SPOTS = [];
for (let y = 15; y <= 17; y++) for (let x = 5; x <= 8; x++) BULLPEN_SPOTS.push({ x, y });

export const WHITEBOARD = { x: 26, y: 0, w: 5 };
export const PLAN_SPOTS = [26, 27, 28, 29, 30].map((x) => ({ x, y: 1 }));
export const PLAN_ZONE = { x: 26, y: 1, w: 5, h: 4 };
export const BOOKSHELF = { x: 30, y: 6, h: 5 };
export const LIBRARY_ZONE = { x: 26, y: 6, w: 5, h: 5 };
export const LIBRARY_SPOTS = [6, 7, 8, 9, 10].map((y) => ({ x: 29, y })); // facing the bookshelf
export const LOUNGE = { x: 26, y: 12, w: 5, h: 7 };
export const COFFEE = { x: 30, y: 12 };
export const SOFA = { x: 27, y: 14, w: 3 };
export const LOUNGE_SPOTS = [{ x: 27, y: 14, sofa: true }, { x: 28, y: 14, sofa: true }, { x: 29, y: 14, sofa: true }, { x: 29, y: 12 }, { x: 29, y: 13 }];
export const SIGN = { x: 12, y: 0, w: 5 };
export const PLANTS = [{ x: 25, y: 1 }, { x: 25, y: 18 }, { x: 1, y: 13 }, { x: 8, y: 13 }, { x: 26, y: 18 }, { x: 30, y: 18 }, { x: 10, y: 18 }];

/** Bench desks: 4 rows × (2 pods × 2 desks). Each desk is 3 tiles wide; the chair sits above the middle tile. */
export function deskPos(i) {
  const row = i >> 2, col = i & 3;
  const x = col < 2 ? 11 + col * 3 : 18 + (col - 2) * 3;
  const y = 2 + row * 4;
  return { x, y, chair: { x: x + 1, y }, desk: { x, y: y + 1, w: 3 }, caption: { x, y: y + 2, w: 3 } };
}
/** Standing spots in the aisle beside a desk, used when every meeting room is taken. */
export function nearDeskSpots(i) {
  const d = deskPos(i);
  const col = i & 3;
  const ax = col === 0 ? 10 : col === 1 ? 17 : col === 2 ? 17 : 24; // aisle column next to this desk
  return [{ x: ax, y: d.y + 1 }, { x: ax, y: d.y }, { x: ax, y: d.y - 1 }];
}

// ---- walkability -----------------------------------------------------------------
const blocked = new Uint8Array(MAP_W * MAP_H);
const block = (x, y, w = 1, h = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < MAP_W && j < MAP_H) blocked[j * MAP_W + i] = 1; };
const unblock = (x, y) => { blocked[y * MAP_W + x] = 0; };
block(0, 0, MAP_W, 1); block(0, MAP_H - 1, MAP_W, 1); block(0, 0, 1, MAP_H); block(MAP_W - 1, 0, 1, MAP_H);
for (const r of ROOMS) {
  block(r.x + r.w, r.y, 1, r.h); // right glass wall (x = r.x + r.w)
  block(r.x, r.y + r.h, r.w + 1, 1); // bottom glass wall
  unblock(r.door.x, r.door.y);
  block(r.table.x, r.table.y, r.table.w, r.table.h);
}
block(RECEPTION.x, RECEPTION.y, RECEPTION.w, 1);
for (let i = 0; i < DESK_COUNT; i++) { const d = deskPos(i); block(d.desk.x, d.desk.y, d.desk.w, 1); }
block(BOOKSHELF.x, BOOKSHELF.y, 1, BOOKSHELF.h);
block(COFFEE.x, COFFEE.y);
for (const p of PLANTS) block(p.x, p.y);
export const isBlocked = (x, y) => x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || blocked[y * MAP_W + x] === 1;

/** BFS shortest path on the tile grid. Returns tiles after `from` ending at `to`, [] if equal, null if unreachable. */
export function findPath(from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x, y) => y * MAP_W + x;
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const q = [key(from.x, from.y)];
  prev[q[0]] = q[0];
  const target = key(to.x, to.y);
  let head = 0, found = false;
  while (head < q.length) {
    const k = q[head++];
    if (k === target) { found = true; break; }
    const x = k % MAP_W, y = (k / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isBlocked(nx, ny) && !(nx === to.x && ny === to.y)) continue;
      const nk = key(nx, ny);
      if (prev[nk] !== -1) continue;
      prev[nk] = k;
      q.push(nk);
    }
  }
  if (!found) return null;
  const path = [];
  for (let k = target; k !== key(from.x, from.y); k = prev[k]) path.push({ x: k % MAP_W, y: (k / MAP_W) | 0 });
  return path.reverse();
}

// ---- static background -------------------------------------------------------------
const C = {
  wall: '#3b3f5c', wallTop: '#2a2d45', wallLine: '#4b5078',
  wood: '#cdb089', wood2: '#c3a67f', woodLine: '#b4976f',
  meet: '#9fb3c8', meet2: '#97abc0', lobby: '#d6d9de', lobby2: '#ced1d6',
  plan: '#b9b0d6', plan2: '#b1a8ce', lib: '#c9b8a3', lib2: '#c1b09b', lounge: '#d9a48d', lounge2: '#d19c85', rug: '#b5574e', rug2: '#a84e46',
  glass: 'rgba(190,230,255,0.75)', glassFrame: '#e8f4ff', glassDark: '#8fb6d4',
  desk: '#a0714f', deskEdge: '#6e4a30', divider: '#8c6245', chair: '#4a4e69', chairLight: '#5c6088',
  table: '#8b5e3c', tableEdge: '#5e3d25', shadow: 'rgba(0,0,0,0.15)',
  board: '#f7f7f2', boardFrame: '#8a8a8a', tray: '#b0b0b0',
  sofa: '#c0392b', sofaDark: '#922b21', sofaLight: '#d35445', coffee: '#3d3d3d', coffee2: '#c0392b',
  shelf: '#7a4b2a', shelfDark: '#5a361d', book: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'],
  plant: '#2e8b57', plantDark: '#206b40', pot: '#b5651d', recept: '#6b7a99', receptTop: '#8ea0c4',
  door: '#8b5a2b', doorDark: '#5c3a1a',
};

export function buildBackground() {
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  const tile = (x, y, a, b) => { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * TILE, y * TILE, TILE, TILE); };
  // base: wood planks in the open area
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    g.fillStyle = y % 2 ? C.wood : C.wood2; g.fillRect(x * TILE, y * TILE, TILE, TILE);
    g.fillStyle = C.woodLine; g.fillRect(x * TILE, y * TILE + TILE - 1, TILE, 1);
    if ((x * 7 + y * 3) % 5 === 0) g.fillRect(x * TILE + 7, y * TILE, 1, TILE - 1);
  }
  // zones
  for (const r of ROOMS) for (let y = r.y; y <= r.y + r.h; y++) for (let x = r.x; x <= r.x + r.w; x++) tile(x, y, C.meet, C.meet2);
  for (let y = LOBBY.y; y < LOBBY.y + LOBBY.h; y++) for (let x = LOBBY.x; x < LOBBY.x + LOBBY.w; x++) tile(x, y, C.lobby, C.lobby2);
  for (let y = PLAN_ZONE.y; y < PLAN_ZONE.y + PLAN_ZONE.h; y++) for (let x = PLAN_ZONE.x; x < PLAN_ZONE.x + PLAN_ZONE.w; x++) tile(x, y, C.plan, C.plan2);
  for (let y = LIBRARY_ZONE.y; y < LIBRARY_ZONE.y + LIBRARY_ZONE.h; y++) for (let x = LIBRARY_ZONE.x; x < LIBRARY_ZONE.x + LIBRARY_ZONE.w; x++) tile(x, y, C.lib, C.lib2);
  for (let y = LOUNGE.y; y < LOUNGE.y + LOUNGE.h; y++) for (let x = LOUNGE.x; x < LOUNGE.x + LOUNGE.w; x++) tile(x, y, C.lounge, C.lounge2);
  for (let y = 13; y <= 17; y++) for (let x = 26; x <= 29; x++) tile(x, y, C.rug, C.rug2);
  // walls
  g.fillStyle = C.wall;
  g.fillRect(0, 0, W, TILE); g.fillRect(0, H - TILE, W, TILE); g.fillRect(0, 0, TILE, H); g.fillRect(W - TILE, 0, TILE, H);
  g.fillStyle = C.wallTop; g.fillRect(0, 0, W, 6);
  g.fillStyle = C.wallLine; g.fillRect(0, TILE - 2, W, 2);
  // windows on the top wall (skip the sign + whiteboard)
  for (let x = 2; x < MAP_W - 2; x += 3) {
    if ((x >= SIGN.x - 1 && x <= SIGN.x + SIGN.w) || x >= WHITEBOARD.x - 1) continue;
    g.fillStyle = C.glassFrame; g.fillRect(x * TILE + 1, 3, 30, 11);
    g.fillStyle = '#9ad1f5'; g.fillRect(x * TILE + 2, 4, 28, 9);
    g.fillStyle = C.glassFrame; g.fillRect(x * TILE + 16, 4, 1, 9); g.fillRect(x * TILE + 2, 8, 28, 1);
  }
  // sign board
  g.fillStyle = C.boardFrame; g.fillRect(SIGN.x * TILE, 2, SIGN.w * TILE, 12);
  g.fillStyle = C.board; g.fillRect(SIGN.x * TILE + 1, 3, SIGN.w * TILE - 2, 10);
  // whiteboard on the top wall
  g.fillStyle = C.boardFrame; g.fillRect(WHITEBOARD.x * TILE - 2, 1, WHITEBOARD.w * TILE + 2, 14);
  g.fillStyle = C.board; g.fillRect(WHITEBOARD.x * TILE - 1, 2, WHITEBOARD.w * TILE, 11);
  g.fillStyle = C.tray; g.fillRect(WHITEBOARD.x * TILE - 1, 13, WHITEBOARD.w * TILE, 2);
  // meeting rooms: glass walls + door + table + chairs
  for (const r of ROOMS) {
    const gx = (r.x + r.w) * TILE, gy = (r.y + r.h) * TILE;
    g.fillStyle = C.glass; g.fillRect(gx + 5, r.y * TILE, 6, r.h * TILE + TILE); g.fillRect(r.x * TILE, gy + 5, r.w * TILE + TILE, 6);
    g.fillStyle = C.glassFrame; g.fillRect(gx + 5, r.y * TILE, 1, r.h * TILE + TILE); g.fillRect(gx + 10, r.y * TILE, 1, r.h * TILE + TILE);
    g.fillRect(r.x * TILE, gy + 5, r.w * TILE + TILE, 1); g.fillRect(r.x * TILE, gy + 10, r.w * TILE + TILE, 1);
    g.fillStyle = C.glassDark; for (let y = r.y * TILE; y < gy + TILE; y += TILE) g.fillRect(gx + 5, y, 6, 1);
    // door gap
    g.fillStyle = C.meet; g.fillRect(gx, r.door.y * TILE, TILE, TILE);
    g.fillStyle = C.door; g.fillRect(gx + 6, r.door.y * TILE + 1, 4, TILE - 2);
    drawMeetingTable(g, r.table.x * TILE, r.table.y * TILE, r.table.w * TILE, r.table.h * TILE);
    for (const s of r.seats) drawChair(g, s.x * TILE, s.y * TILE, s.y < r.table.y ? 'down' : s.y >= r.table.y + r.table.h ? 'up' : 'side');
    drawChair(g, r.head.x * TILE, r.head.y * TILE, 'side', true);
  }
  // lobby: reception + door
  drawReception(g, RECEPTION.x * TILE, RECEPTION.y * TILE, RECEPTION.w * TILE);
  g.fillStyle = C.doorDark; g.fillRect(DOOR.x * TILE - 2, H - TILE, TILE + 4, TILE);
  g.fillStyle = C.door; g.fillRect(DOOR.x * TILE, H - TILE + 2, TILE, TILE - 2);
  g.fillStyle = '#ffd166'; g.fillRect(DOOR.x * TILE + 11, H - TILE + 8, 2, 2);
  g.fillStyle = C.lobby2; g.fillRect(LOBBY.x * TILE, 13 * TILE, LOBBY.w * TILE, 1);
  // desks
  for (let i = 0; i < DESK_COUNT; i++) {
    const d = deskPos(i);
    drawChair(g, d.chair.x * TILE, d.chair.y * TILE, 'down');
    drawDesk(g, d.desk.x * TILE, d.desk.y * TILE, d.desk.w * TILE, (i & 1) === 1);
  }
  // library
  drawBookshelf(g, BOOKSHELF.x * TILE, BOOKSHELF.y * TILE, BOOKSHELF.h * TILE);
  // lounge
  drawSofa(g, SOFA.x * TILE, SOFA.y * TILE, SOFA.w * TILE);
  g.fillStyle = C.table; g.fillRect(27 * TILE + 4, 16 * TILE + 2, 28, 10); g.fillStyle = C.tableEdge; g.fillRect(27 * TILE + 4, 16 * TILE + 11, 28, 2);
  g.fillStyle = C.coffee; g.fillRect(COFFEE.x * TILE + 2, COFFEE.y * TILE + 1, 12, 14);
  g.fillStyle = C.coffee2; g.fillRect(COFFEE.x * TILE + 4, COFFEE.y * TILE + 3, 8, 4);
  g.fillStyle = '#fff'; g.fillRect(COFFEE.x * TILE + 6, COFFEE.y * TILE + 10, 4, 3);
  for (const p of PLANTS) drawPlant(g, p.x * TILE, p.y * TILE);
  return c;
}

function drawPlant(g, x, y) {
  g.fillStyle = C.pot; g.fillRect(x + 5, y + 10, 6, 5);
  g.fillStyle = C.plantDark; g.fillRect(x + 3, y + 4, 10, 7);
  g.fillStyle = C.plant; g.fillRect(x + 4, y + 2, 8, 7); g.fillRect(x + 2, y + 6, 3, 3); g.fillRect(x + 11, y + 5, 3, 3);
}
function drawChair(g, x, y, facing = 'down', head = false) {
  g.fillStyle = C.shadow; g.fillRect(x + 2, y + 13, 12, 3);
  g.fillStyle = head ? '#6b4c9a' : C.chair;
  if (facing === 'down') { g.fillRect(x + 3, y + 1, 10, 3); g.fillRect(x + 3, y + 4, 10, 9); }
  else if (facing === 'up') { g.fillRect(x + 3, y + 2, 10, 9); g.fillRect(x + 3, y + 11, 10, 3); }
  else { g.fillRect(x + 2, y + 3, 3, 10); g.fillRect(x + 5, y + 3, 9, 10); }
  g.fillStyle = head ? '#8e6cc4' : C.chairLight; g.fillRect(x + 5, y + 5, 7, 6);
}
function drawDesk(g, x, y, w, rightHalf) {
  g.fillStyle = C.shadow; g.fillRect(x + 1, y + 13, w, 3);
  g.fillStyle = C.desk; g.fillRect(x, y + 1, w, 12);
  g.fillStyle = C.deskEdge; g.fillRect(x, y + 12, w, 2); g.fillRect(x, y + 1, w, 1);
  if (!rightHalf) { g.fillStyle = C.divider; g.fillRect(x + w - 1, y + 1, 1, 12); }
}
function drawMeetingTable(g, x, y, w, h) {
  g.fillStyle = C.shadow; g.fillRect(x + 2, y + h - 2, w, 4);
  g.fillStyle = C.table; g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = C.tableEdge; g.fillRect(x + 1, y + h - 3, w - 2, 2); g.fillRect(x + 1, y + 1, w - 2, 1);
  g.fillStyle = '#a6744c'; g.fillRect(x + 3, y + 3, w - 6, h - 7);
}
function drawReception(g, x, y, w) {
  g.fillStyle = C.shadow; g.fillRect(x + 1, y + 13, w, 3);
  g.fillStyle = C.recept; g.fillRect(x, y + 2, w, 11);
  g.fillStyle = C.receptTop; g.fillRect(x, y + 2, w, 3);
  g.fillStyle = '#fff'; g.fillRect(x + w - 8, y + 6, 5, 4); g.fillStyle = '#2ecc71'; g.fillRect(x + 4, y + 7, 3, 2);
}
function drawBookshelf(g, x, y, h) {
  g.fillStyle = C.shelfDark; g.fillRect(x + 1, y, 14, h);
  g.fillStyle = C.shelf; g.fillRect(x + 2, y + 1, 12, h - 2);
  for (let row = 0; row < h / 16; row++) {
    const by = y + 3 + row * 16;
    for (let i = 0; i < 5; i++) { g.fillStyle = C.book[(i + row) % C.book.length]; g.fillRect(x + 3 + i * 2, by + (i % 2), 2, 9 - (i % 2)); }
    g.fillStyle = C.shelfDark; g.fillRect(x + 2, by + 11, 12, 1);
  }
}
function drawSofa(g, x, y, w) {
  g.fillStyle = C.shadow; g.fillRect(x + 1, y + 13, w, 3);
  g.fillStyle = C.sofaDark; g.fillRect(x, y + 2, w, 12);
  g.fillStyle = C.sofa; g.fillRect(x + 2, y + 5, w - 4, 8);
  g.fillStyle = C.sofaLight; g.fillRect(x + 2, y + 2, w - 4, 3);
  for (let i = 1; i < w / 16; i++) { g.fillStyle = C.sofaDark; g.fillRect(x + i * 16, y + 5, 1, 8); }
}
