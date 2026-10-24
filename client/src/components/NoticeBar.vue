<script setup>
// 顶部系统通知横幅：多条轮播、按级别配色、过长滚动、停服倒计时；另含“新版本，点此刷新”
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { sysState } from '../lib/sys';
import { useNow } from '../lib/useNow';
import { fmtDur, fmtHM, fmtTime } from '../lib/fmt';

const route = useRoute();
const now = useNow();
const hidden = ref({}); // 本次打开页面里手动关掉的通知
const verHidden = ref(false);
const idx = ref(0);

const items = computed(() => {
  const out = [];
  if (sysState.newVersion && !verHidden.value) out.push({ key: 'ver', level: 'ver', text: '已更新到新版本', ver: true });
  for (const n of sysState.notices) {
    if (!n.banner || hidden.value[n.id + ':' + n.updatedAt]) continue;
    out.push({ key: n.id + ':' + n.updatedAt, level: n.level, n });
  }
  return out;
});
const visible = computed(() => !String(route.path).startsWith('/admin') && items.value.length > 0);
const cur = computed(() => items.value[idx.value % Math.max(1, items.value.length)] || null);

let rot = 0;
onMounted(() => {
  rot = setInterval(() => {
    if (items.value.length > 1) idx.value = (idx.value + 1) % items.value.length;
  }, 7000);
});
onBeforeUnmount(() => {
  clearInterval(rot);
  setH(false);
});

function setH(v) {
  document.documentElement.style.setProperty('--nb', v ? '34px' : '0px');
}
watch(visible, setH, { immediate: true });

function maintText(n) {
  if (n.level !== 'maint' || !n.maintStart) return '';
  const t = now.value;
  if (t < n.maintStart) return '距离停服 ' + fmtDur((n.maintStart - t) / 1000);
  if (!n.maintEnd || t < n.maintEnd) return n.maintEnd ? '维护中，预计 ' + fmtHM(n.maintEnd) + ' 恢复' : '维护中';
  return '';
}
function line(n) {
  let s = n.title + (n.content ? '：' + n.content.replace(/\s+/g, ' ') : '');
  if (n.level === 'maint' && n.maintStart) {
    s += '（' + fmtTime(n.maintStart) + (n.maintEnd ? ' – ' + fmtHM(n.maintEnd) : '') + '）';
  }
  return s;
}
function close() {
  const c = cur.value;
  if (!c) return;
  if (c.ver) verHidden.value = true;
  else hidden.value = { ...hidden.value, [c.key]: true };
}
function reload() {
  location.reload();
}

// 文字超出宽度时滚动
const box = ref(null);
const txt = ref(null);
const scroll = ref(0);
watch(
  () => cur.value && cur.value.key,
  () =>
    nextTick(() => {
      const b = box.value;
      const t = txt.value;
      scroll.value = b && t && t.scrollWidth > b.clientWidth ? t.scrollWidth - b.clientWidth + 24 : 0;
    }),
  { immediate: true },
);
</script>

<template>
  <div v-if="visible && cur" class="nbar" :class="cur.level">
    <template v-if="cur.ver">
      <span class="ic">🆕</span>
      <div class="msg">{{ cur.text }}，刷新后使用</div>
      <button class="act" @click="reload">刷新</button>
    </template>
    <template v-else>
      <span class="ic">{{ cur.level === 'maint' ? '🛠' : cur.level === 'warn' ? '⚠️' : '📢' }}</span>
      <div ref="box" class="msg">
        <span
          ref="txt"
          :key="cur.key"
          class="t"
          :class="{ run: scroll > 0 }"
          :style="scroll > 0 ? { '--dx': -scroll + 'px', animationDuration: Math.max(8, scroll / 30) + 's' } : null"
          >{{ line(cur.n) }}</span
        >
      </div>
      <span v-if="maintText(cur.n)" class="cd">{{ maintText(cur.n) }}</span>
    </template>
    <span v-if="items.length > 1" class="pg">{{ (idx % items.length) + 1 }}/{{ items.length }}</span>
    <button class="x" aria-label="关闭通知" @click="close">×</button>
  </div>
</template>

<style scoped>
.nbar {
  position: fixed;
  left: 0;
  right: 0;
  top: var(--sat-raw, 0px);
  z-index: 1500;
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 4px 0 10px;
  font-size: 13px;
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.nbar.info {
  background: linear-gradient(90deg, #1f5fa8, #2f7fd6);
}
.nbar.warn {
  background: linear-gradient(90deg, #b8650f, #e08a1e);
}
.nbar.maint {
  background: linear-gradient(90deg, #a1281c, #d9412e);
}
.nbar.ver {
  background: linear-gradient(90deg, #1f7a43, #2f9e5b);
}
.ic {
  flex: none;
  margin-right: 6px;
}
.msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.t {
  display: inline-block;
}
.t.run {
  animation: run linear infinite;
}
@keyframes run {
  0%,
  12% {
    transform: translateX(0);
  }
  88%,
  100% {
    transform: translateX(var(--dx));
  }
}
.cd {
  flex: none;
  margin-left: 8px;
  padding: 0 8px;
  font-weight: 800;
  line-height: 22px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.pg {
  flex: none;
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.8;
}
.act {
  flex: none;
  height: 24px;
  margin-left: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  color: #1f7a43;
  background: #fff;
  border-radius: 999px;
}
.x {
  flex: none;
  width: 30px;
  height: 30px;
  font-size: 20px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.85);
}
</style>
