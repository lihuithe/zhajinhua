<script setup>
import { computed } from 'vue';
import { SUIT_CHAR, SUIT_RED, rankText } from '../lib/cards';

// card: { r, s }；faceUp=false 或无 card 时显示牌背
// flat=true：不做 3D 翻转（小牌 / 大量渲染时更轻量）
const props = defineProps({
  card: { type: Object, default: null },
  faceUp: { type: Boolean, default: true },
  w: { type: Number, default: 48 },
  flat: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  glow: { type: Boolean, default: false },
});

const up = computed(() => !!(props.card && props.faceUp));
const red = computed(() => !!(props.card && SUIT_RED[props.card.s]));
const rank = computed(() => (props.card ? rankText(props.card.r) : ''));
const suit = computed(() => (props.card ? SUIT_CHAR[props.card.s] : ''));
const court = computed(() => !!(props.card && props.card.r >= 11 && props.card.r <= 13));
const style = computed(() => ({ '--w': props.w + 'px' }));
// 小牌只画角标 + 中间花色，避免文字挤在一起
const tiny = computed(() => props.w < 24);
</script>

<template>
  <div class="pc" :class="{ up, red, flat, clickable, glow, tiny }" :style="style">
    <template v-if="flat">
      <div v-if="up" class="face flat-face">
        <span class="corner">{{ rank }}<i>{{ suit }}</i></span>
        <span class="mid">{{ suit }}</span>
      </div>
      <div v-else class="back"></div>
    </template>
    <div v-else class="inner">
      <div class="face">
        <span class="corner">{{ rank }}<i>{{ suit }}</i></span>
        <span v-if="court" class="court">{{ rank }}</span>
        <span v-else class="mid big">{{ suit }}</span>
        <span class="corner br">{{ rank }}<i>{{ suit }}</i></span>
      </div>
      <div class="back"></div>
    </div>
  </div>
</template>

<style scoped>
.pc {
  position: relative;
  flex: none;
  width: var(--w);
  height: calc(var(--w) * 1.4);
  perspective: 600px;
  -webkit-perspective: 600px;
}
.pc.clickable {
  cursor: pointer;
}
.inner {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  -webkit-transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.3, 1.3, 0.5, 1);
}
.pc.up .inner {
  transform: rotateY(180deg);
}
.face,
.back {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: calc(var(--w) * 0.1);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.face {
  background: linear-gradient(165deg, #ffffff 0%, #fbf7ec 60%, #efe6cf 100%);
  color: #1d1d22;
  transform: rotateY(180deg);
  overflow: hidden;
  font-family: Georgia, 'Times New Roman', 'Songti SC', serif;
}
.pc.red .face {
  color: #d0202e;
}
.flat-face {
  transform: none;
}
.corner {
  position: absolute;
  left: calc(var(--w) * 0.07);
  top: calc(var(--w) * 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: 700;
  font-size: calc(var(--w) * 0.34);
  line-height: 0.95;
  letter-spacing: -0.05em;
}
.corner i {
  font-style: normal;
  font-size: calc(var(--w) * 0.26);
  margin-top: calc(var(--w) * 0.02);
}
.corner.br {
  left: auto;
  top: auto;
  right: calc(var(--w) * 0.07);
  bottom: calc(var(--w) * 0.05);
  transform: rotate(180deg);
}
.mid {
  position: absolute;
  left: 50%;
  top: 52%;
  transform: translate(-50%, -50%);
  font-size: calc(var(--w) * 0.58);
  line-height: 1;
}
.mid.big {
  font-size: calc(var(--w) * 0.62);
  top: 54%;
}
.court {
  position: absolute;
  left: 24%;
  right: 24%;
  top: 24%;
  bottom: 24%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--w) * 0.46);
  font-weight: 700;
  border: 1.5px solid currentColor;
  border-radius: calc(var(--w) * 0.06);
  background: linear-gradient(160deg, rgba(240, 200, 100, 0.25), rgba(240, 200, 100, 0.05));
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.8), inset 0 0 0 3px rgba(200, 160, 60, 0.35);
}
.flat-face .corner {
  font-size: calc(var(--w) * 0.4);
}
.flat-face .corner i {
  font-size: calc(var(--w) * 0.3);
}
.flat-face .mid {
  left: auto;
  right: calc(var(--w) * 0.02);
  top: auto;
  bottom: calc(var(--w) * 0.02);
  transform: none;
  font-size: calc(var(--w) * 0.5);
}
.pc.tiny .flat-face .mid {
  display: none;
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: #7d1426;
  background-image: repeating-linear-gradient(45deg, rgba(240, 200, 110, 0.22) 0 1px, transparent 1px 6px),
    repeating-linear-gradient(-45deg, rgba(240, 200, 110, 0.22) 0 1px, transparent 1px 6px),
    radial-gradient(ellipse at 50% 40%, #a51d34 0%, #6a0f1f 100%);
  border: calc(var(--w) * 0.055) solid #fbf3df;
}
.back::before {
  content: '';
  position: absolute;
  left: 6%;
  top: 5%;
  right: 6%;
  bottom: 5%;
  border: 1px solid rgba(240, 200, 110, 0.55);
  border-radius: calc(var(--w) * 0.05);
}
.pc.glow .back {
  animation: cardGlow 1.4s ease-in-out infinite;
}
@keyframes cardGlow {
  0%,
  100% {
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45), 0 0 0 2px rgba(255, 215, 110, 0.6);
  }
  50% {
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45), 0 0 0 3px rgba(255, 225, 140, 1), 0 0 18px 4px rgba(255, 200, 80, 0.7);
  }
}
</style>
