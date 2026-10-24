<script setup>
// 比牌动画（全屏）：整屏压暗，一条横贯屏幕的光带，两个头像从各自座位飞到屏幕中央，VS 砸下，输家盖“败”章
// 坐标都是屏幕坐标（挂在 body 上）
import Avatar from '../Avatar.vue';

defineProps({
  cx: { type: Number, required: true },
  cy: { type: Number, required: true },
  size: { type: Number, default: 48 },
  from: { type: Object, required: true }, // { x, y, userId, name }
  to: { type: Object, required: true },
  loser: { type: String, default: 'to' }, // 'from' | 'to'
  me: { type: String, default: '' }, // 自己是哪一方：'from' 发起 / 'to' 被比 / '' 不相关
});
</script>

<template>
  <Teleport to="body">
  <div class="cfx" :style="{ '--size': size + 'px', '--off': Math.round(size * 0.9 + 60) + 'px' }">
    <div class="shade"></div>
    <div class="band" :class="{ mine: !!me }" :style="{ top: cy + 'px', height: size * 3.1 + 'px' }">
      <i v-if="me === 'from'"><b>你</b> 向 {{ to.name }} 发起比牌</i>
      <i v-else-if="me === 'to'"><b>{{ from.name }}</b> 找<b>你</b>比牌！</i>
      <i v-else>{{ from.name }} 与 {{ to.name }} 比牌</i>
    </div>
    <div class="flare" :style="{ left: cx + 'px', top: cy + 'px' }"></div>
    <div
      class="side a"
      :class="{ lose: loser === 'from', win: loser !== 'from' }"
      :style="{ left: cx + 'px', top: cy + 'px', '--sx': from.x - cx + 'px', '--sy': from.y - cy + 'px' }"
    >
      <Avatar :user-id="from.userId" :name="from.name" :size="size" />
      <div class="nm" :class="{ me: me === 'from' }">{{ me === 'from' ? '你' : from.name }}</div>
      <div class="stamp">{{ loser === 'from' ? '败' : '胜' }}</div>
    </div>
    <div
      class="side b"
      :class="{ lose: loser === 'to', win: loser !== 'to' }"
      :style="{ left: cx + 'px', top: cy + 'px', '--sx': to.x - cx + 'px', '--sy': to.y - cy + 'px' }"
    >
      <Avatar :user-id="to.userId" :name="to.name" :size="size" />
      <div class="nm" :class="{ me: me === 'to' }">{{ me === 'to' ? '你' : to.name }}</div>
      <div class="stamp">{{ loser === 'to' ? '败' : '胜' }}</div>
    </div>
    <div class="vs" :style="{ left: cx + 'px', top: cy + 'px', fontSize: Math.round(size * 0.8) + 'px' }">VS</div>
  </div>
  </Teleport>
</template>

<style scoped>
.cfx {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 880; /* 在牌桌之上、全屏特效层（900）之下 */
  animation: cfx-out 0.35s 2.2s forwards;
}
.shade {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.62) 70%);
  animation: cfx-in 0.25s both;
}
/* VS 砸下时中心爆开的光 */
.flare {
  position: absolute;
  width: 0;
  height: 0;
}
.flare::before {
  content: '';
  position: absolute;
  left: calc(var(--size) * -2.2);
  top: calc(var(--size) * -2.2);
  width: calc(var(--size) * 4.4);
  height: calc(var(--size) * 4.4);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 236, 170, 0.95) 0%, rgba(255, 170, 40, 0.55) 22%, rgba(255, 120, 0, 0) 62%);
  opacity: 0;
  animation: flare 0.7s 0.48s ease-out both;
}
@keyframes flare {
  0% {
    opacity: 0;
    transform: scale(0.2);
  }
  25% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: scale(1.4);
  }
}
.band {
  position: absolute;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  background: linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, rgba(10, 6, 2, 0.88) 18%, rgba(10, 6, 2, 0.88) 82%, rgba(0, 0, 0, 0) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 207, 110, 0.55), inset 0 -1px 0 rgba(255, 207, 110, 0.55);
  animation: band-in 0.3s ease-out both;
}
.band i {
  position: absolute;
  left: 50%;
  top: 8px;
  max-width: 92vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
  font-style: normal;
  font-size: clamp(14px, 2.2vmin, 22px);
  font-weight: 700;
  letter-spacing: 2px;
  color: rgba(255, 226, 160, 0.95);
}
.band i b {
  margin: 0 4px;
  color: #ffe27a;
}
/* 和自己有关的比牌：光带变红，标题更大 */
.band.mine {
  background: linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, rgba(70, 8, 4, 0.92) 18%, rgba(70, 8, 4, 0.92) 82%, rgba(0, 0, 0, 0) 100%);
  box-shadow: inset 0 2px 0 rgba(255, 110, 80, 0.8), inset 0 -2px 0 rgba(255, 110, 80, 0.8);
}
.band.mine i {
  font-size: clamp(16px, 2.8vmin, 28px);
  color: #fff;
  text-shadow: 0 0 10px rgba(255, 80, 40, 0.9);
}
.band.mine i b {
  color: #ffd84a;
}
@keyframes band-in {
  from {
    opacity: 0;
    transform: translateY(-50%) scaleY(0.2);
  }
}
.side {
  position: absolute;
  width: 0;
  height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.side > * {
  flex: none;
}
.side.a {
  animation: fly-a 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.side.b {
  animation: fly-b 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
@keyframes fly-a {
  from {
    transform: translate(var(--sx), var(--sy)) scale(0.7);
  }
  to {
    transform: translate(calc(-1 * var(--off)), 0) scale(1.15);
  }
}
@keyframes fly-b {
  from {
    transform: translate(var(--sx), var(--sy)) scale(0.7);
  }
  to {
    transform: translate(var(--off), 0) scale(1.15);
  }
}
.side :deep(.avatar) {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
}
.nm.me {
  color: #ffd84a;
  font-size: clamp(16px, calc(var(--size) * 0.24), 24px);
  font-weight: 900;
}
.nm {
  position: absolute;
  top: calc(var(--size) / 2 + 8px);
  width: 160px;
  left: -80px;
  text-align: center;
  font-size: clamp(12px, calc(var(--size) * 0.18), 18px);
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px #000;
}
.side.win :deep(.avatar) {
  box-shadow: 0 0 16px 4px rgba(255, 211, 106, 0.95);
}
.side.lose {
  animation: fly-lose 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.side.lose :deep(.avatar) {
  animation: gray 0.4s 1.1s forwards;
}
.side.lose.b {
  --dir: var(--off);
}
.side.lose.a {
  --dir: calc(-1 * var(--off));
}
@keyframes fly-lose {
  from {
    transform: translate(var(--sx), var(--sy)) scale(0.7);
  }
  to {
    transform: translate(var(--dir), 0) scale(1.15);
  }
}
@keyframes gray {
  to {
    filter: grayscale(1) brightness(0.7);
  }
}
.stamp {
  position: absolute;
  top: calc(var(--size) / -2 - 12px);
  left: calc(var(--size) / -2 - 8px);
  width: calc(var(--size) * 0.5);
  height: calc(var(--size) * 0.5);
  line-height: calc(var(--size) * 0.5 - 6px);
  text-align: center;
  font-size: calc(var(--size) * 0.34);
  font-weight: 900;
  color: #ff4b3a;
  border: 3px solid #ff4b3a;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  transform: rotate(-14deg) scale(2.2);
  opacity: 0;
  display: none;
}
.side .stamp {
  display: block;
  animation: stamp 0.25s 1.1s forwards;
}
/* 胜方：金色的“胜”章 */
.side.win .stamp {
  color: #ffd84a;
  border-color: #ffd84a;
  text-shadow: 0 0 8px rgba(255, 190, 40, 0.9);
}
@keyframes stamp {
  to {
    opacity: 1;
    transform: rotate(-14deg) scale(1);
  }
}
.vs {
  position: absolute;
  width: 0;
  height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-style: italic;
  color: var(--gold-l);
  text-shadow: 0 0 10px #ff8a00, 0 2px 0 #7a4a00;
  white-space: nowrap;
  opacity: 0;
  animation: vs 0.45s 0.45s both;
}
@keyframes vs {
  0% {
    opacity: 0;
    transform: scale(3);
  }
  60% {
    opacity: 1;
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes cfx-in {
  from {
    opacity: 0;
  }
}
@keyframes cfx-out {
  to {
    opacity: 0;
  }
}
</style>
