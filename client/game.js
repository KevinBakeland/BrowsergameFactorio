'use strict';

// Fabriek.io — client (fase 1)
// - rendert de wereld (gras/water/erts) op een canvas
// - camera volgt de speler, zoom met de muiswiel
// - WASD/pijltjes sturen input naar de server (server is autoritair)
// - muisklik op erts = minen (server beoordeelt afstand)
// - chat + inventory-HUD

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------------- config (moet overeenkomen met server/world.js)
const RES = {
  coal:   { code: 2, color: '#4a4a4a', dark: '#232323', light: '#787878', name: 'Kolen' },
  iron:   { code: 3, color: '#3f9b9b', dark: '#256e6e', light: '#84d8d8', name: 'IJzererts' },
  copper: { code: 4, color: '#96502c', dark: '#5e3018', light: '#cf8352', name: 'Kopererts' },
  stone:  { code: 5, color: '#9a9a92', dark: '#6f6f68', light: '#d0d0c6', name: 'Steen' },
  copper_ingot: { code: null, color: '#e08a4a', dark: '#8a4a24', light: '#ffb37a', name: 'Koperen staaf' },
  iron_ingot:   { code: null, color: '#c0c0cc', dark: '#6f6f78', light: '#f0f0f5', name: 'IJzeren staaf' },
  copper_wire:  { code: null, color: '#d8b04a', dark: '#8a6a1f', light: '#ffe08a', name: 'Koperdraad' },
  basic_chip:   { code: null, color: '#4ad17a', dark: '#24783f', light: '#8affb0', name: 'Basic chip' },
  gear:         { code: null, color: '#8a8f98', dark: '#4a4f58', light: '#c8cdd6', name: 'Tandwiel' },
};
// item-catalogus voor iconen/labels (Factorio-achtig); dekt alle craft-/droop-items
const ITEMS = {
  coal:          { name: 'Kolen',         icon: '⚫' },
  iron:          { name: 'IJzererts',     icon: '🟫' },
  copper:        { name: 'Kopererts',     icon: '🟪' },
  stone:         { name: 'Steen',         icon: '🪨' },
  copper_ingot:  { name: 'Koperen staaf', icon: '🟧' },
  iron_ingot:    { name: 'IJzeren staaf', icon: '⬜' },
  copper_wire:   { name: 'Koperdraad',    icon: '➰' },
  basic_chip:    { name: 'Basic chip',    icon: '🟩' },
  gear:          { name: 'Tandwiel (×2)', icon: '⚙️' },
};
const itemIcon = (id) => (ITEMS[id] ? ITEMS[id].icon : '❓');
const itemName = (id) => (ITEMS[id] ? ITEMS[id].name : id);
// hand-craft recepten (moet overeenkomen met de server-CRAFT)
const CRAFT_UI = [
  { id: 'copper_wire', inputs: [['copper_ingot', 1]] },
  { id: 'basic_chip',  inputs: [['iron_ingot', 1], ['copper_wire', 1]] },
  { id: 'gear',        inputs: [['iron_ingot', 1]] },
];
const AC_CRAFT_TIME = 1000; // ms per autocrafter-item (zelfde tempo als hand-craften)
const T_WATER = 1;
const PLAYER_SPEED = 4.2;

// ---------------- staat
let ws, joined = false;
let world = null;            // {w,h,tiles:Uint8Array,amount:Float32Array}
let myId = null;
let self = null;             // de eigen speler (locally)
let players = new Map();     // id -> {x,y,tx,ty,name,mt,mining,color}
let camera = { x: 0, y: 0, zoom: 1.15 };
let mineTarget = null;       // {x,y}
let selfMine = null;         // lokale spiegel van mijn mining-status
let keys = {};
let mouse = { x: 0, y: 0, tileX: -1, tileY: -1 };
const dropped = new Map(); // id -> {id,res,n,x,y} items op de grond
let dragging = false;      // slepen van een stapel uit de inventaris
let tilePatch = null;      // tileIndex -> patchId (-1)
let patchUnits = null;     // patchId -> {left,max}
let lastT = performance.now();

// --- machines
let buildingMap = new Map();   // "x,y" -> building (miner staat op linkerboven)
let buildingsById = new Map(); // id -> building
let beltItems = new Map();     // id -> {id,res,n,x,y,tx,ty}
let placing = null;           // {type, rot} van de machine die we plaatsen
let openPanel = null;         // {kind:'chest'|'miner', id}
let hotbarEls = [];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 0=rechts,1=omlaag,2=links,3=omhoog
const MINER_CAP = 64;
const BUILD_DEFS = {
  miner:    { name: 'Miner',    size: 2, icon: '⛏️' },
  chest:    { name: 'Kist',     size: 1, icon: '📦' },
  inserter: { name: 'Inserter', size: 1, icon: '🦾' },
  belt:     { name: 'Loopband', size: 1, icon: '➡️' },
  oven:     { name: 'Oven',     size: 1, icon: '🔥' },
  autocrafter: { name: 'Autocrafter', size: 2, icon: '🏭' },
};
const slotRegistry = new Map(); // slot-element -> {kind, id, slot}
let fps = 0, fpsAcc = 0, fpsN = 0;

const TILE = 32; // pixels per tegel bij zoom 1

// ---------------- util
function hash01(n) {
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function resIdOfTile(code) {
  for (const k of Object.keys(RES)) if (RES[k].code === code) return k;
  return null;
}
function playerColor(id) {
  const h = hash01(id * 2654435761);
  return `hsl(${Math.floor(h * 360)}, 65%, 60%)`;
}

// ---------------- canvas / camera
function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}
addEventListener('resize', resize);
resize();

function screenToWorld(sx, sy) {
  return {
    x: (sx - innerWidth / 2) / (TILE * camera.zoom) + camera.x,
    y: (sy - innerHeight / 2) / (TILE * camera.zoom) + camera.y,
  };
}

// ---------------- netwerk
function connect(name) {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  ws = new WebSocket(url);

  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'init': {
        world = {
          w: m.world.w, h: m.world.h,
          tiles: new Uint8Array(m.world.tiles),
          amount: new Float32Array(m.world.amount),
          spawn: m.world.spawn,
          patches: m.world.patches || [],
        };
        tilePatch = new Int32Array(world.w * world.h).fill(-1);
        world.patches.forEach((patch, pid) => {
          for (const t of patch.idxs) tilePatch[t] = pid;
        });
        patchUnits = new Array(world.patches.length).fill(null);
        myId = m.you;
        const me = m.players.find((b) => b.id === m.you);
        for (const d of (m.dropped || [])) dropped.set(d.id, d);
        for (const b of (m.buildings || [])) applyBuilding(b);
        for (const it of (m.beltitems || [])) beltItems.set(it.id, it);
        for (const b of m.players) if (b.id !== m.you) addPlayer(b);
        ensureSelf();
        if (me) { self.inv = me.inv; self.name = me.name; self.tx = me.x; self.ty = me.y; self.x = me.x; self.y = me.y; }
        camera.x = self.x; camera.y = self.y;
        document.getElementById('join').style.display = 'none';
        joined = true;
        break;
      }
      case 'join': addPlayer(m.p); break;
      case 'leave': {
        const p = players.get(m.id);
        if (p && m.id !== myId) players.delete(m.id);
        break;
      }
      case 'pos': {
        for (const b of m.players) {
          if (b.id === myId) {
            self.tx = b.x; self.ty = b.y;
            self.mine = !!b.mining; self.mt = b.mt; self.craft = b.craft || 0;
          } else {
            const p = players.get(b.id) || addPlayer(b);
            p.tx = b.x; p.ty = b.y; p.mt = b.mt; p.mining = b.mining; p.craft = b.craft || 0;
          }
        }
        break;
      }
      case 'cqueue': {
        setCraftBadges(m.counts || {}); // per-recept counts, sneller dan wachten op pos
        break;
      }
      case 'mined': {
        const pid = m.patch;
        if (pid != null && world.patches && world.patches[pid]) {
          const patch = world.patches[pid];
          const frac = m.max > 0 ? m.left / m.max : 0;
          for (const t of patch.idxs) world.amount[t] = frac;
          patchUnits[pid] = { left: m.left, max: m.max };
          if (m.cleared) {
            for (const t of patch.idxs) { world.tiles[t] = 0; world.amount[t] = 0; }
            if (mineTarget && tilePatch[mineTarget.y * world.w + mineTarget.x] === pid) {
              mineTarget = null; send({ t: 'stopmine' });
            }
          }
        } else {
          const idx = m.y * world.w + m.x;
          if (m.cleared) { world.tiles[idx] = 0; world.amount[idx] = 0; }
          else if (world.amount[idx] != null) world.amount[idx] = m.left;
          if (m.cleared && mineTarget && mineTarget.x === m.x && mineTarget.y === m.y) mineTarget = null;
        }
        break;
      }
      case 'chat': addChat(m.from, m.text, false); break;
      case 'drop': dropped.set(m.item.id, m.item); break;
      case 'pickup': dropped.delete(m.id); break;
      case 'inv': {
        if (self) self.inv = m.inv;
        break;
      }
      case 'place': applyBuilding(m.b); break;
      case 'remove': removeBuilding(m.id); break;
      case 'bupdate': updateBuilding(m); break;
      case 'belts': beltItems = new Map(m.items.map((it) => [it.id, it])); break;
      case 'perr': toast(m.msg); break;
    }
  };

  ws.onclose = () => {
    if (joined) setTimeout(() => location.reload(), 1200);
  };
}

function addPlayer(b) {
  const p = {
    id: b.id, name: b.name, x: b.x, y: b.y, tx: b.x, ty: b.y,
    color: playerColor(b.id), mt: null, mining: false,
  };
  players.set(b.id, p);
  return p;
}

function ensureSelf() {
  if (self) return;
  self = { id: myId, name: '', x: world.spawn.x, y: world.spawn.y,
           tx: world.spawn.x, ty: world.spawn.y,
           inv: { slots: new Array(16).fill(null), cursor: null }, mt: null, mine: false };
}

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ---------------- machines: helpers
function bpKey(x, y) { return x + ',' + y; }

// footprint van een type op (x,y)
function footprint(type, x, y) {
  if (type === 'miner' || type === 'autocrafter') return [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  return [[x, y]];
}

// bouwt een lokaal geldigheids-voorspel (server blijft autoritair)
function placeValid(type, x, y) {
  if (!world) return false;
  for (const [fx, fy] of footprint(type, x, y)) {
    if (fx < 0 || fy < 0 || fx >= world.w || fy >= world.h) return false;
    if (world.tiles[fy * world.w + fx] === T_WATER) return false;
    if (buildingMap.has(bpKey(fx, fy))) return false;
    for (const p of players.values()) {
      if (Math.abs(p.x - (fx + 0.5)) < 0.7 && Math.abs(p.y - (fy + 0.5)) < 0.7) return false;
    }
    if (self && Math.abs(self.x - (fx + 0.5)) < 0.7 && Math.abs(self.y - (fy + 0.5)) < 0.7) return false;
  }
  // miner moet op erts staan
  if (type === 'miner') {
    let onOre = false;
    for (const [fx, fy] of footprint(type, x, y)) {
      if (world.tiles[fy * world.w + fx] > T_WATER) onOre = true;
    }
    if (!onOre) return false;
  }
  return true;
}

function buildingAtTile(tx, ty) {
  // eerst exacte match, dan binnen een miner-footprint
  return buildingMap.get(bpKey(tx, ty)) || null;
}

// ---------------- machines: render
function drawBuilding(b, cx, cy, ts, ghost, valid, t = 0) {
  const { x, y, type, rot } = b;
  if (type === 'miner') {
    // 2x2 doos
    const sx = (x + 1 - cx) * ts + innerWidth / 2;       // midden van 2x2
    const sy = (y + 1 - cy) * ts + innerHeight / 2;
    const w = ts * 2;
    ctx.globalAlpha = ghost ? 0.55 : 1;
    ctx.fillStyle = valid ? '#5a4636' : '#7a3030';
    ctx.fillRect(sx - w / 2, sy - w / 2, w, w);
    ctx.strokeStyle = valid ? '#2c2318' : '#3a1414';
    ctx.lineWidth = Math.max(2, ts * 0.08);
    ctx.strokeRect(sx - w / 2, sy - w / 2, w, w);
    // tandwiel
    ctx.fillStyle = valid ? '#c9a86a' : '#e07070';
    ctx.beginPath(); ctx.arc(sx, sy, ts * 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = valid ? '#5a4636' : '#7a3030';
    ctx.beginPath(); ctx.arc(sx, sy, ts * 0.2, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const sx = (x + 0.5 - cx) * ts + innerWidth / 2;
  const sy = (y + 0.5 - cy) * ts + innerHeight / 2;
  ctx.globalAlpha = ghost ? 0.6 : 1;
  if (type === 'chest') {
    ctx.fillStyle = valid ? '#8a5a2b' : '#7a3030';
    ctx.fillRect(sx - ts * 0.4, sy - ts * 0.36, ts * 0.8, ts * 0.72);
    ctx.strokeStyle = valid ? '#4a2f14' : '#3a1414';
    ctx.lineWidth = Math.max(1.5, ts * 0.06);
    ctx.strokeRect(sx - ts * 0.4, sy - ts * 0.36, ts * 0.8, ts * 0.72);
    ctx.strokeStyle = valid ? '#c9a86a' : '#e07070';
    ctx.beginPath(); ctx.moveTo(sx - ts * 0.4, sy); ctx.lineTo(sx + ts * 0.4, sy); ctx.stroke();
  } else if (type === 'inserter') {
    // base
    ctx.fillStyle = valid ? '#7a8896' : '#8a5050';
    ctx.beginPath(); ctx.arc(sx, sy, ts * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = valid ? '#4a5560' : '#5a3030';
    ctx.beginPath(); ctx.arc(sx, sy, ts * 0.14, 0, 7); ctx.fill();

    // arm: volgt server-status.
    // b.buf gevuld  → arm beweegt naar duw-kant (swing=1) en houdt item vast.
    // b.buf leeg    → arm beweegt terug naar pak-kant (swing=0), lege tang.
    // De lerp duurt ~500ms (matches INSERTER_HOLD op server) voor vloeiende beweging.
    const d = DIRS[rot % 4];
    const frontAngle = Math.atan2(d[1], d[0]);
    const target = b.buf ? 1 : 0;
    if (b._swing == null) b._swing = target;
    b._swing += (target - b._swing) * 0.10; // ~500ms om doel te bereiken
    if (Math.abs(target - b._swing) < 0.01) b._swing = target;
    const swing = b._swing;
    const holding = !!b.buf;
    const ang = frontAngle + swing * Math.PI;
    const len = ts * 0.5;
    const ax = sx + Math.cos(ang) * len;
    const ay = sy + Math.sin(ang) * len;

    // arm-staaf
    ctx.strokeStyle = valid ? '#b8c4d0' : '#d08080';
    ctx.lineWidth = Math.max(3, ts * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // tang (gripper) aan het uiteinde: twee pootjes in een V
    const open = holding ? 0.30 : 0.55 + 0.14 * Math.sin(t * 3.2 + b.id);
    const gLen = ts * 0.26;
    ctx.strokeStyle = valid ? '#e2e8f0' : '#e08080';
    ctx.lineWidth = Math.max(2, ts * 0.09);
    for (const side of [-1, 1]) {
      const ga = ang + side * open;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(ga) * gLen, ay + Math.sin(ga) * gLen);
      ctx.stroke();
    }
    // knoopje op de tang
    ctx.fillStyle = valid ? '#e2e8f0' : '#e08080';
    ctx.beginPath(); ctx.arc(ax, ay, Math.max(2, ts * 0.07), 0, 7); ctx.fill();

    // vastgehouden item: alleen zichtbaar wanneer de inserter écht een item vasthoudt
    if (holding && RES[b.buf.res]) {
      const r = RES[b.buf.res];
      const s = ts * 0.24;
      const hx = ax + Math.cos(ang) * ts * 0.18;
      const hy = ay + Math.sin(ang) * ts * 0.18;
      ctx.fillStyle = r.color;
      ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
      ctx.strokeStyle = r.dark;
      ctx.lineWidth = Math.max(1, ts * 0.045);
      ctx.strokeRect(hx - s / 2, hy - s / 2, s, s);
    }
    ctx.lineCap = 'butt';
  } else if (type === 'belt') {
    const d = DIRS[rot % 4];
    // band-oppervlak
    ctx.fillStyle = valid ? '#3a3f47' : '#5a3030';
    ctx.fillRect(sx - ts / 2, sy - ts / 2, ts, ts);
    ctx.strokeStyle = valid ? '#20242a' : '#301414';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - ts / 2, sy - ts / 2, ts, ts);

    // roloppervlak (iets donkerder, loopt breed langs de richting)
    const half = ts * 0.16;
    ctx.save();
    ctx.beginPath();
    if (d[0] !== 0) ctx.rect(sx - ts / 2, sy - half, ts, half * 2);
    else            ctx.rect(sx - half, sy - ts / 2, half * 2, ts);
    ctx.clip();
    ctx.fillStyle = valid ? '#2a2e35' : '#421818';
    ctx.fillRect(sx - ts / 2, sy - ts / 2, ts, ts);
    ctx.restore();

    // rollende chevrons in de transport-richting
    const horiz = d[0] !== 0;
    const spacing = ts * 0.5;
    // rool in de transport-richting: teken op de as, met teken van de richting
    const dirSign = horiz ? d[0] : d[1];
    const scroll = (((t * 24 + b.id) * dirSign) % spacing + spacing) % spacing; // 0..spacing
    const chev = ts * 0.14;
    ctx.strokeStyle = valid ? 'rgba(255,212,121,0.85)' : 'rgba(224,112,112,0.85)';
    ctx.lineWidth = Math.max(2, ts * 0.07);
    ctx.lineCap = 'round';
    for (let s = -ts / 2 + scroll; s < ts / 2; s += spacing) {
      if (horiz) {
        const px = sx + s, py = sy;
        // V-vorm die in d[0]-richting wijst
        const px2 = d[0];
        ctx.beginPath();
        ctx.moveTo(px - px2 * chev, py - chev);
        ctx.lineTo(px, py);
        ctx.lineTo(px - px2 * chev, py + chev);
        ctx.stroke();
      } else {
        const px = sx, py = sy + s;
        const py2 = d[1];
        ctx.beginPath();
        ctx.moveTo(px - chev, py - py2 * chev);
        ctx.lineTo(px, py);
        ctx.lineTo(px + chev, py - py2 * chev);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  } else if (type === 'oven') {
    // bakstenen furnace
    ctx.fillStyle = valid ? '#7a4a3a' : '#7a3030';
    ctx.fillRect(sx - ts * 0.42, sy - ts * 0.42, ts * 0.84, ts * 0.84);
    ctx.strokeStyle = valid ? '#3a221a' : '#3a1414';
    ctx.lineWidth = Math.max(2, ts * 0.07);
    ctx.strokeRect(sx - ts * 0.42, sy - ts * 0.42, ts * 0.84, ts * 0.84);

    // vuurmond (open opening)
    const firing = !!(b.ore && b.fuel > 0);
    const glow = firing ? 0.5 + 0.35 * Math.sin(t * 6 + b.id) : 0;
    ctx.fillStyle = firing ? `rgba(255,${Math.floor(120 + glow * 120)},40,${0.65 + glow * 0.3})` : '#1c1410';
    ctx.beginPath();
    ctx.arc(sx, sy + ts * 0.12, ts * 0.22, 0, 7);
    ctx.fill();
    if (firing) {
      // gloed rond de oven
      ctx.save();
      ctx.globalAlpha = 0.25 + glow * 0.3;
      ctx.fillStyle = '#ffb44a';
      ctx.beginPath(); ctx.arc(sx, sy, ts * 0.5, 0, 7); ctx.fill();
      ctx.restore();
    }
    // schoorsteen/klepel bovenop
    ctx.fillStyle = valid ? '#5a3830' : '#4a2424';
    ctx.fillRect(sx - ts * 0.34, sy - ts * 0.5, ts * 0.68, ts * 0.12);
  } else if (type === 'autocrafter') {
    // 2x2 machine: staalblauwe kast, draaiend tandwiel + voortgangsbalk
    // (sx/sy hier = midden van de 2x2, overschaduwt de 1x1-versies)
    const sx = (x + 1 - cx) * ts + innerWidth / 2;
    const sy = (y + 1 - cy) * ts + innerHeight / 2;
    const w = ts * 2;
    ctx.globalAlpha = ghost ? 0.55 : 1;
    const hasRecipe = !!(b.ac && b.ac.recipe);
    const busy = !!(b.ac && b.ac.prog > 0);
    ctx.fillStyle = valid ? (busy ? '#2e5a6e' : '#24425c') : '#7a3030';
    ctx.fillRect(sx - w / 2, sy - w / 2, w, w);
    ctx.strokeStyle = valid ? '#122334' : '#3a1414';
    ctx.lineWidth = Math.max(2, ts * 0.08);
    ctx.strokeRect(sx - w / 2, sy - w / 2, w, w);
    // tandwiel: draait alleen wanneer de machine bezig is
    const spin = busy ? t * 4 + b.id : 0;
    ctx.save();
    ctx.translate(sx, sy - ts * 0.1);
    ctx.rotate(spin);
    ctx.fillStyle = valid ? '#9fb8cc' : '#d08080';
    const teeth = 6;
    for (let i = 0; i < teeth; i++) {
      ctx.rotate(Math.PI / teeth);
      ctx.fillRect(-ts * 0.08, -ts * 0.42, ts * 0.16, ts * 0.16);
    }
    ctx.beginPath(); ctx.arc(0, 0, ts * 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = valid ? '#24425c' : '#7a3030';
    ctx.beginPath(); ctx.arc(0, 0, ts * 0.12, 0, 7); ctx.fill();
    ctx.restore();
    // geselecteerd recept (klein item-icoon onder het tandwiel)
    if (hasRecipe) {
      ctx.font = `${ts * 0.5}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(itemIcon(b.ac.recipe), sx, sy + ts * 0.62);
      ctx.textAlign = 'start';
    }
    // voortgangsbalk
    if (b.ac) {
      const bw = w * 0.8;
      const bh = Math.max(4, ts * 0.12);
      const by = sy + w / 2 - bh - ts * 0.1;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(sx - bw / 2, by, bw, bh);
      const frac = Math.min(1, Math.max(0, b.ac.prog / AC_CRAFT_TIME));
      if (frac > 0) {
        ctx.fillStyle = '#7fd1b0';
        ctx.fillRect(sx - bw / 2, by, bw * frac, bh);
      }
    }
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = 1;
}

function drawBelts(cx, cy, ts) {
  for (const it of beltItems.values()) {
    const r = RES[it.res];
    if (!r) continue;
    const sx = (it.x - cx) * ts + innerWidth / 2;
    const sy = (it.y - cy) * ts + innerHeight / 2;
    const rad = Math.max(4, ts * 0.2);
    ctx.fillStyle = r.color;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill(); ctx.stroke();
  }
}

// ---------------- machines: netwerk-updates
function applyBuilding(m) {
  const b = m;
  if (b.type === 'autocrafter') b.ac = { prog: b.progress || 0, recipe: b.recipe, inputs: b.inputs, out: b.out };
  buildingsById.set(b.id, b);
  for (const [fx, fy] of footprint(b.type, b.x, b.y)) buildingMap.set(bpKey(fx, fy), b);
}
function removeBuilding(id) {
  const b = buildingsById.get(id);
  if (!b) return;
  for (const [fx, fy] of footprint(b.type, b.x, b.y)) {
    if (buildingMap.get(bpKey(fx, fy)) === b) buildingMap.delete(bpKey(fx, fy));
  }
  buildingsById.delete(id);
  if (openPanel && openPanel.id === id) closePanel();
}
function updateBuilding(m) {
  const b = buildingsById.get(m.id);
  if (!b) return;
  if (m.storage) b.storage = m.storage;
  if (m.store != null) b.store = m.store;
  // buf kan null zijn (item geplaatst) — update altijd wanneer het veld present is
  if ('buf' in m) {
    if (m.buf) b._lastRes = m.buf.res; // onthoud laatste res voor animatie
    b.buf = m.buf;
  }
  if (m.oven) { b.fuel = m.oven.fuel; b.ore = m.oven.ore; b.out = m.oven.out; }
  if (m.ac) b.ac = m.ac;
  if (openPanel && openPanel.id === m.id) renderPanel();
}

// ---------------- input
addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput) {
    if (e.key === 'Enter') sendChat();
    if (e.key === 'Escape') chatInput.blur();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyI') { showInvCraft('inv'); return; }
  if (e.code === 'KeyC') { showInvCraft('craft'); return; }
  // hotbar: 1-5 kiezen machine-type
  if (e.code === 'Digit1') selectPlacing('miner');
  else if (e.code === 'Digit2') selectPlacing('chest');
  else if (e.code === 'Digit3') selectPlacing('inserter');
  else if (e.code === 'Digit4') selectPlacing('belt');
  else if (e.code === 'Digit5') selectPlacing('oven');
  else if (e.code === 'Digit6') selectPlacing('autocrafter');
  else if (e.code === 'KeyR') {
    if (placing) { placing.rot = (placing.rot + 1) % 4; updateHotbar(); }
  }
  if (e.code === 'Escape') {
    if (placing) { placing = null; updateHotbar(); }
    else if (openPanel) closePanel();
    else if (invCraftEl && !invCraftEl.hidden) invCraftEl.hidden = true;
    else stopMine();
  }
  if (e.code === 'KeyY') chatInput.focus();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
  if (!joined) return;
  const w = screenToWorld(e.clientX, e.clientY);
  const tx = Math.floor(w.x), ty = Math.floor(w.y);

  // rechtermuisknop: sloop / annuleer
  if (e.button === 2) {
    if (placing) { placing = null; updateHotbar(); return; }
    const b = buildingAtTile(tx, ty);
    if (b) send({ t: 'demolish', x: tx, y: ty });
    return;
  }
  if (e.button !== 0) return;

  // plaatsen-modus actief?
  if (placing) {
    const x = placing.type === 'miner' ? tx : tx;
    send({ t: 'place', type: placing.type, x, y: ty, rot: placing.rot });
    return;
  }

  const b = buildingAtTile(tx, ty);
  const isMachine = b && (b.type === 'chest' || b.type === 'miner' || b.type === 'oven' || b.type === 'autocrafter');

  // paneel open + klik buiten op een machine = sluiten
  if (openPanel && !isMachine) { closePanel(); return; }

  // klik op kist/miner/oven = paneel openen / wisselen
  if (isMachine) { openBuilding(b); return; }

  // eerst: gedropt item oppakken?
  let closest = null, closestD = 0.5;
  for (const it of dropped.values()) {
    const d = Math.hypot(it.x - w.x, it.y - w.y);
    if (d < closestD) { closest = it; closestD = d; }
  }
  if (closest) { send({ t: 'pickup', id: closest.id }); return; }

  // minen
  const code = world ? world.tiles[ty * world.w + tx] : 0;
  if (code > T_WATER) {
    if (mineTarget && mineTarget.x === tx && mineTarget.y === ty) {
      stopMine();
    } else {
      mineTarget = { x: tx, y: ty };
      send({ t: 'mine', x: tx, y: ty });
    }
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('wheel', (e) => {
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  camera.zoom = Math.min(2.6, Math.max(0.45, camera.zoom * f));
  zoomEl.textContent = camera.zoom.toFixed(2) + 'x';
}, { passive: true });

function stopMine() {
  mineTarget = null;
  send({ t: 'stopmine' });
}

let lastInputSent = '';
function sendInput() {
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  const s = mx + ',' + my;
  if (s !== lastInputSent) { lastInputSent = s; send({ t: 'input', mx, my }); }
}

// ---------------- chat
const chatInput = document.getElementById('chatInput');
const chatMsgs = document.getElementById('chatMsgs');
function addChat(from, text, sys) {
  const div = document.createElement('div');
  if (sys) {
    div.className = 'sys';
    div.textContent = text;
  } else {
    div.innerHTML = '';
    const f = document.createElement('span');
    f.className = 'from'; f.textContent = from + ': ';
    div.appendChild(f);
    div.appendChild(document.createTextNode(text));
  }
  chatMsgs.appendChild(div);
  while (chatMsgs.children.length > 60) chatMsgs.firstChild.remove();
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}
function sendChat() {
  const text = chatInput.value.trim();
  if (!text) { chatInput.blur(); return; }
  send({ t: 'chat', text });
  addChat('Jij', text);
  chatInput.value = '';
}
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
  e.stopPropagation();
});
// chat doorzichtig bij rust; helder + actief wanneer het inputveld focus heeft
const chatEl = document.getElementById('chat');
chatInput.addEventListener('focus', () => chatEl.classList.add('active'));
chatInput.addEventListener('blur', () => chatEl.classList.remove('active'));

// ---------------- HUD
const invEl = document.getElementById('inv');
const zoomEl = document.getElementById('zoom');
const onlineEl = document.getElementById('online');
const fpsEl = document.getElementById('fps');
const statusEl = document.getElementById('status');
const miningTextEl = document.getElementById('miningText');

const SLOT_COUNT = 16;
const slotEls = [];
const slotItemEls = [];
const slotCountEls = [];
let cursorItemEl = null;

function buildInventory() {
  invEl.innerHTML = '';
  slotEls.length = slotItemEls.length = slotCountEls.length = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = '<div class="slot-item"></div><span class="slot-count"></span>';
    slot.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) {
        send({ t: 'grab', slot: i });
        dragging = true;
      }
    });
    slot.addEventListener('contextmenu', (e) => e.preventDefault());
    invEl.appendChild(slot);
    slotEls.push(slot);
    slotItemEls.push(slot.querySelector('.slot-item'));
    slotCountEls.push(slot.querySelector('.slot-count'));
  }
  // zwevende stapel die de muis volgt
  cursorItemEl = document.createElement('div');
  cursorItemEl.className = 'cursor-item';
  cursorItemEl.hidden = true;
  cursorItemEl.innerHTML = '<div class="slot-item"></div><span class="slot-count"></span>';
  document.body.appendChild(cursorItemEl);
  addEventListener('mousemove', (e) => {
    if (!cursorItemEl.hidden) {
      cursorItemEl.style.left = (e.clientX + 16) + 'px';
      cursorItemEl.style.top = (e.clientY - 22) + 'px';
    }
  });
  // loslaten tijdens slepen: op een slot = plaatsen, buiten de inventaris = droppen
  addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.button !== 0) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = el && el.closest ? el.closest('.slot') : null;
    if (slotEl) {
      // machine-slot? dan naar de machine
      const reg = slotRegistry.get(slotEl);
      if (reg) { send({ t: 'dropslot', slot: reg.slot, dst: reg }); return; }
      const idx = slotEls.indexOf(slotEl);
      if (idx >= 0) send({ t: 'dropslot', slot: idx });
      return;
    }
    const invPanel = invCraftEl;
    const panelVisible = panelEl && !panelEl.hidden;
    if (invPanel && !invPanel.hidden && invPanel.contains(el)) {
      // op het paneel (maar niet op een slot) losgelaten: blijft in de cursor
    } else if (panelVisible && panelEl.contains(el)) {
      // op het machine-paneel: blijft in de cursor
    } else {
      send({ t: 'dropworld' });
    }
  });
}
function renderInventory() {
  const inv = self ? self.inv : null;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = inv ? inv.slots[i] : null;
    const itemEl = slotItemEls[i];
    const countEl = slotCountEls[i];
    if (s && ITEMS[s.id]) {
      itemEl.textContent = itemIcon(s.id);
      itemEl.style.display = 'flex';
      itemEl.style.background = RES[s.id] ? RES[s.id].color + '22' : 'transparent';
      slotEls[i].title = `${itemName(s.id)} × ${s.n}`;
      countEl.textContent = s.n;
      countEl.style.display = 'block';
    } else {
      itemEl.textContent = '';
      itemEl.style.display = 'none';
      countEl.style.display = 'none';
      slotEls[i].title = '';
    }
  }
  const c = inv ? inv.cursor : null;
  const curItem = cursorItemEl.querySelector('.slot-item');
  const curCount = cursorItemEl.querySelector('.slot-count');
  if (c && ITEMS[c.id]) {
    cursorItemEl.hidden = false;
    cursorItemEl.title = `${itemName(c.id)}${c.n > 1 ? ' (' + c.n + ')' : ''}`;
    curItem.textContent = itemIcon(c.id);
    curItem.style.display = 'flex';
    curItem.style.background = RES[c.id] ? RES[c.id].color + '22' : 'transparent';
    curCount.textContent = c.n;
    curCount.style.display = 'block';
  } else {
    cursorItemEl.hidden = true;
    curItem.style.display = 'none';
    curCount.style.display = 'none';
  }
}

// ---------------- render
function draw() {
  requestAnimationFrame(draw);

  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  // input + spiegel van mijn mining-status
  if (joined) sendInput();
  selfMine = self ? self.mt : null;

  // eigen beweging lokal voorspellen + smooth volgen
  if (self) {
    self.x += (self.tx - self.x) * Math.min(1, dt * 12);
    self.y += (self.ty - self.y) * Math.min(1, dt * 12);
    camera.x += (self.x - camera.x) * Math.min(1, dt * 5);
    camera.y += (self.y - camera.y) * Math.min(1, dt * 5);
  }
  for (const p of players.values()) {
    p.x += (p.tx - p.x) * Math.min(1, dt * 12);
    p.y += (p.ty - p.y) * Math.min(1, dt * 12);
  }

  const ts = TILE * camera.zoom;
  const { x: cx, y: cy } = camera;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  // wereldrand buiten de kaart
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!world) return;

  const x0 = Math.max(0, Math.floor(cx - innerWidth / 2 / ts));
  const x1 = Math.min(world.w, Math.ceil(cx + innerWidth / 2 / ts) + 1);
  const y0 = Math.max(0, Math.floor(cy - innerHeight / 2 / ts));
  const y1 = Math.min(world.h, Math.ceil(cy + innerHeight / 2 / ts) + 1);

  const t = now / 1000;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * world.w + x;
      const code = world.tiles[idx];
      const sx = (x + 0.5 - cx) * ts + innerWidth / 2;
      const sy = (y + 0.5 - cy) * ts + innerHeight / 2;
      const h = hash01(x * 374761393 + y * 668265263);

      if (code === T_WATER) {
        const w = Math.sin(t * 1.4 + x * 0.7 + y * 1.3) * 0.5 + 0.5;
        const g = 118 + w * 18;
        ctx.fillStyle = `rgb(38, 86, ${g | 0})`;
      } else if (code === 0) {
        const l = h < 0.5 ? 0 : 1;
        ctx.fillStyle = l ? '#416f39' : '#3c6a34';
      } else {
        const r = RES[resIdOfTile(code)];
        const frac = world.amount[idx];
        ctx.fillStyle = frac > 0 ? r.color : '#454a45';
      }
      ctx.fillRect(sx - ts / 2, sy - ts / 2, ts + 0.5, ts + 0.5);

      // erts-details: vlekjes + leeglopende graslaag (heel veld loopt samen leeg)
      if (code > T_WATER) {
        const frac = world.amount[idx];
        if (frac > 0) {
          const r = RES[resIdOfTile(code)];
          const k = Math.floor(ts * 0.32);
          const n = frac > 0.5 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const hx = hash01(idx * 911 + i * 57) - 0.5;
            const hy = hash01(idx * 777 + i * 91) - 0.5;
            ctx.fillStyle = i === 2 ? r.light : r.dark;
            ctx.beginPath();
            ctx.arc(sx + hx * ts * 0.6, sy + hy * ts * 0.6, Math.max(1.2, k * 0.32), 0, 7);
            ctx.fill();
          }
        }
        if (frac < 1) {
          ctx.fillStyle = `rgba(60, 106, 52, ${((1 - frac) * 0.55).toFixed(3)})`;
          ctx.fillRect(sx - ts / 2, sy - ts / 2, ts, ts);
        }
      }
    }
  }

  // mijn doel: ring
  if (selfMine && world.amount[selfMine.y * world.w + selfMine.x] > 0) {
    const sx = (selfMine.x + 0.5 - cx) * ts + innerWidth / 2;
    const sy = (selfMine.y + 0.5 - cy) * ts + innerHeight / 2;
    ctx.strokeStyle = '#ffd479';
    ctx.lineWidth = Math.max(2, ts * 0.09);
    ctx.strokeRect(sx - ts / 2, sy - ts / 2, ts, ts);
  }

  // hover-tegel
  if (mouse.tileX >= 0 && world.amount[mouse.tileY * world.w + mouse.tileX] > 0) {
    const sx = (mouse.tileX + 0.5 - cx) * ts + innerWidth / 2;
    const sy = (mouse.tileY + 0.5 - cy) * ts + innerHeight / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx - ts / 2, sy - ts / 2, ts, ts);
  }

  // machines (bovenop de tegels)
  const seen = new Set();
  for (const b of buildingMap.values()) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    drawBuilding(b, cx, cy, ts, false, true, t);
  }
  // items op loopbanden
  drawBelts(cx, cy, ts);

  // ghost-preview tijdens plaatsen
  if (placing) {
    const gx = mouse.tileX, gy = mouse.tileY;
    if (gx >= 0 && gy >= 0 && gx < world.w && gy < world.h) {
      const ok = placeValid(placing.type, gx, gy);
      drawBuilding({ type: placing.type, x: gx, y: gy, rot: placing.rot }, cx, cy, ts, true, ok);
      // rood/groen kader over de footprint
      for (const [fx, fy] of footprint(placing.type, gx, gy)) {
        const sx = (fx + 0.5 - cx) * ts + innerWidth / 2;
        const sy = (fy + 0.5 - cy) * ts + innerHeight / 2;
        ctx.strokeStyle = ok ? 'rgba(90,220,120,.9)' : 'rgba(230,80,80,.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - ts / 2, sy - ts / 2, ts, ts);
      }
    }
  }

  // gedropte items op de grond
  for (const it of dropped.values()) {
    const r = RES[it.res];
    if (!r) continue;
    const sx = (it.x - cx) * ts + innerWidth / 2;
    const sy = (it.y - cy) * ts + innerHeight / 2;
    const rad = Math.max(6, ts * 0.22);
    ctx.fillStyle = r.color;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(9, ts * 0.26)}px Segoe UI, sans-serif`;
    ctx.fillText(it.n, sx, sy + rad + Math.max(9, ts * 0.26));
  }

  // andere spelers
  ctx.textAlign = 'center';
  ctx.font = `${Math.max(11, ts * 0.34)}px Segoe UI, sans-serif`;
  for (const p of players.values()) {
    const sx = (p.x + 0.5 - cx) * ts + innerWidth / 2;
    const sy = (p.y + 0.5 - cy) * ts + innerHeight / 2;
    drawPerson(sx, sy, ts, p.color, p.name, p.mining, p.mt, cx, cy, ts, p.craft);
  }
  // ik (bovenop)
  if (self) {
    const sx = (self.x + 0.5 - cx) * ts + innerWidth / 2;
    const sy = (self.y + 0.5 - cy) * ts + innerHeight / 2;
    drawPerson(sx, sy, ts, '#57c99b', 'Jij', self.mine, self.mt, cx, cy, ts, self.craft);
  }

  // mouse-tegel bijwerken
  const mw = screenToWorld(mouse.x, mouse.y);
  mouse.tileX = Math.floor(mw.x); mouse.tileY = Math.floor(mw.y);

  // HUD
  renderInventory();
  onlineEl.textContent = (players.size + 1) + '';
  fpsEl.textContent = fps;
  const mt = self.mt;
  if (self.mine && mt) {
    statusEl.hidden = false;
    const r = world.tiles[mt.y * world.w + mt.x];
    const rName = RES[resIdOfTile(r)]?.name || '?';
    const pid = tilePatch ? tilePatch[mt.y * world.w + mt.x] : -1;
    const u = (pid >= 0 && patchUnits) ? patchUnits[pid] : null;
    const amt = u ? u.left : Math.ceil((world.amount[mt.y * world.w + mt.x] || 0));
    miningTextEl.textContent = `⛏️ Mijnen: ${rName} (veld: ${amt} resterend)`;
  } else {
    statusEl.hidden = true;
  }
}

function drawPerson(sx, sy, ts, color, name, mining, mt, cx, cy, ts2, craft) {
  const r = ts * 0.32;
  // schaduw
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.75, r * 0.9, r * 0.4, 0, 0, 7); ctx.fill();
  // lichaam
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2; ctx.stroke();
  // oogje (richting? simpel: licht puntje)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(sx + r * 0.25, sy - r * 0.2, r * 0.22, 0, 7); ctx.fill();
  // naam
  ctx.font = `600 ${Math.max(11, ts * 0.3)}px Segoe UI, sans-serif`;
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(name, sx, sy - r - 6);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, sx, sy - r - 6);
  // mijn-indicator
  if (mining && mt) {
    const mx2 = (mt.x + 0.5 - cx) * ts2 + innerWidth / 2;
    const my2 = (mt.y + 0.5 - cy) * ts2 + innerHeight / 2;
    ctx.fillStyle = '#ffd479';
    ctx.beginPath(); ctx.arc(mx2, my2, Math.max(2.5, ts2 * 0.1), 0, 7); ctx.fill();
  }
  // craft-laadbar onder het personage
  if (craft) {
    const w = Math.max(36, ts2 * 1.1), h = Math.max(7, ts2 * 0.18);
    const by = sy + r + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(sx - w / 2, by, w, h);
    ctx.fillStyle = '#7fd1b0';
    ctx.fillRect(sx - w / 2, by, w * Math.min(1, Math.max(0, craft.prog)), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(sx - w / 2, by, w, h);
    // icon van het item dat bezig is + que-teller
    ctx.font = `${Math.max(11, ts2 * 0.28)}px Segoe UI, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(itemIcon(craft.id) + (craft.n > 1 ? ` ×${craft.n}` : ''), sx, by - 4);
  }
}

// ---------------- hotbar
function selectPlacing(type) {
  if (openPanel) closePanel();
  if (placing && placing.type === type) {
    placing = null;               // nogmaals kiezen = annuleren
  } else {
    placing = { type, rot: placing ? placing.rot : 0 };
  }
  updateHotbar();
}
function updateHotbar() {
  for (const el of hotbarEls) {
    const type = el.dataset.type;
    el.classList.toggle('active', !!(placing && placing.type === type));
    el.classList.toggle('placing', !!(placing && placing.type === type));
    if (placing && placing.type === type) {
      const d = DIRS[placing.rot % 4];
      el.querySelector('.hb-rot').textContent =
        ['→', '↓', '←', '↑'][placing.rot % 4];
    }
  }
  const hint = document.getElementById('buildHint');
  if (hint) {
    if (placing) {
      hint.hidden = false;
      const d = DIRS[placing.rot % 4];
      hint.textContent = `${BUILD_DEFS[placing.type].name} — klik om te plaatsen · R draait (${['rechts','omlaag','links','omhoog'][placing.rot % 4]}) · rechtermuisknop/Esc annuleert`;
    } else hint.hidden = true;
  }
}

function buildHotbar() {
  const bar = document.getElementById('hotbar');
  if (!bar) return;
  bar.innerHTML = '';
  hotbarEls.length = 0;
  const order = ['miner', 'chest', 'inserter', 'belt', 'oven', 'autocrafter'];
  order.forEach((type, i) => {
    const def = BUILD_DEFS[type];
    const el = document.createElement('div');
    el.className = 'hb-slot';
    el.dataset.type = type;
    el.innerHTML =
      `<div class="hb-icon">${def.icon}</div>` +
      `<span class="hb-key">${i + 1}</span>` +
      `<span class="hb-rot"></span>`;
    el.title = def.name;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      selectPlacing(type);
    });
    bar.appendChild(el);
    hotbarEls.push(el);
  });
}

// ---------------- machine-paneel (kist / miner)
const panelEl = document.getElementById('machinePanel');
const panelTitleEl = document.getElementById('machineTitle');
const panelSlotsEl = document.getElementById('machineSlots');
const legendEl = document.getElementById('machineLegend');
let panelSlots = [];

function buildPanelSlots(n, labels) {
  panelSlotsEl.innerHTML = '';
  panelSlots.length = 0;
  panelSlotsEl.classList.toggle('labeled', !!(labels && labels.length));
  for (let i = 0; i < n; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot mslot';
    slot.innerHTML = '<div class="slot-item"></div><span class="slot-count"></span>';
    slot.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.button !== 0 || !openPanel) return;
      const b = buildingsById.get(openPanel.id);
      if (!b) return;
      // uit machine pakken
      send({ t: 'grab', slot: i, src: { kind: 'm', id: b.id } });
      dragging = true;
    });
    slot.addEventListener('contextmenu', (e) => e.preventDefault());
    if (labels && labels.length) {
      const cell = document.createElement('div');
      cell.className = 'mslot-cell';
      cell.appendChild(slot);
      const cap = document.createElement('div');
      cap.className = 'slot-label';
      cap.textContent = labels[i] || '';
      cell.appendChild(cap);
      panelSlotsEl.appendChild(cell);
    } else {
      panelSlotsEl.appendChild(slot);
    }
    panelSlots.push({ el: slot, item: slot.querySelector('.slot-item'), count: slot.querySelector('.slot-count'), slotIdx: i, kind: 'm', id: null });
  }
}

let acRecipeRow = null;    // recept-keuzerij in het autocrafter-paneel
let acRecipeEls = new Map();
let acLastSlotCount = -1;

// in-slots (per materiaal van het recept) + output-slot voor de autocrafter
function acSlotCount(b) {
  const rec = b.ac && b.ac.recipe ? CRAFT_UI.find(c => c.id === b.ac.recipe) : null;
  return (rec ? rec.inputs.length : 0) + 1;
}
function acSlotLabels(b) {
  const rec = b.ac && b.ac.recipe ? CRAFT_UI.find(c => c.id === b.ac.recipe) : null;
  const labels = rec ? rec.inputs.map(([id, n]) => `${itemIcon(id)} ${n}× ${itemName(id)}`) : [];
  labels.push(`⬆ ${b.ac && b.ac.recipe ? itemName(b.ac.recipe) : 'resultaat'}`);
  return labels;
}
function buildAcRecipeRow(b) {
  if (!acRecipeRow) {
    acRecipeRow = document.createElement('div');
    acRecipeRow.className = 'ac-recipe-row';
  }
  // zorg dat de rij echt in het DOM staat (was eventueel via remove() gedetacht)
  if (acRecipeRow.parentNode !== panelSlotsEl.parentNode) {
    panelSlotsEl.parentNode.insertBefore(acRecipeRow, panelSlotsEl);
  }
  acRecipeRow.innerHTML = '';
  acRecipeEls.clear();
  const mkBtn = (key, label) => {
    const btn = document.createElement('button');
    btn.className = 'ac-recipe' + (key === (b.ac && b.ac.recipe) ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.button !== 0) return;
      if (key === (b.ac && b.ac.recipe)) return;
      send({ t: 'acreceipt', id: b.id, recipe: key }); // null = geen recept
      b.ac = b.ac || { prog: 0, recipe: null, inputs: [], out: null };
      b.ac.recipe = key; // optimistisch; server bevestigt via bupdate
      b.ac.prog = 0;
      renderPanel();
    });
    acRecipeEls.set(key, btn);
    acRecipeRow.appendChild(btn);
  };
  for (const c of CRAFT_UI) mkBtn(c.id, itemIcon(c.id) + ' ' + itemName(c.id));
  mkBtn(null, '✖ geen');
}

function openBuilding(b) {
  openPanel = { kind: b.type, id: b.id };
  panelTitleEl.textContent =
    b.type === 'chest' ? '📦 Kist' :
    b.type === 'oven' ? '🔥 Oven' :
    b.type === 'autocrafter' ? '🏭 Autocrafter' : '⛏️ Miner (interne buffer)';
  if (acRecipeRow && acRecipeRow.parentNode) acRecipeRow.remove();
  acRecipeEls.clear();
  acLastSlotCount = -1;
  if (b.type === 'autocrafter') buildAcRecipeRow(b);
  const labels = b.type === 'oven' ? ['⬇ erts in', '⬇ kool in', '⬆ staaf uit']
    : b.type === 'autocrafter' ? acSlotLabels(b) : null;
  buildPanelSlots(b.type === 'chest' ? 16 : b.type === 'oven' ? 3 : b.type === 'autocrafter' ? acSlotCount(b) : 1, labels);
  acLastSlotCount = panelSlots.length;
  if (legendEl) {
    legendEl.textContent = b.type === 'oven' ? 'erts + kool → staaf · 1 per 2 s' : '';
    legendEl.hidden = b.type === 'chest' || b.type === 'miner';
  }
  if (panelEl) panelEl.hidden = false;
  // registratie voor loslaten: slot-element -> doel
  for (const ps of panelSlots) slotRegistry.set(ps.el, { kind: 'm', id: b.id, slot: ps.slotIdx });
  renderPanel();
}

function closePanel() {
  openPanel = null;
  if (panelEl) panelEl.hidden = true;
  for (const ps of panelSlots) slotRegistry.delete(ps.el);
  if (acRecipeRow && acRecipeRow.parentNode) acRecipeRow.remove();
  acRecipeEls.clear();
}

function renderPanel() {
  if (!openPanel) return;
  const b = buildingsById.get(openPanel.id);
  if (!b) { closePanel(); return; }
  // autocrafter: recept gewisseld? → in-slots opnieuw opbouwen
  if (b.type === 'autocrafter' && panelSlots.length !== acSlotCount(b)) {
    const labels = acSlotLabels(b);
    buildPanelSlots(acSlotCount(b), labels);
    acLastSlotCount = panelSlots.length;
    for (const ps of panelSlots) slotRegistry.set(ps.el, { kind: 'm', id: b.id, slot: ps.slotIdx });
  }
  const slots = b.type === 'chest' ? (b.storage || []) :
    b.type === 'oven' ? [
      b.ore || null,
      b.fuel > 0 ? { id: 'coal', n: b.fuel } : null,
      b.out || null,
    ] :
    b.type === 'autocrafter' ? [...(b.ac ? b.ac.inputs : []), b.ac ? b.ac.out : null] :
    (b.store ? [b.store] : [null]);
  // autocrafter-paneel: recept-knoppen + voortgang bijwerken
  if (b.type === 'autocrafter') {
    for (const [key, el] of acRecipeEls) el.classList.toggle('active', key === (b.ac && b.ac.recipe));
    if (legendEl) {
      const rec = b.ac && b.ac.recipe;
      if (rec) {
        const frac = Math.min(1, Math.max(0, (b.ac.prog || 0) / AC_CRAFT_TIME));
        legendEl.textContent = `maakt ${itemName(rec)} · ${Math.floor(frac * 100)}%`;
        legendEl.hidden = false;
      } else {
        legendEl.textContent = 'kies een recept om te starten';
        legendEl.hidden = false;
      }
    }
  }
  const n = panelSlots.length;
  for (let i = 0; i < n; i++) {
    const ps = panelSlots[i];
    const s = slots[i] || null;
    if (s && ITEMS[s.id]) {
      ps.item.textContent = itemIcon(s.id);
      ps.item.style.display = 'flex';
      ps.item.style.background = RES[s.id] ? RES[s.id].color + '22' : 'transparent';
      ps.el.title = `${itemName(s.id)} × ${s.n}`;
      ps.count.textContent = s.n;
      ps.count.style.display = 'block';
    } else {
      ps.item.textContent = '';
      ps.item.style.display = 'none';
      ps.count.style.display = 'none';
      ps.el.title = '';
    }
  }
}

// ---------------- inventaris + craft (tabpaneel)
const invCraftEl = document.getElementById('invCraft');
const tabInvEl = document.getElementById('tabInv');
const tabCraftEl = document.getElementById('tabCraft');
const invTabEl = document.getElementById('invTab');
const craftTabEl = document.getElementById('craftTab');
const craftGridEl = document.getElementById('craftSlots');

function setInvCraftTab(tab) {
  if (!invCraftEl) return;
  const isInv = tab === 'inv';
  tabInvEl.classList.toggle('active', isInv);
  tabCraftEl.classList.toggle('active', !isInv);
  invTabEl.hidden = !isInv;
  craftTabEl.hidden = isInv;
}
function showInvCraft(tab) {
  if (!invCraftEl) return;
  const current = tabCraftEl.classList.contains('active') ? 'craft' : 'inv';
  if (!invCraftEl.hidden && current === tab) invCraftEl.hidden = true;
  else { invCraftEl.hidden = false; setInvCraftTab(tab); }
}
function initInvCraftTabs() {
  if (!tabInvEl || !tabCraftEl) return;
  tabInvEl.addEventListener('click', () => setInvCraftTab('inv'));
  tabCraftEl.addEventListener('click', () => setInvCraftTab('craft'));
}

// craft-badges (queue-tellers) in sync houden met de server: per recept, alleen zichtbaar als er iets in de queue zit
function setCraftBadges(counts) {
  for (const el of document.querySelectorAll('.craft-q')) {
    const n = counts[el.dataset.id] || 0;
    el.hidden = n === 0;
    if (n > 0) el.textContent = n;
  }
}

function buildCraftPanel() {
  if (!craftGridEl) return;
  craftGridEl.innerHTML = '';
  for (const c of CRAFT_UI) {
    const slot = document.createElement('div');
    slot.className = 'craft-slot';
    const icon = document.createElement('div');
    icon.className = 'craft-icon';
    icon.textContent = itemIcon(c.id);
    const q = document.createElement('div');
    q.className = 'craft-q';
    q.hidden = true; // que-teller: aantal keer geklikt
    q.dataset.id = c.id; // badge per recept koppelen
    slot.appendChild(q);
    const name = document.createElement('div');
    name.className = 'craft-name';
    name.textContent = itemName(c.id);
    slot.appendChild(icon);
    slot.appendChild(name);
    const recipe = c.inputs.map(([id, n]) => `${n}× ${itemName(id)}`).join(' + ');
    slot.title = `${itemName(c.id)} — recept: ${recipe}`;
    slot.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.button === 0) send({ t: 'craft', id: c.id });        // links = +1 in de queue
      else if (e.button === 2) send({ t: 'cunqueue', id: c.id }); // rechts = −1 uit de queue
    });
    slot.addEventListener('contextmenu', (e) => e.preventDefault());
    craftGridEl.appendChild(slot);
  }
}

// ---------------- toast
let toastEl = null, toastTimer = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// ---------------- start
buildInventory();
buildHotbar();
buildCraftPanel();
initInvCraftTabs();
const savedName = localStorage.getItem('fabriek_name') || '';
document.getElementById('nameInput').value = savedName;
document.getElementById('nameInput').focus();

function start() {
  const name = document.getElementById('nameInput').value.trim() || 'Speler';
  localStorage.setItem('fabriek_name', name);
  connect(name);
}
document.getElementById('joinBtn').addEventListener('click', start);
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start();
});

requestAnimationFrame(draw);
