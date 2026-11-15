// dev/net.html — open in two tabs (loopback transport over BroadcastChannel): host in one, join from
// the other, ready, start; both tabs then run the real sim headlessly and show tick / hash / status.
// Driven by setInterval (not rAF) so a background tab keeps stepping (throttled to ~1 Hz, it catches up).
import type { AiController, NetMatch, NetState } from '../core/api';
import { TICK_MS } from '../core/constants';
import type { World } from '../core/types';
import { createAi } from '../ai';
import { MAPS } from '../maps';
import { sim } from '../sim';
import { botCommands } from '../sim/testbot';
import { createNet } from './index';
import { PLANS } from './testkit';
import { FACTION_IDS, PALETTE } from './wire';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const net = createNet({ maps: MAPS, buildId: 'dev-net' });
const nameIn = $<HTMLInputElement>('name');
nameIn.value = `玩家${Math.floor(Math.random() * 900 + 100)}`;
$('transport').textContent = `傳輸:${net.transport}`;

let match: NetMatch | null = null;
let world: World | null = null;
let ais: AiController[] = [];
let frozen = false;
let acc = 0;
let last = performance.now();
const hashes: { tick: number; h: number }[] = [];
const logLines: string[] = [];

function log(line: string): void {
  logLines.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (logLines.length > 200) logLines.shift();
  const el = $('log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

net.on((e) => {
  if (e.type === 'chat') log(`💬 ${e.from}: ${e.text}`);
  else if (e.type === 'notice') log(`ℹ️ ${e.text}`);
  else if (e.type === 'error') log(`⚠️ ${e.text}`);
  else if (e.type === 'matchStart') {
    match = e.match;
    world = sim.createWorld(e.match.setup);
    ais = [];
    hashes.length = 0;
    frozen = false;
    acc = 0;
    last = performance.now();
    if (e.match.isHost) {
      e.match.setup.players.forEach((p, id) => {
        if (p.controller === 'ai') ais.push(createAi(id, p.difficulty, (e.match.setup.seed + id * 7919) | 0, sim));
      });
    }
    log(`▶ 對戰開始:${e.match.setup.map.name},我是玩家 ${e.match.localPlayer}${e.match.isHost ? '(房主)' : ''}`);
  }
});

// ───────────── lockstep driver (what main.ts will do, minus rendering) ─────────────

function stepOnce(m: NetMatch, w: World): boolean {
  const cmds = m.takeTurn(w.tick);
  if (!cmds) return false;
  if (m.isHost) {
    for (const ai of ais) {
      if (w.players[ai.player].defeated) continue;
      for (const c of ai.think(w)) m.send(c);
    }
  }
  const me = w.players[m.localPlayer];
  if ($<HTMLInputElement>('bot').checked && !me.defeated) for (const c of botCommands(w, m.localPlayer, PLANS[me.faction])) m.send(c);
  sim.step(w, cmds);
  m.afterStep(w.tick, () => {
    const h = sim.hashWorld(w);
    hashes.push({ tick: w.tick, h });
    if (hashes.length > 6) hashes.shift();
    return h;
  });
  return true;
}

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(2000, now - last);
  last = now;
  const m = match;
  const w = world;
  if (!m || !w || frozen || net.getState().phase !== 'match') {
    acc = 0;
    return;
  }
  acc += dt;
  for (let n = 0; n < 60; n++) {
    const behind = m.ready(w.tick) > 2;
    if (acc < TICK_MS && !behind) break;
    if (!stepOnce(m, w)) {
      acc = Math.min(acc, TICK_MS);
      break;
    }
    acc = Math.max(0, acc - TICK_MS);
  }
}, 20);

// ───────────── UI ─────────────

$('host').onclick = () => net.host(nameIn.value, $<HTMLInputElement>('room').value);
$('browse').onclick = () => net.browse();
$('leave').onclick = () => {
  net.leave();
  match = null;
  world = null;
};
$<HTMLInputElement>('chat').onkeydown = (ev) => {
  if (ev.key !== 'Enter') return;
  const el = ev.target as HTMLInputElement;
  net.chat(el.value);
  el.value = '';
};

function renderLeft(s: NetState): void {
  const left = $('left');
  if (s.phase === 'idle' || s.phase === 'browsing') {
    $('leftTitle').textContent = '房間列表';
    left.innerHTML = s.rooms.length
      ? `<table><tr><th>房間</th><th>房主</th><th>地圖</th><th>人數</th><th></th></tr>${s.rooms
          .map(
            (r) =>
              `<tr><td>${esc(r.name)}</td><td>${esc(r.hostName)}</td><td>${esc(r.mapName)}</td><td>${r.players}/${r.maxPlayers}</td><td>${
                !r.compatible ? '版本不同' : r.inMatch ? '對戰中' : `<button data-join="${esc(r.id)}">加入</button>`
              }</td></tr>`,
          )
          .join('')}</table>`
      : `<pre>${s.phase === 'browsing' ? '搜尋中…' : '按「瀏覽房間」或「建立房間」。'}</pre>`;
    left.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => (b.onclick = () => net.join(b.dataset.join!, nameIn.value)));
    return;
  }
  if (s.phase === 'connecting') {
    $('leftTitle').textContent = '連線中';
    left.innerHTML = '<pre>連線中…</pre>';
    return;
  }
  const r = s.room;
  if (!r) return;
  $('leftTitle').textContent = `房間:${r.name}${r.isHost ? '(你是房主)' : ''}`;
  const lobby = s.phase === 'lobby';
  const mapSel = `<select id="mapSel" ${r.isHost && lobby ? '' : 'disabled'}>${MAPS.map((m) => `<option value="${m.id}" ${m.id === r.mapId ? 'selected' : ''}>${esc(m.name)} (${m.maxPlayers})</option>`).join('')}</select>`;
  const rows = r.slots
    .map((sl, i) => {
      const hostCtl =
        r.isHost && lobby && !(sl.kind === 'human' && sl.isHost)
          ? ` <button data-slot="${i}" data-kind="open">開放</button><button data-slot="${i}" data-kind="closed">關閉</button><button data-slot="${i}" data-kind="ai">電腦</button>`
          : '';
      if (sl.kind === 'open' || sl.kind === 'closed') return `<tr><td>${i + 1}</td><td colspan="5">${sl.kind === 'open' ? '(空位)' : '(關閉)'}</td><td>${hostCtl}</td></tr>`;
      const who = sl.kind === 'ai' ? `電腦・${sl.difficulty}` : `${esc(sl.name)}${sl.isHost ? ' ★' : ''}${sl.isLocal ? '(你)' : ''}`;
      const mine = sl.kind === 'human' && sl.isLocal && lobby;
      const faction = mine
        ? `<select data-me="faction">${['random', ...FACTION_IDS].map((f) => `<option ${f === sl.faction ? 'selected' : ''}>${f}</option>`).join('')}</select>`
        : sl.faction;
      const color = mine
        ? `<select data-me="color">${PALETTE.map((c) => `<option value="${c}" ${c === sl.color ? 'selected' : ''} style="color:${c}">${c}</option>`).join('')}</select>`
        : sl.color;
      const team = mine ? `<select data-me="team">${[1, 2, 3, 4, 5, 6, 7, 8].map((t) => `<option ${t === sl.team ? 'selected' : ''}>${t}</option>`).join('')}</select>` : String(sl.team);
      const ready = sl.kind === 'human' ? (mine && !sl.isHost ? `<label><input type="checkbox" data-me="ready" ${sl.ready ? 'checked' : ''}/>準備</label>` : sl.ready ? '✔' : '…') : '';
      const ping = sl.kind === 'human' && !sl.isHost ? `${sl.pingMs} ms` : '';
      return `<tr><td>${i + 1}</td><td><span class="sw" style="background:${sl.color}"></span>${who}</td><td>${faction}</td><td>${color}</td><td>隊 ${team}</td><td>${ready} ${ping}</td><td>${hostCtl}</td></tr>`;
    })
    .join('');
  left.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">地圖 ${mapSel}<span>種子 ${r.seed}</span><span>資金 ${r.startingCredits}</span>${
    r.isHost && lobby ? `<button id="start" ${r.canStart ? '' : 'disabled'}>開始對戰</button>` : ''
  }</div><table><tr><th>#</th><th>玩家</th><th>陣營</th><th>顏色</th><th>隊伍</th><th>狀態</th><th></th></tr>${rows}</table>`;
  const ms = left.querySelector<HTMLSelectElement>('#mapSel');
  if (ms) ms.onchange = () => net.setRoom({ mapId: ms.value });
  const st = left.querySelector<HTMLButtonElement>('#start');
  if (st) st.onclick = () => net.startMatch();
  left.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.slot);
      const k = b.dataset.kind;
      if (k === 'ai') net.setSlot(i, { kind: 'ai', faction: 'random', color: PALETTE[7], team: 8, difficulty: 'normal' });
      else net.setSlot(i, { kind: k === 'closed' ? 'closed' : 'open' });
    };
  });
  left.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-me]').forEach((el) => {
    el.onchange = () => {
      const k = el.dataset.me;
      if (k === 'ready') net.setMe({ ready: (el as HTMLInputElement).checked });
      else if (k === 'team') net.setMe({ team: Number(el.value) });
      else if (k === 'color') net.setMe({ color: el.value });
      else if (k === 'faction') net.setMe({ faction: el.value as 'random' });
    };
  });
}

function renderMatch(): void {
  const el = $('match');
  const m = match;
  const w = world;
  const s = net.getState();
  if (!m || !w || s.phase !== 'match') {
    el.innerHTML = '<pre>—</pre>';
    $('matchBtns').style.display = 'none';
    return;
  }
  const st = m.status;
  const players = w.players
    .map((p, i) => {
      const ps = st.players[i];
      const units = [...w.entities.values()].filter((e) => e.owner === i);
      return `<tr><td><span class="sw" style="background:${p.color}"></span>${esc(p.name)}${i === m.localPlayer ? '(你)' : ''}</td><td>${p.faction}</td><td>${p.credits}</td><td>${units.filter((e) => e.kind === 'building').length} / ${units.filter((e) => e.kind === 'unit').length}</td><td>${p.defeated ? '已敗' : ''}</td><td>${ps ? (ps.connected ? '連線' : '離線') + (ps.pingMs ? ` ${ps.pingMs}ms` : '') : ''}</td></tr>`;
    })
    .join('');
  el.innerHTML = `<div class="big">tick ${w.tick}  <span class="state-${st.state}">${st.state}</span>${st.waitingFor.length ? ` 等待:${esc(st.waitingFor.join('、'))}` : ''}</div>
<pre>hash  ${hashes.map((h) => `${h.tick}:${(h.h >>> 0).toString(16).padStart(8, '0')}`).join('  ')}
ready ${m.ready(w.tick)}   ${m.isHost ? '房主' : '客端'}   ${frozen ? '⏸ 已凍結' : ''}${w.winnerTeam !== null ? `   勝利隊伍 ${w.winnerTeam}` : ''}</pre>
<table><tr><th>玩家</th><th>陣營</th><th>資金</th><th>建築/單位</th><th></th><th>網路</th></tr>${players}</table>`;
  $('matchBtns').style.display = 'flex';
  $('freeze').textContent = frozen ? '恢復' : '凍結(模擬卡住)';
}

$('freeze').onclick = () => {
  frozen = !frozen;
  renderMatch();
};
$('diverge').onclick = () => {
  if (world && match) world.players[match.localPlayer].credits += 1;
};
$('surrender').onclick = () => match?.send({ type: 'surrender', player: match.localPlayer });

function render(s: NetState): void {
  $('phase').textContent = `階段:${s.phase}`;
  renderLeft(s);
}

net.subscribe(render);
render(net.getState());
setInterval(renderMatch, 250);
if (new URLSearchParams(location.search).get('browse') === '1') net.browse();

// Console / automation handle.
(window as unknown as Record<string, unknown>).__net = {
  net,
  get match() {
    return match;
  },
  get world() {
    return world;
  },
  get hashes() {
    return hashes.slice();
  },
  setFrozen(v: boolean) {
    frozen = v;
  },
  hashNow: () => (world ? sim.hashWorld(world) : null),
};
