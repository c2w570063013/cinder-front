// 燼原戰線 Cinder Front — isometric Canvas 2D renderer. All art is procedural (see art-*.ts, model.ts).
import type { Camera, CreateRenderer, Renderer, ViewState } from '../core/api';
import { worldToIso } from '../core/iso';
import { type BuildingDef, type Entity, type EntityId, type Order, type Player, type PlayerId, type SimEvent, Terrain as T, type UnitDef, type World } from '../core/types';
import { BUILDINGS, SUPPORT_POWERS, UNITS, WEAPONS } from '../data';
import type { LiveCtx } from './art-buildings';
import { Fx, GK } from './fx';
import { drawMinimap, makeIcon, minimapToWorld } from './icons';
import { HH, HW, type Sprite, ZPX, makeCanvas } from './model';
import { type BuildingSprites, DIR_STEP, SpriteBank, type UnitSprites, defHeight, dirIndex, palOf } from './sprites';
import { PROP, TerrainCache, VOID_CSS } from './terrain';

/** Per-entity presentation cache. */
interface RS {
  gen: number;
  color: string;
  us: UnitSprites | null;
  bs: BuildingSprites | null;
  variant: number;
  mask: number;
  udef: UnitDef | null;
  bdef: BuildingDef | null;
  seed: number;
}

/** Last-seen snapshot of a building, shown under fog. */
interface Ghost {
  defId: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  variant: number;
  mask: number;
  /** True while the real entity is currently drawn (so the ghost is not). */
  live: boolean;
}

const IT_UNIT = 0, IT_STRIP = 1, IT_WHOLE = 2, IT_TOP = 3, IT_PROP = 4, IT_GHOST = 5;
const MAXI = 6000;
const MAXG = 1500;
const FOG_DIM = 0.47;

const REL_OWN = '#b8ffcf', REL_ALLY = '#ffe680', REL_ENEMY = '#ff6a58';

export const createRenderer: CreateRenderer = (canvas: HTMLCanvasElement): Renderer => {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  const bank = new SpriteBank();
  const terrain = new TerrainCache(bank);
  const fx = new Fx(bank);

  let cssW = canvas.clientWidth || 800, cssH = canvas.clientHeight || 600, dpr = 1;
  let lastT = -1, lastWorld: World | null = null, lastTick = -1, lastViewer: PlayerId = 0;
  let frame = 0;
  let now = 0, dt = 0, tickF = 0;
  // camera-derived, refreshed in render()
  let vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0, zoom = 1;

  const states = new Map<EntityId, RS>();
  const ghosts = new Map<EntityId, Ghost>();
  const unloadAt = new Map<EntityId, number>();
  /** Building id → time (s) its exit door was last triggered by a unit rolling out. */
  const doorAt = new Map<EntityId, number>();

  // draw list
  const keys = new Float64Array(MAXI);
  const itType = new Uint8Array(MAXI);
  const itEnt: (Entity | Ghost | null)[] = new Array(MAXI).fill(null);
  const itX = new Float32Array(MAXI), itY = new Float32Array(MAXI);
  const itA = new Int32Array(MAXI);
  let nItems = 0;
  // air units, overlay requests, building shadows
  const airE: Entity[] = [];
  const airX: number[] = [], airY: number[] = [];
  const ovE: Entity[] = [];
  const ovX: number[] = [], ovY: number[] = [], ovF: number[] = [];
  const shE: Entity[] = [];
  const shX: number[] = [], shY: number[] = [];
  // additive glow buffer
  const gX = new Float32Array(MAXG), gY = new Float32Array(MAXG), gR = new Float32Array(MAXG), gA = new Float32Array(MAXG);
  const gS: (HTMLCanvasElement | null)[] = new Array(MAXG).fill(null);
  let nGlow = 0;
  // fog
  let fogCanvas: HTMLCanvasElement | null = null;
  let fogImg: ImageData | null = null;
  let fogCur = new Float32Array(0);
  let fogOn = false, fogSettled = false, fogSnap = true;
  let fogVis: Uint8Array | null = null, fogExp: Uint8Array | null = null;
  // per-map scratch
  let propStamp = new Uint32Array(0);
  let wallGrid = new Uint8Array(0);
  let mapW = 0, mapH = 0;
  const icons = new Map<string, HTMLCanvasElement>();

  const pushGlow = (X: number, Y: number, r: number, col: string, a: number): void => {
    if (nGlow >= MAXG || a <= 0.01) return;
    gX[nGlow] = X; gY[nGlow] = Y; gR[nGlow] = r; gA[nGlow] = a > 1 ? 1 : a; gS[nGlow] = bank.glow(col);
    nGlow++;
  };

  // live-overlay context handed to building art
  let liveX = 0, liveY = 0;
  let liveE: Entity | null = null;
  const live: LiveCtx = {
    ctx, t: 0, on: true, P: palOf('#888888'), charge: 0, active: 0, seed: 0, door: 0,
    glow: (x, y, z, r, col, a) => pushGlow(liveX + (x - y) * HW, liveY + (x + y) * HH - z * ZPX, r, col, a),
    chance: (rate) => dt > 0 && Math.random() < dt * rate,
    puff: (x, y, z, kind, size) => {
      if (!liveE) return;
      if (kind === 1) fx.steam(liveE.x + x, liveE.y + y, z, size); else fx.smoke(liveE.x + x, liveE.y + y, z, kind === 2, size);
    },
    spark: (x, y, z, col, n) => { if (liveE) fx.embers(liveE.x + x, liveE.y + y, z, col, n); },
  };

  const playerOf = (world: World, id: PlayerId): Player | undefined => {
    const p = world.players[id];
    if (p && p.id === id) return p;
    for (const q of world.players) if (q.id === id) return q;
    return p;
  };
  const colorOf = (world: World, id: PlayerId): string => playerOf(world, id)?.color ?? '#9a9a9a';

  const tileVisible = (x: number, y: number): boolean => {
    if (!fogOn || !fogVis) return true;
    const tx = x | 0, ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return false;
    return fogVis[ty * mapW + tx] > 0;
  };
  const buildingVisible = (e: Entity, w: number, h: number): boolean => {
    if (!fogOn) return true;
    if (e.owner === lastViewer) return true;
    const hw = w / 2 - 0.01, hh = h / 2 - 0.01;
    return tileVisible(e.x, e.y) || tileVisible(e.x - hw, e.y - hh) || tileVisible(e.x + hw, e.y - hh) || tileVisible(e.x - hw, e.y + hh) || tileVisible(e.x + hw, e.y + hh);
  };

  const setFogSource = (world: World, viewer: PlayerId): void => {
    const pl = playerOf(world, viewer);
    fogOn = !!(world.setup.options.fog && pl && pl.visible.length === world.map.width * world.map.height);
    fogVis = fogOn ? pl!.visible : null;
    fogExp = fogOn ? pl!.explored : null;
    mapW = world.map.width; mapH = world.map.height;
  };

  const stateOf = (e: Entity): RS => {
    let s = states.get(e.id);
    if (!s) {
      s = { gen: 0, color: '', us: null, bs: null, variant: -1, mask: -1, udef: UNITS[e.defId] ?? null, bdef: BUILDINGS[e.defId] ?? null, seed: ((e.id * 2654435761) >>> 0) / 4294967296 * 6.283 };
      states.set(e.id, s);
    }
    return s;
  };

  const push = (type: number, ent: Entity | Ghost | null, depth: number, X: number, Y: number, a: number): void => {
    if (nItems >= MAXI) return;
    const i = nItems++;
    itType[i] = type; itEnt[i] = ent; itX[i] = X; itY[i] = Y; itA[i] = a;
    keys[i] = Math.floor((depth + 8) * 64) * 8192 + i;
  };

  const markProps = (world: World, tx0: number, ty0: number, tx1: number, ty1: number): void => {
    const terr = world.map.terrain;
    if (tx0 < 0) tx0 = 0; if (ty0 < 0) ty0 = 0; if (tx1 >= mapW) tx1 = mapW - 1; if (ty1 >= mapH) ty1 = mapH - 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * mapW + tx;
        const t = terr[i];
        if ((t === T.Tree || t === T.Rock) && propStamp[i] !== frame) {
          propStamp[i] = frame;
          push(IT_PROP, null, tx + ty + 1, 0, 0, i);
        }
      }
    }
  };

  /** World-space muzzle position of an entity's weapon, matching the drawn sprite. */
  const MZ = { x: 0, y: 0, z: 0 };
  const muzzle = (e: Entity, s: RS, idx: number): boolean => {
    let pivot: number[] | undefined, mz: number[][] | undefined, hasTurret = false;
    if (s.us) { pivot = s.us.art.pivot; mz = s.us.art.muzzles; hasTurret = !!s.us.art.turret; }
    else if (s.bs) { pivot = s.bs.art.pivot ?? [0, 0, 0]; mz = s.bs.art.muzzles; hasTurret = !!s.bs.art.turret; }
    if (!mz || mz.length === 0 || !pivot) return false;
    const m = mz[idx % mz.length];
    const ta = (e.kind === 'building' && !hasTurret ? e.turretFacing : dirIndex(hasTurret ? e.turretFacing : e.facing) * DIR_STEP);
    const ct = Math.cos(ta), st = Math.sin(ta);
    let x = m[0] * ct - m[1] * st, y = m[0] * st + m[1] * ct, z = m[2];
    if (hasTurret) {
      if (e.kind === 'unit') {
        const a = dirIndex(e.facing) * DIR_STEP;
        x += pivot[0] * Math.cos(a) - pivot[1] * Math.sin(a); y += pivot[0] * Math.sin(a) + pivot[1] * Math.cos(a);
      } else { x += pivot[0]; y += pivot[1]; }
      z += pivot[2];
    }
    MZ.x = e.x + x; MZ.y = e.y + y; MZ.z = e.altitude + z;
    return true;
  };

  // ───────────────────────────── entity drawing ─────────────────────────────

  const drawUnit = (world: World, e: Entity, X: number, Y: number): void => {
    const s = stateOf(e);
    const us = s.us!;
    const art = us.art;
    const def = s.udef;
    const dir = dirIndex(e.facing);
    let fr = 0;
    const fireAge = e.lastFireTick >= 0 ? tickF - e.lastFireTick : 999;
    if (art.infantry) {
      if (fireAge < 7) fr = 5;
      else if (e.action === 'move' || e.x !== e.px || e.y !== e.py) fr = 1 + (((now * 7 + s.seed * 3) | 0) & 3);
    } else if (def?.harvester && art.frames === 4) {
      fr = e.cargo <= 0 ? 0 : Math.min(3, Math.ceil((e.cargo / def.harvester.capacity) * 3));
    }
    const air = us.air;
    if (air) Y -= (e.altitude + Math.sin(now * 2.2 + s.seed) * 0.05) * ZPX;
    const hs = bank.hull(us, dir, fr);
    ctx.drawImage(hs.c, X - hs.ox, Y - hs.oy, hs.w, hs.h);
    const a = dir * DIR_STEP, ca = Math.cos(a), sa = Math.sin(a);
    // tread motion
    if (art.tracks && (e.x !== e.px || e.y !== e.py)) {
      const hw = art.tracks[0], hl = art.tracks[1] / 2 - 0.1, tz = art.tracks[2];
      ctx.strokeStyle = 'rgba(150,156,164,0.6)'; ctx.lineWidth = 2.2;
      ctx.setLineDash([2, 3.2]); ctx.lineDashOffset = -((now * 34 + s.seed * 9) % 5.2);
      ctx.beginPath();
      for (let sd = -1; sd <= 1; sd += 2) {
        const x0 = -hl * ca - sd * hw * sa, y0 = -hl * sa + sd * hw * ca, x1 = hl * ca - sd * hw * sa, y1 = hl * sa + sd * hw * ca;
        ctx.moveTo(X + (x0 - y0) * HW, Y + (x0 + y0) * HH - tz * ZPX);
        ctx.lineTo(X + (x1 - y1) * HW, Y + (x1 + y1) * HH - tz * ZPX);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    let ts: Sprite | null = null, TX = 0, TY = 0;
    if (art.turret) {
      const tdir = dirIndex(e.turretFacing);
      const ta = tdir * DIR_STEP;
      const rec = fireAge < 5 ? art.recoil * (1 - fireAge / 5) : 0;
      const px = art.pivot[0] * ca - art.pivot[1] * sa - Math.cos(ta) * rec, py = art.pivot[0] * sa + art.pivot[1] * ca - Math.sin(ta) * rec;
      ts = bank.turret(us, tdir);
      TX = X + (px - py) * HW - ts.ox; TY = Y + (px + py) * HH - art.pivot[2] * ZPX - ts.oy;
      ctx.drawImage(ts.c, TX, TY, ts.w, ts.h);
    }
    // rotors + thruster glow
    if (art.rotors) {
      const jc = def?.faction === 'ferrum' ? '#ffa640' : '#74f4ff';
      for (let i = 0; i < art.rotors.length; i++) {
        const r = art.rotors[i];
        const rx = r[0] * ca - r[1] * sa, ry = r[0] * sa + r[1] * ca;
        const cx = X + (rx - ry) * HW, cy = Y + (rx + ry) * HH - r[2] * ZPX;
        const rr = r[3] * GK;
        ctx.fillStyle = 'rgba(210,225,235,0.22)';
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr / 2, 0, 0, 6.3); ctx.fill();
        const ba = now * 31 + i * 1.3 + s.seed;
        ctx.strokeStyle = 'rgba(30,34,40,0.55)'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ba) * rr, cy - Math.sin(ba) * rr / 2); ctx.lineTo(cx + Math.cos(ba) * rr, cy + Math.sin(ba) * rr / 2);
        ctx.stroke();
      }
      if (art.jets) {
        for (const j of art.jets) {
          const jx = j[0] * ca - j[1] * sa, jy = j[0] * sa + j[1] * ca;
          pushGlow(X + (jx - jy) * HW, Y + (jx + jy) * HH - j[2] * ZPX + 5, 11 + Math.sin(now * 30 + j[1] * 9) * 2, jc, 0.7);
        }
      }
    }
    // hit flash
    if (e.lastHitTick >= 0 && tickF - e.lastHitTick < 2) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55;
      ctx.drawImage(hs.c, X - hs.ox, Y - hs.oy, hs.w, hs.h);
      if (ts) ctx.drawImage(ts.c, TX, TY, ts.w, ts.h);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // muzzle flash
    if (fireAge < 1.7 && art.flash > 0 && muzzle(e, s, e.lastFireTick)) {
      const k = 1 - fireAge / 1.7;
      const wcol = (def?.weapon && WEAPONS[def.weapon]?.color) || '#ffd98a';
      const mx = (MZ.x - e.x), my = (MZ.y - e.y);
      const FX = X + (mx - my) * HW, FY = Y + (mx + my) * HH - (MZ.z - e.altitude) * ZPX;
      pushGlow(FX, FY, art.flash * (0.7 + k * 0.6), wcol, k);
      pushGlow(FX, FY, art.flash * 0.4, '#ffffff', k);
    }
    // ambient particles
    if (dt > 0) {
      if (def && !art.infantry && !air && e.action === 'move' && Math.random() < dt * 5) fx.dust(e.x - ca * 0.4, e.y - sa * 0.4, 0.8);
      if (!art.infantry && e.hp < e.maxHp * 0.35 && Math.random() < dt * 5) fx.smoke(e.x, e.y, e.altitude + 0.3, true, 0.7);
      if (e.action === 'harvest' && Math.random() < dt * 9) fx.sparkle(e.x + ca * 0.55, e.y + sa * 0.55, 0.05, '#ff7fe0', 1, 0.15);
    }
  };

  const resolveBuilding = (world: World, e: Entity, s: RS): BuildingSprites => {
    const color = colorOf(world, e.owner);
    const def = s.bdef;
    let variant = 0;
    if (!e.powered && e.buildProgress >= 1) variant |= 1;
    const hf = e.hp / e.maxHp;
    if (hf < 0.25) variant |= 6; else if (hf < 0.5) variant |= 2;
    let mask = 0;
    if (def?.wall) {
      const tx = Math.floor(e.x), ty = Math.floor(e.y);
      const g = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < mapW && y < mapH && wallGrid[y * mapW + x] === 1;
      if (g(tx, ty - 1)) mask |= 1;
      if (g(tx + 1, ty)) mask |= 2;
      if (g(tx, ty + 1)) mask |= 4;
      if (g(tx - 1, ty)) mask |= 8;
    }
    if (!s.bs || s.gen !== bank.gen || s.variant !== variant || s.mask !== mask || s.color !== color) {
      s.bs = bank.building(e.defId, color, variant, mask);
      s.gen = bank.gen; s.variant = variant; s.mask = mask; s.color = color;
    }
    return s.bs;
  };

  const footClip = (X: number, Y: number, w: number, h: number): void => {
    const hw = w / 2, hh = h / 2;
    ctx.beginPath();
    ctx.moveTo(X + (-hw - hh) * HW - 80, Y + (-hw + hh) * HH);
    ctx.lineTo(X + (-hw - hh) * HW, Y + (-hw + hh) * HH);
    ctx.lineTo(X + (hw - hh) * HW, Y + (hw + hh) * HH);
    ctx.lineTo(X + (hw + hh) * HW, Y + (hw - hh) * HH);
    ctx.lineTo(X + (hw + hh) * HW + 80, Y + (hw - hh) * HH);
    ctx.lineTo(X + (hw + hh) * HW + 80, Y - 600);
    ctx.lineTo(X + (-hw - hh) * HW - 80, Y - 600);
    ctx.closePath();
    ctx.clip();
  };

  /** Footprint diamond lifted `zpx` iso px above the ground (path only). */
  const footDiamond = (X: number, Y: number, w: number, h: number, zpx: number, grow = 0): void => {
    const hw = w / 2 + grow, hh = h / 2 + grow;
    ctx.beginPath();
    ctx.moveTo(X + (-hw + hh) * HW, Y + (-hw - hh) * HH - zpx);
    ctx.lineTo(X + (hw + hh) * HW, Y + (hw - hh) * HH - zpx);
    ctx.lineTo(X + (hw - hh) * HW, Y + (hw + hh) * HH - zpx);
    ctx.lineTo(X + (-hw - hh) * HW, Y + (-hw + hh) * HH - zpx);
    ctx.closePath();
  };

  /** A building under construction: it is assembled layer by layer inside a scaffold. */
  const drawBuildingWhole = (world: World, e: Entity, X: number, Y: number): void => {
    const s = stateOf(e);
    const bs = s.bs!;
    const sp = bs.body;
    if (e.buildProgress >= 1) {
      ctx.drawImage(sp.c, X - sp.ox, Y - sp.oy, sp.w, sp.h);
      return;
    }
    const p = Math.max(0, e.buildProgress);
    const ferrum = bs.ferrum;
    const w = bs.w, h = bs.h;
    const topPx = bs.height * ZPX;
    // everything below the work plane is finished; the work plane is a footprint diamond rising with progress
    const zCut = p * (topPx + 6);
    // screen-space cut: finished part = sprite rows below the far (top) edge of the lifted diamond's centre line
    const yCut = Y - zCut;
    const top = Y - sp.oy, bottom = top + sp.h;
    const rail = ferrum ? 'rgba(46,40,36,0.9)' : 'rgba(150,240,255,0.55)';
    const scaffold = (front: boolean): void => {
      // corner poles + decks every 0.5 tile up to just above the work plane
      const zTop = Math.min(topPx + 10, zCut + 12);
      const cs = front ? [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2]] : [[-w / 2, -h / 2]];
      ctx.strokeStyle = rail; ctx.lineWidth = ferrum ? 1.6 : 1.1;
      ctx.beginPath();
      for (const [cx, cy] of cs) {
        const px = X + (cx - cy) * HW, py = Y + (cx + cy) * HH;
        ctx.moveTo(px, py); ctx.lineTo(px, py - zTop);
      }
      ctx.stroke();
      if (front) {
        ctx.strokeStyle = ferrum ? 'rgba(233,191,61,0.75)' : 'rgba(150,240,255,0.32)'; ctx.lineWidth = 1;
        for (let z = 18; z < zTop; z += 18) {
          // the two front edges of the deck at this level
          ctx.beginPath();
          ctx.moveTo(X + (-w / 2 - h / 2) * HW, Y + (-w / 2 + h / 2) * HH - z);
          ctx.lineTo(X + (w / 2 - h / 2) * HW, Y + (w / 2 + h / 2) * HH - z);
          ctx.lineTo(X + (w / 2 + h / 2) * HW, Y + (w / 2 - h / 2) * HH - z);
          ctx.stroke();
        }
      }
    };
    // foundation outline + back scaffold
    footDiamond(X, Y, w, h, 0);
    ctx.fillStyle = ferrum ? 'rgba(40,34,30,0.55)' : 'rgba(40,60,80,0.45)'; ctx.fill();
    scaffold(false);
    // ghost of the finished structure above the work plane
    const cutRow = Math.max(0, Math.min(sp.h, yCut - top));
    if (cutRow > 0) {
      ctx.globalAlpha = (ferrum ? 0.1 : 0.16) + 0.04 * Math.sin(now * 5 + s.seed);
      ctx.drawImage(sp.c, 0, 0, sp.c.width, cutRow * sp.s, X - sp.ox, top, sp.w, cutRow);
      ctx.globalAlpha = 1;
    }
    // finished part
    if (cutRow < sp.h) ctx.drawImage(sp.c, 0, cutRow * sp.s, sp.c.width, (sp.h - cutRow) * sp.s, X - sp.ox, top + cutRow, sp.w, bottom - (top + cutRow));
    // work plane
    footDiamond(X, Y, w, h, zCut, 0.04);
    if (ferrum) {
      ctx.strokeStyle = 'rgba(233,191,61,0.85)'; ctx.lineWidth = 1.6; ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(116,244,255,${0.07 + 0.04 * Math.sin(now * 6 + s.seed)})`; ctx.fill();
      ctx.strokeStyle = 'rgba(170,250,255,0.9)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    scaffold(true);
    // welders / fabricator heads crawling along the work plane
    const col = ferrum ? '#ffd76a' : '#74f4ff';
    for (let i = 0; i < 3; i++) {
      const u = (now * (0.22 + i * 0.07) + s.seed + i * 0.37) % 1;
      // walk the diamond's two front edges
      const k = u * 2;
      const lx = k < 1 ? -w / 2 + k * w : w / 2, ly = k < 1 ? h / 2 : h / 2 - (k - 1) * h;
      const px = X + (lx - ly) * HW, py = Y + (lx + ly) * HH - zCut;
      const fl = ferrum ? (Math.sin(now * 37 + i * 5 + s.seed) > 0.1 ? 1 : 0.15) : 0.8;
      pushGlow(px, py, ferrum ? 11 : 9, col, fl);
      if (dt > 0 && ferrum && fl > 0.5 && Math.random() < dt * 9) fx.embers(e.x + lx, e.y + ly, zCut / ZPX, col, 1);
    }
    if (!ferrum) pushGlow(X, Y - zCut, (w + h) * HW * 0.42, col, 0.12);
    if (dt > 0 && Math.random() < dt * 3) fx.dust(e.x + (Math.random() - 0.5) * w, e.y + h / 2, 0.8);
  };

  const drawStrip = (e: Entity, X: number, Y: number, j: number): void => {
    const bs = stateOf(e).bs!;
    const sp = bs.body;
    const n = bs.w + bs.h;
    const left = (-n * HW) / 2;
    let x0 = j === 0 ? -sp.ox : left + j * HW;
    let x1 = j === n - 1 ? sp.w - sp.ox : left + (j + 1) * HW;
    if (x0 < -sp.ox) x0 = -sp.ox;
    if (x1 > sp.w - sp.ox) x1 = sp.w - sp.ox;
    if (x1 <= x0) return;
    ctx.drawImage(sp.c, (x0 + sp.ox) * sp.s, 0, (x1 - x0) * sp.s, sp.c.height, X + x0, Y - sp.oy, x1 - x0, sp.h);
  };

  /** Turret + animated overlay + ambient particles of an operational building. */
  const drawBuildingTop = (world: World, e: Entity, X: number, Y: number): void => {
    const s = stateOf(e);
    const bs = s.bs!;
    const art = bs.art;
    const def = s.bdef;
    const fireAge = e.lastFireTick >= 0 ? tickF - e.lastFireTick : 999;
    let ts: Sprite | null = null, TX = 0, TY = 0;
    if (art.turret && art.pivot) {
      const tdir = dirIndex(e.turretFacing);
      const ta = tdir * DIR_STEP;
      const rec = fireAge < 5 ? (art.recoil ?? 0) * (1 - fireAge / 5) : 0;
      const px = art.pivot[0] - Math.cos(ta) * rec, py = art.pivot[1] - Math.sin(ta) * rec;
      ts = bank.turret(bs, tdir);
      TX = X + (px - py) * HW - ts.ox; TY = Y + (px + py) * HH - art.pivot[2] * ZPX - ts.oy;
      ctx.drawImage(ts.c, TX, TY, ts.w, ts.h);
      if (!e.powered) {
        // dead turret: darken it in place
        ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.65;
        ctx.drawImage(ts.c, TX, TY, ts.w, ts.h);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }
    if (art.live) {
      const owner = playerOf(world, e.owner);
      live.t = now; live.on = e.powered; live.P = bs.pal; live.seed = s.seed;
      live.charge = 0; live.active = 0; live.door = 0;
      liveE = e;
      const d = doorAt.get(e.id);
      if (d !== undefined) {
        const a = now - d;
        if (a > 3.4 || a < 0) doorAt.delete(e.id);
        else live.door = a < 0.45 ? a / 0.45 : a < 2.5 ? 1 : 1 - (a - 2.5) / 0.9;
      }
      if (def?.supportPower && owner) {
        for (const p of owner.powers) if (p.sourceId === e.id || (p.id === def.supportPower && owner.powers.length === 1)) { live.charge = p.ready ? 1 : p.chargeMax > 0 ? p.charge / p.chargeMax : 0; break; }
      }
      if (def?.refinery) {
        const u = unloadAt.get(e.id);
        if (u !== undefined) live.active = Math.max(0, 1 - (now - u) / 1.6);
      } else if (def?.produces && owner) {
        for (const c of def.produces) { const q = owner.queues[c]; if (q && q.items.length > 0 && !q.paused && c !== 'structure' && c !== 'defense') live.active = 1; }
      }
      liveX = X; liveY = Y;
      ctx.translate(X, Y);
      art.live(live);
      ctx.translate(-X, -Y);
    }
    if (e.lastHitTick >= 0 && tickF - e.lastHitTick < 2) {
      const sp = bs.body;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3;
      ctx.drawImage(sp.c, X - sp.ox, Y - sp.oy, sp.w, sp.h);
      if (ts) ctx.drawImage(ts.c, TX, TY, ts.w, ts.h);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (fireAge < 1.7 && (art.flash ?? 0) > 0 && muzzle(e, s, e.lastFireTick)) {
      const k = 1 - fireAge / 1.7;
      const wcol = (def?.weapon && WEAPONS[def.weapon]?.color) || '#ffd98a';
      const mx = MZ.x - e.x, my = MZ.y - e.y;
      pushGlow(X + (mx - my) * HW, Y + (mx + my) * HH - MZ.z * ZPX, art.flash! * (0.7 + k * 0.6), wcol, k);
      pushGlow(X + (mx - my) * HW, Y + (mx + my) * HH - MZ.z * ZPX, art.flash! * 0.4, '#ffffff', k);
    }
    if (dt > 0) {
      if (art.smoke && e.powered) {
        for (const p of art.smoke) {
          if (Math.random() >= dt * 4.5) continue;
          const kind = p[3] ?? 0, size = p[4] ?? 0.8;
          if (kind === 1) fx.steam(e.x + p[0], e.y + p[1], p[2], size); else fx.smoke(e.x + p[0], e.y + p[1], p[2], kind === 2, size);
        }
      }
    }
    // battle damage: fixed fires on the wounds, black smoke, sparks from torn wiring
    const hf = e.hp / e.maxHp;
    if (hf < 0.5) {
      const heavy = hf < 0.25;
      const hot = bs.hot;
      const fires = Math.min(hot.length, heavy ? 3 : 1);
      for (let i = 0; i < fires; i++) {
        const p = hot[i];
        const fl = 0.7 + 0.3 * Math.sin(now * 11 + i * 2.1 + s.seed) * Math.sin(now * 5.3 + i);
        pushGlow(X + (p[0] - p[1]) * HW, Y + (p[0] + p[1]) * HH - p[2] * ZPX, heavy ? 22 : 15, '#ff8a2a', (heavy ? 0.75 : 0.5) * fl);
        if (dt > 0) {
          if (Math.random() < dt * (heavy ? 9 : 4)) fx.flame(e.x + p[0], e.y + p[1], p[2], heavy ? 1.2 : 0.8);
          if (Math.random() < dt * (heavy ? 5 : 2.5)) fx.smoke(e.x + p[0], e.y + p[1], p[2] + 0.15, true, heavy ? 1.2 : 0.9);
        }
      }
      if (dt > 0 && hot.length > 1 && Math.random() < dt * (heavy ? 3 : 1.2)) {
        const p = hot[1 + ((Math.random() * (hot.length - 1)) | 0)];
        const col = bs.ferrum ? '#ffd060' : '#bff6ff';
        fx.embers(e.x + p[0], e.y + p[1], p[2], col, 3);
        fx.glowPulse(e.x + p[0], e.y + p[1], p[2], col, 16, 0.12);
      }
    }
    liveE = null;
  };

  const drawGhost = (g: Ghost, X: number, Y: number): void => {
    const bs = bank.building(g.defId, g.color, g.variant | 1, g.mask);
    const sp = bs.body;
    ctx.drawImage(sp.c, X - sp.ox, Y - sp.oy, sp.w, sp.h);
    if (bs.art.turret && bs.art.pivot) {
      const ts = bank.turret(bs, 4);
      ctx.drawImage(ts.c, X + (bs.art.pivot[0] - bs.art.pivot[1]) * HW - ts.ox, Y + (bs.art.pivot[0] + bs.art.pivot[1]) * HH - bs.art.pivot[2] * ZPX - ts.oy, ts.w, ts.h);
    }
  };

  // ───────────────────────────── fog ─────────────────────────────

  const updateFog = (world: World): void => {
    const W = world.map.width, H = world.map.height;
    const fw = W + 2, fh = H + 2;
    if (!fogCanvas || fogCanvas.width !== fw || fogCanvas.height !== fh) {
      fogCanvas = makeCanvas(fw, fh);
      fogImg = fogCanvas.getContext('2d')!.createImageData(fw, fh);
      const d = fogImg.data;
      for (let i = 0; i < fw * fh; i++) { d[i * 4] = 6; d[i * 4 + 1] = 8; d[i * 4 + 2] = 13; d[i * 4 + 3] = 255; }
      fogCur = new Float32Array(W * H).fill(1);
      fogSnap = true;
    }
    if (fogSettled && !fogSnap) return;
    const vis = fogVis!, exp = fogExp!;
    const d = fogImg!.data;
    const k = fogSnap ? 1 : Math.min(1, dt * 7);
    let moving = false;
    for (let i = 0, n = W * H; i < n; i++) {
      const target = vis[i] > 0 ? 0 : exp[i] > 0 ? FOG_DIM : 1;
      const c = fogCur[i];
      const df = target - c;
      if (df !== 0) {
        if (df > -0.01 && df < 0.01) fogCur[i] = target; else { fogCur[i] = c + df * k; moving = true; }
      }
    }
    // 3×3 tent blur into the texture → round, soft fog edges instead of tile stair-steps
    for (let ty = 0; ty < H; ty++) {
      let o = ((ty + 1) * fw + 1) * 4 + 3;
      const up = ty > 0 ? -W : 0, dn = ty < H - 1 ? W : 0;
      for (let tx = 0, i = ty * W; tx < W; tx++, i++, o += 4) {
        const l = tx > 0 ? -1 : 0, r = tx < W - 1 ? 1 : 0;
        const v = fogCur[i] * 4 + (fogCur[i + l] + fogCur[i + r] + fogCur[i + up] + fogCur[i + dn]) * 2 + fogCur[i + up + l] + fogCur[i + up + r] + fogCur[i + dn + l] + fogCur[i + dn + r];
        d[o] = v * 15.9375;
      }
    }
    fogCanvas.getContext('2d')!.putImageData(fogImg!, 0, 0);
    fogSettled = !moving;
    fogSnap = false;
  };

  // ───────────────────────────── overlays ─────────────────────────────

  const relColor = (world: World, viewer: PlayerId, owner: PlayerId): string => {
    if (owner === viewer) return REL_OWN;
    const a = playerOf(world, viewer), b = playerOf(world, owner);
    return a && b && a.team === b.team ? REL_ALLY : REL_ENEMY;
  };

  const orderPoint = (world: World, o: Order, out: { x: number; y: number }): boolean => {
    switch (o.type) {
      case 'move': case 'attackMove': out.x = o.x; out.y = o.y; return true;
      case 'attack': case 'dock': case 'capture': {
        const t = world.entities.get(o.targetId);
        if (!t) return false;
        out.x = t.x; out.y = t.y; return true;
      }
      case 'harvest': if (o.tx === null || o.ty === null) return false; out.x = o.tx + 0.5; out.y = o.ty + 0.5; return true;
      default: return false;
    }
  };
  const orderColor = (o: Order): string => (o.type === 'attack' || o.type === 'attackMove' ? '#ff6a58' : o.type === 'harvest' || o.type === 'dock' ? '#ff8fe4' : o.type === 'capture' ? '#ffd84a' : '#6cf08e');

  const OP = { x: 0, y: 0 };

  /** Ground-plane overlays drawn in iso space (after fog). */
  const drawWorldOverlays = (world: World, view: ViewState): void => {
    const lw = 1 / zoom;
    // order + rally lines for the selection
    if (view.selection.size > 0 && view.selection.size <= 80) {
      ctx.lineCap = 'round';
      for (const id of view.selection) {
        const e = world.entities.get(id);
        if (!e || e.owner !== view.viewer) continue;
        if (e.kind === 'building') {
          if (!e.rally) continue;
          const X0 = (e.x - e.y) * HW, Y0 = (e.x + e.y) * HH, X1 = (e.rally.x - e.rally.y) * HW, Y1 = (e.rally.x + e.rally.y) * HH;
          ctx.strokeStyle = 'rgba(255,230,120,0.75)'; ctx.lineWidth = 1.5 * lw;
          ctx.setLineDash([6 * lw, 5 * lw]); ctx.lineDashOffset = -now * 14 * lw;
          ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
          ctx.setLineDash([]);
          // flag
          ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 1.6 * lw;
          ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X1, Y1 - 20 * lw); ctx.stroke();
          ctx.fillStyle = colorOf(world, e.owner);
          ctx.beginPath(); ctx.moveTo(X1, Y1 - 20 * lw); ctx.lineTo(X1 + 11 * lw, Y1 - 16 * lw); ctx.lineTo(X1, Y1 - 12 * lw); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(255,230,120,0.8)';
          ctx.beginPath(); ctx.ellipse(X1, Y1, 7 * lw, 3.5 * lw, 0, 0, 6.3); ctx.stroke();
          continue;
        }
        if (!e.order) continue;
        let px = e.px + (e.x - e.px) * alphaF, py = e.py + (e.y - e.py) * alphaF;
        let o: Order | undefined = e.order;
        let qi = 0;
        while (o) {
          if (orderPoint(world, o, OP)) {
            const c = orderColor(o);
            ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.3 * lw;
            ctx.beginPath(); ctx.moveTo((px - py) * HW, (px + py) * HH); ctx.lineTo((OP.x - OP.y) * HW, (OP.x + OP.y) * HH); ctx.stroke();
            ctx.globalAlpha = 0.85; ctx.fillStyle = c;
            const X = (OP.x - OP.y) * HW, Y = (OP.x + OP.y) * HH;
            ctx.beginPath(); ctx.moveTo(X, Y - 3 * lw); ctx.lineTo(X + 5 * lw, Y); ctx.lineTo(X, Y + 3 * lw); ctx.lineTo(X - 5 * lw, Y); ctx.closePath(); ctx.fill();
            px = OP.x; py = OP.y;
          }
          o = e.queue[qi++];
        }
        ctx.globalAlpha = 1;
      }
    }
    // placement ghost
    const pl = view.placement;
    if (pl) {
      const def = BUILDINGS[pl.defId];
      for (const c of pl.check.cells) {
        const X = (c.tx - c.ty) * HW, Y = (c.tx + c.ty) * HH;
        ctx.beginPath(); ctx.moveTo(X, Y + 1); ctx.lineTo(X + HW - 2, Y + HH); ctx.lineTo(X, Y + TILE2 - 1); ctx.lineTo(X - HW + 2, Y + HH); ctx.closePath();
        ctx.fillStyle = c.ok ? 'rgba(80,235,130,0.38)' : 'rgba(245,70,60,0.45)'; ctx.fill();
        ctx.strokeStyle = c.ok ? 'rgba(160,255,190,0.9)' : 'rgba(255,150,140,0.9)'; ctx.lineWidth = 1.2 * lw; ctx.stroke();
      }
      if (def) {
        const cx = pl.tx + def.footprint.w / 2, cy = pl.ty + def.footprint.h / 2;
        const X = (cx - cy) * HW, Y = (cx + cy) * HH;
        const bs = bank.building(pl.defId, colorOf(world, view.viewer), 0, 0);
        ctx.globalAlpha = pl.check.ok ? 0.72 : 0.42;
        ctx.drawImage(bs.body.c, X - bs.body.ox, Y - bs.body.oy, bs.body.w, bs.body.h);
        if (bs.art.turret && bs.art.pivot) {
          const ts = bank.turret(bs, 4);
          ctx.drawImage(ts.c, X + (bs.art.pivot[0] - bs.art.pivot[1]) * HW - ts.ox, Y + (bs.art.pivot[0] + bs.art.pivot[1]) * HH - bs.art.pivot[2] * ZPX - ts.oy, ts.w, ts.h);
        }
        ctx.globalAlpha = 1;
        // weapon range hint for defences
        const wp = def.weapon ? WEAPONS[def.weapon] : undefined;
        if (wp) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2 * lw; ctx.setLineDash([5 * lw, 5 * lw]);
          ctx.beginPath(); ctx.ellipse(X, Y, wp.range * GK, wp.range * GK / 2, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    // support power reticle
    const pt = view.powerTarget;
    if (pt) {
      const sp = SUPPORT_POWERS[pt.power];
      const col = pt.power === 'orbital_lance' ? '120,240,255' : pt.power === 'tremor' ? '255,160,70' : '125,255,217';
      const X = (pt.x - pt.y) * HW, Y = (pt.x + pt.y) * HH;
      const rx = (sp?.radius ?? 3) * GK;
      ctx.save();
      ctx.translate(X, Y); ctx.scale(1, 0.5);
      ctx.fillStyle = `rgba(${col},${0.08 + 0.04 * Math.sin(now * 5)})`;
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.3); ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 2 * lw;
      ctx.setLineDash([rx * 0.26, rx * 0.13]);
      ctx.rotate(now * 0.8);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.3); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-now * 1.9);
      ctx.lineWidth = 1.4 * lw;
      ctx.beginPath(); ctx.arc(0, 0, rx * 0.45, 0, 6.3);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283; ctx.moveTo(Math.cos(a) * rx * 0.25, Math.sin(a) * rx * 0.25); ctx.lineTo(Math.cos(a) * rx * 0.75, Math.sin(a) * rx * 0.75); }
      ctx.stroke();
      ctx.restore();
    }
    // click markers
    for (const m of view.markers) {
      const age = (view.time - m.at) / 1000;
      if (age < 0 || age > 0.7) continue;
      const p = age / 0.7;
      const X = (m.x - m.y) * HW, Y = (m.x + m.y) * HH;
      const col = m.kind === 'attack' ? '255,90,74' : m.kind === 'rally' ? '255,230,120' : '108,240,142';
      ctx.strokeStyle = `rgba(${col},${1 - p})`; ctx.lineWidth = 2 * lw;
      const r = (1.25 - p) * 20 * lw + 4 * lw;
      ctx.beginPath(); ctx.ellipse(X, Y, r, r / 2, 0, 0, 6.3); ctx.stroke();
      ctx.beginPath();
      if (m.kind === 'attack') {
        const q = 6 * lw; ctx.moveTo(X - q, Y - q / 2); ctx.lineTo(X + q, Y + q / 2); ctx.moveTo(X + q, Y - q / 2); ctx.lineTo(X - q, Y + q / 2);
      } else {
        // chevrons dropping onto the point
        for (let i = 0; i < 2; i++) { const yy = Y - (10 + i * 8) * lw * (1 - p) - 3 * lw; ctx.moveTo(X - 6 * lw, yy - 5 * lw); ctx.lineTo(X, yy); ctx.lineTo(X + 6 * lw, yy - 5 * lw); }
      }
      ctx.stroke();
    }
  };
  const TILE2 = HH * 2;
  let alphaF = 0;

  /** Health bars, brackets, pips — drawn in css px so they stay crisp at any zoom. */
  const drawScreenOverlays = (world: World, view: ViewState): void => {
    const z = zoom;
    for (let i = 0; i < ovE.length; i++) {
      const e = ovE[i];
      const flags = ovF[i];
      const s = stateOf(e);
      const sx = (ovX[i] - vx0) * z, sy = (ovY[i] - vy0) * z;
      const selected = (flags & 2) !== 0, hover = (flags & 8) !== 0;
      const rel = relColor(world, view.viewer, e.owner);
      let top: number, bw: number;
      if (e.kind === 'building') {
        const bs = s.bs;
        const w = bs ? bs.w : 1, h = bs ? bs.h : 1;
        top = sy - ((bs ? bs.height : 1) * ZPX + 10) * z;
        bw = Math.max(26, (w + h) * HW * 0.55 * z);
        if (selected || hover) {
          // iso corner brackets around the footprint
          const hw = w / 2 + 0.06, hh = h / 2 + 0.06, L = 0.32;
          ctx.strokeStyle = hover && !selected ? 'rgba(255,255,255,0.55)' : rel; ctx.lineWidth = selected ? 2 : 1.4; ctx.lineCap = 'round';
          ctx.beginPath();
          for (let c = 0; c < 4; c++) {
            const cx = c === 0 || c === 3 ? -hw : hw, cy = c < 2 ? -hh : hh;
            const dx = cx < 0 ? L : -L, dy = cy < 0 ? L : -L;
            const p = (x: number, y: number, mv: boolean): void => {
              const X = sx + (x - y) * HW * z, Y = sy + (x + y) * HH * z;
              if (mv) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
            };
            p(cx + dx, cy, true); p(cx, cy, false); p(cx, cy + dy, false);
          }
          ctx.stroke();
        }
      } else {
        const us = s.us;
        const r = s.udef?.radius ?? 0.3;
        top = sy - ((us ? us.height : 0.4) * ZPX + 9) * z - e.altitude * ZPX * z;
        bw = Math.max(16, r * 2 * HW * 1.25 * z);
      }
      if (flags & 1) {
        const hf = Math.max(0, Math.min(1, e.hp / e.maxHp));
        const bh = e.kind === 'building' ? 5 : 4;
        const x = Math.round(sx - bw / 2), y = Math.round(top);
        ctx.globalAlpha = selected || hover ? 1 : 0.8;
        ctx.fillStyle = 'rgba(6,8,12,0.82)';
        ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
        ctx.fillStyle = hf > 0.5 ? '#4fe36a' : hf > 0.25 ? '#f2c838' : '#f0503c';
        ctx.fillRect(x, y, bw * hf, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x, y, bw * hf, 1);
        ctx.fillStyle = 'rgba(6,8,12,0.55)';
        for (let k = 6; k < bw - 1; k += 6) ctx.fillRect(x + k, y, 1, bh);
        ctx.globalAlpha = 1;
        // harvester cargo pips
        const cap = s.udef?.harvester?.capacity;
        if (cap && selected) {
          const n = 5, filled = Math.round((e.cargo / cap) * n);
          for (let k = 0; k < n; k++) {
            ctx.fillStyle = 'rgba(6,8,12,0.82)'; ctx.fillRect(x - 1 + k * 6, y + bh + 2, 6, 5);
            ctx.fillStyle = k < filled ? '#ff7fe0' : '#3a2a38'; ctx.fillRect(x + k * 6, y + bh + 3, 4, 3);
          }
        }
        if (e.kind === 'building' && e.repairing) {
          // wrench-ish repair tick
          ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 2;
          const cx = x + bw + 8, cy = y + 2 + Math.sin(now * 6) * 1.5;
          ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); ctx.stroke();
        }
        if (e.kind === 'building' && e.primary && selected) {
          ctx.fillStyle = '#ffe680';
          ctx.beginPath(); ctx.moveTo(x - 9, y - 1); ctx.lineTo(x - 4, y + 2.5); ctx.lineTo(x - 9, y + 6); ctx.closePath(); ctx.fill();
        }
      }
      if (flags & 4) {
        // rank chevrons beside the unit
        const cx = sx + bw / 2 + 5, cy = top + 12;
        ctx.lineJoin = 'miter';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#ffd84a' : 'rgba(30,20,0,0.9)'; ctx.lineWidth = pass ? 1.6 : 3.4;
          ctx.beginPath();
          for (let k = 0; k < e.rank; k++) { ctx.moveTo(cx - 4, cy + k * 4.5); ctx.lineTo(cx, cy - 3 + k * 4.5); ctx.lineTo(cx + 4, cy + k * 4.5); }
          ctx.stroke();
        }
      }
    }
    const dr = view.dragRect;
    if (dr) {
      const x = Math.min(dr.x0, dr.x1), y = Math.min(dr.y0, dr.y1), w = Math.abs(dr.x1 - dr.x0), h = Math.abs(dr.y1 - dr.y0);
      ctx.fillStyle = 'rgba(130,255,170,0.09)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(170,255,200,0.95)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  };

  // ───────────────────────────── projectiles ─────────────────────────────

  const drawProjectiles = (world: World, additive: boolean): void => {
    const ps = world.projectiles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = p.px + (p.x - p.px) * alphaF, y = p.py + (p.y - p.py) * alphaF, z = p.pz + (p.z - p.pz) * alphaF;
      if (fogOn && !tileVisible(x, y)) continue;
      const X = (x - y) * HW, Y = (x + y) * HH - z * ZPX;
      if (X < vx0 - 30 || X > vx1 + 30 || Y < vy0 - 30 || Y > vy1 + 30) continue;
      const dX = ((p.x - p.px) - (p.y - p.py)) * HW, dY = ((p.x - p.px) + (p.y - p.py)) * HH - (p.z - p.pz) * ZPX;
      const dl = Math.hypot(dX, dY) || 1;
      const ux = dX / dl, uy = dY / dl;
      const col = WEAPONS[p.weaponId]?.color ?? '#ffd98a';
      if (additive) {
        if (p.kind === 'shell') {
          const len = Math.min(26, dl * 1.2 + 6);
          ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(X - ux * len, Y - uy * len); ctx.lineTo(X, Y); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(X - ux * len * 0.4, Y - uy * len * 0.4); ctx.lineTo(X, Y); ctx.stroke();
          ctx.drawImage(bank.glow(col), X - 9, Y - 9, 18, 18);
        } else if (p.kind === 'missile') {
          ctx.drawImage(bank.glow('#ffb35c'), X - ux * 6 - 9, Y - uy * 6 - 9, 18, 18);
        } else if (p.kind === 'arc') {
          ctx.globalAlpha = 0.6; ctx.drawImage(bank.glow(col), X - 6, Y - 6, 12, 12); ctx.globalAlpha = 1;
        }
      } else {
        if (p.kind === 'arc' || p.kind === 'bomb') {
          // ground shadow makes the lob readable
          const GY = (x + y) * HH;
          ctx.fillStyle = 'rgba(8,10,16,0.3)';
          const sr = p.kind === 'bomb' ? 6 : 4;
          ctx.beginPath(); ctx.ellipse(X, GY, sr, sr / 2, 0, 0, 6.3); ctx.fill();
        }
        if (p.kind === 'arc') {
          ctx.fillStyle = '#26221f'; ctx.beginPath(); ctx.arc(X, Y, 3, 0, 6.3); ctx.fill();
          ctx.fillStyle = '#8a8178'; ctx.beginPath(); ctx.arc(X - 0.8, Y - 0.9, 1.2, 0, 6.3); ctx.fill();
        } else if (p.kind === 'bomb') {
          ctx.fillStyle = '#211e1c';
          ctx.beginPath(); ctx.ellipse(X, Y, 3.2, 5.5, 0, 0, 6.3); ctx.fill();
          ctx.fillRect(X - 3.5, Y - 8, 7, 3);
          ctx.fillStyle = '#e9bf3d'; ctx.fillRect(X - 3, Y - 1, 6, 1.5);
        } else if (p.kind === 'missile') {
          ctx.strokeStyle = '#1f2228'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(X - ux * 7, Y - uy * 7); ctx.lineTo(X + ux * 3, Y + uy * 3); ctx.stroke();
          ctx.strokeStyle = '#e8ecf0'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(X - ux * 6, Y - uy * 6); ctx.lineTo(X + ux * 3, Y + uy * 3); ctx.stroke();
          if (dt > 0 && Math.random() < dt * 45) fx.trail(x, y, z);
        }
      }
    }
  };

  // ───────────────────────────── main render ─────────────────────────────

  const render = (world: World, view: ViewState, alpha: number): void => {
    frame++;
    now = view.time / 1000;
    dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, now - lastT));
    lastT = now;
    alphaF = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    tickF = world.tick + alphaF;
    if (world !== lastWorld || terrain.map !== world.map) {
      lastWorld = world;
      states.clear(); ghosts.clear(); unloadAt.clear(); doorAt.clear(); fx.clear();
      terrain.setMap(world.map);
      const n = world.map.width * world.map.height;
      propStamp = new Uint32Array(n);
      wallGrid = new Uint8Array(n);
      fogCanvas = null; fogSettled = false; fogSnap = true;
      lastTick = -1;
    }
    if (view.viewer !== lastViewer) { lastViewer = view.viewer; fogSnap = true; ghosts.clear(); }
    setFogSource(world, view.viewer);
    if (world.tick !== lastTick) {
      lastTick = world.tick;
      terrain.syncOre();
      fogSettled = false;
      // wall occupancy for neighbour connection
      wallGrid.fill(0);
      for (const e of world.entities.values()) {
        if (e.kind === 'building' && BUILDINGS[e.defId]?.wall) {
          const tx = Math.floor(e.x), ty = Math.floor(e.y);
          if (tx >= 0 && ty >= 0 && tx < mapW && ty < mapH) wallGrid[ty * mapW + tx] = 1;
        }
      }
      if ((world.tick & 255) === 0) for (const id of states.keys()) if (!world.entities.has(id)) states.delete(id);
    }
    camera.zoom = Math.min(2, Math.max(0.5, camera.zoom || 1));
    zoom = camera.zoom;
    const eff = dpr * zoom;
    bank.setScale(eff);
    bank.budget();
    bank.frameStart();
    fx.now = now;
    fx.update(dt);

    const cam = worldToIso(camera.x, camera.y);
    const shx = fx.shake > 0 ? Math.sin(now * 61) * fx.shake : 0, shy = fx.shake > 0 ? Math.cos(now * 47) * fx.shake : 0;
    const TXp = Math.round(dpr * (cssW / 2 + shx) - cam.x * eff), TYp = Math.round(dpr * (cssH / 2 + shy) - cam.y * eff);
    vx0 = cam.x - cssW / 2 / zoom; vy0 = cam.y - cssH / 2 / zoom; vx1 = cam.x + cssW / 2 / zoom; vy1 = cam.y + cssH / 2 / zoom;
    fx.vx0 = vx0 - 8; fx.vy0 = vy0 - 8; fx.vx1 = vx1 + 8; fx.vy1 = vy1 + 8;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = VOID_CSS;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(eff, 0, 0, eff, TXp, TYp);
    ctx.imageSmoothingEnabled = true;

    terrain.draw(ctx, vx0 - 8, vy0 - 8, vx1 + 8, vy1 + 8, eff);
    terrain.glints(ctx, vx0 - 8, vy0 - 8, vx1 + 8, vy1 + 8, now);
    fx.drawGround(ctx);

    // ── collect ──
    nItems = 0; nGlow = 0;
    airE.length = 0; airX.length = 0; airY.length = 0;
    ovE.length = 0; ovX.length = 0; ovY.length = 0; ovF.length = 0;
    shE.length = 0; shX.length = 0; shY.length = 0;
    const viewer = view.viewer;
    const sel = view.selection;
    for (const g of ghosts.values()) g.live = false;
    for (const e of world.entities.values()) {
      const s = stateOf(e);
      if (e.kind === 'building') {
        const def = s.bdef;
        const w = def ? def.footprint.w : 1, h = def ? def.footprint.h : 1;
        const visible = buildingVisible(e, w, h);
        if (fogOn && e.owner !== viewer) {
          let g = ghosts.get(e.id);
          if (visible) {
            const bsv = resolveBuilding(world, e, s);
            if (!g) { g = { defId: e.defId, color: s.color, x: e.x, y: e.y, w, h, variant: 0, mask: 0, live: true }; ghosts.set(e.id, g); }
            g.defId = e.defId; g.color = s.color; g.variant = s.variant; g.mask = s.mask; g.live = true;
            void bsv;
          }
        }
        if (!visible) continue;
        const X = (e.x - e.y) * HW, Y = (e.x + e.y) * HH;
        const reach = (w + h) * HW * 0.5 + 60;
        if (X < vx0 - reach || X > vx1 + reach || Y < vy0 - 40 - (h + w) * HH || Y > vy1 + 150 + (w + h) * HH) continue;
        const bs = resolveBuilding(world, e, s);
        shE.push(e); shX.push(X); shY.push(Y);
        const front = e.x + e.y + (w + h) / 2;
        if (e.buildProgress < 1 || (w === 1 && h === 1)) {
          push(IT_WHOLE, e, e.x + e.y + (w + h) / 2 - 1, X, Y, 0);
        } else {
          const n = w + h;
          for (let j = 0; j < n; j++) push(IT_STRIP, e, j < w ? e.x - w / 2 + j + e.y + h / 2 : front - (j - w) - 1, X, Y, j);
        }
        if (e.buildProgress >= 1 && (bs.art.turret || bs.art.live || bs.art.smoke || bs.art.flash || e.hp < e.maxHp * 0.5 || e.lastHitTick >= 0)) push(IT_TOP, e, front - 1 + 0.02, X, Y, 0);
        markProps(world, Math.floor(e.x - w / 2) - 1, Math.floor(e.y - h / 2) - 1, Math.floor(e.x + w / 2) + 2, Math.floor(e.y + h / 2) + 2);
        const isSel = sel.has(e.id), isHover = view.hoverId === e.id;
        const bar = isSel || isHover || view.showAllHealth || (e.hp < e.maxHp && e.buildProgress >= 1);
        if (bar || isSel || isHover) { ovE.push(e); ovX.push(X); ovY.push(Y); ovF.push((bar ? 1 : 0) | (isSel ? 2 : 0) | (isHover ? 8 : 0)); }
      } else {
        const def = s.udef;
        const x = e.px + (e.x - e.px) * alphaF, y = e.py + (e.y - e.py) * alphaF;
        if (fogOn && e.owner !== viewer && !tileVisible(x, y)) continue;
        const X = (x - y) * HW, Y = (x + y) * HH;
        if (X < vx0 - 70 || X > vx1 + 70 || Y < vy0 - 50 || Y > vy1 + 60 + e.altitude * ZPX) continue;
        const color = colorOf(world, e.owner);
        if (!s.us || s.gen !== bank.gen || s.color !== color) { s.us = bank.unitSet(e.defId, color); s.gen = bank.gen; s.color = color; }
        const air = def?.movement === 'air';
        if (air) { airE.push(e); airX.push(X); airY.push(Y); }
        else {
          push(IT_UNIT, e, x + y, X, Y, 0);
          const tx = Math.floor(x), ty = Math.floor(y);
          markProps(world, tx - 1, ty - 1, tx + 2, ty + 2);
        }
        const isSel = sel.has(e.id), isHover = view.hoverId === e.id;
        const bar = isSel || isHover || view.showAllHealth || e.hp < e.maxHp;
        if (bar || e.rank > 0) { ovE.push(e); ovX.push(X); ovY.push(Y); ovF.push((bar ? 1 : 0) | (isSel ? 2 : 0) | (e.rank > 0 ? 4 : 0) | (isHover ? 8 : 0)); }
      }
    }
    if (fogOn) {
      for (const [id, g] of ghosts) {
        if (g.live) continue;
        if (tileVisible(g.x, g.y)) { ghosts.delete(id); continue; } // we can see it is gone / changed
        const X = (g.x - g.y) * HW, Y = (g.x + g.y) * HH;
        if (X < vx0 - 200 || X > vx1 + 200 || Y < vy0 - 100 || Y > vy1 + 220) continue;
        push(IT_GHOST, g, g.x + g.y + (g.w + g.h) / 2 - 1, X, Y, 0);
      }
    }

    // ── selection rings under units ──
    if (sel.size > 0 || view.hoverId !== null) {
      for (let i = 0; i < ovE.length; i++) {
        const e = ovE[i];
        if (e.kind !== 'unit' || !(ovF[i] & 10)) continue;
        const r = (stateOf(e).udef?.radius ?? 0.3) * GK * 1.2 + 3;
        const selected = (ovF[i] & 2) !== 0;
        ctx.strokeStyle = selected ? relColor(world, viewer, e.owner) : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = (selected ? 1.8 : 1.2) / Math.sqrt(zoom);
        ctx.beginPath(); ctx.ellipse(ovX[i], ovY[i], r, r / 2, 0, 0, 6.3); ctx.stroke();
        if (selected) {
          ctx.fillStyle = 'rgba(184,255,207,0.07)'; ctx.fill();
        }
      }
    }

    // ── shadows ──
    for (let i = 0; i < shE.length; i++) {
      const bs = stateOf(shE[i]).bs!;
      const sp = bs.shadow;
      ctx.drawImage(sp.c, shX[i] - sp.ox, shY[i] - sp.oy, sp.w, sp.h);
    }
    if (airE.length) {
      const blob = bank.puff('#06080d');
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < airE.length; i++) {
        const r = (stateOf(airE[i]).udef?.radius ?? 0.4) * GK * 1.7;
        const off = airE[i].altitude * 9;
        ctx.drawImage(blob, airX[i] + off - r, airY[i] + off * 0.2 - r / 2, r * 2, r);
      }
      ctx.globalAlpha = 1;
    }

    // ── depth-sorted objects ──
    keys.subarray(0, nItems).sort();
    for (let k = 0; k < nItems; k++) {
      const i = keys[k] % 8192;
      const ent = itEnt[i];
      switch (itType[i]) {
        case IT_UNIT: drawUnit(world, ent as Entity, itX[i], itY[i]); break;
        case IT_STRIP: drawStrip(ent as Entity, itX[i], itY[i], itA[i]); break;
        case IT_WHOLE: drawBuildingWhole(world, ent as Entity, itX[i], itY[i]); break;
        case IT_TOP: drawBuildingTop(world, ent as Entity, itX[i], itY[i]); break;
        case IT_PROP: {
          const ti = itA[i];
          const sp = terrain.propAt(ti % mapW, (ti / mapW) | 0);
          if (sp) ctx.drawImage(sp.c, PROP.x - sp.ox, PROP.y - sp.oy, sp.w, sp.h);
          break;
        }
        default: drawGhost(ent as Ghost, itX[i], itY[i]);
      }
      itEnt[i] = null;
    }

    fx.drawSinks(ctx);
    drawProjectiles(world, false);
    fx.drawSoft(ctx);

    // ── aircraft (few; simple insertion order by depth) ──
    for (let i = 1; i < airE.length; i++) {
      const e = airE[i], x = airX[i], y = airY[i];
      let j = i - 1;
      while (j >= 0 && airY[j] > y) { airE[j + 1] = airE[j]; airX[j + 1] = airX[j]; airY[j + 1] = airY[j]; j--; }
      airE[j + 1] = e; airX[j + 1] = x; airY[j + 1] = y;
    }
    for (let i = 0; i < airE.length; i++) drawUnit(world, airE[i], airX[i], airY[i]);

    // ── additive pass ──
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < nGlow; i++) {
      const r = gR[i];
      ctx.globalAlpha = gA[i];
      ctx.drawImage(gS[i]!, gX[i] - r, gY[i] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    drawProjectiles(world, true);
    fx.drawAdd(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    fx.drawOver(ctx);

    // ── fog ──
    if (fogOn) {
      updateFog(world);
      ctx.save();
      ctx.transform(HW, HH, -HW, HH, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fogCanvas!, -1, -1);
      ctx.restore();
    }

    drawWorldOverlays(world, view);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScreenOverlays(world, view);
  };

  // ───────────────────────────── events ─────────────────────────────

  const handleEvents = (events: SimEvent[], world: World): void => {
    if (events.length === 0) return;
    setFogSource(world, lastViewer);
    for (const ev of events) {
      switch (ev.type) {
        case 'weaponFired': {
          const src = world.entities.get(ev.sourceId);
          let sx = ev.x, sy = ev.y, sz = ev.z, flash = 10;
          if (src) {
            const s = stateOf(src);
            if (!s.us && !s.bs) {
              const color = colorOf(world, src.owner);
              if (src.kind === 'unit') s.us = bank.unitSet(src.defId, color); else s.bs = bank.building(src.defId, color, 0, 0);
              s.gen = bank.gen; s.color = color;
            }
            if (muzzle(src, s, world.tick)) { sx = MZ.x; sy = MZ.y; sz = MZ.z; }
            flash = s.us ? s.us.art.flash : s.bs?.art.flash ?? 10;
          }
          if (!tileVisible(sx, sy) && !tileVisible(ev.tx, ev.ty)) break;
          fx.fire(ev.kind, WEAPONS[ev.weaponId]?.color ?? '#ffd98a', sx, sy, sz, ev.tx, ev.ty, ev.tz, flash);
          break;
        }
        case 'entityCreated': {
          // a unit rolled out: open the door of the building it came from
          const ud = UNITS[ev.defId];
          if (!ud) break;
          let best: Entity | null = null, bd = 1e9;
          for (const e of world.entities.values()) {
            if (e.kind !== 'building' || e.owner !== ev.owner || e.buildProgress < 1) continue;
            const bdf = BUILDINGS[e.defId];
            if (!bdf?.produces || !bdf.produces.includes(ud.category as never)) continue;
            const dx = ev.x - e.x, dy = ev.y - (e.y + bdf.footprint.h / 2 + 0.5);
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = e; }
          }
          if (best && bd < 30) doorAt.set(best.id, fx.now);
          break;
        }
        case 'impact':
          if (tileVisible(ev.x, ev.y)) fx.impact(ev.kind, WEAPONS[ev.weaponId]?.color ?? '#ffd98a', ev.x, ev.y, ev.z, ev.splash);
          break;
        case 'entityDamaged':
          break;
        case 'entityDestroyed': {
          states.delete(ev.id);
          unloadAt.delete(ev.id);
          doorAt.delete(ev.id);
          if (!tileVisible(ev.x, ev.y)) break;
          if (ev.kind === 'building') {
            const def = BUILDINGS[ev.defId];
            const w = def ? def.footprint.w : 1, h = def ? def.footprint.h : 1;
            fx.buildingCollapse(bank.building(ev.defId, colorOf(world, ev.owner), 6, 0).body, ev.x, ev.y, w, h);
            ghosts.delete(ev.id);
          } else {
            const def = UNITS[ev.defId];
            fx.unitDeath(ev.x, ev.y, def?.movement === 'air' ? def.altitude ?? 2 : 0, def?.radius ?? 0.4, def?.category === 'infantry');
          }
          break;
        }
        case 'buildingSold': {
          states.delete(ev.id);
          if (!tileVisible(ev.x, ev.y)) break;
          const def = BUILDINGS[ev.defId];
          fx.sell(bank.building(ev.defId, colorOf(world, ev.owner), 0, 0).body, ev.x, ev.y, def ? def.footprint.w : 1, def ? def.footprint.h : 1);
          break;
        }
        case 'buildingPlaced': {
          if (!tileVisible(ev.x, ev.y)) break;
          const def = BUILDINGS[ev.defId];
          fx.dustRing(ev.x, ev.y, def ? Math.max(def.footprint.w, def.footprint.h) / 2 : 0.6);
          break;
        }
        case 'buildingComplete': {
          const e = world.entities.get(ev.id);
          if (!e || !tileVisible(e.x, e.y)) break;
          const def = BUILDINGS[ev.defId];
          const r = def ? Math.max(def.footprint.w, def.footprint.h) / 2 : 0.6;
          fx.ring(e.x, e.y, 0, r * 0.4, r * 1.5, 0.5, colorOf(world, ev.owner), 2.5);
          fx.sparkle(e.x, e.y, 0.4, def?.faction === 'ferrum' ? '#ffa640' : '#74f4ff', 10, r * 0.7);
          break;
        }
        case 'buildingCaptured': {
          const e = world.entities.get(ev.id);
          if (!e || !tileVisible(e.x, e.y)) break;
          const def = BUILDINGS[ev.defId];
          const r = def ? Math.max(def.footprint.w, def.footprint.h) / 2 : 0.6;
          const col = colorOf(world, ev.to);
          fx.ring(e.x, e.y, 0, r * 1.6, r * 0.3, 0.5, colorOf(world, ev.from), 2);
          fx.ring(e.x, e.y, 0, r * 0.3, r * 1.7, 0.7, col, 3.5);
          fx.sparkle(e.x, e.y, 0.5, col, 16, r * 0.8);
          break;
        }
        case 'unitDeployed': {
          const b = world.entities.get(ev.buildingId);
          if (!b || !tileVisible(b.x, b.y)) break;
          fx.dustRing(b.x, b.y, 1.6);
          fx.ring(b.x, b.y, 0, 0.4, 2.4, 0.6, colorOf(world, ev.owner), 3);
          break;
        }
        case 'unitPromoted': {
          const e = world.entities.get(ev.id);
          if (e && tileVisible(e.x, e.y)) fx.promote(e.x, e.y, e.altitude + defHeight(e.defId), ev.rank);
          break;
        }
        case 'harvesterUnloaded': {
          const hv = world.entities.get(ev.id);
          if (!hv) break;
          // light up the nearest refinery of that owner
          let best: Entity | null = null, bd = 36;
          for (const e of world.entities.values()) {
            if (e.kind !== 'building' || e.owner !== ev.owner || !BUILDINGS[e.defId]?.refinery) continue;
            const d = (e.x - hv.x) * (e.x - hv.x) + (e.y - hv.y) * (e.y - hv.y);
            if (d < bd) { bd = d; best = e; }
          }
          if (best) unloadAt.set(best.id, fx.now);
          if (tileVisible(hv.x, hv.y)) fx.sparkle(hv.x, hv.y, 0.4, '#ff7fe0', 6, 0.3);
          break;
        }
        case 'powerUsed': {
          const sp = SUPPORT_POWERS[ev.power];
          // recon is only shown to the team that fired it; the big ones are visible to everyone
          if (ev.power === 'recon_sweep') {
            const a = playerOf(world, lastViewer), b = playerOf(world, ev.player);
            if (!a || !b || a.team !== b.team) break;
          }
          fx.powerUsed(ev.power, ev.x, ev.y, sp.radius, sp.delay, ev.power === 'recon_sweep' ? sp.duration : sp.duration);
          break;
        }
        case 'powerImpact': {
          if (ev.power === 'recon_sweep') {
            const a = playerOf(world, lastViewer), b = playerOf(world, ev.player);
            if (!a || !b || a.team !== b.team) break;
          }
          fx.powerImpact(ev.power, ev.x, ev.y, ev.radius, SUPPORT_POWERS[ev.power].duration);
          break;
        }
        default:
          break;
      }
    }
  };

  // ───────────────────────────── geometry / picking ─────────────────────────────

  const screenToWorld = (sx: number, sy: number): { x: number; y: number } => {
    const z = Math.min(2, Math.max(0.5, camera.zoom || 1));
    const cam = worldToIso(camera.x, camera.y);
    const ix = (sx - cssW / 2) / z + cam.x, iy = (sy - cssH / 2) / z + cam.y;
    const a = ix / HW, b = iy / HH;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  };
  const worldToScreen = (x: number, y: number, zz = 0): { x: number; y: number } => {
    const z = Math.min(2, Math.max(0.5, camera.zoom || 1));
    const cam = worldToIso(camera.x, camera.y);
    return { x: ((x - y) * HW - cam.x) * z + cssW / 2, y: ((x + y) * HH - zz * ZPX - cam.y) * z + cssH / 2 };
  };

  const canSee = (world: World, e: Entity, viewer: PlayerId): boolean => {
    if (!fogOn || e.owner === viewer) return true;
    if (e.kind === 'building') { const d = BUILDINGS[e.defId]; return buildingVisible(e, d ? d.footprint.w : 1, d ? d.footprint.h : 1); }
    return tileVisible(e.x, e.y);
  };

  const pickEntity = (world: World, sx: number, sy: number, viewer: PlayerId): EntityId | null => {
    const prevViewer = lastViewer;
    lastViewer = viewer;
    setFogSource(world, viewer);
    const z = Math.min(2, Math.max(0.5, camera.zoom || 1));
    const g = screenToWorld(sx, sy);
    const KZ = ZPX / HW; // ground-plane shift per tile of height along the view ray
    let best: EntityId | null = null, bestScore = -1;
    for (const e of world.entities.values()) {
      if (!canSee(world, e, viewer)) continue;
      let score = -1;
      if (e.kind === 'building') {
        const d = BUILDINGS[e.defId];
        const w = d ? d.footprint.w : 1, h = d ? d.footprint.h : 1;
        const H = defHeight(e.defId) * (e.buildProgress < 1 ? Math.max(0.2, e.buildProgress) : 1);
        // does the view ray through the cursor pass through the building's box?
        const x0 = e.x - w / 2 - g.x, x1 = e.x + w / 2 - g.x, y0 = e.y - h / 2 - g.y, y1 = e.y + h / 2 - g.y;
        const t0 = Math.max(x0, y0, 0), t1 = Math.min(x1, y1, H * KZ);
        if (t0 <= t1) score = e.x + e.y + (w + h) / 2;
      } else {
        const d = UNITS[e.defId];
        const r = d?.radius ?? 0.3;
        const p = worldToScreen(e.x, e.y, e.altitude);
        const dx = Math.abs(sx - p.x), dy = sy - p.y;
        const hw = Math.max(9, r * HW * 1.25 * z + 3);
        const up = (defHeight(e.defId) * ZPX + 5) * z, down = Math.max(5, r * HH * z + 3);
        if (dx <= hw && dy >= -up && dy <= down) score = 1000 + e.x + e.y + (e.altitude > 0 ? 1000 : 0) - dx * 0.01;
      }
      if (score > bestScore) { bestScore = score; best = e.id; }
    }
    lastViewer = prevViewer;
    return best;
  };

  const entitiesInRect = (world: World, x0: number, y0: number, x1: number, y1: number, viewer: PlayerId): EntityId[] => {
    const prevViewer = lastViewer;
    lastViewer = viewer;
    setFogSource(world, viewer);
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    const z = Math.min(2, Math.max(0.5, camera.zoom || 1));
    const out: EntityId[] = [];
    for (const e of world.entities.values()) {
      if (!canSee(world, e, viewer)) continue;
      const lift = e.kind === 'unit' ? defHeight(e.defId) * 0.4 : 0;
      const p = worldToScreen(e.x, e.y, e.altitude + lift);
      const m = e.kind === 'unit' ? 4 * z : 0;
      if (p.x >= x0 - m && p.x <= x1 + m && p.y >= y0 - m && p.y <= y1 + m) out.push(e.id);
    }
    lastViewer = prevViewer;
    return out;
  };

  const ghostIter = function* (): Iterable<{ x: number; y: number; w: number; h: number; color: string; live: boolean }> {
    if (fogOn) yield* ghosts.values();
  };

  return {
    camera,
    resize(w: number, h: number, ratio: number): void {
      cssW = Math.max(1, w); cssH = Math.max(1, h); dpr = Math.max(0.5, ratio || 1);
      const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    },
    render,
    handleEvents,
    screenToWorld,
    worldToScreen,
    pickEntity,
    entitiesInRect,
    drawMinimap(mctx: CanvasRenderingContext2D, world: World, view: ViewState, w: number, h: number): void {
      terrain.setMap(world.map);
      setFogSource(world, view.viewer);
      const a = screenToWorld(0, 0), b = screenToWorld(cssW, 0), c = screenToWorld(cssW, cssH), d = screenToWorld(0, cssH);
      drawMinimap(mctx, world, view, w, h, {
        terrain: terrain.miniCanvas(),
        fog: fogOn && fogCanvas && lastWorld === world && view.viewer === lastViewer ? fogCanvas : null,
        visible: tileVisible,
        ghosts: ghostIter(),
        corners: [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y],
      });
    },
    minimapToWorld,
    getIcon(defId: string, color: string, size: number): HTMLCanvasElement {
      const sz = Math.max(8, Math.round(size));
      const key = defId + '|' + color + '|' + sz;
      let c = icons.get(key);
      if (!c) { c = makeIcon(bank, defId, color, sz); icons.set(key, c); }
      return c;
    },
    clampCamera(world: World): void {
      camera.zoom = Math.min(2, Math.max(0.5, camera.zoom || 1));
      camera.x = Math.min(world.map.width, Math.max(0, camera.x));
      camera.y = Math.min(world.map.height, Math.max(0, camera.y));
    },
    destroy(): void {
      states.clear(); ghosts.clear(); icons.clear(); fx.clear(); bank.flush();
      lastWorld = null; fogCanvas = null;
    },
  };
};
