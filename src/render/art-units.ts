// Procedural models for every unit def. All shapes are original; built from the prism modeller in model.ts.
// Local space: +x = forward, origin on the ground under the unit's centre.
import { Model, type RGB, hex, mix, mul } from './model';

export interface Pal {
  /** Player colour, darker and lighter variants. */
  p: RGB;
  pd: RGB;
  pl: RGB;
}
export function makePal(color: string): Pal {
  const p = hex(color);
  return { p, pd: mul(p, 0.6), pl: mix(p, [255, 255, 255], 0.4) };
}

/** Helion Accord: pale composite, slate trim, cyan energy. */
export const H = {
  hull: hex('#e2e8ee'), mid: hex('#b4c0cd'), dark: hex('#66768b'), deep: hex('#343f4f'), tread: hex('#2b313c'),
  glow: hex('#74f4ff'), glass: hex('#1d4466'), gun: hex('#4a5564'),
};
/** Ferrum Syndicate: dark riveted iron, rust, furnace orange. */
export const F = {
  iron: hex('#6f675f'), mid: hex('#575049'), dark: hex('#3f3a36'), black: hex('#282522'), tread: hex('#211e1c'),
  rust: hex('#96583a'), steel: hex('#a39c92'), glow: hex('#ffa640'), hazard: hex('#e9bf3d'), gun: hex('#2f2c2a'),
  concrete: hex('#7d776e'), sand: hex('#9a8a66'),
};
export const ORE = hex('#e554bb');
export const ORE_L = hex('#ffa6ea');
export const ORE_D = hex('#8e2f7c');

export interface UnitArt {
  /** Hull frame count (walk cycle / cargo levels). */
  frames: number;
  hull: (m: Model, P: Pal, frame: number) => void;
  turret?: (m: Model, P: Pal) => void;
  /** Turret pivot in hull space. */
  pivot: [number, number, number];
  /** Muzzle points, in turret space when there is a turret, else hull space. */
  muzzles: number[][];
  /** Tread animation line: [halfWidth, length, z]. */
  tracks?: [number, number, number];
  /** Recoil distance (tiles) and muzzle flash size (px). */
  recoil: number;
  flash: number;
  /** Aircraft: rotor discs [x,y,z,r] and exhaust glow points [x,y,z]. */
  rotors?: number[][];
  jets?: number[][];
  infantry?: boolean;
}

// ───────────────────────────── helpers ─────────────────────────────

function tracks(m: Model, len: number, halfW: number, w: number, h: number, col: RGB, x0 = 0): void {
  const a = len / 2;
  const prof = [x0 - a + 0.07, 0, x0 + a - 0.07, 0, x0 + a, h * 0.5, x0 + a - 0.06, h, x0 - a + 0.06, h, x0 - a, h * 0.5];
  m.exY(prof, -halfW - w / 2, -halfW + w / 2, col);
  m.exY(prof, halfW - w / 2, halfW + w / 2, col);
}

function wheel(m: Model, x: number, y: number, r: number, w: number, col: RGB, hub: RGB): void {
  const prof: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    prof.push(x + Math.cos(a) * r, r + Math.sin(a) * r);
  }
  const s = y > 0 ? 1 : -1;
  m.exY(prof, y - w / 2, y + w / 2, col);
  m.box(x, y + s * (w / 2 + 0.004), r - 0.035, 0.07, 0.008, 0.07, hub);
}

function wheels(m: Model, xs: number[], halfW: number, r: number, w: number, col: RGB, hub: RGB): void {
  for (const x of xs) {
    wheel(m, x, -halfW, r, w, col, hub);
    wheel(m, x, halfW, r, w, col, hub);
  }
}

interface SoldierSpec {
  suit: RGB;
  armor: RGB;
  helmet: RGB;
  visor: RGB;
  visorGlow?: boolean;
  bulk?: number;
  /** Draw kit (weapon, backpack) — `aim` is true on the firing frame. */
  kit: (m: Model, aim: boolean, P: Pal) => void;
}

/** frames: 0 idle, 1-4 walk, 5 aim/fire */
function soldier(m: Model, P: Pal, f: number, s: SoldierSpec): void {
  const b = s.bulk ?? 1;
  const swing = f === 1 ? 0.065 : f === 3 ? -0.065 : 0;
  const lift = f === 2 || f === 4 ? 0.012 : 0;
  // legs
  m.bar(0, -0.04, 0.2, swing, -0.04, 0, 0.03 * b, s.suit, { sides: 4 });
  m.bar(0, 0.04, 0.2, -swing, 0.04, 0, 0.03 * b, s.suit, { sides: 4 });
  // boots
  m.box(swing + 0.015, -0.04, 0, 0.08, 0.06, 0.035, mul(s.suit, 0.55));
  m.box(-swing + 0.015, 0.04, 0, 0.08, 0.06, 0.035, mul(s.suit, 0.55));
  const z = 0.19 + lift;
  // torso + player-colour chest plate / shoulders
  m.box(0, 0, z, 0.1 * b, 0.16 * b, 0.1, s.armor);
  m.box(0, 0, z + 0.1, 0.12 * b, 0.2 * b, 0.075, P.p, { taper: 0.85 });
  // head
  m.cyl(0, 0, z + 0.175, 0.052, 0.05, s.helmet, { sides: 6 });
  m.cyl(0, 0, z + 0.225, 0.056, 0.04, s.helmet, { sides: 6, taper: 0.6 });
  m.box(0.045, 0, z + 0.19, 0.02, 0.07, 0.028, s.visor, { emis: !!s.visorGlow });
  s.kit(m.at(0, 0, lift), f === 5, P);
  m.at(0, 0, 0);
}

function inf(spec: (P: Pal) => SoldierSpec, muzzle: number[], flash: number): UnitArt {
  return {
    frames: 6,
    infantry: true,
    hull: (m, P, f) => soldier(m, P, f, spec(P)),
    pivot: [0, 0, 0],
    muzzles: [muzzle],
    recoil: 0,
    flash,
  };
}

const hSuit = hex('#8793a3');
const fSuit = hex('#5b5246');

export const UNIT_ART: Record<string, UnitArt> = {
  // ══════════════════════════ Helion infantry ══════════════════════════
  h_warden: inf(
    () => ({
      suit: hSuit, armor: H.hull, helmet: H.hull, visor: H.glow, visorGlow: true,
      kit: (m, aim) => {
        if (aim) m.bar(0.02, -0.07, 0.33, 0.3, -0.05, 0.33, 0.017, H.gun);
        else m.bar(0, -0.085, 0.24, 0.24, -0.04, 0.3, 0.017, H.gun);
        m.box(-0.07, 0, 0.24, 0.05, 0.12, 0.12, H.dark);
      },
    }),
    [0.3, -0.05, 0.33], 7,
  ),
  h_breacher: inf(
    () => ({
      suit: hSuit, armor: H.mid, helmet: H.dark, visor: H.glow, visorGlow: true, bulk: 1.08,
      kit: (m, aim) => {
        // shoulder launch tube
        if (aim) m.bar(-0.14, -0.085, 0.39, 0.24, -0.085, 0.41, 0.036, H.hull, { sides: 6 });
        else m.bar(-0.16, -0.085, 0.36, 0.2, -0.085, 0.44, 0.036, H.hull, { sides: 6 });
        m.box(-0.08, 0.02, 0.23, 0.06, 0.12, 0.15, H.deep);
      },
    }),
    [0.26, -0.085, 0.41], 10,
  ),
  h_engineer: inf(
    (P) => ({
      suit: hex('#c9d2dc'), armor: hex('#f1f4f7'), helmet: P.pl, visor: H.glass,
      kit: (m) => {
        // big tool pack with a glowing probe antenna, and a hand case
        m.box(-0.085, 0, 0.2, 0.08, 0.17, 0.2, H.dark);
        m.bar(-0.1, 0.05, 0.4, -0.1, 0.05, 0.56, 0.01, H.deep);
        m.box(-0.1, 0.05, 0.55, 0.03, 0.03, 0.03, H.glow, { emis: true });
        m.box(0.06, -0.11, 0.12, 0.09, 0.035, 0.07, H.glow, { emis: true });
      },
    }),
    [0.1, 0, 0.3], 0,
  ),

  // ══════════════════════════ Helion vehicles ══════════════════════════
  h_harvester: {
    frames: 4,
    hull: (m, P, f) => {
      tracks(m, 1.04, 0.36, 0.15, 0.17, H.tread);
      m.poly([-0.5, -0.28, 0.24, -0.28, 0.46, -0.17, 0.46, 0.17, 0.24, 0.28, -0.5, 0.28], 0.08, 0.16, H.hull);
      // cab with glass band
      m.box(0.27, 0, 0.24, 0.24, 0.34, 0.07, H.mid);
      m.box(0.29, 0, 0.31, 0.2, 0.3, 0.07, H.glass, { taper: [0.7, 0.85] });
      m.box(0.27, 0, 0.38, 0.13, 0.24, 0.015, H.hull);
      // hexagonal ore canister, open top, fill level by frame
      m.cyl(-0.19, 0, 0.24, 0.27, 0.2, P.p, { sides: 6, top: H.deep });
      m.cyl(-0.19, 0, 0.44, 0.27, 0.03, H.hull, { sides: 6, top: H.deep });
      if (f > 0) m.cyl(-0.19, 0, 0.47, 0.215, 0.012 + f * 0.035, ORE, { sides: 6, taper: 0.55 + 0.1 * (3 - f), top: ORE_L });
      // front sonic collector bar
      m.box(0.52, 0, 0.03, 0.1, 0.56, 0.1, H.dark, { taper: [0.7, 1] });
      m.box(0.575, 0, 0.05, 0.02, 0.46, 0.04, H.glow, { emis: true });
      m.bar(0.42, -0.2, 0.2, 0.52, -0.22, 0.1, 0.025, H.gun);
      m.bar(0.42, 0.2, 0.2, 0.52, 0.22, 0.1, 0.025, H.gun);
    },
    pivot: [0, 0, 0], muzzles: [[0.58, 0, 0.06]], tracks: [0.36, 1.04, 0.17], recoil: 0, flash: 0,
  },
  h_ranger: {
    frames: 1,
    hull: (m, P) => {
      wheels(m, [-0.25, 0.27], 0.25, 0.105, 0.09, H.tread, H.mid);
      m.poly([-0.42, -0.2, 0.22, -0.2, 0.45, -0.09, 0.45, 0.09, 0.22, 0.2, -0.42, 0.2], 0.1, 0.12, H.hull, { taper: 0.93 });
      m.box(0.12, 0, 0.22, 0.3, 0.27, 0.09, H.glass, { taper: [0.6, 0.72], shift: [-0.03, 0] });
      m.box(-0.27, 0, 0.22, 0.26, 0.34, 0.03, P.p);
      m.box(0.4, 0, 0.14, 0.03, 0.2, 0.03, H.glow, { emis: true });
    },
    turret: (m) => {
      m.cyl(0, 0, 0, 0.085, 0.06, H.mid, { sides: 6 });
      m.box(0.02, 0, 0.06, 0.12, 0.1, 0.05, H.hull);
      m.bar(0.05, 0, 0.085, 0.34, 0, 0.085, 0.017, H.gun);
    },
    pivot: [-0.25, 0, 0.25], muzzles: [[0.34, 0, 0.085]], recoil: 0.02, flash: 8,
  },
  h_javelin: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.02, 0.33, 0.15, 0.17, H.tread);
      m.poly([-0.5, -0.25, 0.28, -0.25, 0.54, -0.1, 0.54, 0.1, 0.28, 0.25, -0.5, 0.25], 0.08, 0.17, H.hull, { taper: 0.94 });
      // player-colour flank stripes + rear engine deck
      m.box(-0.06, -0.335, 0.17, 0.62, 0.17, 0.02, P.p);
      m.box(-0.06, 0.335, 0.17, 0.62, 0.17, 0.02, P.p);
      m.box(-0.4, 0, 0.25, 0.16, 0.34, 0.03, H.dark);
      m.box(-0.47, 0, 0.14, 0.02, 0.2, 0.04, H.glow, { emis: true });
    },
    turret: (m, P) => {
      m.poly([-0.2, -0.15, 0.1, -0.17, 0.24, -0.07, 0.24, 0.07, 0.1, 0.17, -0.2, 0.15], 0, 0.13, H.hull, { taper: 0.82 });
      m.box(-0.06, 0, 0.13, 0.2, 0.2, 0.018, P.p);
      m.bar(0.2, 0, 0.07, 0.62, 0, 0.07, 0.028, H.gun, { sides: 6 });
      m.bar(0.58, 0, 0.07, 0.68, 0, 0.07, 0.038, H.dark, { sides: 6 });
      m.box(-0.12, 0.1, 0.13, 0.05, 0.05, 0.05, H.glow, { emis: true });
    },
    pivot: [-0.04, 0, 0.25], muzzles: [[0.7, 0, 0.07]], tracks: [0.33, 1.02, 0.17], recoil: 0.07, flash: 15,
  },
  h_skyveil: {
    frames: 1,
    hull: (m, P) => {
      wheels(m, [-0.3, 0, 0.3], 0.27, 0.1, 0.09, H.tread, H.mid);
      m.poly([-0.48, -0.22, 0.3, -0.22, 0.5, -0.1, 0.5, 0.1, 0.3, 0.22, -0.48, 0.22], 0.1, 0.13, H.hull, { taper: 0.94 });
      m.box(0.3, 0, 0.23, 0.2, 0.3, 0.08, H.glass, { taper: [0.6, 0.8] });
      m.box(-0.14, 0, 0.23, 0.56, 0.36, 0.025, H.mid);
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.1, 0.08, H.dark, { sides: 6 });
      for (const s of [-1, 1]) {
        // angled missile pod with warhead tips
        m.bar(-0.16, s * 0.15, 0.1, 0.16, s * 0.15, 0.27, 0.085, H.hull, { sides: 4 });
        m.bar(0.16, s * 0.15, 0.27, 0.2, s * 0.15, 0.292, 0.06, H.glow, { sides: 4, emis: true });
        m.box(-0.06, s * 0.15, 0.27, 0.12, 0.13, 0.015, P.p, { rot: 0 });
      }
      m.box(-0.02, 0, 0.08, 0.1, 0.16, 0.1, H.mid);
    },
    pivot: [-0.14, 0, 0.255], muzzles: [[0.22, -0.15, 0.3], [0.22, 0.15, 0.3]], recoil: 0.02, flash: 10,
  },
  h_farstrike: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.08, 0.32, 0.14, 0.15, H.tread);
      m.poly([-0.54, -0.24, 0.36, -0.24, 0.52, -0.12, 0.52, 0.12, 0.36, 0.24, -0.54, 0.24], 0.07, 0.14, H.hull);
      // gun cradle + long elevated barrel
      m.box(-0.2, 0, 0.21, 0.4, 0.36, 0.12, H.mid, { taper: [0.8, 0.85] });
      m.box(-0.22, 0, 0.33, 0.26, 0.26, 0.02, P.p);
      m.bar(-0.25, 0, 0.36, 0.72, 0, 0.62, 0.04, H.gun, { sides: 6 });
      m.bar(-0.3, 0, 0.345, 0.05, 0, 0.44, 0.07, H.dark, { sides: 6 });
      m.bar(0.66, 0, 0.603, 0.78, 0, 0.636, 0.055, H.dark, { sides: 6 });
      // recoil spades
      m.bar(-0.5, -0.2, 0.16, -0.66, -0.26, 0.02, 0.03, H.dark);
      m.bar(-0.5, 0.2, 0.16, -0.66, 0.26, 0.02, 0.03, H.dark);
      m.box(0.34, 0, 0.21, 0.12, 0.2, 0.05, H.glass);
    },
    pivot: [0, 0, 0], muzzles: [[0.8, 0, 0.64]], tracks: [0.32, 1.08, 0.15], recoil: 0, flash: 20,
  },
  h_arbiter: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.06, 0.34, 0.15, 0.15, H.tread);
      m.poly([-0.52, -0.26, 0.2, -0.26, 0.56, -0.08, 0.56, 0.08, 0.2, 0.26, -0.52, 0.26], 0.07, 0.14, H.hull, { taper: 0.9 });
      m.box(-0.36, 0, 0.21, 0.26, 0.4, 0.05, H.dark);
      m.box(-0.36, -0.12, 0.26, 0.2, 0.08, 0.02, H.glow, { emis: true });
      m.box(-0.36, 0.12, 0.26, 0.2, 0.08, 0.02, H.glow, { emis: true });
      m.box(0.2, -0.345, 0.15, 0.4, 0.15, 0.02, P.p);
      m.box(0.2, 0.345, 0.15, 0.4, 0.15, 0.02, P.p);
    },
    turret: (m, P) => {
      // capacitor block + twin rails with an energy strip between
      m.poly([-0.26, -0.16, 0.06, -0.16, 0.16, -0.08, 0.16, 0.08, 0.06, 0.16, -0.26, 0.16], 0, 0.14, H.mid, { taper: 0.85 });
      m.box(-0.12, 0, 0.14, 0.2, 0.18, 0.02, P.p);
      m.bar(0.1, -0.06, 0.07, 0.86, -0.045, 0.07, 0.024, H.hull);
      m.bar(0.1, 0.06, 0.07, 0.86, 0.045, 0.07, 0.024, H.hull);
      m.bar(0.14, 0, 0.07, 0.8, 0, 0.07, 0.012, H.glow, { emis: true });
      m.box(0.5, 0, 0.035, 0.05, 0.16, 0.07, H.dark);
      m.box(0.74, 0, 0.04, 0.04, 0.13, 0.06, H.dark);
    },
    pivot: [-0.04, 0, 0.215], muzzles: [[0.9, 0, 0.07]], tracks: [0.34, 1.06, 0.15], recoil: 0.09, flash: 18,
  },
  h_crawler: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.1, 0.4, 0.17, 0.18, H.tread);
      m.poly([-0.55, -0.32, 0.36, -0.32, 0.55, -0.2, 0.55, 0.2, 0.36, 0.32, -0.55, 0.32], 0.09, 0.17, H.hull);
      m.box(0.38, 0, 0.26, 0.2, 0.4, 0.1, H.glass, { taper: [0.6, 0.85] });
      // folded hex core
      m.cyl(-0.12, 0, 0.26, 0.33, 0.16, H.mid, { sides: 6 });
      m.cyl(-0.12, 0, 0.42, 0.29, 0.06, P.p, { sides: 6 });
      m.cyl(-0.12, 0, 0.48, 0.24, 0.16, H.hull, { sides: 6, taper: 0.7 });
      m.cyl(-0.12, 0, 0.64, 0.1, 0.05, H.glow, { sides: 6, emis: true });
      m.bar(-0.12, 0, 0.69, -0.12, 0, 0.9, 0.012, H.dark);
      m.box(-0.5, 0, 0.26, 0.08, 0.5, 0.08, H.dark);
    },
    pivot: [0, 0, 0], muzzles: [], tracks: [0.4, 1.1, 0.18], recoil: 0, flash: 0,
  },
  h_kestrel: {
    frames: 1,
    hull: (m, P) => {
      // slim fuselage, canopy, twin ducted fans on stub wings, split tail
      m.poly([-0.42, -0.07, 0.2, -0.11, 0.56, -0.03, 0.56, 0.03, 0.2, 0.11, -0.42, 0.07], 0.08, 0.13, H.hull, { taper: [0.92, 0.6] });
      m.box(0.24, 0, 0.19, 0.3, 0.13, 0.06, H.glass, { taper: [0.6, 0.6] });
      m.box(-0.02, 0, 0.13, 0.22, 0.74, 0.035, H.mid);
      m.box(-0.02, 0, 0.165, 0.12, 0.7, 0.012, P.p);
      for (const s of [-1, 1]) {
        m.cyl(-0.02, s * 0.36, 0.06, 0.17, 0.12, H.hull, { sides: 10, top: H.deep });
        m.cyl(-0.02, s * 0.36, 0.181, 0.035, 0.03, H.dark, { sides: 6 });
        m.bar(-0.42, s * 0.03, 0.18, -0.6, s * 0.16, 0.3, 0.03, P.p);
      }
      m.bar(-0.4, 0, 0.14, -0.6, 0, 0.16, 0.035, H.mid);
      m.bar(0.3, 0, 0.07, 0.52, 0, 0.05, 0.018, H.gun);
    },
    pivot: [0, 0, 0], muzzles: [[0.54, 0, 0.05]], recoil: 0, flash: 9,
    rotors: [[-0.02, -0.36, 0.185, 0.15], [-0.02, 0.36, 0.185, 0.15]],
    jets: [[-0.02, -0.36, 0.04], [-0.02, 0.36, 0.04]],
  },

  // ══════════════════════════ Ferrum infantry ══════════════════════════
  f_militia: inf(
    () => ({
      suit: fSuit, armor: hex('#6d6253'), helmet: hex('#4a4239'), visor: hex('#d9b48a'),
      kit: (m, aim) => {
        if (aim) m.bar(0.03, -0.07, 0.32, 0.24, -0.05, 0.32, 0.02, F.gun);
        else m.bar(0.02, -0.085, 0.24, 0.2, -0.04, 0.28, 0.02, F.gun);
        m.box(0.12, -0.06, 0.2, 0.03, 0.03, 0.07, F.gun);
      },
    }),
    [0.25, -0.05, 0.32], 7,
  ),
  f_grenadier: inf(
    () => ({
      suit: fSuit, armor: F.mid, helmet: F.iron, visor: F.black, bulk: 1.12,
      kit: (m, aim) => {
        // stubby launcher + hazard bandolier + grenade satchel
        if (aim) m.bar(0.02, -0.08, 0.33, 0.2, -0.07, 0.4, 0.034, F.gun, { sides: 6 });
        else m.bar(0, -0.09, 0.25, 0.18, -0.06, 0.29, 0.034, F.gun, { sides: 6 });
        m.box(0.035, 0, 0.26, 0.07, 0.19, 0.03, F.hazard);
        m.box(-0.08, 0.03, 0.2, 0.07, 0.12, 0.1, F.rust);
      },
    }),
    [0.2, -0.07, 0.42], 8,
  ),
  f_scorcher: inf(
    () => ({
      suit: hex('#4b4038'), armor: F.dark, helmet: F.rust, visor: F.glow, visorGlow: true, bulk: 1.15,
      kit: (m, aim) => {
        // twin fuel tanks, hose nozzle with pilot light
        m.cyl(-0.1, -0.045, 0.19, 0.045, 0.2, F.rust, { sides: 6 });
        m.cyl(-0.1, 0.045, 0.19, 0.045, 0.2, F.hazard, { sides: 6 });
        const z = aim ? 0.31 : 0.25;
        m.bar(0.02, -0.08, z, 0.25, -0.06, z, 0.026, F.gun, { sides: 6 });
        m.box(0.26, -0.06, z - 0.015, 0.03, 0.03, 0.03, F.glow, { emis: true });
      },
    }),
    [0.28, -0.06, 0.31], 0,
  ),
  f_sapper: inf(
    () => ({
      suit: hex('#6a5a44'), armor: hex('#84735a'), helmet: F.hazard, visor: F.black,
      kit: (m) => {
        m.box(-0.085, 0, 0.2, 0.08, 0.17, 0.17, F.rust);
        // shovel across the pack + toolbox
        m.bar(-0.12, -0.08, 0.2, -0.12, 0.09, 0.5, 0.012, F.steel);
        m.box(-0.12, 0.1, 0.48, 0.02, 0.06, 0.07, F.steel);
        m.box(0.06, -0.11, 0.11, 0.1, 0.04, 0.07, F.dark);
      },
    }),
    [0.1, 0, 0.3], 0,
  ),

  // ══════════════════════════ Ferrum vehicles ══════════════════════════
  f_hauler: {
    frames: 4,
    hull: (m, P, f) => {
      tracks(m, 1.06, 0.36, 0.19, 0.2, F.tread);
      m.box(-0.02, 0, 0.09, 1.0, 0.56, 0.14, F.iron);
      // boxy cab with slit window + roof lamp
      m.box(0.32, 0, 0.23, 0.3, 0.5, 0.2, F.mid);
      m.box(0.475, 0, 0.32, 0.012, 0.36, 0.06, F.glow, { emis: true });
      m.box(0.3, 0, 0.43, 0.2, 0.3, 0.02, F.rust);
      // open hopper flaring upward
      m.box(-0.22, 0, 0.23, 0.56, 0.5, 0.2, P.p, { taper: [1.12, 1.18], top: F.black });
      m.box(-0.22, 0, 0.43, 0.63, 0.59, 0.03, F.dark, { top: F.black });
      if (f > 0) m.box(-0.22, 0, 0.455, 0.5, 0.46, 0.01 + f * 0.04, ORE, { taper: 0.4 + 0.1 * (3 - f), top: ORE_L });
      // front grabber jaw
      m.box(0.6, 0, 0.02, 0.1, 0.6, 0.16, F.dark, { taper: [0.5, 1], shift: [0.03, 0] });
      m.box(0.56, 0, 0.18, 0.06, 0.62, 0.03, F.hazard);
      // exhaust stack
      m.cyl(0.14, -0.2, 0.43, 0.04, 0.2, F.black, { sides: 6 });
    },
    pivot: [0, 0, 0], muzzles: [[0.64, 0, 0.08]], tracks: [0.36, 1.06, 0.2], recoil: 0, flash: 0,
  },
  f_jackal: {
    frames: 1,
    hull: (m, P) => {
      wheels(m, [-0.27, 0.27], 0.27, 0.13, 0.11, F.tread, F.rust);
      m.box(0, 0, 0.13, 0.82, 0.36, 0.1, F.iron);
      m.box(0.26, 0, 0.23, 0.26, 0.34, 0.07, P.p, { taper: [0.7, 0.9], shift: [0.03, 0] });
      m.box(0.42, 0, 0.14, 0.03, 0.3, 0.07, F.dark);
      // roll cage
      for (const s of [-1, 1]) {
        m.bar(0.08, s * 0.16, 0.23, 0.04, s * 0.14, 0.4, 0.016, F.black);
        m.bar(-0.38, s * 0.16, 0.23, -0.3, s * 0.14, 0.4, 0.016, F.black);
        m.bar(0.04, s * 0.14, 0.4, -0.3, s * 0.14, 0.4, 0.016, F.black);
      }
      m.box(-0.37, 0, 0.23, 0.08, 0.3, 0.12, F.rust);
    },
    turret: (m) => {
      m.bar(0, 0, 0, 0, 0, 0.1, 0.02, F.black);
      m.box(0.02, 0, 0.1, 0.14, 0.07, 0.06, F.gun);
      m.bar(0.06, 0, 0.13, 0.36, 0, 0.13, 0.02, F.gun);
      m.box(-0.02, 0, 0.09, 0.02, 0.2, 0.12, F.mid);
    },
    pivot: [-0.13, 0, 0.4], muzzles: [[0.37, 0, 0.13]], recoil: 0.02, flash: 8,
  },
  f_hammer: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.04, 0.35, 0.2, 0.2, F.tread);
      m.box(0, 0, 0.09, 0.98, 0.52, 0.17, F.iron);
      m.box(0.44, 0, 0.12, 0.12, 0.5, 0.12, F.mid, { taper: [0.4, 1], shift: [0.02, 0] });
      // riveted fender plates in player colour
      m.box(0, -0.36, 0.2, 0.9, 0.2, 0.025, P.p);
      m.box(0, 0.36, 0.2, 0.9, 0.2, 0.025, P.p);
      m.box(-0.4, 0, 0.26, 0.18, 0.4, 0.05, F.dark);
      m.cyl(-0.46, -0.16, 0.31, 0.03, 0.12, F.black, { sides: 6 });
      m.cyl(-0.46, 0.16, 0.31, 0.03, 0.12, F.black, { sides: 6 });
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.25, 0.16, F.iron, { sides: 8 });
      m.cyl(0, 0, 0.16, 0.2, 0.03, F.mid, { sides: 8 });
      m.box(-0.1, 0, 0.19, 0.14, 0.24, 0.015, P.p);
      m.box(0.24, 0, 0.03, 0.1, 0.2, 0.11, F.dark);
      m.bar(0.26, 0, 0.085, 0.62, 0, 0.085, 0.042, F.gun, { sides: 6 });
      m.box(0.66, 0, 0.045, 0.1, 0.13, 0.08, F.black);
      m.cyl(0.02, 0.12, 0.19, 0.05, 0.035, F.dark, { sides: 6 });
    },
    pivot: [-0.02, 0, 0.26], muzzles: [[0.72, 0, 0.085]], tracks: [0.35, 1.04, 0.2], recoil: 0.08, flash: 17,
  },
  f_flakcrawler: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.0, 0.33, 0.18, 0.18, F.tread);
      m.box(0, 0, 0.09, 0.94, 0.5, 0.15, F.iron);
      m.box(0.34, 0, 0.24, 0.24, 0.42, 0.1, F.mid, { taper: [0.8, 0.9] });
      m.box(0.455, 0, 0.27, 0.012, 0.3, 0.04, F.glow, { emis: true });
      m.box(-0.12, 0, 0.24, 0.62, 0.48, 0.03, P.p);
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.19, 0.07, F.dark, { sides: 8 });
      m.box(-0.04, 0, 0.07, 0.16, 0.2, 0.16, F.mid);
      // gun shield + four elevated barrels
      m.box(0.07, 0, 0.07, 0.03, 0.4, 0.2, F.iron);
      for (const y of [-0.15, -0.07, 0.07, 0.15]) m.bar(0.0, y, 0.16, 0.36, y, 0.48, 0.018, F.gun);
      m.box(-0.14, 0, 0.07, 0.1, 0.26, 0.1, F.rust);
    },
    pivot: [-0.14, 0, 0.27], muzzles: [[0.38, -0.11, 0.5], [0.38, 0.11, 0.5]], tracks: [0.33, 1.0, 0.18], recoil: 0.03, flash: 9,
  },
  f_salamander: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.02, 0.34, 0.19, 0.19, F.tread);
      m.box(0.02, 0, 0.09, 0.96, 0.5, 0.16, F.iron);
      m.box(0.42, 0, 0.12, 0.14, 0.48, 0.11, F.mid, { taper: [0.4, 1], shift: [0.02, 0] });
      // fuel drums on the rear deck
      m.cyl(-0.3, -0.13, 0.25, 0.115, 0.2, F.rust, { sides: 8 });
      m.cyl(-0.3, 0.13, 0.25, 0.115, 0.2, F.hazard, { sides: 8 });
      m.cyl(-0.3, -0.13, 0.45, 0.07, 0.03, F.black, { sides: 8 });
      m.cyl(-0.3, 0.13, 0.45, 0.07, 0.03, F.black, { sides: 8 });
      m.box(0.04, -0.35, 0.19, 0.6, 0.18, 0.025, P.p);
      m.box(0.04, 0.35, 0.19, 0.6, 0.18, 0.025, P.p);
    },
    turret: (m, P) => {
      m.box(0, 0, 0, 0.3, 0.32, 0.12, F.mid, { taper: [0.8, 0.85] });
      m.box(-0.02, 0, 0.12, 0.16, 0.2, 0.015, P.p);
      for (const s of [-1, 1]) {
        m.bar(0.12, s * 0.08, 0.06, 0.4, s * 0.08, 0.06, 0.036, F.gun, { sides: 6 });
        m.bar(0.4, s * 0.08, 0.06, 0.48, s * 0.08, 0.06, 0.05, F.black, { sides: 6 });
        m.box(0.49, s * 0.08, 0.04, 0.02, 0.04, 0.04, F.glow, { emis: true });
      }
    },
    pivot: [0.08, 0, 0.25], muzzles: [[0.5, -0.08, 0.06], [0.5, 0.08, 0.06]], tracks: [0.34, 1.02, 0.19], recoil: 0, flash: 0,
  },
  f_hailstorm: {
    frames: 1,
    hull: (m, P) => {
      wheels(m, [-0.34, -0.06, 0.32], 0.27, 0.115, 0.1, F.tread, F.rust);
      m.box(-0.02, 0, 0.12, 1.0, 0.4, 0.09, F.iron);
      m.box(0.36, 0, 0.21, 0.24, 0.42, 0.18, F.mid);
      m.box(0.485, 0, 0.29, 0.012, 0.32, 0.06, F.glow, { emis: true });
      m.box(0.36, 0, 0.39, 0.18, 0.3, 0.02, P.p);
      m.box(-0.2, 0, 0.21, 0.58, 0.4, 0.03, F.dark);
    },
    turret: (m, P) => {
      m.cyl(0, 0, 0, 0.14, 0.05, F.dark, { sides: 8 });
      // elevated rocket rack: 2 x 4 tubes with red warheads
      const zb = 0.08;
      m.bar(-0.22, 0, zb + 0.03, 0.22, 0, zb + 0.22, 0.16, F.iron, { sides: 4 });
      m.bar(-0.2, 0, zb + 0.2, 0.2, 0, zb + 0.39, 0.02, P.p, { sides: 4 });
      for (const y of [-0.12, -0.04, 0.04, 0.12]) {
        for (const dz of [-0.045, 0.045]) {
          m.box(0.228, y, zb + 0.2 + dz, 0.014, 0.05, 0.05, hex('#d5482f'), { emis: true });
        }
      }
      m.bar(-0.08, 0, 0.03, -0.08, 0, zb + 0.06, 0.04, F.black);
    },
    pivot: [-0.2, 0, 0.24], muzzles: [[0.26, -0.08, 0.3], [0.26, 0.08, 0.3]], recoil: 0.02, flash: 12,
  },
  f_colossus: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.22, 0.42, 0.25, 0.23, F.tread);
      m.box(0, 0, 0.1, 1.14, 0.62, 0.2, F.iron);
      m.box(0.5, 0, 0.13, 0.16, 0.6, 0.15, F.mid, { taper: [0.4, 1], shift: [0.03, 0] });
      m.box(0, -0.43, 0.235, 1.06, 0.25, 0.03, P.p);
      m.box(0, 0.43, 0.235, 1.06, 0.25, 0.03, P.p);
      m.box(-0.44, 0, 0.3, 0.24, 0.5, 0.08, F.dark);
      m.cyl(-0.5, -0.2, 0.38, 0.04, 0.18, F.black, { sides: 6 });
      m.cyl(-0.5, 0.2, 0.38, 0.04, 0.18, F.black, { sides: 6 });
      m.box(0.3, 0, 0.3, 0.22, 0.4, 0.03, F.hazard);
    },
    turret: (m, P) => {
      m.poly([-0.3, -0.24, 0.16, -0.26, 0.3, -0.14, 0.3, 0.14, 0.16, 0.26, -0.3, 0.24], 0, 0.2, F.iron);
      m.box(-0.06, 0, 0.2, 0.34, 0.36, 0.03, F.mid);
      m.box(-0.12, 0, 0.23, 0.16, 0.3, 0.015, P.p);
      for (const s of [-1, 1]) {
        m.bar(0.26, s * 0.1, 0.1, 0.78, s * 0.1, 0.1, 0.045, F.gun, { sides: 6 });
        m.box(0.82, s * 0.1, 0.055, 0.1, 0.12, 0.09, F.black);
      }
      m.box(0.31, 0, 0.03, 0.06, 0.4, 0.14, F.dark);
      // side AA missile pod
      m.bar(-0.2, 0.33, 0.14, 0.08, 0.33, 0.26, 0.07, F.rust, { sides: 4 });
      m.bar(0.08, 0.33, 0.26, 0.1, 0.33, 0.27, 0.05, hex('#d5482f'), { sides: 4, emis: true });
      m.cyl(-0.1, -0.16, 0.23, 0.06, 0.04, F.dark, { sides: 6 });
    },
    pivot: [-0.04, 0, 0.33], muzzles: [[0.88, -0.1, 0.1], [0.88, 0.1, 0.1]], tracks: [0.42, 1.22, 0.23], recoil: 0.09, flash: 19,
  },
  f_crawler: {
    frames: 1,
    hull: (m, P) => {
      tracks(m, 1.12, 0.4, 0.22, 0.2, F.tread);
      m.box(0, 0, 0.1, 1.06, 0.62, 0.17, F.iron);
      m.box(0.36, 0, 0.27, 0.26, 0.52, 0.2, F.mid);
      m.box(0.495, 0, 0.36, 0.012, 0.38, 0.06, F.glow, { emis: true });
      // portable furnace block + chimney + folded crane
      m.box(-0.18, 0, 0.27, 0.6, 0.56, 0.26, F.dark);
      m.box(-0.18, 0, 0.53, 0.5, 0.46, 0.03, P.p);
      m.box(-0.18, 0.285, 0.33, 0.3, 0.012, 0.12, F.glow, { emis: true });
      m.cyl(-0.34, -0.14, 0.56, 0.07, 0.3, F.black, { sides: 8, taper: 0.85 });
      m.bar(-0.4, 0.16, 0.56, 0.3, 0.16, 0.72, 0.025, F.hazard);
      m.bar(0.3, 0.16, 0.72, 0.3, 0.16, 0.5, 0.012, F.black);
    },
    pivot: [0, 0, 0], muzzles: [], tracks: [0.4, 1.12, 0.2], recoil: 0, flash: 0,
  },
  f_vulture: {
    frames: 1,
    hull: (m, P) => {
      // slab-sided lifter: four corner thrust drums, bomb racks, twin tail fins
      m.box(0, 0, 0.1, 0.9, 0.34, 0.16, F.iron, { taper: [0.92, 0.85] });
      m.box(0.44, 0, 0.12, 0.2, 0.3, 0.12, F.mid, { taper: [0.4, 0.8], shift: [0.03, 0] });
      m.box(0.34, 0, 0.26, 0.2, 0.22, 0.05, F.glow, { emis: true, taper: 0.7 });
      m.box(-0.05, 0, 0.26, 0.5, 0.26, 0.02, P.p);
      for (const sx of [-1, 1]) {
        m.box(sx * 0.27, 0, 0.14, 0.14, 0.92, 0.05, F.mid);
        for (const sy of [-1, 1]) {
          m.cyl(sx * 0.27, sy * 0.44, 0.06, 0.15, 0.14, F.dark, { sides: 8, top: F.black });
          m.cyl(sx * 0.27, sy * 0.44, 0.2, 0.04, 0.03, F.rust, { sides: 6 });
        }
      }
      for (const s of [-1, 1]) m.bar(-0.42, s * 0.12, 0.24, -0.58, s * 0.14, 0.4, 0.035, P.p);
      // bombs slung underneath
      m.bar(-0.14, -0.07, 0.07, 0.1, -0.07, 0.07, 0.04, F.black, { sides: 6 });
      m.bar(-0.14, 0.07, 0.07, 0.1, 0.07, 0.07, 0.04, F.black, { sides: 6 });
    },
    pivot: [0, 0, 0], muzzles: [[0, 0, 0.04]], recoil: 0, flash: 0,
    rotors: [[0.27, -0.44, 0.205, 0.13], [0.27, 0.44, 0.205, 0.13], [-0.27, -0.44, 0.205, 0.13], [-0.27, 0.44, 0.205, 0.13]],
    jets: [[0.27, -0.44, 0.03], [0.27, 0.44, 0.03], [-0.27, -0.44, 0.03], [-0.27, 0.44, 0.03]],
  },
};

/** Fallback for unknown unit ids so the renderer never crashes on new data. */
export const UNIT_FALLBACK: UnitArt = {
  frames: 1,
  hull: (m, P) => {
    m.box(0, 0, 0.05, 0.8, 0.5, 0.2, hex('#888888'));
    m.box(0, 0, 0.25, 0.4, 0.3, 0.05, P.p);
  },
  pivot: [0, 0, 0], muzzles: [[0.4, 0, 0.2]], recoil: 0, flash: 8,
};
