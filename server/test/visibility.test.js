// 可见性：逐条覆盖 PROTOCOL.md 第 5 节清单
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, rigFrom, cardPaths } from './helpers.js';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, `应抛出 ${code}`);
const seatsOf = (v) => v.hand.visible.map((c) => c.seatIndex);

// 4 个玩家 + 1 个观战者 u9；庄家 s0，行动顺序 s1, s2, s3, s0；牌力 s0 > s1 > s2 > s3
function setup(cfg = {}, cards) {
  const env = makeEnv({ cfg: { compareAfterRound: 1, ...cfg }, rig: cards ? rigFrom(cards) : undefined });
  env.start(4);
  env.join(9);
  return env;
}
const allViews = (env) => [0, 1, 2, 3, 9].map((i) => ({ i, v: env.view(i) }));

test('清单 1：闷牌玩家（含本人）myCards 为 null，visible 为空，只有行动者有 actions', () => {
  const env = setup();
  for (const { i, v } of allViews(env)) {
    assert.equal(v.hand.myCards, null, `u${i} 不应收到牌`);
    assert.deepEqual(v.hand.visible, [], `u${i} visible 应为空`);
    assert.deepEqual(cardPaths(v), []);
  }
  assert.ok(env.view(1).hand.actions);
  assert.equal(env.view(2).hand.actions, null);
  assert.equal(env.view(9).hand.actions, null);
  assert.equal(env.view(9).hand.canLook, false);
  assert.equal(env.view(9).hand.canFold, false);
  assert.equal(env.view(1).hand.canLook, true);
});

test('看牌：只有看牌的本人收到自己的牌；seen 是公开信息', () => {
  const env = setup();
  env.do(2, 'game.look');
  const mine = env.view(2).hand.myCards;
  assert.deepEqual(mine.cards.map((c) => c.r), [10, 7, 5]);
  assert.equal(mine.type, 'sanpai');
  assert.equal(mine.label, '单张 10');
  assert.equal(mine.is235, false);
  for (const i of [0, 1, 3, 9]) {
    const v = env.view(i);
    assert.equal(v.hand.myCards, null);
    assert.deepEqual(v.hand.visible, []);
    assert.deepEqual(cardPaths(v), []);
    assert.equal(v.hand.players.find((p) => p.seatIndex === 2).seen, true);
  }
  assert.deepEqual(cardPaths(env.view(2)), ['hand.myCards']);
});

test('清单 2：比牌 —— 胜方看到负方，负方看到双方，其他人什么都看不到；胜方仍是闷牌', () => {
  const env = setup();
  for (let k = 0; k < 4; k++) env.do([1, 2, 3, 0][k], 'game.call');
  assert.equal(env.view(1).hand.round, 2);
  env.do(1, 'game.compare', { targetSeat: 2 }); // s1 对 s2：s1 胜
  const winner = env.view(1);
  assert.equal(winner.hand.myCards, null, '胜方仍是闷牌，看不到自己的牌');
  assert.deepEqual(seatsOf(winner), [2]);
  assert.equal(winner.hand.visible[0].type, 'sanpai');
  assert.equal(winner.hand.players.find((p) => p.seatIndex === 1).seen, false);

  const loser = env.view(2);
  assert.ok(loser.hand.myCards, '负方能看到自己的牌');
  assert.deepEqual(seatsOf(loser), [1], '负方能看到胜方的牌');
  assert.equal(loser.hand.players.find((p) => p.seatIndex === 2).state, 'lost');

  for (const i of [0, 3, 9]) {
    const v = env.view(i);
    assert.equal(v.hand.myCards, null);
    assert.deepEqual(v.hand.visible, []);
  }
  // 事件只有"谁和谁比、谁输"，没有牌面
  const ev = env.events().filter((e) => e.kind === 'compare');
  assert.deepEqual(ev, [{ kind: 'compare', fromSeat: 1, toSeat: 2, loserSeat: 2 }]);
});

test('清单 2：发起方输时，对方（胜方）看到发起方的牌', () => {
  const env = setup();
  for (let k = 0; k < 4; k++) env.do([1, 2, 3, 0][k], 'game.call');
  env.do(1, 'game.compare', { targetSeat: 0 }); // s1 对 s0：s1 输
  assert.deepEqual(seatsOf(env.view(0)), [1]);
  assert.deepEqual(seatsOf(env.view(1)), [0]);
  assert.ok(env.view(1).hand.myCards);
  assert.equal(env.view(0).hand.myCards, null);
});

test('清单 4：弃牌者的牌永远不进入其他人的 visible；本局结束后本人能看到自己的牌', () => {
  const env = setup();
  env.do(3, 'game.fold'); // 非本人回合弃牌
  assert.equal(env.view(3).hand.myCards, null, '闷牌弃牌，本局结束前不下发');
  for (const i of [0, 1, 2, 9]) assert.ok(!seatsOf(env.view(i)).includes(3));
  env.do(1, 'game.look');
  env.do(2, 'game.fold');
  env.do(0, 'game.fold'); // 只剩 s1 → 本局结束
  assert.equal(env.view(1).hand.ended, true);
  for (const i of [0, 1, 2, 3]) assert.ok(env.view(i).hand.myCards, `u${i} 本局结束后能看到自己的牌`);
  // 结束后依旧没有人能看到别人的牌（赢家是 NO_BONUS 牌型，也没有亮牌）
  for (const { v } of allViews(env)) assert.deepEqual(v.hand.visible, []);
  assert.deepEqual(env.view(3).hand.myCards.cards.map((c) => c.r), [9, 6, 4]);
});

test('清单 4：被比牌看到过的人事后弃牌，其牌也不再出现在他人的 visible 里', () => {
  const env = setup();
  for (let k = 0; k < 4; k++) env.do([1, 2, 3, 0][k], 'game.call');
  env.do(1, 'game.compare', { targetSeat: 2 });
  assert.deepEqual(seatsOf(env.view(2)), [1]);
  env.do(1, 'game.fold'); // 胜方 s1 轮外弃牌
  assert.deepEqual(seatsOf(env.view(2)), []);
});

test('清单 2：强制开牌 —— 所有在场玩家的牌对所有人可见（含观战者），弃牌者除外', () => {
  const env = setup({ maxRounds: 5 });
  env.do(0, 'game.fold'); // s0 弃牌（牌力最大，但不参与开牌）
  // 5 轮，每轮 s1, s2, s3 依次跟注
  for (let r = 0; r < 5; r++) for (const s of [1, 2, 3]) env.do(s, 'game.call');
  const v1 = env.view(1);
  assert.equal(v1.hand.ended, true);
  assert.equal(v1.hand.result.reason, 'showdown');
  assert.deepEqual(v1.hand.result.winners, [1]);
  assert.deepEqual(seatsOf(v1), [2, 3]);
  assert.deepEqual(seatsOf(env.view(2)), [1, 3]);
  assert.deepEqual(seatsOf(env.view(9)), [1, 2, 3]);
  assert.equal(env.view(9).hand.myCards, null, '观战者 myCards 永远为 null');
  assert.deepEqual(seatsOf(env.view(0)), [1, 2, 3], '弃牌者也能看到强制开牌的牌');
  assert.ok(env.view(0).hand.myCards);
  // 弃牌者 s0 的牌不在任何人的 visible 里
  for (const i of [1, 2, 3, 9]) assert.ok(!seatsOf(env.view(i)).includes(0));
});

test('清单 2/3：赢家亮牌 —— 局间所有人（含观战者）可见；非赢家不能亮', () => {
  const env = setup();
  env.do(2, 'game.fold');
  env.do(3, 'game.fold');
  env.do(0, 'game.fold');
  const v = env.view(1);
  assert.equal(v.hand.result.winners[0], 1);
  assert.equal(v.hand.result.showable, true);
  assert.equal(env.view(2).hand.result.showable, false);
  assert.equal(env.view(9).hand.result.showable, false);
  for (const { v: x } of allViews(env)) assert.deepEqual(x.hand.visible, []);
  throwsCode(() => env.do(2, 'game.show'), 'INVALID_ACTION');
  throwsCode(() => env.do(9, 'game.show'), 'INVALID_ACTION');
  env.do(1, 'game.show');
  assert.equal(env.view(1).hand.result.showable, false);
  for (const i of [0, 2, 3, 9]) assert.deepEqual(seatsOf(env.view(i)), [1]);
  assert.equal(env.view(9).hand.myCards, null);
  assert.ok(env.view(1).hand.log.some((l) => l.kind === 'show'));
});

test('清单 2/3：喜钱 —— 赢家是豹子时牌自动向所有人亮出', () => {
  const env = setup({}, ['4s 5h 9d', 'Ks Kh Kd', '10s 7h 5d', '9s 6h 4d']);
  env.do(2, 'game.fold');
  env.do(3, 'game.fold');
  env.do(0, 'game.fold');
  const r = env.view(9).hand.result;
  assert.deepEqual(r.winners, [1]);
  assert.equal(r.bonus.type, 'baozi');
  assert.equal(r.bonus.total, 3 * 5 * 10);
  for (const i of [0, 2, 3, 9]) {
    const v = env.view(i);
    assert.deepEqual(seatsOf(v), [1]);
    assert.equal(v.hand.visible[0].type, 'baozi');
    assert.equal(v.hand.visible[0].label, '豹子 K');
  }
  assert.equal(env.view(9).hand.myCards, null);
  // 赢家本人的牌在 myCards，visible 不重复
  assert.deepEqual(seatsOf(env.view(1)), []);
  assert.ok(env.view(1).hand.myCards);
  assert.equal(env.view(1).hand.result.showable, false, '喜钱已自动亮牌，不需要再亮');
});

test('清单 5：event 消息里没有牌面；牌面只出现在 hand.myCards / hand.visible', () => {
  const env = setup({ maxRounds: 5 }, ['4s 5h 9d', 'Ks Kh Kd', '10s 7h 5d', '9s 6h 4d']);
  // 玩一整局：比牌 + 全部跟注到强制开牌
  for (let k = 0; k < 4; k++) env.do([1, 2, 3, 0][k], 'game.call');
  env.do(1, 'game.look');
  env.do(1, 'game.compare', { targetSeat: 2 });
  env.do(3, 'game.call');
  env.do(0, 'game.call');
  for (let r = 0; r < 5 && !env.view(1).hand.ended; r++) {
    for (const s of [1, 3, 0]) if (!env.view(s).hand.ended && env.view(s).hand.turnSeat === s) env.do(s, 'game.call');
  }
  assert.equal(env.view(1).hand.ended, true);

  const events = env.sent.filter((s) => s.msg.type === 'event');
  assert.ok(events.length >= 3);
  for (const { msg } of events) {
    const text = JSON.stringify(msg);
    assert.deepEqual(cardPaths(msg), []);
    assert.ok(!/"cards"|"label"|"r":|"s":"[shcd]"/.test(text), `event 含牌面: ${text}`);
  }
  // 所有 state 里，牌面只出现在合法位置
  for (const { msg } of env.sent.filter((s) => s.msg.type === 'state')) {
    for (const p of cardPaths(msg.data)) assert.match(p, /^hand\.(myCards|visible\[\d+\])$/);
  }
  // 日志里没有牌型文字
  const log = JSON.stringify(env.view(9).hand.log);
  assert.ok(!/豹子|顺金|金花|顺子|对子|单张/.test(log));
});

test('清单 3：观战者（含入座等下一局的人）的 myCards 永远为 null，只看到公开部分', () => {
  const env = setup();
  env.join(8);
  env.sit(8, 7); // 本局开始后才入座
  assert.equal(env.view(8).seats[7].status, 'waitingNext');
  env.do(1, 'game.look');
  env.do(2, 'game.fold');
  env.do(3, 'game.fold');
  env.do(0, 'game.fold');
  assert.equal(env.view(8).hand.myCards, null);
  assert.deepEqual(env.view(8).hand.visible, []);
  assert.equal(env.view(8).hand.canFold, false);
  assert.equal(env.view(8).hand.actions, null);
  throwsCode(() => env.do(8, 'game.look'), 'INVALID_ACTION');
});

test('下发的 state 经 JSON 往返后结构完整，且对不同接收者各不相同', () => {
  const env = setup();
  env.do(2, 'game.look');
  const a = env.lastState('u2');
  const b = env.lastState('u1');
  assert.ok(a.hand.myCards);
  assert.equal(b.hand.myCards, null);
  assert.equal(typeof a.serverTime, 'number');
  assert.equal(a.seats.length, 15);
  assert.equal(a.me.userId, 'u2');
  assert.equal(a.me.seatIndex, 2);
});
