<script setup>
// 系统通知弹窗：每条（按 id + updatedAt）只弹一次；本人行动期间不弹
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import Modal from './Modal.vue';
import { sysState } from '../lib/sys';
import { fmtFull, fmtHM } from '../lib/fmt';

const KEY = 'zjh_notice_seen';
const route = useRoute();
function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {
    return {};
  }
}
const seen = ref(loadSeen());
const pending = computed(() => sysState.notices.filter((n) => n.popup && seen.value[n.id] !== n.updatedAt));
const cur = computed(() => {
  if (sysState.busy || String(route.path).startsWith('/admin')) return null;
  return pending.value[0] || null;
});
const open = computed({
  get: () => !!cur.value,
  set: (v) => {
    if (!v) ack();
  },
});
function ack() {
  const n = cur.value;
  if (!n) return;
  const next = { ...seen.value, [n.id]: n.updatedAt };
  // 只保留仍然存在的通知，避免越存越多
  const ids = new Set(sysState.notices.map((x) => String(x.id)));
  Object.keys(next).forEach((k) => ids.has(k) || delete next[k]);
  seen.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    /* 忽略 */
  }
}
const LEVEL = { info: '通知', warn: '重要', maint: '停服维护' };
</script>

<template>
  <Modal v-model="open" :title="cur ? cur.title : ''" :width="400" :z-index="1800">
    <div v-if="cur" class="np">
      <span class="lv" :class="cur.level">{{ LEVEL[cur.level] || '通知' }}</span>
      <div v-if="cur.level === 'maint' && cur.maintStart" class="mt">
        维护时间：{{ fmtFull(cur.maintStart) }}<template v-if="cur.maintEnd"> – {{ fmtHM(cur.maintEnd) }}</template>
      </div>
      <div class="ct selectable">{{ cur.content }}</div>
    </div>
    <template #footer>
      <button class="btn btn-gold btn-block" @click="ack">我知道了</button>
    </template>
  </Modal>
</template>

<style scoped>
.lv {
  display: inline-block;
  padding: 0 8px;
  font-size: 12px;
  line-height: 20px;
  color: #fff;
  border-radius: 4px;
  background: #2f7fd6;
}
.lv.warn {
  background: #e08a1e;
}
.lv.maint {
  background: #d9412e;
}
.mt {
  margin-top: 10px;
  padding: 8px 10px;
  font-size: 13px;
  color: #ffd2c9;
  background: rgba(217, 65, 46, 0.15);
  border: 1px solid rgba(217, 65, 46, 0.4);
  border-radius: 8px;
}
.ct {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: #efe6cc;
}
</style>
