import { describe, expect, it } from 'vitest';
import { VirtualClock } from './clock';
import { MemoryNetwork } from './memory';
import { AD_MAX_BYTES, decodeAd, encodeAd, parseClientMsg, parseHostMsg, parseNativeEvent, sanitizeCommand, utf8Length } from './wire';

describe('command sanitising', () => {
  it('keeps only known fields and fresh arrays', () => {
    const ids = [3, 4];
    const c = sanitizeCommand({ type: 'move', player: 1, ids, x: 1.5, y: 2, queue: true, evil: () => 0, __proto__: { x: 1 } });
    expect(c).toEqual({ type: 'move', player: 1, ids: [3, 4], x: 1.5, y: 2, queue: true });
    expect((c as { ids: number[] }).ids).not.toBe(ids);
    expect(sanitizeCommand({ type: 'move', player: 1, ids, x: 1, y: 2, queue: 'yes' })).toEqual({ type: 'move', player: 1, ids: [3, 4], x: 1, y: 2 });
    expect(sanitizeCommand({ type: 'surrender', player: 2 })).toEqual({ type: 'surrender', player: 2 });
    expect(sanitizeCommand({ type: 'usePower', player: 0, power: 'orbital_lance', x: 3, y: 4 })).toEqual({ type: 'usePower', player: 0, power: 'orbital_lance', x: 3, y: 4 });
  });

  it('rejects garbage', () => {
    const bad: unknown[] = [
      null,
      7,
      'move',
      [],
      { type: 'move', player: 1, ids: [1], x: NaN, y: 0 },
      { type: 'move', player: 1, ids: [1], x: 1e9, y: 0 },
      { type: 'move', player: 1.5, ids: [1], x: 0, y: 0 },
      { type: 'move', player: -1, ids: [1], x: 0, y: 0 },
      { type: 'move', player: 99, ids: [1], x: 0, y: 0 },
      { type: 'move', player: 1, ids: [-1], x: 0, y: 0 },
      { type: 'move', player: 1, ids: '1', x: 0, y: 0 },
      { type: 'move', player: 1, ids: new Array(501).fill(1), x: 0, y: 0 },
      { type: 'produce', player: 1, defId: 'x'.repeat(65) },
      { type: 'resumeProduction', player: 1, category: 'navy' },
      { type: 'usePower', player: 1, power: 'meteor', x: 0, y: 0 },
      { type: 'teleport', player: 1 },
    ];
    for (const b of bad) expect(sanitizeCommand(b)).toBeNull();
  });
});

describe('message parsing', () => {
  it('rejects non-json, unknown types, wrong shapes and oversize text', () => {
    for (const t of ['', 'x', '{', '[]', 'null', '{"t":"nope"}', '{"t":"turn","k":-1,"c":[]}', '{"t":"turn","k":1}', '{"t":"room","room":{}}', '{"t":"welcome","pid":0}'])
      expect(parseHostMsg(t)).toBeNull();
    for (const t of ['{"t":"ack"}', '{"t":"ack","k":"1"}', '{"t":"cmd","c":{}}', '{"t":"hello","v":1}', '{"t":"chat","text":"   "}']) expect(parseClientMsg(t)).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'x'.repeat(300_000) }))).toBeNull();
    expect(parseHostMsg(42 as unknown as string)).toBeNull();
  });

  it('drops invalid commands inside a turn but keeps the turn', () => {
    const m = parseHostMsg(JSON.stringify({ t: 'turn', k: 3, c: [{ type: 'stop', player: 0, ids: [] }, { type: 'bad' }, 5] }));
    expect(m).toEqual({ t: 'turn', k: 3, c: [{ type: 'stop', player: 0, ids: [] }] });
  });

  it('cleans names and chat', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: 1, build: 'b', name: ' 很長很長很長很長很長很長很長很長很長的名字\n ' }))).toEqual({ t: 'hello', v: 1, build: 'b', name: '很長很長很長很長很長很長很長很長' });
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'a\u0000b c' }))).toEqual({ t: 'chat', text: 'a b c' });
  });
});

describe('room advertisement', () => {
  it('fits in 200 UTF-8 bytes even with long Chinese names, and decodes', () => {
    const long = '燼原戰線'.repeat(20);
    const s = encodeAd({ room: long, host: long, map: long, players: 3, max: 4, inMatch: true, build: 'deadbeef' });
    expect(utf8Length(s)).toBeLessThanOrEqual(AD_MAX_BYTES);
    const d = decodeAd(s)!;
    expect(d).toMatchObject({ players: 3, maxPlayers: 4, inMatch: true, build: 'deadbeef', protocol: 1 });
    expect(d.name.length).toBeGreaterThan(3);
    const short = decodeAd(encodeAd({ room: '小房間', host: '阿明', map: '灰燼隘口', players: 1, max: 2, inMatch: false, build: '01234567' }))!;
    expect(short).toMatchObject({ name: '小房間', hostName: '阿明', mapName: '灰燼隘口', inMatch: false });
    expect(decodeAd('{"g":"other"}')).toBeNull();
    expect(decodeAd('garbage')).toBeNull();
  });
});

describe('native events', () => {
  it('validates the bridge event shapes', () => {
    expect(parseNativeEvent({ type: 'open', conn: 3, incoming: true })).toEqual({ type: 'open', conn: 3, incoming: true });
    expect(parseNativeEvent({ type: 'closed', conn: -1, hostId: 'h', reason: 'x' })).toEqual({ type: 'closed', conn: -1, hostId: 'h', reason: 'x' });
    expect(parseNativeEvent({ type: 'closed', conn: 2 })).toEqual({ type: 'closed', conn: 2, reason: '' });
    expect(parseNativeEvent({ type: 'message', conn: 'a', text: 'x' })).toBeNull();
    expect(parseNativeEvent({ type: 'found', id: 'a', name: 'n' })).toBeNull();
    expect(parseNativeEvent(null)).toBeNull();
    expect(parseNativeEvent({ type: 'what' })).toBeNull();
  });
});

describe('memory transport', () => {
  it('delivers in order per connection despite jitter, and reports closes', () => {
    const clock = new VirtualClock();
    const net = new MemoryNetwork(clock, { minDelay: 1, maxDelay: 200, seed: 9 });
    const a = net.createTransport();
    const b = net.createTransport();
    const got: string[] = [];
    let hostConn = -1;
    let closed = false;
    a.listen((e) => {
      if (e.type === 'open') hostConn = e.conn;
      if (e.type === 'message') got.push(e.text);
    });
    let clientConn = -1;
    b.listen((e) => {
      if (e.type === 'open') clientConn = e.conn;
      if (e.type === 'closed') closed = true;
    });
    a.host('room', 'info');
    b.connect(a.hostId);
    clock.advance(1000);
    expect(hostConn).toBeGreaterThan(0);
    expect(clientConn).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) {
      b.send(clientConn, String(i));
      clock.advance(3);
    }
    clock.advance(1000);
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => String(i)));
    a.close(hostConn);
    clock.advance(500);
    expect(closed).toBe(true);
  });

  it('virtual clock fires timers in time order', () => {
    const c = new VirtualClock();
    const log: string[] = [];
    c.after(30, () => log.push('a30'));
    c.after(10, () => {
      log.push('b10');
      c.after(5, () => log.push('c15'));
    });
    const stop = c.every(20, () => log.push(`e${c.now()}`));
    c.advance(45);
    stop();
    c.advance(100);
    expect(log).toEqual(['b10', 'c15', 'e20', 'a30', 'e40']);
  });
});
