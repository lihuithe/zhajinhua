// 房间配置的元数据：默认值兜底、取值范围兜底、中文说明、校验、规则描述
// 字段与取值全部来自 docs/RULES.md 第 5 节 与 docs/PROTOCOL.md 4.1

export const FALLBACK_DEFAULTS = {
  hands: 5,
  initialChips: 1000,
  rebuyMax: 0,
  ante: 1,
  raiseMode: 'steps',
  raiseSteps: [5, 10, 20, 30, 50, 100],
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
};

export const FALLBACK_LIMITS = {
  hands: { min: 1, max: 100, quick: [5, 10, 20, 30] },
  initialChips: { min: 100, max: 100000, quick: [200, 500, 1000, 2000] },
  rebuyMax: { min: 0, max: 1000000, quick: [0, 1000, 5000, 10000] },
  ante: { min: 1, max: 1000, quick: [1, 2, 5, 10] },
  raiseMode: { options: ['steps', 'free'] },
  raiseSteps: { min: 2, max: 100 },
  capMultiple: { min: 2, max: 100, quick: [5, 10, 20, 50, 100] },
  seenMultiplier: { min: 1, max: 5, quick: [1, 2, 3, 4, 5] },
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

export const MAX_RAISE_STEPS = 6;

export function cloneConfig(c) {
  const o = Object.assign({}, c);
  o.raiseSteps = Array.isArray(c && c.raiseSteps) ? c.raiseSteps.slice() : [];
  return o;
}

// 合并服务端 limits 与兜底 limits（按字段）
export function mergeLimits(server) {
  const out = {};
  Object.keys(FALLBACK_LIMITS).forEach((k) => {
    out[k] = Object.assign({}, FALLBACK_LIMITS[k], (server && server[k]) || {});
  });
  return out;
}

export function mergeDefaults(server) {
  return cloneConfig(Object.assign({}, FALLBACK_DEFAULTS, server || {}));
}

// 字段定义。group: basic 基础 / adv 高级（高级字段在界面上按 SECTIONS 分组）
// kind: int 整数 / enum 单选 / steps 档位列表
// enum 的 options：{ value, label, desc }
export const FIELDS = [
  {
    key: 'hands',
    label: '局数',
    kind: 'int',
    group: 'basic',
    unit: '局',
    help: () => '一场打多少局，打满后进入结算榜。',
  },
  {
    key: 'initialChips',
    label: '初始积分',
    kind: 'int',
    group: 'basic',
    unit: '分',
    help: () => '每位入座玩家在一场开始时获得的积分。创建房间后不能再修改，“再来一场”时所有人重置为此值。',
  },
  {
    key: 'rebuyMax',
    label: '额外领分',
    kind: 'int',
    group: 'basic',
    unit: '分',
    help: (c) =>
      !c.rebuyMax
        ? '0 = 不允许。设置后，玩家积分输光时，下一局开局前自动再领一份初始积分，直到领满这个上限（每人每场单独计算）。'
        : '每人每场最多再领 ' +
          c.rebuyMax +
          ' 分：输光时自动补领 ' +
          c.initialChips +
          ' 分，最多 ' +
          Math.ceil(c.rebuyMax / Math.max(1, c.initialChips)) +
          ' 次。结算时净输赢会扣除补领的分。',
    text: (c) => (c.rebuyMax ? '每人每场最多 ' + c.rebuyMax + ' 分' : '不允许'),
  },
  {
    key: 'ante',
    label: '底注',
    kind: 'int',
    group: 'basic',
    unit: '分',
    help: () => '每局开始时每位参与者先付的积分，也是加注档位的基数。积分不足底注的人本局不参与。',
  },
  {
    key: 'raiseMode',
    label: '加注方式',
    kind: 'enum',
    group: 'adv',
    help: () => '加注时怎么选金额。',
    options: [
      { value: 'steps', label: '固定档位', desc: '加注时从下面的“加注档位”里选，点一下就加，手机上操作最快' },
      { value: 'free', label: '自由加注', desc: '加注时可以拖动或输入任意金额（高于当前单注、不超过单注封顶），加注档位作为快捷按钮保留' },
    ],
  },
  {
    key: 'raiseSteps',
    label: '加注档位',
    kind: 'steps',
    group: 'adv',
    unit: '倍底注',
    help: (c) =>
      '加注可选的档位，是底注的倍数（闷牌价）。例如底注 ' +
      c.ante +
      '、档位 ' +
      (c.raiseSteps || []).join('/') +
      '，则可加到 ' +
      (c.raiseSteps || []).map((s) => s * c.ante).join('/') +
      '。界面只列出高于当前单注、不超过封顶且付得起的档位。1–6 个，严格递增，每个 2–100，且不超过封顶倍数。',
    text: (c) => (c.raiseSteps || []).map((s) => '×' + s).join(' '),
  },
  {
    key: 'capMultiple',
    label: '单注封顶',
    kind: 'int',
    group: 'adv',
    unit: '倍底注',
    help: (c) => '单注（闷牌价）最高不超过底注的多少倍。当前封顶 = ' + c.ante + ' × ' + c.capMultiple + ' = ' + c.ante * c.capMultiple + ' 分。',
    text: (c) => c.capMultiple + ' 倍底注',
  },
  {
    key: 'seenMultiplier',
    label: '明牌倍率',
    kind: 'int',
    group: 'basic',
    unit: '倍',
    help: (c) =>
      '看牌后（明牌）每次下注要付闷牌价的几倍。例如设为 3（重庆玩法）：当前单注 10 分时，闷家付 10，看牌后跟注需付 30。当前设置：单注 ' +
      c.ante +
      ' 时，闷牌付 ' +
      c.ante +
      '，明牌付 ' +
      c.ante * c.seenMultiplier +
      '。',
    text: (c) => c.seenMultiplier + ' 倍',
  },
  {
    key: 'maxRounds',
    label: '轮数上限',
    kind: 'int',
    group: 'adv',
    unit: '轮',
    help: () => '一局最多打多少轮。第 N 轮全部行动完后将进入下一轮时，强制开牌，所有在场玩家亮牌，最大者赢。',
    text: (c) => c.maxRounds + ' 轮',
  },
  {
    key: 'compareAfterRound',
    label: '可比牌轮次',
    kind: 'enum',
    group: 'adv',
    help: () => '第几轮结束之后才允许主动比牌。选“第 1 轮后”表示从第 2 轮起可以比牌。',
    options: [
      { value: 1, label: '第 1 轮后', desc: '第 2 轮起可比牌' },
      { value: 2, label: '第 2 轮后', desc: '第 3 轮起可比牌' },
      { value: 3, label: '第 3 轮后', desc: '第 4 轮起可比牌' },
    ],
  },
  {
    key: 'actionSeconds',
    label: '行动限时',
    kind: 'int',
    group: 'adv',
    unit: '秒',
    help: () => '轮到某人时的思考时间，超时按“超时处理”自动操作。掉线的玩家同样计时。',
    text: (c) => c.actionSeconds + ' 秒',
  },
  {
    key: 'nextHandSeconds',
    label: '局间等待',
    kind: 'int',
    group: 'adv',
    unit: '秒',
    help: () => '一局结束后展示结果、可以亮牌的时间，倒计时结束自动开始下一局。',
    text: (c) => c.nextHandSeconds + ' 秒',
  },
  {
    key: 'settleSeconds',
    label: '结算前等待',
    kind: 'int',
    group: 'adv',
    unit: '秒',
    help: () => '最后一局结束后，展示这一局结果多久再弹出本场结算榜。',
    text: (c) => c.settleSeconds + ' 秒',
  },
  {
    key: 'timeoutAction',
    label: '超时处理',
    kind: 'enum',
    group: 'adv',
    help: () => '倒计时结束时系统替他做的操作。连续 2 局超时的玩家会在本局结束后自动改为观战模式（积分保留）。',
    options: [
      { value: 'fold', label: '自动弃牌', desc: '超时自动弃牌' },
      { value: 'call', label: '自动跟注', desc: '超时自动跟注；积分不够时改为弃牌' },
    ],
  },
  {
    key: 'a23',
    label: 'A23 顺子',
    kind: 'enum',
    group: 'adv',
    help: () => 'QKA 永远是最大的顺子，KA2 永远不算顺子。A23 的处理方式：',
    options: [
      { value: 'lowest', label: '最小', desc: 'A23 是最小的顺子（QKA > KQJ > … > 234 > A23）' },
      { value: 'second', label: '第二大', desc: 'A23 是第二大的顺子（QKA > A23 > KQJ > … > 234）' },
      { value: 'none', label: '不算顺子', desc: 'A23 不算顺子，按普通单张 / 金花处理' },
    ],
  },
  {
    key: 'baozi235',
    label: '235 吃豹子',
    kind: 'enum',
    group: 'adv',
    help: () => '点数为 2、3、5 的牌，对上豹子时的特权。对上其他牌型时按自身牌型正常比较。',
    options: [
      { value: 'all', label: '吃所有豹子', desc: '235 可以吃所有豹子' },
      { value: 'aaa', label: '只吃 AAA', desc: '235 只能吃 AAA' },
      { value: 'off', label: '关闭', desc: '没有 235 规则' },
    ],
  },
  {
    key: 'baozi235Suit',
    label: '235 花色要求',
    kind: 'enum',
    group: 'adv',
    help: () => '“235 吃豹子”生效时，对花色的要求。',
    options: [
      { value: 'mixed', label: '须杂色', desc: '三张花色不全相同才算特殊 235；同花的 235 只是普通金花' },
      { value: 'any', label: '不限花色', desc: '同花的 235 也能吃豹子' },
    ],
  },
  {
    key: 'tieRule',
    label: '完全相同时',
    kind: 'enum',
    group: 'adv',
    help: () => '两手牌点数完全相同时怎么判。强制开牌时没有发起者，若完全相同则并列者平分底池。',
    options: [
      { value: 'challengerLoses', label: '发起者输', desc: '点数完全相同时，主动发起比牌的一方输' },
      { value: 'suit', label: '比花色', desc: '比最大那组牌的花色，♠ > ♥ > ♣ > ♦' },
    ],
  },
  {
    key: 'compareCost',
    label: '比牌费用',
    kind: 'enum',
    group: 'adv',
    help: (c) =>
      '主动比牌时要付的积分 = 当前单注（看牌则按明牌价）× 此倍数。当前设置下，闷牌比牌付 ' +
      c.ante * c.compareCost +
      '（按底注计），明牌再乘明牌倍率。',
    options: [
      { value: 1, label: '1 倍', desc: '与跟注同价' },
      { value: 2, label: '2 倍', desc: '跟注价的 2 倍' },
    ],
  },
  {
    key: 'blindCanCompare',
    label: '闷牌比牌',
    kind: 'enum',
    group: 'adv',
    help: () => '还没看牌的玩家，能不能主动发起比牌。',
    options: [
      { value: true, label: '允许', desc: '闷牌也可以主动比牌' },
      { value: false, label: '不允许', desc: '必须先看牌才能主动比牌' },
    ],
  },
  {
    key: 'shortStack',
    label: '积分不足时',
    kind: 'enum',
    group: 'adv',
    help: () => '轮到你时积分连跟注都不够怎么办。（不支持边池）',
    options: [
      { value: 'allIn', label: '孤注一掷', desc: '把剩余积分全部放入底池，同时和所有在场玩家比牌：全部赢则赢下底池，输给任何一人则出局' },
      { value: 'foldOnly', label: '只能弃牌', desc: '积分不足以跟注的玩家只能弃牌' },
    ],
  },
  {
    key: 'bonusEnabled',
    label: '喜钱',
    kind: 'enum',
    group: 'adv',
    help: () => '赢家唯一且牌型为豹子或顺金时，其他每位参与者额外付给赢家的积分（积分不够的付光为止）。触发喜钱时赢家的牌会向所有人亮出。',
    options: [
      { value: true, label: '开启', desc: '开启喜钱' },
      { value: false, label: '关闭', desc: '没有喜钱' },
    ],
  },
  {
    key: 'bonusBaozi',
    label: '豹子喜钱',
    kind: 'int',
    group: 'adv',
    unit: '倍底注',
    needs: 'bonusEnabled',
    help: (c) => '赢家牌型为豹子时，每人额外付 底注 × 此值 = ' + c.ante * c.bonusBaozi + ' 分。填 0 表示无豹子喜钱。',
    text: (c) => c.bonusBaozi + ' 倍底注',
  },
  {
    key: 'bonusShunjin',
    label: '顺金喜钱',
    kind: 'int',
    group: 'adv',
    unit: '倍底注',
    needs: 'bonusEnabled',
    help: (c) => '赢家牌型为顺金时，每人额外付 底注 × 此值 = ' + c.ante * c.bonusShunjin + ' 分。填 0 表示无顺金喜钱。',
    text: (c) => c.bonusShunjin + ' 倍底注',
  },
];

export const FIELD_MAP = FIELDS.reduce((m, f) => {
  m[f.key] = f;
  return m;
}, {});

export function findOption(field, value) {
  return (field.options || []).find((o) => o.value === value);
}

// 高级配置分组：每组可以单独展开；summary 返回组标题下的概要（几段短文字）
export const SECTIONS = [
  {
    key: 'bet',
    title: '下注规则',
    mark: '注',
    keys: ['raiseMode', 'raiseSteps', 'capMultiple', 'maxRounds', 'shortStack'],
    summary: (c) => [
      (c.raiseMode === 'free' ? '自由加注 ×' : '档位 ×') + (c.raiseSteps || []).join('/'),
      '封顶 ' + c.capMultiple + ' 倍',
      '最多 ' + c.maxRounds + ' 轮',
      c.shortStack === 'foldOnly' ? '积分不足只能弃牌' : '积分不足孤注一掷',
    ],
  },
  {
    key: 'compare',
    title: '比牌规则',
    mark: '比',
    keys: ['compareAfterRound', 'compareCost', 'blindCanCompare', 'tieRule'],
    summary: (c) => [
      '第 ' + (c.compareAfterRound + 1) + ' 轮起可比牌',
      '费用 ' + c.compareCost + ' 倍',
      c.blindCanCompare ? '闷牌可比' : '看牌后才能比',
      c.tieRule === 'suit' ? '相同比花色' : '相同发起者输',
    ],
  },
  {
    key: 'hand',
    title: '牌型规则',
    mark: '牌',
    keys: ['a23', 'baozi235', 'baozi235Suit'],
    summary: (c) => {
      const a23 = { lowest: 'A23 最小顺子', second: 'A23 第二大', none: 'A23 不算顺子' }[c.a23];
      if (c.baozi235 === 'off') return [a23, '无 235 规则'];
      return [a23, c.baozi235 === 'aaa' ? '235 只吃 AAA' : '235 吃豹子', c.baozi235Suit === 'any' ? '不限花色' : '须杂色'];
    },
  },
  {
    key: 'bonus',
    title: '喜钱',
    mark: '喜',
    keys: ['bonusEnabled', 'bonusBaozi', 'bonusShunjin'],
    summary: (c) => (c.bonusEnabled ? ['豹子 ' + c.bonusBaozi + ' 倍底注', '顺金 ' + c.bonusShunjin + ' 倍底注'] : ['不收喜钱']),
  },
  {
    key: 'time',
    title: '时间与超时',
    mark: '时',
    keys: ['actionSeconds', 'timeoutAction', 'nextHandSeconds', 'settleSeconds'],
    summary: (c) => [
      '行动 ' + c.actionSeconds + ' 秒',
      c.timeoutAction === 'call' ? '超时跟注' : '超时弃牌',
      '局间 ' + c.nextHandSeconds + ' 秒',
      '结算前 ' + c.settleSeconds + ' 秒',
    ],
  },
];

function isInt(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
}

// 校验，返回 { 字段: 错误信息 }；空对象表示通过
export function validateConfig(c, limitsIn) {
  const limits = limitsIn || FALLBACK_LIMITS;
  const errs = {};
  FIELDS.forEach((f) => {
    const lim = limits[f.key] || {};
    const v = c[f.key];
    if (f.kind === 'int') {
      const min = lim.min === undefined ? -Infinity : lim.min;
      const max = lim.max === undefined ? Infinity : lim.max;
      if (!isInt(v) || v < min || v > max) {
        errs[f.key] = f.label + '需为 ' + min + ' – ' + max + ' 的整数';
      }
    } else if (f.kind === 'enum') {
      const opts = lim.options || f.options.map((o) => o.value);
      if (opts.indexOf(v) < 0) errs[f.key] = '请选择' + f.label;
    } else if (f.kind === 'steps') {
      const arr = v;
      const min = lim.min === undefined ? 2 : lim.min;
      const max = lim.max === undefined ? 100 : lim.max;
      if (!Array.isArray(arr) || arr.length < 1 || arr.length > MAX_RAISE_STEPS) {
        errs[f.key] = '加注档位需要 1–' + MAX_RAISE_STEPS + ' 个';
      } else if (arr.some((x) => !isInt(x) || x < min || x > max)) {
        errs[f.key] = '每个档位需为 ' + min + ' – ' + max + ' 的整数';
      } else if (arr.some((x, i) => i > 0 && x <= arr[i - 1])) {
        errs[f.key] = '加注档位必须严格递增';
      } else if (isInt(c.capMultiple) && arr.some((x) => x > c.capMultiple)) {
        errs[f.key] = '加注档位不能超过单注封顶（' + c.capMultiple + ' 倍）';
      }
    }
  });
  return errs;
}

// 提交前整理：整数字段转 number，档位排序去重
export function normalizeConfig(c) {
  const o = cloneConfig(c);
  FIELDS.forEach((f) => {
    if (f.kind === 'int' && typeof o[f.key] === 'string') o[f.key] = Number(o[f.key]);
  });
  o.raiseSteps = Array.from(new Set(o.raiseSteps.map(Number))).sort((a, b) => a - b);
  return o;
}

// 当前配置的值（展示用文字）
export function valueText(field, c) {
  const v = c[field.key];
  if (field.kind === 'enum') {
    const o = findOption(field, v);
    return o ? o.label : String(v);
  }
  if (field.text) return field.text(c);
  return String(v) + (field.unit ? ' ' + field.unit : '');
}

// 规则弹窗：当前全部配置的中文说明
export function describeConfig(c) {
  return FIELDS.map((f) => {
    const o = f.kind === 'enum' ? findOption(f, c[f.key]) : null;
    // enum：说明以所选项为主，字段本身含义放在 help
    return {
      key: f.key,
      label: f.label,
      value: valueText(f, c),
      desc: o && o.desc ? o.desc : f.help(c),
      help: f.help(c),
      dim: !!(f.needs && !c[f.needs]),
    };
  });
}
