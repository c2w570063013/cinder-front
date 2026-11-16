// Shared helpers for the two-instance LAN bridge test (mac/test/net-selftest.sh).
// Concatenated in front of net-host.js / net-join.js and run through `--selftest --eval`.
// `__TOKEN__` is replaced per run so the two instances only ever talk to each other.
const TOKEN = '__TOKEN__';
const net = window.cinderNative && window.cinderNative.net;
if (!net) throw new Error('window.cinderNative.net missing');
if (!Object.isFrozen(window.cinderNative) || !Object.isFrozen(net)) throw new Error('bridge objects are not frozen');
const say = (...a) => window.cinderNative.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
/** Test-side listeners (window listeners never see 'cinder:net' — see below); called with each event's detail. */
const taps = new Set();
let cursor = 0;
let wake = null;
// The game's own net module (src/net) also listens for 'cinder:net' on the menu page and closes any
// connection it did not open itself — correct in the game, fatal for this raw bridge test. Capture-phase
// listeners on the target run first, so take the events here and keep them from reaching the game.
window.addEventListener('cinder:net', (e) => {
  e.stopImmediatePropagation();
  events.push(e.detail);
  for (const tap of taps) tap(e.detail);
  if (wake) { const w = wake; wake = null; w(); }
}, { capture: true });
/** Next event (after the previous match) satisfying `pred`; events skipped over stay available to `seen`. */
async function next(pred, ms = 10000, label = 'event') {
  const deadline = performance.now() + ms;
  for (;;) {
    for (; cursor < events.length; cursor++) {
      if (pred(events[cursor])) return events[cursor++];
    }
    const left = deadline - performance.now();
    if (left <= 0) throw new Error('timeout waiting for ' + label + ' — last events: ' + JSON.stringify(events.slice(-5)).slice(0, 400));
    await Promise.race([new Promise((r) => (wake = r)), sleep(Math.min(left, 250))]);
  }
}
const seen = (pred) => events.filter(pred);
const isMsg = (conn, test) => (e) => e.type === 'message' && e.conn === conn && test(e.text);
/** A long string that exercises the JSON → JS path: CJK, emoji (surrogate pairs), quotes, backslashes,
 *  line / paragraph separators, NUL, a script terminator and template-literal syntax. */
function nasty(bytesWanted) {
  const unit = '燼原戰線🔥 "quote" \'single\' \\back\\slash\\ \n\r\t    \u0000 </script> ${x} `tick` é ü ✓ ';
  const unitBytes = new TextEncoder().encode(unit).length;
  return unit.repeat(Math.max(1, Math.floor(bytesWanted / unitBytes))); // whole units: no split surrogate pairs
}
const utf8Len = (s) => new TextEncoder().encode(s).length;
