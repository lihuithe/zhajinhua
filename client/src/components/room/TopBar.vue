<script setup>
import { computed } from 'vue';

const props = defineProps({
  code: { type: String, default: '' },
  sessionNo: { type: Number, default: 1 },
  handNo: { type: Number, default: 0 },
  hands: { type: Number, default: 0 },
  phase: { type: String, default: 'waiting' },
});
defineEmits(['copy', 'menu', 'invite', 'exit']);

const progress = computed(() => {
  if (props.phase === 'waiting') return '准备中 · 共 ' + props.hands + ' 局';
  if (props.phase === 'finished') return '本场已结束';
  return '第' + props.handNo + '/' + props.hands + '局';
});
const remain = computed(() => {
  if (props.phase !== 'playing') return '';
  const n = Math.max(0, props.hands - props.handNo);
  return n > 0 ? '剩' + n + '局' : '最后一局';
});
</script>

<template>
  <header class="top">
    <div class="left">
      <button class="code" aria-label="复制房间号" @click="$emit('copy')">
        <span class="lbl">房间</span>
        <b class="mono">{{ code }}</b>
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h10V9z"/></svg>
      </button>
      <div class="prog">
        <span class="sess">第 {{ sessionNo }} 场</span>
        <span>{{ progress }}</span>
        <span v-if="remain" class="rem">{{ remain }}</span>
      </div>
    </div>
    <div class="btns">
      <button class="tb" @click="$emit('menu')">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>
        <span>菜单</span>
      </button>
      <button class="tb gold" @click="$emit('invite')">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v2h14v-2c0-2.3-3.7-4-7-4zm10-4V7h-2v3h-3v2h3v3h2v-3h3v-2z"/></svg>
        <span>邀请</span>
      </button>
      <slot name="extra" />
      <button class="tb exit" @click="$emit('exit')">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9zm-1 5 1.4 1.4L8.8 11H16v2H8.8l1.6 1.6L9 16l-4-4z"/></svg>
        <span>退出</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.top {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: calc(6px + var(--sat)) calc(8px + var(--sar)) 6px calc(10px + var(--sal));
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.3));
  border-bottom: 1px solid rgba(240, 207, 122, 0.22);
  z-index: 30;
}
.left {
  flex: 1 1 auto;
  min-width: 0;
}
.code {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  color: var(--gold);
  background: rgba(240, 207, 122, 0.1);
  border: 1px solid rgba(240, 207, 122, 0.35);
  border-radius: 999px;
  white-space: nowrap;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  margin-right: 5px;
}
.code b {
  font-size: 15px;
  letter-spacing: 1px;
  color: #ffe39a;
  margin-right: 5px;
}
.prog {
  display: flex;
  align-items: center;
  margin-top: 4px;
  font-size: 12.5px;
  color: #e7dfc8;
  white-space: nowrap;
  overflow: hidden;
}
.prog span + span {
  margin-left: 5px;
}
.rem {
  font-weight: 700;
}
.sess {
  padding: 0 6px;
  font-size: 11.5px;
  line-height: 17px;
  color: #3a2603;
  font-weight: 700;
  background: linear-gradient(180deg, #ffe9a8, #e6b84f);
  border-radius: 4px;
}
.rem {
  color: #9fd8b4;
}
.btns {
  flex: none;
  display: flex;
}
.tb {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 44px;
  margin-left: 4px;
  font-size: 11px;
  color: #e7dfc8;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}
.tb svg {
  width: 20px;
  height: 20px;
  margin-bottom: 1px;
  color: var(--gold);
}
.tb.gold {
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #e6b84f 60%, #c0901f);
  border-color: #ffe9a8;
}
.tb.gold svg {
  color: #3a2603;
}
.tb.exit svg {
  color: #ff9a88;
}
@media (min-width: 1100px) {
  .top {
    padding-left: 20px;
    padding-right: 20px;
  }
  .left {
    display: flex;
    align-items: center;
  }
  .prog {
    margin: 0 0 0 14px;
    font-size: 14px;
  }
  .tb {
    flex-direction: row;
    width: auto;
    height: 38px;
    padding: 0 14px;
    margin-left: 8px;
    font-size: 14px;
  }
  .tb svg {
    margin: 0 6px 0 0;
    width: 18px;
    height: 18px;
  }
}
</style>
