'use strict';

// Fabriek.io — multiplayer-server (fase 2: wereld, mijnen, machines)
// Geen frameworks nodig naast express + ws. De game-state leeft hier;
// clients sturen input, de server integrateert beweging, mijnwerk en
// machines (dus geen cheats, iedereen sieht identieke wereld).

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { generateWorld, RES } = require('./world');

const PORT = process.env.PORT || 3000;
const SEED = process.env.WORLD_SEED ? Number(process.env.WORLD_SEED) : 1337;

const TICK_MS = 50;              // 20 updates per seconde
const PLAYER_SPEED = 4.2;        // tegels per seconde
const MINE_SPEED = 1.4;          // ertseenheden per seconde
const MINE_RANGE = 1.6;          // max afstand (tegelcentrum) om te minen
const WATER = 1;                 // tegelcode water (zie world.js)
const INV_SLOTS = 16;            // aantal inventaris-slots
const STACK_MAX = 100;           // max items per stapel

// --- machines
const BUILD_RANGE = 6;           // max afstand (tegelcentrum) om te bouwen
const MINER_CAP = 64;            // interne buffer van een miner
const CHEST_SLOTS = 16;          // slots in een kist
const BELT_SPEED = 1.6;          // tegels per seconde op een loopband
const BELT_GAP = 0.5;            // min. afstand tussen items op dezelfde band (congestie)
const INSERTER_HOLD  = 500;      // ms: arm beweegt pak-kant → duw-kant (of terug)
const INSERTER_RETRY = 200;      // ms: herhaal place-probe quando band vol is
const OVEN_CYCLE = 2000;         // ms per gesmolten ingot (1 erts + 1 kool -> 1 ingot)
const OVEN_OUT_CAP = 100;        // max ingot in het oven-output-slot
const AC_CRAFT_TIME = 1000;      // ms per autocrafter-item (zelfde tempo als hand-craften)
const AC_OUT_CAP = 100;          // max items in het autocrafter-outputslot
// smelt-recipes: ertstegel -> ingot (1 erts + 1 kool)
const SMELT = { copper: 'copper_ingot', iron: 'iron_ingot' };
const OVEN_FUEL = 'coal';
// hand-crafting (direct, zonder machine): materialen uit je inventaris -> resultaat.
// Data-gedreven: meer recepten = één regel hieronder.
const CRAFT_TIME = 1000;      // ms per craft-item
const CRAFT_QUEUE_MAX = 50;  // max items per craft-queue
const CRAFT = {
  copper_wire: { inputs: { copper_ingot: 1 }, output: { id: 'copper_wire', n: 1 } },
  basic_chip:  { inputs: { iron_ingot: 1, copper_wire: 1 }, output: { id: 'basic_chip', n: 1 } },
  gear:        { inputs: { iron_ingot: 1 }, output: { id: 'gear', n: 2 } },
};
const ITEM_NAMES = {
  coal: 'kolen', iron: 'ijzererts', copper: 'kopererts', stone: 'steen',
  copper_ingot: 'koperen staaf', iron_ingot: 'ijzeren staaf', copper_wire: 'koperdraad',
  basic_chip: 'basic chip', gear: 'tandwiel',
};
const itemName = (id) => ITEM_NAMES[id] || id;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // rot 0=rechts, 1=omlaag, 2=links, 3=omhoog

const world = generateWorld(SEED);
const { w: MAP_W, h: MAP_H, tiles, amount, spawn, patchOf, patches } = world;
const patchTotal = patches.map((p) => p.total); // overgebleven eenheden per veld
const tileAt = (x, y) => (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) ? tiles[y * MAP_W + x] : -1;
const isWater = (x, y) => tileAt(x, y) === WATER;

// ---------------------------------------------------------------- state
let nextId = 1;
const players = new Map(); // id -> player
const droppedItems = new Map(); // id -> {id,res,n,x,y} (items op de grond)
let nextDropId = 1;

// --- machine-state
const buildings = new Map(); // "x,y" -> building
const bById = new Map();     // id -> building
let nextBldId = 1;
let nextBeltItemId = 1;

function makePlayer(name, ws) {
  const id = nextId++;
  const p = {
    id,
    name: String(name || `Speler${id}`).slice(0, 20),
    x: spawn.x + (Math.random() - 0.5),
    y: spawn.y + (Math.random() - 0.5),
    mx: 0, my: 0,          // inrichting uit input
    mineTarget: null,     // {x,y} de geklikte tegel
    minePatch: null,      // id van het ertsveld dat gemined wordt
    mineProgress: 0,
    inv: { slots: new Array(INV_SLOTS).fill(null), cursor: null },
    mining: false,
    craftQueue: [],   // rij van recept-ids (front = bezig)
    craftProg: 0,     // ms in het huidige item
    ws,
  };
  players.set(id, p);
  return p;
}

function playerBrief(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, mining: !!p.mineTarget, inv: p.inv };
}

// ---------------------------------------------------------------- machines
function bkey(x, y) { return x + ',' + y; }

function footprint(type, x, y) {
  if (type === 'miner' || type === 'autocrafter') return [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  return [[x, y]];
}

// gebouw op tegel (ook binnen een miner-footprint)
function buildingOnTile(x, y) {
  const b = buildings.get(bkey(x, y));
  if (b) return b;
  for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]]) {
    const o = buildings.get(bkey(x + dx, y + dy));
    if (o && (o.type === 'miner' || o.type === 'autocrafter')) return o;
  }
  return null;
}

function bestPatchFor(fp) {
  const counts = new Map();
  for (const [fx, fy] of fp) {
    const pid = tiles[fy * MAP_W + fx] > 1 ? patchOf[fy * MAP_W + fx] : -1;
    if (pid >= 0 && patchTotal[pid] > 0) counts.set(pid, (counts.get(pid) || 0) + 1);
  }
  let best = -1, bn = 0;
  for (const [pid, n] of counts) if (n > bn) { bn = n; best = pid; }
  return best;
}

function canPlace(type, x, y) {
  for (const [fx, fy] of footprint(type, x, y)) {
    if (fx < 0 || fy < 0 || fx >= MAP_W || fy >= MAP_H) return { ok: false, msg: 'buiten de kaart' };
    if (isWater(fx, fy)) return { ok: false, msg: 'mag niet in het water' };
    if (buildingOnTile(fx, fy)) return { ok: false, msg: 'al bebouwd' };
    for (const q of players.values()) {
      if (Math.floor(q.x) === fx && Math.floor(q.y) === fy) return { ok: false, msg: 'er staat een speler' };
    }
  }
  if (type === 'miner' && bestPatchFor(footprint(type, x, y)) < 0) {
    return { ok: false, msg: 'een miner moet op erts staan' };
  }
  return { ok: true };
}

function makeBuilding(type, x, y, rot) {
  const b = { id: nextBldId++, type, x, y, rot };
  if (type === 'chest') b.storage = new Array(CHEST_SLOTS).fill(null);
  if (type === 'miner') { b.store = null; b.patch = -1; b.progress = 0; b.active = false; }
  if (type === 'inserter') { b.cool = 0; b.buf = null; }
  if (type === 'belt') b.items = [];
  if (type === 'oven') { b.fuel = 0; b.ore = null; b.out = null; b.progress = 0; }
  if (type === 'autocrafter') { b.recipe = null; b.inputs = []; b.out = null; b.progress = 0; }
  buildings.set(bkey(x, y), b);
  bById.set(b.id, b);
  return b;
}

function bupdate(b) {
  const m = { t: 'bupdate', id: b.id };
  if (b.type === 'chest') m.storage = b.storage;
  if (b.type === 'miner') m.store = b.store;
  if (b.type === 'inserter') m.buf = b.buf;
  if (b.type === 'oven') m.oven = { fuel: b.fuel, ore: b.ore, out: b.out };
  if (b.type === 'autocrafter') m.ac = { prog: b.progress, recipe: b.recipe, inputs: b.inputs, out: b.out };
  broadcast(m);
}

function collectBeltItems() {
  const out = [];
  for (const b of buildings.values()) {
    if (b.type !== 'belt') continue;
    for (const it of b.items) out.push({ id: it.id, res: it.res, n: it.n, x: it.x, y: it.y });
  }
  return out;
}

function dropGround(res, n, x, y) {
  const item = {
    id: nextDropId++, res, n,
    x: clamp(x, 0.2, MAP_W - 0.2),
    y: clamp(y, 0.2, MAP_H - 0.2),
  };
  droppedItems.set(item.id, item);
  broadcast({ t: 'drop', item });
}

function briefBuilding(b) {
  const o = { id: b.id, type: b.type, x: b.x, y: b.y, rot: b.rot };
  if (b.type === 'chest') o.storage = b.storage;
  if (b.type === 'miner') { o.store = b.store; o.patch = b.patch; }
  if (b.type === 'inserter') o.buf = b.buf;
  if (b.type === 'oven') { o.fuel = b.fuel; o.ore = b.ore; o.out = b.out; }
  if (b.type === 'autocrafter') { o.recipe = b.recipe; o.inputs = b.inputs; o.out = b.out; o.progress = b.progress; }
  return o;
}

// ---------------------------------------------------------------- net
const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function send(p, msg) {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(s);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const p = ws.player;
    switch (msg.t) {
      case 'join': {
        const player = p || makePlayer(msg.name, ws);
        ws.player = player;
        // nieuwe speler: volledige wereld + iedereen
        send(player, {
          t: 'init',
          you: player.id,
          world: { w: MAP_W, h: MAP_H, spawn, tiles: Array.from(tiles), amount: Array.from(amount), patches },
          players: [...players.values()].map(playerBrief),
          dropped: [...droppedItems.values()],
          buildings: [...buildings.values()].map(briefBuilding),
          beltitems: collectBeltItems(),
        });
        // anderen: aankondigen
        if (!p) broadcast({ t: 'join', p: playerBrief(player) }, player);
        chatAll(`${player.name} joined de fabriek`);
        break;
      }
      case 'input': {
        if (!p) return;
        p.mx = clamp(Math.round(msg.mx || 0), -1, 1);
        p.my = clamp(Math.round(msg.my || 0), -1, 1);
        break;
      }
      case 'mine': {
        if (!p) return;
        const x = Math.floor(msg.x), y = Math.floor(msg.y);
        if (x === p.mineTarget?.x && y === p.mineTarget?.y) return;
        const idx = y * MAP_W + x;
        const pid = tiles[idx] > 1 ? patchOf[idx] : -1;
        p.mineTarget = { x, y };
        p.minePatch = pid;
        p.mineProgress = 0;
        p.mining = pid >= 0 && patchTotal[pid] > 0 && patchInRange(p, pid);
        break;
      }
      case 'stopmine': {
        if (!p) return;
        p.mineTarget = null;
        p.minePatch = null;
        p.mineProgress = 0;
        p.mining = false;
        break;
      }
      case 'chat': {
        if (!p) return;
        const text = String(msg.text).slice(0, 200);
        if (!text) return;
        // zender heeft zijn bericht al lokaal in de chat gezet
        broadcast({ t: 'chat', from: p.name, text }, p);
        break;
      }
      case 'grab': {
        if (!p) return;
        grabFrom(p, msg.src || { kind: 'inv' }, Math.floor(msg.slot));
        sendInv(p);
        break;
      }
      case 'dropslot': {
        if (!p) return;
        dropTo(p, msg.dst || { kind: 'inv' }, Math.floor(msg.slot));
        sendInv(p);
        break;
      }
      case 'dropworld': {
        if (!p) return;
        const cur = p.inv.cursor;
        if (!cur) return;
        const a = Math.random() * Math.PI * 2;
        const item = {
          id: nextDropId++, res: cur.id, n: cur.n,
          x: clamp(p.x + Math.cos(a) * 0.4, 0.2, MAP_W - 0.2),
          y: clamp(p.y + Math.sin(a) * 0.4, 0.2, MAP_H - 0.2),
        };
        p.inv.cursor = null;
        droppedItems.set(item.id, item);
        sendInv(p);
        broadcast({ t: 'drop', item });
        break;
      }
      case 'pickup': {
        if (!p) return;
        const item = droppedItems.get(msg.id);
        if (!item) return;
        if (Math.hypot(item.x - p.x, item.y - p.y) > MINE_RANGE + 0.3) return;
        const cap = freeCapacity(p.inv, item.res);
        if (cap <= 0) return;
        const take = Math.min(cap, item.n);
        addItem(p.inv, item.res, take);
        item.n -= take;
        droppedItems.delete(msg.id);
        sendInv(p);
        if (item.n > 0) {
          broadcast({ t: 'drop', item: { id: msg.id, res: item.res, n: item.n, x: item.x, y: item.y } });
        } else {
          broadcast({ t: 'pickup', id: msg.id, by: p.id });
        }
        break;
      }
      case 'place': {
        if (!p) return;
        const { type } = msg;
        if (!['miner', 'chest', 'inserter', 'belt', 'oven', 'autocrafter'].includes(type)) return;
        const x = Math.floor(msg.x), y = Math.floor(msg.y);
        const rot = ((Math.floor(msg.rot || 0) % 4) + 4) % 4;
        const fp = footprint(type, x, y);
        const inR = fp.some(([fx, fy]) => Math.hypot(fx + 0.5 - p.x, fy + 0.5 - p.y) <= BUILD_RANGE);
        if (!inR) { send(p, { t: 'perr', msg: 'te ver weg om te bouwen' }); return; }
        const chk = canPlace(type, x, y);
        if (!chk.ok) { send(p, { t: 'perr', msg: chk.msg }); return; }
        const b = makeBuilding(type, x, y, rot);
        if (type === 'miner') b.patch = bestPatchFor(fp);
        broadcast({ t: 'place', b: briefBuilding(b) });
        break;
      }
      case 'demolish': {
        if (!p) return;
        const x = Math.floor(msg.x), y = Math.floor(msg.y);
        const b = buildingOnTile(x, y);
        if (!b) return;
        if (Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y) > BUILD_RANGE) {
          send(p, { t: 'perr', msg: 'te ver weg om te slopen' });
          return;
        }
        if (b.type === 'chest') {
          for (const s of b.storage) if (s) dropGround(s.id, s.n, b.x + 0.5, b.y + 0.5);
        }
        if (b.type === 'miner' && b.store) dropGround(b.store.id, b.store.n, b.x + 0.5, b.y + 0.5);
        if (b.type === 'belt') for (const it of b.items) dropGround(it.res, it.n, it.x, it.y);
        if (b.type === 'oven') {
          if (b.fuel > 0) dropGround(OVEN_FUEL, b.fuel, b.x + 0.5, b.y + 0.5);
          if (b.ore) dropGround(b.ore.id, b.ore.n, b.x + 0.5, b.y + 0.5);
          if (b.out) dropGround(b.out.id, b.out.n, b.x + 0.5, b.y + 0.5);
        }
        if (b.type === 'autocrafter') {
          for (const s of b.inputs) if (s && s.n > 0) dropGround(s.id, s.n, b.x + 0.5, b.y + 1.5);
          if (b.out) dropGround(b.out.id, b.out.n, b.x + 0.5, b.y + 1.5);
        }
        buildings.delete(bkey(b.x, b.y));
        bById.delete(b.id);
        broadcast({ t: 'remove', x: b.x, y: b.y, id: b.id });
        break;
      }
      case 'craft': {
        if (!p) return;
        const r = CRAFT[msg.id];
        if (!r) return;
        if (p.craftQueue.length >= CRAFT_QUEUE_MAX) { send(p, { t: 'perr', msg: 'craft-queue is vol (max 50)' }); return; }
        // controleer of de HELE queue (inclusief dit item) betaald kan worden
        const need = queueCost(p, msg.id);
        for (const [id, n] of Object.entries(need)) {
          if (countItem(p, id) < n) { send(p, { t: 'perr', msg: `niet genoeg ${itemName(id)} voor de craft-queue` }); return; }
        }
        p.craftQueue.push(msg.id);
        send(p, { t: 'cqueue', counts: queueCounts(p) });
        break;
      }
      case 'cunqueue': {
        if (!p) return;
        if (p.craftQueue.length === 0) return;
        p.craftQueue.pop();
        if (p.craftQueue.length === 0) p.craftProg = 0;
        send(p, { t: 'cqueue', counts: queueCounts(p) });
        break;
      }
      case 'acreceipt': { // autocrafter: geselecteerd recept wisselen (null = geen)
        if (!p) return;
        const b = bById.get(msg.id);
        if (!b || b.type !== 'autocrafter') return;
        const cx = b.x + 1, cy = b.y + 1; // midden van 2x2
        if (Math.hypot(cx + 0.5 - p.x, cy + 0.5 - p.y) > BUILD_RANGE) { send(p, { t: 'perr', msg: 'te ver weg' }); return; }
        if (msg.recipe !== null && !CRAFT[msg.recipe]) return;
        b.recipe = msg.recipe;
        b.progress = 0;
        // in-slots = één slot per materiaal van het recept (oude materialen gaan weg)
        b.inputs = msg.recipe
          ? Object.keys(CRAFT[msg.recipe].inputs).map((id) => ({ id, n: 0 }))
          : [];
        bupdate(b);
        break;
      }
    }
  });

  ws.on('close', () => {
    const p = ws.player;
    if (!p) return;
    players.delete(p.id);
    broadcast({ t: 'leave', id: p.id });
    chatAll(`${p.name} verliet de fabriek`);
  });
});

// totaal aantal materialen dat de craft-queue nodig heeft (optioneel +1 nieuw item)
function queueCounts(p) {
  const c = {};
  for (const id of p.craftQueue) c[id] = (c[id] || 0) + 1;
  return c;
}
function queueCost(p, extraId) {
  const need = {};
  for (const id of p.craftQueue) {
    const r = CRAFT[id];
    for (const [iid, n] of Object.entries(r.inputs)) need[iid] = (need[iid] || 0) + n;
  }
  if (extraId) {
    const r = CRAFT[extraId];
    for (const [iid, n] of Object.entries(r.inputs)) need[iid] = (need[iid] || 0) + n;
  }
  return need;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function inRange(p, tx, ty) {
  return Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) <= MINE_RANGE;
}
function patchInRange(p, pid) {
  if (pid < 0) return false;
  for (const idx of patches[pid].idxs) {
    const tx = idx % MAP_W, ty = (idx / MAP_W) | 0;
    if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) <= MINE_RANGE) return true;
  }
  return false;
}
function chatAll(text, from = 'Server') {
  broadcast({ t: 'chat', from, text: String(text).slice(0, 200) });
}

// ---------------------------------------------------------------- containers
// De speler-inventaris is {slots:[..], cursor}. Een kist is {slots:[..]}
// (zelfde slotlogica), een miner heeft één buffer-slot {id,n} (max 64).

function addItem(inv, id, n) {
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s && s.id === id && s.n < STACK_MAX) {
      const put = Math.min(STACK_MAX - s.n, n);
      s.n += put; n -= put;
      if (n <= 0) return true;
    }
  }
  for (let i = 0; i < inv.slots.length; i++) {
    if (!inv.slots[i]) {
      inv.slots[i] = { id, n: Math.min(STACK_MAX, n) };
      n -= inv.slots[i].n;
      if (n <= 0) return true;
    }
  }
  return n <= 0;
}

// Linkermuis op eigen inventaris-slot: pakken / samen voegen / wisselen.
function grabSlot(p, i) {
  const inv = p.inv;
  if (i < 0 || i >= inv.slots.length) return;
  const s = inv.slots[i];
  if (!s) { dropToSlot(p, i); return; }        // leeg slot + cursor = neerzetten
  if (!inv.cursor) {
    inv.cursor = s; inv.slots[i] = null;
  } else if (inv.cursor.id === s.id) {
    const move = Math.min(STACK_MAX - inv.cursor.n, s.n);
    inv.cursor.n += move; s.n -= move;
    if (s.n <= 0) inv.slots[i] = null;
  } else {
    inv.slots[i] = inv.cursor; inv.cursor = s;
  }
}

// Hoeveel items van een bepaalde soort nog ruimte hebben in de inventaris.
function freeCapacity(inv, id) {
  let cap = 0;
  for (const s of inv.slots) {
    if (!s) cap += STACK_MAX;
    else if (s.id === id) cap += STACK_MAX - s.n;
  }
  return cap;
}

// Totaal aantal items van een soort in de speler-inventaris.
function countItem(p, id) {
  let c = 0;
  for (const s of p.inv.slots) if (s && s.id === id) c += s.n;
  return c;
}

// Verwijder n items van een soort uit de speler-inventaris.
function removeItem(p, id, n) {
  for (let i = 0; i < p.inv.slots.length; i++) {
    const s = p.inv.slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.n, n);
    s.n -= take; n -= take;
    if (s.n <= 0) p.inv.slots[i] = null;
    if (n <= 0) return;
  }
}

function dropToSlot(p, i) {
  const inv = p.inv;
  if (!inv.cursor) return;
  const s = inv.slots[i];
  if (!s) {
    inv.slots[i] = inv.cursor; inv.cursor = null;
  } else if (s.id === inv.cursor.id) {
    const move = Math.min(STACK_MAX - s.n, inv.cursor.n);
    if (move > 0) { s.n += move; inv.cursor.n -= move; if (inv.cursor.n <= 0) inv.cursor = null; }
  } else {
    inv.slots[i] = inv.cursor; inv.cursor = s;
  }
}

function sendInv(p) { send(p, { t: 'inv', inv: p.inv }); }

// Pak een slot op (uit de inventaris of een machine) -> cursor.
function grabFrom(p, src, slot) {
  const inv = p.inv;
  if (src.kind !== 'm') { grabSlot(p, slot); return; }
  const b = bById.get(src.id);
  if (!b) return;
  if (b.type === 'chest') {
    if (slot < 0 || slot >= b.storage.length) return;
    const s = b.storage[slot];
    if (!s) { dropTo(p, { kind: 'm', id: b.id }, slot); return; }
    if (!inv.cursor) {
      inv.cursor = s; b.storage[slot] = null;
    } else if (inv.cursor.id === s.id) {
      const move = Math.min(STACK_MAX - inv.cursor.n, s.n);
      inv.cursor.n += move; s.n -= move;
      if (s.n <= 0) b.storage[slot] = null;
    } else {
      b.storage[slot] = inv.cursor; inv.cursor = s;
    }
  } else if (b.type === 'miner') {
    const s = b.store;
    if (!s) {
      if (inv.cursor) dropTo(p, { kind: 'm', id: b.id }, 0);
      return;
    }
    if (!inv.cursor) {
      const take = Math.min(STACK_MAX, s.n);
      inv.cursor = { id: s.id, n: take };
      s.n -= take;
      if (s.n <= 0) b.store = null;
    } else if (inv.cursor.id === s.id) {
      const take = Math.min(STACK_MAX - inv.cursor.n, s.n);
      inv.cursor.n += take; s.n -= take;
      if (s.n <= 0) b.store = null;
    }
  } else if (b.type === 'oven') {
    // slot 0 = ore, slot 1 = brandstof (kool, als getal), slot 2 = uitgang
    if (slot === 1) {
      if (!b.fuel) {
        if (inv.cursor) dropTo(p, { kind: 'm', id: b.id }, 1);
        return;
      }
      if (!inv.cursor) {
        const take = Math.min(STACK_MAX, b.fuel);
        inv.cursor = { id: OVEN_FUEL, n: take };
        b.fuel -= take;
      } else if (inv.cursor.id === OVEN_FUEL) {
        const take = Math.min(STACK_MAX - inv.cursor.n, b.fuel);
        inv.cursor.n += take; b.fuel -= take;
      }
    } else {
      const s = slot === 0 ? b.ore : b.out;
      if (!s) {
        if (inv.cursor) dropTo(p, { kind: 'm', id: b.id }, slot);
        return;
      }
      if (!inv.cursor) {
        const take = Math.min(STACK_MAX, s.n);
        inv.cursor = { id: s.id, n: take };
        s.n -= take;
        if (s.n <= 0) { if (slot === 0) b.ore = null; else b.out = null; }
      } else if (inv.cursor.id === s.id) {
        const take = Math.min(STACK_MAX - inv.cursor.n, s.n);
        inv.cursor.n += take; s.n -= take;
        if (s.n <= 0) { if (slot === 0) b.ore = null; else b.out = null; }
      }
    }
  } else if (b.type === 'autocrafter') {
    // slot 0..n-1 = materialen van het recept, slot n = output
    const n = b.inputs.length;
    if (slot < n) {
      const s = b.inputs[slot];
      if (!s || s.n <= 0) { if (inv.cursor) dropTo(p, { kind: 'm', id: b.id }, slot); return; }
      if (!inv.cursor) {
        const take = Math.min(STACK_MAX, s.n);
        inv.cursor = { id: s.id, n: take };
        s.n -= take;
      } else if (inv.cursor.id === s.id) {
        const take = Math.min(STACK_MAX - inv.cursor.n, s.n);
        inv.cursor.n += take; s.n -= take;
      }
    } else if (slot === n) {
      const s = b.out;
      if (!s) { if (inv.cursor) dropTo(p, { kind: 'm', id: b.id }, slot); return; }
      if (!inv.cursor) {
        const take = Math.min(STACK_MAX, s.n);
        inv.cursor = { id: s.id, n: take };
        s.n -= take;
        if (s.n <= 0) b.out = null;
      } else if (inv.cursor.id === s.id) {
        const take = Math.min(STACK_MAX - inv.cursor.n, s.n);
        inv.cursor.n += take; s.n -= take;
        if (s.n <= 0) b.out = null;
      }
    }
  } else { return; }
  bupdate(b);
}

// Cursor neerleggen in een slot (inventaris of machine).
function dropTo(p, dst, slot) {
  const inv = p.inv;
  if (dst.kind !== 'm') { dropToSlot(p, slot); return; }
  const b = bById.get(dst.id);
  if (!b || !inv.cursor) return;
  if (b.type === 'chest') {
    if (slot < 0 || slot >= b.storage.length) return;
    const s = b.storage[slot];
    if (!s) {
      b.storage[slot] = inv.cursor; inv.cursor = null;
    } else if (s.id === inv.cursor.id) {
      const move = Math.min(STACK_MAX - s.n, inv.cursor.n);
      s.n += move; inv.cursor.n -= move;
      if (inv.cursor.n <= 0) inv.cursor = null;
    } else {
      b.storage[slot] = inv.cursor; inv.cursor = s;
    }
  } else if (b.type === 'miner') {
    if (slot !== 0) return;
    if (!b.store) {
      const n = Math.min(MINER_CAP, inv.cursor.n);
      b.store = { id: inv.cursor.id, n };
      inv.cursor.n -= n;
      if (inv.cursor.n <= 0) inv.cursor = null;
    } else if (b.store.id === inv.cursor.id) {
      const move = Math.min(MINER_CAP - b.store.n, inv.cursor.n);
      if (move > 0) {
        b.store.n += move; inv.cursor.n -= move;
        if (inv.cursor.n <= 0) inv.cursor = null;
      }
    }
  } else if (b.type === 'oven') {
    // slot 0 = ore, slot 1 = brandstof (kool), slot 2 = uitgang
    if (slot === 1) {
      if (inv.cursor.id === OVEN_FUEL) {
        b.fuel += inv.cursor.n;
        inv.cursor = null;
      }
    } else if (slot === 0) {
      // alleen erts dat gesmolten kan worden, of zelfde erts samenvoegen
      if (!SMELT[inv.cursor.id]) return;
      if (!b.ore) {
        b.ore = { id: inv.cursor.id, n: 0 };
        b.ore.n += inv.cursor.n; inv.cursor = null;
      } else if (b.ore.id === inv.cursor.id) {
        b.ore.n += inv.cursor.n; inv.cursor = null;
      }
    } else if (slot === 2) {
      // alleen het bijpassende ertsluit (staaf) of zelfde soort samenvoegen
      const expected = b.ore ? SMELT[b.ore.id] : null;
      if (inv.cursor.id !== expected) return;
      if (!b.out) {
        b.out = { id: inv.cursor.id, n: 0 };
        b.out.n += inv.cursor.n; inv.cursor = null;
      } else if (b.out.id === inv.cursor.id) {
        const move = Math.min(OVEN_OUT_CAP - b.out.n, inv.cursor.n);
        if (move <= 0) return;
        b.out.n += move; inv.cursor.n -= move;
        if (inv.cursor.n <= 0) inv.cursor = null;
      }
    }
  } else if (b.type === 'autocrafter') {
    // in-slots: alleen het bijpassende item; output: alleen het recept-resultaat
    const n = b.inputs.length;
    if (slot < n) {
      const s = b.inputs[slot];
      if (!s || inv.cursor.id !== s.id) return;
      const move = Math.min(STACK_MAX - s.n, inv.cursor.n);
      if (move <= 0) return;
      s.n += move; inv.cursor.n -= move;
      if (inv.cursor.n <= 0) inv.cursor = null;
    } else if (slot === n) {
      const expected = b.recipe ? CRAFT[b.recipe].output.id : null;
      if (!expected || inv.cursor.id !== expected) return;
      if (!b.out) {
        b.out = { id: expected, n: inv.cursor.n };
        inv.cursor = null;
      } else {
        const move = Math.min(AC_OUT_CAP - b.out.n, inv.cursor.n);
        if (move <= 0) return;
        b.out.n += move; inv.cursor.n -= move;
        if (inv.cursor.n <= 0) inv.cursor = null;
      }
    }
  } else { return; }
  bupdate(b);
}

// ---------------------------------------------------------------- machine-ticks
function tickMiner(b, dt) {
  if (b.patch < 0 || patchTotal[b.patch] <= 0) { b.active = false; return; }
  const patch = patches[b.patch];
  // vol of andere soort in buffer -> pauze
  if (b.store && (b.store.n >= MINER_CAP || b.store.id !== patch.res)) {
    b.active = false;
    b.progress = 0;
    return;
  }
  b.active = true;
  b.progress += MINE_SPEED * dt;
  let got = 0;
  while (b.progress >= 1 && patchTotal[b.patch] > 0) {
    b.progress -= 1;
    patchTotal[b.patch] -= 1;
    if (!b.store) b.store = { id: patch.res, n: 0 };
    if (b.store.n >= MINER_CAP) break;
    b.store.n += 1;
    got++;
  }
  if (b.store && b.store.n >= MINER_CAP) b.progress = 0;
  if (got === 0) return;
  const frac = patchTotal[b.patch] / patch.max;
  for (const ti of patch.idxs) amount[ti] = frac;
  bupdate(b);
  if (patchTotal[b.patch] <= 0) {
    for (const ti of patch.idxs) { tiles[ti] = 0; amount[ti] = 0; }
    broadcast({ t: 'mined', x: b.x, y: b.y, res: patch.res, by: -1, patch: b.patch, left: 0, max: patch.max, cleared: true });
  } else {
    broadcast({ t: 'mined', x: b.x, y: b.y, res: patch.res, by: -1, patch: b.patch, left: patchTotal[b.patch], max: patch.max, cleared: false });
  }
}

function tickInserter(b, dt) {
  b.cool -= dt * 1000;
  if (b.cool > 0) return;
  const [gx, gy] = DIRS[b.rot];                 // kopkant: hier pakt hij
  const [px, py] = DIRS[(b.rot + 2) % 4];       // achterkant: hier duwt hij
  const gb = buildingOnTile(b.x + gx, b.y + gy);
  const pb = buildingOnTile(b.x + px, b.y + py);

  if (!b.buf) {
    // === FAZE 1: PAKKEN ===
    // Max 1 eenheid per cyclus. Na het pakken: pauze van INSERTER_HOLD ms
    // zodat de animatie de arm naar de duw-kant kan laten bewegen.
    let picked = false;
    if (gb) {
      if (gb.type === 'belt' && gb.items.length > 0) {
        let bi = 0;
        for (let i = 1; i < gb.items.length; i++) if (gb.items[i].u > gb.items[bi].u) bi = i;
        const it = gb.items[bi];
        b.buf = { res: it.res, n: 1, u: 0 };
        it.n -= 1;
        if (it.n <= 0) gb.items.splice(bi, 1);
        picked = true;
      } else if (gb.type === 'miner' && gb.store) {
        b.buf = { res: gb.store.id, n: 1, u: 0 };
        gb.store.n -= 1;
        if (gb.store.n <= 0) gb.store = null;
        bupdate(gb);
        picked = true;
      } else if (gb.type === 'chest') {
        for (let i = 0; i < gb.storage.length; i++) {
          const s = gb.storage[i];
          if (s) {
            b.buf = { res: s.id, n: 1, u: 0 };
            s.n -= 1;
            if (s.n <= 0) gb.storage[i] = null;
            bupdate(gb);
            picked = true;
            break;
          }
        }
      } else if (gb.type === 'oven' && gb.out) {
        b.buf = { res: gb.out.id, n: 1, u: 0 };
        gb.out.n -= 1;
        if (gb.out.n <= 0) gb.out = null;
        bupdate(gb);
        picked = true;
      } else if (gb.type === 'autocrafter') {
        // alleen het resultaat pakken — in-slots zijn voeding, mag de inserter niet leegzuigen
        if (gb.out) {
          b.buf = { res: gb.out.id, n: 1, u: 0 };
          gb.out.n -= 1;
          if (gb.out.n <= 0) gb.out = null;
          bupdate(gb);
          picked = true;
        }
      }
    }
    if (picked) {
      b.cool = INSERTER_HOLD; // arm beweegt naar duw-kant
      bupdate(b);
    } else {
      b.cool = 80; // niets te pakken, probeer binnenkort opnieuw
    }
  } else {
    // === FAZE 2: PLAATSEN ===
    // Probeer het vastgehouden item te plaatsen.
    // Sukt: INSERTER_HOLD ms (arm beweegt terug naar pak-kant).
    // Band vol: retry binnen INSERTER_RETRY ms (arm blijft op duw-kant met item).
    let placed = false;
    if (pb) {
      if (pb.type === 'belt') {
        const entryClear = !pb.items.some(it2 => it2.u < 0.5);
        if (entryClear) {
          const [dx, dy] = DIRS[pb.rot];
          pb.items.push({
            id: nextBeltItemId++, res: b.buf.res, n: b.buf.n, u: 0,
            x: pb.x + 0.5 - dx * 0.5, y: pb.y + 0.5 - dy * 0.5,
          });
          b.buf = null;
          placed = true;
        }
      } else if (pb.type === 'chest') {
        const space = freeCapacity({ slots: pb.storage }, b.buf.res);
        const move = Math.min(space, b.buf.n);
        if (move > 0) {
          addItem({ slots: pb.storage }, b.buf.res, move);
          b.buf.n -= move;
          if (b.buf.n <= 0) b.buf = null;
          bupdate(pb);
          placed = true;
        }
      } else if (pb.type === 'miner') {
        if (!pb.store || pb.store.id === b.buf.res) {
          const space = MINER_CAP - (pb.store ? pb.store.n : 0);
          const move = Math.min(space, b.buf.n);
          if (move > 0) {
            if (!pb.store) pb.store = { id: b.buf.res, n: 0 };
            pb.store.n += move;
            b.buf.n -= move;
            if (b.buf.n <= 0) b.buf = null;
            bupdate(pb);
            placed = true;
          }
        }
      } else if (pb.type === 'oven') {
        if (b.buf.res === OVEN_FUEL) {
          pb.fuel += b.buf.n; b.buf = null; bupdate(pb); placed = true;
        } else if (SMELT[b.buf.res] && (!pb.ore || pb.ore.id === b.buf.res)) {
          if (!pb.ore) pb.ore = { id: b.buf.res, n: 0 };
          pb.ore.n += b.buf.n; b.buf = null; bupdate(pb); placed = true;
        }
      } else if (pb.type === 'autocrafter') {
        // materiaal duwen in het bijpassende in-slot (als er nog ruimte is)
        const s = pb.inputs.find(s2 => s2.id === b.buf.res);
        if (s) {
          const move = Math.min(STACK_MAX - s.n, b.buf.n);
          if (move > 0) {
            s.n += move; b.buf.n -= move;
            if (b.buf.n <= 0) b.buf = null;
            bupdate(pb);
            placed = true;
          }
        }
      }
    }
    if (placed) {
      b.cool = INSERTER_HOLD; // arm beweegt terug naar pak-kant
      bupdate(b);
    } else {
      b.cool = INSERTER_RETRY; // band vol of geen doel: probeer binnen kort opnieuw
    }
  }
}

function tickOven(b, dt) {
  const ore = b.ore;
  const expected = ore ? SMELT[ore.id] : null;
  // kan alleen smelten als: geldig erts, kool beschikbaar, en output leeg of juiste ingot
  const canSmelt = !!ore && expected
    && b.fuel > 0
    && (!b.out || (b.out.id === expected && b.out.n < OVEN_OUT_CAP));
  if (!canSmelt) { b.progress = 0; return; }
  b.progress += dt * 1000;
  if (b.progress < OVEN_CYCLE) return;
  b.progress = 0;
  // één stap: 1 erts + 1 kool -> 1 ingot
  ore.n -= 1;
  b.fuel -= 1;
  if (ore.n <= 0) b.ore = null;
  if (!b.out) b.out = { id: expected, n: 0 };
  b.out.n += 1;
  bupdate(b);
}

// autocrafter: maakt het geselecteerde recept zolang de in-slots de materialen hebben
function tickAutocrafter(b, dt) {
  if (!b.recipe) return;
  const r = CRAFT[b.recipe];
  const outId = r.output.id;
  // output moet leeg zijn of juist dat item, met ruimte
  if (b.out && (b.out.id !== outId || b.out.n >= AC_OUT_CAP)) return;
  for (const s of b.inputs) if (s.n < r.inputs[s.id]) return; // materialen tekort
  b.progress += dt * 1000;
  if (b.progress < AC_CRAFT_TIME) return;
  b.progress -= AC_CRAFT_TIME; // resterende tijd meenemen naar het volgende item
  for (const s of b.inputs) s.n -= r.inputs[s.id];
  if (!b.out) b.out = { id: outId, n: 0 };
  b.out.n += r.output.n;
  bupdate(b);
}

function tickBelts(dt) {
  for (const b of buildings.values()) {
    if (b.type !== 'belt') continue;
    const [dx, dy] = DIRS[b.rot];

    // pick up grond-items op deze tegel (bij de ingang van de band)
    // alleen als de ingang nog vrij is, zodat er geen stapeling ontstaat
    if (!b.items.some(it2 => it2.u < 0.4)) {
      const ex = b.x + 0.5 - dx * 0.5;
      const ey = b.y + 0.5 - dy * 0.5;
      let best = null, bestD = Infinity;
      for (const item of droppedItems.values()) {
        if (Math.floor(item.x) !== b.x || Math.floor(item.y) !== b.y) continue;
        const d2 = (item.x - ex) ** 2 + (item.y - ey) ** 2;
        if (d2 < bestD) { bestD = d2; best = item; }
      }
      if (best) {
        droppedItems.delete(best.id);
        broadcast({ t: 'pickup', id: best.id });
        b.items.push({ id: best.id, res: best.res, n: best.n, u: 0, x: ex, y: ey });
      }
    }

    const step = BELT_SPEED * dt;
    // van vóór naar achter verwerken: het voorste item bepaalt of het item erachter mag doorgaan
    const ordered = b.items.slice().sort((p, q) => q.u - p.u);
    for (let k = 0; k < ordered.length; k++) {
      const it = ordered[k];
      // begrenzen door het item ervoor (min. BELT_GAP afstand) en door het einde (u=1)
      let maxU = 1;
      if (k > 0) maxU = Math.min(1, ordered[k - 1].u - BELT_GAP);
      if (maxU > it.u) it.u = Math.min(it.u + step, maxU);
      it.x = b.x + 0.5 + dx * (it.u - 0.5);
      it.y = b.y + 0.5 + dy * (it.u - 0.5);
      if (it.u < 1) continue;

      // item heeft het einde van de band bereikt
      const nx = b.x + dx, ny = b.y + dy;
      const nb = buildingOnTile(nx, ny);
      const headOn = nb && nb.type === 'belt' && DIRS[nb.rot][0] === -dx && DIRS[nb.rot][1] === -dy;
      const remove = () => b.items.splice(b.items.indexOf(it), 1);
      const wait = () => { it.u = 1; it.x = b.x + 0.5 + dx * 0.5; it.y = b.y + 0.5 + dy * 0.5; }; // band vol -> op het einde blijven staan (valt NIET af)

      // volgende loopband (niet frontaal tegemoet): alleen overdragen als de insteek-zone vrij is, anders op het einde wachten
      if (nb && nb.type === 'belt' && !headOn) {
        if (nb.items.some(x => x.u < 0.5)) { wait(); }
        else {
          const [ndx, ndy] = DIRS[nb.rot];
          remove();
          nb.items.push({ id: it.id, res: it.res, n: it.n, u: 0, x: nx + 0.5 - ndx * 0.5, y: ny + 0.5 - ndy * 0.5 });
        }
        continue;
      }
      // oven: kool -> brandstof, erts -> ore-slot; niet consumeerbaar -> op het einde blijven staan
      if (nb && nb.type === 'oven') {
        if (it.res === OVEN_FUEL) { nb.fuel += it.n; bupdate(nb); remove(); }
        else if (SMELT[it.res] && (!nb.ore || nb.ore.id === it.res)) { if (!nb.ore) nb.ore = { id: it.res, n: 0 }; nb.ore.n += it.n; bupdate(nb); remove(); }
        else wait();
        continue;
      }
      // miner: interne buffer; geen ruimte (ander type of vol) -> op het einde blijven staan
      if (nb && nb.type === 'miner') {
        if (nb.store && nb.store.id !== it.res) wait();
        else if (MINER_CAP - (nb.store ? nb.store.n : 0) > 0) { if (!nb.store) nb.store = { id: it.res, n: 0 }; nb.store.n += it.n; bupdate(nb); remove(); }
        else wait(); // vol
        continue;
      }
      // kist: ruimte voor dit type, anders op het einde blijven staan
      if (nb && nb.type === 'chest') {
        const space = freeCapacity({ slots: nb.storage }, it.res);
        if (space > 0) { addItem({ slots: nb.storage }, it.res, it.n); bupdate(nb); remove(); }
        else wait(); // vol
        continue;
      }
      // autocrafter: materiaal in het bijpassende in-slot, anders op het einde blijven staan
      if (nb && nb.type === 'autocrafter') {
        const s = nb.inputs.find(s2 => s2.id === it.res);
        if (s && STACK_MAX - s.n > 0) { const move = Math.min(STACK_MAX - s.n, it.n); s.n += move; bupdate(nb); remove(); }
        else wait(); // geen slot voor dit type of vol
        continue;
      }
      // niks aan het einde (gras/water/leeg) -> item blijft op de band staan, valt niet af
      wait();
    }
  }
}

// ---------------------------------------------------------------- tick
function tick() {
  const dt = TICK_MS / 1000;
  for (const p of players.values()) {
    // --- beweging
    let dx = p.mx, dy = p.my;
    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
    const nx = p.x + dx * PLAYER_SPEED * dt;
    const ny = p.y + dy * PLAYER_SPEED * dt;
    // bots in water / buiten de map
    if (!isWater(Math.floor(nx), Math.floor(p.y))) p.x = clamp(nx, 0.5, MAP_W - 0.5);
    if (!isWater(Math.floor(p.x), Math.floor(ny))) p.y = clamp(ny, 0.5, MAP_H - 0.5);

    // --- mijnen (een aaneengesloten ertsveld is één geheel)
    const mt = p.mineTarget;
    const pid = p.minePatch;
    if (mt && pid != null && pid >= 0) {
      const patch = patches[pid];
      if (patchTotal[pid] <= 0 || !patchInRange(p, pid)) {
        p.mineTarget = null; p.minePatch = null; p.mineProgress = 0; p.mining = false;
      } else {
        p.mining = true;
        p.mineProgress += MINE_SPEED * dt;
        let mined = 0;
        while (p.mineProgress >= 1 && patchTotal[pid] > 0) {
          p.mineProgress -= 1;
          patchTotal[pid] -= 1;
          addItem(p.inv, patch.res, 1);
          mined++;
        }
        if (mined > 0) {
          const frac = patchTotal[pid] / patch.max;
          for (const ti of patch.idxs) amount[ti] = frac; // init-state houdt actueel
          sendInv(p);
          if (patchTotal[pid] <= 0) {
            for (const ti of patch.idxs) { tiles[ti] = 0; amount[ti] = 0; }
            broadcast({ t: 'mined', x: mt.x, y: mt.y, res: patch.res, by: p.id, patch: pid, left: 0, max: patch.max, cleared: true });
            p.mineTarget = null; p.minePatch = null;
          } else {
            broadcast({ t: 'mined', x: mt.x, y: mt.y, res: patch.res, by: p.id, patch: pid, left: patchTotal[pid], max: patch.max, cleared: false });
          }
        }
      }
    }
  }

  // --- crafting queue (per speler, 1 item per CRAFT_TIME ms)
  for (const p of players.values()) {
    if (p.craftQueue.length === 0) continue;
    p.craftProg += TICK_MS;
    if (p.craftProg >= CRAFT_TIME) {
      p.craftProg -= CRAFT_TIME;   // anders lopen resterende items per tick weg (bug)
      const r = CRAFT[p.craftQueue.shift()];
      let ok = true;
      for (const [id, n] of Object.entries(r.inputs)) {
        if (countItem(p, id) < n) { ok = false; break; }
      }
      if (ok) {
        for (const [id, n] of Object.entries(r.inputs)) removeItem(p, id, n);
        addItem(p.inv, r.output.id, r.output.n);
        sendInv(p);
      } else {
        send(p, { t: 'perr', msg: 'craft-queue: te weinig materialen, item overgeslagen' });
      }
      if (p.craftQueue.length === 0) p.craftProg = 0;
      send(p, { t: 'cqueue', counts: queueCounts(p) }); // badge updaten (ook naar 0)
    }
  }

  // --- machines
  for (const b of buildings.values()) {
    if (b.type === 'miner') tickMiner(b, dt);
    else if (b.type === 'inserter') tickInserter(b, dt);
    else if (b.type === 'oven') tickOven(b, dt);
    else if (b.type === 'autocrafter') tickAutocrafter(b, dt);
  }
  tickBelts(dt);

  // posities naar iedereen
  const list = [...players.values()].map((p) => ({
    id: p.id, x: p.x, y: p.y, name: p.name,
    mining: p.mining, mt: p.mineTarget,
    craft: p.craftQueue.length
      ? { id: p.craftQueue[0], n: p.craftQueue.length, prog: p.craftProg / CRAFT_TIME }
      : 0,
  }));
  const s = JSON.stringify({ t: 'pos', players: list });
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(s);
  }

  // positie van items op loopbanden (alleen als er wat beweegt)
  let nItems = 0;
  for (const b of buildings.values()) if (b.type === 'belt') nItems += b.items.length;
  if (nItems > 0) {
    const bs = JSON.stringify({ t: 'belts', items: collectBeltItems() });
    for (const p of players.values()) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(bs);
    }
  }
}

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  console.log(`Fabriek.io draait op http://localhost:${PORT} (wereldzaad ${SEED}, ${MAP_W}x${MAP_H})`);
});
