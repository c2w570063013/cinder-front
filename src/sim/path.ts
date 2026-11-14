// Grid pathfinding: connected regions, fat line-of-sight, A* with a per-tick node budget.
import type { World } from '../core/types';
import { TUNE, blockedAt, type SimEntity, type SimState } from './state';

const LOS_MARGIN = 0.3;
const SQRT2 = Math.SQRT2;

/** Flood-fill connected components of passable tiles (lazy; call before reading `S.region`). */
export function ensureRegions(S: SimState): void {
  if (!S.regionDirty) return;
  S.regionDirty = false;
  const { w, h, blocked, region, stack } = S;
  const n = w * h;
  region.fill(0);
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (blocked[i] || region[i]) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = i;
    region[i] = id;
    while (sp > 0) {
      const c = stack[--sp];
      const cx = c % w;
      if (cx > 0 && !blocked[c - 1] && !region[c - 1]) {
        region[c - 1] = id;
        stack[sp++] = c - 1;
      }
      if (cx < w - 1 && !blocked[c + 1] && !region[c + 1]) {
        region[c + 1] = id;
        stack[sp++] = c + 1;
      }
      if (c >= w && !blocked[c - w] && !region[c - w]) {
        region[c - w] = id;
        stack[sp++] = c - w;
      }
      if (c < n - w && !blocked[c + w] && !region[c + w]) {
        region[c + w] = id;
        stack[sp++] = c + w;
      }
    }
  }
}

/** True if a unit can walk the straight segment (checked with a side margin so corners aren't clipped). */
export function losClear(S: SimState, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return !blockedAt(S, x0, y0);
  const steps = Math.ceil(d / 0.25);
  const ox = (-dy / d) * LOS_MARGIN;
  const oy = (dx / d) * LOS_MARGIN;
  const w = S.w;
  const h = S.h;
  const blocked = S.blocked;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (x < 0 || y < 0 || x >= w || y >= h || blocked[(y | 0) * w + (x | 0)]) return false;
    const xa = x + ox;
    const ya = y + oy;
    if (xa >= 0 && ya >= 0 && xa < w && ya < h && blocked[(ya | 0) * w + (xa | 0)]) return false;
    const xb = x - ox;
    const yb = y - oy;
    if (xb >= 0 && yb >= 0 && xb < w && yb < h && blocked[(yb | 0) * w + (xb | 0)]) return false;
  }
  return true;
}

/**
 * Nearest tile to world point (x,y) that is passable and (if region > 0) belongs to `region`.
 * Returns the tile index or -1.
 */
export function nearestTile(S: SimState, x: number, y: number, region: number): number {
  ensureRegions(S);
  const { w, h, blocked } = S;
  const reg = S.region;
  let tx = x | 0;
  let ty = y | 0;
  if (tx < 0) tx = 0;
  else if (tx >= w) tx = w - 1;
  if (ty < 0) ty = 0;
  else if (ty >= h) ty = h - 1;
  const t0 = ty * w + tx;
  if (!blocked[t0] && (region <= 0 || reg[t0] === region)) return t0;
  let best = -1;
  let bestD = Infinity;
  const maxR = Math.max(w, h);
  for (let r = 1; r <= maxR; r++) {
    if (best >= 0 && r - 1 > bestD) break;
    const x0 = tx - r;
    const x1 = tx + r;
    const y0 = ty - r;
    const y1 = ty + r;
    for (let yy = y0; yy <= y1; yy++) {
      if (yy < 0 || yy >= h) continue;
      const edgeRow = yy === y0 || yy === y1;
      const stepX = edgeRow ? 1 : 2 * r;
      for (let xx = x0; xx <= x1; xx += stepX) {
        if (xx < 0 || xx >= w) continue;
        const i = yy * w + xx;
        if (blocked[i] || (region > 0 && reg[i] !== region)) continue;
        const ddx = xx + 0.5 - x;
        const ddy = yy + 0.5 - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

function astar(S: SimState, mv: number, start: number, goal: number): number[] | null {
  const w = S.w;
  const h = S.h;
  const blocked = S.blocked;
  const cost = S.moveCost[mv];
  const g = S.aG;
  const parent = S.aParent;
  const seen = S.aSeen;
  const closed = S.aClosed;
  const hn = S.heapN;
  const hf = S.heapF;
  const cap = hn.length;
  const gen = ++S.aGen;
  const gx = goal % w;
  const gy = (goal / w) | 0;
  let size = 0;
  let expanded = 0;

  const push = (node: number, f: number): void => {
    if (size >= cap) return;
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hn[i] = hn[p];
      hf[i] = hf[p];
      i = p;
    }
    hn[i] = node;
    hf[i] = f;
  };
  const heur = (node: number): number => {
    const dx = Math.abs((node % w) - gx);
    const dy = Math.abs(((node / w) | 0) - gy);
    return dx > dy ? dx + dy * (SQRT2 - 1) : dy + dx * (SQRT2 - 1);
  };

  g[start] = 0;
  seen[start] = gen;
  parent[start] = -1;
  push(start, heur(start));
  let found = false;
  while (size > 0) {
    // pop
    const cur = hn[0];
    size--;
    if (size > 0) {
      const ln = hn[size];
      const lf = hf[size];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hn[i] = hn[c];
        hf[i] = hf[c];
        i = c;
      }
      hn[i] = ln;
      hf[i] = lf;
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    expanded++;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    const gc = g[cur];
    const cc = cost[cur];
    const left = cx > 0 && !blocked[cur - 1];
    const right = cx < w - 1 && !blocked[cur + 1];
    const up = cy > 0 && !blocked[cur - w];
    const down = cy < h - 1 && !blocked[cur + w];
    for (let k = 0; k < 8; k++) {
      let nb: number;
      let diag = false;
      switch (k) {
        case 0:
          if (!left) continue;
          nb = cur - 1;
          break;
        case 1:
          if (!right) continue;
          nb = cur + 1;
          break;
        case 2:
          if (!up) continue;
          nb = cur - w;
          break;
        case 3:
          if (!down) continue;
          nb = cur + w;
          break;
        case 4:
          if (!left || !up) continue;
          nb = cur - w - 1;
          diag = true;
          break;
        case 5:
          if (!right || !up) continue;
          nb = cur - w + 1;
          diag = true;
          break;
        case 6:
          if (!left || !down) continue;
          nb = cur + w - 1;
          diag = true;
          break;
        default:
          if (!right || !down) continue;
          nb = cur + w + 1;
          diag = true;
          break;
      }
      if (diag && blocked[nb]) continue;
      if (closed[nb] === gen) continue;
      const ng = gc + (cc + cost[nb]) * (diag ? SQRT2 * 0.5 : 0.5);
      if (seen[nb] !== gen || ng < g[nb]) {
        g[nb] = ng;
        seen[nb] = gen;
        parent[nb] = cur;
        push(nb, ng + heur(nb));
      }
    }
  }
  S.pathBudget -= expanded;
  if (!found) return null;
  const out: number[] = [];
  for (let c = goal; c !== start && c >= 0; c = parent[c]) out.push(c);
  out.reverse();
  return out;
}

/** Greedy string-pulling: drop waypoints that can be skipped in a straight (fat) line. */
function smooth(S: SimState, x: number, y: number, raw: number[], gx: number, gy: number): number[] {
  const w = S.w;
  const out: number[] = [];
  let ax = x;
  let ay = y;
  const last = raw.length - 1;
  for (let i = 0; i < last; i++) {
    const nt = raw[i + 1];
    const nx = i + 1 === last ? gx : (nt % w) + 0.5;
    const ny = i + 1 === last ? gy : ((nt / w) | 0) + 0.5;
    if (!losClear(S, ax, ay, nx, ny)) {
      const ct = raw[i];
      out.push(ct);
      ax = (ct % w) + 0.5;
      ay = ((ct / w) | 0) + 0.5;
    }
  }
  out.push(raw[last]);
  return out;
}

export function requestPath(S: SimState, e: SimEntity): void {
  if (e.pathPending) return;
  e.pathPending = true;
  S.pathQueue.push(e.id);
}

/** Resolve one unit's path now. Sets e.path (or clears e.mv when there is nowhere to go). */
function solve(world: World, S: SimState, e: SimEntity): void {
  const w = S.w;
  ensureRegions(S);
  let sx = e.x;
  let sy = e.y;
  let st = (sy | 0) * w + (sx | 0);
  let prefix = -1;
  if (S.blocked[st]) {
    // Standing on a blocked tile (should be rare): step out to the nearest free one first.
    const f = nearestTile(S, e.x, e.y, 0);
    if (f < 0) {
      e.mv = false;
      return;
    }
    prefix = f;
    st = f;
    sx = (f % w) + 0.5;
    sy = ((f / w) | 0) + 0.5;
  }
  const reg = S.region[st];
  let gx = e.rx;
  let gy = e.ry;
  if (gx < 0.01) gx = 0.01;
  else if (gx > w - 0.01) gx = w - 0.01;
  if (gy < 0.01) gy = 0.01;
  else if (gy > S.h - 0.01) gy = S.h - 0.01;
  let gt = (gy | 0) * w + (gx | 0);
  if (S.blocked[gt] || S.region[gt] !== reg) {
    gt = nearestTile(S, gx, gy, reg);
    if (gt < 0) {
      e.mv = false;
      return;
    }
    gx = (gt % w) + 0.5;
    gy = ((gt / w) | 0) + 0.5;
  }
  e.gx = gx;
  e.gy = gy;
  let path: number[] | null = null;
  if (st === gt || losClear(S, sx, sy, gx, gy)) {
    path = [gt];
    S.pathBudget -= 8;
  } else {
    // Try to reuse the path computed for a neighbour earlier this tick (group orders).
    const sp = S.sharePath;
    if (sp !== null && S.shareTick === world.tick && sp.length >= 2) {
      const ddx = S.shareSx - sx;
      const ddy = S.shareSy - sy;
      const lt = sp[sp.length - 1];
      const lx = (lt % w) + 0.5;
      const ly = ((lt / w) | 0) + 0.5;
      if (ddx * ddx + ddy * ddy < 64 && (lx - gx) * (lx - gx) + (ly - gy) * (ly - gy) < 64) {
        S.pathBudget -= 40;
        let k = -1;
        for (let c = Math.min(1, sp.length - 2); c >= 0; c--) {
          const ct = sp[c];
          if (losClear(S, sx, sy, (ct % w) + 0.5, ((ct / w) | 0) + 0.5)) {
            k = c;
            break;
          }
        }
        if (k >= 0) {
          const pt = sp[sp.length - 2];
          if (losClear(S, (pt % w) + 0.5, ((pt / w) | 0) + 0.5, gx, gy)) {
            path = sp.slice(k, sp.length - 1);
            path.push(gt);
          } else if (losClear(S, lx, ly, gx, gy)) {
            path = sp.slice(k);
            if (lt !== gt) path.push(gt);
          }
        }
      }
    }
    if (path === null) {
      const raw = astar(S, e.mvType, st, gt);
      if (raw === null || raw.length === 0) {
        e.mv = false;
        return;
      }
      path = smooth(S, sx, sy, raw, gx, gy);
      S.shareTick = world.tick;
      S.sharePath = path;
      S.shareSx = sx;
      S.shareSy = sy;
    }
  }
  if (prefix >= 0 && path[0] !== prefix) path.unshift(prefix);
  e.path = path;
  e.pi = 0;
}

/** Serve queued path requests until this tick's node budget is spent (FIFO, deterministic). */
export function processPathQueue(world: World, S: SimState): void {
  S.pathBudget = TUNE.pathNodeBudget;
  const q = S.pathQueue;
  let i = 0;
  while (i < q.length && S.pathBudget > 0) {
    const e = world.entities.get(q[i++]) as SimEntity | undefined;
    if (!e || e.dead) continue;
    e.pathPending = false;
    if (!e.mv || e.air) continue;
    solve(world, S, e);
  }
  if (i > 0) q.splice(0, i);
}
