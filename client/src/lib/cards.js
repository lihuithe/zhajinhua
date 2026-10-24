// 牌面、牌型、头像相关的小工具
export const SUIT_CHAR = { s: '♠', h: '♥', c: '♣', d: '♦' };
export const SUIT_RED = { s: false, h: true, c: false, d: true };

export function rankText(r) {
  if (r === 14) return 'A';
  if (r === 13) return 'K';
  if (r === 12) return 'Q';
  if (r === 11) return 'J';
  return String(r);
}

export const TYPE_NAME = {
  baozi: '豹子',
  shunjin: '顺金',
  jinhua: '金花',
  shunzi: '顺子',
  duizi: '对子',
  sanpai: '单张',
};
export const typeName = (t) => (t ? TYPE_NAME[t] || t : '—');

function hash(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 头像配色：精选渐变色，按 userId 哈希取一组
const AVATAR_PALETTE = [
  ['#ff6b6b', '#c0392b'],
  ['#ffa94d', '#d9480f'],
  ['#4dabf7', '#1864ab'],
  ['#9775fa', '#5f3dc4'],
  ['#38d9a9', '#087f5b'],
  ['#f783ac', '#a61e4d'],
  ['#3bc9db', '#0b7285'],
  ['#ffd43b', '#e67700'],
  ['#748ffc', '#364fc7'],
  ['#c08457', '#7a4a24'],
  ['#da77f2', '#862e9c'],
  ['#69db7c', '#2b8a3e'],
];

export function avatarColor(userId) {
  const p = AVATAR_PALETTE[hash(userId) % AVATAR_PALETTE.length];
  return 'linear-gradient(145deg, ' + p[0] + ' 0%, ' + p[1] + ' 100%)';
}

export function firstChar(name) {
  const arr = Array.from(String(name || '?').trim());
  return (arr[0] || '?').toUpperCase();
}
