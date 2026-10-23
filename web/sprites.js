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

// Breeds and their coat variants (sessions of the same model still differ by variant).
// Long-haired breeds set R, the neck ruff.
export const BREEDS = {
  abyssinian: { name: '아비시니안', shape: { ears: 'big', build: 'slim' }, coats: [
    coat('#c0703a', '#7a3f1d', '#8a4a24', '#8a4a24', '#e8b98a', '#f0d2b0', '#9a5228', '#c0505a', '#9bc53d'), // ruddy
    coat('#d1a27a', '#9a6a45', '#a8784f', '#a8784f', '#f1d9bd', '#f6e4cf', '#a8784f', '#c56a72', '#d4a72c'), // fawn
    coat('#8f8a9a', '#5d5868', '#6f6a7a', '#6f6a7a', '#d8c7b4', '#e6d9cc', '#6f6a7a', '#b8737e', '#d4a72c'), // blue
  ] },
  siamese: { name: '샴', shape: { ears: 'big', build: 'slim' }, coats: [
    coat('#efe3cc', '#efe3cc', '#4a3426', '#4a3426', '#f7efe0', '#4a3426', '#4a3426', '#2a1d16', '#4aa3ff'), // seal point
    coat('#eceff2', '#eceff2', '#6b7a90', '#6b7a90', '#f7f8fa', '#6b7a90', '#6b7a90', '#4a5568', '#4aa3ff'), // blue point
    coat('#f6f1ee', '#f6f1ee', '#9a8a96', '#9a8a96', '#fbf8f6', '#9a8a96', '#9a8a96', '#7d6b78', '#6cb8ff'), // lilac point
  ] },
  russianblue: { name: '러시안블루', shape: {}, coats: [
    coat('#7d8a9c', '#7d8a9c', '#6c7889', '#7d8a9c', '#8f9bad', '#8f9bad', '#6c7889', '#5b6b80', '#5fd36a'),
    coat('#6f7c8f', '#6f7c8f', '#5f6b7c', '#6f7c8f', '#818ea1', '#818ea1', '#5f6b7c', '#4f5f74', '#7be07f'),
  ] },
  persian: { name: '페르시안', shape: { ears: 'small', build: 'cobby' }, coats: [
    coat('#f6f3ee', '#f6f3ee', '#e6ded1', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#f2a0b0', '#e0892c', '#ece6dc'), // white, copper eyes
    coat('#f1dcb8', '#f1dcb8', '#e2c79c', '#f6e6c8', '#fbf0dc', '#fbf0dc', '#fbf0dc', '#e8949f', '#e0892c', '#e9d2aa'), // cream
    coat('#d9dde3', '#b9bec7', '#c3c8d0', '#e6e9ee', '#f2f4f7', '#f2f4f7', '#f2f4f7', '#e8949f', '#4fb36a', '#cfd4db'), // silver chinchilla
  ] },
  koshort: { name: '코숏', shape: {}, coats: [
    coat('#e8913a', '#b8601c', '#c56f24', '#c56f24', '#fde7c8', '#fde7c8', '#fde7c8', '#f28b9a', '#1a1a2e'), // orange tabby
    coat('#9aa3ad', '#5f6873', '#6b7480', '#6b7480', '#eef1f4', '#eef1f4', '#eef1f4', '#e88a9a', '#1a1a2e'), // grey tabby
    coat('#2b2b35', '#2b2b35', '#1b1b22', '#1b1b22', '#f4f4f4', '#f4f4f4', '#f4f4f4', '#f29aaa', '#9be15d'), // tuxedo
    coat('#2b2b35', '#2b2b35', '#1b1b22', '#1b1b22', '#2b2b35', '#2b2b35', '#2b2b35', '#d9768a', '#d4e84a'), // black
    coat('#f4f1ea', '#e8913a', '#2b2b35', '#2b2b35', '#ffffff', '#ffffff', '#ffffff', '#f4a3b4', '#1a1a2e'), // calico
  ] },
  bengal: { name: '벵갈', shape: { build: 'slim' }, coats: [
    coat('#d9a441', '#5a3a1a', '#7a4a1e', '#7a4a1e', '#f3dfb0', '#f3dfb0', '#5a3a1a', '#c0505a', '#4fb06b'), // brown spotted
    coat('#efe9df', '#9a8a78', '#b8a894', '#b8a894', '#fbf8f2', '#fbf8f2', '#b8a894', '#d9a0a8', '#5fa8e8'), // snow
  ] },
  ragdoll: { name: '랙돌', shape: { build: 'large' }, coats: [
    coat('#efe6d8', '#efe6d8', '#5a4334', '#5a4334', '#ffffff', '#5a4334', '#ffffff', '#3a2a20', '#3f8fe8', '#f6efe4'), // seal mitted
    coat('#e9ecf0', '#e9ecf0', '#7a8798', '#7a8798', '#ffffff', '#ffffff', '#ffffff', '#e8a0b0', '#3f8fe8', '#f2f4f7'), // blue bicolor
  ] },
  mainecoon: { name: '메인쿤', shape: { ears: 'tufted', build: 'large' }, coats: [
    coat('#8a6a48', '#3e2c1c', '#5a4330', '#5a4330', '#d9c3a0', '#e8d6b8', '#d9c3a0', '#b0605a', '#d4a72c', '#b89a76'), // brown tabby
    coat('#c8743a', '#8a4519', '#a05a28', '#a05a28', '#f2d1a8', '#f2d1a8', '#f2d1a8', '#d07a70', '#d4a72c', '#e0a06a'), // red
  ] },
  british: { name: '브리티시 숏헤어', shape: { ears: 'small', build: 'cobby' }, coats: [
    coat('#7f8894', '#7f8894', '#6c7480', '#7f8894', '#8e97a3', '#9aa3ae', '#6c7480', '#56606c', '#e8a33a'), // blue
    coat('#b9a9b0', '#b9a9b0', '#a3939a', '#b9a9b0', '#c8babf', '#d2c6ca', '#a3939a', '#9a7d88', '#e8a33a'), // lilac
  ] },
  sphynx: { name: '스핑크스', shape: { ears: 'big', build: 'slim' }, coats: [
    coat('#e8c0b0', '#d9a898', '#d9a0a0', '#e8c0b0', '#f2d4c8', '#f2d4c8', '#e8b0a8', '#d08090', '#7ac87a'), // pink
    coat('#b8adab', '#9a8f8d', '#a89a98', '#b8adab', '#d6cdcb', '#d6cdcb', '#a89a98', '#c08088', '#e8c84a'), // grey
  ] },
  norwegian: { name: '노르웨이 숲', shape: { ears: 'tufted', build: 'large' }, coats: [
    coat('#a8adb3', '#4a4f56', '#6a7078', '#6a7078', '#eef0f2', '#eef0f2', '#eef0f2', '#c08090', '#9bc53d', '#d8dce0'), // silver tabby
    coat('#7a5a3a', '#3a2818', '#4e3826', '#4e3826', '#e8d8c0', '#e8d8c0', '#e8d8c0', '#a8605a', '#9bc53d', '#a88a68'), // brown tabby
  ] },
  bombay: { name: '봄베이', shape: {}, coats: [
    coat('#1d1d24', '#1d1d24', '#141419', '#141419', '#26262e', '#26262e', '#1d1d24', '#3a3a44', '#e8a33a'),
  ] },
  turkishangora: { name: '터키시 앙고라', shape: { ears: 'big', build: 'slim' }, coats: [
    coat('#fbfbfb', '#fbfbfb', '#f0d8d8', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#f4a8b8', '#5aa8f0', '#f0f0f0'),
  ] },
  scottishfold: { name: '스코티시 폴드', shape: { ears: 'fold', build: 'cobby' }, coats: [
    coat('#c9ccd2', '#7c8089', '#9a9ea6', '#9a9ea6', '#eceef1', '#eceef1', '#eceef1', '#d08a98', '#d4a72c'), // silver tabby
    coat('#efd9b4', '#d1a971', '#e0c08c', '#e0c08c', '#fbf1de', '#fbf1de', '#fbf1de', '#e0949f', '#d4a72c'), // cream
  ] },
  munchkin: { name: '먼치킨', shape: { build: 'short' }, coats: [
    coat('#f2efe8', '#e08a3a', '#d07a30', '#d07a30', '#ffffff', '#ffffff', '#ffffff', '#f4a3b4', '#4fb06b'), // white & orange
    coat('#a7a9ad', '#5e6167', '#7c7f85', '#7c7f85', '#eef0f2', '#eef0f2', '#eef0f2', '#d08a98', '#9bc53d'), // grey tabby
  ] },
};

/*
 * Body shape, applied to every frame's string art when it is rasterized, so all poses agree.
 *   ears:  'big' taller (+1 row) · 'small' shorter (−1 row) · 'fold' folded forward · 'tufted' dark lynx tips (+1 row)
 *   build: 'slim' rangy (+1 body row) · 'cobby' round (+1 column, −1 body row) · 'large' (+1 column, +1 body row)
 *          · 'short' short legs (−1 leg row)
 */
const SIDE_ON = /^(walk|sit|scratch|side)/; // sprites drawn in profile, head to the right
function shapeRows(rows, shape, anim) {
  if (!shape || (!shape.ears && !shape.build)) return rows;
  let r = rows.slice();
  if (shape.ears === 'big') r.unshift(r[0]);
  else if (shape.ears === 'tufted') r.unshift(r[0].replace(/A/g, 'S'));
  else if (shape.ears === 'small') r.shift();
  else if (shape.ears === 'fold') { const top = r.shift(); r[0] = [...r[0]].map((c, i) => (c === 'A' && top[i] === 'A' ? '.' : c)).join(''); }
  const body = Math.floor(r.length * 0.6);
  if (shape.build === 'slim' || shape.build === 'large') r.splice(body, 0, r[body]);
  if (shape.build === 'cobby') r.splice(body, 1);
  if (shape.build === 'short') r.splice(r.length - 2, 1);
  if (shape.build === 'cobby' || shape.build === 'large') { // widen through the middle of the body
    const w = Math.max(...r.map((x) => x.length));
    const col = SIDE_ON.test(anim) ? Math.floor(w * 0.4) : Math.floor(w / 2) - 1;
    r = r.map((x) => (x.length > col ? x.slice(0, col + 1) + x.slice(col) : x));
  }
  return r;
}

// Model family → default breed, roughly by how often the breed tops "smartest cat" lists
// (Abyssinian, Siamese first; Russian Blue mid-list; the placid Persian rarely appears). The user can pick others.
export const FAMILIES = {
  fable: { label: 'Fable', title: '수석', breed: 'abyssinian', tier: 4, monitor: 'wide-gold' },
  opus: { label: 'Opus', title: '선임', breed: 'siamese', tier: 3, monitor: 'silver' },
  sonnet: { label: 'Sonnet', title: '사원', breed: 'russianblue', tier: 2, monitor: 'normal' },
  haiku: { label: 'Haiku', title: '인턴', breed: 'persian', tier: 1, monitor: 'laptop' },
  other: { label: '기타', title: '', breed: 'koshort', tier: 0, monitor: 'normal' },
};

let chosen = {}; // family -> breed key, set by the user (server-persisted, see office.js)
export function setBreedChoices(map) { chosen = { ...(map || {}) }; }
/** What the user picked for a family (a skin may still be loading), or the default breed. */
export function choiceOf(fam) { return chosen[fam] || FAMILIES[fam].breed; }
/** The breed a model family's cats are drawn as: the user's pick if it's a known breed or a loaded skin, else the default. */
export function breedOf(fam) {
  const k = chosen[fam];
  return BREEDS[k] || skins.get(skinId(k))?.rows ? k : FAMILIES[fam].breed;
}
const skinId = (k) => (typeof k === 'string' && k.startsWith('skin:') ? k.slice(5) : null);

export function familyOf(model) {
  const m = String(model || '').toLowerCase();
  if (/fable|mythos/.test(m)) return 'fable';
  if (/opus/.test(m)) return 'opus';
  if (/sonnet/.test(m)) return 'sonnet';
  if (/haiku/.test(m)) return 'haiku';
  return 'other';
}

export function paletteFor(id, kind = 'employee', model = null) {
  const fam = familyOf(model), breed = breedOf(fam);
  return breedPalette(breed, (hashStr(id) >>> 4) % (BREEDS[breed]?.coats.length || 1), kind, fam);
}
/** Palette for one specific coat variant of a breed (a skin has just the one look). */
export function breedPalette(breed, variant, kind = 'employee', fam = null) {
  const sid = skinId(breed);
  if (sid) return { fam, breed, skin: sid, variant: 0, kind };
  return { fam, breed, variant, kind, shape: BREEDS[breed].shape, ...BREEDS[breed].coats[variant], W: '#fdfdfd', L: '#c8d0d8', D: '#111' };
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
  if (pal.skin) return skinSprite(pal, anim, frame);
  anim = anim.replace(/^(back|side):/, ''); // a skin's pose name, drawn as a cat while the skin is gone
  const sheet = SHEETS[pal.kind] || E;
  const frames = sheet[anim] || sheet.idle;
  const key = `${pal.kind}|${pal.breed || pal.fam}|${pal.variant}|${anim}|${frame % frames.length}`;
  let c = cache.get(key);
  if (c) return c;
  const rows = shapeRows(frames[frame % frames.length], pal.shape, anim);
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

/**
 * An OUTLINE_W-px outline (world pixels) hugging the sprite's opaque pixels, on a canvas that much larger each way.
 * It shares the sprite's scale, so size both with spriteSize.
 */
export function outline(img, color) {
  let byColor = outlines.get(img);
  if (!byColor) outlines.set(img, byColor = new Map());
  let c = byColor.get(color);
  if (c) return c;
  const r = Math.max(1, Math.round(OUTLINE_W * (img.scale || 1)));
  c = new OffscreenCanvas(img.width + r * 2, img.height + r * 2);
  c.scale = img.scale;
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
export function backAnim(pal, anim) {
  if (pal.skin) return `back:${anim}`;
  const b = BACK[anim];
  const sheet = SHEETS[pal.kind] || E;
  return b && sheet[b] ? b : sheet.back ? 'back' : anim;
}

const SIDE = { idle: 'side', type: 'sideType', read: 'sideRead', write: 'side', wait: 'sideWait', phone: 'sidePhone' };
/** The seated-in-profile variant (facing right) of an animation, if the sheet has one. */
export function sideAnim(pal, anim) {
  if (pal.skin) return `side:${anim}`;
  const s = SIDE[anim];
  return s && (SHEETS[pal.kind] || E)[s] ? s : anim;
}

// ---- uploaded skins -------------------------------------------------------------------
// A skin is a PNG sheet of equal cells: one row per animation in SKIN_ROWS order, frames left to right up to the
// first empty (fully transparent) cell. Missing rows borrow a close pose (skinFrames). Frames are trimmed to one box
// shared by the whole sheet, so feet and centers line up across poses, and drawn SKIN_H world pixels tall.
export const SKIN_ROWS = ['idle', 'walk', 'type', 'read', 'wait', 'phone', 'write', 'sit', 'back', 'side', 'scratch', 'bat'];
export const SKIN_ROW_LABEL = {
  idle: '앉아 있기 (정면)', walk: '걷기 (오른쪽을 보고)', type: '타이핑', read: '책 읽기', wait: '손 들기', phone: '전화',
  write: '화이트보드에 쓰기', sit: '엎드리기 (라운지·낮잠)', back: '뒷모습 (회의 테이블·책상)', side: '옆으로 앉기 (오른쪽을 보고)',
  scratch: '스크래처 긁기', bat: '털실 치기',
};
const SKIN_FALLBACK = { type: 'idle', read: 'idle', wait: 'idle', phone: 'wait', write: 'wait', sit: 'idle', scratch: 'idle', back: 'idle', side: 'idle' };
const SKIN_H = { employee: 12, assistant: 9 }; // an adult cat is at most 12 rows tall (scratching), a kitten about 9

const skins = new Map(); // id -> { id, name, cellW, cellH, rows: { anim: [canvas] } once loaded, failed }
let onSkinsLoaded = () => {};
/** fn() runs whenever a skin finishes loading (or fails), so cats can switch over to it. */
export function onSkinLoad(fn) { onSkinsLoaded = fn; }
/** The server's skin list (snapshot or a 'settings' push): load new sheets, forget deleted ones. */
export function setSkins(list) {
  const keep = new Set();
  for (const k of list || []) {
    keep.add(k.id);
    if (skins.has(k.id)) { skins.get(k.id).name = k.name; continue; }
    const skin = { ...k, rows: null, failed: false };
    skins.set(k.id, skin);
    loadSkin(skin)
      .then((rows) => { skin.rows = rows; }, (e) => { skin.failed = true; console.warn(`[skin] ${k.name}: ${e.message}`); })
      .finally(() => { if (skins.get(k.id) === skin) onSkinsLoaded(); });
  }
  for (const id of skins.keys()) if (!keep.has(id)) skins.delete(id);
}
export function skinList() { return [...skins.values()]; }

async function loadSkin(skin) {
  const r = await fetch(`/skins/${skin.id}.png`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = sliceSheet(await createImageBitmap(await r.blob()), skin.cellW, skin.cellH);
  if (!rows.idle || !rows.walk) throw new Error('앉아 있기·걷기 줄이 비어 있습니다');
  return rows;
}

/** Cut a sheet into { anim: [frame canvas] }; rows without frames are left out. */
export function sliceSheet(bmp, cw, ch) {
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const cols = Math.floor(bmp.width / cw), nrows = Math.min(SKIN_ROWS.length, Math.floor(bmp.height / ch));
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  const cells = {};
  for (let r = 0; r < nrows; r++) {
    for (let col = 0; col < cols; col++) {
      let any = false;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        if (!px[((r * ch + y) * bmp.width + col * cw + x) * 4 + 3]) continue;
        any = true; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (!any) break;
      (cells[SKIN_ROWS[r]] ||= []).push([col, r]);
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, rows = {};
  for (const [anim, list] of Object.entries(cells)) {
    rows[anim] = list.map(([col, r]) => {
      const f = new OffscreenCanvas(w, h);
      f.getContext('2d').drawImage(c, col * cw + x0, r * ch + y0, w, h, 0, 0, w, h);
      return f;
    });
  }
  return rows;
}

/** Frames for an animation; 'back:type' / 'side:read' are seats facing away / sideways (that row, else the pose itself). */
function skinFrames(rows, anim) {
  const m = /^(back|side):(.+)$/.exec(anim);
  if (m) return rows[m[1]] || skinFrames(rows, m[2]);
  if (rows[anim]) return rows[anim];
  if (anim === 'bat') return [rows.idle[0], rows.wait?.[0] || rows.idle[1] || rows.idle[0]]; // paw down, paw up
  return skinFrames(rows, SKIN_FALLBACK[anim] || 'idle');
}

function skinSprite(pal, anim, frame) {
  const rows = skins.get(pal.skin)?.rows;
  if (!rows) return sprite(breedPalette(FAMILIES[pal.fam || 'other'].breed, 0, pal.kind, pal.fam), anim, frame); // deleted, until re-picked
  const frames = skinFrames(rows, anim), i = frame % frames.length;
  const key = `skin|${pal.skin}|${pal.kind}|${anim}|${i}`;
  let c = cache.get(key);
  if (c) return c;
  const src = frames[i];
  c = new OffscreenCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  c.scale = src.height / (SKIN_H[pal.kind] || SKIN_H.employee); // sheet pixels per world pixel
  cache.set(key, c);
  return c;
}

/** World-pixel size of a sprite: skins are drawn scaled, built-in cats 1:1. */
export function spriteSize(img) { const k = img.scale || 1; return { w: img.width / k, h: img.height / k }; }

/** A sheet to draw over: the plain cat in every SKIN_ROWS pose, 16×16 cells, feet on each cell's bottom edge. */
export function skinTemplate() {
  const C = 16, pal = breedPalette('koshort', 0);
  const cols = Math.max(...SKIN_ROWS.map((a) => E[a].length));
  const c = new OffscreenCanvas(C * cols, C * SKIN_ROWS.length), g = c.getContext('2d');
  SKIN_ROWS.forEach((anim, r) => E[anim].forEach((_, i) => {
    const img = sprite(pal, anim, i);
    g.drawImage(img, i * C + Math.floor((C - img.width) / 2), r * C + C - img.height);
  }));
  return c.convertToBlob({ type: 'image/png' });
}

/** The lobby's resident receptionist: a Bengal (gold, dark markings), a coat no model family uses. */
export const RECEPTIONIST_PAL = {
  fam: 'reception', variant: 0, kind: 'employee', W: '#fdfdfd', L: '#c8d0d8', D: '#111', shape: BREEDS.bengal.shape,
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
