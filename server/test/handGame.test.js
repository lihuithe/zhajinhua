// 单局状态机
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { HandGame } from '../src/game/handGame.js';
import { parseCards } from '../src/game/cards.js';
import { getDefaults } from '../src/config.js';
import { LEGACY_CFG } from './helpers.js';

// 牌谱：默认 p0 最强 ... 依次递减（单张），便于预测胜负
const DEFAULT_CARDS = ['As Kh 9d', 'Qs Jh 8d', '10s 7h 5d', '9s 6h 4d', '8s 5h 3d', '7s 4h 2d'];

/**
 * 创建一局。座位 0..n-1，userId 为 u0..；庄家默认是最后一个座位，所以 s0 先行动。
 * chips: 数字或数组
 */
function mk({ n = 3, chips = 1000, cfg = {}, cards = DEFAULT_CARDS, dealer, actionMs = 20000 } = {}) {
  const clock = { t: 1_000_000 };
  const config = { ...getDefaults(), ...LEGACY_CFG, ante: 10, ...cfg };
  const players = Array.from({ length: n }, (_, i) => ({
    seatIndex: i,
    userId: `u${i}`,
    nickname: `P${i}`,
    chips: Array.isArray(chips) ? chips[i] : chips,
  }));
  const rig = {};
  for (let i = 0; i < n; i++) rig[i] = parseCards(cards[i]);
  const g = new HandGame({
    config,
    players,
    dealerSeat: dealer ?? n - 1,
    handNo: 1,
    now: () => clock.t,
    actionMs,
    cards: rig,
  });
  return { g, clock, config };
}
const chipsOf = (g) => g.players.map((p) => p.chips);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, `应抛出 ${code}`);

test('开局：支付底注，庄家下一位先行动，所有人闷牌', () => {
  const { g } = mk({ n: 4, dealer: 1 });
  assert.equal(g.pot, 40);
  assert.deepEqual(chipsOf(g), [990, 990, 990, 990]);
  assert.equal(g.order[0].seatIndex, 2);
  assert.equal(g._turnPlayer().seatIndex, 2);
  assert.equal(g.round, 1);
  assert.ok(g.players.every((p) => !p.seen));
  assert.equal(g.currentBet, 10);
});

test('闷 / 明价格：seenMultiplier=3（重庆）闷跟 10，明跟 30', () => {
  const { g } = mk({ cfg: { seenMultiplier: 3 } });
  g.call(0); // 闷，付 10
  assert.equal(g.players[0].chips, 980);
  g.look(1);
  const v = g.view('u1');
  assert.deepEqual(v.actions.call, { cost: 30 });
  g.call(1); // 明，付 30
  assert.equal(g.players[1].chips, 960);
  assert.equal(g.pot, 30 + 10 + 30);
  assert.equal(g.players[1].bet, 40);
});

test('加注档位与封顶：to = ante×step，且 currentBet < to ≤ ante×cap', () => {
  const { g } = mk({ cfg: { raiseSteps: [2, 5, 10], capMultiple: 10, seenMultiplier: 2 } });
  assert.deepEqual(
    g.view('u0').actions.raise,
    [
      { to: 20, cost: 20 },
      { to: 50, cost: 50 },
      { to: 100, cost: 100 },
    ],
  );
  throwsCode(() => g.raise(0, 30), 'INVALID_ACTION'); // 不是档位
  throwsCode(() => g.raise(0, 10), 'INVALID_ACTION'); // 不高于当前单注
  throwsCode(() => g.raise(0, 0), 'INVALID_ACTION');
  throwsCode(() => g.raise(0, '20'), 'INVALID_ACTION');
  throwsCode(() => g.raise(0, 200), 'INVALID_ACTION'); // 超过封顶
  g.raise(0, 50);
  assert.equal(g.currentBet, 50);
  assert.equal(g.players[0].chips, 1000 - 10 - 50);
  // 下一位：只剩 100 档
  assert.deepEqual(g.view('u1').actions.raise, [{ to: 100, cost: 100 }]);
  g.look(1);
  // 明牌：跟注 50×2；加注到 100 付 200
  assert.deepEqual(g.view('u1').actions.call, { cost: 100 });
  assert.deepEqual(g.view('u1').actions.raise, [{ to: 100, cost: 200 }]);
  g.raise(1, 100);
  assert.equal(g.currentBet, 100);
  assert.equal(g.players[1].chips, 1000 - 10 - 200);
  // 已到封顶：不能再加
  assert.deepEqual(g.view('u2').actions.raise, []);
  throwsCode(() => g.raise(2, 100), 'INVALID_ACTION');
});

test('加注档位按底注倍数换算，付不起的档位不列出，强行加注报积分不足', () => {
  const { g } = mk({ chips: [60, 1000, 1000], cfg: { ante: 10 } });
  // p0 剩 50：能付 20、50，付不起 100
  assert.deepEqual(g.view('u0').actions.raise, [
    { to: 20, cost: 20 },
    { to: 50, cost: 50 },
  ]);
  throwsCode(() => g.raise(0, 100), 'INSUFFICIENT_CHIPS');
});

test('轮次计数：位置不大于上一个行动者时 round+1，弃牌者被跳过', () => {
  const { g } = mk({ n: 4 });
  const seq = [];
  const act = () => {
    const t = g._turnPlayer();
    seq.push([t.seatIndex, g.round]);
    return t.seatIndex;
  };
  g.call(act());
  g.call(act());
  g.call(act());
  g.call(act());
  // 第二轮开始
  assert.equal(g.round, 2);
  assert.deepEqual(seq, [[0, 1], [1, 1], [2, 1], [3, 1]]);
  g.fold(act()); // s0 在第 2 轮弃牌
  assert.equal(g._turnPlayer().seatIndex, 1);
  assert.equal(g.round, 2);
  g.call(1);
  g.call(2);
  g.call(3);
  // s0 已弃牌，回到 s1：位置小于上一个行动者 => 第 3 轮
  assert.equal(g._turnPlayer().seatIndex, 1);
  assert.equal(g.round, 3);
});

test('轮次计数：最后一位弃牌 / 比牌出局后正确进入下一轮', () => {
  const { g } = mk({ n: 3, cfg: { compareAfterRound: 1 } });
  g.call(0);
  g.call(1);
  g.fold(2); // s2 轮到时弃牌
  assert.equal(g._turnPlayer().seatIndex, 0);
  assert.equal(g.round, 2);
  g.call(0);
  // s1 比牌 s0 → s1 的牌小，s1 输（发起方 vs 更强的 s0）
  g.compare(1, 0);
  assert.equal(g.ended, true); // 只剩 s0
  assert.deepEqual(g.result.winners, [0]);
  assert.equal(g.result.reason, 'lastStanding');
});

test('非本人回合弃牌：回合不变；其他操作报 NOT_YOUR_TURN', () => {
  const { g } = mk({ n: 4 });
  throwsCode(() => g.call(1), 'NOT_YOUR_TURN');
  throwsCode(() => g.raise(2, 20), 'NOT_YOUR_TURN');
  throwsCode(() => g.compare(3, 0), 'NOT_YOUR_TURN');
  throwsCode(() => g.allIn(1), 'NOT_YOUR_TURN');
  g.fold(2); // 不是他的回合，也能弃牌
  assert.equal(g.players[2].state, 'folded');
  assert.equal(g._turnPlayer().seatIndex, 0);
  assert.equal(g.round, 1);
  g.call(0);
  g.call(1);
  // 跳过已弃牌的 s2，直接到 s3
  assert.equal(g._turnPlayer().seatIndex, 3);
  // 已弃牌的人不能再操作
  throwsCode(() => g.fold(2), 'INVALID_ACTION');
  throwsCode(() => g.look(2), 'INVALID_ACTION');
});

test('不在本局中的人（座位不存在）无法操作', () => {
  const { g } = mk({ n: 3 });
  throwsCode(() => g.fold(9), 'INVALID_ACTION');
  throwsCode(() => g.look(9), 'INVALID_ACTION');
});

test('比牌条件：round > compareAfterRound', () => {
  for (const after of [1, 2, 3]) {
    const { g } = mk({ n: 3, cfg: { compareAfterRound: after } });
    // 打到第 after+1 轮之前，比牌一律不可用
    for (let r = 1; r <= after; r++) {
      assert.equal(g.round, r);
      assert.equal(g.view(`u${g._turnPlayer().seatIndex}`).actions.compare, null);
      throwsCode(() => g.compare(g._turnPlayer().seatIndex, (g._turnPlayer().seatIndex + 1) % 3), 'INVALID_ACTION');
      for (let i = 0; i < 3; i++) g.call(g._turnPlayer().seatIndex);
    }
    assert.equal(g.round, after + 1);
    const a = g.view(`u${g._turnPlayer().seatIndex}`).actions;
    assert.ok(a.compare);
    assert.equal(a.compare.cost, 10);
    assert.deepEqual(a.compare.targets.length, 2);
  }
});

test('blindCanCompare=false：闷牌不能主动比牌，看牌后可以', () => {
  const { g } = mk({ n: 3, cfg: { blindCanCompare: false } });
  for (let i = 0; i < 3; i++) g.call(g._turnPlayer().seatIndex);
  assert.equal(g.view('u0').actions.compare, null);
  throwsCode(() => g.compare(0, 1), 'INVALID_ACTION');
  g.look(0);
  assert.ok(g.view('u0').actions.compare);
  g.compare(0, 1);
  assert.equal(g.players[0].state, 'active'); // p0 最强，赢了
  assert.equal(g.players[1].state, 'lost');
});

test('compareCost：比牌费用 = 当前价 × compareCost（含明牌倍率）', () => {
  const { g } = mk({ n: 3, cfg: { compareCost: 2, seenMultiplier: 3, compareAfterRound: 1 } });
  for (let i = 0; i < 3; i++) g.call(g._turnPlayer().seatIndex);
  // 闷牌：10 × 2
  assert.deepEqual(g.view('u0').actions.compare.cost, 20);
  g.look(0);
  // 明牌：10 × 3 × 2
  assert.deepEqual(g.view('u0').actions.compare.cost, 60);
  const before = g.players[0].chips;
  g.compare(0, 1);
  assert.equal(before - g.players[0].chips, 60);
});

test('比牌：输者出局；比牌后胜方仍是闷牌，不下发其牌；负方可见双方', () => {
  const { g } = mk({ n: 3, cfg: { compareAfterRound: 1 } });
  for (let i = 0; i < 3; i++) g.call(g._turnPlayer().seatIndex);
  g.compare(0, 1); // s0 (AKx) 赢 s1
  assert.equal(g.players[1].state, 'lost');
  assert.equal(g.players[0].seen, false);
  // 胜方仍然闷牌，之后按闷牌价
  assert.equal(g.view('u0').myCards, null);
  assert.deepEqual(g.view('u0').visible.map((c) => c.seatIndex), [1]);
  // 负方看到自己的和胜方的牌
  const lv = g.view('u1');
  assert.ok(lv.myCards);
  assert.deepEqual(lv.visible.map((c) => c.seatIndex), [0]);
  // 旁观的 s2 什么也看不到
  assert.equal(g.view('u2').myCards, null);
  assert.deepEqual(g.view('u2').visible, []);
  // 被淘汰的玩家不能再操作
  throwsCode(() => g.call(1), 'INVALID_ACTION');
  // 比牌事件
  assert.deepEqual(g.drainEvents(), [{ kind: 'compare', fromSeat: 0, toSeat: 1, loserSeat: 1 }]);
  // 胜方下一轮仍按闷牌价
  g.call(2);
  assert.equal(g._turnPlayer().seatIndex, 0);
  assert.deepEqual(g.view('u0').actions.call, { cost: 10 });
});

test('比牌平局：发起比牌的一方输（challengerLoses）', () => {
  const { g } = mk({ n: 3, cards: ['As Kh 9d', 'Ah Ks 9c', '4s 3h 2d'], cfg: { tieRule: 'challengerLoses' } });
  for (let i = 0; i < 3; i++) g.call(g._turnPlayer().seatIndex);
  g.compare(0, 1);
  assert.equal(g.players[0].state, 'lost');
  assert.equal(g.players[1].state, 'active');
});

test('孤注一掷成功：赢所有人，本局结束 reason=allIn', () => {
  // s0 积分很少，但牌最大
  const { g } = mk({ n: 3, chips: [15, 1000, 1000], cfg: { shortStack: 'allIn' } });
  // p0 付完底注剩 5，跟注需要 10
  assert.deepEqual(g.view('u0').actions, { call: null, raise: [], raiseRange: null, compare: null, allIn: { cost: 5 } });
  throwsCode(() => g.call(0), 'INSUFFICIENT_CHIPS');
  g.allIn(0);
  assert.equal(g.ended, true);
  assert.equal(g.result.reason, 'allIn');
  assert.deepEqual(g.result.winners, [0]);
  assert.equal(g.players[0].chips, 15 - 10 - 5 + (10 + 10 + 10 + 5));
  assert.equal(g.players[0].allIn, true);
  assert.deepEqual(g.drainEvents(), [{ kind: 'allIn', seat: 0, success: true }]);
  // 赢家看到所有人的牌，输家看到双方
  assert.deepEqual(g.view('u0').visible.map((c) => c.seatIndex), [1, 2]);
  assert.deepEqual(g.view('u1').visible.map((c) => c.seatIndex), [0]);
});

test('孤注一掷失败：只有他出局，其他人不受影响，牌局继续', () => {
  const { g } = mk({ n: 3, chips: [1000, 1000, 15], cards: DEFAULT_CARDS, dealer: 1 });
  // 庄家 s1，行动顺序 s2, s0, s1。s2 剩 5 个积分，牌最小
  assert.equal(g._turnPlayer().seatIndex, 2);
  g.allIn(2);
  assert.equal(g.ended, false);
  assert.equal(g.players[2].state, 'lost');
  assert.equal(g.players[2].chips, 0);
  assert.equal(g.players[0].state, 'active');
  assert.equal(g.players[1].state, 'active');
  assert.equal(g.pot, 30 + 5);
  assert.deepEqual(g.drainEvents(), [{ kind: 'allIn', seat: 2, success: false }]);
  // 败给第一个比他强的人（行动顺序上的下一位 s0），仅暴露这一对
  assert.deepEqual(g.view('u0').visible.map((c) => c.seatIndex), [2]);
  assert.deepEqual(g.view('u2').visible.map((c) => c.seatIndex), [0]);
  assert.deepEqual(g.view('u1').visible, []);
  // 回合交给下一位
  assert.equal(g._turnPlayer().seatIndex, 0);
});

test('孤注一掷平局按发起比牌者处理（发起者输）', () => {
  const { g } = mk({ n: 2, chips: [15, 1000], cards: ['As Kh 9d', 'Ah Ks 9c'], dealer: 1 });
  g.allIn(0);
  assert.equal(g.players[0].state, 'lost');
  assert.equal(g.ended, true); // 只剩一个人
  assert.equal(g.result.reason, 'lastStanding');
});

test('shortStack=foldOnly：积分不足以跟注时只能弃牌', () => {
  const { g } = mk({ n: 3, chips: [15, 1000, 1000], cfg: { shortStack: 'foldOnly' } });
  const a = g.view('u0').actions;
  assert.equal(a.call, null);
  assert.equal(a.allIn, null);
  assert.equal(a.compare, null);
  assert.deepEqual(a.raise, []);
  throwsCode(() => g.allIn(0), 'INVALID_ACTION');
  throwsCode(() => g.call(0), 'INSUFFICIENT_CHIPS');
  g.fold(0);
  assert.equal(g.players[0].state, 'folded');
});

test('孤注一掷：积分够跟注时不能用', () => {
  const { g } = mk({ n: 3 });
  throwsCode(() => g.allIn(0), 'INVALID_ACTION');
  assert.equal(g.view('u0').actions.allIn, null);
});

test('明牌玩家积分够闷价但不够明价：只能孤注一掷', () => {
  const { g } = mk({ n: 3, chips: [25, 1000, 1000], cfg: { seenMultiplier: 3 } });
  // 剩 15，闷跟 10 够；看牌后明跟 30 不够
  assert.ok(g.view('u0').actions.call);
  assert.equal(g.view('u0').actions.allIn, null);
  g.look(0);
  const a = g.view('u0').actions;
  assert.equal(a.call, null);
  assert.deepEqual(a.allIn, { cost: 15 });
});

test('maxRounds：第 N 轮全部行动完毕后强制开牌，所有在场玩家亮牌', () => {
  const { g } = mk({ n: 3, cfg: { maxRounds: 2 } });
  for (let i = 0; i < 5; i++) g.call(g._turnPlayer().seatIndex);
  assert.equal(g.ended, false);
  assert.equal(g.round, 2);
  g.call(g._turnPlayer().seatIndex); // 第 2 轮最后一位
  assert.equal(g.ended, true);
  assert.equal(g.result.reason, 'showdown');
  assert.deepEqual(g.result.winners, [0]);
  for (const id of ['u0', 'u1', 'u2']) {
    const v = g.view(id);
    assert.equal(v.visible.length, 2);
    assert.ok(v.myCards);
  }
  // 旁观者（不在本局）也能看到全部
  assert.equal(g.view('nobody').visible.length, 3);
  assert.equal(g.view('nobody').myCards, null);
  assert.equal(g.round, 2); // 不会进入第 3 轮
});

test('maxRounds 强制开牌：弃牌者不参与，也不亮牌', () => {
  const { g } = mk({ n: 3, cfg: { maxRounds: 1 } });
  g.fold(0); // s0（最强）弃牌
  g.call(1);
  g.call(2);
  assert.equal(g.ended, true);
  assert.equal(g.result.reason, 'showdown');
  assert.deepEqual(g.result.winners, [1]);
  assert.deepEqual(g.view('u2').visible.map((c) => c.seatIndex), [1]); // 不含弃牌的 s0
  assert.deepEqual(g.view('nobody').visible.map((c) => c.seatIndex), [1, 2]);
});

test('强制开牌完全相同：并列者平分底池，余数给行动顺序最靠前的', () => {
  // ante 5：3 人，底池 15。s1 与 s2 牌完全相同（点数），s0 较小
  const { g } = mk({
    n: 3,
    cfg: { maxRounds: 1, ante: 5, tieRule: 'challengerLoses' },
    cards: ['8s 3h 2d', 'As Kh 9d', 'Ah Ks 9c'],
  });
  g.fold(0);
  g.call(1);
  g.call(2);
  // 底池 15 + 5 + 5 = 25，两人平分：各 12，余数 1 给行动顺序靠前的 s1
  assert.equal(g.result.reason, 'showdown');
  assert.deepEqual(g.result.winners, [1, 2]);
  assert.equal(g.result.potWon, 12);
  assert.deepEqual(chipsOf(g), [1000 - 5, 1000 - 10 + 13, 1000 - 10 + 12]);
  assert.equal(g.players.reduce((a, p) => a + p.chips, 0), 3000);
  assert.equal(g.players[1].state, 'won');
  assert.equal(g.players[2].state, 'won');
  // 平分时不触发喜钱
  assert.equal(g.result.bonus, null);
});

test('maxRounds 强制开牌在 tieRule=suit 下用花色分出胜负', () => {
  const { g } = mk({
    n: 2,
    cfg: { maxRounds: 1, tieRule: 'suit' },
    cards: ['Ah Ks 9c', 'As Kh 9d'],
  });
  g.call(0);
  g.call(1);
  assert.deepEqual(g.result.winners, [1]);
});

test('喜钱：豹子赢家，其他每位参与者付 ante×bonusBaozi', () => {
  const { g } = mk({
    n: 4,
    chips: [1000, 1000, 1000, 1000],
    cfg: { ante: 10, bonusBaozi: 10, bonusShunjin: 5 },
    cards: ['As Ah Ad', '2s 5h 9d', '3s 6h 9c', '4s 7h Kd'],
  });
  g.fold(1);
  g.fold(2);
  g.fold(3);
  assert.equal(g.result.reason, 'lastStanding');
  assert.deepEqual(g.result.bonus, { seatIndex: 0, type: 'baozi', total: 300 });
  assert.deepEqual(chipsOf(g), [1000 + 30 + 300, 1000 - 10 - 100, 1000 - 10 - 100, 1000 - 10 - 100]);
  assert.deepEqual(g.result.deltas.map((d) => d.delta), [330, -110, -110, -110]);
  // 触发喜钱，赢家的牌向所有人亮出，包括旁观者
  assert.deepEqual(g.view('nobody').visible.map((c) => c.seatIndex), [0]);
  assert.deepEqual(g.view('u2').visible.map((c) => c.seatIndex), [0]);
});

test('喜钱：顺金按 bonusShunjin；积分不足的付光为止；总积分守恒', () => {
  const { g } = mk({
    n: 3,
    chips: [1000, 30, 1000],
    cfg: { ante: 10, bonusShunjin: 5 },
    cards: ['5h 6h 7h', '2s 5h 9d', '3s 6h 9c'],
  });
  g.fold(1);
  g.fold(2);
  assert.equal(g.result.bonus.type, 'shunjin');
  // s1 剩 20，要付 50 → 付光 20；s2 付 50
  assert.equal(g.result.bonus.total, 20 + 50);
  assert.equal(g.players[1].chips, 0);
  assert.equal(g.players[2].chips, 1000 - 10 - 50);
  assert.equal(chipsOf(g).reduce((a, b) => a + b, 0), 2030);
});

test('喜钱：bonusEnabled=false 或金额为 0 时不触发，不亮牌', () => {
  for (const cfg of [{ bonusEnabled: false }, { bonusBaozi: 0 }]) {
    const { g } = mk({ n: 3, cfg, cards: ['As Ah Ad', '2s 5h 9d', '3s 6h 9c'] });
    g.fold(1);
    g.fold(2);
    assert.equal(g.result.bonus, null);
    assert.deepEqual(g.view('u1').visible, []);
    assert.deepEqual(g.view('nobody').visible, []);
  }
});

test('喜钱：普通牌型赢家不触发', () => {
  const { g } = mk({ n: 3, cards: ['As Ah 3d', '2s 5h 9d', '3s 6h 9c'] });
  g.fold(1);
  g.fold(2);
  assert.equal(g.result.bonus, null);
});

test('喜钱：孤注一掷赢家拿豹子同样触发；赢家积分变化包含喜钱', () => {
  const { g } = mk({
    n: 3,
    chips: [15, 1000, 1000],
    cfg: { ante: 10, bonusBaozi: 2 },
    cards: ['As Ah Ad', '2s 5h 9d', '3s 6h 9c'],
  });
  g.allIn(0);
  assert.equal(g.result.reason, 'allIn');
  assert.deepEqual(g.result.bonus, { seatIndex: 0, type: 'baozi', total: 40 });
  assert.equal(g.players[0].chips, 15 - 10 - 5 + 35 + 40);
});

test('作废退款：每人退回本局已下的全部积分（含底注），积分守恒', () => {
  const { g } = mk({ n: 3, cfg: { seenMultiplier: 2 } });
  g.call(0);
  g.look(1);
  g.raise(1, 50); // 明牌，付 100
  g.call(2);
  g.void();
  assert.equal(g.ended, true);
  assert.equal(g.result.reason, 'voided');
  assert.deepEqual(g.result.winners, []);
  assert.deepEqual(chipsOf(g), [1000, 1000, 1000]);
  assert.deepEqual(g.result.deltas.map((d) => d.delta), [0, 0, 0]);
  assert.equal(g.result.bonus, null);
  assert.equal(g.view('u0').result.showable, false);
  throwsCode(() => g.show('u0'), 'INVALID_ACTION');
});

test('超时 fold：到点自动弃牌，标记 timedOut', () => {
  const { g, clock } = mk({ n: 3, actionMs: 20000, cfg: { timeoutAction: 'fold' } });
  assert.equal(g.turnDeadline, clock.t + 20000);
  clock.t += 19999;
  assert.equal(g.tick(), false);
  clock.t += 1;
  assert.equal(g.tick(), true);
  assert.equal(g.players[0].state, 'folded');
  assert.equal(g.players[0].timedOut, true);
  assert.equal(g._turnPlayer().seatIndex, 1);
  assert.equal(g.turnDeadline, clock.t + 20000);
  assert.ok(g.log.some((l) => l.kind === 'timeout'));
});

test('超时 call：自动跟注；积分不够时改为弃牌', () => {
  const { g, clock } = mk({ n: 3, chips: [1000, 15, 1000], cfg: { timeoutAction: 'call' } });
  clock.t += 20000;
  g.tick(); // s0 自动跟注
  assert.equal(g.players[0].state, 'active');
  assert.equal(g.players[0].bet, 20);
  assert.equal(g.players[0].timedOut, true);
  clock.t += 20000;
  g.tick(); // s1 积分 5，不够跟注 10 => 弃牌
  assert.equal(g.players[1].state, 'folded');
  assert.equal(g.players[1].timedOut, true);
});

test('超时导致只剩一人时结束本局', () => {
  const { g, clock } = mk({ n: 2 });
  g.fold(1);
  assert.equal(g.ended, true);
  clock.t += 100000;
  assert.equal(g.tick(), false);
});

test('look：幂等，之后按明牌价；已结束或已出局不能看', () => {
  const { g } = mk({ n: 3, cfg: { seenMultiplier: 2 } });
  g.look(0);
  g.look(0);
  assert.equal(g.log.filter((l) => l.kind === 'look').length, 1);
  assert.deepEqual(g.view('u0').actions.call, { cost: 20 });
  assert.ok(g.view('u0').myCards);
  assert.equal(g.view('u0').canLook, false);
  assert.equal(g.view('u1').canLook, true);
  g.fold(1);
  assert.equal(g.view('u1').canLook, false);
  assert.equal(g.view('u1').canFold, false);
});

test('亮牌：只有赢家能在本局结束后亮牌，一次有效', () => {
  const { g } = mk({ n: 3 });
  throwsCode(() => g.show('u0'), 'INVALID_ACTION'); // 未结束
  g.fold(1);
  g.fold(2);
  assert.equal(g.result.winners[0], 0);
  assert.equal(g.view('u0', true).result.showable, true);
  assert.equal(g.view('u0', false).result.showable, false);
  assert.equal(g.view('u1', true).result.showable, false);
  throwsCode(() => g.show('u1'), 'INVALID_ACTION');
  g.show('u0');
  assert.equal(g.view('u0', true).result.showable, false);
  assert.deepEqual(g.view('u1').visible.map((c) => c.seatIndex), [0]);
  throwsCode(() => g.show('u0'), 'INVALID_ACTION');
});

test('结束后的操作一律被拒绝', () => {
  const { g } = mk({ n: 2 });
  g.fold(0);
  for (const f of [() => g.call(1), () => g.fold(1), () => g.look(1), () => g.raise(1, 20), () => g.compare(1, 0)]) {
    throwsCode(f, 'INVALID_ACTION');
  }
});

test('日志：最多 100 条，不含牌面信息', () => {
  const { g } = mk({ n: 3, cfg: { maxRounds: 50 }, chips: 1_000_000 });
  for (let i = 0; i < 120; i++) g.call(g._turnPlayer().seatIndex);
  assert.equal(g.log.length, 100);
  const text = JSON.stringify(g.log);
  assert.ok(!/"cards"|豹子|顺金|金花|顺子|对子|单张/.test(text));
  assert.ok(g.log.every((l) => typeof l.text === 'string' && typeof l.t === 'number'));
});

// ---------------- 随机对局：不变量 ----------------

test('随机对局不变量：积分永不为负、总积分守恒、赢家合法', () => {
  const rnd = (n) => randomInt(n);
  for (let iter = 0; iter < 400; iter++) {
    const n = 2 + rnd(5);
    const chips = Array.from({ length: n }, () => 10 + rnd(300));
    const cfg = {
      ante: 5 + rnd(6),
      seenMultiplier: 1 + rnd(5),
      maxRounds: 1 + rnd(4),
      compareAfterRound: 1 + rnd(3),
      compareCost: 1 + rnd(2),
      blindCanCompare: rnd(2) === 0,
      shortStack: rnd(2) ? 'allIn' : 'foldOnly',
      timeoutAction: rnd(2) ? 'call' : 'fold',
      bonusEnabled: rnd(2) === 0,
      tieRule: rnd(2) ? 'suit' : 'challengerLoses',
    };
    cfg.ante = Math.min(cfg.ante, Math.min(...chips));
    // 随机牌（不用 rig）
    const clock = { t: 0 };
    const config = { ...getDefaults(), ...LEGACY_CFG, ...cfg };
    const players = chips.map((c, i) => ({ seatIndex: i * 2, userId: `u${i}`, nickname: `P${i}`, chips: c }));
    const g = new HandGame({ config, players, dealerSeat: players[rnd(n)].seatIndex, handNo: 1, now: () => clock.t, actionMs: 1000 });
    const total = chips.reduce((a, b) => a + b, 0);
    let steps = 0;
    while (!g.ended && steps++ < 500) {
      const t = g._turnPlayer();
      const v = g.view(t.userId);
      const roll = rnd(10);
      try {
        if (roll === 0) g.look(t.seatIndex);
        else if (roll === 1) g.fold(t.seatIndex);
        else if (roll === 2 && v.actions.raise.length) g.raise(t.seatIndex, v.actions.raise[rnd(v.actions.raise.length)].to);
        else if (roll === 3 && v.actions.compare) g.compare(t.seatIndex, v.actions.compare.targets[rnd(v.actions.compare.targets.length)]);
        else if (roll === 4) {
          // 非本人回合弃牌
          const other = g.players.filter((p) => p.state === 'active' && p !== t);
          if (other.length) g.fold(other[rnd(other.length)].seatIndex);
        } else if (roll === 5) {
          clock.t += 1000;
          g.tick();
        } else if (v.actions.call) g.call(t.seatIndex);
        else if (v.actions.allIn) g.allIn(t.seatIndex);
        else g.fold(t.seatIndex);
      } catch (e) {
        assert.ok(e.code, `非业务错误：${e.stack}`);
      }
      for (const p of g.players) assert.ok(p.chips >= 0 && Number.isInteger(p.chips), '积分不能为负');
      assert.equal(
        g.players.reduce((a, p) => a + p.chips, 0) + (g.ended ? 0 : g.pot),
        total,
        '总积分守恒',
      );
    }
    if (!g.ended) g.void();
    assert.equal(g.players.reduce((a, p) => a + p.chips, 0), total);
    assert.equal(g.result.deltas.reduce((a, d) => a + d.delta, 0), 0);
    for (const p of g.players) assert.ok(p.chips >= 0);
    for (const w of g.result.winners) assert.equal(g.bySeat.get(w).state, 'won');
  }
});

test('自由加注：任意整数，高于当前单注、不超过封顶；按积分和明牌倍率给出可加范围', () => {
  const { g } = mk({ n: 3, cfg: { raiseMode: 'free', capMultiple: 10, seenMultiplier: 2 }, chips: [1000, 1000, 1000] });
  // s0 闷牌：当前单注 10（底注），可加到 11–100
  let a = g.view('u0').actions;
  assert.deepEqual(a.raiseRange, { min: 11, max: 100, mult: 1 });
  assert.deepEqual(a.raise.map((r) => r.to), [20, 50, 100], '快捷档位仍然给出');
  throwsCode(() => g.raise(0, 10), 'INVALID_ACTION');
  throwsCode(() => g.raise(0, 101), 'INVALID_ACTION');
  throwsCode(() => g.raise(0, 12.5), 'INVALID_ACTION');
  g.raise(0, 13);
  assert.equal(g.currentBet, 13);
  // s1 看牌后按明牌价：可加到的上限受积分限制（990 / 2 = 495 → 封顶 100）
  g.look(1);
  a = g.view('u1').actions;
  assert.deepEqual(a.raiseRange, { min: 14, max: 100, mult: 2 });
  g.raise(1, 37);
  assert.equal(g.currentBet, 37);
  assert.equal(g.players[1].chips, 990 - 74);
});

test('自由加注：积分不够时可加范围收窄或为空；档位模式下不给范围、也不接受任意金额', () => {
  const { g } = mk({ n: 2, cfg: { raiseMode: 'free' }, chips: [40, 1000] });
  // s0 剩 30：最多加到 30
  assert.deepEqual(g.view('u0').actions.raiseRange, { min: 11, max: 30, mult: 1 });
  const s = mk({ n: 2, cfg: { raiseMode: 'steps' } });
  assert.equal(s.g.view('u0').actions.raiseRange, null);
  throwsCode(() => s.g.raise(0, 13), 'INVALID_ACTION');
});
