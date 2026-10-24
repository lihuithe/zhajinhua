<script setup>
// 品牌标题：扇形三张 A（豹子）+ 金色“炸金花”
import PlayingCard from './PlayingCard.vue';

defineProps({
  size: { type: String, default: 'lg' }, // lg | sm
  sub: { type: String, default: '' },
});
const CARDS = [
  { r: 14, s: 's' },
  { r: 14, s: 'h' },
  { r: 14, s: 'd' },
];
</script>

<template>
  <div class="brand" :class="size">
    <div class="fan">
      <PlayingCard v-for="(c, i) in CARDS" :key="i" :card="c" :w="size === 'lg' ? 46 : 36" flat />
    </div>
    <h1>炸金花</h1>
    <p v-if="sub" class="sub">{{ sub }}</p>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.fan {
  display: flex;
  margin-bottom: -6px;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.5));
}
.fan > :deep(.pc:nth-child(1)) {
  transform: rotate(-16deg) translate(8px, 6px);
}
.fan > :deep(.pc:nth-child(2)) {
  z-index: 1;
  transform: translateY(-4px);
}
.fan > :deep(.pc:nth-child(3)) {
  transform: rotate(16deg) translate(-8px, 6px);
  z-index: 2;
}
h1 {
  position: relative;
  z-index: 3;
  margin: 0;
  font-family: 'STKaiti', 'KaiTi', 'Kaiti SC', serif;
  font-size: 50px;
  font-weight: 900;
  letter-spacing: 10px;
  text-indent: 10px;
  line-height: 1.15;
  color: #f0c24f;
  background: linear-gradient(180deg, #fff6d0 0%, #ffd56b 45%, #d4951f 70%, #ffe39a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #5a3a08) drop-shadow(0 8px 14px rgba(0, 0, 0, 0.6));
}
.sm h1 {
  font-size: 36px;
  letter-spacing: 8px;
  text-indent: 8px;
}
.sub {
  margin: 6px 0 0;
  font-size: 13px;
  letter-spacing: 2px;
  color: #a9bfb1;
}
</style>
