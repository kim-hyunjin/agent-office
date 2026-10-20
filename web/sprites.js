// Programmatic pixel sprites: string art → cached OffscreenCanvas. No image assets.

const BODY = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b9d', '#5dade2', '#c0392b'];
const HAIR = ['#2b1b0e', '#5a3825', '#d4a017', '#1a1a2e', '#7b241c', '#4a235a', '#616a6b'];
const SKIN = ['#f1c27d', '#e0ac69', '#ffdbac', '#c68642', '#8d5524'];
const PANTS = ['#2c3e50', '#34495e', '#1f2a44', '#4b3832'];
const CAP = ['#ffffff', '#ffd166', '#06d6a0', '#ef476f', '#118ab2'];

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Model family → outfit. Higher tier = more senior look. Hair/skin still vary per session.
export const FAMILIES = {
  fable:  { label: 'Fable',  title: '수석', tier: 4, body: ['#5b21b6', '#4c1d95', '#6d28d9'], accessories: ['tie:#ffd166', 'pin:#ffd166'], monitor: 'wide-gold' },
  opus:   { label: 'Opus',   title: '선임', tier: 3, body: ['#1e3a8a', '#1f2937', '#312e81'], accessories: ['tie:#c0392b', 'glasses:#e8eef5'], monitor: 'silver' },
  sonnet: { label: 'Sonnet', title: '사원', tier: 2, body: ['#0d9488', '#059669', '#0e7490'], accessories: ['headphones:#1a1a2e'], monitor: 'normal' },
  haiku:  { label: 'Haiku',  title: '인턴', tier: 1, body: ['#f59e0b', '#f97316', '#fbbf24'], accessories: ['lanyard:#fdfdfd'], monitor: 'laptop' },
  other:  { label: '기타',   title: '',     tier: 0, body: BODY, accessories: [], monitor: 'normal' },
};
export function familyOf(model) {
  const m = String(model || '').toLowerCase();
  if (/fable|mythos/.test(m)) return 'fable';
  if (/opus/.test(m)) return 'opus';
  if (/sonnet/.test(m)) return 'sonnet';
  if (/haiku/.test(m)) return 'haiku';
  return 'other';
}

export function paletteFor(id, kind = 'employee', model = null) {
  const h = hashStr(id);
  const fam = familyOf(model);
  const F = FAMILIES[fam];
  return {
    fam,
    B: F.body[h % F.body.length],
    accessories: F.accessories,
    H: HAIR[(h >>> 4) % HAIR.length],
    S: SKIN[(h >>> 8) % SKIN.length],
    P: PANTS[(h >>> 12) % PANTS.length],
    C: CAP[(h >>> 16) % CAP.length],
    E: '#1a1a2e',
    K: '#1a1a2e',
    W: '#fdfdfd',
    L: '#c8d0d8',
    D: '#111',
    A: '#ffd166',
    kind,
  };
}

const E = {
  idle: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'S.BBBB.S', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  walk: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'S.BBBB.S', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ], [
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'S.BBBB.S', '..BBBB..', '..PPPP..', '.PP..PP.', '.KK..KK.',
  ], [
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'S.BBBB.S', '..BBBB..', '..PPPP..', '..PPPP..', '..K..K..',
  ]],
  type: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    '.BBBBBB.', 'SBBBBBBS', '.SBBBBS.', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ], [
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    '.BBBBBB.', '.BBBBBB.', 'SSBBBBSS', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  read: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'SWWWWWWS', '.WWLWWW.', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ], [
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'SWWWWWWS', '.WWWLWW.', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  wait: [[
    '..HHHH.S', '.HHHHHHS', '.HSSSSHS', '.SESSESS', '..SSSS.B', '.BBBBBBB',
    'SBBBBBB.', 'S.BBBB..', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ], [
    '..HHHH..', '.HHHHHH.', '.HSSSSHS', '.SESSESS', '..SSSSB.', '.BBBBBB.',
    'SBBBBBB.', 'S.BBBB..', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  phone: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSHD', '.SESSESD', '..SSSS.S', '.BBBBBBS',
    'SBBBBBB.', 'S.BBBB..', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  write: [[
    '..HHHH.D', '.HHHHHHS', '.HSSSSHS', '.SESSESS', '..SSSS.B', '.BBBBBBB',
    'SBBBBBB.', 'S.BBBB..', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ], [
    '..HHHH..', '.HHHHHHD', '.HSSSSHS', '.SESSESS', '..SSSSB.', '.BBBBBB.',
    'SBBBBBB.', 'S.BBBB..', '..BBBB..', '..PPPP..', '..PP.PP.', '..KK.KK.',
  ]],
  sit: [[
    '..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '.BBBBBB.',
    'SBBBBBBS', 'S.BBBB.S', '..BBBB..', '.PPPPPP.', '.PP..PP.', '.KK..KK.',
  ]],
};

// Assistant (subagent): smaller, wears a cap.
const A = {
  idle: [[
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', 'SBBBBS', '.BBBB.', '.P..P.', '.K..K.',
  ]],
  walk: [[
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', 'SBBBBS', '.BBBB.', '.P..P.', '.K..K.',
  ], [
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', 'SBBBBS', '.BBBB.', 'P....P', 'K....K',
  ]],
  type: [[
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', '.BBBB.', 'SBBBBS', '.P..P.', '.K..K.',
  ], [
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', '.BBBB.', '.SBBS.', '.P..P.', '.K..K.',
  ]],
  read: [[
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', 'SWWWWS', '.WWWW.', '.P..P.', '.K..K.',
  ]],
  wait: [[
    '.CCCC.S', 'CCCCCCS', '.SSSS.S', '.ESSE.B', '.BBBBB.', 'SBBBB.', '.BBBB.', '.P..P.', '.K..K.',
  ], [
    '.CCCC.', 'CCCCCC', '.SSSSS', '.ESSES', '.BBBB.', 'SBBBB.', '.BBBB.', '.P..P.', '.K..K.',
  ]],
  phone: [[
    '.CCCC.', 'CCCCCC', '.SSSSD', '.ESSED', '.BBBBS', 'SBBBB.', '.BBBB.', '.P..P.', '.K..K.',
  ]],
  write: [[
    '.CCCC.D', 'CCCCCCS', '.SSSS.S', '.ESSE.B', '.BBBBB.', 'SBBBB.', '.BBBB.', '.P..P.', '.K..K.',
  ], [
    '.CCCC.', 'CCCCCD', '.SSSSS', '.ESSES', '.BBBB.', 'SBBBB.', '.BBBB.', '.P..P.', '.K..K.',
  ]],
  sit: [[
    '.CCCC.', 'CCCCCC', '.SSSS.', '.ESSE.', '.BBBB.', 'SBBBBS', '.BBBB.', 'PP..PP', 'KK..KK',
  ]],
};

export const SHEETS = { employee: E, assistant: A };

const cache = new Map();

/** Returns an OffscreenCanvas with the frame rasterized in the given palette. */
export function sprite(pal, anim, frame) {
  const sheet = SHEETS[pal.kind] || E;
  const frames = sheet[anim] || sheet.idle;
  const rows = frames[frame % frames.length];
  const key = `${pal.kind}|${pal.fam}|${pal.B}|${pal.H}|${pal.S}|${pal.P}|${pal.C}|${anim}|${frame % frames.length}`;
  let c = cache.get(key);
  if (c) return c;
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = pal[ch] || '#f0f';
      g.fillRect(x, y, 1, 1);
    }
  }
  drawAccessory(g, pal, rows);
  cache.set(key, c);
  return c;
}

/** Model-family accessories drawn over the base sprite (8×12 employee / 6×9 assistant grids). */
function drawAccessory(g, pal, rows) {
  const asst = pal.kind === 'assistant';
  for (const spec of pal.accessories || []) {
    const [name, color] = spec.split(':');
    g.fillStyle = color;
    switch (name) {
      case 'tie':
        if (asst) { g.fillRect(2, 4, 2, 1); g.fillRect(2, 5, 2, 1); }
        else { g.fillRect(3, 5, 2, 1); g.fillRect(3, 6, 2, 1); g.fillRect(3, 7, 2, 1); g.fillRect(3, 8, 1, 1); }
        break;
      case 'pin': // badge on the chest
        if (asst) g.fillRect(4, 4, 1, 1); else g.fillRect(1, 6, 1, 1);
        break;
      case 'glasses': {
        const y = 3;
        const eyes = [];
        for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === 'E') eyes.push(x);
        for (const ex of eyes) { g.fillRect(ex - 1, y, 1, 1); g.fillRect(ex + 1, y, 1, 1); }
        if (eyes.length === 2) g.fillRect(eyes[0] + 1, y, eyes[1] - eyes[0] - 1, 1);
        break;
      }
      case 'headphones':
        if (asst) { g.fillRect(1, 0, 4, 1); g.fillRect(0, 1, 1, 2); g.fillRect(5, 1, 1, 2); }
        else { g.fillRect(2, 0, 4, 1); g.fillRect(1, 1, 1, 1); g.fillRect(6, 1, 1, 1); g.fillRect(0, 2, 1, 2); g.fillRect(7, 2, 1, 2); }
        break;
      case 'lanyard': // intern badge on a strap
        if (asst) { g.fillRect(2, 5, 2, 2); g.fillStyle = '#e74c3c'; g.fillRect(2, 5, 2, 1); }
        else {
          g.fillStyle = '#e74c3c'; g.fillRect(2, 5, 1, 1); g.fillRect(5, 5, 1, 1); g.fillRect(3, 6, 2, 1);
          g.fillStyle = color; g.fillRect(3, 7, 2, 2);
          g.fillStyle = '#3b82f6'; g.fillRect(3, 8, 2, 1);
        }
        break;
    }
  }
}

/** Map an entity state to a sprite animation name. */
export function animFor(state, moving, station = null) {
  if (moving) return 'walk';
  if (station === 'plan' && state !== 'waiting') return 'write';
  if (station === 'library' && state !== 'waiting') return 'read';
  if (station === 'lounge') return 'sit';
  switch (state) {
    case 'coding': case 'terminal': case 'working': return 'type';
    case 'reading': case 'searching': return 'read';
    case 'waiting': return 'wait';
    case 'delegating': return 'phone';
    default: return 'idle';
  }
}

/** Small pixel glyphs drawn directly (no cache needed). */
export function drawGlyph(g, name, x, y, t) {
  switch (name) {
    case 'dots': {
      const n = Math.floor(t / 300) % 4;
      g.fillStyle = '#f4f4f4';
      for (let i = 0; i < 3; i++) if (i < n) g.fillRect(x + i * 3, y, 2, 2);
      break;
    }
    case 'bang': {
      const bob = Math.floor(t / 250) % 2;
      g.fillStyle = '#ffd166';
      g.fillRect(x, y - bob, 2, 5);
      g.fillRect(x, y + 6 - bob, 2, 2);
      break;
    }
    case 'zzz': {
      const ph = (t % 12000) / 1000;
      if (ph > 4) return;
      const rise = Math.floor(ph * 1.5);
      g.fillStyle = '#cfd8e3';
      for (let i = 0; i < 3; i++) {
        const zx = x + i * 3, zy = y + 2 - rise - i * 2;
        g.fillRect(zx, zy, 3, 1); g.fillRect(zx + 1, zy + 1, 1, 1); g.fillRect(zx, zy + 2, 3, 1);
      }
      break;
    }
    case 'plane': {
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, 3, 1); g.fillRect(x, y + 1, 2, 1); g.fillRect(x, y + 2, 1, 1);
      break;
    }
    case 'bolt': { // auto / bypass permissions
      g.fillStyle = '#ffd166';
      g.fillRect(x + 1, y, 2, 1); g.fillRect(x, y + 1, 2, 1); g.fillRect(x, y + 2, 3, 1); g.fillRect(x + 1, y + 3, 2, 1); g.fillRect(x + 1, y + 4, 1, 1);
      break;
    }
    case 'check': { // acceptEdits
      g.fillStyle = '#22c55e';
      g.fillRect(x, y + 2, 1, 1); g.fillRect(x + 1, y + 3, 1, 1); g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + 3, y + 1, 1, 1); g.fillRect(x + 4, y, 1, 1);
      break;
    }
    case 'cup': { // coffee in hand
      g.fillStyle = '#fafafa'; g.fillRect(x, y, 3, 3);
      g.fillStyle = '#6f4e37'; g.fillRect(x, y, 3, 1);
      g.fillStyle = '#fafafa'; g.fillRect(x + 3, y + 1, 1, 1);
      if (Math.floor(t / 500) % 2) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 1, y - 2, 1, 1); }
      break;
    }
  }
}
