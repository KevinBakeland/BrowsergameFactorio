'use strict';

// Deterministische wereldgeneratie voor Fabriek.io (fase 1).
// De wereld bestaat uit een raster van tegels: gras, water en erts-velden
// (kolen, ijzererts, kopererts, steen). Elke ertsteegel heeft 1 eenheid
// die gevangen (gemined) kan worden door er op/naast te staan.

const MAP_W = 60;
const MAP_H = 45;
const TILE_ORE = 100; // eenheden per tegel — een ertsveld van bv. 4 tegels = 400 eenheden

// tegelcodes
const T = { GRASS: 0, WATER: 1, COAL: 2, IRON: 3, COPPER: 4, STONE: 5 };

const RES = {
  coal:   { code: T.COAL,   name: 'Kolen',     color: '#4a4a4a', dark: '#232323', light: '#787878' },
  iron:   { code: T.IRON,   name: 'IJzererts', color: '#96502c', dark: '#5e3018', light: '#cf8352' },
  copper: { code: T.COPPER, name: 'Kopererts', color: '#3f9b9b', dark: '#256e6e', light: '#84d8d8' },
  stone:  { code: T.STONE,  name: 'Steen',     color: '#9a9a92', dark: '#6f6f68', light: '#d0d0c6' },
  // smelt-producten (geen tegel; bestaan alleen als item in buffers/kisten)
  copper_ingot: { code: null, name: 'Koperen staaf', color: '#e08a4a', dark: '#8a4a24', light: '#ffb37a' },
  iron_ingot:   { code: null, name: 'IJzeren staaf', color: '#c0c0cc', dark: '#6f6f78', light: '#f0f0f5' },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministische hash naar [0,1) voor per-tegel detail
function hash01(n) {
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function hash2(ix, iy) {
  return hash01((ix * 73856093) ^ (iy * 19349663));
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves) {
  let value = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * freq, y * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return value / norm; // ~0..1
}

function generateWorld(seed) {
  const rand = mulberry32(seed);
  const tiles = new Array(MAP_W * MAP_H).fill(T.GRASS);
  const amount = new Float32Array(MAP_W * MAP_H); // overgebleven erts per tegel

  // 1) water via fractal noise
  const ox = rand() * 1000, oy = rand() * 1000;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = fbm((x + ox) * 0.08, (y + oy) * 0.08, 4);
      if (n < 0.36) tiles[y * MAP_W + x] = T.WATER;
    }
  }

  // 2) zoek een droge spawnteegel bij het midden
  const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
  let spawn = null;
  outer:
  for (let r = 0; r < Math.max(MAP_W, MAP_H); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2) continue;
        if (tiles[y * MAP_W + x] === T.GRASS) { spawn = { x, y }; break outer; }
      }
    }
  }
  if (!spawn) spawn = { x: cx, y: cy };

  // 3) resource-velden: per resource enkele golvende "bulten"
  //    alleen resources met een tegel-code (smelt-producten zoals ingots komen
  //    niet in de wereld; die bestaan alleen als item).
  const fields = [];
  const resIds = Object.keys(RES).filter((id) => RES[id].code != null);
  for (const id of resIds) {
    const count = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      fields.push({
        id,
        cx: rand() * MAP_W,
        cy: rand() * MAP_H,
        r: 2.5 + rand() * 4.5,
      });
    }
  }

  // 4) gegarandeerd start-erts rond de spawnteegel (één per resource, diagonaal op ~7 tegels)
  const angs = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  for (let i = 0; i < 4; i++) {
    fields.push({
      id: resIds[i],
      cx: spawn.x + Math.cos(angs[i]) * 7,
      cy: spawn.y + Math.sin(angs[i]) * 7,
      r: 3.2,
    });
  }

  // 5) pas de velden toe (water wint van erts)
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const idx = y * MAP_W + x;
      if (tiles[idx] === T.WATER) { amount[idx] = 0; continue; }
      let best = null, bestV = 0.5;
      for (const f of fields) {
        const d = Math.hypot(x - f.cx, y - f.cy);
        if (d >= f.r) continue;
        let v = 1 - d / f.r;
        v = v * v;
        const jitter = valueNoise(x * 0.6 + f.cx * 3.1, y * 0.6 + f.cy * 3.7);
        v *= 0.55 + 0.9 * jitter;
        if (v > bestV) { bestV = v; best = f.id; }
      }
      if (best) {
        tiles[idx] = RES[best].code;
        amount[idx] = 1;
      }
    }
  }

  // 6) aaneengesloten ertsteegels groeperen in "velden" (patches).
  //    Een veld is één geheel: samen leeggekoald en samen verdwenen.
  const codeToRes = {};
  for (const id of Object.keys(RES)) codeToRes[RES[id].code] = id;
  const patchOf = new Int32Array(MAP_W * MAP_H).fill(-1);
  const patches = [];
  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start] <= 1 || patchOf[start] !== -1) continue;
    const code = tiles[start];
    const res = codeToRes[code];
    const pid = patches.length;
    const idxs = [];
    const stack = [start];
    patchOf[start] = pid;
    while (stack.length) {
      const cur = stack.pop();
      idxs.push(cur);
      const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (tiles[ni] === code && patchOf[ni] === -1) { patchOf[ni] = pid; stack.push(ni); }
      }
    }
    const total = idxs.length * TILE_ORE;
    patches.push({ res, idxs, total, max: total });
  }

  return {
    seed,
    w: MAP_W,
    h: MAP_H,
    tiles,
    amount,
    spawn,
    patchOf,
    patches,
  };
}

module.exports = { generateWorld, MAP_W, MAP_H, T, RES, RES_COUNT: 4 };
