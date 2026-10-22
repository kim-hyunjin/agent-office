// Programmatic pixel sprites: string art → cached OffscreenCanvas. No image assets.
// Everyone is a cat: front-facing and seated when at a station, side-on and running when moving.

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Coat colors. F fur, S markings (ticking / stripes), A ears, T tail, C chest + belly, U muzzle,
// P paws, N nose, E eyes, R long-hair ruff (only fluffy breeds; transparent otherwise).
const coat = (F, S, A, T, C, U, P, N, E, R = null) => ({ F, S, A, T, C, U, P, N, E, R });

// Model family → breed, roughly by how often the breed tops "smartest cat" lists
// (Abyssinian, Siamese first; Russian Blue mid-list; the placid Persian rarely appears).
// Each breed has a few color variants so sessions of the same family still differ.
export const FAMILIES = {
  fable: {
    label: 'Fable', title: '수석', breed: '아비시니안', tier: 4, monitor: 'wide-gold',
    coats: [
      coat('#c0703a', '#7a3f1d', '#8a4a24', '#8a4a24', '#e8b98a', '#f0d2b0', '#9a5228', '#c0505a', '#9bc53d'), // ruddy
      coat('#d1a27a', '#9a6a45', '#a8784f', '#a8784f', '#f1d9bd', '#f6e4cf', '#a8784f', '#c56a72', '#d4a72c'), // fawn
      coat('#8f8a9a', '#5d5868', '#6f6a7a', '#6f6a7a', '#d8c7b4', '#e6d9cc', '#6f6a7a', '#b8737e', '#d4a72c'), // blue
    ],
  },
  opus: {
    label: 'Opus', title: '선임', breed: '샴', tier: 3, monitor: 'silver',
    coats: [
      coat('#efe3cc', '#efe3cc', '#4a3426', '#4a3426', '#f7efe0', '#4a3426', '#4a3426', '#2a1d16', '#4aa3ff'), // seal point
      coat('#eceff2', '#eceff2', '#6b7a90', '#6b7a90', '#f7f8fa', '#6b7a90', '#6b7a90', '#4a5568', '#4aa3ff'), // blue point
      coat('#f6f1ee', '#f6f1ee', '#9a8a96', '#9a8a96', '#fbf8f6', '#9a8a96', '#9a8a96', '#7d6b78', '#6cb8ff'), // lilac point
    ],
  },
  sonnet: {
    label: 'Sonnet', title: '사원', breed: '러시안블루', tier: 2, monitor: 'normal',
    coats: [
      coat('#7d8a9c', '#7d8a9c', '#6c7889', '#7d8a9c', '#8f9bad', '#8f9bad', '#6c7889', '#5b6b80', '#5fd36a'),
      coat('#6f7c8f', '#6f7c8f', '#5f6b7c', '#6f7c8f', '#818ea1', '#818ea1', '#5f6b7c', '#4f5f74', '#7be07f'),
    ],
  },
  haiku: {
    label: 'Haiku', title: '인턴', breed: '페르시안', tier: 1, monitor: 'laptop',
    coats: [
      coat('#f6f3ee', '#f6f3ee', '#e6ded1', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#f2a0b0', '#e0892c', '#ece6dc'), // white, copper eyes
      coat('#f1dcb8', '#f1dcb8', '#e2c79c', '#f6e6c8', '#fbf0dc', '#fbf0dc', '#fbf0dc', '#e8949f', '#e0892c', '#e9d2aa'), // cream
      coat('#d9dde3', '#b9bec7', '#c3c8d0', '#e6e9ee', '#f2f4f7', '#f2f4f7', '#f2f4f7', '#e8949f', '#4fb36a', '#cfd4db'), // silver chinchilla
    ],
  },
  other: {
    label: '기타', title: '', breed: '코숏', tier: 0, monitor: 'normal',
    coats: [
      coat('#e8913a', '#b8601c', '#c56f24', '#c56f24', '#fde7c8', '#fde7c8', '#fde7c8', '#f28b9a', '#1a1a2e'), // orange tabby
      coat('#9aa3ad', '#5f6873', '#6b7480', '#6b7480', '#eef1f4', '#eef1f4', '#eef1f4', '#e88a9a', '#1a1a2e'), // grey tabby
      coat('#2b2b35', '#2b2b35', '#1b1b22', '#1b1b22', '#f4f4f4', '#f4f4f4', '#f4f4f4', '#f29aaa', '#9be15d'), // tuxedo
      coat('#2b2b35', '#2b2b35', '#1b1b22', '#1b1b22', '#2b2b35', '#2b2b35', '#2b2b35', '#d9768a', '#d4e84a'), // black
      coat('#f4f1ea', '#e8913a', '#2b2b35', '#2b2b35', '#ffffff', '#ffffff', '#ffffff', '#f4a3b4', '#1a1a2e'), // calico
    ],
  },
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
  const fam = familyOf(model);
  return coatPalette(fam, (hashStr(id) >>> 4) % FAMILIES[fam].coats.length, kind);
}
/** Palette for one specific coat variant of a family. */
export function coatPalette(fam, variant, kind = 'employee') {
  return { fam, variant, kind, ...FAMILIES[fam].coats[variant], W: '#fdfdfd', L: '#c8d0d8', D: '#111' };
}

// Adult cat. Seated poses are 8×10 facing the viewer; `walk` is a 12×8 side-on run cycle
// facing right (the renderer mirrors it when heading left); `sit` is a 11×6 loaf for the lounge.
const E = {
  idle: [[
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FPFFPFT',
  ], [
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFFT', '.FFCCFFT', '.FFCCFFT', '.FPFFPF.',
  ]],
  walk: [[
    '.........A.A', 'T........FFF', 'T.......FFEF', '.TFSFSFFFFUN', '..FFFFFFFFU.', '..FCCCCCFF..', '...FF..FF...', '...PP..PP...',
  ], [
    '.........A.A', '.........FFF', 'TT......FFEF', '..TSFSFFFFUN', '..FFFFFFFFU.', '..FCCCCCFF..', '.FF.....FF..', 'P.........PP',
  ], [
    '.........A.A', 'T........FFF', 'T.......FFEF', '.TFSFSFFFFUN', '..FFFFFFFFU.', '..FCCCCCFF..', '..F.F..F.F..', '..P.P..P.P..',
  ]],
  type: [[
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFF.', '.FPCCFF.', '.FFCCFFT', '.F.FFPFT',
  ], [
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFF.', '.FFCCPF.', '.FFCCFFT', '.FPFF.FT',
  ]],
  read: [[
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFF.', 'PWWLWWWP', '.WWWWWWT', '.FPFFPFT',
  ], [
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FEFFEF.', 'RFUNNUFR', '.RFCCFR.', '.FFCCFF.', 'PWWWLWWP', '.WWWWWWT', '.FPFFPFT',
  ]],
  wait: [[
    '.A....AP', '.AA..AAF', '.FFSSFFF', '.FEFFEFF', 'RFUNNUF.', '.RFCCFF.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FP.FPFT',
  ], [
    '.A....A.', '.AA..AAP', '.FFSSFFF', '.FEFFEFF', 'RFUNNUF.', '.RFCCFF.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FP.FPFT',
  ]],
  phone: [[
    '.A....A.', '.AA..AA.', '.FFSSFFD', '.FEFFEFD', 'RFUNNUFP', '.RFCCFF.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FP.FPFT',
  ]],
  write: [[
    '.A....AD', '.AA..AAP', '.FFSSFFF', '.FEFFEFF', 'RFUNNUF.', '.RFCCFF.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FP.FPFT',
  ], [
    '.A....A.', '.AA..AAD', '.FFSSFFP', '.FEFFEFF', 'RFUNNUF.', '.RFCCFF.', '.FFCCFF.', '.FFCCFF.', '.FFCCFFT', '.FP.FPFT',
  ]],
  sit: [[
    '........A.A', '........FFF', '..FSFSFFFEF', '.FFFFFFFFUN', 'TFFFFFFFFCC', '.TTTTTTPP..',
  ]],
  // seen from behind (seated facing a desk or table): no face, stripes down the back, tail out to the side
  back: [[
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FFSSFF.', 'RFFFFFFR', '.RFSSFR.', '.FFSSFF.', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ], [
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FFSSFF.', 'RFFFFFFR', '.RFSSFR.', '.FFSSFF.', '.FFFFFF.', 'T.FFFFF.', '.TFFFFF.',
  ]],
  backType: [[
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FFSSFF.', 'RFFFFFFR', '.RFSSFR.', 'PFFSSFF.', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ], [
    '.A....A.', '.AA..AA.', '.FFSSFF.', '.FFSSFF.', 'RFFFFFFR', '.RFSSFR.', '.FFSSFFP', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ]],
  backWait: [[
    '.A....AP', '.AA..AAF', '.FFSSFFF', '.FFSSFFF', 'RFFFFFF.', '.RFSSFF.', '.FFSSFF.', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ], [
    '.A....A.', '.AA..AAP', '.FFSSFFF', '.FFSSFFF', 'RFFFFFF.', '.RFSSFF.', '.FFSSFF.', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ]],
  backPhone: [[
    '.A....A.', '.AA..AA.', '.FFSSFFD', '.FFSSFFD', 'RFFFFFFP', '.RFSSFF.', '.FFSSFF.', '.FFFFFF.', '.FFFFFF.', 'TTFFFFF.',
  ]],
  // seated in profile facing right (flipped for the left-facing chair): head and paws toward the desk, tail behind
  side: [[
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCC.', '..FFFFCC.', 'T.FFFFFF.', 'TTFFFFPP.',
  ], [
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCC.', '..FFFFCC.', '.TFFFFFF.', 'TTFFFFPP.',
  ]],
  sideType: [[
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCCP', '..FFFFCC.', 'T.FFFFFF.', 'TTFFFFFP.',
  ], [
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCC.', '..FFFFCCP', 'T.FFFFFF.', 'TTFFFFPF.',
  ]],
  sideRead: [[
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCCW', '..SFFFCPW', '..FFFFCCL', 'T.FFFFFF.', 'TTFFFFPP.',
  ], [
    '.....A.A.', '.....FAF.', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCCL', '..SFFFCPW', '..FFFFCCW', 'T.FFFFFF.', 'TTFFFFPP.',
  ]],
  sideWait: [[
    '.....A.AP', '.....FAFF', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCC.', '..FFFFCC.', 'T.FFFFFF.', 'TTFFFFFP.',
  ], [
    '.....A.A.', '.....FAFP', '....FFFFF', '....FFFEF', '....FFFUN', '...SFFCC.', '..SFFFCC.', '..FFFFCC.', 'T.FFFFFF.', 'TTFFFFFP.',
  ]],
  sidePhone: [[ // handset on the cheek, paw holding it, eye still showing
    '.....A.A.', '.....FAF.', '....FFDFF', '....FFDEF', '....FFPUN', '...SFPCC.', '..SFFFCC.', '..FFFFCC.', 'T.FFFFFF.', 'TTFFFFFP.',
  ], [
    '.....A.A.', '.....FAF.', '....FFDFF', '....FFDEF', '....FFPUN', '...SFPCC.', '..SFFFCC.', '..FFFFCC.', '.TFFFFFF.', 'TTFFFFFP.',
  ]],
};

// Kitten (subagent): seated 6×8, running 9×6.
const A = {
  idle: [[
    'A....A', 'AFSSFA', 'FEFFEF', 'FUNNUF', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ], [
    'A....A', 'AFSSFA', 'FEFFEF', 'FUNNUF', '.FCCFT', '.FCCFT', '.FCCF.', '.PFFP.',
  ]],
  walk: [[
    '......A.A', 'T.....FFF', '.T....FEF', '..FSFSFUN', '..FCCCFF.', '..PP.PP..',
  ], [
    '......A.A', 'T.....FFF', 'T.....FEF', '.TFSFSFUN', '..FCCCFF.', '.P....P.P',
  ]],
  type: [[
    'A....A', 'AFSSFA', 'FEFFEF', 'FUNNUF', '.FCCF.', '.PCCF.', '.FCCFT', '.FFFP.',
  ], [
    'A....A', 'AFSSFA', 'FEFFEF', 'FUNNUF', '.FCCF.', '.FCCP.', '.FCCFT', '.PFFF.',
  ]],
  read: [[
    'A....A', 'AFSSFA', 'FEFFEF', 'FUNNUF', '.FCCF.', 'PWWLWP', '.WWWWT', '.PFFP.',
  ]],
  wait: [[
    'A....AP', 'AFSSFAF', 'FEFFEFF', 'FUNNUF.', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ], [
    'A....A.', 'AFSSFAP', 'FEFFEFF', 'FUNNUF.', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ]],
  phone: [[
    'A....A', 'AFSSFD', 'FEFFED', 'FUNNUP', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ]],
  write: [[
    'A....AD', 'AFSSFAP', 'FEFFEFF', 'FUNNUF.', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ], [
    'A....A.', 'AFSSFAD', 'FEFFEFP', 'FUNNUF.', '.FCCF.', '.FCCFT', '.FCCFT', '.PFFP.',
  ]],
  sit: [[
    '......A.A', '......FFF', '.FSFSFFEF', 'TFFFFFFUN', '.TTTTPP..',
  ]],
  back: [[
    'A....A', 'AFSSFA', 'FFSSFF', 'FFFFFF', '.FSSF.', '.FFFF.', '.FFFF.', 'TFFFF.',
  ]],
  backType: [[
    'A....A', 'AFSSFA', 'FFSSFF', 'FFFFFF', '.FSSF.', 'PFFFF.', '.FFFF.', 'TFFFF.',
  ], [
    'A....A', 'AFSSFA', 'FFSSFF', 'FFFFFF', '.FSSF.', '.FFFFP', '.FFFF.', 'TFFFF.',
  ]],
};

E.bat = [E.idle[0], E.wait[0]]; // paw down, paw up: batting at a toy
// up on its hind legs facing right, front paws on a scratching post at the right edge, raking down
E.scratch = [[
  '....A.A...', '....FFF...', '...FFEF...', '...FFFUN..', '..SFFFFFFP', '..SFFCC...',
  '..FFFCC...', '..FFFCFFFP', '..FFFFF...', '..FF.FF...', '.TPP.PP...', 'TT........',
], [
  '....A.A...', '....FFF...', '...FFEF...', '...FFFUN..', '..SFFFF...', '..SFFCFFFP',
  '..FFFCC...', '..FFFCC...', '..FFFFFFFP', '..FF.FF...', '.TPP.PP...', 'TT........',
]];

export const SHEETS = { employee: E, assistant: A };

const cache = new Map();

/** Returns an OffscreenCanvas with the frame rasterized in the given palette. */
export function sprite(pal, anim, frame) {
  const sheet = SHEETS[pal.kind] || E;
  const frames = sheet[anim] || sheet.idle;
  const rows = frames[frame % frames.length];
  const key = `${pal.kind}|${pal.fam}|${pal.variant}|${anim}|${frame % frames.length}`;
  let c = cache.get(key);
  if (c) return c;
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const color = pal[rows[y][x]];
      if (!color) continue; // '.' and absent features (e.g. no ruff on short-haired breeds)
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

const outlines = new WeakMap(); // sprite canvas -> Map(color -> canvas)

export const OUTLINE_W = 2;

/** An OUTLINE_W-px outline hugging the sprite's opaque pixels, on a canvas OUTLINE_W larger each way. */
export function outline(img, color) {
  let byColor = outlines.get(img);
  if (!byColor) outlines.set(img, byColor = new Map());
  let c = byColor.get(color);
  if (c) return c;
  const r = OUTLINE_W;
  c = new OffscreenCanvas(img.width + r * 2, img.height + r * 2);
  const g = c.getContext('2d');
  // stamp the sprite at every offset within a rounded radius, so corners don't go square
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r + 1) g.drawImage(img, r + dx, r + dy);
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(img, r, r);
  byColor.set(color, c);
  return c;
}

const BACK = { idle: 'back', type: 'backType', read: 'back', write: 'back', wait: 'backWait', phone: 'backPhone' };
/** The seen-from-behind variant of a seated animation, if the sheet has one (kittens only have back / backType). */
export function backAnim(kind, anim) {
  const b = BACK[anim];
  const sheet = SHEETS[kind] || E;
  return b && sheet[b] ? b : sheet.back ? 'back' : anim;
}

const SIDE = { idle: 'side', type: 'sideType', read: 'sideRead', write: 'side', wait: 'sideWait', phone: 'sidePhone' };
/** The seated-in-profile variant (facing right) of an animation, if the sheet has one. */
export function sideAnim(kind, anim) {
  const s = SIDE[anim];
  return s && (SHEETS[kind] || E)[s] ? s : anim;
}

/** The lobby's resident receptionist: a Bengal (gold, dark markings), a coat no model family uses. */
export const RECEPTIONIST_PAL = {
  fam: 'reception', variant: 0, kind: 'employee', W: '#fdfdfd', L: '#c8d0d8', D: '#111',
  F: '#d9a441', S: '#5a3a1a', A: '#7a4a1e', T: '#7a4a1e', C: '#f3dfb0', U: '#f3dfb0', P: '#5a3a1a', N: '#c0505a', E: '#4fb06b', R: null,
};

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
    case 'check': { // acceptEdits
      g.fillStyle = '#22c55e';
      g.fillRect(x, y + 2, 1, 1); g.fillRect(x + 1, y + 3, 1, 1); g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + 3, y + 1, 1, 1); g.fillRect(x + 4, y, 1, 1);
      break;
    }
    case 'term': { // shell running: tiny terminal window with a prompt and blinking cursor
      g.fillStyle = '#5dff7a'; g.fillRect(x, y, 9, 6);
      g.fillStyle = '#0a120a'; g.fillRect(x + 1, y + 1, 7, 4);
      g.fillStyle = '#5dff7a';
      g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + 3, y + 3, 1, 1); g.fillRect(x + 2, y + 4, 1, 1); // '>'
      if (Math.floor(t / 400) % 2) g.fillRect(x + 5, y + 3, 2, 1); // '_'
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
