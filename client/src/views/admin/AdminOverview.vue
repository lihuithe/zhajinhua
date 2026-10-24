<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { adminApi } from '../../lib/adminApi';
import { fmtFull, fmtUptime } from '../../lib/fmt';

const data = ref(null);
const err = ref('');
let timer = 0;

async function load() {
  try {
    data.value = await adminApi.overview();
    err.value = '';
  } catch (e) {
    err.value = e.message;
  }
}
onMounted(() => {
  load();
  timer = setInterval(load, 10000);
});
onBeforeUnmount(() => clearInterval(timer));

const CARDS = [
  { k: 'online', label: '当前在线', unit: '人', color: '#5fd68d' },
  { k: 'roomsLive', label: '房间（内存中）', unit: '个', sub: (s) => '对局中 ' + s.roomsPlaying },
  { k: 'usersTotal', label: '注册用户', unit: '人', sub: (s) => '今日新增 ' + s.usersToday },
  { k: 'roomsToday', label: '今日开房', unit: '个' },
  { k: 'sessionsToday', label: '今日完成场次', unit: '场', sub: (s) => '累计 ' + s.sessionsTotal },
  { k: 'handsToday', label: '今日对局', unit: '局', sub: (s) => '累计 ' + s.handsTotal },
];
</script>

<template>
  <div>
    <div v-if="err" class="card err">加载失败：{{ err }}</div>
    <template v-if="data">
      <div class="cards">
        <div v-for="c in CARDS" :key="c.k" class="stat">
          <div class="lb">{{ c.label }}</div>
          <div class="v" :style="c.color ? { color: c.color } : null">
            {{ data.stats[c.k] }}<small>{{ c.unit }}</small>
          </div>
          <div v-if="c.sub" class="sub">{{ c.sub(data.stats) }}</div>
        </div>
      </div>

      <div class="grid2" style="margin-top: 14px">
        <div class="card">
          <div class="card-title">服务器</div>
          <dl class="kv">
            <dt>版本</dt>
            <dd class="mono">{{ data.server.version }}</dd>
            <dt>启动时间</dt>
            <dd>{{ fmtFull(data.server.startedAt) }}</dd>
            <dt>已运行</dt>
            <dd>{{ fmtUptime(data.server.uptimeSec) }}</dd>
            <dt>内存占用</dt>
            <dd>{{ data.server.memoryMB }} MB</dd>
            <dt>Node.js</dt>
            <dd>{{ data.server.node }}</dd>
            <dt>进程号</dt>
            <dd>{{ data.server.pid }}</dd>
          </dl>
        </div>
        <div class="card">
          <div class="card-title">
            维护模式
            <router-link to="/admin/system" class="btn btn-ghost btn-xs">去设置</router-link>
          </div>
          <div v-if="data.maintenance && data.maintenance.enabled" class="maint on">
            <b>已开启</b>：不能开新房间、不能开始新的一场，进行中的一场可以打完。
            <div class="muted">提示语：{{ data.maintenance.message || '（默认）' }}</div>
          </div>
          <div v-else class="maint">未开启，服务正常。</div>
          <p class="muted tip">
            日常更新是热更新，房间和牌局不受影响。大更新前请先发停服通知，再开启维护模式。
          </p>
        </div>
      </div>
    </template>
    <div v-else-if="!err" class="muted">加载中…</div>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.stat {
  padding: 16px 18px;
  background: linear-gradient(160deg, #17291f, #101c17);
  border: 1px solid var(--a-line);
  border-radius: 14px;
}
.lb {
  font-size: 13px;
  color: var(--a-muted);
}
.v {
  margin-top: 6px;
  font-size: 30px;
  font-weight: 800;
  color: #ffe9b0;
  font-variant-numeric: tabular-nums;
}
.v small {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--a-muted);
}
.sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--a-muted);
}
.maint {
  padding: 10px 12px;
  line-height: 1.7;
  background: rgba(47, 158, 91, 0.12);
  border-radius: 10px;
}
.maint.on {
  background: rgba(217, 65, 46, 0.15);
  border: 1px solid rgba(217, 65, 46, 0.4);
}
.tip {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.6;
}
.err {
  color: #ffb4a6;
}
</style>
