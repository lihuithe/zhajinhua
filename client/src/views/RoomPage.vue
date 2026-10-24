<script setup>
// 房间页：把 WebSocket 的 state / event 接到 RoomScreen
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import RoomScreen from '../components/room/RoomScreen.vue';
import { wsState, onState, onEvent, setActiveRoom, request } from '../lib/ws';
import { toast, toastError } from '../lib/ui';

const route = useRoute();
const router = useRouter();
const code = computed(() => String(route.params.code || ''));
const view = shallowRef(null);
const screen = ref(null);
const slow = ref(false);
const chat = shallowRef([]); // 聊天记录（最近 50 条）
let offState = null;
let offEvent = null;
let slowTimer = 0;

function leaveToLobby() {
  setActiveRoom(null);
  router.replace('/');
}

function join() {
  view.value = null;
  slow.value = false;
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => (slow.value = true), 8000);
  chat.value = [];
  setActiveRoom(code.value, (err, _code, data) => {
    if (!err && data && Array.isArray(data.chat)) chat.value = data.chat.slice(-50);
    // 只有服务端明确拒绝（房间不存在 / 已满 / 被踢 / 在别处对局中）才离开；
    // 超时、离线之类的本地错误会在重连后自动重试
    if (err && !err.local) {
      toastError(err.message || '无法进入房间', 4000);
      leaveToLobby();
    }
  });
}

onMounted(() => {
  offState = onState((v) => {
    // 房间号不区分大小写（地址栏里可能是大写）
    if (v && String(v.code).toLowerCase() === code.value.toLowerCase()) view.value = v;
  });
  offEvent = onEvent((ev) => {
    if (ev && ev.kind === 'chat' && ev.msg) {
      if (!chat.value.some((m) => m.id === ev.msg.id)) chat.value = chat.value.concat([ev.msg]).slice(-50);
    }
    if (screen.value) screen.value.handleEvent(ev);
    else if (ev && ev.kind === 'kicked') {
      toast(ev.banned ? '你已被房主移出房间，且不能再进入' : '你已被房主移出房间', 'error', 3000);
      leaveToLobby();
    } else if (ev && ev.kind === 'dissolved') {
      toast(ev.text || '房间已被管理员解散', 'error', 4000);
      leaveToLobby();
    }
  });
  join();
});

watch(code, join);

onBeforeUnmount(() => {
  if (offState) offState();
  if (offEvent) offEvent();
  clearTimeout(slowTimer);
  setActiveRoom(null);
});
</script>

<template>
  <RoomScreen
    v-if="view"
    ref="screen"
    :view="view"
    :connected="wsState.connected"
    :offset="wsState.offset"
    :request="request"
    :chat="chat"
    :restarting="wsState.restarting"
    @exit="leaveToLobby"
  />
  <div v-else class="loading">
    <div v-if="!wsState.connected" class="conn">{{ wsState.restarting ? '服务器更新中，正在重连…' : '连接中…' }}</div>
    <div class="spin"></div>
    <div class="txt">正在进入房间 {{ code }}…</div>
    <button v-if="slow" class="btn btn-ghost" @click="leaveToLobby">返回大厅</button>
  </div>
</template>

<style scoped>
.loading {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.conn {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  padding: calc(4px + var(--sat)) 8px 4px;
  font-size: 13px;
  text-align: center;
  background: #c0392b;
  color: #fff;
}
.spin {
  width: 36px;
  height: 36px;
  border: 4px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.txt {
  margin: 14px 0 20px;
  color: var(--muted);
}
</style>
