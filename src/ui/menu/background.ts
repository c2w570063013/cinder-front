// Procedurally animated menu backdrop: an ash plain under a smouldering horizon, with drifting embers.
// Everything is drawn in code; nothing here is derived from any existing artwork.

export interface MenuBackground {
  start(): void;
  stop(): void;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  phase: number;
}

export function createMenuBackground(canvas: HTMLCanvasElement): MenuBackground {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let running = false;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let last = 0;
  let t = 0;
  const embers: Ember[] = [];
  let ridge: number[] = [];
  let pylons: { x: number; h: number; w: number; lean: number }[] = [];
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function layout(): void {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (cw === w && ch === h && nd === dpr) return;
    w = cw;
    h = ch;
    dpr = nd;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // jagged far ridge (fixed pseudo-random so it does not shimmer on resize)
    seed = 97531;
    ridge = [];
    const n = 90;
    let v = 0.5;
    for (let i = 0; i <= n; i++) {
      v += (rnd() - 0.5) * 0.32;
      v = Math.max(0.05, Math.min(1, v));
      ridge.push(v);
    }
    pylons = [];
    for (let i = 0; i < 9; i++) pylons.push({ x: 0.04 + rnd() * 0.92, h: 0.03 + rnd() * 0.075, w: 0.004 + rnd() * 0.007, lean: (rnd() - 0.5) * 0.25 });
  }

  function spawn(e: Ember, anywhere: boolean): void {
    const horizon = h * 0.62;
    e.x = Math.random() * w;
    e.y = anywhere ? Math.random() * h : horizon + Math.random() * (h - horizon) * 1.05;
    e.vx = (Math.random() - 0.35) * 16;
    e.vy = -(10 + Math.random() * 34);
    e.r = 0.6 + Math.random() * 1.9;
    e.max = 4 + Math.random() * 7;
    e.life = anywhere ? Math.random() * e.max : 0;
    e.phase = Math.random() * Math.PI * 2;
  }

  function frame(now: number): void {
    if (!running || !ctx) return;
    raf = requestAnimationFrame(frame);
    layout();
    if (w < 2 || h < 2) return; // hidden / zero-sized window
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0));
    last = now;
    t += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const horizon = h * 0.62;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#05070a');
    sky.addColorStop(0.55, '#0d0c10');
    sky.addColorStop(0.86, '#2a1410');
    sky.addColorStop(1, '#6b2a12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon + 1);

    // breathing glow behind the ridge
    const gx = w * (0.62 + Math.sin(t * 0.05) * 0.04);
    const pulse = 0.85 + Math.sin(t * 0.6) * 0.08 + Math.sin(t * 1.7) * 0.04;
    const glow = ctx.createRadialGradient(gx, horizon, 0, gx, horizon, Math.max(w, h) * 0.55);
    glow.addColorStop(0, `rgba(255,150,60,${0.55 * pulse})`);
    glow.addColorStop(0.25, `rgba(255,96,30,${0.22 * pulse})`);
    glow.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, horizon + 1);

    // drifting smoke bands
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 3; i++) {
      const sy = horizon * (0.5 + i * 0.16);
      const sx = ((t * (6 + i * 4) + i * 400) % (w * 2)) - w * 0.5;
      const sm = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.5);
      sm.addColorStop(0, 'rgba(20,16,18,.55)');
      sm.addColorStop(1, 'rgba(20,16,18,0)');
      ctx.fillStyle = sm;
      ctx.fillRect(0, 0, w, horizon);
    }
    ctx.globalCompositeOperation = 'source-over';

    // far ridge + broken pylons
    ctx.fillStyle = '#08090b';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 2);
    const n = ridge.length - 1;
    for (let i = 0; i <= n; i++) ctx.lineTo((i / n) * w, horizon - ridge[i] * h * 0.07);
    ctx.lineTo(w, horizon + 2);
    ctx.closePath();
    ctx.fill();
    for (const p of pylons) {
      const px = p.x * w;
      const ph = p.h * h;
      const pw = Math.max(2, p.w * w);
      ctx.beginPath();
      ctx.moveTo(px - pw, horizon + 1);
      ctx.lineTo(px - pw * 0.6 + p.lean * ph, horizon - ph);
      ctx.lineTo(px + pw * 0.5 + p.lean * ph, horizon - ph * 0.86);
      ctx.lineTo(px + pw, horizon + 1);
      ctx.closePath();
      ctx.fill();
    }

    // ground
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, '#1c0f0a');
    ground.addColorStop(0.2, '#100b0a');
    ground.addColorStop(1, '#060709');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    // survey grid receding to the horizon
    ctx.lineWidth = 1;
    const vpX = w * 0.62;
    const depth = h - horizon;
    const rows = 14;
    const scroll = (t * 0.07) % 1;
    for (let i = 0; i < rows; i++) {
      const k = (i + scroll) / rows;
      const y = horizon + depth * k * k;
      ctx.strokeStyle = `rgba(255,128,48,${0.03 + k * 0.13})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const cols = 26;
    for (let i = -cols; i <= cols; i++) {
      const bx = vpX + (i / cols) * w * 2.2;
      ctx.strokeStyle = 'rgba(255,128,48,.07)';
      ctx.beginPath();
      ctx.moveTo(vpX + (bx - vpX) * 0.02, horizon);
      ctx.lineTo(bx, h);
      ctx.stroke();
    }
    // slow scanning sweep across the plain
    const sweepK = (t * 0.11) % 1;
    const sweepY = horizon + depth * sweepK * sweepK;
    const sw = ctx.createLinearGradient(0, sweepY - 18, 0, sweepY + 2);
    sw.addColorStop(0, 'rgba(255,170,90,0)');
    sw.addColorStop(1, `rgba(255,170,90,${0.16 * (1 - sweepK)})`);
    ctx.fillStyle = sw;
    ctx.fillRect(0, sweepY - 18, w, 20);

    // embers
    const want = Math.round(Math.min(110, Math.max(40, (w * h) / 16000)));
    while (embers.length < want) {
      const e = {} as Ember;
      spawn(e, true);
      embers.push(e);
    }
    if (embers.length > want) embers.length = want;
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      e.life += dt;
      if (e.life > e.max || e.y < -10 || e.x < -20 || e.x > w + 20) spawn(e, false);
      e.x += (e.vx + Math.sin(t * 1.3 + e.phase) * 12) * dt;
      e.y += e.vy * dt;
      const k = e.life / e.max;
      const a = Math.sin(Math.min(1, k) * Math.PI) * (0.55 + 0.45 * Math.sin(t * 9 + e.phase));
      if (a <= 0.01) continue;
      const r = e.r * (1.2 - k * 0.5);
      ctx.fillStyle = `rgba(255,${150 - k * 70},${60 - k * 40},${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,120,40,${a * 0.12})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
