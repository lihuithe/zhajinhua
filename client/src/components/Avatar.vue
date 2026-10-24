<script setup>
import { computed } from 'vue';
import { avatarColor, firstChar } from '../lib/cards';

const props = defineProps({
  userId: { type: String, default: '' },
  name: { type: String, default: '' },
  size: { type: Number, default: 40 },
  ring: { type: Boolean, default: true }, // 金色描边
});

const style = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  fontSize: Math.round(props.size * 0.44) + 'px',
  backgroundImage: avatarColor(props.userId || props.name),
  borderWidth: Math.max(1.5, Math.round(props.size * 0.045)) + 'px',
}));
</script>

<template>
  <div class="avatar" :class="{ rim: ring }" :style="style">
    <span>{{ firstChar(name) }}</span>
  </div>
</template>

<style scoped>
.avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  color: #fff;
  font-weight: 800;
  line-height: 1;
  border: 2px solid rgba(255, 255, 255, 0.25);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45), inset 0 -6px 10px rgba(0, 0, 0, 0.22), inset 0 4px 6px rgba(255, 255, 255, 0.22);
  overflow: hidden;
}
.avatar.rim {
  border-color: #f0cf7a;
}
.avatar span {
  position: relative;
  z-index: 1;
}
</style>
