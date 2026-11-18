// Ephemeral timing-test: testgive 5 staven -> 5x craft -> log wanneer elk klaar is
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001');
const t0 = Date.now();
const s = (msg) => console.log(`[t=${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`);
let joined = false;

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'timing' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'init') { joined = true; ws.send(JSON.stringify({ t: 'testgive' })); }
  if (m.t === 'cqueue') s(`cqueue ${JSON.stringify(m.counts)}`);
  if (m.t === 'perr') s(`perr: ${m.msg}`);
  if (m.t === 'inv') {
    const slots = m.inv ? m.inv.slots : [];
    const wire = slots.find((x) => x && x.id === 'copper_wire');
    const ingot = slots.find((x) => x && x.id === 'copper_ingot');
    const chip = slots.find((x) => x && x.id === 'basic_chip');
    const iIron = slots.find((x) => x && x.id === 'iron_ingot');
    s(`inv: koperdraad=${wire ? wire.n : 0} staaf=${ingot ? ingot.n : 0} ijzerstaaf=${iIron ? iIron.n : 0} chip=${chip ? chip.n : 0}`);
  }
  if (m.t === 'pos') {
    const me = m.players.find((p) => p.name === 'timing');
    if (me && me.craft) s(`craft: n=${me.craft.n} prog=${(me.craft.prog * 100).toFixed(0)}%`);
  }
});
setTimeout(() => { if (joined) { for (let i = 0; i < 2; i++) ws.send(JSON.stringify({ t: 'craft', id: 'copper_wire' })); } }, 500);
setTimeout(() => { if (joined) ws.send(JSON.stringify({ t: 'craft', id: 'basic_chip' })); }, 2600);
setTimeout(() => { s('--- klaar'); ws.close(); process.exit(0); }, 6000);
