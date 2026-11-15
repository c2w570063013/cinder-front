// Measures what keeps running in the page when the window is covered, minimised or the app is hidden,
// first with no LAN session, then while hosting (net active ⇒ the shell turns background throttling off).
// Run: build/CinderFront.app/Contents/MacOS/CinderFront --selftest --eval mac/test/background-ticks.js
const post = (m) => window.webkit.messageHandlers.cinder.postMessage(m);
const win = (action) => post({ type: 'testWindow', action });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wall-clock wait that does not depend on throttled timers finishing on time.
const waitWall = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) await sleep(50); };

async function measure(ms) {
  let raf = 0, t16 = 0, t50 = 0, worstGap = 0, last = performance.now(), running = true;
  const loop = () => { if (!running) return; raf++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const i16 = setInterval(() => t16++, 16);
  const i50 = setInterval(() => {
    t50++;
    const now = performance.now(); worstGap = Math.max(worstGap, now - last); last = now;
  }, 50);
  const t0 = performance.now();
  const vis = document.visibilityState;
  await waitWall(ms);
  const secs = (performance.now() - t0) / 1000;
  running = false; clearInterval(i16); clearInterval(i50);
  const rate = (n) => +(n / secs).toFixed(1);
  return { visibility: vis, hidden: document.hidden, rafPerSec: rate(raf), interval16PerSec: rate(t16), interval50PerSec: rate(t50), worstGap50Ms: Math.round(worstGap), secs: +secs.toFixed(2) };
}

const states = [
  ['visible', null, null],
  ['covered', 'cover', 'uncover'],
  ['minimized', 'miniaturize', 'deminiaturize'],
  ['appHidden', 'hide', 'unhide'],
];
const out = {};
for (const mode of ['noNet', 'hosting']) {
  if (mode === 'hosting') {
    window.cinderNative.net.host('bg-test', 'x');
    await waitWall(1500);
  }
  for (const [name, enter, leave] of states) {
    if (enter) win(enter);
    await waitWall(3000); // let the transition (and WebKit's visibility change) settle
    out[mode + '.' + name] = await measure(4000);
    if (leave) win(leave);
    await waitWall(1500);
  }
}
window.cinderNative.net.reset();
return out;
