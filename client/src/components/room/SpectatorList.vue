<script setup>
import Avatar from '../Avatar.vue';

defineProps({
  spectators: { type: Array, default: () => [] },
  ownerId: { type: String, default: '' },
  meId: { type: String, default: '' },
  canKick: { type: Boolean, default: false },
});
defineEmits(['kick']);
</script>

<template>
  <div class="spec">
    <div v-if="!spectators.length" class="empty">
      <span class="ic">👀</span>
      暂无观战者
    </div>
    <div v-for="m in spectators" :key="m.userId" class="row" :class="{ me: m.userId === meId, off: !m.online }">
      <div class="av">
        <Avatar :user-id="m.userId" :name="m.nickname" :size="30" />
        <i class="dot" :class="{ on: m.online }"></i>
      </div>
      <div class="nm">{{ m.nickname }}</div>
      <i v-if="m.userId === meId" class="tag me">我</i>
      <i v-if="m.userId === ownerId" class="tag own">房主</i>
      <i v-if="!m.online" class="tag offl">离线</i>
      <button v-if="canKick && m.userId !== meId" class="kick" @click="$emit('kick', m)">踢出</button>
    </div>
  </div>
</template>

<style scoped>
.spec {
  padding: 2px 0 6px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 0;
  font-size: 13px;
  color: var(--muted);
}
.empty .ic {
  margin-bottom: 6px;
  font-size: 26px;
  opacity: 0.6;
}
.row {
  display: flex;
  align-items: center;
  min-height: 42px;
  margin-top: 4px;
  padding: 5px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.row.me {
  background: rgba(240, 207, 122, 0.08);
  border-color: rgba(240, 207, 122, 0.25);
}
.row.off {
  opacity: 0.6;
}
.av {
  position: relative;
  flex: none;
}
.dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6b7470;
  border: 2px solid #10261c;
}
.dot.on {
  background: #4fd286;
}
.nm {
  flex: 1;
  min-width: 0;
  margin-left: 10px;
  overflow: hidden;
  font-size: 14px;
  color: #ece4cc;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tag {
  flex: none;
  margin-left: 5px;
  padding: 0 5px;
  font-size: 11px;
  font-style: normal;
  line-height: 17px;
  border-radius: 4px;
  color: #3a2603;
  background: var(--gold);
}
.tag.me {
  background: #4aa3ff;
  color: #fff;
}
.tag.offl {
  background: #59615e;
  color: #e6e6e6;
}
.kick {
  flex: none;
  margin-left: 8px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  color: #ffb0a2;
  border: 1px solid rgba(255, 140, 120, 0.45);
  border-radius: 999px;
  background: rgba(214, 45, 31, 0.12);
}
.kick:hover {
  background: rgba(214, 45, 31, 0.25);
}
</style>
