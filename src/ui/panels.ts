// Settings form and the how-to-play reference — used by both the main menu and the in-game pause menu.
import type { AudioApi } from '../core/api';
import { el, MOD_LABEL } from './dom';
import { settings, updateSettings, type UiSettings } from './settings';
import { row, section, segmented, slider, toggle } from './widgets';

/** The audio module owns (and persists) the volumes; fall back to our stored copy if it cannot report them. */
function currentVolume(audio: AudioApi): UiSettings['volume'] {
  try {
    const v = audio.getVolume();
    if (v && typeof v.master === 'number') return { master: v.master, sfx: v.sfx, music: v.music, voice: v.voice };
  } catch {
    /* audio not ready */
  }
  return { ...settings.volume };
}

export function buildSettingsPanel(audio: AudioApi, game?: { setSpeed(multiplier: number): void }): HTMLElement {
  const root = el('div', 'cf-form');
  const click = () => audio.playUi('click');

  root.append(section('操作', 'Controls'));
  root.append(
    row(
      '操作方式',
      'Control scheme',
      segmented(
        [
          { value: 'classic' as const, label: '經典', sub: '主鍵選取並下令', title: '主鍵點擊同時負責選取與下令,次鍵取消選取。單鍵觸控板也能完整操作。' },
          { value: 'modern' as const, label: '現代', sub: '主鍵選取・次鍵下令', title: '主鍵只負責選取,次鍵(兩指點按 / 右鍵)下達指令。' },
        ],
        settings.scheme,
        (v) => updateSettings({ scheme: v }),
        click,
      ).el,
    ),
  );
  root.append(
    row(
      '滾動手勢',
      'Scroll gesture',
      segmented(
        [
          { value: 'auto' as const, label: '自動', title: '觸控板與 Magic Mouse 滑動=平移,傳統滾輪=縮放。' },
          { value: 'pan' as const, label: '一律平移' },
          { value: 'zoom' as const, label: '一律縮放' },
        ],
        settings.wheelMode,
        (v) => updateSettings({ wheelMode: v }),
        click,
      ).el,
    ),
  );
  root.append(
    row(
      '邊緣捲動速度',
      'Edge scroll',
      slider(settings.edgeScroll, 0, 2, 0.1, (v) => (v <= 0.001 ? '關閉' : `${Math.round(v * 100)}%`), (v) => updateSettings({ edgeScroll: v })),
    ),
  );
  root.append(
    row(
      '指揮面板位置',
      'Panel side',
      segmented(
        [
          { value: 'left' as const, label: '左側' },
          { value: 'right' as const, label: '右側' },
        ],
        settings.panelSide,
        (v) => updateSettings({ panelSide: v }),
        click,
      ).el,
    ),
  );

  if (game) {
    root.append(section('對戰', 'Match'));
    root.append(
      row(
        '遊戲速度',
        'Game speed',
        segmented(
          [
            { value: 0.5, label: '0.5×' },
            { value: 1, label: '1×' },
            { value: 1.5, label: '1.5×' },
            { value: 2, label: '2×' },
          ],
          settings.gameSpeed,
          (v) => {
            updateSettings({ gameSpeed: v });
            game.setSpeed(v);
          },
          click,
        ).el,
      ),
    );
  }

  root.append(section('音量', 'Audio'));
  const pct = (v: number) => `${Math.round(v * 100)}`;
  const volNow = currentVolume(audio);
  const vol = (key: 'master' | 'sfx' | 'music' | 'voice', label: string, sub: string) =>
    row(
      label,
      sub,
      slider(volNow[key], 0, 1, 0.05, pct, (v) => {
        volNow[key] = v;
        const volume = { ...volNow };
        updateSettings({ volume });
        try {
          audio.setVolume({ [key]: v });
        } catch {
          /* ignore */
        }
      }),
    );
  root.append(vol('master', '主音量', 'Master'), vol('sfx', '音效', 'Effects'), vol('music', '音樂', 'Music'), vol('voice', '語音', 'Announcer'));

  root.append(section('顯示', 'Display'));
  root.append(row('顯示影格率', 'FPS readout', toggle(settings.showFps, (v) => updateSettings({ showFps: v }), click)));
  return root;
}

interface Binding {
  keys: string[];
  what: string;
}

function table(title: string, sub: string, rows: Binding[]): HTMLElement {
  const box = el('div', 'cf-keys');
  const head = el('div', 'cf-keys-head');
  head.append(el('span', '', title), el('small', '', sub));
  box.append(head);
  for (const r of rows) {
    const line = el('div', 'cf-keys-row');
    const k = el('div', 'cf-keys-k');
    r.keys.forEach((key, i) => {
      if (i > 0) k.append(el('i', '', key.startsWith('~') ? '' : '/'));
      k.append(el('kbd', '', key.replace(/^~/, '')));
    });
    line.append(k, el('div', 'cf-keys-w', r.what));
    box.append(line);
  }
  return box;
}

export function buildHowTo(): HTMLElement {
  const M = MOD_LABEL;
  const root = el('div', 'cf-howto');

  const intro = el('div', 'cf-howto-intro');
  intro.append(
    el('p', '', '部署基地車建立指揮核心,興建電站與精煉設施採集晶礦,擴張科技並訓練部隊,摧毀所有敵對勢力。'),
    el('p', 'cf-dim', '預設為「經典」操作:主鍵點擊即可選取與下令,單鍵觸控板也能完整遊玩。可在設定中改為「現代」操作(主鍵選取、次鍵下令)。'),
  );
  root.append(intro);

  const grid = el('div', 'cf-howto-grid');
  grid.append(
    table('滑鼠', 'Mouse', [
      { keys: ['主鍵點擊'], what: '選取單位/建築;已選取部隊時:移動、攻擊、採礦、進入(經典)' },
      { keys: ['主鍵拖曳'], what: '框選部隊(優先選取單位)' },
      { keys: ['連按兩下'], what: '選取畫面中所有同類單位' },
      { keys: ['Shift', '~點擊'], what: '加入/移出選取;下令時為排入佇列' },
      { keys: ['次鍵點擊'], what: '取消選取或取消目前模式(經典)/下達指令(現代)' },
      { keys: ['次鍵拖曳', '中鍵拖曳'], what: '拖動畫面' },
      { keys: ['滾輪'], what: '縮放(以游標為中心)' },
      { keys: ['畫面邊緣'], what: '捲動畫面' },
    ]),
    table('觸控板・Magic Mouse', 'Trackpad', [
      { keys: ['單指點按'], what: '主鍵:選取與下令' },
      { keys: ['兩指點按', 'Control', '~點按'], what: '次鍵:取消/下令' },
      { keys: ['兩指滑動'], what: '平移畫面' },
      { keys: ['兩指開合'], what: '縮放(以游標為中心)' },
      { keys: ['空白鍵', '~拖曳'], what: '抓取並拖動畫面' },
      { keys: ['Option 按住'], what: '顯示所有血條' },
    ]),
    table('部隊指令', 'Orders', [
      { keys: ['S'], what: '停止' },
      { keys: ['G'], what: '原地警戒' },
      { keys: ['A'], what: '攻擊移動(再點擊目的地)' },
      { keys: ['D'], what: '部署基地車' },
      { keys: ['X'], what: '散開' },
      { keys: [`${M}`, '~1–9'], what: '編成控制編隊' },
      { keys: ['1–9'], what: '選取編隊;連按兩次置中' },
      { keys: [`${M}`, '~A'], what: '選取畫面中所有戰鬥單位' },
    ]),
    table('建造與生產', 'Production', [
      { keys: ['Tab'], what: '切換建造分頁(Shift 反向)' },
      { keys: ['Q', 'W', 'E', 'R', 'T', 'Y'], what: '目前分頁第 1–6 個項目(更多:U I O)' },
      { keys: ['主鍵點圖示'], what: '加入生產;完成的建築:進入放置模式' },
      { keys: ['Shift', '~點圖示'], what: '一次加入五個單位' },
      { keys: ['次鍵點圖示'], what: '暫停 → 再按取消並退款' },
      { keys: ['選取工廠後點地面'], what: '設定集結點' },
    ]),
    table('畫面與系統', 'View & system', [
      { keys: ['↑', '↓', '←', '→'], what: '捲動畫面' },
      { keys: ['=', '−'], what: '放大/縮小' },
      { keys: ['H'], what: '回到基地' },
      { keys: ['空白鍵'], what: '跳到最近的警報位置' },
      { keys: ['F'], what: '切換全螢幕' },
      { keys: ['P'], what: '暫停' },
      { keys: ['Esc'], what: '取消目前模式;否則開啟選單' },
    ]),
    table('特殊模式', 'Modes', [
      { keys: ['變賣'], what: '點擊己方建築變賣換回部分資金' },
      { keys: ['修理'], what: '點擊受損建築開始/停止修理' },
      { keys: ['支援能力'], what: '充能完成後點按鈕,再點擊地圖指定目標' },
      { keys: ['Esc', '次鍵'], what: '離開任何模式' },
    ]),
  );
  root.append(grid);
  return root;
}
