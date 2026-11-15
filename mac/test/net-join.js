// Joining side of the two-instance bridge test (see net-host.js).
const r = { role: 'join', checks: {} };
const ok = (name, cond, detail) => { r.checks[name] = cond ? true : 'FAIL ' + (detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const mine = (e) => e.type === 'found' && e.info.includes(TOKEN);

net.browse();
const tFound0 = performance.now();
const found = await next(mine, 30000, 'found');
r.discoveryMs = Math.round(performance.now() - tFound0);
r.found = found;
ok('foundHasName', found.name === '測試房間 ' + TOKEN, found.name);
const hostId = found.id;

// A connect() to an id nobody advertised answers with closed(conn -1, hostId).
net.connect('no-such-host');
const bogus = await next((e) => e.type === 'closed' && e.hostId === 'no-such-host', 10000, 'bogus closed');
ok('bogusConnectClosed', bogus.conn === -1, bogus);

const tConn = performance.now();
net.connect(hostId);
const open = await next((e) => e.type === 'open' || (e.type === 'closed' && e.hostId === hostId), 15000, 'open');
r.connectMs = Math.round(performance.now() - tConn);
ok('open', open.type === 'open' && open.incoming === false && open.hostId === hostId, open);
const conn = open.conn;

// TXT update while hosting → 'found' again with the same id.
const updated = await next((e) => mine(e) && e.id === hostId && e.info.includes('inroom'), 15000, 'found(inroom)');
ok('infoUpdateSameId', !!updated, updated);

// 1) round trips
const rtts = [];
for (let i = 0; i < 300; i++) {
  const t0 = performance.now();
  net.send(conn, 'ping:' + i);
  await next(isMsg(conn, (t) => t === 'pong:' + i), 5000, 'pong ' + i);
  rtts.push(performance.now() - t0);
}
const rttTotal = rtts.reduce((a, b) => a + b, 0);
rtts.sort((a, b) => a - b);
const q = (p) => +rtts[Math.min(rtts.length - 1, Math.floor(p * rtts.length))].toFixed(2);
r.rttMs = { n: rtts.length, mean: +(rttTotal / rtts.length).toFixed(3), min: q(0), median: q(0.5), p95: q(0.95), max: q(0.999) };

// 2) bursts both ways, order preserved
net.send(conn, 'burst');
for (let i = 0; i < 300; i++) net.send(conn, 'c2h:' + i);
net.send(conn, 'c2h-check');
const h2c = [];
for (;;) {
  const m = await next(isMsg(conn, (t) => t.startsWith('h2c:')), 10000, 'h2c');
  if (m.text === 'h2c:done') break;
  h2c.push(+m.text.slice(4));
}
ok('h2cOrdered', h2c.length === 300 && h2c.every((v, i) => v === i), h2c.length);
const c2hRes = await next(isMsg(conn, (t) => t.startsWith('c2h-result:')), 10000, 'c2h result');
ok('c2hOrdered', c2hRes.text === 'c2h-result:300:true', c2hRes.text);

// 3) large + nasty text round trip (just under the 1 MiB limit)
const bigText = nasty(1024 * 1024 - 5); // 'echo:' + text ≤ 1 MiB, the largest frame the bridge accepts
const tBig = performance.now();
net.send(conn, 'echo:' + bigText);
const bigBack = await next(isMsg(conn, (t) => t.length > 1000), 20000, 'big echo');
r.bigBytes = utf8Len('echo:' + bigText);
r.bigRoundTripMs = Math.round(performance.now() - tBig);
ok('bigExact', bigBack.text === bigText, { got: bigBack.text.length, want: bigText.length });
const small = nasty(1) + '😀 中文 ﹏';
net.send(conn, 'echo:' + small);
const smallBack = await next(isMsg(conn, (t) => t.startsWith('燼')), 5000, 'small echo');
ok('nonAsciiExact', smallBack.text === small, smallBack.text);
net.send(conn, 'echo:'); // empty frame
const empty = await next(isMsg(conn, (t) => t === ''), 5000, 'empty echo');
ok('emptyFrame', !!empty);

// 4) oversize send is refused locally with an 'error', the connection survives
net.send(conn, 'x'.repeat(1024 * 1024 + 10));
const tooBig = await next((e) => e.type === 'error', 5000, 'oversize error');
r.oversizeError = tooBig.message;
net.send(conn, 'ping:after');
await next(isMsg(conn, (t) => t === 'pong:after'), 5000, 'pong after oversize');
ok('aliveAfterOversize', true);

// 5) send on an unknown conn is ignored quietly
net.send(987654, 'nobody');

// 6) clean close
net.close(conn);
const closed = await next((e) => e.type === 'closed' && e.conn === conn, 5000, 'local closed');
r.localClosed = closed;
ok('sendAfterCloseIgnored', (net.send(conn, 'late'), true));

// 7) abrupt kill: reconnect, ask the host to get itself killed, time the 'closed'
net.connect(hostId);
const open2 = await next((e) => e.type === 'open' || (e.type === 'closed' && e.hostId === hostId), 15000, 'open2');
ok('reconnect', open2.type === 'open' && open2.conn !== conn, open2);
net.send(open2.conn, 'killme');
const killed = await next((e) => e.type === 'closed' && e.conn === open2.conn, 30000, 'closed after kill');
r.killedClosed = { ...killed, at: Date.now() };
say('net-join: closed after kill at ' + r.killedClosed.at + ' reason ' + killed.reason);
const lost = await next((e) => e.type === 'lost' && e.id === hostId, 15000, 'lost').catch((e) => String(e));
r.lostAt = typeof lost === 'string' ? lost : Date.now();
ok('lostAfterKill', typeof lost !== 'string', lost);

// 8) reset() leaves nothing behind and is safe to repeat
net.reset();
net.reset();
await sleep(300);
r.connIds = [conn, open2.conn];
r.eventCounts = events.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
r.allOk = Object.values(r.checks).every((v) => v === true);
return r;
