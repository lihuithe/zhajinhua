<script setup>
// 牌桌上的一个座位：头像（状态遮罩 / 角标 / 倒计时环）+ 名牌（昵称、积分）+ 他人可见的牌
// (x, y) 是头像圆心坐标
import { computed } from 'vue';
import Avatar from '../Avatar.vue';
import PlayingCard from '../PlayingCard.vue';

const props = defineProps({
  seat: { type: Object, default: null }, // SeatView | null
  index: { type: Number, required: true },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  w: { type: Number, default: 64 }, // 名牌最大宽度
  d: { type: Number, default: 44 }, // 头像直径
  fs: { type: Number, default: 11 }, // 字号
  player: { type: Object, default: null }, // HandPlayerView
  cards: { type: Object, default: null }, // 他人可见的牌 CardsView
  hasHand: { type: Boolean, default: false },
  waiting: { type: Boolean, default: false }, // 准备阶段
  isTurn: { type: Boolean, default: false },
  unfocus: { type: Boolean, default: false }, // 有别人正在行动时，其余座位略微压暗
  deadline: { type: Number, default: 0 },
  totalMs: { type: Number, default: 20000 },
  now: { type: Number, default: 0 }, // 仅当前行动者才传入，避免所有座位每 250ms 重渲染
  isMe: { type: Boolean, default: false },
  isOwner: { type: Boolean, default: false },
  isDealer: { type: Boolean, default: false },
  canSit: { type: Boolean, default: false },
  selectable: { type: Boolean, default: false },
  muted: { type: Boolean, default: false }, // 比牌选人时，不能选的座位压暗
  glow: { type: Boolean, default: false },
  hold: { type: Number, default: 0 }, // 手里扣着的牌（牌背）张数：发牌时逐张增加
  canBot: { type: Boolean, default: false }, // 房主可以在这个空位加机器人
});
defineEmits(['click']);

// 盖在头像上的状态遮罩
const overlay = computed(() => {
  const s = props.seat;
  if (!s) return null;
  const p = props.player;
  if (props.hasHand) {
    if (p) {
      if (p.state === 'folded') return { t: '弃牌', c: 'fold' };
      if (p.state === 'lost') return { t: '出局', c: 'lost' };
      return null;
    }
    if (s.status === 'sittingOut') return { t: '不参与', c: 'idle' };
    if (s.status === 'waitingNext') return { t: '等下局', c: 'idle' };
  }
  return null;
});

// 头像右下角的小角标：闷 / 看
const corner = computed(() => {
  const p = props.player;
  if (!props.hasHand || !p || p.state !== 'active') return null;
  return p.seen ? { t: '看', c: 'seen' } : { t: '闷', c: 'blind' };
});

const ready = computed(() => !!(props.waiting && props.seat && props.seat.ready && !props.isOwner));
const won = computed(() => !!(props.player && props.player.state === 'won'));
const allIn = computed(() => !!(props.player && props.player.allIn && props.player.state === 'active'));
const offline = computed(() => !!(props.seat && !props.seat.online));
const dimmed = computed(() => !!overlay.value || offline.value);

const remain = computed(() => (props.isTurn && props.deadline ? Math.max(0, props.deadline - props.now) : 0));
const frac = computed(() => Math.max(0, Math.min(1, remain.value / (props.totalMs || 1))));
const secs = computed(() => Math.ceil(remain.value / 1000));
const ringSize = computed(() => props.d + 12);
const ringR = computed(() => props.d / 2 + 3.5);
const ringC = computed(() => 2 * Math.PI * ringR.value);

const boxStyle = computed(() => ({
  left: props.x + 'px',
  top: props.y - props.d / 2 + 'px',
  width: props.w + 'px',
  '--d': props.d + 'px',
  '--fs': props.fs + 'px',
}));
const miniW = computed(() => Math.max(18, Math.round(props.d * 0.5)));
const holdW = computed(() => Math.max(11, Math.round(props.d * 0.3)));
</script>

<template>
  <div
    class="seat"
    :class="{ turn: isTurn, unfocus, muted, me: isMe, dim: dimmed, selectable, glow: glow || won, empty: !seat, canSit: canSit || canBot, bot: !!(seat && seat.isBot) }"
    :style="boxStyle"
    @click="$emit('click')"
  >
    <template v-if="seat">
      <div class="av">
        <svg v-if="isTurn && deadline" class="timer" :width="ringSize" :height="ringSize">
          <circle :cx="ringSize / 2" :cy="ringSize / 2" :r="ringR" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="4" />
          <circle
            :cx="ringSize / 2"
            :cy="ringSize / 2"
            :r="ringR"
            fill="none"
            :stroke="secs <= 5 ? '#ff5a45' : '#ffd36a'"
            stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="ringC"
            :stroke-dashoffset="ringC * (1 - frac)"
            :transform="'rotate(-90 ' + ringSize / 2 + ' ' + ringSize / 2 + ')'"
          />
        </svg>
        <Avatar :user-id="seat.userId" :name="seat.nickname" :size="d" />
        <div v-if="overlay" class="ov" :class="overlay.c"><span>{{ overlay.t }}</span></div>

        <i v-if="selectable" class="pick">点我比牌</i>
        <i v-if="isDealer" class="badge dealer">庄</i>
        <i v-if="corner" class="cbadge" :class="corner.c">{{ corner.t }}</i>
        <i v-if="isTurn && deadline" class="secs" :class="{ low: secs <= 5 }">{{ secs }}s</i>
        <i v-else-if="won" class="pill win">赢</i>
        <i v-else-if="offline" class="pill off">离线</i>
        <i v-else-if="allIn" class="pill allin">孤注</i>
        <i v-else-if="ready" class="pill ok">已准备</i>

        <div v-if="hold && !cards" class="hold" :style="{ '--hw': holdW + 'px' }">
          <i v-for="n in hold" :key="n"></i>
        </div>
        <div v-if="cards" class="mini">
          <PlayingCard v-for="(c, i) in cards.cards" :key="i" :card="c" :w="miniW" flat />
        </div>
      </div>

      <div class="plate">
        <div class="nick"><i v-if="isOwner" class="crown" title="房主">♛</i>{{ seat.nickname }}</div>
        <div class="chips"><i class="chip-ic"></i>{{ seat.chips }}</div>
      </div>
      <div v-if="cards && cards.label" class="clabel">{{ cards.label }}</div>

    </template>
    <template v-else>
      <div class="av">
        <div class="empty-seat" :class="{ sit: canSit, bot: !canSit && canBot }">
          <span v-if="canSit || canBot">+</span>
        </div>
      </div>
      <div v-if="canSit" class="sit-tip">入座</div>
      <div v-else-if="canBot" class="sit-tip bot">加机器人</div>
    </template>
  </div>
</template>

<style scoped>
.seat {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
  font-size: var(--fs);
  line-height: 1.15;
  text-align: center;
  z-index: 3;
  transition: transform 0.2s;
}
.seat.canSit,
.seat.selectable,
.seat:not(.empty) {
  cursor: pointer;
}
.av {
  position: relative;
  width: var(--d);
  height: var(--d);
  flex: none;
}
.seat.dim .av :deep(.avatar) {
  filter: grayscale(0.85) brightness(0.7);
}
.seat.dim .plate {
  opacity: 0.6;
}

/* 状态遮罩 */
.ov {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: calc(var(--d) * 0.26);
  font-weight: 800;
  letter-spacing: 0;
  color: #fff;
  background: rgba(10, 14, 12, 0.55);
  text-shadow: 0 1px 2px #000;
  z-index: 2;
  white-space: nowrap;
}
/* 弃牌 / 出局：盖章 */
.ov.fold,
.ov.lost {
  overflow: visible;
  background: none;
  text-shadow: none;
  z-index: 7;
}
.ov.fold span,
.ov.lost span {
  display: block;
  padding: 1px calc(var(--d) * 0.08);
  font-family: 'STKaiti', 'KaiTi', 'Kaiti SC', serif;
  font-size: max(13px, calc(var(--d) * 0.4));
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: 1px;
  white-space: nowrap;
  border: calc(var(--d) * 0.06) double currentColor;
  border-radius: calc(var(--d) * 0.1);
  background: rgba(255, 246, 236, 0.9);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
  transform: rotate(-16deg);
  animation: seal 0.32s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
.ov.fold span {
  color: #5d6b78;
}
.ov.lost span {
  color: #d62d1f;
}
@keyframes seal {
  0% {
    opacity: 0;
    transform: rotate(-16deg) scale(2.4);
  }
  70% {
    opacity: 1;
    transform: rotate(-16deg) scale(0.92);
  }
  100% {
    transform: rotate(-16deg) scale(1);
  }
}
.ov.idle {
  font-size: calc(var(--d) * 0.22);
  color: #d5ddd8;
}

/* 倒计时环 */
.timer {
  position: absolute;
  left: -6px;
  top: -6px;
  pointer-events: none;
  z-index: 3;
}
.seat.turn {
  z-index: 6;
  transform: translateX(-50%) scale(1.14);
}
.seat {
  transform-origin: 50% calc(var(--d) / 2);
}
.seat.unfocus .av :deep(.avatar),
.seat.unfocus .plate {
  filter: brightness(0.78) saturate(0.85);
}
.seat.turn .av :deep(.avatar) {
  border-color: #fff3c4;
  box-shadow: 0 0 0 3px rgba(255, 213, 107, 0.85), 0 0 22px 6px rgba(255, 200, 80, 0.75);
}
.seat.turn .av::before {
  content: '';
  position: absolute;
  left: -8px;
  top: -8px;
  right: -8px;
  bottom: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 211, 106, 0.45) 40%, rgba(255, 211, 106, 0) 70%);
  animation: halo 1.2s ease-in-out infinite;
}
@keyframes halo {
  50% {
    opacity: 0.4;
  }
}

/* 角标 */
.badge {
  position: absolute;
  width: calc(var(--fs) * 1.45);
  height: calc(var(--fs) * 1.45);
  font-style: normal;
  font-size: calc(var(--fs) * 0.85);
  font-weight: 900;
  line-height: calc(var(--fs) * 1.45);
  text-align: center;
  border-radius: 50%;
  z-index: 4;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.badge.dealer {
  right: -5px;
  top: -4px;
  color: #5a3a00;
  background: radial-gradient(circle at 35% 30%, #fff6d0, #f0c24f 60%, #b5841f);
  border: 1px solid #fff2c0;
}
.cbadge {
  position: absolute;
  left: -5px;
  top: -4px;
  width: calc(var(--fs) * 1.5);
  height: calc(var(--fs) * 1.5);
  font-style: normal;
  font-size: calc(var(--fs) * 0.85);
  font-weight: 800;
  line-height: calc(var(--fs) * 1.5 - 2px);
  text-align: center;
  color: #fff;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.7);
  z-index: 4;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.cbadge.blind {
  background: linear-gradient(180deg, #7b8794, #4a5560);
}
.cbadge.seen {
  background: linear-gradient(180deg, #5aa9ff, #2867c4);
}
.pill {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 6px;
  font-style: normal;
  font-size: calc(var(--fs) * 0.82);
  font-weight: 700;
  line-height: calc(var(--fs) * 1.35);
  white-space: nowrap;
  border-radius: 999px;
  z-index: 5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.pill.ok {
  top: -7px;
  color: #fff;
  background: linear-gradient(180deg, #4fd286, #22894d);
}
.pill.off {
  top: -7px;
  color: #eee;
  background: #5b5f5d;
}
.pill.allin {
  top: -7px;
  color: #fff;
  background: linear-gradient(180deg, #ff7f6b, #c0392b);
}
.pill.win {
  top: -9px;
  padding: 0 8px;
  color: #5a3a00;
  background: linear-gradient(180deg, #fff2c0, #f0c24f);
  border: 1px solid #fff;
}
.secs {
  position: absolute;
  left: 50%;
  top: -10px;
  transform: translateX(-50%);
  min-width: 26px;
  padding: 0 5px;
  font-style: normal;
  font-weight: 800;
  font-size: calc(var(--fs) * 0.85);
  line-height: calc(var(--fs) * 1.4);
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #f0c24f);
  border-radius: 999px;
  z-index: 5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.secs.low {
  color: #fff;
  background: linear-gradient(180deg, #ff7a6b, #d63a2a);
  animation: beat 0.5s ease-in-out infinite alternate;
}
@keyframes beat {
  to {
    transform: translateX(-50%) scale(1.15);
  }
}

/* 名牌 */
.plate {
  position: relative;
  z-index: 3;
  max-width: 100%;
  min-width: calc(var(--d) * 1.15);
  margin-top: calc(var(--d) * -0.16);
  padding: 1px 6px 2px;
  line-height: 1.12;
  background: linear-gradient(180deg, rgba(8, 18, 14, 0.82), rgba(8, 18, 14, 0.68));
  border: 1px solid rgba(240, 207, 122, 0.22);
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.seat.me .plate {
  border-color: rgba(255, 220, 130, 0.75);
  background: linear-gradient(180deg, rgba(60, 42, 8, 0.9), rgba(30, 22, 6, 0.85));
}
.seat.turn .plate {
  border-color: #ffd36a;
  box-shadow: 0 0 10px rgba(255, 211, 106, 0.6);
}
.nick {
  max-width: 100%;
  color: #f4efe2;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crown {
  margin-right: 2px;
  font-style: normal;
  color: #ffcf4d;
  text-shadow: 0 0 4px rgba(255, 190, 60, 0.8);
}
.seat.me .nick {
  color: #ffe39a;
}
.chips {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffd56b;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
/* 积分图标：红白相间的筹码 */
.chip-ic {
  position: relative;
  flex: none;
  width: calc(var(--fs) * 1.05);
  height: calc(var(--fs) * 1.05);
  margin-right: 3px;
  border-radius: 50%;
  background: radial-gradient(circle, #f6d47a 0 34%, #b8831f 36% 42%, transparent 44%),
    conic-gradient(#fff 0 10%, #d33 10% 25%, #fff 25% 35%, #d33 35% 50%, #fff 50% 60%, #d33 60% 75%, #fff 75% 85%, #d33 85%);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* 他人可见的牌：扇形盖在头像上 */
.mini {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  transform: translate(-50%, -50%);
  z-index: 6;
  pointer-events: none;
}
.mini > * {
  margin-left: calc(var(--d) * -0.22);
}
.mini > *:first-child {
  margin-left: 0;
  transform: rotate(-10deg) translateY(2px);
}
.mini > *:last-child {
  transform: rotate(10deg) translateY(2px);
}
.clabel {
  margin-top: 2px;
  padding: 0 6px;
  font-size: calc(var(--fs) * 0.85);
  font-weight: 700;
  line-height: calc(var(--fs) * 1.35);
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #f0c24f);
  border-radius: 999px;
  white-space: nowrap;
}

/* 高亮：比牌可选 / 赢家 */
.seat.selectable {
  z-index: 8;
}
.seat.selectable .av {
  animation: pulse 0.9s ease-in-out infinite;
}
.seat.selectable .av :deep(.avatar) {
  box-shadow: 0 0 0 4px #ff6a4f, 0 0 22px 8px rgba(255, 106, 79, 0.9);
}
.seat.selectable .av::after {
  content: '';
  position: absolute;
  left: -10px;
  top: -10px;
  right: -10px;
  bottom: -10px;
  border: 3px solid rgba(255, 120, 90, 0.9);
  border-radius: 50%;
  animation: pick-ring 1s ease-out infinite;
  pointer-events: none;
}
@keyframes pick-ring {
  from {
    opacity: 1;
    transform: scale(0.85);
  }
  to {
    opacity: 0;
    transform: scale(1.5);
  }
}
/* “点我比牌”标签：在头像上方上下跳 */
.pick {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 9;
  padding: 2px 9px;
  font-style: normal;
  font-size: calc(var(--fs) * 0.95);
  font-weight: 900;
  line-height: 1.5;
  white-space: nowrap;
  color: #fff;
  background: linear-gradient(180deg, #ff7f6b, #d0321f);
  border: 1.5px solid #fff;
  border-radius: 999px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 90, 60, 0.8);
  transform: translateX(-50%);
  animation: pick-bob 0.7s ease-in-out infinite alternate;
}
.pick::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  margin-left: -5px;
  border: 5px solid transparent;
  border-top-color: #d0321f;
}
@keyframes pick-bob {
  to {
    transform: translate(-50%, -5px);
  }
}
.seat.muted {
  opacity: 0.45;
  filter: grayscale(0.6);
}
.seat.glow .av :deep(.avatar) {
  box-shadow: 0 0 0 3px #ffd36a, 0 0 20px 7px rgba(255, 211, 106, 0.9);
}
@keyframes pulse {
  50% {
    transform: scale(1.1);
  }
}

/* 空座位 */
.empty-seat {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px dashed rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.12);
  transform: scale(0.62);
}
.empty-seat.sit {
  transform: none;
  font-size: calc(var(--d) * 0.55);
  font-weight: 300;
  line-height: 1;
  color: #ffe39a;
  border: 2px dashed rgba(240, 207, 122, 0.75);
  background: radial-gradient(circle, rgba(240, 207, 122, 0.2), rgba(240, 207, 122, 0.05));
  animation: sitHint 2s ease-in-out infinite;
}
@keyframes sitHint {
  50% {
    border-color: rgba(240, 207, 122, 0.35);
  }
}
.sit-tip {
  margin-top: 3px;
  font-size: calc(var(--fs) * 0.9);
  color: rgba(255, 227, 154, 0.85);
}

/* 空位：房主加机器人（比“入座”更低调） */
.empty-seat.bot {
  transform: scale(0.8);
  font-size: calc(var(--d) * 0.45);
  font-weight: 300;
  line-height: 1;
  color: rgba(200, 225, 255, 0.8);
  border: 1.5px dashed rgba(170, 205, 255, 0.45);
  background: rgba(120, 170, 255, 0.08);
}
.sit-tip.bot {
  margin-top: 0;
  font-size: calc(var(--fs) * 0.8);
  color: rgba(200, 225, 255, 0.85);
  opacity: 0;
  transition: opacity 0.15s;
}
/* 文字只在鼠标悬停时出现，避免一圈空位都写着“加机器人” */
@media (hover: hover) {
  .seat:hover .sit-tip.bot {
    opacity: 1;
  }
  .seat:hover .empty-seat.bot {
    border-color: rgba(170, 205, 255, 0.85);
    color: #e4f0ff;
  }
}
.seat.bot .plate {
  border-color: rgba(150, 195, 255, 0.35);
}

/* 手里扣着的牌：头像右侧的一小叠牌背 */
.hold {
  position: absolute;
  left: calc(100% - var(--hw) * 0.55);
  top: 50%;
  width: calc(var(--hw) * 1.9);
  height: calc(var(--hw) * 1.4);
  transform: translateY(-50%);
  z-index: 5;
  pointer-events: none;
}
.hold i {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--hw);
  height: calc(var(--hw) * 1.4);
  border-radius: 2px;
  background-color: #7d1426;
  background-image: repeating-linear-gradient(45deg, rgba(240, 200, 110, 0.32) 0 1px, transparent 1px 3px);
  border: 1.5px solid #fbf3df;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
  transform-origin: 50% 100%;
  animation: hold-in 0.22s ease-out both;
}
.hold i:nth-child(1) {
  transform: rotate(-14deg);
}
.hold i:nth-child(2) {
  left: calc(var(--hw) * 0.3);
}
.hold i:nth-child(3) {
  left: calc(var(--hw) * 0.6);
  transform: rotate(14deg);
}
@keyframes hold-in {
  from {
    opacity: 0;
    scale: 1.4;
  }
}
</style>
