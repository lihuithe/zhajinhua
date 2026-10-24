// 仅开发模式使用：手写的 RoomView 假数据，用来检查牌桌布局
import { FALLBACK_DEFAULTS } from '../lib/configMeta';

const NAMES = [
  '小王', '李雷', '韩梅梅', '张三丰', '赵四', '王二麻子', '陈小春', '周杰伦',
  '刘德华', '郭德纲', '岳云鹏', '孙悟空', '猪八戒', '沙和尚', '唐三藏',
];

const C = (r, s) => ({ r, s });
const cv = (cards, type, label, is235 = false) => ({ cards, type, label, is235 });

function member(i, online = true) {
  return { userId: 'u' + i, nickname: NAMES[i], online };
}

function seatView(i, extra = {}) {
  return {
    ...member(i),
    seatIndex: i,
    chips: 300 + i * 37,
    ready: false,
    status: 'playing',
    ...extra,
  };
}

function baseView(over = {}) {
  const now = Date.now();
  return {
    serverTime: now,
    code: 'A3dE5fGh',
    ownerId: 'u0',
    phase: 'playing',
    config: { ...FALLBACK_DEFAULTS, seenMultiplier: 3 },
    sessionNo: 2,
    handNo: 3,
    seats: Array.from({ length: 15 }, () => null),
    spectators: [member(11), member(12, false), member(13)],
    me: { userId: 'u4', nickname: NAMES[4], seatIndex: 4, isOwner: false },
    hand: null,
    nextHandAt: null,
    summary: null,
    totals: [
      { userId: 'u4', nickname: NAMES[4], net: 320 },
      { userId: 'u0', nickname: NAMES[0], net: 45 },
      { userId: 'u2', nickname: NAMES[2], net: -365 },
    ],
    sessions: [],
    ...over,
  };
}

function fullTable() {
  return Array.from({ length: 15 }, (_, i) => seatView(i));
}

function players(states = {}) {
  return Array.from({ length: 15 }, (_, i) => ({
    seatIndex: i,
    userId: 'u' + i,
    nickname: NAMES[i],
    state: states[i] || 'active',
    seen: i % 3 === 0,
    bet: 10 + (i % 4) * 15,
    allIn: false,
    timedOut: false,
  }));
}

const LOG = [
  { t: 1, seatIndex: null, nickname: null, kind: 'ante', text: '每人下底注 5' },
  { t: 2, seatIndex: 1, nickname: NAMES[1], kind: 'call', amount: 5, text: '李雷 闷跟 5' },
  { t: 3, seatIndex: 2, nickname: NAMES[2], kind: 'look', text: '韩梅梅 看牌' },
  { t: 4, seatIndex: 2, nickname: NAMES[2], kind: 'raise', amount: 50, text: '韩梅梅 加注到 25，付 75' },
  { t: 5, seatIndex: 3, nickname: NAMES[3], kind: 'fold', text: '张三丰 弃牌' },
  { t: 6, seatIndex: 5, nickname: NAMES[5], kind: 'compare', targetSeat: 6, loserSeat: 6, text: '王二麻子 比牌 陈小春，陈小春 输' },
];

// 1. 满座 15 人，轮到本人，闷牌
function playingFull() {
  const now = Date.now();
  const states = { 3: 'folded', 6: 'lost', 9: 'folded', 13: 'folded' };
  const seats = fullTable();
  seats[7].online = false;
  seats[10].status = 'waitingNext';
  seats[14].status = 'sittingOut';
  return baseView({
    seats,
    hand: {
      handNo: 3,
      dealerSeat: 0,
      pot: 640,
      currentBet: 25,
      round: 3,
      turnSeat: 4,
      turnDeadline: now + 14000,
      players: players(states).filter((p) => p.seatIndex < 10 || p.seatIndex === 11),
      myCards: null,
      visible: [],
      actions: {
        call: { cost: 25 },
        raise: [
          { to: 50, cost: 50 },
          { to: 100, cost: 100 },
        ],
        compare: { cost: 25, targets: [0, 1, 2, 5, 8] },
        allIn: null,
      },
      canLook: true,
      canFold: true,
      ended: false,
      result: null,
      log: LOG,
    },
  });
}

// 2. 本人已看牌、比牌后 visible 里有对手的牌；明牌价
function playingSeen() {
  const v = playingFull();
  v.hand.players = v.hand.players.map((p) => (p.seatIndex === 4 ? { ...p, seen: true } : p));
  v.hand.myCards = cv([C(14, 's'), C(14, 'h'), C(9, 'd')], 'duizi', '对子 A');
  v.hand.canLook = false;
  v.hand.visible = [
    { seatIndex: 6, ...cv([C(13, 'c'), C(12, 'c'), C(2, 'd')], 'sanpai', '单张 K') },
  ];
  v.hand.actions = {
    call: { cost: 75 },
    raise: [{ to: 50, cost: 150 }],
    compare: { cost: 75, targets: [0, 1, 2, 5] },
    allIn: null,
  };
  return v;
}

// 3. 积分不足：孤注一掷
function playingAllIn() {
  const v = playingSeen();
  v.seats[4].chips = 40;
  v.hand.actions = { call: null, raise: [], compare: null, allIn: { cost: 40 } };
  return v;
}

// 4. 非本人回合（等待别人）
function playingWaiting() {
  const v = playingSeen();
  v.hand.turnSeat = 8;
  v.hand.actions = null;
  return v;
}

// 5. 准备阶段，本人是房主
function waitingOwner() {
  const seats = Array.from({ length: 15 }, () => null);
  [0, 1, 2, 4, 5, 8].forEach((i) => (seats[i] = seatView(i, { status: 'idle', chips: 500, ready: i % 2 === 1 })));
  return baseView({
    phase: 'waiting',
    handNo: 0,
    seats,
    me: { userId: 'u4', nickname: NAMES[4], seatIndex: 4, isOwner: true },
    ownerId: 'u4',
    hand: null,
  });
}

// 6. 准备阶段，观战者
function waitingSpectator() {
  const v = waitingOwner();
  v.me = { userId: 'u11', nickname: NAMES[11], seatIndex: null, isOwner: false };
  v.ownerId = 'u0';
  return v;
}

// 7. 局间：本局结果 + 倒计时 + 可亮牌
function between() {
  const v = playingSeen();
  const now = Date.now();
  v.hand.turnSeat = null;
  v.hand.turnDeadline = null;
  v.hand.actions = null;
  v.hand.ended = true;
  v.hand.players = v.hand.players.map((p) => (p.seatIndex === 4 ? { ...p, state: 'won' } : p));
  v.hand.visible = [
    { seatIndex: 2, ...cv([C(10, 'h'), C(10, 's'), C(5, 'c')], 'duizi', '对子 10') },
  ];
  v.hand.result = {
    reason: 'showdown',
    winners: [4],
    potWon: 640,
    bonus: { seatIndex: 4, type: 'baozi', total: 140 },
    deltas: [
      { seatIndex: 4, delta: 650 },
      { seatIndex: 2, delta: -75 },
      { seatIndex: 1, delta: -50 },
      { seatIndex: 0, delta: -30 },
    ],
    showable: true,
  };
  v.nextHandAt = now + 4000;
  return v;
}

// 8. 结算
function finished() {
  const v = between();
  v.phase = 'finished';
  v.nextHandAt = null;
  v.hand.result.showable = false;
  v.summary = {
    sessionNo: 2,
    endedAt: Date.now(),
    handsPlayed: 10,
    players: [
      { userId: 'u4', nickname: NAMES[4], net: 820, finalChips: 1320, bestType: 'baozi', wins: 4 },
      { userId: 'u2', nickname: NAMES[2], net: 130, finalChips: 630, bestType: 'shunjin', wins: 3 },
      { userId: 'u0', nickname: NAMES[0], net: -45, finalChips: 455, bestType: 'jinhua', wins: 2 },
      { userId: 'u1', nickname: NAMES[1], net: -300, finalChips: 200, bestType: 'duizi', wins: 1 },
      { userId: 'u5', nickname: NAMES[5], net: -605, finalChips: 0, bestType: null, wins: 0 },
    ],
  };
  return v;
}

// 9. 只有 3 个人
function small() {
  const v = playingSeen();
  const seats = Array.from({ length: 15 }, () => null);
  [4, 5, 9].forEach((i) => (seats[i] = seatView(i)));
  v.seats = seats;
  v.hand.players = players().filter((p) => [4, 5, 9].includes(p.seatIndex));
  v.hand.visible = [];
  v.hand.actions.compare.targets = [5, 9];
  return v;
}

// 10. 观战中的满座对局
function spectatorPlaying() {
  const v = playingFull();
  v.me = { userId: 'u11', nickname: NAMES[11], seatIndex: null, isOwner: false };
  v.hand.actions = null;
  v.hand.canLook = false;
  v.hand.canFold = false;
  v.hand.turnSeat = 8;
  return v;
}

export const SCENARIOS = [
  { id: 'full', label: '满座·轮到我(闷)', build: playingFull },
  { id: 'seen', label: '已看牌+visible', build: playingSeen },
  { id: 'allin', label: '孤注一掷', build: playingAllIn },
  { id: 'wait', label: '等别人行动', build: playingWaiting },
  { id: 'lobbyOwner', label: '准备·房主', build: waitingOwner },
  { id: 'lobbySpec', label: '准备·观战', build: waitingSpectator },
  { id: 'between', label: '局间结果', build: between },
  { id: 'finished', label: '结算榜', build: finished },
  { id: 'small', label: '3 人', build: small },
  { id: 'spec', label: '观战·满座', build: spectatorPlaying },
];

let chatId = 100;
const chatMsg = (seat, kind, text, userId) => ({
  id: ++chatId,
  t: Date.now(),
  userId: userId || 'u' + seat,
  nickname: userId === 'u11' ? NAMES[11] : NAMES[seat] || '观众',
  seatIndex: userId ? null : seat,
  kind,
  text,
});
export const MOCK_CHAT = [
  chatMsg(0, 'text', '大家好，开始吧'),
  chatMsg(2, 'emoji', '😎'),
  chatMsg(4, 'text', '这把稳了'),
  chatMsg(11, 'text', '我先看看你们打', 'u11'),
];
export const DEMO_EVENTS = [
  {
    label: '我赢了',
    ev: { kind: 'handEnd', result: { reason: 'lastStanding', winners: [4], potWon: 640, bonus: null, deltas: [{ seatIndex: 4, delta: 560 }, { seatIndex: 0, delta: -120 }, { seatIndex: 2, delta: -80 }], showable: true } },
  },
  {
    label: '豹子赢',
    ev: { kind: 'handEnd', result: { reason: 'showdown', winners: [4], potWon: 880, bonus: { seatIndex: 4, type: 'baozi', total: 200 }, deltas: [{ seatIndex: 4, delta: 1000 }, { seatIndex: 0, delta: -250 }], showable: true } },
  },
  { label: '补领', ev: { kind: 'rebuy', seat: 2, amount: 1000 } },
  { label: '聊天·左侧', ev: () => ({ kind: 'chat', msg: chatMsg(8, 'text', '快点吧，等得花儿都谢了') }) },
  { label: '聊天·右侧', ev: () => ({ kind: 'chat', msg: chatMsg(1, 'text', '跟不跟？给句痛快话') }) },
  { label: '聊天·顶部', ev: () => ({ kind: 'chat', msg: chatMsg(11, 'text', '闷到底，谁怕谁') }) },
  { label: '表情', ev: () => ({ kind: 'chat', msg: chatMsg(5, 'emoji', '😂') }) },
  { label: '观战发言', ev: () => ({ kind: 'chat', msg: chatMsg(0, 'text', '这局好精彩', 'u11') }) },
  { label: '发牌', ev: { kind: 'handStart', handNo: 3 } },
  { label: '比牌 4→5', ev: { kind: 'compare', fromSeat: 4, toSeat: 5, loserSeat: 5 } },
  { label: '比牌 8→4', ev: { kind: 'compare', fromSeat: 8, toSeat: 4, loserSeat: 8 } },
  { label: '孤注成功', ev: { kind: 'allIn', seat: 4, success: true } },
  { label: '孤注失败', ev: { kind: 'allIn', seat: 4, success: false } },
  {
    label: '本局结束',
    ev: {
      kind: 'handEnd',
      result: { reason: 'showdown', winners: [4], potWon: 640, bonus: null, deltas: [], showable: false },
    },
  },
  { label: '提示', ev: { kind: 'notice', text: '房主修改了配置，请重新准备' } },
  {
    label: '三连胜',
    ev: { kind: 'handEnd', result: { reason: 'lastStanding', winners: [4], potWon: 300, bonus: null, deltas: [{ seatIndex: 4, delta: 260 }], streak: { seatIndex: 4, n: 3 }, streakEnd: null, showable: true } },
  },
  ...[
    ['扔鸡蛋', 'egg', 2, 4],
    ['扔番茄', 'tomato', 8, 1],
    ['扔炸弹', 'bomb', 1, 8],
    ['送花', 'flower', 4, 5],
    ['飞吻', 'kiss', 5, 2],
    ['干杯', 'beer', 4, 8],
    ['点赞', 'like', 11, 4],
  ].map(([label, prop, from, to]) => ({
    label,
    ev: () => ({ kind: 'chat', msg: { ...chatMsg(from, 'prop', prop), toSeat: to, toUserId: 'u' + to, toNickname: NAMES[to] } }),
  })),
];
