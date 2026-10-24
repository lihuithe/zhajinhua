<script setup>
// 房间页的展示与交互主体。
// 与网络解耦：数据通过 props 传入（view / connected / offset），操作通过 request(action, data) 发出，
// 因此既可以接真实 WebSocket（RoomPage），也可以接假数据（DevTable）。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import TopBar from './TopBar.vue';
import SeatItem from './SeatItem.vue';
import TableCenter from './TableCenter.vue';
import MyArea from './MyArea.vue';
import CompareFx from './CompareFx.vue';
import InviteModal from './InviteModal.vue';
import RulesModal from './RulesModal.vue';
import SummaryModal from './SummaryModal.vue';
import LogPanel from './LogPanel.vue';
import SpectatorList from './SpectatorList.vue';
import Modal from '../Modal.vue';
import Avatar from '../Avatar.vue';
import ConfigForm from '../ConfigForm.vue';
import SoundButton from '../SoundButton.vue';
import ChatPanel from './ChatPanel.vue';
import FxLayer from './FxLayer.vue';
import PotPiles from './PotPiles.vue';
import { createGameAudio } from '../../lib/gameAudio';
import { betTier } from '../../lib/betTier';
import { sfx } from '../../lib/audio';
import { sysState } from '../../lib/sys';
import { useNow } from '../../lib/useNow';
import { toast, toastError, confirmDialog, cancelConfirm } from '../../lib/ui';
import { copyWithToast } from '../../lib/clipboard';
import { api } from '../../lib/api';
import { mergeDefaults, mergeLimits, normalizeConfig, validateConfig } from '../../lib/configMeta';
import { PROPS, propOf, PROP_FLY_MS, BOMB_FUSE_MS } from '../../lib/chatMeta';

const props = defineProps({
  view: { type: Object, required: true },
  connected: { type: Boolean, default: true },
  offset: { type: Number, default: 0 }, // serverTime - Date.now()
  request: { type: Function, required: true },
  chat: { type: Array, default: () => [] }, // 聊天记录
  restarting: { type: Boolean, default: false }, // 服务器更新重启中
});
const emit = defineEmits(['exit']);

const SEAT_COUNT = 15;

/* ---------- 基础派生数据 ---------- */
const nowRef = useNow();
const srvNow = computed(() => nowRef.value + props.offset);

/* ---------- 发牌状态（声音与动画共用） ---------- */
const deal = reactive({ on: false, handNo: 0, n: {} }); // n：座位号 -> 已发到手里的张数
let dealPending = 0; // 收到 handStart 后，等这一局的 state 到达再开始发牌

/* ---------- 声音 ---------- */
const gameAudio = createGameAudio({
  isDealing: () => deal.on || dealPending > 0,
  // 座位在牌桌上的左右方位 → 立体声声像（不拉满，免得一边耳朵太响）
  panOf: (i) => (g.value.a ? clamp((seatPos(i).x - g.value.cx) / g.value.a, -1, 1) * 0.7 : 0),
});
watch(
  () => props.view,
  (v) => v && gameAudio.onState(v),
  { immediate: true },
);
watch(srvNow, (t) => gameAudio.onTick(t));

const cfg = computed(() => props.view.config);
const hand = computed(() => props.view.hand);
const me = computed(() => props.view.me);
const phase = computed(() => props.view.phase);
const seats = computed(() => {
  const a = props.view.seats || [];
  return Array.from({ length: SEAT_COUNT }, (_, i) => a[i] || null);
});
const mySeatIdx = computed(() =>
  me.value.seatIndex === null || me.value.seatIndex === undefined ? null : me.value.seatIndex,
);
const seated = computed(() => mySeatIdx.value !== null);

const playerMap = computed(() => {
  const m = {};
  if (hand.value) hand.value.players.forEach((p) => (m[p.seatIndex] = p));
  return m;
});
const visMap = computed(() => {
  const m = {};
  if (hand.value) hand.value.visible.forEach((v) => (m[v.seatIndex] = v));
  return m;
});
const compareTargets = computed(() => {
  const a = hand.value && hand.value.actions;
  return a && a.compare ? a.compare.targets : [];
});
const turnSeat = computed(() => {
  const h = hand.value;
  return h && !h.ended && h.turnSeat !== null && h.turnSeat !== undefined ? h.turnSeat : -1;
});

/* ---------- 牌桌尺寸与座位几何 ---------- */
const tableEl = ref(null);
const box = reactive({ w: 0, h: 0 });
const isWide = ref(false);
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);
// 矮屏手机：操作区压缩成一行，给牌桌留空间
// 宽屏（电脑）矮于 640 时同样压缩；牌也按屏幕高度缩小，保证整页不出滚动条
const short = computed(() => (isWide.value ? vh.value < 640 : vh.value < 720));
let ro = null;
let mq = null;

function measure() {
  const el = tableEl.value;
  if (!el) return;
  box.w = el.clientWidth;
  box.h = el.clientHeight;
  vh.value = window.innerHeight;
}
function onMq() {
  isWide.value = !!(mq && mq.matches);
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && tableEl.value) {
    ro = new ResizeObserver(measure);
    ro.observe(tableEl.value);
  }
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
  if (window.matchMedia) {
    mq = window.matchMedia('(min-width: 1100px)');
    onMq();
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }
});
onBeforeUnmount(() => {
  if (ro) ro.disconnect();
  window.removeEventListener('resize', measure);
  window.removeEventListener('orientationchange', measure);
  if (mq) {
    if (mq.removeEventListener) mq.removeEventListener('change', onMq);
    else if (mq.removeListener) mq.removeListener(onMq);
  }
  clearAllTimers();
  gameAudio.dispose();
  sysState.busy = false;
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 牌桌是胶囊形（竖屏竖着、宽屏横着）。座位圆心落在桌沿（木质包边）的中线上。
const g = computed(() => {
  const W = box.w || 320;
  const H = box.h || 360;
  const d = Math.round(clamp(Math.min(W * 0.112, H * 0.09), 34, isWide.value ? 64 : 52)); // 头像直径
  const fs = Math.round(clamp(d * 0.25, 10, 14)); // 座位字号
  const plateH = Math.round(fs * 2.25 + 6 - d * 0.16); // 名牌露在头像下方的高度
  const sw = Math.round(clamp(d * 1.65, 62, 108)); // 名牌最大宽度
  const padX = Math.max(sw / 2, d / 2 + 6) + 2;
  const top = d / 2 + 16; // 顶部给倒计时胶囊留空间
  const bottom = d / 2 + plateH + 4;
  const a = Math.max(60, W / 2 - padX); // 座位路径半宽
  const b = Math.max(60, (H - top - bottom) / 2); // 座位路径半高
  const rail = Math.round(clamp(d * 0.34, 12, 22)); // 包边宽度
  return { W, H, d, fs, sw, plateH, a, b, cx: W / 2, cy: top + b, rail };
});

// 胶囊形路径上按弧长取点：t ∈ [0,1)，从底部中点出发，顺时针（屏幕上 下→左→上→右）
function stadiumPoint(t) {
  const { a, b, cx, cy } = g.value;
  const PI = Math.PI;
  if (b >= a) {
    const r = a;
    const h = b - a;
    let s = t * (4 * h + 2 * PI * r);
    const q = (PI * r) / 2;
    if (s < q) return arcPt(cx, cy + h, r, PI / 2 + s / r);
    s -= q;
    if (s < 2 * h) return { x: cx - r, y: cy + h - s };
    s -= 2 * h;
    if (s < PI * r) return arcPt(cx, cy - h, r, PI + s / r);
    s -= PI * r;
    if (s < 2 * h) return { x: cx + r, y: cy - h + s };
    s -= 2 * h;
    return arcPt(cx, cy + h, r, s / r);
  }
  const r = b;
  const h = a - b;
  let s = t * (4 * h + 2 * PI * r);
  if (s < h) return { x: cx - s, y: cy + r };
  s -= h;
  if (s < PI * r) return arcPt(cx - h, cy, r, PI / 2 + s / r);
  s -= PI * r;
  if (s < 2 * h) return { x: cx - h + s, y: cy - r };
  s -= 2 * h;
  if (s < PI * r) return arcPt(cx + h, cy, r, -PI / 2 + s / r);
  s -= PI * r;
  return { x: cx + h - s, y: cy + r };
}
function arcPt(ox, oy, r, th) {
  return { x: ox + r * Math.cos(th), y: oy + r * Math.sin(th) };
}

// 本人固定在底部中央；未入座时座位 0 在底部。座位号按顺时针增加。
function seatPos(i) {
  const base = mySeatIdx.value === null ? 0 : mySeatIdx.value;
  const k = (i - base + SEAT_COUNT) % SEAT_COUNT;
  return stadiumPoint(k / SEAT_COUNT);
}
const seatPositions = computed(() => seats.value.map((_, i) => seatPos(i)));

// 从座位指向牌桌“脊线”（胶囊中轴线段）的单位向量，即桌沿的内法线方向
function inward(p) {
  const { a, b, cx, cy } = g.value;
  let tx = cx;
  let ty = cy;
  if (b >= a) ty = clamp(p.y, cy - (b - a), cy + (b - a));
  else tx = clamp(p.x, cx - (a - b), cx + (a - b));
  const dx = tx - p.x;
  const dy = ty - p.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

const tableStyle = computed(() => {
  const { a, b, cx, cy, rail } = g.value;
  return {
    left: cx - a - rail / 2 + 'px',
    top: cy - b - rail / 2 + 'px',
    width: a * 2 + rail + 'px',
    height: b * 2 + rail + 'px',
    '--rail': rail + 'px',
  };
});
const centerW = computed(() => Math.round(clamp(Math.min(g.value.a, g.value.b) * (isWide.value ? 1.2 : 0.92), 124, 300)));
// 底池筹码堆显示的底池数：本局进行中跟着底池涨；本局结束后保留到赢家收筹码（winShow）再清空
const pilesPot = ref(0);
let pilesEndedHand = -1;
watch(
  () => (props.view.hand ? props.view.hand.handNo + ':' + props.view.hand.pot + ':' + props.view.hand.ended : ''),
  () => {
    const h = props.view.hand;
    if (!h || props.view.phase === 'waiting') {
      pilesPot.value = 0;
      return;
    }
    if (!h.ended) {
      pilesPot.value = h.pot;
      return;
    }
    // 兜底：没收到 handEnd 事件（例如刚进房间）也在几秒后清掉
    if (pilesEndedHand !== h.handNo) {
      pilesEndedHand = h.handNo;
      const hn = h.handNo;
      // 这里可能在 setup 一开始就执行（immediate），不能用后面才定义的 later()
      setTimeout(() => {
        const cur = props.view.hand;
        if (cur && cur.handNo === hn && cur.ended) pilesPot.value = 0;
      }, 4000);
    }
  },
  { immediate: true },
);
const pileGeo = computed(() => {
  const { a, b } = g.value;
  const cw = isWide.value ? 26 : 20;
  const holeW = centerW.value;
  const holeH = isWide.value ? 128 : 112;
  return {
    chipW: cw,
    holeW,
    holeH,
    ax: Math.min(a * 0.8, holeW / 2 + cw * 5),
    ay: Math.max(holeH / 2 + cw * 1.6, Math.min(b * 0.72, 165)),
  };
});
const cardW = computed(() => {
  if (isWide.value) return vh.value >= 760 ? 78 : vh.value >= 680 ? 66 : 56;
  return short.value ? 44 : box.w && box.w < 350 ? 50 : 58;
});

// 每位玩家本局下注额：放在座位内侧（朝桌心方向），避开名牌和倒计时
const bets = computed(() => {
  const h = hand.value;
  if (!h || h.ended) return [];
  const { d, plateH } = g.value;
  return h.players
    .filter((p) => p.bet > 0)
    .map((p) => {
      const s = seatPositions.value[p.seatIndex];
      const n = inward(s);
      const dist = d / 2 + 6 + Math.abs(n.x) * 30 + Math.abs(n.y) * 10 + Math.max(0, n.y) * plateH + Math.max(0, -n.y) * 16;
      return { seat: p.seatIndex, bet: p.bet, x: s.x + n.x * dist, y: s.y + n.y * dist };
    });
});

/* ---------- 当前行动者：聚光灯 + 桌心指针 + “轮到你了”横幅 ---------- */
let beamAcc = 0; // 累计角度，避免 350°→10° 时绕一大圈
const beamAngle = ref(0);
const beamOn = computed(() => turnSeat.value >= 0 && !!box.w && !deal.on);
watch(
  [turnSeat, () => g.value.cx, () => g.value.cy, mySeatIdx],
  () => {
    if (turnSeat.value < 0) return;
    const p = seatPos(turnSeat.value);
    const target = (Math.atan2(p.y - g.value.cy, p.x - g.value.cx) * 180) / Math.PI + 90;
    let d = (((target - beamAcc) % 360) + 540) % 360 - 180;
    beamAcc += d;
    beamAngle.value = beamAcc;
  },
  { immediate: true },
);
const beamSize = computed(() => Math.round(Math.sqrt(g.value.a * g.value.a + g.value.b * g.value.b) * 2.2));
const needleR = computed(() => Math.round(Math.max(centerW.value / 2, 64) + 16));
const myTurn = computed(() => turnSeat.value >= 0 && mySeatIdx.value !== null && turnSeat.value === mySeatIdx.value);
const turnFlash = ref(0);
const turnFlashY = ref(0);
// 紧迫感：轮到自己的最后 10 秒屏幕四周红色脉动，最后 5 秒屏幕中央大号倒数
const myLeft = computed(() => {
  const h = hand.value;
  if (!myTurn.value || deal.on || !h || !h.turnDeadline) return 99;
  return Math.max(0, Math.ceil((h.turnDeadline - srvNow.value) / 1000));
});
const urgent = computed(() => (myLeft.value <= 5 ? 2 : myLeft.value <= 10 ? 1 : 0));
// 本人行动期间不弹系统通知弹窗；轮次过了（超时 / 本局结束）就关掉还没点的比牌、弃牌确认框
watch(myTurn, (v) => {
  sysState.busy = v;
  if (!v) cancelConfirm('turn');
}, { immediate: true });
watch(
  () => (myTurn.value && hand.value && !deal.on ? hand.value.handNo + ':' + hand.value.turnDeadline : ''),
  (k) => {
    if (!k) return;
    const key = ++fxKey;
    turnFlashY.value = fxOrigin().y + g.value.cy;
    turnFlash.value = key;
    later(() => {
      if (turnFlash.value === key) turnFlash.value = 0;
    }, 1700);
  },
);

/* ---------- 牌桌特效：筹码飞行、动作气泡、赢牌演出 ---------- */
const fxl = ref(null);
const bodyEl = ref(null);
// 牌桌区域左上角在屏幕上的位置：特效层铺满全屏，用它把牌桌坐标换算成屏幕坐标
function fxOrigin() {
  const el = tableEl.value;
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top };
}
const reduceMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const potXY = () => ({ x: g.value.cx, y: g.value.cy });
// 座位旁边（朝桌心方向）的位置：气泡、飘字用
function sideXY(i, extra = 0) {
  const p = seatPos(i);
  const n = inward(p);
  const { d, plateH } = g.value;
  const dist = d / 2 + 22 + extra + Math.abs(n.x) * 18 + Math.max(0, n.y) * plateH;
  return { x: p.x + n.x * dist, y: p.y + n.y * dist };
}
// 震屏：整个牌桌 + 两侧面板一起震
function shake(level = 1) {
  const el = bodyEl.value || tableEl.value;
  if (!el || !el.animate || reduceMotion) return;
  const a = 3 * level;
  el.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${-a}px, ${a / 2}px)` },
      { transform: `translate(${a}px, ${-a / 2}px)` },
      { transform: `translate(${-a / 2}px, ${a}px)` },
      { transform: `translate(${a / 2}px, ${-a / 3}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 280 + level * 70, easing: 'ease-out' },
  );
}
const stripName = (e) => (e.nickname && e.text.indexOf(e.nickname) === 0 ? e.text.slice(e.nickname.length).trim() : e.text);
const chipCount = (amount, min, max) => Math.max(min, Math.min(max, Math.round((amount || 0) / Math.max(1, cfg.value.ante))));

// 推筹码：按豪气等级（1 普通 / 2 有点料 / 3 豪气 / 4 霸气）一级比一级夸张
function pushFx(seat, amount, tier, delay) {
  const F = fxl.value;
  const from = seatPos(seat);
  const pot = potXY();
  if (tier <= 1) {
    F.chips(from, pot, chipCount(amount, 2, 3), { delay });
    return;
  }
  if (tier === 2) {
    F.chips(from, pot, chipCount(amount, 4, 6), { delay, gap: 32 });
    later(() => F.burst(pot, 8), delay + 520);
    return;
  }
  const big = tier >= 4;
  F.stack(from, pot, big ? 11 : 7, { delay, dur: big ? 700 : 620, color: seat });
  if (big) F.stack(from, pot, 8, { delay: delay + 140, dur: 700, color: seat + 1 });
  F.chips(from, pot, big ? 8 : 4, { delay: delay + 80, gap: 28, dur: 600 });
  later(() => {
    F.splash(pot, big ? 20 : 11, { spread: big ? 110 : 75 });
    F.ring(pot, 'rgba(255,214,110,.95)', big ? 260 : 170);
    F.burst(pot, big ? 22 : 14);
    if (big) {
      F.ring(pot, 'rgba(255,90,50,.9)', 360, { delay: 120 });
      F.flash('rgba(255,170,40,.5)', 700);
      F.floatNum({ x: pot.x, y: pot.y - 40 }, '+' + amount, 'gain', { size: 1.5 });
    }
    shake(big ? 2.4 : 1.2);
  }, delay + (big ? 640 : 560));
}

function fxForLog(e, h, delay) {
  const F = fxl.value;
  if (!F) return;
  const seat = e.seatIndex;
  if (e.kind === 'ante') {
    h.players.forEach((p, k) => F.chips(seatPos(p.seatIndex), potXY(), 1, { delay: delay + k * 50 }));
    return;
  }
  if (seat === null || seat === undefined || seat < 0) return;
  const from = seatPos(seat);
  const ante = cfg.value.ante;
  switch (e.kind) {
    case 'call': {
      const t = betTier('call', e.amount, ante);
      pushFx(seat, e.amount, t, delay);
      if (t >= 4) F.callout(sideXY(seat), '霸气跟到底!', 'allin', true);
      else if (t === 3) F.callout(sideXY(seat), '豪气跟注!', 'raise', true);
      else F.callout(sideXY(seat), stripName(e), 'call', t === 2);
      break;
    }
    case 'raise': {
      const m = /加注到\s*(\d+)/.exec(e.text);
      const t = betTier('raise', e.amount, ante);
      pushFx(seat, e.amount, t, delay);
      F.callout(sideXY(seat), (t >= 4 ? '霸气加注 ' : '加注 ') + (m ? m[1] : '') + '!', t >= 4 ? 'allin' : 'raise', true);
      break;
    }
    case 'look':
      F.callout(sideXY(seat), '看牌', 'look');
      break;
    case 'fold':
      F.callout(sideXY(seat), '弃牌', 'fold');
      break;
    case 'compare':
      F.chips(from, potXY(), chipCount(e.amount, 2, 5), { delay });
      F.callout(sideXY(seat), '比牌!', 'compare', true);
      break;
    case 'allIn':
      pushFx(seat, e.amount, 4, delay);
      F.callout(sideXY(seat), '孤注一掷!', 'allin', true);
      break;
    case 'timeout':
      F.callout(sideXY(seat), '超时', 'info');
      break;
    case 'show':
      F.callout(sideXY(seat), '亮牌', 'look');
      break;
    default:
      break;
  }
}

// 从操作记录里取新增的条目播特效（首次进入/重连只记录基线，不补播）
let fxHand = -1;
let fxDone = new Set();
let fxInit = false;
const logKey = (e) => e.t + '|' + e.kind + '|' + e.seatIndex + '|' + e.text;
watch(
  () => props.view,
  (v) => {
    const h = v && v.hand;
    if (!h) return;
    if (!fxInit) {
      fxInit = true;
      fxHand = h.handNo;
      fxDone = new Set(h.log.map(logKey));
      return;
    }
    if (h.handNo !== fxHand) {
      fxHand = h.handNo;
      fxDone = new Set();
    }
    const fresh = h.log.filter((e) => !fxDone.has(logKey(e)));
    fresh.forEach((e) => fxDone.add(logKey(e)));
    if (!box.w || reduceMotion) return;
    fresh.slice(-8).forEach((e, k) => fxForLog(e, h, k * 80));
  },
);

// 局面提示：最后一轮、只剩两人
let lastRoundKey = '';
let twoLeftKey = '';
watch(
  () => props.view,
  (v) => {
    const h = v && v.hand;
    const F = fxl.value;
    if (!h || h.ended || !F || !box.w || reduceMotion) return;
    const active = h.players.filter((p) => p.state === 'active').length;
    if (h.round >= cfg.value.maxRounds && active >= 2 && lastRoundKey !== h.handNo + '') {
      lastRoundKey = h.handNo + '';
      F.banner('最后一轮', '轮数到顶将强制开牌', 'allin', { dur: 1900 });
      F.flash('rgba(255,60,40,.45)', 800);
    }
    if (active === 2 && h.players.length > 2 && twoLeftKey !== h.handNo + '') {
      twoLeftKey = h.handNo + '';
      // 正在播比牌动画时，等它播完再提示，免得挡住“谁和谁比牌”
      const wait = Math.max(0, compareUntil - Date.now());
      later(() => {
        if (!fxl.value) return;
        fxl.value.callout({ x: g.value.cx, y: g.value.cy - Math.min(g.value.b * 0.45, 120) }, '最后两位，狭路相逢!', 'compare', true);
        fxl.value.ring(potXY(), 'rgba(255,90,60,.9)', 220);
      }, wait);
    }
  },
);

function vibrate(p) {
  try {
    if (navigator.vibrate) navigator.vibrate(p);
  } catch (e) {
    /* 忽略 */
  }
}
// 输了：整个画面短暂变灰
function loseFx() {
  const el = bodyEl.value;
  if (!el || !el.animate) return;
  el.animate(
    [
      { filter: 'none' },
      { filter: 'grayscale(0.9) brightness(0.7)', offset: 0.15 },
      { filter: 'grayscale(0.9) brightness(0.7)', offset: 0.7 },
      { filter: 'none' },
    ],
    { duration: 2200, easing: 'ease-out' },
  );
}
const TYPE_TITLE = { baozi: '豹子！', shunjin: '顺金！' };
// 赢牌演出：先停顿半拍 → 底池筹码分两波飞向赢家 → 赢家冲击波 + 飘字；
// 自己赢了：全屏金光 + 横幅数字滚动 + 彩带 + 金币喷泉 + 金币雨；自己输了：画面变灰 + 暗角 + “输了”
function winShow(r) {
  const F = fxl.value;
  if (!F || !box.w) return;
  const me = mySeatIdx.value;
  const iWin = me !== null && r.winners.indexOf(me) >= 0;
  const myD = r.deltas.find((d) => d.seatIndex === me);
  const myDelta = myD ? myD.delta : 0;
  const iLose = !!myD && !iWin && myDelta < 0;
  const bigWin = iWin && myDelta >= cfg.value.ante * 25;
  let t = 380;
  if (r.bonus) {
    F.banner(TYPE_TITLE[r.bonus.type] || '大牌！', nameOfSeat(r.bonus.seatIndex) + ' 喜钱 +' + r.bonus.total, r.bonus.type);
    F.flash('rgba(255,180,40,.55)', 900);
    F.glow('rgba(255,190,60,.55)', 1500);
    F.rain(70);
    F.confetti(60);
    shake(3);
    vibrate([60, 40, 60, 40, 120]);
    t = 1500;
  }
  later(() => {
    r.winners.forEach((w) => {
      const n = chipCount(r.potWon, 10, 24);
      F.chips(potXY(), seatPos(w), n, { gap: 24, dur: 650, spread: 14, coin: true });
      F.chips(potXY(), seatPos(w), Math.round(n / 2), { delay: 260, gap: 30, dur: 700, spread: 18 });
      later(() => {
        F.burst(seatPos(w), 22);
        F.ring(seatPos(w), 'rgba(255,214,110,.95)', 150);
        F.floatNum(sideXY(w, 6), '+' + r.potWon, 'gain', { size: iWin && w === me ? 1.6 : 1.25 });
      }, 620 + n * 12);
    });
    r.deltas
      .filter((d) => d.delta < 0)
      .forEach((d) => F.floatNum(sideXY(d.seatIndex, 6), String(d.delta), 'loss', { delay: 250, size: d.seatIndex === me ? 1.3 : 0.9 }));
    if (iWin) {
      later(() => {
        F.glow('rgba(255,205,80,.6)', 1800);
        F.flash('rgba(255,200,60,.6)', 1000);
        F.banner(bigWin ? '大赢家' : '你赢了', '', bigWin ? 'baozi' : 'win', { dur: bigWin ? 2900 : 2400, count: Math.max(0, myDelta) });
        F.confetti(bigWin ? 120 : 70);
        F.fountain(seatPos(me), bigWin ? 46 : 28);
        F.rain(bigWin ? 60 : 34, { dur: 1900 });
        shake(bigWin ? 3 : 2);
        vibrate(bigWin ? [80, 50, 80, 50, 200] : [80, 60, 140]);
      }, 650);
    } else if (iLose) {
      later(() => {
        loseFx();
        F.glow('rgba(0,0,0,.8)', 2000, { dark: true });
        F.banner('输了', '', 'lose', { dur: 2000, count: -myDelta, prefix: '-' });
        shake(1);
        vibrate([200]);
      }, 600);
    }
  }, t);
}

/* ---------- 操作封装 ---------- */
const busy = ref(false);
async function act(action, data) {
  if (busy.value) return false;
  busy.value = true;
  try {
    await props.request(action, data);
    return true;
  } catch (e) {
    toastError(e.message || '操作失败');
    return false;
  } finally {
    busy.value = false;
  }
}

/* ---------- 比牌选择模式 ---------- */
const comparing = ref(false);
watch(compareTargets, (t) => {
  if (!t.length) comparing.value = false;
});
// 点“比牌”：只剩一个可比的对手就直接确认；多个对手则进入选人模式（牌桌压暗，可选的对手跳动提示）
function toggleCompare(on) {
  if (!on) {
    comparing.value = false;
    return;
  }
  const t = compareTargets.value;
  if (t.length === 1) {
    confirmCompare(t[0]);
    return;
  }
  comparing.value = true;
}
async function confirmCompare(i) {
  const s = seats.value[i];
  const a = hand.value && hand.value.actions;
  if (!a || !a.compare) return;
  const ok = await confirmDialog({
    title: '比牌',
    message: '与「' + (s ? s.nickname : '座位' + (i + 1)) + '」比牌，需付 ' + a.compare.cost + ' 积分。确定吗？',
    okText: '比牌',
    tag: 'turn',
  });
  if (!ok) return;
  comparing.value = false;
  act('game.compare', { targetSeat: i });
}

async function seatClick(i) {
  const s = seats.value[i];
  if (comparing.value) {
    if (compareTargets.value.indexOf(i) < 0) {
      toast('请点击头上有“点我比牌”的对手', 'info', 1800);
      return;
    }
    confirmCompare(i);
    return;
  }
  if (!s) {
    if (me.value.isOwner) emptyMenu.value = i;
    else if (!seated.value) act('seat.sit', { seatIndex: i });
    return;
  }
  seatMenu.value = i;
}

/* ---------- 空座位菜单 / 机器人 ---------- */
const emptyMenu = ref(null);
const emptyOpen = computed({
  get: () => emptyMenu.value !== null && !seats.value[emptyMenu.value],
  set: (v) => {
    if (!v) emptyMenu.value = null;
  },
});
const hasEmptySeat = computed(() => seats.value.some((s) => !s));
function emptyDo(kind) {
  const i = emptyMenu.value;
  emptyMenu.value = null;
  if (i === null) return;
  if (kind === 'sit') act('seat.sit', { seatIndex: i });
  else addBot(i);
}
function addBot(i) {
  act('room.addBot', i === undefined ? {} : { seatIndex: i });
}

/* ---------- 座位菜单 / 踢人 ---------- */
const seatMenu = ref(null); // 被点开的座位号
const menuOpen = computed({
  get: () => seatMenu.value !== null && !!seats.value[seatMenu.value],
  set: (v) => {
    if (!v) seatMenu.value = null;
  },
});
const canKick = computed(() => !!me.value.isOwner);
// 自己能否改为观战模式：本局对局中（含已弃牌）不能
const canStandSelf = computed(() => {
  if (!seated.value) return false;
  const h = hand.value;
  return !(h && !h.ended && playerMap.value[mySeatIdx.value]);
});
async function standUp() {
  let msg = '改为观战模式后，你会离开座位，只能观看。';
  if (phase.value === 'playing') {
    msg += '本场结束前坐回来，积分保持不变。';
    const others = seats.value.filter((s) => s && s.userId !== me.value.userId && s.chips >= cfg.value.ante).length;
    if (others < 2) msg += '\n桌上将不足 2 名有积分的玩家，本场会暂停，等有人坐下再继续。';
  }
  const ok = await confirmDialog({ title: '改为观战模式', message: msg, okText: '改为观战' });
  if (!ok) return;
  seatMenu.value = null;
  act('seat.stand');
}
// 踢人：任何阶段都可以；可勾选“不允许再进入本房间”
const kickTarget = ref(null);
const kickBan = ref(false);
const kickOpen = computed({
  get: () => !!kickTarget.value,
  set: (v) => {
    if (!v) kickTarget.value = null;
  },
});
function kick(m) {
  seatMenu.value = null;
  specOpen.value = false;
  kickBan.value = false;
  const seatIndex = m.seatIndex === undefined ? null : m.seatIndex;
  kickTarget.value = { userId: m.userId, nickname: m.nickname, isBot: !!m.isBot, seatIndex };
}
const kickNote = computed(() => {
  const t = kickTarget.value;
  if (!t) return '';
  const h = hand.value;
  const p = t.seatIndex !== null ? playerMap.value[t.seatIndex] : null;
  if (p && p.state === 'active' && h && !h.ended) return '对方正在对局中：会自动弃牌（本局已下的注不退还），本局结束后离开座位。';
  if (t.isBot) return '机器人会离开座位。';
  return t.seatIndex !== null ? '对方会离开座位并退出房间，积分不再保留。' : '对方会退出房间。';
});
async function doKick() {
  const t = kickTarget.value;
  if (!t) return;
  if (await act('room.kick', { userId: t.userId, ban: !t.isBot && kickBan.value })) kickTarget.value = null;
}
const menuInfo = computed(() => {
  const s = seatMenu.value === null ? null : seats.value[seatMenu.value];
  if (!s) return null;
  const p = playerMap.value[s.seatIndex];
  let st = '';
  if (!s.online) st = '掉线';
  else if (p) st = { active: p.seen ? '已看牌' : '闷牌', folded: '已弃牌', lost: '比牌输', won: '赢家' }[p.state] || '';
  else if (s.status === 'sittingOut') st = '积分不足，本局不参与';
  else if (s.status === 'waitingNext') st = '等待下一局';
  else if (phase.value === 'waiting') st = s.ready ? '已准备' : '未准备';
  if (s.isBot) st = (st ? st + ' · ' : '') + '机器人';
  return { s, st, isOwner: s.userId === props.view.ownerId, isMe: s.userId === me.value.userId, isBot: !!s.isBot };
});

/* ---------- 聊天：气泡 / 观战弹幕 / 未读 ---------- */
const chatOpen = ref(false);
const unread = ref(0);
// 清空聊天只影响自己这台设备：记下清空时最后一条消息，之前的不再显示
const CLEAR_KEY = 'zjh_chat_cleared_';
function loadCleared() {
  try {
    return JSON.parse(localStorage.getItem(CLEAR_KEY + props.view.code) || 'null');
  } catch (e) {
    return null;
  }
}
const chatCleared = ref(loadCleared());
const chatShown = computed(() => {
  const c = chatCleared.value;
  return c ? props.chat.filter((m) => !(m.id <= c.id && m.t <= c.t)) : props.chat;
});
function clearChat() {
  const last = props.chat[props.chat.length - 1];
  if (!last) return;
  chatCleared.value = { id: last.id, t: last.t };
  try {
    localStorage.setItem(CLEAR_KEY + props.view.code, JSON.stringify(chatCleared.value));
  } catch (e) {
    /* 忽略 */
  }
}
watch(chatOpen, (v) => v && (unread.value = 0));
async function sendChat(m) {
  try {
    await props.request('chat.send', m);
  } catch (e) {
    toastError(e.message || '发送失败');
    throw e;
  }
}
const bubbles = reactive({}); // seatIndex -> { key, kind, text }
const specLines = ref([]); // 观战者的消息弹幕
function onChat(msg) {
  if (msg.userId !== me.value.userId && !isWide.value && !chatOpen.value) unread.value++;
  if (msg.kind === 'prop') {
    propFx(msg);
    return;
  }
  const s = msg.seatIndex !== null && msg.seatIndex !== undefined ? seats.value[msg.seatIndex] : null;
  const key = ++fxKey;
  if (s && s.userId === msg.userId) {
    bubbles[msg.seatIndex] = { key, kind: msg.kind, text: msg.text };
    later(() => {
      if (bubbles[msg.seatIndex] && bubbles[msg.seatIndex].key === key) delete bubbles[msg.seatIndex];
    }, msg.kind === 'emoji' ? 2600 : 4200);
  } else {
    specLines.value = specLines.value.concat([{ key, nickname: msg.nickname, kind: msg.kind, text: msg.text }]).slice(-3);
    later(() => (specLines.value = specLines.value.filter((x) => x.key !== key)), 4500);
  }
}
// 互动道具：从发送者的座位（观战者从牌桌上方）飞到目标头像；砸到自己时震一下
function propFx(msg) {
  const p = propOf(msg.text);
  const F = fxl.value;
  const to = msg.toSeat;
  if (!p || !F || !box.w || to === null || to === undefined || !seats.value[to]) return;
  const fromSeat = msg.seatIndex !== null && msg.seatIndex !== undefined && seats.value[msg.seatIndex] ? msg.seatIndex : null;
  const from = fromSeat !== null ? seatPos(fromSeat) : { x: g.value.cx + (Math.random() - 0.5) * g.value.a, y: -10 };
  F.prop(from, seatPos(to), p.id, { icon: p.icon, fly: PROP_FLY_MS, fuse: BOMB_FUSE_MS, size: g.value.d });
  if (to === mySeatIdx.value && p.mean) {
    const hit = PROP_FLY_MS + (p.id === 'bomb' ? BOMB_FUSE_MS : 0);
    later(() => {
      shake(p.id === 'bomb' ? 2.2 : 1);
      vibrate(p.id === 'bomb' ? [80, 40, 160] : [50]);
    }, hit);
  }
}
async function sendProp(id) {
  const i = seatMenu.value;
  if (i === null) return;
  seatMenu.value = null;
  try {
    await props.request('chat.send', { kind: 'prop', text: id, toSeat: i });
  } catch (e) {
    toastError(e.message || '发送失败');
  }
}

// 气泡朝桌心方向弹出，避免被屏幕边缘截掉
function bubbleStyle(seat) {
  const p = seatPositions.value[seat];
  const n = inward(p);
  const { d, plateH, W } = g.value;
  let x = p.x;
  let y = p.y;
  let cls = 'up';
  if (Math.abs(n.x) > Math.abs(n.y) * 1.2) {
    x = p.x + n.x * (d / 2 + 8);
    cls = n.x > 0 ? 'right' : 'left';
  } else if (n.y < 0) {
    y = p.y - d / 2 - 16;
    cls = 'up';
  } else {
    y = p.y + d / 2 + plateH + 8;
    cls = 'down';
  }
  if (cls === 'up' || cls === 'down') x = clamp(x, 80, W - 80);
  return { style: { left: x + 'px', top: y + 'px' }, cls };
}
const bubbleList = computed(() =>
  Object.keys(bubbles).map((k) => {
    const seat = Number(k);
    const b = bubbles[k];
    const pos = bubbleStyle(seat);
    return { seat, key: b.key, kind: b.kind, text: b.text, style: pos.style, cls: pos.cls };
  }),
);

/* ---------- 弹窗 ---------- */
const inviteOpen = ref(false);
const rulesOpen = ref(false);
const roomMenuOpen = ref(false);
function menuDo(fn) {
  roomMenuOpen.value = false;
  fn();
}
const specOpen = ref(false);
const logOpen = ref(false);
const showSummary = ref(false);
watch(
  () => (props.view.summary ? props.view.summary.sessionNo : 0),
  (n) => {
    showSummary.value = !!n;
  },
  { immediate: true },
);

const cfgOpen = ref(false);
const editCfg = ref(null);
const cfgFormRef = ref(null);
const limits = ref(mergeLimits(null));
function openConfig() {
  // 旧房间的配置可能缺少后来新增的项：用默认值补齐
  editCfg.value = mergeDefaults(cfg.value);
  cfgOpen.value = true;
  api
    .configDefaults()
    .then((r) => (limits.value = mergeLimits(r.limits)))
    .catch(() => {});
}
async function saveConfig() {
  const c = normalizeConfig(editCfg.value);
  const errs = validateConfig(c, limits.value);
  const keys = Object.keys(errs);
  if (keys.length) {
    if (cfgFormRef.value) cfgFormRef.value.revealErrors();
    toast(errs[keys[0]], 'error', 3200);
    return;
  }
  if (await act('room.updateConfig', { config: c })) {
    cfgOpen.value = false;
    toast('配置已更新，所有人需要重新准备', 'ok');
  }
}

async function endSession() {
  const ok = await confirmDialog({
    title: '提前结束本场',
    message: '当前局将作废并退还本局下注，然后进入结算。确定吗？',
    okText: '结束本场',
    danger: true,
  });
  if (ok) act('room.endSession');
}

async function exitRoom() {
  const h = hand.value;
  const live = !!(h && !h.ended && seated.value && playerMap.value[mySeatIdx.value]);
  const ok = await confirmDialog({
    title: '退出房间',
    message: live ? '你正在对局中，退出将自动弃牌。确定退出吗？' : '确定退出房间吗？',
    okText: '退出',
    danger: true,
  });
  if (!ok) return;
  try {
    await props.request('room.leave');
  } catch (e) {
    if (e.code !== 'NOT_IN_ROOM') {
      toastError(e.message || '退出失败');
      return;
    }
  }
  emit('exit');
}

function copyCode() {
  copyWithToast(props.view.code, '房间号已复制');
}

/* ---------- 事件动画 ---------- */
const fx = reactive({ compare: null, allIn: null, glow: [] });
const timers = [];
let fxKey = 0;
let compareUntil = 0; // 比牌动画播放到什么时候
function later(fn, ms) {
  const t = setTimeout(() => {
    const i = timers.indexOf(t);
    if (i >= 0) timers.splice(i, 1);
    fn();
  }, ms);
  timers.push(t);
}
function clearAllTimers() {
  timers.forEach(clearTimeout);
  timers.length = 0;
}

function nameOfSeat(i) {
  const s = seats.value[i];
  if (s) return s.nickname;
  const p = playerMap.value[i];
  return p ? p.nickname : '座位' + (i + 1);
}
function idOfSeat(i) {
  const s = seats.value[i];
  if (s) return s.userId;
  const p = playerMap.value[i];
  return p ? p.userId : String(i);
}

/* ---------- 发牌：荷官从桌心的牌堆一张一张发，从庄家下家开始，每人 3 张 ---------- */
// 节奏与服务端 dealDurationMs 一致（服务端据此顺延第一位行动者的倒计时）
const DEAL_LEAD = 500; // 先让底注筹码飞进底池
const DEAL_FLY = 450; // 每张牌飞行时长
const dealGap = (n) => clamp(Math.round(3000 / (3 * n)), 100, 280);
// 牌落点：别人落在头像右侧的牌背处；自己的飞进下方手牌区对应的那张牌（屏幕坐标）
function holdXY(i) {
  const p = seatPos(i);
  return { x: p.x + g.value.d * 0.62, y: p.y };
}
function myCardXY(k) {
  const el = document.querySelectorAll('.hero .cards .pc')[k];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, abs: true };
}
function runDeal(h) {
  const ps = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
  const k0 = ps.indexOf(h.dealerSeat);
  const order = k0 >= 0 ? ps.slice(k0 + 1).concat(ps.slice(0, k0 + 1)) : ps;
  const F = fxl.value;
  if (!F || !box.w || reduceMotion || !order.length) {
    sfx('deal');
    return;
  }
  const gap = dealGap(order.length);
  const total = DEAL_LEAD + 3 * order.length * gap + DEAL_FLY;
  const hn = h.handNo;
  const n = {};
  order.forEach((s) => (n[s] = 0));
  deal.handNo = hn;
  deal.n = n;
  deal.on = true;
  // 牌堆放在桌心上方（荷官的位置），不挡住底池
  const from = { x: g.value.cx, y: g.value.cy - Math.min(g.value.b * 0.5, 150) };
  F.deck(from, total - DEAL_FLY + 300);
  let k = 0;
  for (let r = 1; r <= 3; r++) {
    for (const s of order) {
      const t = DEAL_LEAD + k++ * gap;
      const mine = s === mySeatIdx.value;
      later(() => {
        if (deal.handNo !== hn || !fxl.value) return;
        const to = mine ? myCardXY(r - 1) : null;
        if (to) fxl.value.card(from, to, { dur: DEAL_FLY + 80, w: cardW.value, s0: 0.3, keep: 30, spin: (r - 2) * 9, exact: true });
        else fxl.value.card(from, holdXY(s), { dur: DEAL_FLY, w: 18, keep: 120, spin: (r - 2) * 14 });
        sfx('card', { gain: 0.85 });
      }, t);
      later(() => {
        if (deal.handNo === hn) deal.n[s] = r;
      }, t + DEAL_FLY + (mine ? 60 : -30));
    }
  }
  later(() => {
    if (deal.handNo === hn) deal.on = false;
  }, total);
}
watch(
  () => props.view,
  (v) => {
    const h = v && v.hand;
    if (!dealPending || !h) return;
    if (h.handNo === dealPending) {
      dealPending = 0;
      runDeal(h);
    } else if (h.handNo > dealPending) dealPending = 0;
  },
);
const dealingNow = computed(() => !!(deal.on && hand.value && deal.handNo === hand.value.handNo));
// 发牌期间先不高亮行动者（服务端已把第一位的倒计时顺延了发牌时长）
const shownTurn = computed(() => (dealingNow.value ? -1 : turnSeat.value));
// 每个座位手里扣着几张牌（别人的牌背；自己的牌显示在操作区）
const holdMap = computed(() => {
  const m = {};
  const h = hand.value;
  if (!h) return m;
  h.players.forEach((p) => {
    const i = p.seatIndex;
    if (i === mySeatIdx.value || visMap.value[i]) return;
    if (p.state !== 'active' && p.state !== 'won') return;
    m[i] = dealingNow.value ? deal.n[i] || 0 : 3;
  });
  return m;
});
const myDealt = computed(() => (dealingNow.value && mySeatIdx.value !== null ? deal.n[mySeatIdx.value] || 0 : 3));

function handleEvent(ev) {
  if (!ev) return;
  gameAudio.onEvent(ev);
  if (ev.kind === 'chat' && ev.msg) {
    onChat(ev.msg);
    return;
  }
  switch (ev.kind) {
    case 'notice':
      toast(ev.text);
      break;
    case 'handStart':
      dealPending = ev.handNo;
      deal.on = false;
      break;
    case 'compare': {
      compareUntil = Date.now() + 2400;
      turnFlash.value = 0;
      const o = fxOrigin();
      const a = seatPos(ev.fromSeat);
      const b = seatPos(ev.toSeat);
      const key = ++fxKey;
      fx.compare = {
        key,
        cx: Math.round(window.innerWidth / 2),
        cy: Math.round(window.innerHeight * 0.45),
        size: Math.round(clamp(Math.min(window.innerWidth, window.innerHeight) * 0.13, 64, 128)),
        from: { x: a.x + o.x, y: a.y + o.y, userId: idOfSeat(ev.fromSeat), name: nameOfSeat(ev.fromSeat) },
        to: { x: b.x + o.x, y: b.y + o.y, userId: idOfSeat(ev.toSeat), name: nameOfSeat(ev.toSeat) },
        loser: ev.loserSeat === ev.fromSeat ? 'from' : 'to',
        me: ev.fromSeat === mySeatIdx.value ? 'from' : ev.toSeat === mySeatIdx.value ? 'to' : '',
      };
      later(() => {
        if (fx.compare && fx.compare.key === key) fx.compare = null;
      }, 2650);
      later(() => {
        shake(2);
        if (fxl.value) fxl.value.flash('rgba(255,240,200,.45)', 350);
      }, 480);
      break;
    }
    case 'allIn': {
      const key = ++fxKey;
      fx.allIn = { key, text: nameOfSeat(ev.seat) + ' 孤注一掷', ok: !!ev.success };
      if (fxl.value) fxl.value.flash('rgba(255,50,30,.6)', 900);
      shake(2);
      later(() => {
        if (fx.allIn && fx.allIn.key === key) fx.allIn = null;
      }, 2200);
      break;
    }
    case 'handEnd': {
      const r = ev.result;
      if (!r) break;
      if (r.reason === 'voided') {
        pilesPot.value = 0;
        toast('本局作废，已退还下注');
        break;
      }
      // 比牌直接结束本局时，等比牌动画播完再上结算演出
      const wait = Math.max(0, compareUntil - Date.now());
      later(() => (pilesPot.value = 0), wait + 450);
      later(() => {
        fx.glow = r.winners.slice();
        later(() => (fx.glow = []), 3600);
        if (!reduceMotion) winShow(r);
      }, wait);
      break;
    }
    case 'rebuy':
      if (fxl.value && box.w) {
        const p = seatPos(ev.seat);
        const o = fxOrigin();
        fxl.value.chips({ x: p.x + o.x, y: -30, abs: true }, p, 8, { coin: true, gap: 40, dur: 800 });
        later(() => fxl.value && fxl.value.floatNum(sideXY(ev.seat, 6), '+' + ev.amount + ' 补领', 'rebuy'), 650);
      }
      break;
    case 'sessionEnd': {
      showSummary.value = true;
      const top = ev.summary && ev.summary.players && ev.summary.players[0];
      if (top && top.userId === me.value.userId && top.net > 0 && fxl.value && !reduceMotion) {
        fxl.value.rain(70);
        fxl.value.banner('本场大赢家', '+' + top.net, 'win', { dur: 2600 });
      }
      break;
    }
    case 'kicked':
      toast(ev.banned ? '你已被房主移出房间，且不能再进入' : '你已被房主移出房间', 'error', 3000);
      emit('exit');
      break;
    case 'dissolved':
      toast(ev.text || '房间已被管理员解散', 'error', 4000);
      emit('exit');
      break;
    default:
      break;
  }
}
defineExpose({ handleEvent });

const log = computed(() => (hand.value ? hand.value.log : []));
</script>

<template>
  <div class="room" :class="{ wide: isWide }">
    <div v-if="!connected" class="conn">{{ restarting ? '服务器更新中，正在重连…' : '连接中…' }}</div>

    <TopBar
      :code="view.code"
      :session-no="view.sessionNo"
      :hand-no="view.handNo"
      :hands="cfg.hands"
      :phase="phase"
      @copy="copyCode"
      @menu="roomMenuOpen = true"
      @invite="inviteOpen = true"
      @exit="exitRoom"
    >
      <template v-if="isWide" #extra><SoundButton variant="tb" /></template>
    </TopBar>

    <div ref="bodyEl" class="body">
      <!-- 宽屏：左侧观战者 -->
      <aside v-if="isWide" class="side">
        <div class="side-title">观战者（{{ view.spectators.length }}）</div>
        <div class="side-body spec-body soft-scroll">
          <SpectatorList
            :spectators="view.spectators"
            :owner-id="view.ownerId"
            :me-id="me.userId"
            :can-kick="canKick"
            @kick="kick"
          />
        </div>
        <div class="side-title">聊天</div>
        <div class="side-body chat-body">
          <ChatPanel
            :messages="chatShown"
            :cleared="!!chatCleared"
            :me-id="me.userId"
            :owner-id="view.ownerId"
            :send="sendChat"
            @clear="clearChat"
          />
        </div>
      </aside>

      <main class="main">
        <div ref="tableEl" class="table-area">
          <div class="table" :style="tableStyle">
            <div class="felt">
              <div class="felt-line"></div>
              <div class="logo">炸金花</div>
              <div
                v-show="beamOn"
                class="beam"
                :class="{ mine: myTurn }"
                :style="{ width: beamSize + 'px', height: beamSize + 'px', transform: 'translate(-50%, -50%) rotate(' + beamAngle + 'deg)' }"
              ></div>
            </div>
          </div>

          <template v-if="box.w">
            <PotPiles
              :pot="pilesPot"
              :ante="cfg.ante"
              :cx="g.cx"
              :cy="g.cy"
              :ax="pileGeo.ax"
              :ay="pileGeo.ay"
              :hole-w="pileGeo.holeW"
              :hole-h="pileGeo.holeH"
              :chip-w="pileGeo.chipW"
            />
            <TableCenter :view="view" :srv-now="srvNow" :width="centerW" :cy="g.cy" :compact="g.b < 150" />
            <div
              v-show="beamOn"
              class="needle"
              :class="{ mine: myTurn }"
              :style="{ left: g.cx + 'px', top: g.cy + 'px', transform: 'rotate(' + beamAngle + 'deg)', '--r': needleR + 'px' }"
            >
              <i></i>
            </div>

            <div
              v-for="b in bets"
              :key="'b' + b.seat"
              class="bet"
              :style="{ left: b.x + 'px', top: b.y + 'px' }"
            >
              <i></i>{{ b.bet }}
            </div>

            <SeatItem
              v-for="(s, i) in seats"
              :key="i"
              :seat="s"
              :index="i"
              :x="seatPositions[i].x"
              :y="seatPositions[i].y"
              :w="g.sw"
              :d="g.d"
              :fs="g.fs"
              :player="playerMap[i] || null"
              :cards="visMap[i] || null"
              :has-hand="!!hand"
              :waiting="phase === 'waiting'"
              :is-turn="shownTurn === i"
              :unfocus="shownTurn >= 0 && shownTurn !== i && !comparing"
              :muted="comparing && !!s && compareTargets.indexOf(i) < 0"
              :deadline="shownTurn === i ? hand.turnDeadline || 0 : 0"
              :total-ms="cfg.actionSeconds * 1000"
              :now="shownTurn === i ? srvNow : 0"
              :is-me="mySeatIdx === i"
              :is-owner="!!s && s.userId === view.ownerId"
              :is-dealer="!!hand && hand.dealerSeat === i"
              :can-sit="!s && !seated"
              :can-bot="!s && me.isOwner && phase === 'waiting'"
              :selectable="comparing && compareTargets.indexOf(i) >= 0"
              :glow="fx.glow.indexOf(i) >= 0"
              :hold="holdMap[i] || 0"
              @click="seatClick(i)"
            />

            <!-- 聊天气泡 -->
            <div class="bubbles">
              <div
                v-for="b in bubbleList"
                :key="b.key"
                class="bubble"
                :class="[b.cls, { emoji: b.kind === 'emoji' }]"
                :style="b.style"
              >
                <span>{{ b.text }}</span>
              </div>
              <transition-group name="dm" tag="div" class="danmaku" :style="{ top: Math.round(g.cy - Math.max(110, g.b * 0.5)) + 'px' }">
                <div v-for="l in specLines" :key="l.key" class="dm-line">
                  <b>{{ l.nickname }}</b><i>观战</i><span :class="{ em: l.kind === 'emoji' }">{{ l.text }}</span>
                </div>
              </transition-group>
            </div>

            <!-- 比牌选人：牌桌压暗 + 桌心提示 -->
            <template v-if="comparing">
              <div class="pick-shade"></div>
              <div class="pick-tip" :style="{ top: g.cy + 'px' }">
                <b>选择比牌对手</b>
                <span>点击头上有“点我比牌”的玩家</span>
              </div>
            </template>

            <!-- 全屏特效：轮到你了 / 孤注一掷 -->
            <Teleport to="body">
              <div class="room-fx">
                <div v-if="urgent" class="urgent" :class="'u' + urgent"></div>
                <div v-if="urgent === 2 && myLeft >= 1" :key="'cd' + myLeft" class="cd-num">{{ myLeft }}</div>
                <div v-if="turnFlash" :key="'t' + turnFlash" class="turn-banner" :style="{ top: turnFlashY + 'px' }">
                  <span>轮到你了</span>
                </div>
                <div v-if="fx.allIn" :key="fx.allIn.key" class="banner" :class="{ ok: fx.allIn.ok }">
                  {{ fx.allIn.text }}
                  <small>{{ fx.allIn.ok ? '成功！' : '失败…' }}</small>
                </div>
              </div>
            </Teleport>
            <CompareFx
              v-if="fx.compare"
              :key="fx.compare.key"
              :cx="fx.compare.cx"
              :cy="fx.compare.cy"
              :size="fx.compare.size"
              :from="fx.compare.from"
              :to="fx.compare.to"
              :loser="fx.compare.loser"
              :me="fx.compare.me"
            />
            <FxLayer ref="fxl" :origin="fxOrigin" />
          </template>

          <!-- 窄屏：观战者 / 日志 抽屉入口 -->
          <button v-if="!isWide" class="corner l" @click="specOpen = true">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
            观战 {{ view.spectators.length }}
          </button>
          <div v-if="!isWide" class="corner-snd"><SoundButton variant="pill" /></div>
          <button v-if="!isWide" class="chat-fab" aria-label="聊天" @click="chatOpen = true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 6a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 7 10zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>
            <i v-if="unread" class="badge">{{ unread > 99 ? '99+' : unread }}</i>
          </button>
          <button v-if="!isWide" class="corner r" @click="logOpen = true">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zm-4 6h2v2H4zm4 0h12v2H8z"/></svg>
            记录
          </button>
        </div>

        <MyArea
          :view="view"
          :comparing="comparing"
          :busy="busy"
          :card-w="cardW"
          :compact="short"
          :srv-now="srvNow"
          :my-turn="myTurn && !dealingNow"
          :dealing="dealingNow"
          :dealt="myDealt"
          @act="act"
          @toggle-compare="toggleCompare"
          @edit-config="openConfig"
          @open-summary="showSummary = true"
          @end-session="endSession"
        />
      </main>

      <!-- 宽屏：右侧日志 -->
      <aside v-if="isWide" class="side">
        <div class="side-title">操作记录</div>
        <div class="side-body log-body"><LogPanel :log="log" :players="hand ? hand.players : []" :me-seat="mySeatIdx === null ? -1 : mySeatIdx" /></div>
      </aside>
    </div>

    <!-- 弹窗 -->
    <InviteModal v-model="inviteOpen" :code="view.code" />
    <RulesModal v-model="rulesOpen" :config="cfg" />
    <SummaryModal
      v-model="showSummary"
      :summary="view.summary"
      :totals="view.totals"
      :me-id="me.userId"
      :is-owner="me.isOwner"
      @restart="act('room.restart')"
    />
    <Modal v-model="specOpen" :title="'观战者（' + view.spectators.length + '）'" variant="sheet" :width="420">
      <SpectatorList
        :spectators="view.spectators"
        :owner-id="view.ownerId"
        :me-id="me.userId"
        :can-kick="canKick"
        @kick="kick"
      />
    </Modal>
    <!-- 房间菜单：次要操作都收在这里，避免误触 -->
    <Modal v-model="roomMenuOpen" title="菜单" variant="sheet" :width="420">
      <div class="rmenu">
        <button class="mi" @click="menuDo(() => (rulesOpen = true))">
          <span class="mi-ic">📖</span><span class="mi-t">规则说明</span><span class="mi-d">本房间的全部规则配置</span>
        </button>
        <button v-if="me.isOwner && phase === 'waiting'" class="mi" @click="menuDo(openConfig)">
          <span class="mi-ic">⚙️</span><span class="mi-t">修改配置</span><span class="mi-d">准备阶段可以修改</span>
        </button>
        <button v-if="seated && canStandSelf" class="mi" @click="menuDo(standUp)">
          <span class="mi-ic">👀</span><span class="mi-t">改为观战模式</span><span class="mi-d">离开座位，本场内坐回来积分不变</span>
        </button>
        <button v-if="seated && !canStandSelf" class="mi" disabled>
          <span class="mi-ic">👀</span><span class="mi-t">改为观战模式</span><span class="mi-d">本局对局中不能离座</span>
        </button>
        <template v-if="me.isOwner">
          <div class="mi-sep">房主操作</div>
          <button class="mi" :disabled="!hasEmptySeat || phase === 'finished'" @click="menuDo(() => addBot())">
            <span class="mi-ic">🤖</span><span class="mi-t">添加机器人</span>
            <span class="mi-d">{{ hasEmptySeat ? '坐到空位上，自动准备、自动出牌；点它的头像可以移出' : '没有空座位了' }}</span>
          </button>
          <button v-if="phase === 'playing'" class="mi danger" @click="menuDo(endSession)">
            <span class="mi-ic">⛔</span><span class="mi-t">提前结束本场</span><span class="mi-d">当前局作废、退还下注，然后结算</span>
          </button>
        </template>
      </div>
    </Modal>
    <Modal v-model="chatOpen" title="聊天" variant="sheet" :width="480">
      <div class="chat-box">
        <ChatPanel
          :messages="chatShown"
          :cleared="!!chatCleared"
          :me-id="me.userId"
          :owner-id="view.ownerId"
          :send="sendChat"
          @clear="clearChat"
        />
      </div>
    </Modal>
    <Modal v-model="logOpen" title="操作记录" variant="sheet" :width="460">
      <div class="log-box"><LogPanel :log="log" :players="hand ? hand.players : []" :me-seat="mySeatIdx === null ? -1 : mySeatIdx" /></div>
    </Modal>

    <Modal v-model="menuOpen" :title="menuInfo ? menuInfo.s.nickname : ''" :width="340">
      <div v-if="menuInfo" class="smenu">
        <Avatar :user-id="menuInfo.s.userId" :name="menuInfo.s.nickname" :size="64" />
        <div class="sm-line">
          积分 <b class="gold">{{ menuInfo.s.chips }}</b>
        </div>
        <div class="sm-line muted">
          {{ menuInfo.isMe ? '这是你自己' : '' }}{{ menuInfo.isOwner ? ' 房主' : '' }}
          {{ menuInfo.st }}
        </div>
        <div v-if="!menuInfo.isMe" class="props">
          <button v-for="p in PROPS" :key="p.id" class="pp" :class="{ mean: p.mean }" data-nosfx @click="sendProp(p.id)">
            <span class="pp-i">{{ p.icon }}</span>
            <span class="pp-n">{{ p.name }}</span>
          </button>
        </div>
        <button
          v-if="canKick && !menuInfo.isMe"
          class="btn btn-danger btn-block"
          @click="kick(menuInfo.s)"
        >
          {{ menuInfo.isBot ? '移出机器人' : '踢出房间' }}
        </button>
        <template v-if="menuInfo.isMe">
          <button class="btn btn-ghost btn-block" :disabled="!canStandSelf" @click="standUp">改为观战模式</button>
          <div v-if="!canStandSelf" class="sm-line muted small">本局对局中不能改为观战模式，请等本局结束</div>
        </template>
      </div>
    </Modal>

    <!-- 空座位（房主）：入座 / 加机器人 -->
    <Modal v-model="emptyOpen" :title="'空座位 ' + (emptyMenu === null ? '' : emptyMenu + 1)" :width="340">
      <div class="smenu">
        <button v-if="!seated" class="btn btn-gold btn-block" :disabled="busy" @click="emptyDo('sit')">坐这里</button>
        <button class="btn btn-ghost btn-block" :disabled="busy || phase === 'finished'" @click="emptyDo('bot')">🤖 添加机器人</button>
        <div class="sm-line muted small">机器人会自动准备、自动出牌，和真人一样看不到别人的牌</div>
      </div>
    </Modal>

    <!-- 踢人 -->
    <Modal v-model="kickOpen" :title="kickTarget && kickTarget.isBot ? '移出机器人' : '踢出玩家'" :width="360">
      <div v-if="kickTarget" class="smenu">
        <Avatar :user-id="kickTarget.userId" :name="kickTarget.nickname" :size="56" />
        <div class="sm-line">确定把「{{ kickTarget.nickname }}」移出房间吗？</div>
        <div class="sm-line muted small">{{ kickNote }}</div>
        <label v-if="!kickTarget.isBot" class="ban" :class="{ on: kickBan }">
          <input v-model="kickBan" type="checkbox" />
          <span class="box"></span>
          不允许对方再进入本房间
        </label>
      </div>
      <template #footer>
        <div class="two">
          <button class="btn btn-ghost" @click="kickTarget = null">取消</button>
          <button class="btn btn-danger" :disabled="busy" @click="doKick">{{ kickTarget && kickTarget.isBot ? '移出' : '踢出' }}</button>
        </div>
      </template>
    </Modal>

    <Modal v-model="cfgOpen" title="修改配置" variant="sheet" :width="520">
      <div class="note">修改配置后，所有人的准备状态会被取消。初始积分不可修改。</div>
      <ConfigForm v-if="editCfg" ref="cfgFormRef" v-model="editCfg" :limits="limits" :locked-keys="['initialChips']" />
      <template #footer>
        <div class="two">
          <button class="btn btn-ghost" @click="cfgOpen = false">取消</button>
          <button class="btn btn-gold" :disabled="busy" @click="saveConfig">保存</button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.room {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: hidden;
  background: radial-gradient(ellipse 90% 60% at 50% 38%, #12392a 0%, #0a1f17 55%, #050d0a 100%);
}
.conn {
  flex: none;
  padding: calc(4px + var(--sat)) 8px 4px;
  font-size: 13px;
  text-align: center;
  color: #fff;
  background: #c0392b;
  z-index: 40;
  animation: blink 1.4s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.6;
  }
}
.body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  min-height: 0;
}
.table-area {
  position: relative;
  flex: 1 1 auto;
  min-height: 300px;
  overflow: hidden;
  padding: 0 var(--sar) 0 var(--sal);
}
/* 牌桌：木质包边 + 金线 + 绒面 */
.table {
  position: absolute;
  border-radius: 9999px;
  background: linear-gradient(180deg, #7a4b22 0%, #4e2d12 45%, #3a200c 100%);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 2px 1px rgba(255, 210, 150, 0.35),
    inset 0 -3px 6px rgba(0, 0, 0, 0.5);
}
.felt {
  position: absolute;
  left: var(--rail);
  top: var(--rail);
  right: var(--rail);
  bottom: var(--rail);
  overflow: hidden;
  border-radius: 9999px;
  background-color: #17643f;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E"),
    radial-gradient(ellipse at 50% 42%, #2a9663 0%, #1b7449 38%, #115234 72%, #0b3a24 100%);
  box-shadow: 0 0 0 2px #d4ac55, 0 0 0 3px rgba(0, 0, 0, 0.5), inset 0 0 50px rgba(0, 0, 0, 0.55),
    inset 0 0 14px rgba(0, 0, 0, 0.5);
}
.felt-line {
  position: absolute;
  left: 7%;
  top: 7%;
  right: 7%;
  bottom: 7%;
  border: 1.5px solid rgba(255, 226, 150, 0.16);
  border-radius: 9999px;
}
.logo {
  position: absolute;
  left: 0;
  right: 0;
  top: 22%;
  text-align: center;
  font-family: 'STKaiti', 'KaiTi', 'Kaiti SC', serif;
  font-size: clamp(26px, 7vw, 46px);
  font-weight: 900;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
  color: rgba(255, 236, 170, 0.07);
  pointer-events: none;
}
.room.wide .logo {
  top: 16%;
}
.bet {
  position: absolute;
  z-index: 5;
  display: flex;
  align-items: center;
  transform: translate(-50%, -50%);
  padding: 0 8px 0 2px;
  font-size: 12px;
  font-weight: 800;
  line-height: 20px;
  color: #ffe9a8;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(240, 200, 100, 0.45);
  border-radius: 999px;
  white-space: nowrap;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
}
.bet i {
  position: relative;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, #f6d47a 0 38%, #b8831f 40% 46%, transparent 48%),
    conic-gradient(#fff 0 10%, #d33 10% 25%, #fff 25% 35%, #d33 35% 50%, #fff 50% 60%, #d33 60% 75%, #fff 75% 85%, #d33 85%);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.5);
}
.corner {
  position: absolute;
  top: 8px;
  z-index: 10;
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 10px 0 8px;
  font-size: 13px;
  color: #e9dfc3;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(240, 207, 122, 0.25);
  border-radius: 999px;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.corner svg {
  margin-right: 4px;
  color: var(--gold);
}
.corner.l {
  left: calc(8px + var(--sal));
}
.corner.r {
  right: calc(8px + var(--sar));
}
/* 全屏特效（挂在 body 上） */
.room-fx {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 890;
}
/* 紧迫感：屏幕四周红色脉动 + 中央倒数 */
.urgent {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  box-shadow: inset 0 0 90px 20px rgba(255, 40, 20, 0.55);
  animation: urg 1s ease-in-out infinite;
}
.urgent.u2 {
  box-shadow: inset 0 0 140px 40px rgba(255, 30, 10, 0.7);
  animation-duration: 0.5s;
}
@keyframes urg {
  50% {
    opacity: 0.25;
  }
}
.cd-num {
  position: absolute;
  left: 50%;
  top: 44%;
  font-size: clamp(110px, 22vmin, 220px);
  font-weight: 900;
  line-height: 1;
  color: rgba(255, 70, 50, 0.85);
  -webkit-text-stroke: 3px rgba(255, 255, 255, 0.85);
  text-shadow: 0 0 30px rgba(255, 40, 20, 0.9), 0 8px 20px rgba(0, 0, 0, 0.6);
  transform: translate(-50%, -50%);
  animation: cd 1s ease-out forwards;
}
@keyframes cd {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(2.2);
  }
  18% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(0.95);
  }
  30% {
    transform: translate(-50%, -50%) scale(1);
  }
  80% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.8);
  }
}
/* 比牌选人：压暗牌桌，只有可选的对手是亮的 */
.pick-shade {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
  animation: pick-in 0.25s ease-out both;
}
.pick-tip {
  position: absolute;
  left: 50%;
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 26px 12px;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: linear-gradient(180deg, rgba(120, 20, 12, 0.95), rgba(70, 10, 6, 0.95));
  border: 2px solid #ff8a70;
  border-radius: 16px;
  box-shadow: 0 0 30px rgba(255, 80, 50, 0.55), 0 8px 20px rgba(0, 0, 0, 0.5);
  animation: pick-in 0.25s ease-out both, pick-glow 1.2s ease-in-out infinite alternate;
}
.pick-tip b {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 3px;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.pick-tip span {
  margin-top: 2px;
  font-size: 13px;
  color: #ffd2c6;
}
@keyframes pick-in {
  from {
    opacity: 0;
  }
}
@keyframes pick-glow {
  to {
    box-shadow: 0 0 46px rgba(255, 90, 60, 0.85), 0 8px 20px rgba(0, 0, 0, 0.5);
  }
}
.banner {
  position: absolute;
  left: 50%;
  top: 40%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 34px;
  font-size: clamp(22px, 4.2vmin, 40px);
  font-weight: 900;
  white-space: nowrap;
  color: #fff;
  background: linear-gradient(180deg, rgba(190, 40, 30, 0.95), rgba(120, 20, 15, 0.95));
  border: 2px solid #ffb4a6;
  border-radius: 14px;
  transform: translate(-50%, -50%);
  animation: banner 2.2s ease-out forwards;
}
.banner.ok {
  background: linear-gradient(180deg, rgba(230, 184, 79, 0.97), rgba(160, 110, 20, 0.97));
  border-color: #fff2c0;
  color: #3a2603;
}
.banner small {
  font-size: 0.6em;
}
@keyframes banner {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(2);
  }
  12% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.log-box {
  height: 50vh;
  height: 50dvh;
}
.smenu {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.sm-line {
  margin-top: 8px;
  font-size: 15px;
}
.sm-line.small {
  font-size: 12px;
}
.smenu .btn {
  margin-top: 16px;
}
/* 互动道具 */
.props {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  margin-top: 14px;
  padding: 10px 8px 8px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
}
.pp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0 4px;
  border-radius: 10px;
  transition: background 0.15s, transform 0.12s;
}
.pp:hover {
  background: rgba(255, 255, 255, 0.07);
}
.pp:active {
  transform: scale(0.9);
}
.pp-i {
  font-size: 28px;
  line-height: 1.1;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
}
.pp-n {
  font-size: 11px;
  color: #e6dcc0;
}
.pp.mean .pp-n {
  color: #ffb8a8;
}
.note {
  margin-bottom: 14px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--gold-l);
  background: rgba(230, 184, 79, 0.1);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* 当前行动者：聚光灯 + 桌心指针 */
.beam {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 50%;
  pointer-events: none;
  background: conic-gradient(
    from -14deg,
    rgba(255, 222, 130, 0) 0deg,
    rgba(255, 222, 130, 0.34) 9deg,
    rgba(255, 222, 130, 0.34) 19deg,
    rgba(255, 222, 130, 0) 28deg,
    rgba(255, 222, 130, 0) 360deg
  );
  -webkit-mask-image: radial-gradient(circle, transparent 0, transparent 26px, #000 90px);
  mask-image: radial-gradient(circle, transparent 0, transparent 26px, #000 90px);
  transition: transform 0.5s cubic-bezier(0.3, 1.25, 0.5, 1);
}
.beam.mine {
  background: conic-gradient(
    from -16deg,
    rgba(255, 214, 100, 0) 0deg,
    rgba(255, 214, 100, 0.45) 10deg,
    rgba(255, 214, 100, 0.45) 22deg,
    rgba(255, 214, 100, 0) 32deg,
    rgba(255, 214, 100, 0) 360deg
  );
}
.needle {
  position: absolute;
  z-index: 4;
  width: 0;
  height: 0;
  pointer-events: none;
  transition: transform 0.5s cubic-bezier(0.3, 1.25, 0.5, 1);
}
.needle i {
  position: absolute;
  left: -10px;
  top: calc(-1 * var(--r) - 18px);
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 18px solid #ffd56b;
  filter: drop-shadow(0 0 6px rgba(255, 200, 80, 0.9)) drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
  animation: needle 1s ease-in-out infinite;
}
.needle.mine i {
  border-bottom-color: #fff0b0;
}
@keyframes needle {
  50% {
    transform: translateY(-5px);
  }
}
.turn-banner {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  transform: translateY(-50%);
  pointer-events: none;
  animation: tb-in 1.7s ease-out forwards;
}
.turn-banner span {
  padding: 10px 60px;
  font-size: clamp(30px, 5vmin, 52px);
  font-weight: 900;
  letter-spacing: 8px;
  text-indent: 8px;
  color: #3a2603;
  background: linear-gradient(90deg, rgba(255, 214, 110, 0) 0%, #ffe39a 18%, #f0c24f 50%, #ffe39a 82%, rgba(255, 214, 110, 0) 100%);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 30px rgba(255, 200, 80, 0.6);
}
@keyframes tb-in {
  0% {
    opacity: 0;
    transform: translateY(-50%) scaleX(0.3);
  }
  14% {
    opacity: 1;
    transform: translateY(-50%) scaleX(1.05);
  }
  22% {
    transform: translateY(-50%) scaleX(1);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.rmenu {
  display: flex;
  flex-direction: column;
}
.mi {
  display: grid;
  grid-template-columns: 34px 1fr;
  grid-template-areas: 'ic t' 'ic d';
  align-items: center;
  width: 100%;
  padding: 10px 6px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.mi:disabled {
  opacity: 0.45;
}
.mi-ic {
  grid-area: ic;
  font-size: 20px;
}
.mi-t {
  grid-area: t;
  font-size: 16px;
  font-weight: 700;
  color: #ffe9b0;
}
.mi-d {
  grid-area: d;
  font-size: 12px;
  color: var(--muted);
}
.mi.danger .mi-t {
  color: #ff9a88;
}
.mi-sep {
  margin: 14px 0 4px;
  font-size: 12px;
  color: var(--muted);
}
.corner-snd {
  position: absolute;
  top: 8px;
  right: calc(8px + var(--sar) + 80px);
  z-index: 10;
}

/* 聊天气泡 */
.bubbles {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 24;
}
.bubble {
  position: absolute;
  width: -webkit-max-content;
  width: max-content;
  max-width: 150px;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.35;
  color: #2a1d04;
  background: #fffaf0;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  animation: bub 0.25s cubic-bezier(0.3, 1.5, 0.5, 1) both;
}
.bubble span {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.bubble::after {
  content: '';
  position: absolute;
  width: 0;
  height: 0;
  border: 6px solid transparent;
}
.bubble.up {
  transform: translate(-50%, -100%);
}
.bubble.up::after {
  left: 50%;
  top: 100%;
  margin-left: -6px;
  border-top-color: #fffaf0;
}
.bubble.down {
  transform: translate(-50%, 0);
}
.bubble.down::after {
  left: 50%;
  bottom: 100%;
  margin-left: -6px;
  border-bottom-color: #fffaf0;
}
.bubble.right {
  transform: translate(0, -50%);
}
.bubble.right::after {
  right: 100%;
  top: 50%;
  margin-top: -6px;
  border-right-color: #fffaf0;
}
.bubble.left {
  transform: translate(-100%, -50%);
}
.bubble.left::after {
  left: 100%;
  top: 50%;
  margin-top: -6px;
  border-left-color: #fffaf0;
}
.bubble.emoji {
  padding: 0;
  font-size: 40px;
  line-height: 1;
  background: none;
  box-shadow: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5));
}
.bubble.emoji span {
  display: block;
  animation: emo 2.6s ease-out both;
}
.bubble.emoji::after {
  display: none;
}
@keyframes bub {
  from {
    opacity: 0;
  }
}
@keyframes emo {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  12% {
    opacity: 1;
    transform: scale(1.35);
  }
  22% {
    transform: scale(1);
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.danmaku {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.dm-line {
  max-width: 86%;
  margin-top: 4px;
  padding: 3px 12px;
  font-size: 13px;
  color: #f3ecd8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(240, 207, 122, 0.25);
  border-radius: 999px;
}
.dm-line b {
  color: #ffe39a;
}
.dm-line i {
  margin: 0 6px 0 4px;
  padding: 0 4px;
  font-size: 10px;
  font-style: normal;
  color: #d5ddd8;
  background: rgba(255, 255, 255, 0.14);
  border-radius: 4px;
}
.dm-line .em {
  font-size: 18px;
}
.dm-enter-active,
.dm-leave-active {
  transition: all 0.3s;
}
.dm-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.dm-leave-to {
  opacity: 0;
}
/* 手机：聊天按钮 */
.chat-fab {
  position: absolute;
  right: calc(10px + var(--sar));
  bottom: 10px;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #e6b84f 60%, #c0901f);
  border: 1px solid #fff0c0;
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.chat-fab .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 20px;
  color: #fff;
  background: #e0392b;
  border: 2px solid #0a1f17;
  border-radius: 999px;
}
.chat-box {
  height: 58vh;
  height: 58dvh;
}
.spec-body {
  flex: 0 0 34% !important;
  min-height: 120px;
}
.ban {
  display: flex;
  align-items: center;
  margin-top: 16px;
  padding: 10px 14px;
  font-size: 14px;
  color: #f3ecd8;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
}
.ban.on {
  color: #ffc4b8;
  border-color: rgba(255, 120, 100, 0.55);
  background: rgba(200, 50, 30, 0.14);
}
.ban input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.ban .box {
  position: relative;
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 10px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-radius: 5px;
}
.ban.on .box {
  border-color: #ff7a64;
  background: #e0452f;
}
.ban.on .box::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg);
}
.chat-body {
  display: flex;
  flex-direction: column;
  padding-bottom: 12px !important;
  overflow: hidden !important; /* 只让里面的消息列表滚动，避免出现两层滚动条 */
}
.chat-body > :deep(.chat) {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}
.log-body {
  display: flex;
  flex-direction: column;
  overflow: hidden !important;
}
.log-body > :deep(.log) {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}

/* 宽屏：整屏高度，牌桌占满中间，两侧放观战者 / 日志 */
.room.wide {
  height: 100vh;
  height: 100dvh;
  min-height: 540px;
  overflow: hidden; /* 电脑上整页不滚动：内容按屏幕高度缩放 */
}
.room.wide .body {
  flex-direction: row;
  align-items: stretch;
  justify-content: center;
  padding: 14px 18px 12px;
  min-height: 0;
}
.room.wide .main {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  max-width: 1080px;
  margin: 0 16px;
  min-height: 0;
}
.room.wide .table-area {
  flex: 1 1 auto;
  min-height: 260px;
}
.side {
  flex: 0 0 clamp(220px, 19vw, 300px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(20, 44, 34, 0.75), rgba(8, 20, 15, 0.75));
  border: 1px solid rgba(240, 207, 122, 0.18);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.side-title {
  flex: none;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--gold);
  border-bottom: 1px solid rgba(240, 207, 122, 0.14);
  background: rgba(0, 0, 0, 0.18);
}
.side-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px 12px;
  overflow-y: auto;
}
.side-body :deep(.log) {
  height: 100%;
}
</style>
