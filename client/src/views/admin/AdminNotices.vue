<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import Modal from '../../components/Modal.vue';
import { adminApi, LEVEL_TEXT } from '../../lib/adminApi';
import { fmtTime, toLocalInput, fromLocalInput } from '../../lib/fmt';
import { toast, toastError, confirmDialog } from '../../lib/ui';

const items = ref([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    items.value = (await adminApi.notices()).items || [];
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function status(n) {
  const now = Date.now();
  if (!n.enabled) return { t: '已停用', c: 'gray' };
  if (n.startsAt && n.startsAt > now) return { t: '未开始', c: 'orange' };
  if (n.endsAt && n.endsAt <= now) return { t: '已过期', c: 'gray' };
  return { t: '生效中', c: 'green' };
}
const LEVEL_CLS = { info: 'blue', warn: 'orange', maint: 'red' };

/* 编辑 */
const open = ref(false);
const editingId = ref(null);
const f = reactive({});
function reset(n) {
  Object.assign(f, {
    title: n ? n.title : '',
    content: n ? n.content : '',
    level: n ? n.level : 'info',
    banner: n ? n.banner : true,
    popup: n ? n.popup : false,
    startsAt: n ? toLocalInput(n.startsAt) : '',
    endsAt: n ? toLocalInput(n.endsAt) : '',
    maintStart: n ? toLocalInput(n.maintStart) : '',
    maintEnd: n ? toLocalInput(n.maintEnd) : '',
    enabled: n ? n.enabled : true,
  });
}
function create(tpl) {
  editingId.value = null;
  reset(null);
  if (tpl === 'maint') {
    // 停服模板：默认今晚 23:00 开始，维护 30 分钟，到维护结束后自动下线
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    const st = d.getTime();
    Object.assign(f, {
      title: '停服维护通知',
      content: '为了更新新功能，服务器将停服维护，维护期间无法进入游戏，请大家提前结束对局。给大家带来不便，敬请谅解！',
      level: 'maint',
      banner: true,
      popup: true,
      maintStart: toLocalInput(st),
      maintEnd: toLocalInput(st + 30 * 60 * 1000),
      endsAt: toLocalInput(st + 30 * 60 * 1000),
    });
  }
  open.value = true;
}
function edit(n) {
  editingId.value = n.id;
  reset(n);
  open.value = true;
}
const titleLen = computed(() => Array.from(f.title || '').length);
const contentLen = computed(() => Array.from(f.content || '').length);
function payload() {
  return {
    title: f.title.trim(),
    content: f.content.trim(),
    level: f.level,
    banner: !!f.banner,
    popup: !!f.popup,
    startsAt: fromLocalInput(f.startsAt),
    endsAt: fromLocalInput(f.endsAt),
    maintStart: f.level === 'maint' ? fromLocalInput(f.maintStart) : null,
    maintEnd: f.level === 'maint' ? fromLocalInput(f.maintEnd) : null,
    enabled: !!f.enabled,
  };
}
const saving = ref(false);
async function save() {
  const p = payload();
  if (!p.title || titleLen.value > 40) return toastError('标题需为 1–40 字');
  if (contentLen.value > 500) return toastError('内容最多 500 字');
  if (!p.banner && !p.popup) return toastError('横幅和弹窗至少选一种');
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) return toastError('失效时间要晚于生效时间');
  if (p.level === 'maint' && p.maintStart && p.maintEnd && p.maintEnd <= p.maintStart) return toastError('维护结束时间要晚于开始时间');
  saving.value = true;
  try {
    if (editingId.value) await adminApi.updateNotice(editingId.value, p);
    else await adminApi.createNotice(p);
    open.value = false;
    toast('已保存，所有在线用户会立即收到', 'ok');
    load();
  } catch (e) {
    toastError(e.message);
  } finally {
    saving.value = false;
  }
}
async function toggle(n) {
  try {
    await adminApi.updateNotice(n.id, { enabled: !n.enabled });
    load();
  } catch (e) {
    toastError(e.message);
  }
}
async function remove(n) {
  if (!(await confirmDialog({ title: '删除通知', message: '确定删除「' + n.title + '」吗？', okText: '删除', danger: true }))) return;
  try {
    await adminApi.deleteNotice(n.id);
    load();
  } catch (e) {
    toastError(e.message);
  }
}
const preview = computed(() => {
  const p = payload();
  return p.title + (p.content ? '：' + p.content.replace(/\s+/g, ' ') : '');
});
</script>

<template>
  <div>
    <div class="toolbar">
      <button class="btn btn-gold" @click="create()">＋ 新建通知</button>
      <button class="btn btn-danger" @click="create('maint')">＋ 停服维护通知</button>
      <button class="btn" @click="load">刷新</button>
    </div>
    <p class="muted hint">保存后立即推送给所有在线用户；登录页也能看到。横幅显示在页面顶部，弹窗每个用户只弹一次（修改内容后会再弹）。</p>

    <div v-if="!items.length" class="card muted">{{ loading ? '加载中…' : '还没有通知' }}</div>
    <div v-for="n in items" :key="n.id" class="card notice">
      <div class="top">
        <span class="tag" :class="LEVEL_CLS[n.level]">{{ LEVEL_TEXT[n.level] }}</span>
        <span class="tag" :class="status(n).c">{{ status(n).t }}</span>
        <b class="title">{{ n.title }}</b>
        <span class="sp"></span>
        <button class="btn btn-xs" @click="edit(n)">编辑</button>
        <button class="btn btn-xs" @click="toggle(n)">{{ n.enabled ? '停用' : '启用' }}</button>
        <button class="btn btn-xs btn-danger" @click="remove(n)">删除</button>
      </div>
      <div v-if="n.content" class="content">{{ n.content }}</div>
      <div class="meta muted">
        <span>{{ [n.banner ? '横幅' : '', n.popup ? '弹窗' : ''].filter(Boolean).join(' + ') }}</span>
        <span>生效：{{ n.startsAt ? fmtTime(n.startsAt) : '立即' }} → {{ n.endsAt ? fmtTime(n.endsAt) : '不过期' }}</span>
        <span v-if="n.level === 'maint'">维护：{{ fmtTime(n.maintStart) }} → {{ fmtTime(n.maintEnd) }}</span>
        <span>更新于 {{ fmtTime(n.updatedAt) }}</span>
      </div>
    </div>

    <Modal v-model="open" :title="editingId ? '编辑通知' : '新建通知'" :width="560">
      <div class="adm-in">
        <div class="field">
          <label>级别</label>
          <div class="seg">
            <button v-for="(t, k) in LEVEL_TEXT" :key="k" :class="{ on: f.level === k }" @click="f.level = k">{{ t }}</button>
          </div>
        </div>
        <div class="field">
          <label>标题（{{ titleLen }}/40）</label>
          <input v-model="f.title" class="input" maxlength="40" placeholder="例如：今晚 23:00 停服维护" />
        </div>
        <div class="field">
          <label>内容（{{ contentLen }}/500）</label>
          <textarea v-model="f.content" class="input" maxlength="500" rows="4" placeholder="通知正文，可换行"></textarea>
        </div>
        <div class="field">
          <label>展示方式</label>
          <label class="check"><input v-model="f.banner" type="checkbox" />顶部横幅</label>
          <label class="check"><input v-model="f.popup" type="checkbox" />弹窗</label>
          <label class="check"><input v-model="f.enabled" type="checkbox" />启用</label>
        </div>
        <div v-if="f.level === 'maint'" class="two">
          <div class="field">
            <label>维护开始（横幅显示倒计时）</label>
            <input v-model="f.maintStart" class="input" type="datetime-local" />
          </div>
          <div class="field">
            <label>预计维护结束</label>
            <input v-model="f.maintEnd" class="input" type="datetime-local" />
          </div>
        </div>
        <div class="two">
          <div class="field">
            <label>生效时间（留空 = 立即）</label>
            <input v-model="f.startsAt" class="input" type="datetime-local" />
          </div>
          <div class="field">
            <label>失效时间（留空 = 不过期）</label>
            <input v-model="f.endsAt" class="input" type="datetime-local" />
          </div>
        </div>
        <div class="field">
          <label>横幅预览</label>
          <div class="pv" :class="f.level">{{ f.level === 'maint' ? '🛠' : f.level === 'warn' ? '⚠️' : '📢' }} {{ preview }}</div>
        </div>
      </div>
      <template #footer>
        <div class="two">
          <button class="btn btn-ghost" @click="open = false">取消</button>
          <button class="btn btn-gold" :disabled="saving" @click="save">保存并推送</button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.hint {
  margin: -4px 0 14px;
  font-size: 13px;
}
.notice .top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.title {
  font-size: 15px;
  color: #ffe9b0;
}
.sp {
  flex: 1;
}
.content {
  margin-top: 10px;
  white-space: pre-wrap;
  line-height: 1.7;
  word-break: break-word;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 10px;
  font-size: 12px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 520px) {
  .adm-in .two {
    grid-template-columns: 1fr;
  }
}
.pv {
  padding: 8px 12px;
  font-size: 13px;
  color: #fff;
  border-radius: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: linear-gradient(90deg, #1f5fa8, #2f7fd6);
}
.pv.warn {
  background: linear-gradient(90deg, #b8650f, #e08a1e);
}
.pv.maint {
  background: linear-gradient(90deg, #a1281c, #d9412e);
}
.input[type='datetime-local'] {
  color-scheme: dark;
}
</style>
