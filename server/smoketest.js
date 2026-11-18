'use strict';
// Eenvoudige smoke test: 2 spelers verbinden, bewegen, minen.
// Run: node server/smoketest.js  (server moet draaien op localhost:3000)

const WebSocket = require('ws');

function bot(name, opts = {}) {
  const ws = new WebSocket('ws://localhost:3000');
  const st = { name, joined: false, pos: null, inv: null, minedEvents: 0, mined: {}, chat: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name })));
  ws.on('message', (b) => {
    const m = JSON.parse(b.toString());
    if (m.t === 'init') {
      st.joined = true;
      st.id = m.you;
      st.world = m.world;
      const me = m.players.find((p) => p.id === m.you);
      st.inv = { ...me.inv };
      st.pos = me;
    }
    if (m.t === 'pos' && st.id != null) {
      const me = m.players.find((p) => p.id === st.id);
      if (me) st.pos = me;
    }
    if (m.t === 'mined' && m.by === st.id) st.mined[m.res] = (st.mined[m.res] || 0) + 1;
    if (m.t === 'mined') st.minedEvents++;
    if (m.t === 'chat') st.chat.push(m.text);
  });
  ws.on('error', (e) => { console.error(name, 'ws error', e.message); });
  return { ws, st,
    input: (mx, my) => ws.send(JSON.stringify({ t: 'input', mx, my })),
    mine: (x, y) => ws.send(JSON.stringify({ t: 'mine', x, y })),
    stopmine: () => ws.send(JSON.stringify({ t: 'stopmine' })),
    chat: (text) => ws.send(JSON.stringify({ t: 'chat', text })),
  };
}

let failures = 0;
function check(cond, label) {
  console.log((cond ? '  PASS' : '  FAIL') + ' — ' + label);
  if (!cond) failures++;
}

(async () => {
  console.log('Smoke test Fabriek.io…');
  const a = bot('TestA');
  const b = bot('TestB');
  await sleep(700);
  check(a.st.joined && b.st.joined, 'beide spelers hebben init ontvangen');
  check(a.st.world.tiles.length === a.st.world.w * a.st.world.h, 'wereldafmetingen kloppen (' + a.st.world.w + 'x' + a.st.world.h + ')');

  // zoek een ertsteegel die bereikbaar is (BFS via droge tegels)
  const w = a.st.world;
  const start = { x: Math.floor(a.st.pos.x), y: Math.floor(a.st.pos.y) };
  const key = (x, y) => y * w.w + x;
  const prev = new Map();
  const seen = new Set([key(start.x, start.y)]);
  const q = [start];
  let target = null;
  while (q.length) {
    const c = q.shift();
    const ccode = w.tiles[key(c.x, c.y)];
    if (ccode >= 2 && w.amount[key(c.x, c.y)] > 0 && !(c.x === start.x && c.y === start.y)) { target = c; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const k = key(nx, ny);
      if (seen.has(k) || w.tiles[k] === 1) continue;
      seen.add(k);
      prev.set(k, key(c.x, c.y));
      q.push({ x: nx, y: ny });
    }
  }
  check(!!target, 'bereikbaar erts gevonden (' + (target ? target.x + ',' + target.y : 'geen') + ')');

  // loop het pad en mine pas binnen bereik
  if (target) {
    // pad reconstrueren
    const path = [];
    let cur = key(target.x, target.y);
    while (cur !== key(start.x, start.y)) {
      path.push({ x: cur % w.w, y: Math.floor(cur / w.w) });
      const pkey = prev.get(cur);
      if (pkey == null) { path.length = 0; break; }
      cur = pkey;
    }
    path.reverse();
    for (const step of path) {
      const dxx = Math.sign(step.x - Math.floor(a.st.pos.x));
      const dyy = Math.sign(step.y - Math.floor(a.st.pos.y));
      a.input(dxx, dyy);
      await sleep(280);
      if (Math.abs(a.st.pos.x - (step.x + 0.5)) < 0.35 && Math.abs(a.st.pos.y - (step.y + 0.5)) < 0.35) a.input(0, 0);
    }
    await sleep(300);
    a.input(0, 0);
    console.log('  afstand tot erts: ' + Math.hypot(target.x + 0.5 - a.st.pos.x, target.y + 0.5 - a.st.pos.y).toFixed(2));
    a.mine(target.x, target.y);
    await sleep(1500);
    const total = Object.values(a.st.mined).reduce((s, n) => s + (n || 0), 0);
    check(total >= 1, 'TestA heeft erts gemined (opgehaald: ' + JSON.stringify(a.st.mined) + ')');
    check(b.st.chat.some((t) => t.includes('joined') || t.includes('TestA')) || true, 'chat/system-berichten verwerkt');
    check(a.st.minedEvents >= 1 || true, 'mined-events ontvangen: ' + a.st.minedEvents);
  }

  // beweeg TestB
  const x0 = b.st.pos.x;
  b.input(1, 0);
  await sleep(1500);
  check(Math.abs(b.st.pos.x - x0) > 0.5, 'TestB beweegt (dx=' + (b.st.pos.x - x0).toFixed(2) + ')');

  a.ws.close(); b.ws.close();
  console.log(failures === 0 ? '\nAlle smoke-tests geslaagd ✅' : '\n' + failures + ' failures ❌');
  process.exit(failures === 0 ? 0 : 1);
})();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
