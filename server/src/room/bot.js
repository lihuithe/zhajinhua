// 机器人：房主可以往空座位上加机器人，机器人自动准备、自动出牌
// 决策只用到“自己的牌 + 公开信息”，和真人一样看不到别人的牌
export const BOT_PREFIX = 'bot:';
export const isBot = (userId) => typeof userId === 'string' && userId.startsWith(BOT_PREFIX);

const NAMES = ['阿福', '小金', '大壮', '二丫', '铁蛋', '翠花', '招财', '进宝', '旺财', '来福', '满仓', '发哥', '雀圣', '阿彪', '小美'];

/** 选一个房间里还没用过的名字 */
export function pickBotName(usedNames, rand = Math.random) {
  const free = NAMES.filter((n) => !usedNames.has('🤖' + n));
  const base = free.length ? free[Math.floor(rand() * free.length)] : NAMES[Math.floor(rand() * NAMES.length)] + Math.floor(rand() * 90 + 10);
  return '🤖' + base;
}

/** 牌力 0–1（大致对应在所有三张牌里的强弱） */
export function handStrength(ev) {
  if (!ev) return 0;
  const [k1 = 0, k2 = 0] = ev.key || [];
  switch (ev.type) {
    case 'baozi':
      return 0.99;
    case 'shunjin':
      return 0.97;
    case 'jinhua':
      return 0.84 + Math.max(0, k1 - 9) * 0.02; // A 高约 0.94
    case 'shunzi':
      return 0.78 + Math.min(14, k1) / 14 * 0.05;
    case 'duizi':
      return 0.52 + ((k1 - 2) / 12) * 0.22 + (k2 >= 12 ? 0.02 : 0);
    default: {
      // 单张：A 高约 0.42，K 高约 0.32，Q 以下更弱
      const v = ((k1 - 5) / 9) * 0.38 + ((k2 - 2) / 12) * 0.06;
      return Math.max(0.02, Math.min(0.45, v));
    }
  }
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

/**
 * 机器人这一手怎么打。返回要依次执行的动作，例如 [{ type: 'look' }, { type: 'call' }]
 * @param {object} ctx { seen, strength, round, actions, maxRounds, ante, activeCount }
 */
export function decide(ctx, rand = Math.random) {
  const { actions: a, round, maxRounds, ante } = ctx;
  if (!a) return [];
  const steps = [];
  let seen = ctx.seen;
  const s = ctx.strength;

  // 闷牌时：越往后越倾向看牌
  if (!seen) {
    const lookP = round <= 1 ? 0.15 : round === 2 ? 0.4 : round === 3 ? 0.65 : 0.9;
    if (rand() < lookP) {
      steps.push({ type: 'look' });
      seen = true;
    }
  }

  const call = () => (a.call ? { type: 'call' } : null);
  const raise = (level) => {
    if (a.raiseRange && rand() < 0.5) {
      const { min, max } = a.raiseRange;
      const raw = min + (max - min) * Math.min(1, level * rand());
      const to = Math.max(min, Math.min(max, Math.round(raw / ante) * ante || min));
      return { type: 'raise', to };
    }
    if (!a.raise.length) return null;
    const i = Math.min(a.raise.length - 1, Math.floor(rand() * Math.max(1, Math.ceil(a.raise.length * level))));
    return { type: 'raise', to: a.raise[i].to };
  };
  const compare = () => (a.compare && a.compare.targets.length ? { type: 'compare', target: pick(a.compare.targets, rand) } : null);
  const fold = { type: 'fold' };

  let act = null;
  if (!seen) {
    // 闷着打：大多数时候跟，偶尔闷加
    if (a.call) act = rand() < 0.12 ? raise(0.4) || call() : call();
    else act = a.allIn && rand() < 0.3 ? { type: 'allIn' } : fold;
  } else if (!a.call) {
    // 跟不起：牌好就孤注一掷
    act = a.allIn && s >= 0.5 ? { type: 'allIn' } : fold;
  } else if (s >= 0.8) {
    const r = rand();
    if (r < 0.5) act = raise(0.9);
    else if (r < 0.75 && round >= 3) act = compare();
    act = act || call();
  } else if (s >= 0.5) {
    const r = rand();
    if (round >= 3 && r < 0.35) act = compare();
    else if (r < 0.5) act = raise(0.3);
    act = act || call();
  } else if (s >= 0.25) {
    const r = rand();
    if (r < 0.35) act = compare();
    else if (r < 0.65) act = fold;
    act = act || call();
  } else {
    const r = rand();
    if (r < 0.15) act = call(); // 诈唬一下
    else if (r < 0.35) act = compare();
    act = act || fold;
  }
  // 快到轮数上限时，牌不太差就跟到开牌
  if (act && act.type === 'fold' && a.call && round >= maxRounds - 1 && s >= 0.3) act = call();
  if (act) steps.push(act);
  return steps;
}

export const BOT_WIN_LINES = ['😎', '👍', '🎉', '这把稳了', '承让承让', '运气不错～', '💰'];
