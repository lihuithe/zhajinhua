<script setup>
import { onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // center：居中对话框；sheet：手机从底部滑出、宽屏居中
  variant: { type: String, default: 'center' },
  width: { type: Number, default: 440 },
  closable: { type: Boolean, default: true },
  maskClose: { type: Boolean, default: true },
  zIndex: { type: Number, default: 1000 },
});
const emit = defineEmits(['update:modelValue', 'close']);

function close() {
  if (!props.closable) return;
  emit('update:modelValue', false);
  emit('close');
}
function onKey(e) {
  if (e.key === 'Escape' && props.modelValue) close();
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <teleport to="body">
    <transition name="modal">
      <div v-if="modelValue" class="mask" :class="variant" :style="{ zIndex }" @click.self="maskClose && close()">
        <div class="dialog" :style="{ maxWidth: width + 'px' }" role="dialog" aria-modal="true">
          <div v-if="title || closable" class="head">
            <div class="title">{{ title }}</div>
            <button v-if="closable" class="x" aria-label="关闭" @click="close">×</button>
          </div>
          <div class="body"><slot /></div>
          <div v-if="$slots.footer" class="foot"><slot name="footer" /></div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(12px + var(--sat)) calc(12px + var(--sar)) calc(12px + var(--sab)) calc(12px + var(--sal));
  background: rgba(0, 0, 0, 0.62);
}
.dialog {
  width: 100%;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  max-height: calc(100dvh - 24px - var(--sat) - var(--sab));
  background: linear-gradient(180deg, #14352a 0%, #0c241a 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 4px 16px;
  min-height: 48px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: none;
}
.title {
  font-size: 17px;
  font-weight: 700;
  color: var(--gold);
  letter-spacing: 1px;
}
.x {
  width: 44px;
  height: 44px;
  font-size: 28px;
  line-height: 1;
  color: var(--muted);
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 14px 16px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.foot {
  flex: none;
  padding: 10px 16px calc(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

/* 手机上 sheet 变体贴底 */
@media (max-width: 640px) {
  .mask.sheet {
    align-items: flex-end;
    padding-bottom: 0;
    padding-left: 0;
    padding-right: 0;
  }
  .mask.sheet .dialog {
    max-width: none !important;
    border-radius: 18px 18px 0 0;
    max-height: 88vh;
    max-height: 88dvh;
    padding-bottom: var(--sab);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s;
}
.modal-enter-active .dialog,
.modal-leave-active .dialog {
  transition: transform 0.22s;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .dialog,
.modal-leave-to .dialog {
  transform: translateY(24px) scale(0.98);
}
</style>
