// 测试辅助：假时钟 + 假定时器 + 记录推送的房间环境（本文件不含测试用例）
import { Room } from '../src/room/room.js';
import { RoomManager } from '../src/room/roomManager.js';
import { normalizeConfig } from '../src/config.js';
import { parseCards } from '../src/game/cards.js';

// 测试用的基础配置：固定为早期的默认值（底注 5、档位 2/5/10、封顶 10 倍、20 轮），
// 这样调整线上默认值时，测试里按这些数算出来的金额不用跟着改
export const LEGACY_CFG = Object.freeze({ ante: 5, raiseSteps: [2, 5, 10], capMultiple: 10, maxRounds: 20 });

export const NO_BONUS_CARDS = ['As Kh 9d', 'Qs Jh 8d', '10s 7h 5d', '9s 6h 4d', '8s 5h 3d', '7s 4h 2d'];

export function rigFrom(list) {
  // list: 每个参与者（按座位升序）的牌字符串
  return (handNo, participants) => {
    const sorted = [...participants].sort((a, b) => a.seatIndex - b.seatIndex);
    const map = {};
    sorted.forEach((p, i) => {
      map[p.seatIndex] = parseCards(list[i]);
    });
    return map;
  };
}

export function makeEnv({ cfg = {}, rig = rigFrom(NO_BONUS_CARDS), timing = {}, ownerId = 'u0' } = {}) {
  const clock = { t: 5_000_000 };
  const sent = [];
  const timers = new Set();
  const removed = [];
  const env = { clock, sent, timers, removed, rigFn: rig };
  const scheduler = {
    set(fn, ms) {
      const h = { fn, ms };
      timers.add(h);
      return h;
    },
    clear(h) {
      timers.delete(h);
    },
  };
  const deps = {
    now: () => clock.t,
    send: (to, msg) => sent.push({ to, msg: JSON.parse(JSON.stringify(msg)) }),
    scheduler,
    onMemberRemoved: (uid) => removed.push(uid),
    rig: (handNo, participants) => env.rigFn(handNo, participants),
    randInt: () => 0,
    timing: { nextHandDelayMs: 5000, dealMs: 0, ...timing },
    onSessionEnd: (room, summary) => {
      env.sessionEnds = (env.sessionEnds || []).concat([summary]);
    },
  };
  const room = new Room({ code: 'ABCD2345', ownerId, config: normalizeConfig({ ...LEGACY_CFG, ...cfg }), deps });
  env.room = room;
  env.deps = deps;
  env.nick = (i) => `N${i}`;
  env.join = (i) => room.join(`u${i}`, `N${i}`);
  env.sit = (i, seat = i) => room.handle(`u${i}`, 'seat.sit', { seatIndex: seat });
  env.ready = (i, ready = true) => room.handle(`u${i}`, 'room.ready', { ready });
  env.do = (i, action, data = {}) => room.handle(`u${i}`, action, data);
  /** 让时间前进 ms 并触发房间的到点处理 */
  env.advance = (ms) => {
    clock.t += ms;
    room.tick();
  };
  /** n 个人依次进入、入座（座位 = 序号）、准备（房主除外） */
  env.seatPlayers = (n) => {
    for (let i = 0; i < n; i++) {
      env.join(i);
      env.sit(i);
    }
    for (let i = 1; i < n; i++) env.ready(i);
  };
  env.start = (n) => {
    env.seatPlayers(n);
    env.do(0, 'room.start');
  };
  env.view = (i) => room.viewFor(`u${i}`);
  env.events = (to = 'u0') => sent.filter((s) => s.to === to && s.msg.type === 'event').map((s) => s.msg.data);
  env.lastState = (uid) => {
    for (let k = sent.length - 1; k >= 0; k--) if (sent[k].to === uid && sent[k].msg.type === 'state') return sent[k].msg.data;
    return null;
  };
  return env;
}

export function makeManagerEnv({ timing = {}, rig, cfg } = {}) {
  const clock = { t: 9_000_000 };
  const sent = [];
  const timers = new Set();
  const scheduler = {
    set(fn, ms) {
      const h = { fn, ms };
      timers.add(h);
      return h;
    },
    clear(h) {
      timers.delete(h);
    },
  };
  const manager = new RoomManager({
    now: () => clock.t,
    send: (to, msg) => sent.push({ to, msg: JSON.parse(JSON.stringify(msg)) }),
    timing: { dealMs: 0, ...timing },
    scheduler,
    rig,
    randInt: () => 0,
  });
  return { clock, sent, timers, manager, cfg };
}

/**
 * 遍历 JSON，找出所有带 cards 字段的对象，返回它们的路径。
 * 用于断言牌面只会出现在 hand.myCards 与 hand.visible 里。
 */
export function cardPaths(value, path = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => cardPaths(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    if ('cards' in value) out.push(path);
    for (const [k, v] of Object.entries(value)) cardPaths(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}
