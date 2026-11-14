// Stable world hash for determinism tests (covers public state and sim-internal state).
import type { Order, World } from '../core/types';
import { CATS, getSim, type SimEntity, type SimProjectile } from './state';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Hasher {
  h = 0x811c9dc5;
  int(v: number): void {
    let h = this.h ^ (v | 0);
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    this.h = h;
  }
  num(v: number): void {
    f64[0] = v;
    this.int(u32[0]);
    this.int(u32[1]);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    this.int(s.length);
  }
  bool(b: boolean): void {
    this.int(b ? 1 : 2);
  }
  bytes(a: Uint8Array): void {
    let h = this.h;
    for (let i = 0; i < a.length; i++) {
      h = Math.imul(h ^ a[i], 0x01000193);
    }
    this.h = h ^ (h >>> 13);
  }
}

function hashOrder(H: Hasher, o: Order | null): void {
  if (o === null) {
    H.int(0);
    return;
  }
  H.str(o.type);
  switch (o.type) {
    case 'move':
    case 'attackMove':
      H.num(o.x);
      H.num(o.y);
      break;
    case 'attack':
    case 'dock':
    case 'capture':
      H.int(o.targetId);
      break;
    case 'harvest':
      H.int(o.tx ?? -1);
      H.int(o.ty ?? -1);
      break;
    default:
      break;
  }
}

export function hashWorld(world: World): number {
  const S = getSim(world);
  const H = new Hasher();
  H.int(world.tick);
  H.int(world.rngState);
  H.int(world.nextEntityId);
  H.int(world.winnerTeam ?? -9);
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i];
    H.num(p.credits);
    H.int(p.powerProduced);
    H.int(p.powerConsumed);
    H.bool(p.lowPower);
    H.bool(p.hasRadar);
    H.bool(p.defeated);
    for (const c of CATS) {
      const q = p.queues[c];
      H.bool(q.paused);
      H.bool(q.ready);
      H.int(q.items.length);
      for (const it of q.items) {
        H.str(it.defId);
        H.num(it.progress);
        H.num(it.paid);
      }
      H.bool(S.pl[i].stalled[c]);
    }
    for (const sp of p.powers) {
      H.str(sp.id);
      H.int(sp.sourceId);
      H.int(sp.charge);
      H.bool(sp.ready);
    }
    const st = p.stats;
    H.int(st.unitsBuilt);
    H.int(st.unitsLost);
    H.int(st.buildingsBuilt);
    H.int(st.buildingsLost);
    H.int(st.kills);
    H.num(st.oreHarvested);
    H.num(st.creditsSpent);
    H.bytes(p.visible);
    H.bytes(p.explored);
    for (const a of S.pl[i].alertAt) H.int(a);
  }
  for (const ent of world.entities.values()) {
    const e = ent as SimEntity;
    H.int(e.id);
    H.str(e.defId);
    H.int(e.owner);
    H.num(e.x);
    H.num(e.y);
    H.num(e.px);
    H.num(e.py);
    H.num(e.facing);
    H.num(e.turretFacing);
    H.num(e.altitude);
    H.num(e.hp);
    H.int(e.rank);
    H.int(e.kills);
    H.str(e.action);
    hashOrder(H, e.order);
    H.int(e.queue.length);
    for (const o of e.queue) hashOrder(H, o);
    H.int(e.targetId ?? -1);
    H.int(e.lastFireTick);
    H.int(e.lastHitTick);
    H.int(e.cargo);
    H.num(e.buildProgress);
    if (e.rally) {
      H.num(e.rally.x);
      H.num(e.rally.y);
    } else H.int(-1);
    H.bool(e.primary);
    H.bool(e.repairing);
    H.bool(e.powered);
    // internal
    H.bool(e.mv);
    H.num(e.gx);
    H.num(e.gy);
    H.num(e.rx);
    H.num(e.ry);
    if (e.path) {
      H.int(e.path.length);
      for (const t of e.path) H.int(t);
    } else H.int(-1);
    H.int(e.pi);
    H.bool(e.pathPending);
    H.int(e.stuck);
    H.num(e.sx);
    H.num(e.sy);
    H.int(e.repaths);
    H.int(e.os);
    H.int(e.cd0);
    H.int(e.cd1);
    H.int(e.b0);
    H.int(e.b1);
    H.int(e.tgt1 ?? -1);
    H.bool(e.auto);
    H.int(e.scanAt);
    H.int(e.aggro);
    H.int(e.chaseAt);
    H.num(e.xp);
    H.num(e.ax);
    H.num(e.ay);
    H.bool(e.leash);
    H.int(e.hs);
    H.int(e.ht);
    H.int(e.htx);
    H.int(e.hty);
    H.int(e.href);
    H.int(e.hsum);
    H.num(e.repairAcc);
  }
  H.int(world.projectiles.length);
  for (const pr of world.projectiles as SimProjectile[]) {
    H.int(pr.id);
    H.str(pr.weaponId);
    H.int(pr.owner);
    H.int(pr.sourceId);
    H.num(pr.x);
    H.num(pr.y);
    H.num(pr.z);
    H.num(pr.tx);
    H.num(pr.ty);
    H.int(pr.targetId ?? -1);
    H.num(pr.t ?? 0);
  }
  H.bytes(world.map.ore);
  for (const id of S.pathQueue) H.int(id);
  for (const pd of S.pending) {
    H.int(pd.player);
    H.str(pd.power);
    H.num(pd.x);
    H.num(pd.y);
    H.int(pd.at);
  }
  for (const rv of S.reveals) {
    H.int(rv.team);
    H.num(rv.x);
    H.num(rv.y);
    H.int(rv.until);
  }
  H.int(S.nextProjId);
  return H.h >>> 0;
}
