<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Modal from '../../components/Modal.vue';
import Pager from '../../components/admin/Pager.vue';
import HandDetail from '../../components/admin/HandDetail.vue';
import { adminApi, PHASE_TEXT, REASON_TEXT } from '../../lib/adminApi';
import { describeConfig } from '../../lib/configMeta';
import { typeName } from '../../lib/cards';
import { fmtTime, fmtFull, fmtHM } from '../../lib/fmt';
import { toast, toastError, confirmDialog } from '../../lib/ui';

const route = useRoute();
const router = useRouter();
const status = ref('live');
const q = ref('');
const page = ref(1);
const size = 20;
const list = ref({ items: [], total: 0 });
const loading = ref(false);

async function load(p = page.value) {
  loading.value = true;
  try {
    const r = await adminApi.rooms({ status: status.value, q: q.value.trim(), page: p, size });
    list.value = r;
    page.value = r.page || p;
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
watch(status, () => load(1));
onMounted(() => {
  load(1);
  if (route.query.open) show(String(route.query.open));
});

/* 详情 */
const open = ref(false);
const detail = ref(null);
const curCode = ref('');
async function show(code) {
  curCode.value = code;
  open.value = true;
  detail.value = null;
  try {
    detail.value = await adminApi.room(code);
  } catch (e) {
    toastError(e.message);
  }
}
async function refresh() {
  if (curCode.value) detail.value = await adminApi.room(curCode.value).catch(() => detail.value);
}
async function dissolve() {
  const ok = await confirmDialog({
    title: '解散房间',
    message: '解散后房间内所有人会被送回大厅，进行中的这一局直接结束（不结算）。确定解散 ' + curCode.value + ' 吗？',
    okText: '解散',
    danger: true,
  });
  if (!ok) return;
  try {
    await adminApi.dissolve(curCode.value, '房间已被管理员解散');
    toast('已解散', 'ok');
    await refresh();
    load();
  } catch (e) {
    toastError(e.message);
  }
}

const handOpen = ref(false);
const hand = ref(null);
async function showHand(id) {
  handOpen.value = true;
  hand.value = null;
  try {
    hand.value = (await adminApi.hand(id)).hand;
  } catch (e) {
    toastError(e.message);
  }
}
function toRecords(code) {
  open.value = false;
  router.push({ path: '/admin/records', query: { room: code } });
}
const fmtNet = (n) => (n > 0 ? '+' + n : String(n));
function phaseTag(r) {
  if (!r.live) return { t: '已销毁', c: 'gray' };
  return { t: PHASE_TEXT[r.phase] || r.phase, c: r.phase === 'playing' ? 'green' : r.phase === 'finished' ? 'blue' : 'orange' };
}
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="seg">
        <button :class="{ on: status === 'live' }" @click="status = 'live'">进行中</button>
        <button :class="{ on: status === 'all' }" @click="status = 'all'">全部</button>
      </div>
      <input v-model="q" class="input" placeholder="房间号 / 房主昵称" @keyup.enter="load(1)" />
      <button class="btn btn-gold" @click="load(1)">搜索</button>
      <button class="btn" @click="load()">刷新</button>
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>房间号</th>
            <th>房主</th>
            <th>创建时间</th>
            <th>状态</th>
            <th class="num">入座 / 观战 / 在线</th>
            <th>当前进度</th>
            <th class="num">累计场 / 局</th>
            <th class="num">最多同时入座</th>
            <th>销毁时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list.items" :key="r.code">
            <td class="mono link" @click="show(r.code)">{{ r.code }}</td>
            <td>{{ r.ownerNickname }}</td>
            <td>{{ fmtTime(r.createdAt) }}</td>
            <td><span class="tag" :class="phaseTag(r).c">{{ phaseTag(r).t }}</span></td>
            <td class="num">{{ r.live ? r.seated + ' / ' + r.spectators + ' / ' + r.online : '—' }}</td>
            <td>
              <template v-if="r.live && r.phase === 'playing'">第 {{ r.sessionNo }} 场 · {{ r.handNo }}/{{ r.hands }} 局</template>
              <template v-else-if="r.live">第 {{ r.sessionNo }} 场</template>
              <span v-else class="muted">—</span>
            </td>
            <td class="num">{{ r.sessionsPlayed }} / {{ r.handsPlayed }}</td>
            <td class="num">{{ r.peakSeated }}</td>
            <td>{{ r.destroyedAt ? fmtTime(r.destroyedAt) : '—' }}</td>
            <td><button class="btn btn-xs" @click="show(r.code)">详情</button></td>
          </tr>
          <tr v-if="!list.items.length">
            <td colspan="10" class="empty">{{ loading ? '加载中…' : status === 'live' ? '当前没有房间' : '没有数据' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pager :page="page" :size="size" :total="list.total" @change="load" />

    <!-- 房间详情 -->
    <Modal v-model="open" :title="'房间 ' + curCode" :width="980">
      <div class="adm-in">
        <div v-if="!detail" class="muted">加载中…</div>
        <template v-else>
          <div class="bar">
            <span class="tag" :class="phaseTag(detail.room).c">{{ phaseTag(detail.room).t }}</span>
            <span class="muted">房主 {{ detail.room.ownerNickname }} · 创建于 {{ fmtFull(detail.room.createdAt) }}</span>
            <span class="sp"></span>
            <button class="btn btn-xs" @click="refresh">刷新</button>
            <button class="btn btn-xs btn-ghost" @click="toRecords(detail.room.code)">全部对局记录</button>
            <button v-if="detail.room.live" class="btn btn-xs btn-danger" @click="dissolve">解散房间</button>
          </div>

          <div class="grid2">
            <!-- 实时 -->
            <div v-if="detail.live" class="card">
              <div class="card-title">实时成员（{{ detail.live.members.length }}）</div>
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>昵称</th>
                      <th>座位</th>
                      <th class="num">积分</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="m in detail.live.members" :key="m.userId">
                      <td>
                        {{ m.nickname }}
                        <span v-if="m.userId === detail.live.ownerId" class="tag gold">房主</span>
                      </td>
                      <td>{{ m.seatIndex === null ? '观战' : m.seatIndex + 1 + ' 号' }}</td>
                      <td class="num">{{ m.chips === null ? '—' : m.chips }}</td>
                      <td>
                        <span class="tag" :class="m.online ? 'green' : 'gray'">{{ m.online ? '在线' : '离线' }}</span>
                        <span v-if="m.ready" class="tag blue">已准备</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <template v-if="detail.live.hand">
                <div class="card-title" style="margin-top: 14px">
                  当前局 · 第 {{ detail.live.hand.handNo }} 局
                  <span class="muted" style="font-weight: 400; font-size: 12px">进行中的局不显示手牌</span>
                </div>
                <div class="muted" style="margin-bottom: 8px">
                  底池 {{ detail.live.hand.pot }} · 单注 {{ detail.live.hand.currentBet }} · 第 {{ detail.live.hand.round }} 轮
                  <template v-if="detail.live.hand.ended"> · 已结束</template>
                </div>
                <div class="chips">
                  <span
                    v-for="p in detail.live.hand.players"
                    :key="p.seatIndex"
                    class="tag"
                    :class="p.seatIndex === detail.live.hand.turnSeat ? 'gold' : p.state === 'active' ? 'blue' : 'gray'"
                  >
                    {{ p.nickname }} · {{ p.state === 'active' ? (p.seen ? '已看' : '闷') : p.state === 'folded' ? '弃牌' : p.state === 'lost' ? '出局' : '赢' }} · {{ p.bet }}
                  </span>
                </div>
              </template>
            </div>
            <div v-else class="card muted">房间已销毁{{ detail.room.destroyedAt ? '（' + fmtFull(detail.room.destroyedAt) + '）' : '' }}</div>

            <!-- 聊天 -->
            <div v-if="detail.live" class="card">
              <div class="card-title">最近聊天（{{ detail.live.chat.length }}）</div>
              <div class="chat">
                <div v-for="m in detail.live.chat" :key="m.id" class="cm">
                  <span class="muted">{{ fmtHM(m.t) }}</span>
                  <b>{{ m.nickname }}</b><span v-if="m.seatIndex === null" class="tag gray">观战</span>：
                  <span :class="{ em: m.kind === 'emoji' }">{{ m.text }}</span>
                </div>
                <div v-if="!detail.live.chat.length" class="muted">还没有聊天</div>
              </div>
            </div>

            <!-- 配置 -->
            <div class="card">
              <div class="card-title">房间配置</div>
              <dl class="kv cfg">
                <template v-for="c in describeConfig(detail.config)" :key="c.key">
                  <dt>{{ c.label }}</dt>
                  <dd>{{ c.value }}</dd>
                </template>
              </dl>
            </div>

            <!-- 场次 -->
            <div class="card">
              <div class="card-title">已结束的场次（{{ detail.sessions.length }}）</div>
              <div v-for="s in detail.sessions" :key="s.id" class="sess">
                <div class="muted">第 {{ s.sessionNo }} 场 · {{ s.handsPlayed }} 局 · {{ fmtTime(s.endedAt) }}</div>
                <div class="chips">
                  <span v-for="p in s.players" :key="p.userId" class="tag" :class="p.net > 0 ? 'green' : p.net < 0 ? 'red' : 'gray'">
                    {{ p.nickname }} {{ fmtNet(p.net) }}
                  </span>
                </div>
              </div>
              <div v-if="!detail.sessions.length" class="muted">还没有打完的场次</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">最近对局（{{ detail.hands.length }}）</div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>场 / 局</th>
                    <th>结束时间</th>
                    <th>原因</th>
                    <th class="num">底池</th>
                    <th>赢家</th>
                    <th class="num">人数</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in detail.hands" :key="h.id">
                    <td>第 {{ h.sessionNo }} 场 · 第 {{ h.handNo }} 局</td>
                    <td>{{ fmtTime(h.endedAt) }}</td>
                    <td>{{ REASON_TEXT[h.reason] || h.reason }}</td>
                    <td class="num">{{ h.pot }}</td>
                    <td>{{ h.winners.join('、') || '—' }}</td>
                    <td class="num">{{ h.playerCount }}</td>
                    <td><button class="btn btn-xs" @click="showHand(h.id)">查看</button></td>
                  </tr>
                  <tr v-if="!detail.hands.length">
                    <td colspan="7" class="empty">还没有对局</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </Modal>

    <Modal v-model="handOpen" title="对局详情" :width="860" :z-index="1100">
      <div class="adm-in">
        <HandDetail v-if="hand" :hand="hand" />
        <div v-else class="muted">加载中…</div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.sp {
  flex: 1;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chat {
  max-height: 260px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.9;
}
.cm b {
  margin-left: 6px;
  color: #ffe9b0;
}
.cm .em {
  font-size: 18px;
}
.cfg {
  font-size: 13px;
}
.sess + .sess {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--a-line);
}
.sess .muted {
  margin-bottom: 6px;
  font-size: 12px;
}
.grid2 {
  margin-bottom: 14px;
}
</style>
