<script setup>
// 仅开发模式：用假数据渲染房间页，检查布局。访问 /dev/table
import { ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import RoomScreen from '../components/room/RoomScreen.vue';
import { SCENARIOS, DEMO_EVENTS, MOCK_CHAT } from '../dev/mockRoom';
import { toast } from '../lib/ui';

const route = useRoute();
const first = SCENARIOS.find((x) => x.id === route.query.s) || SCENARIOS[0];
const cur = ref(first.id);
const view = shallowRef(first.build());
const screen = ref(null);
const connected = ref(true);
const panel = ref(route.query.panel !== '0');
const chat = shallowRef(MOCK_CHAT.slice());

function pick(id) {
  cur.value = id;
  view.value = SCENARIOS.find((s) => s.id === id).build();
}
function request(action, data) {
  toast('[mock] ' + action + ' ' + JSON.stringify(data || {}), 'info', 2500);
  return Promise.resolve({});
}
function fire(ev) {
  const e = typeof ev === 'function' ? ev() : ev;
  if (e.kind === 'chat') chat.value = chat.value.concat([e.msg]);
  if (screen.value) screen.value.handleEvent(e);
}
</script>

<template>
  <div class="dev">
    <RoomScreen
      ref="screen"
      :view="view"
      :connected="connected"
      :offset="0"
      :request="request"
      :chat="chat"
      @exit="toast('[mock] exit')"
    />
    <div class="panel" :class="{ min: !panel }">
      <button class="tg" @click="panel = !panel">{{ panel ? '收起' : '调试' }}</button>
      <template v-if="panel">
        <div class="grp">
          <button v-for="s in SCENARIOS" :key="s.id" :class="{ on: cur === s.id }" @click="pick(s.id)">
            {{ s.label }}
          </button>
        </div>
        <div class="grp">
          <button v-for="e in DEMO_EVENTS" :key="e.label" @click="fire(e.ev)">{{ e.label }}</button>
          <button @click="connected = !connected">{{ connected ? '断线' : '恢复' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2500;
  max-height: 40vh;
  overflow-y: auto;
  padding: 6px;
  background: rgba(0, 0, 0, 0.88);
  border-top: 1px solid #555;
}
.panel.min {
  right: auto;
  padding: 2px;
}
.grp {
  display: flex;
  flex-wrap: wrap;
}
button {
  margin: 2px;
  padding: 4px 8px;
  font-size: 12px;
  color: #fff;
  background: #333;
  border-radius: 6px;
}
button.on {
  background: #b88a2a;
}
.tg {
  background: #555;
}
</style>
