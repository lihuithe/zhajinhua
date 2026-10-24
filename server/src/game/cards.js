// 牌与洗牌
import { randomInt } from 'node:crypto';

export const SUITS = ['s', 'h', 'c', 'd']; // 黑桃 > 红桃 > 梅花 > 方块
export const SUIT_ORDER = { s: 4, h: 3, c: 2, d: 1 };
export const RANK_CHARS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}

// Fisher–Yates，使用加密安全随机数；randInt 可注入便于测试
export function shuffle(arr, randInt = randomInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1); // [0, i]
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 测试用：'AS' '10h' '2d' → { r, s }
export function parseCard(str) {
  const m = /^(10|[2-9JQKA])([shcd])$/i.exec(str);
  if (!m) throw new Error(`bad card: ${str}`);
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  const r = map[m[1].toUpperCase()] ?? Number(m[1]);
  return { r, s: m[2].toLowerCase() };
}

export function parseCards(str) {
  return str.trim().split(/\s+/).map(parseCard);
}
