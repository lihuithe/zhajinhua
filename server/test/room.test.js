// 房间逻辑：准备 / 开始 / 局间 / 场结算 / 房主 / 超时 / 销毁（使用假时钟，不真的等待）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, makeManagerEnv, rigFrom } from './helpers.js';
import { ROOM_CODE_CHARS } from '../src/room/roomManager.js';
import { dealDurationMs } from '../src/room/room.js';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, `应抛出 ${code}`);

// 让当前局快速结束：除 winner 外全部弃牌
function foldAllExcept(env, winner, n) {
  for (let i = 0; i < n; i++) if (i !== winner) env.do(i, 'game.fold');
}

test('准备与开始：人数、准备状态校验；房主无需准备', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  throwsCode(() => env.do(0, 'room.start'), 'NOT_ENOUGH_PLAYERS');
  env.join(1);
  env.sit(1);
  throwsCode(() => env.do(0, 'room.start'), 'NOT_ALL_READY');
  throwsCode(() => env.do(1, 'room.start'), 'NOT_OWNER');
  throwsCode(() => env.ready(0), 'INVALID_ACTION'); // 房主无需准备
  env.join(2); // 观战者不影响开始
  env.ready(1);
  env.ready(1, false);
  throwsCode(() => env.do(0, 'room.start'), 'NOT_ALL_READY');
  throwsCode(() => env.ready(2), 'NOT_SEATED');
  env.ready(1);
  env.do(0, 'room.start');
  assert.equal(env.room.phase, 'playing');
  assert.equal(env.room.handNo, 1);
  throwsCode(() => env.do(0, 'room.start'), 'BAD_PHASE');
  throwsCode(() => env.ready(1, false), 'BAD_PHASE');
  assert.deepEqual(env.events().filter((e) => e.kind === 'handStart'), [{ kind: 'handStart', handNo: 1 }]);
});

test('房主可以不入座，只观战并主持房间', () => {
  const env = makeEnv();
  env.join(0); // 房主不入座
  for (const i of [1, 2]) {
    env.join(i);
    env.sit(i);
    env.ready(i);
  }
  env.do(0, 'room.start');
  assert.equal(env.room.phase, 'playing');
  assert.equal(env.view(0).me.seatIndex, null);
  assert.equal(env.view(0).me.isOwner, true);
});

test('准备阶段改配置：清空所有人的准备状态，通知全房间；initialChips 被忽略；非房主 / 非法配置被拒绝', () => {
  const env = makeEnv({ cfg: { initialChips: 300 } });
  env.seatPlayers(3);
  assert.ok(env.view(0).seats[1].ready && env.view(0).seats[2].ready);
  throwsCode(() => env.do(1, 'room.updateConfig', { config: { ante: 10 } }), 'NOT_OWNER');
  throwsCode(() => env.do(0, 'room.updateConfig', { config: { ante: 0 } }), 'BAD_CONFIG');
  throwsCode(() => env.do(0, 'room.updateConfig', { config: { raiseSteps: [5, 3] } }), 'BAD_CONFIG');
  assert.ok(env.view(0).seats[1].ready, '失败的修改不应清空准备');
  env.do(0, 'room.updateConfig', { config: { ...env.view(0).config, ante: 10, initialChips: 99999 } });
  const v = env.view(1);
  assert.equal(v.config.ante, 10);
  assert.equal(v.config.initialChips, 300);
  assert.ok(v.seats.filter(Boolean).every((s) => !s.ready));
  assert.ok(env.events('u2').some((e) => e.kind === 'notice' && /重新准备/.test(e.text)));
  // 开局后不能再改
  env.ready(1);
  env.ready(2);
  env.do(0, 'room.start');
  throwsCode(() => env.do(0, 'room.updateConfig', { config: { ante: 20 } }), 'BAD_PHASE');
});

test('踢人：任何阶段都可以；勾选禁止再进才拉黑；对局中的人先弃牌，本局结束后移出', () => {
  const env = makeEnv();
  env.seatPlayers(4);
  throwsCode(() => env.do(1, 'room.kick', { userId: 'u2' }), 'NOT_OWNER');
  throwsCode(() => env.do(0, 'room.kick', { userId: 'u0' }), 'INVALID_ACTION');
  throwsCode(() => env.do(0, 'room.kick', { userId: 'nobody' }), 'INVALID_ACTION');
  // 不勾选：可以再进来
  env.do(0, 'room.kick', { userId: 'u3' });
  assert.ok(env.events('u3').some((e) => e.kind === 'kicked'));
  assert.equal(env.view(0).seats[3], null);
  env.join(3);
  // 勾选禁止再进
  env.do(0, 'room.kick', { userId: 'u3', ban: true });
  throwsCode(() => env.join(3), 'BANNED');
  throwsCode(() => env.room.checkJoin('u3'), 'BANNED');
  // 对局中踢人：观战者直接移出，本局参与者先弃牌
  env.do(0, 'room.start');
  env.join(5);
  env.do(0, 'room.kick', { userId: 'u5' });
  assert.ok(!env.view(0).spectators.some((m) => m.userId === 'u5'));
  env.do(0, 'room.kick', { userId: 'u2' });
  const p2 = env.view(0).hand.players.find((p) => p.seatIndex === 2);
  assert.equal(p2.state, 'folded');
  assert.ok(env.removed.includes('u2'));
  // 打完本局后座位清空
  for (let k = 0; k < 5 && !env.view(0).hand.ended; k++) env.do(env.view(0).hand.turnSeat, 'game.fold');
  assert.equal(env.view(0).seats[2], null);
});

test('座位：占座、重复入座、非法座位、对局中不能站起，局间可以站起并恢复积分', () => {
  const env = makeEnv({ cfg: { initialChips: 200 } });
  env.start(3);
  env.join(7);
  throwsCode(() => env.sit(7, 1), 'SEAT_TAKEN');
  throwsCode(() => env.sit(7, 15), 'INVALID_ACTION');
  throwsCode(() => env.sit(7, -1), 'INVALID_ACTION');
  throwsCode(() => env.sit(1, 9), 'INVALID_ACTION'); // 已入座
  throwsCode(() => env.do(1, 'seat.stand'), 'IN_HAND');
  throwsCode(() => env.do(7, 'seat.stand'), 'NOT_SEATED');
  // 弃牌后依然不能站起，要等本局结束
  env.do(1, 'game.fold');
  throwsCode(() => env.do(1, 'seat.stand'), 'IN_HAND');
  env.do(2, 'game.fold');
  // 本局结束，进入局间：可以站起
  assert.equal(env.view(0).hand.ended, true);
  const chips1 = env.view(1).seats[1].chips;
  assert.equal(chips1, 195);
  env.do(1, 'seat.stand');
  assert.equal(env.view(0).seats[1], null);
  assert.equal(env.view(0).spectators.some((s) => s.userId === 'u1'), true);
  // 同一场里重新入座，恢复原来的积分（不是重新发 200）
  env.sit(1, 5);
  assert.equal(env.view(0).seats[5].chips, 195);
  // 本局开始后才入座的人：新玩家拿初始积分，状态 waitingNext
  env.advance(5000);
  assert.equal(env.room.handNo, 2);
  env.join(8);
  env.sit(8, 9);
  assert.equal(env.view(0).seats[9].chips, 200);
  assert.equal(env.view(0).seats[9].status, 'waitingNext');
  assert.equal(env.view(0).hand.players.length, 3);
  assert.ok(!env.view(0).hand.players.some((p) => p.userId === 'u8'));
  throwsCode(() => env.do(8, 'game.fold'), 'INVALID_ACTION');
  // 下一局他加入
  foldAllExcept(env, 0, 3);
  env.advance(5000);
  assert.ok(env.view(0).hand.players.some((p) => p.userId === 'u8'));
  assert.equal(env.view(0).seats[9].status, 'playing');
});

test('局间 5 秒倒计时：到点自动开始下一局；赢家坐庄；期间可以亮牌', () => {
  const env = makeEnv();
  env.start(3);
  assert.equal(env.view(0).hand.dealerSeat, 0); // 第一局庄家：randInt=0 取第一个
  foldAllExcept(env, 2, 3); // s2 赢
  const v = env.view(2);
  assert.equal(v.hand.ended, true);
  assert.equal(v.nextHandAt, env.clock.t + 5000);
  assert.equal(v.phase, 'playing');
  assert.equal(v.hand.result.showable, true);
  env.do(2, 'game.show');
  env.advance(4999);
  assert.equal(env.room.handNo, 1);
  env.advance(1);
  assert.equal(env.room.handNo, 2);
  assert.equal(env.view(0).hand.dealerSeat, 2, '上一局赢家坐庄');
  assert.equal(env.view(0).nextHandAt, null);
  assert.equal(env.view(0).hand.ended, false);
  // 积分延续：s2 赢了 15 - 5 = +10，新一局已扣底注 5
  assert.equal(env.view(2).seats[2].chips, 1005);
});

test('庄家轮转：赢家不参与时由上一任庄家顺时针的下一位参与者坐庄；平分取行动顺序最靠前者', () => {
  const env = makeEnv({ cfg: { initialChips: 100, ante: 5 } });
  env.start(4); // 庄家 s0
  foldAllExcept(env, 1, 4); // s1 赢
  // 赢家 s1 在局间站起 → 下一局不参与
  env.do(1, 'seat.stand');
  env.advance(5000);
  assert.equal(env.room.handNo, 2);
  assert.equal(env.view(0).hand.dealerSeat, 2, '上一任庄家 s0 顺时针的下一位参与者是 s2（s1 已站起）');
});

test('打满 hands 局：延迟后进入结算，生成场结算榜与历场累计；再来一场重置积分与准备', () => {
  const env = makeEnv({ cfg: { hands: 2, initialChips: 200 } });
  env.start(3);
  foldAllExcept(env, 1, 3);
  env.advance(5000);
  assert.equal(env.room.handNo, 2);
  foldAllExcept(env, 2, 3);
  assert.equal(env.room.phase, 'playing'); // 最后一局结束后先留 5 秒看结果
  assert.equal(env.view(0).nextHandAt, env.clock.t + 5000);
  assert.equal(env.view(0).summary, null);
  env.advance(5000);
  const v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.nextHandAt, null);
  assert.equal(v.hand.ended, true, '结算阶段 hand 是刚结束的那一局');
  assert.equal(v.summary.sessionNo, 1);
  assert.equal(v.summary.handsPlayed, 2);
  assert.equal(v.summary.players.length, 3);
  assert.equal(v.summary.players.reduce((a, p) => a + p.net, 0), 0);
  assert.deepEqual(v.summary.players.map((p) => p.net), [...v.summary.players.map((p) => p.net)].sort((a, b) => b - a));
  for (const p of v.summary.players) {
    assert.equal(p.finalChips - 200, p.net);
    assert.ok(['sanpai', null].includes(p.bestType) || typeof p.bestType === 'string');
  }
  assert.equal(v.summary.players.reduce((a, p) => a + p.wins, 0), 2);
  assert.equal(v.sessions.length, 1);
  assert.equal(v.totals.length, 3);
  assert.equal(v.totals.reduce((a, t) => a + t.net, 0), 0);
  assert.equal(env.sessionEnds.length, 1);
  assert.ok(env.events().some((e) => e.kind === 'sessionEnd'));
  // 结算阶段不能操作牌局，非房主不能再来一场
  throwsCode(() => env.do(0, 'game.call'), 'BAD_PHASE');
  throwsCode(() => env.do(1, 'room.restart'), 'NOT_OWNER');
  throwsCode(() => env.do(0, 'room.endSession'), 'BAD_PHASE');
  // 再来一场
  env.do(0, 'room.restart');
  const w = env.view(0);
  assert.equal(w.phase, 'waiting');
  assert.equal(w.sessionNo, 2);
  assert.equal(w.handNo, 0);
  assert.equal(w.hand, null);
  assert.equal(w.summary, null);
  assert.ok(w.seats.filter(Boolean).every((s) => s.chips === 200 && !s.ready && s.status === 'idle'));
  assert.equal(w.sessions.length, 1, '历史各场保留');
  assert.equal(w.totals.length, 3);
  // 配置可改（initialChips 除外），然后第二场
  env.do(0, 'room.updateConfig', { config: { ...w.config, hands: 1 } });
  env.ready(1);
  env.ready(2);
  env.do(0, 'room.start');
  foldAllExcept(env, 0, 3);
  env.advance(5000);
  assert.equal(env.view(0).phase, 'finished');
  assert.equal(env.view(0).sessions.length, 2);
  assert.equal(env.view(0).sessions[0].sessionNo, 2, '最近的在前');
  assert.equal(env.sessionEnds.length, 2);
});

test('房主提前结束：当前局作废并退还下注，然后直接结算', () => {
  const env = makeEnv({ cfg: { initialChips: 300 } });
  env.start(3);
  env.do(1, 'game.call');
  env.do(2, 'game.look');
  env.do(2, 'game.raise', { to: 10 }); // 明牌：付 20
  throwsCode(() => env.do(1, 'room.endSession'), 'NOT_OWNER');
  env.do(0, 'room.endSession');
  const v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.hand.result.reason, 'voided');
  assert.deepEqual(v.hand.result.winners, []);
  assert.ok(v.seats.filter(Boolean).every((s) => s.chips === 300));
  assert.equal(v.summary.handsPlayed, 0, '作废的局不计入');
  assert.ok(v.summary.players.every((p) => p.net === 0 && p.wins === 0));
  assert.ok(env.events().some((e) => e.kind === 'handEnd' && e.result.reason === 'voided'));
});

test('房主提前结束：局间（上一局已结束）也可以直接结算', () => {
  const env = makeEnv();
  env.start(2);
  foldAllExcept(env, 0, 2);
  env.do(0, 'room.endSession');
  const v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.handsPlayed, 1);
  assert.equal(v.nextHandAt, null);
  // 倒计时已被取消
  env.advance(10000);
  assert.equal(env.view(0).phase, 'finished');
  assert.equal(env.room.handNo, 1);
});

test('积分不足底注的玩家本局不参与（sittingOut），符合条件的不足 2 人时本场提前结束', () => {
  const env = makeEnv({ cfg: { initialChips: 100, ante: 10 } });
  env.start(3);
  foldAllExcept(env, 0, 3);
  env.room.seats[2].chips = 3; // 人为制造积分不足
  env.advance(5000);
  let v = env.view(0);
  assert.equal(v.hand.players.length, 2);
  assert.equal(v.seats[2].status, 'sittingOut');
  assert.equal(v.seats[0].status, 'playing');
  assert.equal(v.seats[2].chips, 3);
  throwsCode(() => env.do(2, 'game.fold'), 'INVALID_ACTION');
  // 再让另一个人也不够 → 提前结束
  foldAllExcept(env, 0, 2);
  env.room.seats[1].chips = 1;
  env.advance(5000);
  v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.handsPlayed, 2);
  assert.ok(env.events().some((e) => e.kind === 'notice' && /提前结束/.test(e.text)));
});

test('行动超时按 timeoutAction 处理，到点才触发', () => {
  const env = makeEnv({ cfg: { actionSeconds: 15, timeoutAction: 'fold' } });
  env.start(3);
  const h = env.view(0).hand;
  assert.equal(h.turnDeadline, env.clock.t + 15000);
  assert.equal(env.view(0).serverTime, env.clock.t);
  env.advance(14999);
  assert.equal(env.view(0).hand.players.find((p) => p.seatIndex === 1).state, 'active');
  env.advance(1);
  const p1 = env.view(0).hand.players.find((p) => p.seatIndex === 1);
  assert.equal(p1.state, 'folded');
  assert.equal(p1.timedOut, true);
  assert.equal(env.view(0).hand.turnSeat, 2);
  // 定时器被安排在下一次行动超时
  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers][0].ms, 15000);
});

test('连续 2 局超时的玩家，本局结束后自动站起转为观战，积分保留；中间正常行动则清零计数', () => {
  const env = makeEnv({ cfg: { actionSeconds: 10, initialChips: 300 } });
  env.start(3); // 庄家 s0，顺序 s1 s2 s0
  // 第 1 局：s1、s2 都超时，s0 赢
  env.advance(10000);
  env.advance(10000);
  assert.equal(env.view(0).hand.ended, true);
  assert.equal(env.view(0).hand.result.winners[0], 0);
  assert.ok(env.view(0).seats[1] && env.view(0).seats[2]);
  env.advance(5000); // 第 2 局，s0 坐庄 → 顺序仍是 s1 s2 s0
  // s1 这一局正常行动（弃牌）；s2 再次超时
  env.do(1, 'game.fold');
  env.advance(10000); // s2 超时 → 只剩 s0
  assert.equal(env.view(0).hand.ended, true);
  assert.ok(env.view(0).seats[1], 's1 没有连续超时，保留座位');
  assert.equal(env.view(0).seats[2], null, 's2 连续 2 局超时，自动站起');
  assert.ok(env.view(0).spectators.some((s) => s.userId === 'u2'));
  assert.ok(env.events().some((e) => e.kind === 'notice' && /连续 2 局超时/.test(e.text)));
  // 积分保留：s2 两局都只亏了底注
  env.advance(5000);
  // 只剩 2 人，继续
  assert.equal(env.room.handNo, 3);
  assert.equal(env.view(0).hand.players.length, 2);
  // 重新入座恢复积分
  env.sit(2, 2);
  assert.equal(env.view(0).seats[2].chips, 290);
});

test('房主主动退出：立即转给最早入座的在线玩家；没有入座者时转给最早进入的在线观战者', () => {
  const env = makeEnv();
  env.join(0);
  env.join(3); // 观战者，最早进入
  env.join(1);
  env.sit(1, 6);
  env.join(2);
  env.sit(2, 1); // 座位号小，但入座更晚
  env.do(0, 'room.leave');
  assert.equal(env.room.ownerId, 'u1', '最早入座的在线玩家');
  assert.ok(env.removed.includes('u0'));
  assert.ok(env.events('u3').some((e) => e.kind === 'notice' && /N1 成为房主/.test(e.text)));
  assert.equal(env.view(3).ownerId, 'u1');
  assert.equal(env.view(2).me.isOwner, false);
  // 房主和所有玩家都离开 / 掉线，剩观战者
  env.do(1, 'room.leave');
  assert.equal(env.room.ownerId, 'u2');
  env.do(2, 'room.leave');
  assert.equal(env.room.ownerId, 'u3', '没有入座者时转给观战者');
});

test('房主转移：掉线的入座者不能接任', () => {
  const env = makeEnv();
  env.join(0);
  env.join(1);
  env.sit(1);
  env.join(2);
  env.sit(2);
  env.room.setOnline('u1', false);
  env.do(0, 'room.leave');
  assert.equal(env.room.ownerId, 'u2');
});

test('房主掉线超过 120 秒才转移；回来则不转移', () => {
  const env = makeEnv();
  env.join(0);
  env.join(1);
  env.sit(1);
  env.join(2);
  env.room.setOnline('u0', false);
  assert.equal(env.view(1).seats.filter(Boolean).length, 1);
  env.advance(119000);
  assert.equal(env.room.ownerId, 'u0');
  // 已安排在 120 秒时触发
  assert.ok([...env.timers].some((t) => t.ms <= 1000 + 25));
  env.advance(1001);
  assert.equal(env.room.ownerId, 'u1');
  assert.equal(env.view(2).ownerId, 'u1');
  // 另一种情况：回来了
  const env2 = makeEnv();
  env2.join(0);
  env2.join(1);
  env2.room.setOnline('u0', false);
  env2.advance(60000);
  env2.room.setOnline('u0', true);
  env2.advance(240000);
  assert.equal(env2.room.ownerId, 'u0');
});

test('离线的观战者一段时间后被清理，离线的入座者保留座位', () => {
  const env = makeEnv({ timing: { spectatorOfflineMs: 60000 } });
  env.join(0);
  env.join(1);
  env.sit(1);
  env.join(2);
  env.room.setOnline('u1', false);
  env.room.setOnline('u2', false);
  env.advance(61000);
  assert.ok(!env.room.members.has('u2'));
  assert.ok(env.room.members.has('u1'));
  assert.ok(env.removed.includes('u2'));
});

test('对局中退出房间：先自动弃牌，座位保留到本局结束，积分记入本场，再进入可恢复', () => {
  const env = makeEnv({ cfg: { initialChips: 200 } });
  env.start(3);
  env.do(2, 'room.leave');
  assert.equal(env.view(0).hand.players.find((p) => p.seatIndex === 2).state, 'folded');
  assert.ok(env.removed.includes('u2'));
  assert.ok(env.view(0).seats[2], '座位保留到本局结束');
  assert.equal(env.view(0).seats[2].online, false);
  throwsCode(() => env.do(2, 'seat.stand'), 'NOT_IN_ROOM');
  env.do(1, 'game.fold'); // 只剩 s0，本局结束
  const v = env.view(0);
  assert.equal(v.seats[2], null, '本局结束后清理座位');
  assert.ok(!v.spectators.some((s) => s.userId === 'u2'));
  env.advance(5000);
  // 重新进入、入座，恢复本场原有积分
  env.join(2);
  env.sit(2, 4);
  assert.equal(env.view(0).seats[4].chips, 195);
});

test('观战者退出立即清理；退出后不再收到推送', () => {
  const env = makeEnv();
  env.join(0);
  env.join(1);
  const before = env.sent.length;
  env.do(1, 'room.leave');
  assert.equal(env.room.spectatorCount, 1); // 只剩房主 u0
  assert.ok(env.sent.slice(before).every((s) => s.to !== 'u1'));
  throwsCode(() => env.do(1, 'room.leave'), 'NOT_IN_ROOM');
});

test('房间容量：15 个座位 + 30 个观战，都满时拒绝进入', () => {
  const env = makeEnv();
  for (let i = 0; i < 15; i++) {
    env.join(i);
    env.sit(i);
  }
  for (let i = 100; i < 130; i++) env.join(i);
  assert.equal(env.room.spectatorCount, 30);
  throwsCode(() => env.join(999), 'ROOM_FULL');
  // 已在房间里的人重复 join 只是重新同步
  env.join(100);
  env.join(3);
  assert.equal(env.room.members.size, 45);
});

test('销毁房间：清理定时器、成员与引用', () => {
  const env = makeEnv({ cfg: { actionSeconds: 10 } });
  env.start(3);
  assert.equal(env.timers.size, 1);
  env.room.destroy();
  assert.equal(env.timers.size, 0);
  assert.equal(env.room.members.size, 0);
  assert.equal(env.room.game, null);
  assert.deepEqual(env.removed.sort(), ['u0', 'u1', 'u2']);
  // 销毁后的残留调用不应抛错也不应重新安排定时器
  env.advance(100000);
  assert.equal(env.timers.size, 0);
});

test('任何时刻最多只有一个房间定时器（不会泄漏）', () => {
  const env = makeEnv({ cfg: { actionSeconds: 10 } });
  env.start(3);
  for (let i = 0; i < 5; i++) {
    env.do(1 + (i % 2), 'game.look');
    assert.ok(env.timers.size <= 1);
  }
  foldAllExcept(env, 0, 3);
  assert.equal(env.timers.size, 1); // 局间倒计时
  env.do(0, 'room.endSession');
  assert.equal(env.timers.size, 0);
});

// ---------------- RoomManager ----------------

test('房间号：8 位，只用小写字母和数字（30 个字符），且不重复；查找不区分大小写', () => {
  assert.equal(ROOM_CODE_CHARS.length, 30);
  assert.equal(new Set(ROOM_CODE_CHARS).size, 30);
  assert.equal(ROOM_CODE_CHARS, ROOM_CODE_CHARS.toLowerCase());
  {
    const { manager } = makeManagerEnv();
    const code = manager.createRoom('o9', {});
    assert.ok(manager.getRoom(code.toUpperCase()));
    manager.join('u1', 'N1', '  ' + code.toUpperCase() + ' ');
    assert.equal(manager.roomOf('u1').code, code);
  }
  const { manager } = makeManagerEnv();
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const code = manager.createRoom(`owner${i}`, {});
    assert.match(code, /^[23456789abcdefghjkmnprstuvwxyz]{8}$/);
    codes.add(code);
    manager.destroyRoom(code);
  }
  assert.ok(codes.size > 190);
  // 排除容易混淆的字符
  for (const ch of '01ilo' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.ok(!ROOM_CODE_CHARS.includes(ch), ch);
});

test('创建房间：配置不合法返回 BAD_CONFIG；每人最多 5 个自己的房间', () => {
  const { manager } = makeManagerEnv();
  throwsCode(() => manager.createRoom('o1', { hands: 0 }), 'BAD_CONFIG');
  throwsCode(() => manager.createRoom('o1', { actionSeconds: 9 }), 'BAD_CONFIG');
  throwsCode(() => manager.createRoom('o1', { actionSeconds: 181 }), 'BAD_CONFIG');
  throwsCode(() => manager.createRoom('o1', { nextHandSeconds: 2 }), 'BAD_CONFIG');
  throwsCode(() => manager.createRoom('o1', { settleSeconds: 61 }), 'BAD_CONFIG');
  throwsCode(() => manager.createRoom('o1', { raiseSteps: [2, 5, 20], capMultiple: 10 }), 'BAD_CONFIG');
  for (let i = 0; i < 5; i++) manager.createRoom('o1', {});
  throwsCode(() => manager.createRoom('o1', {}), 'TOO_MANY_ROOMS');
});

test('一个账号同时只能在一个房间：进入新房间自动退出旧房间；旧房间对局中未弃牌则拒绝', () => {
  const { manager } = makeManagerEnv({ rig: rigFrom(['As Kh 9d', 'Qs Jh 8d', '10s 7h 5d']) });
  const a = manager.createRoom('u0', {});
  const b = manager.createRoom('u0', {});
  const ra = manager.getRoom(a);
  manager.join('u0', 'N0', a);
  manager.join('u1', 'N1', a);
  manager.join('u2', 'N2', a);
  manager.handle('u0', 'seat.sit', { seatIndex: 0 });
  manager.handle('u1', 'seat.sit', { seatIndex: 1 });
  manager.handle('u2', 'seat.sit', { seatIndex: 2 });
  manager.handle('u1', 'room.ready', { ready: true });
  manager.handle('u2', 'room.ready', { ready: true });
  // 观战者 u3 在房间 a，之后换到房间 b：自动退出旧房间
  manager.join('u3', 'N3', a);
  manager.join('u3', 'N3', b);
  assert.equal(manager.roomOf('u3').code, b);
  assert.ok(!ra.members.has('u3'));
  manager.handle('u0', 'room.start', {});
  // u1 在对局中没弃牌：拒绝进入别的房间
  throwsCode(() => manager.join('u1', 'N1', b), 'IN_OTHER_GAME');
  assert.equal(manager.roomOf('u1').code, a);
  // 弃牌后可以去别的房间（座位保留到本局结束）
  manager.handle('u1', 'game.fold', {});
  manager.join('u1', 'N1', b);
  assert.equal(manager.roomOf('u1').code, b);
  assert.equal(manager.roomOf('u1').members.has('u1'), true);
  throwsCode(() => manager.join('u1', 'N1', 'ZZZZZZZZ'), 'ROOM_NOT_FOUND');
  throwsCode(() => manager.handle('nobody', 'seat.sit', { seatIndex: 0 }), 'NOT_IN_ROOM');
  // 房间号前后的空格会被忽略
  manager.join('u5', 'N5', `  ${a}  `);
  assert.equal(manager.roomOf('u5').code, a);
});

test('房间内没有任何在线成员持续 30 分钟后销毁，房间号作废；有人在线则不销毁', () => {
  const { manager, clock, timers } = makeManagerEnv();
  const code = manager.createRoom('u0', {});
  const code2 = manager.createRoom('u0', {});
  manager.join('u0', 'N0', code2);
  manager.join('u1', 'N1', code);
  manager.onDisconnect('u1');
  manager.sweep();
  assert.ok(manager.getRoom(code));
  clock.t += 29 * 60 * 1000;
  manager.sweep();
  assert.ok(manager.getRoom(code));
  // 中途有人回来：重新计时
  manager.onConnect('u1');
  clock.t += 5 * 60 * 1000;
  manager.sweep();
  assert.ok(manager.getRoom(code));
  manager.onDisconnect('u1');
  clock.t += 30 * 60 * 1000;
  manager.sweep();
  assert.equal(manager.getRoom(code), null);
  assert.equal(manager.roomOf('u1'), null, '用户与房间的引用被清理');
  assert.ok(manager.getRoom(code2), '有在线成员的房间不销毁');
  manager.close();
  assert.equal(manager.rooms.size, 0);
  assert.equal(timers.size, 0);
});

test('从未有人进入的房间同样在 30 分钟后销毁', () => {
  const { manager, clock } = makeManagerEnv();
  const code = manager.createRoom('u0', {});
  clock.t += 30 * 60 * 1000 - 1;
  manager.sweep();
  assert.ok(manager.getRoom(code));
  clock.t += 1;
  manager.sweep();
  assert.equal(manager.getRoom(code), null);
});

test('局间等待与结算前等待按房间配置计时', () => {
  const env = makeEnv({ cfg: { hands: 2, nextHandSeconds: 7, settleSeconds: 13 }, timing: { nextHandDelayMs: null } });
  env.start(2);
  const foldTurn = () => env.do(env.view(0).hand.turnSeat, 'game.fold');
  // 第 1 局：当前行动者弃牌，另一人获胜，按 nextHandSeconds 倒计时
  foldTurn();
  assert.equal(env.view(0).nextHandAt - env.clock.t, 7000);
  env.advance(6999);
  assert.equal(env.view(0).hand.handNo, 1);
  env.advance(1);
  assert.equal(env.view(0).hand.handNo, 2);
  // 第 2 局（最后一局）结束后按 settleSeconds 进入结算
  foldTurn();
  assert.equal(env.view(0).nextHandAt - env.clock.t, 13000);
  assert.equal(env.view(0).phase, 'playing');
  env.advance(13000);
  assert.equal(env.view(0).phase, 'finished');
});

test('聊天：文字 / 表情 / 校验 / 限频 / 观战者也能发 / 推送给所有人 / 进入房间带历史', () => {
  const { manager, clock, sent } = makeManagerEnv();
  const code = manager.createRoom('u0', {});
  manager.join('u0', 'N0', code);
  manager.join('u1', 'N1', code);
  manager.handle('u0', 'seat.sit', { seatIndex: 0 });
  const chatEvents = (to) => sent.filter((s) => s.to === to && s.msg.type === 'event' && s.msg.data.kind === 'chat').map((s) => s.msg.data.msg);

  // 入座玩家发文字：控制字符与多余空白被清理
  manager.handle('u0', 'chat.send', { kind: 'text', text: '  快点吧\n\n 等得花儿都谢了 ' });
  let got = chatEvents('u1');
  assert.equal(got.length, 1);
  assert.equal(got[0].text, '快点吧 等得花儿都谢了');
  assert.equal(got[0].seatIndex, 0);
  assert.equal(got[0].nickname, 'N0');
  assert.equal(chatEvents('u0').length, 1, '发送者自己也收到');

  // 观战者发表情
  manager.handle('u1', 'chat.send', { kind: 'emoji', text: '👍' });
  got = chatEvents('u0');
  assert.equal(got[1].kind, 'emoji');
  assert.equal(got[1].seatIndex, null);

  // 校验
  clock.t += 1000;
  throwsCode(() => manager.handle('u1', 'chat.send', { kind: 'emoji', text: '🐍' }), 'INVALID_ACTION');
  throwsCode(() => manager.handle('u1', 'chat.send', { kind: 'text', text: '   ' }), 'INVALID_ACTION');
  throwsCode(() => manager.handle('u1', 'chat.send', { kind: 'text', text: '字'.repeat(61) }), 'INVALID_ACTION');
  manager.handle('u1', 'chat.send', { kind: 'text', text: '字'.repeat(60) });
  // 限频
  throwsCode(() => manager.handle('u1', 'chat.send', { kind: 'text', text: '再说一句' }), 'CHAT_TOO_FAST');
  clock.t += 800;
  manager.handle('u1', 'chat.send', { kind: 'text', text: '再说一句' });

  // 新进入的人拿到历史；聊天不会触发整房状态推送
  const statesBefore = sent.filter((s) => s.msg.type === 'state').length;
  clock.t += 1000;
  manager.handle('u0', 'chat.send', { kind: 'text', text: '欢迎' });
  assert.equal(sent.filter((s) => s.msg.type === 'state').length, statesBefore);
  const res = manager.join('u2', 'N2', code);
  assert.deepEqual(
    res.chat.map((m) => m.text),
    ['快点吧 等得花儿都谢了', '👍', '字'.repeat(60), '再说一句', '欢迎'],
  );
  // 聊天消息里不含牌面
  assert.equal(JSON.stringify(res).includes('"cards"'), false);
});

test('聊天：房间只保留最近 50 条', () => {
  const { manager, clock } = makeManagerEnv();
  const code = manager.createRoom('u0', {});
  manager.join('u0', 'N0', code);
  for (let i = 0; i < 60; i++) {
    clock.t += 1000;
    manager.handle('u0', 'chat.send', { kind: 'text', text: 'm' + i });
  }
  const res = manager.join('u1', 'N1', code);
  assert.equal(res.chat.length, 50);
  assert.equal(res.chat[0].text, 'm10');
  assert.equal(res.chat[49].text, 'm59');
});

test('有人离座导致不足 2 人：本场暂停，不结束；坐回来积分不变，倒计时后继续', () => {
  const env = makeEnv({ cfg: { hands: 10, nextHandSeconds: 10 }, timing: { nextHandDelayMs: null } });
  env.start(2);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  const chips1 = env.view(0).seats[1].chips;
  env.do(1, 'seat.stand'); // 局间站起
  env.advance(10000);
  let v = env.view(0);
  assert.equal(v.phase, 'playing');
  assert.equal(v.paused, true);
  assert.equal(v.hand.handNo, 1, '没有开新局');
  assert.equal(v.nextHandAt, null);
  assert.ok(env.events().some((e) => e.kind === 'notice' && /暂停/.test(e.text)));
  env.advance(60000);
  assert.equal(env.view(0).phase, 'playing', '暂停期间不会自动结束');
  // 坐回来：积分不变，开始倒计时
  env.sit(1);
  v = env.view(0);
  assert.equal(v.paused, false);
  assert.equal(v.seats[1].chips, chips1);
  assert.equal(v.nextHandAt - env.clock.t, 10000);
  env.advance(10000);
  assert.equal(env.view(0).hand.handNo, 2);
  // 暂停期间房主可以结束本场，原因是 owner
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.do(1, 'seat.stand');
  env.advance(10000);
  assert.equal(env.view(0).paused, true);
  env.do(0, 'room.endSession');
  v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.endReason, 'owner');
  assert.equal(v.summary.handsPlayed, 2);
});

test('暂停中观战者入座也能让本场继续；暂停状态进快照', () => {
  const env = makeEnv({ cfg: { hands: 10 }, timing: { nextHandDelayMs: 1000 } });
  env.start(2);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.do(1, 'room.leave');
  env.advance(1000);
  assert.equal(env.view(0).paused, true);
  const snap = JSON.parse(JSON.stringify(env.room.toSnapshot()));
  assert.equal(snap.paused, true);
  env.join(5);
  env.sit(5);
  assert.equal(env.view(0).paused, false);
  env.advance(1000);
  const v = env.view(0);
  assert.equal(v.hand.handNo, 2);
  assert.deepEqual(v.hand.players.map((p) => p.seatIndex).sort(), [0, 5]);
});

test('结算原因：打满局数为 completed，其他人输光为 busted', () => {
  const env = makeEnv({ cfg: { hands: 1 }, timing: { nextHandDelayMs: 1000 } });
  env.start(2);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.advance(1000);
  assert.equal(env.view(0).summary.endReason, 'completed');
  assert.equal(env.view(0).summary.hands, 1);
  const env2 = makeEnv({ cfg: { hands: 5, initialChips: 100, ante: 10 }, timing: { nextHandDelayMs: 1000 } });
  env2.start(2);
  env2.do(env2.view(0).hand.turnSeat, 'game.fold');
  env2.room.seats[1].chips = 3;
  env2.room.seats[0].chips = Math.max(env2.room.seats[0].chips, 20);
  env2.advance(1000);
  const v = env2.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.endReason, 'busted');
});

test('开新一局时，座位上离线超过 10 秒的人自动改为观战模式；刚断线的保留座位；坐回来积分不变', () => {
  const env = makeEnv({ cfg: { hands: 10 }, timing: { nextHandDelayMs: 5000 } });
  env.start(3);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  const v0 = env.view(0);
  for (const i of [0, 1, 2]) if (v0.hand.turnSeat === i && !v0.hand.ended) env.do(i, 'game.fold');
  // u2 离线很久，u1 刚断线
  env.room.setOnline('u2', false);
  env.advance(3000);
  env.room.setOnline('u1', false);
  // 先把本局打完
  for (let k = 0; k < 5 && !env.view(0).hand.ended; k++) env.do(env.view(0).hand.turnSeat, 'game.fold');
  const chips2 = env.view(0).seats[2].chips;
  env.advance(8000); // u2 离线 11 秒，u1 离线 8 秒
  let v = env.view(0);
  assert.ok(v.hand.handNo >= 2, '开了下一局');
  assert.equal(v.seats[2], null, 'u2 被移出座位');
  assert.ok(v.seats[1], 'u1 还在座位上');
  assert.ok(v.hand.players.some((p) => p.seatIndex === 1), 'u1 参与本局');
  assert.ok(env.events().some((e) => e.kind === 'notice' && /N2 已离线，自动改为观战模式/.test(e.text)));
  // u2 回来坐下，积分不变
  env.room.setOnline('u2', true);
  env.sit(2);
  assert.equal(env.view(0).seats[2].chips, chips2);
});

test('开始一场时也会把离线超过 10 秒的入座者移出座位；不足 2 人则不能开始', () => {
  const env = makeEnv();
  env.seatPlayers(2);
  env.room.setOnline('u1', false);
  env.advance(11000);
  throwsCode(() => env.do(0, 'room.start'), 'NOT_ENOUGH_PLAYERS');
  assert.equal(env.view(0).seats[1], null);
});

test('额外领分：输光后开新一局自动补领一份初始积分，到上限为止；结算净输赢扣除补领', () => {
  const env = makeEnv({ cfg: { hands: 10, initialChips: 100, ante: 10, rebuyMax: 150 }, timing: { nextHandDelayMs: 1000 } });
  env.start(2);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  // 人为让 u1 输光
  env.room.seats[1].chips = 3;
  env.advance(1000);
  let v = env.view(0);
  assert.equal(v.hand.handNo, 2, '有额度时不会因为“输光”而结束本场');
  assert.equal(v.seats[1].rebuy, 100);
  assert.equal(v.seats[1].chips, 103 - 10, '补领 100 后再付底注 10');
  assert.ok(env.events().some((e) => e.kind === 'rebuy' && e.seat === 1 && e.amount === 100));
  assert.ok(env.events().some((e) => e.kind === 'notice' && /补领 100 积分（本场已领 100\/150）/.test(e.text)));
  // 再次输光：只剩 50 额度
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  if (!env.view(0).hand.ended) env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.room.seats[1].chips = 0;
  env.advance(1000);
  v = env.view(0);
  assert.equal(v.seats[1].rebuy, 150);
  assert.equal(v.seats[1].chips, 50 - 10);
  // 额度用完后再输光 → 其他人输光，本场结束；净输赢扣除补领
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  if (!env.view(0).hand.ended) env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.room.seats[1].chips = 0;
  env.advance(1000);
  v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.endReason, 'busted');
  const p1 = v.summary.players.find((p) => p.userId === 'u1');
  assert.equal(p1.rebuy, 150);
  assert.equal(p1.net, 0 - 100 - 150);
});

test('额外领分为 0（默认）时不补领', () => {
  const env = makeEnv({ cfg: { hands: 10, initialChips: 100, ante: 10 }, timing: { nextHandDelayMs: 1000 } });
  env.start(2);
  env.do(env.view(0).hand.turnSeat, 'game.fold');
  env.room.seats[1].chips = 3;
  env.advance(1000);
  assert.equal(env.view(0).phase, 'finished');
});

test('机器人：房主加机器人后可直接开局，机器人自动准备、自动出牌打完一局', () => {
  const env = makeEnv({ cfg: { hands: 2 }, timing: { nextHandDelayMs: 1000 } });
  env.join(0);
  env.sit(0);
  env.join(1);
  throwsCode(() => env.do(1, 'room.addBot', { seatIndex: 3 }), 'NOT_OWNER');
  env.do(0, 'room.addBot', { seatIndex: 3 });
  env.do(0, 'room.addBot', {}); // 不指定座位：坐第一个空位
  let v = env.view(0);
  const bots = v.seats.filter((s) => s && s.isBot);
  assert.equal(bots.length, 2);
  assert.ok(bots.every((b) => b.ready && /^🤖/.test(b.nickname)));
  throwsCode(() => env.do(0, 'room.addBot', { seatIndex: 3 }), 'SEAT_TAKEN');
  // 机器人不算在线人数
  assert.equal(env.room.onlineCount(), 2);
  env.do(0, 'room.start');
  v = env.view(0);
  assert.equal(v.phase, 'playing');
  assert.equal(v.hand.players.length, 3);
  // 推进时间：轮到机器人时它会自己出手；轮到真人就弃牌，直到打完两局
  for (let k = 0; k < 400 && env.view(0).phase === 'playing'; k++) {
    const h = env.view(0).hand;
    if (h && !h.ended && h.turnSeat === 0) env.do(0, 'game.fold');
    env.advance(500);
  }
  v = env.view(0);
  assert.equal(v.phase, 'finished');
  assert.equal(v.summary.handsPlayed, 2);
  // 机器人可以被踢
  const bot = v.seats.find((s) => s && s.isBot);
  env.do(0, 'room.kick', { userId: bot.userId });
  assert.equal(env.view(0).seats[bot.seatIndex], null);
});

test('机器人：快照往返后仍在线、仍是机器人；只剩机器人时房间算无人在线', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  env.do(0, 'room.addBot', { seatIndex: 1 });
  const snap = JSON.parse(JSON.stringify(env.room.toSnapshot()));
  const bm = snap.members.find((m) => m.isBot);
  assert.ok(bm);
  env.room.setOnline('u0', false);
  assert.equal(env.room.onlineCount(), 0);
  assert.notEqual(env.room.emptySince, null);
});

test('发牌动画：开局时第一位行动者的倒计时顺延发牌时长，人越多发得越久', () => {
  assert.ok(dealDurationMs(2) >= 2000);
  assert.ok(dealDurationMs(15) > dealDurationMs(6));
  assert.ok(dealDurationMs(15) <= 6000);
  const env = makeEnv({ timing: { dealMs: null } });
  env.start(3);
  const v = env.view(0);
  assert.equal(v.hand.turnDeadline - env.clock.t, v.config.actionSeconds * 1000 + dealDurationMs(3));
});
