// snelle ws-smoketest voor de autocrafter
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
let joined = false, buildings = [], placedId = null;
const events = [];

ws.on('message', (data) => {
  const m = JSON.parse(data);
  if (m.t === 'init') {
    joined = true;
    buildings = m.buildings || [];
    const self = (m.players || []).find(p => p.id === m.you);
    const px = Math.floor(self.x), py = Math.floor(self.y);
    // zoek een 2x2 vlak zonder water/gebouw
    outer: for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const x = px + dx, y = py + dy;
      const ok = [ [x,y],[x+1,y],[x,y+1],[x+1,y+1] ].every(([fx,fy]) => {
        if (fx < 0 || fy < 0 || fx >= m.world.w || fy >= m.world.h) return false;
        if (m.world.tiles[fy * m.world.w + fx] === 1) return false;
        if (buildings.some(b => b.type === 'miner' || b.type === 'autocrafter'
          ? [[b.x,b.y],[b.x+1,b.y],[b.x,b.y+1],[b.x+1,b.y+1]].some(([bx,by]) => bx === fx && by === fy)
          : b.x === fx && b.y === fy)) return false;
        return true;
      });
      if (ok) { ws.send(JSON.stringify({ t: 'place', type: 'autocrafter', x, y, rot: 0 })); break outer; }
    }
  }
  if (m.t === 'place') {
    if (m.b.type === 'autocrafter' && !placedId) {
      placedId = m.b.id;
      events.push('placed id=' + placedId);
      ws.send(JSON.stringify({ t: 'acreceipt', id: placedId, recipe: 'basic_chip' }));
    }
  }
  if (m.t === 'bupdate' && m.id === placedId && m.ac) {
    events.push('bupdate recipe=' + m.ac.recipe + ' inputs=' + JSON.stringify(m.ac.inputs) + ' prog=' + m.ac.prog);
    if (m.ac.recipe === 'basic_chip' && placedId) {
      placedId = null;
      const ins = m.ac.inputs;
      events.push('slots=' + ins.map(s => s.id + ':' + s.n).join(','));
      ws.close();
      console.log('EVENTS:', events.join(' | '));
      process.exit(0);
    }
  }
});
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'ACTest' })));
ws.on('error', (e) => { console.error('WS ERROR', e.message); process.exit(1); });
setTimeout(() => { console.error('TIMEOUT', events.join(' | ')); process.exit(2); }, 5000);
