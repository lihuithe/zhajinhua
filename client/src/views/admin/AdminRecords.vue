<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Modal from '../../components/Modal.vue';
import Pager from '../../components/admin/Pager.vue';
import HandDetail from '../../components/admin/HandDetail.vue';
import { adminApi, REASON_TEXT } from '../../lib/adminApi';
import { typeName } from '../../lib/cards';
import { fmtTime } from '../../lib/fmt';
import { toastError } from '../../lib/ui';

const route = useRoute();
const router = useRouter();
const tab = ref(route.query.tab === 'sessions' ? 'sessions' : 'hands');
const room = ref(String(route.query.room || ''));
const userId = ref(String(route.query.user || ''));
const userName = ref(String(route.query.name || ''));
const sessionNo = ref(''); // 只在“看对局”时设置，配合房间号使用
const page = ref(1);
const size = 20;
const list = ref({ items: [], total: 0 });
const loading = ref(false);

async function load(p = page.value) {
  loading.value = true;
  try {
    const params = { room: room.value.trim(), user: userId.value, session: room.value.trim() ? sessionNo.value : '', page: p, size };
    const r = tab.value === 'hands' ? await adminApi.hands(params) : await adminApi.sessions(params);
    list.value = r;
    page.value = r.page || p;
  } catch (e) {
    toastError(e.message);
  } finally {
    loading.value = false;
  }
}
watch(tab, () => {
  list.value = { items: [], total: 0 };
  load(1);
});
onMounted(() => load(1));

function clearUser() {
  userId.value = '';
  userName.value = '';
  router.replace({ query: { ...route.query, user: undefined, name: undefined } });
  load(1);
}
function filterRoom(code) {
  room.value = code;
  sessionNo.value = '';
  load(1);
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
function sessionHands(s) {
  room.value = s.roomCode;
  sessionNo.value = String(s.sessionNo);
  tab.value = 'hands';
}
const fmtNet = (n) => (n > 0 ? '+' + n : String(n));
</script>

<template>
  <div>
    <div class="toolbar">
      <div class="seg">
        <button :class="{ on: tab === 'hands' }" @click="tab = 'hands'">每局记录</button>
        <button :class="{ on: tab === 'sessions' }" @click="tab = 'sessions'">场次结算</button>
      </div>
      <input v-model="room" class="input" placeholder="按房间号筛选" @keyup.enter="load(1)" />
      <button class="btn btn-gold" @click="load(1)">筛选</button>
      <button v-if="room" class="btn" @click="(room = ''), (sessionNo = ''), load(1)">清空房间</button>
      <span v-if="room && sessionNo" class="tag gold ufilter">
        第 {{ sessionNo }} 场
        <button aria-label="清除场次筛选" @click="(sessionNo = ''), load(1)">×</button>
      </span>
      <span v-if="userId" class="tag blue ufilter">
        用户：{{ userName || userId }}
        <button aria-label="清除用户筛选" @click="clearUser">×</button>
      </span>
    </div>

    <!-- 每局记录 -->
    <div v-if="tab === 'hands'" class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>结束时间</th>
            <th>房间</th>
            <th>场 / 局</th>
            <th>原因</th>
            <th class="num">底池</th>
            <th>赢家</th>
            <th class="num">人数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in list.items" :key="h.id">
            <td>{{ fmtTime(h.endedAt) }}</td>
            <td class="mono link" @click="filterRoom(h.roomCode)">{{ h.roomCode }}</td>
            <td>第 {{ h.sessionNo }} 场 · 第 {{ h.handNo }} 局</td>
            <td>
              <span class="tag" :class="h.reason === 'voided' ? 'gray' : h.reason === 'showdown' ? 'orange' : 'blue'">
                {{ REASON_TEXT[h.reason] || h.reason }}
              </span>
            </td>
            <td class="num">{{ h.pot }}</td>
            <td>{{ h.winners.join('、') || '—' }}</td>
            <td class="num">{{ h.playerCount }}</td>
            <td><button class="btn btn-xs" @click="showHand(h.id)">查看</button></td>
          </tr>
          <tr v-if="!list.items.length">
            <td colspan="8" class="empty">{{ loading ? '加载中…' : '没有记录' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 场次结算 -->
    <div v-else class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>结束时间</th>
            <th>房间</th>
            <th class="num">场次</th>
            <th class="num">局数</th>
            <th>玩家输赢</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in list.items" :key="s.id">
            <td>{{ fmtTime(s.endedAt) }}</td>
            <td class="mono link" @click="filterRoom(s.roomCode)">{{ s.roomCode }}</td>
            <td class="num">{{ s.sessionNo }}</td>
            <td class="num">{{ s.handsPlayed }}</td>
            <td class="players">
              <span
                v-for="p in s.players"
                :key="p.userId"
                class="tag"
                :class="p.net > 0 ? 'green' : p.net < 0 ? 'red' : 'gray'"
                :title="'剩余 ' + p.finalChips + ' · 最大牌型 ' + typeName(p.bestType) + ' · 赢 ' + p.wins + ' 局'"
              >
                {{ p.nickname }} {{ fmtNet(p.net) }}
              </span>
            </td>
            <td><button class="btn btn-xs" @click="sessionHands(s)">看对局</button></td>
          </tr>
          <tr v-if="!list.items.length">
            <td colspan="6" class="empty">{{ loading ? '加载中…' : '没有记录' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pager :page="page" :size="size" :total="list.total" @change="load" />

    <Modal v-model="handOpen" title="对局详情" :width="860">
      <div class="adm-in">
        <HandDetail v-if="hand" :hand="hand" />
        <div v-else class="muted">加载中…</div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.players {
  white-space: normal;
  min-width: 260px;
}
.players .tag {
  margin: 2px 4px 2px 0;
}
.ufilter {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 4px 0 10px;
  font-size: 13px;
}
.ufilter button {
  width: 24px;
  height: 24px;
  margin-left: 4px;
  font-size: 16px;
  color: #cfe5ff;
}
</style>
