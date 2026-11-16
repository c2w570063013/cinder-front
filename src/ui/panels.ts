// Settings form and the how-to-play reference — used by both the main menu and the in-game pause menu.
import type { AudioApi } from '../core/api';
import { el, isMac } from './dom';
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
      'Ctrl+點擊當作右鍵',
      '單鍵滑鼠 · Ctrl-click = right click',
      toggle(settings.ctrlClickRight, (v) => updateSettings({ ctrlClickRight: v }), click),
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
  // platform modifier glyphs
  const CMD = isMac ? '⌘' : 'Ctrl';
  const CTRL = isMac ? '⌃' : 'Ctrl';
  const ALT = isMac ? '⌥' : 'Alt';
  const SHIFT = isMac ? '⇧' : 'Shift';
  const FORCE = isMac ? '⌃ / ⌘' : 'Ctrl';
  const root = el('div', 'cf-howto');

  const intro = el('div', 'cf-howto-intro');
  intro.append(
    el('p', '', '部署基地車建立指揮核心,興建電站與精煉設施採集晶礦,擴張科技並訓練部隊,摧毀所有敵對勢力。'),
    el('p', 'cf-dim', '預設為「經典」操作:左鍵點擊即可選取與下令,右鍵取消選取,單鍵觸控板也能完整遊玩。可在設定中改為「現代」操作(左鍵選取、右鍵下令);下列的組合鍵指令在兩種方式下都作用於下令的那個按鍵。'),
  );
  if (isMac) intro.append(el('p', 'cf-dim', 'Mac 鍵盤的 F1–F4 預設為亮度等功能鍵,需同時按住 fn(或在「系統設定 › 鍵盤」中將 F 鍵設為標準功能鍵)。⌃F1–F4 可能被 macOS 佔用,儲存鏡頭位置時可改用 ⇧F1–F4。'));
  root.append(intro);

  const grid = el('div', 'cf-howto-grid');
  grid.append(
    table('滑鼠', 'Mouse', [
      { keys: ['左鍵點擊'], what: '選取;已選取部隊時:移動、攻擊、採礦、進入、佔領' },
      { keys: ['左鍵拖曳'], what: '框選部隊(優先選取單位)' },
      { keys: ['連按兩下'], what: '選取畫面中所有同類單位' },
      { keys: [SHIFT, '~點擊'], what: '加入/移出選取;下令時排入佇列' },
      { keys: [FORCE, '~點擊'], what: '強制攻擊指定的敵方目標' },
      { keys: [ALT, '~點擊'], what: '強制移動(途中不攻擊)' },
      { keys: [`${CTRL}${SHIFT}`, '~點擊'], what: '攻擊移動' },
      { keys: ['Z 按住', '~點擊'], what: '設定路徑點,放開 Z 結束' },
      { keys: ['右鍵點擊'], what: '取消選取或取消目前模式' },
      { keys: ['右鍵拖曳', '中鍵拖曳'], what: '拖動畫面' },
      { keys: ['滾輪'], what: '縮放(以游標為中心)' },
      { keys: ['畫面邊緣'], what: '捲動畫面' },
    ]),
    table('觸控板・Magic Mouse', 'Trackpad', [
      { keys: ['單指點按'], what: '左鍵:選取與下令' },
      { keys: ['兩指點按'], what: '右鍵:取消選取/取消模式' },
      { keys: ['兩指滑動'], what: '平移畫面' },
      { keys: ['兩指開合'], what: '縮放(以游標為中心)' },
      { keys: ['空白鍵', '~拖曳'], what: '抓取並拖動畫面' },
      { keys: [`${ALT} 按住`], what: '暫時顯示所有血條' },
      { keys: ['設定'], what: '單鍵滑鼠可開啟「Ctrl+點擊當作右鍵」(此時以 ⌘ 點擊強制攻擊)' },
    ]),
    table('部隊指令', 'Orders', [
      { keys: ['S'], what: '停止' },
      { keys: ['G'], what: '原地警戒' },
      { keys: ['D'], what: '部署基地車' },
      { keys: ['X'], what: '散開' },
      { keys: ['A'], what: '攻擊移動(再點擊目的地)' },
    ]),
    table('選取與編隊', 'Selection & groups', [
      { keys: ['P'], what: `選取所有戰鬥單位(也可用 ${CMD}A)` },
      { keys: ['T'], what: '選取畫面中與目前選取同類的單位;連按兩下:全地圖' },
      { keys: ['N', 'M'], what: '下一個/上一個單位,鏡頭跟著移動' },
      { keys: ['Y'], what: '輪流選取老兵與菁英單位' },
      { keys: [`${CMD}`, '~1–0'], what: '編成控制編隊(未選取任何單位時清除該編隊)' },
      { keys: ['1–0'], what: '選取編隊;連按兩下鏡頭置中' },
      { keys: [SHIFT, '~1–0'], what: '將編隊加入目前選取' },
    ]),
    table('畫面', 'Camera', [
      { keys: ['空白鍵'], what: '跳到最近的警報位置(連按切換較早的警報)' },
      { keys: ['H'], what: '回到基地' },
      { keys: ['F'], what: '鏡頭跟隨選取的單位,移動鏡頭即取消' },
      { keys: ['數字鍵盤 5'], what: '鏡頭置中於選取的單位' },
      { keys: ['F1–F4'], what: '跳到儲存的鏡頭位置' },
      { keys: [`${CTRL}F1–F4`, `${SHIFT}F1–F4`], what: '儲存目前鏡頭位置' },
      { keys: ['↑', '↓', '←', '→'], what: '捲動畫面' },
      { keys: ['=', '−'], what: '放大/縮小' },
    ]),
    table('建造面板', 'Sidebar', [
      { keys: ['Q'], what: '建築分頁' },
      { keys: ['W'], what: '防禦分頁' },
      { keys: ['E'], what: '步兵分頁' },
      { keys: ['R'], what: '載具分頁(再按一次切換航空)' },
      { keys: ['Tab'], what: `依序切換分頁(${SHIFT} 反向)` },
      { keys: ['數字鍵盤 8', '數字鍵盤 2'], what: '建造清單向上/向下捲動' },
      { keys: ['K'], what: '修理模式:點擊受損建築' },
      { keys: ['L'], what: '變賣模式:點擊己方建築' },
      { keys: ['左鍵點圖示'], what: '加入生產;完成的建築:進入放置模式' },
      { keys: [SHIFT, '~點圖示'], what: '一次加入五個單位' },
      { keys: ['右鍵點圖示'], what: '暫停 → 再按取消並退款' },
      { keys: ['選取工廠後點地面'], what: '設定集結點' },
      { keys: ['支援能力'], what: '充能完成後點按鈕,再點擊地圖指定目標' },
    ]),
    table('其他', 'Other', [
      { keys: ['U'], what: '切換常駐顯示所有血條' },
      { keys: ['Esc'], what: '取消目前模式;否則開啟選單(遭遇戰中會暫停)' },
      { keys: ['Pause'], what: '暫停/繼續(遭遇戰;區網對戰無法暫停)' },
      { keys: ['Enter'], what: '區網對戰:開啟聊天' },
      { keys: ['⌃C'], what: isMac ? '截圖(存到「圖片/燼原戰線」)' : '截圖(下載 PNG)' },
      { keys: isMac ? ['⌃⌘F'] : ['F11'], what: '切換全螢幕' },
    ]),
  );
  root.append(grid);
  return root;
}
