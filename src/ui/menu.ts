// Main menu: title screen, skirmish lobby, controls reference, settings and the end-of-match result screen.
import type { CreateMenu, MapInfo, MenuUi } from '../core/api';
import { TICK_RATE } from '../core/constants';
import { makeRng } from '../core/rng';
import type { Difficulty, FactionId, GameMap, GameSetup, PlayerSetup, World } from '../core/types';
import { FACTIONS, GAME_TITLE, GAME_TITLE_EN } from '../data';
import { button, el, fmtNum, fmtTime, glyph, hexToRgbTriplet, safeDpr } from './dom';
import { createMenuBackground } from './menu/background';
import { drawMapPreview, renderMapBase, type PreviewLayout, type StartMark } from './menu/thumb';
import { buildHowTo, buildSettingsPanel } from './panels';
import { loadJson, saveJson } from './settings';
import { injectStyle } from './style';
import { row, segmented, toggle } from './widgets';

interface AiSlot {
  faction: FactionId | 'random';
  difficulty: Difficulty;
  team: number;
}

interface Lobby {
  mapId: string;
  faction: FactionId;
  color: string;
  /** Index into map.starts, -1 = random. */
  start: number;
  ais: AiSlot[];
  credits: number;
  fog: boolean;
  shortGame: boolean;
  superweapons: boolean;
}

const LOBBY_KEY = 'cinderfront.ui.lobby.v1';
const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
const ALL_COLORS: string[] = [...new Set(FACTION_IDS.flatMap((f) => FACTIONS[f].colors))];
const DIFF_ZH: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };
const MENU_ACCENT = '#ff8a2a';

function randomSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0xffff)) >>> 0 || 1;
}

function loadLobby(): Lobby {
  const l: Lobby = {
    mapId: '',
    faction: 'helion',
    color: FACTIONS.helion.colors[0],
    start: -1,
    ais: [{ faction: 'random', difficulty: 'normal', team: 2 }],
    credits: 10000,
    fog: true,
    shortGame: false,
    superweapons: true,
  };
  const p = loadJson<Lobby>(LOBBY_KEY);
  if (p) {
    if (typeof p.mapId === 'string') l.mapId = p.mapId;
    if (p.faction && FACTIONS[p.faction]) l.faction = p.faction;
    if (typeof p.color === 'string' && ALL_COLORS.includes(p.color)) l.color = p.color;
    if (p.credits === 5000 || p.credits === 10000 || p.credits === 20000) l.credits = p.credits;
    if (typeof p.fog === 'boolean') l.fog = p.fog;
    if (typeof p.shortGame === 'boolean') l.shortGame = p.shortGame;
    if (typeof p.superweapons === 'boolean') l.superweapons = p.superweapons;
    if (Array.isArray(p.ais) && p.ais.length) {
      const ais: AiSlot[] = [];
      for (const a of p.ais.slice(0, 3)) {
        if (!a) continue;
        ais.push({
          faction: a.faction === 'random' || (a.faction && FACTIONS[a.faction]) ? a.faction : 'random',
          difficulty: a.difficulty === 'easy' || a.difficulty === 'hard' ? a.difficulty : 'normal',
          team: typeof a.team === 'number' && a.team >= 1 && a.team <= 4 ? a.team : 2,
        });
      }
      if (ais.length) l.ais = ais;
    }
  }
  return l;
}

export const createMenu: CreateMenu = (deps) => {
  injectStyle();
  const { audio, maps } = deps;
  if (getComputedStyle(deps.root).position === 'static') deps.root.style.position = 'relative';

  const root = el('div', 'cf-root cf-menu');
  root.style.display = 'none';
  const bgCanvas = el('canvas', 'cf-menu-bg');
  const vignette = el('div', 'cf-menu-vignette');
  const stage = el('div');
  root.append(bgCanvas, vignette, stage);
  deps.root.append(root);
  const bg = createMenuBackground(bgCanvas);

  const click = () => audio.playUi('click');
  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      audio.unlock();
      audio.setMusic('menu');
    } catch {
      /* ignore */
    }
  };
  root.addEventListener('pointerdown', unlock);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('dragstart', (e) => e.preventDefault());

  function setAccent(color: string): void {
    root.style.setProperty('--cf-accent', color);
    root.style.setProperty('--cf-accent-rgb', hexToRgbTriplet(color));
  }
  setAccent(MENU_ACCENT);

  let screen: 'title' | 'lobby' | 'howto' | 'settings' | 'result' = 'title';
  let cleanup: (() => void) | null = null;

  function mount(name: typeof screen, node: HTMLElement, dispose?: () => void): void {
    cleanup?.();
    cleanup = dispose ?? null;
    screen = name;
    stage.replaceChildren(node);
  }

  function pageHead(title: string, sub: string, onBack: () => void): HTMLElement {
    const head = el('div', 'cf-page-head');
    const back = button('cf-icon-btn', glyph('back', 18), () => {
      click();
      onBack();
    });
    back.title = '返回 (Esc)';
    const h2 = el('h2', '', title);
    head.append(back, h2, el('small', '', sub));
    return head;
  }

  // ───────────────────────── title ─────────────────────────
  function showTitle(): void {
    setAccent(MENU_ACCENT);
    const s = el('div', 'cf-screen cf-title');
    const block = el('div', 'cf-title-block');
    block.append(
      el('div', 'cf-title-kicker', 'Isometric Real-Time Strategy'),
      el('h1', 'cf-title-name', GAME_TITLE),
      el('div', 'cf-title-en', GAME_TITLE_EN),
      el('p', 'cf-title-tag', '採集晶礦・建立基地・掌控電力・以鋼鐵與烈焰奪回燼原'),
    );
    const nav = el('div', 'cf-title-nav');
    nav.append(
      button('cf-btn is-primary', '<span>遭遇戰</span><small>Skirmish</small>', () => {
        click();
        showLobby();
      }),
      button('cf-btn', '<span>操作說明</span><small>Controls</small>', () => {
        click();
        showHowTo();
      }),
      button('cf-btn', '<span>設定</span><small>Settings</small>', () => {
        click();
        showSettings();
      }),
    );
    const foot = el('div', 'cf-title-foot');
    foot.append(el('span', '', `${GAME_TITLE} ${GAME_TITLE_EN}`), el('span', '', 'v0.1'));
    s.append(block, nav, foot);
    mount('title', s);
  }

  function showHowTo(): void {
    const s = el('div', 'cf-screen cf-page');
    const card = el('div', 'cf-glass cf-page-wide');
    const scroll = el('div', 'cf-card-scroll');
    scroll.append(buildHowTo());
    card.append(pageHead('操作說明', 'Controls', showTitle), scroll);
    card.firstElementChild?.setAttribute('style', 'margin-bottom:12px');
    s.append(card);
    mount('howto', s);
  }

  function showSettings(): void {
    const s = el('div', 'cf-screen cf-page');
    const card = el('div', 'cf-glass cf-page-narrow');
    const scroll = el('div', 'cf-card-scroll');
    scroll.append(buildSettingsPanel(audio));
    card.append(pageHead('設定', 'Settings', showTitle), scroll);
    card.firstElementChild?.setAttribute('style', 'margin-bottom:12px');
    s.append(card);
    mount('settings', s);
  }

  // ───────────────────────── skirmish lobby ─────────────────────────
  const lobby = loadLobby();
  let seed = randomSeed();

  function showLobby(): void {
    const s = el('div', 'cf-screen cf-page');
    if (maps.length === 0) {
      const card = el('div', 'cf-glass cf-page-narrow');
      card.append(pageHead('遭遇戰', 'Skirmish', showTitle), el('p', 'cf-card-text', '尚未載入任何地圖。'));
      s.append(card);
      mount('lobby', s);
      return;
    }

    let info: MapInfo = maps.find((m) => m.id === lobby.mapId) ?? maps[0];
    let map: GameMap | null = null;
    let base: HTMLCanvasElement | null = null;
    let layout: PreviewLayout | null = null;

    const maxAis = () => Math.max(1, Math.min(3, info.maxPlayers - 1));
    const save = () => saveJson(LOBBY_KEY, lobby);

    // ── column 1: maps ──
    const colMaps = el('div', 'cf-glass cf-col');
    const mapsTitle = el('div', 'cf-col-title');
    mapsTitle.append(el('span', '', '戰場'), el('small', '', 'Maps'));
    const mapList = el('div', 'cf-col-scroll');
    colMaps.append(mapsTitle, mapList);
    const mapButtons = new Map<string, HTMLButtonElement>();
    for (const m of maps) {
      const b = el('button', 'cf-map-item');
      b.type = 'button';
      b.append(el('b', '', m.name), el('span', '', `${m.width}×${m.height} · 最多 ${m.maxPlayers} 人`));
      b.addEventListener('click', () => {
        if (info === m) return;
        click();
        info = m;
        lobby.mapId = m.id;
        lobby.start = -1;
        seed = randomSeed();
        if (lobby.ais.length > maxAis()) lobby.ais.length = maxAis();
        regenerate();
        paintAll();
        save();
      });
      mapButtons.set(m.id, b);
      mapList.append(b);
    }

    // ── column 2: preview ──
    const colPrev = el('div', 'cf-glass cf-col');
    const prevBox = el('div', 'cf-preview');
    const prevCanvas = el('canvas');
    prevBox.append(prevCanvas);
    const prevInfo = el('div', 'cf-preview-info');
    const prevName = el('div', 'cf-preview-name');
    const prevTitle = el('b');
    const reroll = button('cf-icon-btn', glyph('dice', 16), () => {
      click();
      seed = randomSeed();
      regenerate();
      paintPreview();
    });
    reroll.title = '重新生成地形 Reroll';
    prevName.append(prevTitle, reroll);
    const prevDesc = el('p', 'cf-preview-desc');
    const chips = el('div', 'cf-chips');
    prevInfo.append(prevName, prevDesc, chips);
    colPrev.append(prevBox, prevInfo);

    prevCanvas.addEventListener('click', (e) => {
      if (!map || !layout) return;
      const r = prevCanvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      let hit = -1;
      let best = 16 * 16;
      map.starts.forEach((st, i) => {
        const p = layout!.toScreen(st.x + 0.5, st.y + 0.5);
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < best) {
          best = d;
          hit = i;
        }
      });
      click();
      lobby.start = hit === lobby.start ? -1 : hit;
      startSeg.set(lobby.start);
      paintPreview();
    });

    // ── column 3: players + rules ──
    const colCfg = el('div', 'cf-glass cf-col');
    const cfg = el('div', 'cf-col-scroll');
    colCfg.append(cfg);

    const youTitle = el('div', 'cf-col-title');
    youTitle.append(el('span', '', '指揮官'), el('small', '', 'You'));
    const factionBox = el('div', 'cf-faction');
    const factionDesc = el('p', 'cf-faction-desc');
    const factionBtns = new Map<FactionId, HTMLButtonElement>();
    for (const f of FACTION_IDS) {
      const fd = FACTIONS[f];
      const b = el('button', 'cf-faction-btn');
      b.type = 'button';
      b.append(el('b', '', fd.name), el('small', '', fd.nameEn));
      b.addEventListener('click', () => {
        if (lobby.faction === f) return;
        click();
        const wasDefault = FACTIONS[lobby.faction].colors.includes(lobby.color);
        lobby.faction = f;
        if (wasDefault) lobby.color = fd.colors[0];
        paintYou();
        paintAis();
        paintPreview();
        save();
      });
      factionBtns.set(f, b);
      factionBox.append(b);
    }
    const swatches = el('div', 'cf-swatches');
    const swatchBtns = new Map<string, HTMLButtonElement>();
    for (const c of ALL_COLORS) {
      const b = el('button', 'cf-swatch');
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.title = c;
      b.addEventListener('click', () => {
        click();
        lobby.color = c;
        paintYou();
        paintAis();
        paintPreview();
        save();
      });
      swatchBtns.set(c, b);
      swatches.append(b);
    }
    let startSeg = segmented<number>([{ value: -1, label: '隨機' }], -1, () => undefined);
    const startRow = row('起始位置', 'Start', startSeg.el);

    const aiTitle = el('div', 'cf-col-title');
    aiTitle.append(el('span', '', '對手'), el('small', '', 'Opponents'));
    const aiBox = el('div', 'cf-ai');

    const rulesTitle = el('div', 'cf-col-title');
    rulesTitle.append(el('span', '', '規則'), el('small', '', 'Rules'));
    const rules = el('div', 'cf-form');
    rules.append(
      row(
        '起始資金',
        'Credits',
        segmented(
          [
            { value: 5000, label: '5,000' },
            { value: 10000, label: '10,000' },
            { value: 20000, label: '20,000' },
          ],
          lobby.credits,
          (v) => {
            lobby.credits = v;
            save();
          },
          click,
        ).el,
      ),
      row('戰爭迷霧', 'Fog of war', toggle(lobby.fog, (v) => ((lobby.fog = v), save()), click)),
      row('速戰模式', '建築全毀即戰敗', toggle(lobby.shortGame, (v) => ((lobby.shortGame = v), save()), click)),
      row('超級武器', 'Superweapons', toggle(lobby.superweapons, (v) => ((lobby.superweapons = v), save()), click)),
    );

    cfg.append(youTitle, factionBox, factionDesc, row('代表色', 'Colour', swatches), startRow, aiTitle, aiBox, rulesTitle, rules);

    // ── footer ──
    const note = el('p', 'cf-page-note');
    const startBtn = button('cf-btn is-primary', '開始戰鬥', () => {
      click();
      launch();
    });
    const foot = el('div', 'cf-page-foot');
    foot.append(
      note,
      button('cf-btn', '返回', () => {
        click();
        showTitle();
      }),
      startBtn,
    );

    const grid = el('div', 'cf-lobby');
    grid.append(colMaps, colPrev, colCfg);
    s.append(pageHead('遭遇戰', 'Skirmish setup', showTitle), grid, foot);

    // ── logic ──
    function regenerate(): void {
      try {
        map = info.generate(seed);
        base = renderMapBase(map);
      } catch (err) {
        console.error('[ui] map generation failed', err);
        map = null;
        base = null;
      }
      if (map && lobby.start >= map.starts.length) lobby.start = -1;
    }

    /** Unique colour per AI: prefer its own faction's palette, never the player's colour. */
    function aiColors(): string[] {
      const taken = new Set<string>([lobby.color]);
      return lobby.ais.map((a, i) => {
        const pref = a.faction === 'random' ? [] : FACTIONS[a.faction].colors;
        const rotated = ALL_COLORS.slice(((i + 1) * 3) % ALL_COLORS.length).concat(ALL_COLORS);
        const c = [...pref, ...rotated].find((x) => !taken.has(x)) ?? '#9aa3ab';
        taken.add(c);
        return c;
      });
    }

    function paintMaps(): void {
      for (const [id, b] of mapButtons) b.classList.toggle('is-on', id === info.id);
    }

    function paintPreview(): void {
      prevTitle.textContent = info.name;
      prevDesc.textContent = info.desc;
      chips.replaceChildren(
        el('span', 'cf-chip', `${info.width} × ${info.height}`),
        el('span', 'cf-chip', `最多 ${info.maxPlayers} 名玩家`),
        el('span', 'cf-chip', `地形種子 ${seed.toString(36).toUpperCase()}`),
        el('span', 'cf-chip', '點擊地圖上的編號選擇起始位置'),
      );
      if (!map || !base) return;
      const marks: StartMark[] = map.starts.map((_, i) => ({ color: i === lobby.start ? lobby.color : null, label: String(i + 1), highlight: i === lobby.start }));
      layout = drawMapPreview(prevCanvas, map, base, marks, safeDpr());
    }

    function paintYou(): void {
      setAccent(lobby.color);
      for (const [f, b] of factionBtns) b.classList.toggle('is-on', f === lobby.faction);
      factionDesc.textContent = FACTIONS[lobby.faction].desc;
      for (const [c, b] of swatchBtns) b.classList.toggle('is-on', c === lobby.color);
    }

    function paintStart(): void {
      const n = Math.min(map?.starts.length ?? info.maxPlayers, 8);
      const opts = [{ value: -1, label: '隨機' }];
      for (let i = 0; i < n; i++) opts.push({ value: i, label: String(i + 1) });
      startSeg = segmented<number>(
        opts,
        lobby.start,
        (v) => {
          lobby.start = v;
          paintPreview();
        },
        click,
      );
      startRow.replaceChild(startSeg.el, startRow.lastElementChild!);
    }

    function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
      const sEl = el('select', 'cf-select');
      for (const o of options) {
        const op = el('option', '', o.label);
        op.value = o.value;
        sEl.append(op);
      }
      sEl.value = value;
      sEl.addEventListener('change', () => {
        click();
        onChange(sEl.value as T);
      });
      return sEl;
    }

    function paintAis(): void {
      const colors = aiColors();
      aiBox.replaceChildren();
      lobby.ais.forEach((a, i) => {
        const r = el('div', 'cf-ai-row');
        const dot = el('i', 'cf-ai-dot');
        dot.style.setProperty('--c', colors[i]);
        const fac = select<FactionId | 'random'>(
          [{ value: 'random', label: '隨機陣營' }, ...FACTION_IDS.map((f) => ({ value: f, label: FACTIONS[f].name }))],
          a.faction,
          (v) => {
            a.faction = v;
            paintAis();
            save();
          },
        );
        const dif = select<Difficulty>(
          (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => ({ value: d, label: DIFF_ZH[d] })),
          a.difficulty,
          (v) => {
            a.difficulty = v;
            save();
          },
        );
        const team = select<string>(
          [
            { value: '1', label: '同盟' },
            { value: '2', label: '隊伍 2' },
            { value: '3', label: '隊伍 3' },
            { value: '4', label: '隊伍 4' },
          ],
          String(a.team),
          (v) => {
            a.team = Number(v);
            validate();
            save();
          },
        );
        fac.title = `電腦 ${i + 1} 陣營`;
        dif.title = '難度';
        team.title = '隊伍(你在隊伍 1)';
        const x = button('cf-icon-btn cf-ai-x', glyph('close', 13), () => {
          click();
          lobby.ais.splice(i, 1);
          paintAis();
          save();
        });
        x.title = '移除';
        x.disabled = lobby.ais.length <= 1;
        r.append(dot, fac, dif, team, x);
        aiBox.append(r);
      });
      if (lobby.ais.length < maxAis()) {
        aiBox.append(
          button('cf-btn cf-add', `${glyph('plus', 13)}<span>新增電腦對手</span>`, () => {
            click();
            const used = new Set(lobby.ais.map((a) => a.team));
            const team = [2, 3, 4].find((t) => !used.has(t)) ?? 2;
            lobby.ais.push({ faction: 'random', difficulty: 'normal', team });
            paintAis();
            save();
          }),
        );
      }
      validate();
    }

    function validate(): void {
      const hasEnemy = lobby.ais.some((a) => a.team !== 1);
      const ok = hasEnemy && !!map && map.starts.length >= lobby.ais.length + 1;
      startBtn.disabled = !ok;
      note.textContent = !map ? '地圖生成失敗' : !hasEnemy ? '至少需要一名敵對的對手' : !ok ? '此地圖的起始點不足' : '';
    }

    function paintAll(): void {
      paintMaps();
      paintStart();
      paintYou();
      paintAis();
      paintPreview();
    }

    function launch(): void {
      let fresh: GameMap;
      try {
        fresh = info.generate(seed);
      } catch {
        return;
      }
      const rng = makeRng((seed ^ 0x5bd1e995) | 0);
      const free = fresh.starts.map((_, i) => i);
      const take = (want: number): number => {
        const at = want >= 0 && free.includes(want) ? free.indexOf(want) : rng.int(0, free.length - 1);
        return free.splice(at, 1)[0];
      };
      const colors = aiColors();
      const players: PlayerSetup[] = [
        { name: '指揮官', faction: lobby.faction, color: lobby.color, team: 1, controller: 'human', difficulty: 'normal', startIndex: take(lobby.start) },
      ];
      lobby.ais.forEach((a, i) => {
        const faction = a.faction === 'random' ? rng.pick(FACTION_IDS) : a.faction;
        players.push({ name: `電腦 ${i + 1}`, faction, color: colors[i], team: a.team, controller: 'ai', difficulty: a.difficulty, startIndex: take(-1) });
      });
      const setup: GameSetup = {
        map: fresh,
        seed,
        players,
        startingCredits: lobby.credits,
        options: { fog: lobby.fog, shortGame: lobby.shortGame, superweapons: lobby.superweapons },
      };
      save();
      seed = randomSeed();
      api.hide();
      deps.start(setup);
    }

    regenerate();
    mount('lobby', s, () => ro?.disconnect());
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintPreview()) : null;
    ro?.observe(prevBox);
    paintAll();
  }

  // ───────────────────────── result ─────────────────────────
  function showResultScreen(world: World, viewer: number): void {
    const me = world.players[viewer];
    const win = !!me && world.winnerTeam !== null && world.winnerTeam === me.team;
    const draw = world.winnerTeam === null;
    setAccent(me?.color ?? MENU_ACCENT);
    const s = el('div', 'cf-screen cf-result ' + (win ? 'is-win' : 'is-loss'));
    const banner = el('div', 'cf-result-banner');
    banner.append(
      el('h1', '', draw ? '戰鬥結束' : win ? '勝利' : '戰敗'),
      el('small', '', draw ? 'Battle ended' : win ? 'Victory' : 'Defeat'),
      el('p', 'cf-dim', `${world.map.name} · 作戰時間 ${fmtTime(world.tick / TICK_RATE)}`),
    );
    const card = el('div', 'cf-glass cf-result-card');
    const table = el('table', 'cf-table');
    const head = el('tr');
    for (const hLabel of ['指揮官', '結果', '生產單位', '損失單位', '建造建築', '損失建築', '擊殺', '採集', '支出']) head.append(el('th', '', hLabel));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const p of world.players) {
      const tr = el('tr', p.id === viewer ? 'is-me' : '');
      const name = el('td');
      const nm = el('div', 'cf-table-name');
      const chip = el('i');
      chip.style.setProperty('--c', p.color);
      nm.append(chip, el('span', '', p.name), el('small', '', `${FACTIONS[p.faction]?.name ?? p.faction} · 隊伍 ${p.team}`));
      name.append(nm);
      const res = el('td');
      const won = world.winnerTeam !== null && p.team === world.winnerTeam;
      res.append(el('span', 'cf-tag ' + (won ? 'is-win' : 'is-loss'), won ? '勝' : p.defeated || world.winnerTeam !== null ? '敗' : '—'));
      const st = p.stats;
      tr.append(
        name,
        res,
        el('td', '', fmtNum(st.unitsBuilt)),
        el('td', '', fmtNum(st.unitsLost)),
        el('td', '', fmtNum(st.buildingsBuilt)),
        el('td', '', fmtNum(st.buildingsLost)),
        el('td', '', fmtNum(st.kills)),
        el('td', '', fmtNum(st.oreHarvested)),
        el('td', '', fmtNum(st.creditsSpent)),
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    card.append(table);
    const actions = el('div', 'cf-page-foot');
    actions.append(
      button('cf-btn', '再戰一場', () => {
        click();
        showLobby();
      }),
      button('cf-btn is-primary', '返回主選單', () => {
        click();
        showTitle();
        try {
          audio.setMusic('menu');
        } catch {
          /* ignore */
        }
      }),
    );
    s.append(banner, card, actions);
    mount('result', s);
    try {
      audio.setMusic(draw ? 'menu' : win ? 'victory' : 'defeat');
    } catch {
      /* ignore */
    }
  }

  // ───────────────────────── shell ─────────────────────────
  let visible = false;
  function onKey(e: KeyboardEvent): void {
    if (!visible || e.code !== 'Escape') return;
    if (screen === 'lobby' || screen === 'howto' || screen === 'settings') {
      e.preventDefault();
      click();
      showTitle();
    }
  }
  window.addEventListener('keydown', onKey);
  // Mac app Help menu → controls reference (only when the menu is what the player is looking at).
  function onHelp(e: Event): void {
    if (!visible || screen === 'result') return;
    e.preventDefault();
    showHowTo();
  }
  window.addEventListener('cinder:help', onHelp);

  function reveal(): void {
    if (!visible) {
      visible = true;
      root.style.display = '';
      bg.start();
    }
  }

  const api: MenuUi = {
    show() {
      reveal();
      showTitle();
      if (unlocked) {
        try {
          audio.setMusic('menu');
        } catch {
          /* ignore */
        }
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      root.style.display = 'none';
      bg.stop();
      cleanup?.();
      cleanup = null;
      stage.replaceChildren();
    },
    showResult(world, viewer) {
      reveal();
      showResultScreen(world, viewer);
    },
    destroy() {
      api.hide();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cinder:help', onHelp);
      root.remove();
    },
  };
  return api;
};
