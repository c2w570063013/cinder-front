// Status announcer: short Traditional Chinese lines through the system speech synthesiser.
// All phrasing is our own. If no zh-TW voice is installed the announcer simply stays silent.
import type { SupportPowerId } from '../core/types';
import { SUPPORT_POWERS } from '../data';
import { type AnnouncerLine, AnnouncerQueue, pickVoice } from './logic';

type LineDef = Omit<AnnouncerLine, 'key'>;

/** id → line. Priority 5 = match result, 4 = urgent warnings (may interrupt), 1 = routine. */
export const LINES = {
  victory: { text: '任務達成，我方獲勝。', priority: 5, ttl: 12, cooldown: 30 },
  defeat: { text: '防線失守，我方戰敗。', priority: 5, ttl: 12, cooldown: 30 },
  enemyPower: { text: '警告，偵測到敵方戰略武器啟動。', priority: 4, ttl: 4, cooldown: 5 },
  baseUnderAttack: { text: '基地遭受攻擊。', priority: 4, ttl: 4, cooldown: 12 },
  unitsUnderAttack: { text: '我方部隊遭受攻擊。', priority: 3, ttl: 3, cooldown: 12 },
  lowPower: { text: '電力不足。', priority: 3, ttl: 5, cooldown: 8 },
  powerRestored: { text: '電力已恢復。', priority: 1, ttl: 3, cooldown: 8 },
  powerReady: { text: '戰略支援已就緒。', priority: 3, ttl: 8, cooldown: 2 },
  powerLaunched: { text: '戰略支援啟動。', priority: 2, ttl: 3, cooldown: 2 },
  buildingLost: { text: '失去建築。', priority: 3, ttl: 3, cooldown: 6 },
  unitLost: { text: '失去單位。', priority: 2, ttl: 2.5, cooldown: 8 },
  buildingCaptured: { text: '已佔領敵方建築。', priority: 3, ttl: 4, cooldown: 2 },
  buildingTaken: { text: '我方建築遭到佔領。', priority: 4, ttl: 4, cooldown: 2 },
  insufficientFunds: { text: '資金不足。', priority: 2, ttl: 2, cooldown: 6 },
  cannotPlace: { text: '無法在此建造。', priority: 1, ttl: 1.5, cooldown: 5 },
  constructionReady: { text: '建築已備妥，請選擇位置。', priority: 2, ttl: 6, cooldown: 1.5 },
  buildingComplete: { text: '建築啟用。', priority: 1, ttl: 3, cooldown: 4 },
  unitReady: { text: '單位已就緒。', priority: 1, ttl: 3, cooldown: 4 },
  promoted: { text: '單位晉升。', priority: 0, ttl: 2, cooldown: 20 },
  enemyDefeated: { text: '敵方勢力已被殲滅。', priority: 3, ttl: 6, cooldown: 1 },
  allyDefeated: { text: '友軍已被擊潰。', priority: 3, ttl: 6, cooldown: 1 },
} satisfies Record<string, LineDef>;

export type LineId = keyof typeof LINES;

export function makeLine(id: LineId, power?: SupportPowerId): AnnouncerLine {
  const def: LineDef = LINES[id];
  if (power && SUPPORT_POWERS[power]) {
    const name = SUPPORT_POWERS[power].name;
    if (id === 'powerReady') return { ...def, key: `${id}:${power}`, text: `${name}已就緒。` };
    if (id === 'powerLaunched') return { ...def, key: `${id}:${power}`, text: `${name}，啟動。` };
    if (id === 'enemyPower') return { ...def, key: `${id}:${power}`, text: `警告，偵測到敵方${name}。` };
  }
  return { ...def, key: id };
}

const nowSec = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class Announcer {
  readonly queue = new AnnouncerQueue(4, 0.45);
  private synth: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private token = 0;
  /** For the dev page: the last line handed to the synthesiser. */
  lastSpoken = '';

  constructor(
    private volume: () => number,
    private onSpeaking: (speaking: boolean) => void,
  ) {
    try {
      const s = (globalThis as any).speechSynthesis as SpeechSynthesis | undefined;
      if (s && typeof (globalThis as any).SpeechSynthesisUtterance === 'function') {
        this.synth = s;
        this.loadVoices();
        s.addEventListener?.('voiceschanged', () => this.loadVoices());
      }
    } catch {
      this.synth = null;
    }
  }

  private loadVoices(): void {
    try {
      const voices = this.synth?.getVoices() ?? [];
      const i = pickVoice(voices);
      this.voice = i >= 0 ? voices[i] : null;
    } catch {
      this.voice = null;
    }
  }

  /** 'ready' = a zh-TW voice was found. */
  get status(): 'ready' | 'no-voice' | 'unsupported' {
    if (!this.synth) return 'unsupported';
    if (!this.voice) this.loadVoices();
    return this.voice ? 'ready' : 'no-voice';
  }
  get voiceName(): string {
    return this.voice ? `${this.voice.name} (${this.voice.lang})` : '';
  }

  say(id: LineId, power?: SupportPowerId): void {
    if (!this.synth) return;
    if (this.volume() <= 0.001) return;
    if (this.queue.push(makeLine(id, power), nowSec())) this.tick();
  }

  /** Drive the queue; called on every sim tick and from an internal timer while lines are pending. */
  tick(): void {
    if (!this.synth) return;
    const n = this.queue.next(nowSec());
    if (n) {
      if (n.interrupt) {
        try {
          this.synth.cancel();
        } catch {
          /* ignore */
        }
      }
      this.speak(n.line);
    }
    const busy = this.queue.pending > 0 || this.queue.speaking !== null;
    if (busy && !this.timer) this.timer = setInterval(() => this.tick(), 200);
    else if (!busy && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private speak(line: AnnouncerLine): void {
    const my = ++this.token;
    const finish = () => {
      if (my !== this.token) return;
      this.token++;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.queue.done(nowSec());
      this.onSpeaking(false);
      this.tick();
    };
    if (!this.voice) this.loadVoices();
    if (!this.voice) {
      // no Taiwanese-Mandarin voice installed → skip silently
      this.queue.done(nowSec());
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(line.text);
      u.voice = this.voice;
      u.lang = 'zh-TW';
      u.rate = 1.12;
      u.pitch = 0.95;
      u.volume = Math.max(0, Math.min(1, this.volume()));
      u.onend = finish;
      u.onerror = finish;
      this.lastSpoken = line.text;
      this.onSpeaking(true);
      this.synth!.speak(u);
      // some engines never fire onend — don't let the queue stall
      this.watchdog = setTimeout(finish, 1500 + line.text.length * 320);
    } catch {
      finish();
    }
  }

  stop(): void {
    this.queue.clear();
    this.token++;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    this.onSpeaking(false);
  }
}
