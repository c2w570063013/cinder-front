// Context cursors, drawn procedurally on a canvas and used as CSS data-URL cursors (1x + 2x for Retina).

export type CursorName =
  | 'select'
  | 'move'
  | 'attack'
  | 'harvest'
  | 'enter'
  | 'deploy'
  | 'nogo'
  | 'sell'
  | 'repair'
  | 'target'
  | 'grab';

type Painter = (c: CanvasRenderingContext2D) => void;

const SIZE = 32;
const INK = '#0a0d10';

/** Stroke a path twice: dark halo then colour, so cursors read on any terrain. */
function ink(c: CanvasRenderingContext2D, color: string, width: number, path: () => void): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  path();
  c.strokeStyle = INK;
  c.lineWidth = width + 2.4;
  c.stroke();
  c.beginPath();
  path();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

function fillInk(c: CanvasRenderingContext2D, color: string, path: () => void): void {
  c.lineJoin = 'round';
  c.beginPath();
  path();
  c.closePath();
  c.strokeStyle = INK;
  c.lineWidth = 2.4;
  c.stroke();
  c.fillStyle = color;
  c.fill();
}

const PAINTERS: Record<Exclude<CursorName, 'grab'>, { hot: [number, number]; paint: Painter }> = {
  // Slim pointer with a notch — hotspot at the tip.
  select: {
    hot: [3, 2],
    paint: (c) => {
      fillInk(c, '#f1efe9', () => {
        c.moveTo(3, 2);
        c.lineTo(3, 21);
        c.lineTo(8.2, 16.4);
        c.lineTo(12.2, 24.5);
        c.lineTo(15.4, 23);
        c.lineTo(11.6, 15);
        c.lineTo(18.5, 14.6);
      });
    },
  },
  // Four chevrons converging on a centre dot.
  move: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#6fe3a1';
      ink(c, col, 2.2, () => {
        c.moveTo(12, 5);
        c.lineTo(16, 9.5);
        c.lineTo(20, 5);
        c.moveTo(12, 27);
        c.lineTo(16, 22.5);
        c.lineTo(20, 27);
        c.moveTo(5, 12);
        c.lineTo(9.5, 16);
        c.lineTo(5, 20);
        c.moveTo(27, 12);
        c.lineTo(22.5, 16);
        c.lineTo(27, 20);
      });
      fillInk(c, col, () => c.arc(16, 16, 2.2, 0, Math.PI * 2));
    },
  },
  // Broken ring with inward ticks.
  attack: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#ff5a52';
      ink(c, col, 2.2, () => {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          c.moveTo(16 + Math.cos(a - 0.55) * 10, 16 + Math.sin(a - 0.55) * 10);
          c.arc(16, 16, 10, a - 0.55, a + 0.55);
        }
        c.moveTo(16, 2.5);
        c.lineTo(16, 9);
        c.moveTo(16, 23);
        c.lineTo(16, 29.5);
        c.moveTo(2.5, 16);
        c.lineTo(9, 16);
        c.moveTo(23, 16);
        c.lineTo(29.5, 16);
      });
      fillInk(c, col, () => c.arc(16, 16, 1.8, 0, Math.PI * 2));
    },
  },
  // Faceted crystal with a gather chevron beneath.
  harvest: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#ffc24a';
      fillInk(c, col, () => {
        c.moveTo(16, 3);
        c.lineTo(23, 11);
        c.lineTo(16, 20);
        c.lineTo(9, 11);
      });
      ink(c, '#7a4a00', 1.2, () => {
        c.moveTo(9, 11);
        c.lineTo(23, 11);
        c.moveTo(16, 3);
        c.lineTo(13, 11);
        c.lineTo(16, 20);
        c.lineTo(19, 11);
        c.lineTo(16, 3);
      });
      ink(c, col, 2.2, () => {
        c.moveTo(9, 23);
        c.lineTo(16, 28.5);
        c.lineTo(23, 23);
      });
    },
  },
  // Arrow driving into an open bracket.
  enter: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#5cd6ff';
      ink(c, col, 2.2, () => {
        c.moveTo(19, 5);
        c.lineTo(27, 5);
        c.lineTo(27, 27);
        c.lineTo(19, 27);
        c.moveTo(4, 16);
        c.lineTo(19, 16);
        c.moveTo(13.5, 10.5);
        c.lineTo(19, 16);
        c.lineTo(13.5, 21.5);
      });
    },
  },
  // Square unfolding outward.
  deploy: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#ffe07a';
      ink(c, col, 2.2, () => {
        c.rect(11.5, 11.5, 9, 9);
        c.moveTo(16, 8);
        c.lineTo(16, 3);
        c.moveTo(13, 6);
        c.lineTo(16, 3);
        c.lineTo(19, 6);
        c.moveTo(16, 24);
        c.lineTo(16, 29);
        c.moveTo(13, 26);
        c.lineTo(16, 29);
        c.lineTo(19, 26);
        c.moveTo(8, 16);
        c.lineTo(3, 16);
        c.moveTo(6, 13);
        c.lineTo(3, 16);
        c.lineTo(6, 19);
        c.moveTo(24, 16);
        c.lineTo(29, 16);
        c.moveTo(26, 13);
        c.lineTo(29, 16);
        c.lineTo(26, 19);
      });
    },
  },
  nogo: {
    hot: [16, 16],
    paint: (c) => {
      ink(c, '#c8ccd0', 2.4, () => {
        c.arc(16, 16, 9.5, 0, Math.PI * 2);
        c.moveTo(9.3, 9.3);
        c.lineTo(22.7, 22.7);
      });
    },
  },
  // Credit diamond dropping out of a frame.
  sell: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#ffc24a';
      ink(c, col, 2.2, () => {
        c.moveTo(16, 3.5);
        c.lineTo(24, 12);
        c.lineTo(16, 20.5);
        c.lineTo(8, 12);
        c.closePath();
        c.moveTo(16, 17);
        c.lineTo(16, 29);
        c.moveTo(11.5, 24.5);
        c.lineTo(16, 29);
        c.lineTo(20.5, 24.5);
      });
    },
  },
  // Open-jaw spanner.
  repair: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#7be28f';
      ink(c, col, 3.4, () => {
        c.moveTo(7, 25);
        c.lineTo(18, 14);
      });
      ink(c, col, 2.4, () => {
        c.moveTo(25.5, 9.5);
        c.arc(21, 11, 5, -0.2, Math.PI * 1.25, false);
        c.moveTo(22.5, 5.6);
        c.lineTo(20.5, 10.5);
        c.lineTo(25.5, 9.5);
      });
    },
  },
  // Large strike reticle.
  target: {
    hot: [16, 16],
    paint: (c) => {
      const col = '#ff9d2e';
      ink(c, col, 2, () => {
        c.arc(16, 16, 11.5, 0, Math.PI * 2);
        c.moveTo(21, 16);
        c.arc(16, 16, 5, 0, Math.PI * 2);
        c.moveTo(16, 1.5);
        c.lineTo(16, 7);
        c.moveTo(16, 25);
        c.lineTo(16, 30.5);
        c.moveTo(1.5, 16);
        c.lineTo(7, 16);
        c.moveTo(25, 16);
        c.lineTo(30.5, 16);
      });
      fillInk(c, col, () => c.arc(16, 16, 1.6, 0, Math.PI * 2));
    },
  },
};

const FALLBACK: Record<CursorName, string> = {
  select: 'default',
  move: 'pointer',
  attack: 'crosshair',
  harvest: 'pointer',
  enter: 'pointer',
  deploy: 'pointer',
  nogo: 'not-allowed',
  sell: 'pointer',
  repair: 'pointer',
  target: 'crosshair',
  grab: 'grabbing',
};

function drawUrl(p: { paint: Painter }, scale: number): string | null {
  try {
    const cv = document.createElement('canvas');
    cv.width = SIZE * scale;
    cv.height = SIZE * scale;
    const c = cv.getContext('2d');
    if (!c) return null;
    c.scale(scale, scale);
    p.paint(c);
    return cv.toDataURL('image/png');
  } catch {
    return null;
  }
}

const cache = new Map<CursorName, string[]>();

/**
 * CSS `cursor` values to try in order (later ones override earlier ones if the browser accepts them):
 * plain keyword → 1x image → Retina image-set.
 */
function cssValues(name: CursorName): string[] {
  const hit = cache.get(name);
  if (hit) return hit;
  const fb = FALLBACK[name];
  const out = [fb];
  if (name !== 'grab') {
    const p = PAINTERS[name];
    const u1 = drawUrl(p, 1);
    const u2 = drawUrl(p, 2);
    const [hx, hy] = p.hot;
    if (u1) {
      out.push(`url(${u1}) ${hx} ${hy}, ${fb}`);
      if (u2) {
        out.push(`-webkit-image-set(url(${u1}) 1x, url(${u2}) 2x) ${hx} ${hy}, ${fb}`);
        out.push(`image-set(url(${u1}) 1x, url(${u2}) 2x) ${hx} ${hy}, ${fb}`);
      }
    }
  }
  cache.set(name, out);
  return out;
}

/** Apply a context cursor to an element. Invalid declarations are ignored by the browser, leaving the previous one. */
export function applyCursor(target: HTMLElement, name: CursorName): void {
  for (const v of cssValues(name)) target.style.cursor = v;
}
