// Ephemeral test: craft-queue server-side
// Voegt zelf test-items toe via het spel (join -> craft x3 -> wacht -> check inventory)
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');
let inv = null;
const t0 = Date.now();

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name: 'crafttest' }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'join' || m.t === 'state') {
    // state-melding met eigen inventaris ontvangen -> geef test-materialen via craft-queue is onmogelijk,
    // dus gebruiken we een cheat: geen. In plaats daarvan craften we 3x en verwachten we 3x perr (geen staaf).
  }
  if (m.t === 'cqueue') console.log(`[t=${(Date.now() - t0) / 1000}s] cqueue n=${m.n}`);
  if (m.t === 'perr') console.log(`[t=${(Date.now() - t0) / 1000}s] perr: ${m.msg}`);
  if (m.t === 'inv') {
    const wire = (m.slots || []).find((s) => s && s.id === 'copper_wire');
    const ingot = (m.slots || []).find((s) => s && s.id === 'copper_ingot');
    console.log(`[t=${(Date.now() - t0) / 1000}s] inv: koperdraad=${wire ? wire.n : 0} staaf=${ingot ? ingot.n : 0}`);
  }
  if (m.t === 'pos' && m.players) {
    const me = m.players.find((p) => p.name === 'crafttest');
    if (me && me.craft) console.log(`[t=${(Date.now() - t0) / 1000}s] craft: id=${me.craft.id} n=${me.craft.n} prog=${me.craft.prog.toFixed(2)}`);
  }
});

setTimeout(() => { ws.send(JSON.stringify({ t: 'craft', id: 'copper_wire' })); }, 400);
setTimeout(() => { ws.send(JSON.stringify({ t: 'craft', id: 'copper_wire' })); }, 500);
setTimeout(() => { ws.send(JSON.stringify({ t: 'cunqueue', id: 'copper_wire' })); }, 600);
setTimeout(() => {
  console.log('--- klaar, afsluiten');
  ws.close();
  process.exit(0);
}, 4000);
