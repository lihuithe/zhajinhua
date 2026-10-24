<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Modal from '../../components/Modal.vue';
import Avatar from '../../components/Avatar.vue';
import Pager from '../../components/admin/Pager.vue';
import { adminApi } from '../../lib/adminApi';
import { fmtTime, fmtFull } from '../../lib/fmt';
import { typeName } from '../../lib/cards';
import { toast, toastError, confirmDialog } from '../../lib/ui';

const router = useRouter();
const q = ref('');
const page = ref(1);
const size = 20;
const list = ref({ items: [], total: 0 });
const loading = ref(false);

async function load(p = page.value) {
  loading.value = true;
  try {
    const r = await adminApi.users({ q: q.value.trim(), page: p, size });
    list.value = r;
    page.value = r.page || p;
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(() => load(1));

const fmtNet = (n) => (n > 0 ? '+' + n : String(n));

/* 详情 */
const open = ref(false);
const detail = ref(null);
async function show(u) {
  open.value = true;
  detail.value = { user: u, sessions: null };
  try {
    detail.value = await adminApi.user(u.userId);
  } catch (e) {
    toastError(e.message);
  }
}
const pwd = ref('');
async function resetPwd() {
  const u = detail.value.user;
  if (pwd.value.length < 4 || pwd.value.length > 64) {
    toastError('密码需为 4–64 位');
    return;
  }
  const ok = await confirmDialog({
    title: '重置密码',
    message: '把「' + u.username + '」的密码重置为你输入的新密码？该用户会被踢下线，需要用新密码重新登录。',
    okText: '重置',
    danger: true,
  });
  if (!ok) return;
  try {
    await adminApi.resetPassword(u.userId, pwd.value);
    pwd.value = '';
    toast('密码已重置', 'ok');
  } catch (e) {
    toastError(e.message);
  }
}
async function toggleBan() {
  const u = detail.value.user;
  const ban = !u.banned;
  const ok = await confirmDialog({
    title: ban ? '封禁账号' : '解除封禁',
    message: ban ? '封禁后「' + u.username + '」会被立即踢下线，并且无法再登录。确定吗？' : '确定解除「' + u.username + '」的封禁吗？',
    okText: ban ? '封禁' : '解封',
    danger: ban,
  });
  if (!ok) return;
  try {
    await adminApi.ban(u.userId, ban);
    detail.value = await adminApi.user(u.userId);
    load();
    toast(ban ? '已封禁' : '已解封', 'ok');
  } catch (e) {
    toastError(e.message);
  }
}
function toRecords(u) {
  open.value = false;
  router.push({ path: '/admin/records', query: { user: u.userId, name: u.nickname } });
}
function toRoom(code) {
  open.value = false;
  router.push({ path: '/admin/rooms', query: { open: code } });
}
</script>

<template>
  <div>
    <div class="toolbar">
      <input v-model="q" class="input" placeholder="搜索账号或昵称" @keyup.enter="load(1)" />
      <button class="btn btn-gold" @click="load(1)">搜索</button>
      <button v-if="q" class="btn" @click="(q = ''), load(1)">清空</button>
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>用户</th>
            <th>账号</th>
            <th>注册时间</th>
            <th>最近登录</th>
            <th class="num">场数</th>
            <th class="num">局数</th>
            <th class="num">累计输赢</th>
            <th>状态</th>
            <th>当前房间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list.items" :key="u.userId">
            <td>
              <div class="who">
                <Avatar :user-id="u.userId" :name="u.nickname" :size="26" />
                <span>{{ u.nickname }}</span>
              </div>
            </td>
            <td class="mono">{{ u.username }}</td>
            <td>{{ fmtTime(u.createdAt) }}</td>
            <td>{{ fmtTime(u.lastLoginAt) }}</td>
            <td class="num">{{ u.sessions }}</td>
            <td class="num">{{ u.hands }}</td>
            <td class="num" :class="u.net > 0 ? 'pos' : u.net < 0 ? 'neg' : ''">{{ fmtNet(u.net) }}</td>
            <td>
              <span v-if="u.banned" class="tag red">已封禁</span>
              <span v-else-if="u.online" class="tag green">在线</span>
              <span v-else class="tag gray">离线</span>
            </td>
            <td>
              <span v-if="u.roomCode" class="link mono" @click="toRoom(u.roomCode)">{{ u.roomCode }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td><button class="btn btn-xs" @click="show(u)">详情</button></td>
          </tr>
          <tr v-if="!list.items.length">
            <td colspan="10" class="empty">{{ loading ? '加载中…' : '没有数据' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pager :page="page" :size="size" :total="list.total" @change="load" />

    <Modal v-model="open" :title="detail ? detail.user.nickname : ''" :width="760">
      <div v-if="detail" class="adm-in">
        <div class="grid2">
          <dl class="kv">
            <dt>账号</dt>
            <dd class="mono">{{ detail.user.username }}</dd>
            <dt>用户 ID</dt>
            <dd class="mono">{{ detail.user.userId }}</dd>
            <dt>注册时间</dt>
            <dd>{{ fmtFull(detail.user.createdAt) }}</dd>
            <dt>最近登录</dt>
            <dd>{{ fmtFull(detail.user.lastLoginAt) }}</dd>
            <dt>状态</dt>
            <dd>
              <span v-if="detail.user.banned" class="tag red">已封禁</span>
              <span v-else-if="detail.user.online" class="tag green">在线</span>
              <span v-else class="tag gray">离线</span>
            </dd>
            <dt>统计</dt>
            <dd>
              {{ detail.user.sessions }} 场 · {{ detail.user.hands }} 局 · 累计
              <b :class="detail.user.net > 0 ? 'pos' : detail.user.net < 0 ? 'neg' : ''">{{ fmtNet(detail.user.net) }}</b>
            </dd>
          </dl>
          <div class="ops">
            <div class="field">
              <label>重置密码</label>
              <div class="row">
                <input v-model="pwd" class="input" type="text" placeholder="新密码（4–64 位）" />
                <button class="btn btn-gold" @click="resetPwd">重置</button>
              </div>
            </div>
            <div class="row">
              <button class="btn" :class="detail.user.banned ? 'btn-gold' : 'btn-danger'" @click="toggleBan">
                {{ detail.user.banned ? '解除封禁' : '封禁账号' }}
              </button>
              <button class="btn btn-ghost" @click="toRecords(detail.user)">查看对局记录</button>
            </div>
          </div>
        </div>
        <div class="card-title" style="margin-top: 18px">最近场次</div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>房间</th>
                <th class="num">场次</th>
                <th>结束时间</th>
                <th class="num">输赢</th>
                <th class="num">剩余积分</th>
                <th>最大牌型</th>
                <th class="num">赢局</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in detail.sessions || []" :key="s.sessionId">
                <td class="mono link" @click="toRoom(s.roomCode)">{{ s.roomCode }}</td>
                <td class="num">{{ s.sessionNo }}</td>
                <td>{{ fmtTime(s.endedAt) }}</td>
                <td class="num" :class="s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''">{{ fmtNet(s.net) }}</td>
                <td class="num">{{ s.finalChips }}</td>
                <td>{{ typeName(s.bestType) }}</td>
                <td class="num">{{ s.wins }}</td>
              </tr>
              <tr v-if="detail.sessions && !detail.sessions.length">
                <td colspan="7" class="empty">还没有打完过一场</td>
              </tr>
              <tr v-if="!detail.sessions">
                <td colspan="7" class="empty">加载中…</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row {
  display: flex;
  gap: 8px;
}
.row .input {
  flex: 1;
  min-width: 0;
  height: 38px;
}
.ops {
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
}
</style>
