<script setup>
import { toasts } from '../lib/ui';
</script>

<template>
  <div class="toast-host">
    <transition-group name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.text }}</div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 0;
  right: 0;
  top: calc(64px + var(--sat));
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  padding: 0 16px;
}
.toast {
  max-width: 92%;
  margin-bottom: 8px;
  padding: 10px 16px;
  font-size: 15px;
  line-height: 1.35;
  text-align: center;
  color: #fff;
  background: rgba(20, 20, 20, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  word-break: break-all;
}
.toast.error {
  background: rgba(130, 36, 24, 0.95);
  border-color: #f28a77;
}
.toast.ok {
  background: rgba(24, 90, 52, 0.95);
  border-color: #6fd392;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
