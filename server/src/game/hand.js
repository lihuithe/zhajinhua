// 牌型判定与比较（纯函数）。所有规则开关都从 config 读取：a23、baozi235、baozi235Suit、tieRule
import { RANK_CHARS, SUIT_ORDER } from './cards.js';

// 牌型强弱：数值越大越大
export const TYPE_RANK = { sanpai: 1, duizi: 2, shunzi: 3, jinhua: 4, shunjin: 5, baozi: 6 };
const TYPE_NAME = { baozi: '豹子', shunjin: '顺金', jinhua: '金花', shunzi: '顺子', duizi: '对子', sanpai: '单张' };

/**
 * 判定一手三张牌。
 * 返回：
 *  - type: 牌型代码
 *  - key: 同牌型比较用的数组（逐项比大小）
 *  - is235: 是否为"有特权的 235"（受 baozi235 / baozi235Suit 影响）
 *  - topCard: tieRule=suit 时用来比花色的那张牌
 *  - cards: 原牌（按牌面从大到小排序后的副本）
 */
export function evaluate(cards, config) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new Error('需要 3 张牌');
  const sorted = [...cards].sort((x, y) => y.r - x.r || SUIT_ORDER[y.s] - SUIT_ORDER[x.s]);
  const [c1, c2, c3] = sorted;
  const flush = c1.s === c2.s && c2.s === c3.s;

  // 顺子判断，straightValue 用于顺子间比较（QKA = 14 最大）
  let straightValue = null;
  let straightTop = c1;
  if (c1.r - c2.r === 1 && c2.r - c3.r === 1) {
    straightValue = c1.r;
  } else if (c1.r === 14 && c2.r === 3 && c3.r === 2 && config.a23 !== 'none') {
    // A23：lowest 时比 234（值 4）还小；second 时介于 QKA(14) 与 KQJ(13) 之间
    straightValue = config.a23 === 'second' ? 13.5 : 3;
    straightTop = c2; // A 当 1，最大的是 3
  }
  const isStraight = straightValue !== null;

  let type;
  let key;
  let topCard = c1;
  if (c1.r === c2.r && c2.r === c3.r) {
    type = 'baozi';
    key = [c1.r];
  } else if (isStraight && flush) {
    type = 'shunjin';
    key = [straightValue];
    topCard = straightTop;
  } else if (flush) {
    type = 'jinhua';
    key = [c1.r, c2.r, c3.r];
  } else if (isStraight) {
    type = 'shunzi';
    key = [straightValue];
    topCard = straightTop;
  } else if (c1.r === c2.r || c2.r === c3.r) {
    type = 'duizi';
    const pairRank = c1.r === c2.r ? c1.r : c3.r;
    const kicker = c1.r === c2.r ? c3.r : c1.r;
    key = [pairRank, kicker];
    // 对子比较花色：取对子里花色较大的那张（排序后同点数里前面的花色更大）
    topCard = c1.r === c2.r ? c1 : c2;
  } else {
    type = 'sanpai';
    key = [c1.r, c2.r, c3.r];
  }

  // 特殊 235
  let is235 = false;
  if (config.baozi235 !== 'off' && c1.r === 5 && c2.r === 3 && c3.r === 2) {
    is235 = config.baozi235Suit === 'any' ? true : !flush;
  }

  return { type, key, is235, topCard, cards: sorted };
}

function compareKeys(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 特殊 235 能否吃掉这手豹子
function beatsBaozi(h235, baozi, config) {
  if (!h235.is235) return false;
  if (config.baozi235 === 'all') return true;
  if (config.baozi235 === 'aaa') return baozi.key[0] === 14;
  return false;
}

/**
 * 比较两手牌。返回 1 = a 赢，-1 = b 赢，0 = 完全相同且无法分出（仅 tieRule=challengerLoses 且无发起者时）。
 * challenger: 'a' | 'b' | null —— 主动发起比牌的一方。tieRule=challengerLoses 且点数完全相同时发起方输。
 */
export function compareHands(a, b, config, challenger = null) {
  // 235 对豹子的特权
  if (a.type === 'baozi' && beatsBaozi(b, a, config)) return -1;
  if (b.type === 'baozi' && beatsBaozi(a, b, config)) return 1;

  if (a.type !== b.type) return TYPE_RANK[a.type] > TYPE_RANK[b.type] ? 1 : -1;
  const k = compareKeys(a.key, b.key);
  if (k !== 0) return k;

  // 点数完全相同
  if (config.tieRule === 'suit') {
    const d = SUIT_ORDER[a.topCard.s] - SUIT_ORDER[b.topCard.s];
    if (d !== 0) return d > 0 ? 1 : -1;
    return 0; // 理论上不会出现（牌唯一）
  }
  if (challenger === 'a') return -1;
  if (challenger === 'b') return 1;
  return 0;
}

// 在若干手牌中选出最大者（强制开牌用，无发起者）。返回最大者的下标数组（并列时多个）
export function bestIndexes(evals, config) {
  let best = [0];
  for (let i = 1; i < evals.length; i++) {
    const c = compareHands(evals[i], evals[best[0]], config, null);
    if (c > 0) best = [i];
    else if (c === 0) best.push(i);
  }
  return best;
}

function rc(r) {
  return RANK_CHARS[r];
}

// 中文标签，例如 "豹子 A"、"顺金 QKA"、"对子 9"、"单张 K"
export function handLabel(ev) {
  const [c1, c2, c3] = ev.cards;
  let detail;
  switch (ev.type) {
    case 'baozi':
      detail = rc(c1.r);
      break;
    case 'shunjin':
    case 'shunzi': {
      // 以升序展示：A23、234 … QKA
      const isA23 = c1.r === 14 && c2.r === 3;
      detail = isA23 ? 'A23' : `${rc(c3.r)}${rc(c2.r)}${rc(c1.r)}`;
      break;
    }
    case 'duizi':
      detail = rc(ev.key[0]);
      break;
    default:
      detail = rc(c1.r); // 金花 / 单张：最大的一张
  }
  return `${TYPE_NAME[ev.type]} ${detail}${ev.is235 ? '（235）' : ''}`;
}

// 下发给客户端的 CardsView
export function toCardsView(ev) {
  return {
    cards: ev.cards.map((c) => ({ r: c.r, s: c.s })),
    type: ev.type,
    label: handLabel(ev),
    is235: ev.is235,
  };
}
