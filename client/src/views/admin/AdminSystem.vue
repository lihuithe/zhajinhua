<script setup>
import { ref, onMounted } from 'vue';
import { adminApi } from '../../lib/adminApi';
import { MAINT_DEFAULT } from '../../lib/sys';
import { fmtFull, fmtUptime } from '../../lib/fmt';
import { toast, toastError, confirmDialog } from '../../lib/ui';

const data = ref(null);
const msg = ref('');
async function load() {
  try {
    data.value = await adminApi.system();
    msg.value = (data.value.maintenance && data.value.maintenance.message) || '';
  } catch (e) {
    toastError(e.message);
  }
}
onMounted(load);

async function setMaint(enabled) {
  const ok = await confirmDialog({
    title: enabled ? '开启维护模式' : '关闭维护模式',
    message: enabled
      ? '开启后不能开新房间、不能开始新的一场；进行中的一场可以继续打完。所有在线用户会立即看到提示。'
      : '关闭后恢复正常，可以开房、开局。',
    okText: enabled ? '开启' : '关闭',
    danger: enabled,
  });
  if (!ok) return;
  try {
    await adminApi.setMaintenance(enabled, msg.value.trim());
    toast(enabled ? '已开启维护模式' : '已关闭维护模式', 'ok');
    load();
  } catch (e) {
    toastError(e.message);
  }
}
async function saveMsg() {
  try {
    await adminApi.setMaintenance(!!(data.value && data.value.maintenance.enabled), msg.value.trim());
    toast('提示语已保存', 'ok');
    load();
  } catch (e) {
    toastError(e.message);
  }
}
</script>

<template>
  <div v-if="data" class="grid2">
    <div class="card">
      <div class="card-title">
        维护模式
        <span class="tag" :class="data.maintenance.enabled ? 'red' : 'green'">{{ data.maintenance.enabled ? '已开启' : '未开启' }}</span>
      </div>
      <p class="muted p">开启后：不能开新房间、不能开始新的一场；已经开始的一场照常打完。大厅会显示维护提示。</p>
      <div class="field">
        <label>提示语（留空用默认：{{ MAINT_DEFAULT }}）</label>
        <input v-model="msg" class="input" maxlength="60" placeholder="例如：23:00 停服更新，暂停开新局" />
      </div>
      <div class="row">
        <button v-if="!data.maintenance.enabled" class="btn btn-danger" @click="setMaint(true)">开启维护模式</button>
        <button v-else class="btn btn-gold" @click="setMaint(false)">关闭维护模式</button>
        <button class="btn" @click="saveMsg">只保存提示语</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">服务器</div>
      <dl class="kv">
        <dt>版本</dt>
        <dd class="mono">{{ data.server.version }}</dd>
        <dt>启动时间</dt>
        <dd>{{ fmtFull(data.server.startedAt) }}</dd>
        <dt>已运行</dt>
        <dd>{{ fmtUptime(data.server.uptimeSec) }}</dd>
        <dt>内存</dt>
        <dd>{{ data.server.memoryMB }} MB</dd>
        <dt>最近快照</dt>
        <dd>{{ data.snapshot && data.snapshot.lastSavedAt ? fmtFull(data.snapshot.lastSavedAt) : '—' }}</dd>
        <dt>本次启动恢复</dt>
        <dd>
          <template v-if="data.snapshot && data.snapshot.restoredAt">
            {{ fmtFull(data.snapshot.restoredAt) }}，恢复 {{ data.snapshot.restoredRooms }} 个房间
          </template>
          <span v-else class="muted">没有恢复（全新启动）</span>
        </dd>
      </dl>
    </div>

    <div class="card guide">
      <div class="card-title">部署说明</div>
      <ol>
        <li>
          <b>日常更新（不停服）</b>：在开发机执行 <code>bash deploy/deploy.sh</code>。服务重启约 1 秒，房间和进行中的牌局会自动恢复，玩家只看到“服务器更新中，正在重连…”。
        </li>
        <li>
          <b>大更新（需要停服）</b>：只有牌局数据结构不兼容时才需要。
          <ol>
            <li>在「系统通知」发布一条“停服维护”通知，写明维护时间。</li>
            <li>维护前开启上面的维护模式，让进行中的牌局自然打完。</li>
            <li>到点执行 <code>bash deploy/deploy.sh --fresh</code>（不恢复房间）。</li>
            <li>完成后关闭维护模式，停用通知。</li>
          </ol>
        </li>
      </ol>
    </div>
  </div>
  <div v-else class="muted">加载中…</div>
</template>

<style scoped>
.p {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.guide ol {
  margin: 0;
  padding-left: 20px;
  line-height: 1.9;
}
.guide ol ol {
  margin-top: 4px;
}
code {
  padding: 1px 6px;
  font-size: 13px;
  color: #ffe9b0;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 4px;
}
</style>
