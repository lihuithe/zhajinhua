// 下注的“豪气”等级（特效和声音共用）：1 普通 / 2 有点料 / 3 豪气 / 4 霸气
// 按这一手实际付出的积分相对底注的倍数来分；加注至少是 2 级
export function betTier(kind, amount, ante) {
  const r = (amount || 0) / Math.max(1, ante || 1);
  if (kind === 'raise') return r <= 4 ? 2 : r <= 10 ? 3 : 4;
  return r <= 2 ? 1 : r <= 6 ? 2 : r <= 15 ? 3 : 4;
}
