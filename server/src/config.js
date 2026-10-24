// 房间配置：默认值、取值范围、校验
import { err } from './errors.js';

export const DEFAULT_CONFIG = Object.freeze({
  hands: 5,
  initialChips: 1000,
  rebuyMax: 0,
  ante: 1,
  raiseMode: 'steps',
  raiseSteps: Object.freeze([5, 10, 20, 30, 50, 100]),
  capMultiple: 100,
  seenMultiplier: 3,
  maxRounds: 100,
  compareAfterRound: 1,
  actionSeconds: 80,
  nextHandSeconds: 5,
  settleSeconds: 5,
  timeoutAction: 'fold',
  a23: 'lowest',
  baozi235: 'all',
  baozi235Suit: 'mixed',
  tieRule: 'challengerLoses',
  compareCost: 1,
  blindCanCompare: true,
  shortStack: 'allIn',
  bonusEnabled: true,
  bonusBaozi: 10,
  bonusShunjin: 5,
});

// raiseSteps 额外带 minItems / maxItems（协议 Limits 允许的扩展字段）
export const LIMITS = {
  hands: { min: 1, max: 100, quick: [5, 10, 20, 30] },
  initialChips: { min: 100, max: 100000, quick: [200, 500, 1000, 2000] },
  rebuyMax: { min: 0, max: 1000000, quick: [0, 1000, 5000, 10000] },
  ante: { min: 1, max: 1000, quick: [1, 2, 5, 10] },
  raiseMode: { options: ['steps', 'free'] },
  raiseSteps: { min: 2, max: 100, minItems: 1, maxItems: 6 },
  capMultiple: { min: 2, max: 100, quick: [5, 10, 20, 50, 100] },
  seenMultiplier: { min: 1, max: 5 },
  maxRounds: { min: 5, max: 200, quick: [10, 15, 20, 50, 100] },
  compareAfterRound: { options: [1, 2, 3] },
  actionSeconds: { min: 10, max: 180, quick: [30, 60, 80, 120] },
  nextHandSeconds: { min: 3, max: 60, quick: [5, 10, 15, 20] },
  settleSeconds: { min: 3, max: 60, quick: [5, 10, 15, 20] },
  timeoutAction: { options: ['fold', 'call'] },
  a23: { options: ['lowest', 'second', 'none'] },
  baozi235: { options: ['all', 'aaa', 'off'] },
  baozi235Suit: { options: ['mixed', 'any'] },
  tieRule: { options: ['challengerLoses', 'suit'] },
  compareCost: { options: [1, 2] },
  blindCanCompare: { options: [true, false] },
  shortStack: { options: ['allIn', 'foldOnly'] },
  bonusEnabled: { options: [true, false] },
  bonusBaozi: { min: 0, max: 100 },
  bonusShunjin: { min: 0, max: 100 },
};

const LABELS = {
  hands: '局数',
  initialChips: '初始积分',
  rebuyMax: '额外领分上限',
  ante: '底注',
  raiseMode: '加注方式',
  raiseSteps: '加注档位',
  capMultiple: '单注封顶',
  seenMultiplier: '明牌倍率',
  maxRounds: '轮数上限',
  compareAfterRound: '可比牌轮次',
  actionSeconds: '行动限时',
  nextHandSeconds: '局间等待',
  settleSeconds: '结算前等待',
  timeoutAction: '超时处理',
  a23: 'A23 处理',
  baozi235: '235 吃豹子',
  baozi235Suit: '235 花色要求',
  tieRule: '完全相同时的处理',
  compareCost: '比牌费用倍数',
  blindCanCompare: '闷牌可主动比牌',
  shortStack: '积分不足时的处理',
  bonusEnabled: '喜钱开关',
  bonusBaozi: '豹子喜钱',
  bonusShunjin: '顺金喜钱',
};

export function getDefaults() {
  return { ...DEFAULT_CONFIG, raiseSteps: [...DEFAULT_CONFIG.raiseSteps] };
}

function bad(key, detail) {
  return err('BAD_CONFIG', `${LABELS[key] || key}${detail}`);
}

/**
 * 校验并规范化配置。缺失的字段用默认值补齐，未知字段丢弃。
 * 不合法时抛出 BAD_CONFIG（message 指明是哪一项）。
 */
export function normalizeConfig(input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw err('BAD_CONFIG', '配置格式不正确');
  const cfg = getDefaults();
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (input[key] !== undefined) cfg[key] = input[key];
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const lim = LIMITS[key];
    const v = cfg[key];
    if (key === 'raiseSteps') {
      if (!Array.isArray(v) || v.length < lim.minItems || v.length > lim.maxItems) {
        throw bad(key, `必须有 ${lim.minItems}–${lim.maxItems} 个档位`);
      }
      for (let i = 0; i < v.length; i++) {
        if (!Number.isInteger(v[i]) || v[i] < lim.min || v[i] > lim.max) {
          throw bad(key, `每一档必须是 ${lim.min}–${lim.max} 的整数`);
        }
        if (i > 0 && v[i] <= v[i - 1]) throw bad(key, '必须严格递增');
      }
      continue;
    }
    if (lim.options) {
      if (!lim.options.includes(v)) throw bad(key, `取值不合法（可选：${lim.options.join(' / ')}）`);
      continue;
    }
    if (!Number.isInteger(v) || v < lim.min || v > lim.max) {
      throw bad(key, `必须是 ${lim.min}–${lim.max} 的整数`);
    }
  }
  if (cfg.raiseSteps[cfg.raiseSteps.length - 1] > cfg.capMultiple) {
    throw bad('raiseSteps', `不能超过单注封顶 ${cfg.capMultiple} 倍`);
  }
  if (cfg.ante > cfg.initialChips) throw err('BAD_CONFIG', '底注不能大于初始积分');
  return cfg;
}

// 服务端运行参数（环境变量）：PORT、HOST、DATA_DIR、STATIC_DIR、ADMIN_USERNAME、ADMIN_PASSWORD、RESTORE_SNAPSHOT
export function loadEnv(env = process.env) {
  return {
    port: env.PORT !== undefined && env.PORT !== '' ? Number(env.PORT) : 3000,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || null, // null 时由 index.js 使用 server/data
    staticDir: env.STATIC_DIR || null, // null 时使用 <repo>/client/dist
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || 'admin',
    restoreSnapshot: env.RESTORE_SNAPSHOT !== '0', // 设为 0 时启动不恢复快照（大更新 / --fresh）
  };
}
