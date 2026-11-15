// Host side of the two-instance bridge test. Echo server; after the first client closes cleanly it waits
// for a second connection, logs READY_TO_KILL and blocks until the test script kill -9's this process.
const r = { role: 'host' };
const info = (phase) => JSON.stringify({ token: TOKEN, phase });
net.browse(); // to prove our own advertisement is never reported
net.host('測試房間 ' + TOKEN, info('lobby'));
const hosting = await next((e) => e.type === 'hosting' || e.type === 'hostFailed' || e.type === 'error', 15000, 'hosting');
if (hosting.type !== 'hosting') throw new Error('host failed: ' + JSON.stringify(hosting));
r.port = hosting.port;
say('net-host: hosting on port ' + r.port);

const open = await next((e) => e.type === 'open', 60000, 'incoming open');
r.firstOpen = open;
const conn = open.conn;
net.updateInfo(info('inroom')); // the client waits for a re-emitted 'found' with this

// Echo loop: ping:N → pong:N, echo:X → X back, c2h burst checked for order, burst → 300 messages.
let c2h = 0;
let c2hOrdered = true;
// Answer straight from the event listener so the measured RTT is the bridge's, not a polling loop's.
const onNet = (ev) => {
  const e = ev.detail;
  if (e.type !== 'message' || e.conn !== conn) return;
  const t = e.text;
  if (t.startsWith('ping:')) net.send(conn, 'pong:' + t.slice(5));
  else if (t.startsWith('echo:')) net.send(conn, t.slice(5));
  else if (t.startsWith('c2h:')) { if (+t.slice(4) !== c2h) c2hOrdered = false; c2h++; }
  else if (t === 'c2h-check') net.send(conn, 'c2h-result:' + c2h + ':' + c2hOrdered);
  else if (t === 'burst') { for (let k = 0; k < 300; k++) net.send(conn, 'h2c:' + k); net.send(conn, 'h2c:done'); }
};
window.addEventListener('cinder:net', onNet);
const closedP = next((e) => e.type === 'closed' && e.conn === conn, 120000, 'first closed');
const closed = await closedP;
window.removeEventListener('cinder:net', onNet);
r.firstClosed = closed;
r.c2hReceived = c2h;
r.ownAdReported = seen((e) => e.type === 'found' && e.info.includes(TOKEN)).length;
say('net-host: phase A ' + JSON.stringify(r));

// Phase B: abrupt kill.
const open2 = await next((e) => e.type === 'open' && e.incoming, 60000, 'second open');
say('net-host: second connection ' + open2.conn);
await next(isMsg(open2.conn, (t) => t === 'killme'), 20000, 'killme');
say('READY_TO_KILL');
await sleep(120000);
return r;
