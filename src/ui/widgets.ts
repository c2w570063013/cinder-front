// Form widgets shared by the menus and the pause/settings overlays.
import { el } from './dom';

export interface Segmented<T> {
  el: HTMLElement;
  set(value: T): void;
  /** Enable/disable individual options. */
  setDisabled(pred: (value: T) => boolean): void;
}

export function segmented<T extends string | number | boolean>(
  options: { value: T; label: string; sub?: string; title?: string }[],
  value: T,
  onChange: (value: T) => void,
  click?: () => void,
): Segmented<T> {
  const root = el('div', 'cf-seg');
  const buttons: { value: T; b: HTMLButtonElement }[] = [];
  let current = value;
  const paint = () => {
    for (const o of buttons) o.b.classList.toggle('is-on', o.value === current);
  };
  for (const o of options) {
    const b = el('button', 'cf-seg-btn');
    b.type = 'button';
    b.append(el('span', 'cf-seg-label', o.label));
    if (o.sub) b.append(el('span', 'cf-seg-sub', o.sub));
    if (o.title) b.title = o.title;
    b.addEventListener('click', () => {
      if (b.disabled || current === o.value) return;
      current = o.value;
      paint();
      click?.();
      onChange(o.value);
    });
    buttons.push({ value: o.value, b });
    root.append(b);
  }
  paint();
  return {
    el: root,
    set(v) {
      current = v;
      paint();
    },
    setDisabled(pred) {
      for (const o of buttons) o.b.disabled = pred(o.value);
    },
  };
}

export function slider(value: number, min: number, max: number, step: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLElement {
  const wrap = el('div', 'cf-slider');
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('span', 'cf-slider-val', fmt(value));
  const paint = () => {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--pct', pct + '%');
  };
  paint();
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    paint();
    onInput(v);
  });
  wrap.append(input, out);
  return wrap;
}

export function toggle(value: boolean, onChange: (v: boolean) => void, click?: () => void): HTMLButtonElement {
  const b = el('button', 'cf-toggle');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  let v = value;
  const paint = () => {
    b.classList.toggle('is-on', v);
    b.setAttribute('aria-checked', String(v));
  };
  paint();
  b.append(el('i'));
  b.addEventListener('click', () => {
    v = !v;
    paint();
    click?.();
    onChange(v);
  });
  return b;
}

/** Labelled row: 「標題 / small English」 on the left, control on the right. */
export function row(label: string, sub: string | null, control: HTMLElement): HTMLElement {
  const r = el('div', 'cf-row');
  const l = el('div', 'cf-row-label');
  l.append(el('span', '', label));
  if (sub) l.append(el('small', '', sub));
  r.append(l, control);
  return r;
}

export function section(title: string, sub?: string): HTMLElement {
  const h = el('div', 'cf-section');
  h.append(el('span', '', title));
  if (sub) h.append(el('small', '', sub));
  return h;
}
