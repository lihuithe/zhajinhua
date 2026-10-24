// 牌型判定与比较
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDeck, parseCards, shuffle } from '../src/game/cards.js';
import { evaluate, compareHands, bestIndexes, handLabel } from '../src/game/hand.js';
import { getDefaults } from '../src/config.js';

const cfg = (o = {}) => ({ ...getDefaults(), ...o });
const ev = (str, c = cfg()) => evaluate(parseCards(str), c);
// 1 = 前者赢，-1 = 后者赢，0 = 平
const cmp = (a, b, c = cfg(), challenger = null) => compareHands(ev(a, c), ev(b, c), c, challenger);

test('穷举 22100 种组合，a23=lowest 下各牌型数量正确', () => {
  const deck = newDeck();
  const counts = { baozi: 0, shunjin: 0, jinhua: 0, shunzi: 0, duizi: 0, sanpai: 0 };
  let total = 0;
  const c = cfg({ a23: 'lowest' });
  for (let i = 0; i < 52; i++)
    for (let j = i + 1; j < 52; j++)
      for (let k = j + 1; k < 52; k++) {
        counts[evaluate([deck[i], deck[j], deck[k]], c).type]++;
        total++;
      }
  assert.equal(total, 22100);
  assert.deepEqual(counts, { baozi: 52, shunjin: 48, jinhua: 1096, shunzi: 720, duizi: 3744, sanpai: 16440 });
});

test('a23=none 时 A23 不算顺子 / 顺金，各牌型数量相应变化', () => {
  const deck = newDeck();
  const counts = { baozi: 0, shunjin: 0, jinhua: 0, shunzi: 0, duizi: 0, sanpai: 0 };
  const c = cfg({ a23: 'none' });
  for (let i = 0; i < 52; i++)
    for (let j = i + 1; j < 52; j++)
      for (let k = j + 1; k < 52; k++) counts[evaluate([deck[i], deck[j], deck[k]], c).type]++;
  // 少了 4 种花色的 A23 顺金（4）和 60 个 A23 顺子（4*4*4-4）
  assert.deepEqual(counts, { baozi: 52, shunjin: 44, jinhua: 1100, shunzi: 660, duizi: 3744, sanpai: 16500 });
});

test('牌型大小：豹子 > 顺金 > 金花 > 顺子 > 对子 > 单张', () => {
  const seq = ['9s 9h 9d', '5h 6h 7h', 'Ah 9h 3h', '5s 6h 7d', 'As Ah 3d', 'As Kh 9d'];
  for (let i = 0; i < seq.length - 1; i++) assert.equal(cmp(seq[i], seq[i + 1]), 1, `${seq[i]} 应大于 ${seq[i + 1]}`);
});

test('KA2 永远不是顺子；QKA 是最大顺子', () => {
  for (const mode of ['lowest', 'second', 'none']) {
    assert.equal(ev('Ks As 2d', cfg({ a23: mode })).type, 'sanpai');
    assert.equal(ev('Kh Ah 2h', cfg({ a23: mode })).type, 'jinhua');
    assert.equal(cmp('Qs Kh Ad', 'Js Qh Kd', cfg({ a23: mode })), 1);
    assert.equal(cmp('Qs Kh Ad', 'As 2h 3d', cfg({ a23: mode })), 1);
  }
});

test('a23=lowest：QKA > KQJ > … > 234 > A23', () => {
  const c = cfg({ a23: 'lowest' });
  const order = ['Qs Kh Ad', 'Js Qh Kd', '10s Jh Qd', '4s 5h 6d', '3s 4h 5d', '2s 3h 4d', 'As 2h 3d'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(ev(order[i], c).type, 'shunzi');
    assert.equal(cmp(order[i], order[i + 1], c), 1, `${order[i]} > ${order[i + 1]}`);
  }
  assert.equal(ev('As 2h 3d', c).type, 'shunzi');
  assert.equal(ev('As 2s 3s', c).type, 'shunjin');
  // 最小的顺子仍然大于任何对子
  assert.equal(cmp('As 2h 3d', 'As Ah Kd', c), 1);
});

test('a23=second：QKA > A23 > KQJ > … > 234', () => {
  const c = cfg({ a23: 'second' });
  const order = ['Qs Kh Ad', 'As 2h 3d', 'Js Qh Kd', '10s Jh Qd', '3s 4h 5d', '2s 3h 4d'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(ev(order[i], c).type, 'shunzi');
    assert.equal(cmp(order[i], order[i + 1], c), 1, `${order[i]} > ${order[i + 1]}`);
  }
  // 顺金同理
  assert.equal(cmp('Qh Kh Ah', 'Ah 2h 3h', c), 1);
  assert.equal(cmp('Ah 2h 3h', 'Jh Qh Kh', c), 1);
});

test('a23=none：A23 按单张 / 金花处理', () => {
  const c = cfg({ a23: 'none' });
  assert.equal(ev('As 2h 3d', c).type, 'sanpai');
  assert.equal(ev('As 2s 3s', c).type, 'jinhua');
  // A 当大牌：A32 单张比 KQ9 单张大
  assert.equal(cmp('As 2h 3d', 'Ks Qh 9d', c), 1);
  // 单张的 A23 比不过对子
  assert.equal(cmp('As 2h 3d', '4s 4h 9d', c), -1);
  // 234 仍然是最小顺子
  assert.equal(ev('2s 3h 4d', c).type, 'shunzi');
});

test('235：baozi235 = all / aaa / off，baozi235Suit = mixed / any 的组合', () => {
  const mixed235 = '2s 3h 5d';
  const suited235 = '2h 3h 5h';
  const KKK = 'Ks Kh Kd';
  const AAA = 'As Ah Ad';

  // all + mixed（默认）
  let c = cfg({ baozi235: 'all', baozi235Suit: 'mixed' });
  assert.equal(ev(mixed235, c).is235, true);
  assert.equal(ev(suited235, c).is235, false);
  assert.equal(cmp(mixed235, KKK, c), 1);
  assert.equal(cmp(mixed235, AAA, c), 1);
  assert.equal(cmp(KKK, mixed235, c), -1);
  assert.equal(cmp(suited235, KKK, c), -1); // 同花 235 只是普通金花
  assert.equal(ev(suited235, c).type, 'jinhua');

  // all + any：同花 235 也能吃豹子
  c = cfg({ baozi235: 'all', baozi235Suit: 'any' });
  assert.equal(ev(suited235, c).is235, true);
  assert.equal(cmp(suited235, KKK, c), 1);
  assert.equal(cmp(suited235, AAA, c), 1);

  // aaa + mixed：只吃 AAA
  c = cfg({ baozi235: 'aaa', baozi235Suit: 'mixed' });
  assert.equal(cmp(mixed235, AAA, c), 1);
  assert.equal(cmp(AAA, mixed235, c), -1);
  assert.equal(cmp(mixed235, KKK, c), -1);
  assert.equal(cmp(suited235, AAA, c), -1);

  // aaa + any
  c = cfg({ baozi235: 'aaa', baozi235Suit: 'any' });
  assert.equal(cmp(suited235, AAA, c), 1);
  assert.equal(cmp(suited235, KKK, c), -1);

  // off：没有 235 规则
  c = cfg({ baozi235: 'off' });
  assert.equal(ev(mixed235, c).is235, false);
  assert.equal(cmp(mixed235, AAA, c), -1);
  assert.equal(cmp(mixed235, KKK, c), -1);
});

test('235 对其他牌型按自身牌型比较：杂花色是最小单张，同花是最小金花', () => {
  const c = cfg();
  assert.equal(ev('2s 3h 5d', c).type, 'sanpai');
  // 比任何其他单张都小（除非完全相同）
  assert.equal(cmp('2s 3h 5d', '2h 3s 6d', c), -1);
  assert.equal(cmp('2s 3h 5d', '2h 4s 5c', c), -1);
  // 同花 235 是最小的金花，大于任何单张 / 顺子以下，小于其他金花
  assert.equal(cmp('2h 3h 5h', '2s 3s 6s', c), -1);
  assert.equal(cmp('2h 3h 5h', 'As Kh Qd', c), 1);
  assert.equal(cmp('2s 3h 5d', '4s 4h 9d', c), -1);
  // 235 对顺子、顺金、对子、金花都是输
  assert.equal(cmp('2s 3h 5d', '2s 3s 4s', c), -1);
});

test('235 对 235 / 豹子对豹子：按普通规则', () => {
  const c = cfg();
  assert.equal(cmp('Ks Kh Kd', 'Qs Qh Qd', c), 1);
  assert.equal(cmp('As Ah Ad', '2s 2h 2d', c), 1);
  // 两个 235（花色不同）完全相同：发起方输
  assert.equal(cmp('2s 3h 5d', '2h 3s 5c', c, 'a'), -1);
  assert.equal(cmp('2s 3h 5d', '2h 3s 5c', c, 'b'), 1);
});

test('tieRule = challengerLoses：点数完全相同时发起方输，无发起方时返回 0', () => {
  const c = cfg({ tieRule: 'challengerLoses' });
  const a = 'As Kh 9d';
  const b = 'Ah Ks 9c';
  assert.equal(cmp(a, b, c, 'a'), -1);
  assert.equal(cmp(a, b, c, 'b'), 1);
  assert.equal(cmp(a, b, c, null), 0);
});

test('tieRule = suit：比最大那组牌里花色最大的一张', () => {
  const c = cfg({ tieRule: 'suit' });
  // 单张：最大的一张（A）花色比较
  assert.equal(cmp('As Kh 9d', 'Ah Ks 9c', c), 1);
  assert.equal(cmp('Ah Kh 9d', 'Ac Ks 9c', c), 1); // ♥ > ♣
  assert.equal(cmp('Ac Kh 9d', 'Ad Ks 9c', c), 1); // ♣ > ♦
  // 金花：最大的那张牌花色
  assert.equal(cmp('As Ks 9s', 'Ah Kh 9h', c), 1);
  // 顺子 / 顺金比最大的那张
  assert.equal(cmp('4s 5h 6s', '4h 5c 6c', c), 1); // 6♠ > 6♣
  assert.equal(cmp('4s 5h 6d', '4h 5c 6c', c), -1); // 6♦ < 6♣
});

test('tieRule = suit：对子比对子里花色较大的一张', () => {
  const c = cfg({ tieRule: 'suit' });
  // 对子 9：♠♦ 对 ♥♣，♠ 最大
  assert.equal(cmp('9s 9d Kc', '9h 9c Kd', c), 1);
  assert.equal(cmp('9h 9d Kc', '9c 9s Kd', c), -1);
  // 无论 challenger 是谁，结果一致
  assert.equal(cmp('9s 9d Kc', '9h 9c Kd', c, 'a'), 1);
  assert.equal(cmp('9s 9d Kc', '9h 9c Kd', c, 'b'), 1);
});

test('单张 / 金花逐张比较的边界', () => {
  const c = cfg();
  // 第一张相同，第二张决定
  assert.equal(cmp('As Kh 3d', 'Ah Qs Jd', c), 1);
  // 前两张相同，第三张决定
  assert.equal(cmp('As Kh 9d', 'Ah Ks 8c', c), 1);
  assert.equal(cmp('As Kh 8d', 'Ah Ks 9c', c), -1);
  // 金花同理
  assert.equal(cmp('As Ks 3s', 'Ah Qh Jh', c), 1);
  assert.equal(cmp('As Ks 9s', 'Ah Kh 8h', c), 1);
  // 单张不会因为花色而影响点数比较
  assert.equal(cmp('2s 3h 7d', '2h 3d 8c', c), -1);
});

test('对子比较：先比对子，再比单牌', () => {
  const c = cfg();
  assert.equal(cmp('Ks Kh 2d', 'Qs Qh Ad', c), 1);
  assert.equal(cmp('9s 9h Ad', '9d 9c Kd', c), 1);
  assert.equal(cmp('9s 9h 3d', '9d 9c 4d', c), -1);
  // 对子在后 / 中间位置也能识别
  assert.equal(ev('Ks 5h 5d', c).key.join(), '5,13');
  assert.equal(ev('As 5h 5d', c).key.join(), '5,14');
  assert.equal(ev('3s 3h Ad', c).key.join(), '3,14');
});

test('强制开牌选最大：并列时返回多个下标', () => {
  const c = cfg();
  const evs = ['As Kh 9d', 'Ah Ks 9c', '4s 4h 2d'].map((s) => ev(s, c));
  assert.deepEqual(bestIndexes(evs, c), [2]);
  const evs2 = ['As Kh 9d', 'Ah Ks 9c', '8s 4h 2d'].map((s) => ev(s, c));
  assert.deepEqual(bestIndexes(evs2, c), [0, 1]);
  // suit 规则下一定分得出胜负
  const cs = cfg({ tieRule: 'suit' });
  assert.deepEqual(bestIndexes(evs2.map((e, i) => ev(['As Kh 9d', 'Ah Ks 9c', '8s 4h 2d'][i], cs)), cs), [0]);
});

test('标签与牌面视图', () => {
  const c = cfg();
  assert.equal(handLabel(ev('As Ah Ad', c)), '豹子 A');
  assert.equal(handLabel(ev('Qh Kh Ah', c)), '顺金 QKA');
  assert.equal(handLabel(ev('As 2h 3d', c)), '顺子 A23');
  assert.equal(handLabel(ev('9s 9h 3d', c)), '对子 9');
  assert.equal(handLabel(ev('Ks 9h 3d', c)), '单张 K');
  assert.equal(handLabel(ev('Ks 9s 3s', c)), '金花 K');
  assert.equal(ev('10s Jh Qd', c).type, 'shunzi');
});

test('洗牌是 Fisher–Yates 排列：不丢牌不重复，且使用注入的随机数', () => {
  const d = shuffle(newDeck());
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((x) => `${x.r}${x.s}`)).size, 52);
  // 随机数恒为 0：确定的排列
  const a = shuffle(newDeck(), () => 0);
  const b = shuffle(newDeck(), () => 0);
  assert.deepEqual(a, b);
});
