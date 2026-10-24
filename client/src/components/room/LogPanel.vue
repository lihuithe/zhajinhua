<script setup>
// 操作记录：每条一行（头像、昵称、彩色动作标签、金额），系统消息（底注、强制开牌、作废）做成分隔条
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import Avatar from '../Avatar.vue';

const props = defineProps({
  log: { type: Array, default: () => [] },
  players: { type: Array, default: () => [] }, // 本局参与者（取 userId 给头像用）
  meSeat: { type: Number, default: -1 },
});
const box = ref(null);

function toBottom() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  });
}
watch(() => (props.log.length ? props.log.length + ':' + props.log[props.log.length - 1].t : ''), toBottom);
onMounted(toBottom);

const TAG = {
  call: 'call',
  raise: 'raise',
  look: 'look',
  fold: 'fold',
  compare: 'compare',
  allIn: 'allin',
  timeout: 'fold',
  win: 'win',
  bonus: 'win',
  show: 'look',
};

const rows = computed(() =>
  props.log.map((l, i) => {
    const key = i + '-' + l.t + '-' + l.kind;
    if (l.seatIndex === null || l.seatIndex === undefined || l.seatIndex < 0) return { key, sys: true, kind: l.kind, text: l.text };
    const p = props.players.find((x) => x.seatIndex === l.seatIndex);
    const name = l.nickname || (p ? p.nickname : '');
    let text = name && l.text.indexOf(name) === 0 ? l.text.slice(name.length).trim() : l.text;
    // 加注：“闷加注到 100，付 100” → 标签“闷加注到 100”，金额单独显示
    let amount = '';
    const m = /^(.*?)[，,]\s*付\s*(\d+)$/.exec(text);
    if (m) {
      text = m[1];
      amount = m[2];
    } else if (l.kind === 'call') {
      const c = /^(\S+)\s+(\d+)$/.exec(text);
      if (c) {
        text = c[1];
        amount = c[2];
      }
    }
    return {
      key,
      sys: false,
      kind: l.kind,
      tag: TAG[l.kind] || 'info',
      name,
      userId: p ? p.userId : name,
      me: l.seatIndex === props.meSeat,
      text,
      amount,
    };
  }),
);
</script>

<template>
  <div ref="box" class="log soft-scroll">
    <div v-if="!log.length" class="empty">暂无操作记录</div>
    <template v-for="r in rows" :key="r.key">
      <div v-if="r.sys" class="sys" :class="r.kind"><span>{{ r.text }}</span></div>
      <div v-else class="row" :class="[r.kind, { me: r.me }]">
        <Avatar :user-id="r.userId" :name="r.name" :size="22" :ring="false" />
        <span class="nm">{{ r.me ? '我' : r.name }}</span>
        <span class="tag" :class="r.tag">{{ r.text }}</span>
        <span v-if="r.amount" class="amt">{{ r.amount }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.log {
  height: 100%;
  min-height: 120px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 2px 2px 8px;
  font-size: 13px;
}
.empty {
  padding: 24px 0;
  text-align: center;
  color: var(--muted);
}
.row {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 6px;
  margin-top: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.row.me {
  background: rgba(240, 207, 122, 0.08);
  box-shadow: inset 2px 0 0 #f0c24f;
}
.row.win,
.row.bonus {
  background: linear-gradient(90deg, rgba(240, 194, 79, 0.22), rgba(240, 194, 79, 0.05));
}
.nm {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 7.5em;
  margin: 0 6px 0 7px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #e6dcc0;
}
.row.me .nm {
  color: #ffe39a;
  font-weight: 700;
}
.tag {
  flex: 0 1 auto;
  min-width: 0;
  padding: 1px 8px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-radius: 999px;
}
.tag.call {
  color: #b9f5cf;
  background: rgba(47, 158, 91, 0.3);
}
.tag.raise {
  color: #ffe0a3;
  background: rgba(224, 122, 18, 0.32);
}
.tag.look {
  color: #c4e0ff;
  background: rgba(47, 127, 214, 0.3);
}
.tag.fold {
  color: #b9c2bd;
  background: rgba(255, 255, 255, 0.08);
}
.tag.compare,
.tag.allin {
  color: #ffc9bf;
  background: rgba(214, 45, 31, 0.32);
}
.tag.win {
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #f0c24f);
}
.tag.info {
  color: #d5e0d8;
  background: rgba(255, 255, 255, 0.08);
}
.amt {
  flex: none;
  margin-left: auto;
  padding-left: 8px;
  font-weight: 800;
  color: #ffd56b;
  font-variant-numeric: tabular-nums;
}
.amt::before {
  content: '−';
  margin-right: 1px;
  opacity: 0.7;
}
/* 系统消息：居中的分隔条 */
.sys {
  display: flex;
  align-items: center;
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--muted);
}
.sys::before,
.sys::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
}
.sys span {
  padding: 0 8px;
  white-space: nowrap;
}
.sys.showdown,
.sys.win {
  color: #ffb4a6;
}
.sys.win {
  color: var(--gold-l);
}
</style>
