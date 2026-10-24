<script setup>
import Modal from '../Modal.vue';
import Avatar from '../Avatar.vue';
import { typeName } from '../../lib/cards';

defineProps({
  modelValue: { type: Boolean, default: false },
  summary: { type: Object, default: null },
  totals: { type: Array, default: () => [] },
  meId: { type: String, default: '' },
  isOwner: { type: Boolean, default: false },
});
defineEmits(['update:modelValue', 'restart']);

const fmt = (n) => (n > 0 ? '+' + n : String(n));
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="summary ? '第 ' + summary.sessionNo + ' 场结算' : '结算'"
    :width="520"
    variant="sheet"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template v-if="summary">
      <div class="sub muted">
        共打 {{ summary.handsPlayed }}<template v-if="summary.hands"> / {{ summary.hands }}</template> 局
        <span v-if="summary.endReason === 'owner'" class="why">· 房主提前结束</span>
        <span v-else-if="summary.endReason === 'busted'" class="why">· 其他玩家积分不足，提前结束</span>
      </div>
      <div class="tbl">
        <div class="tr th">
          <span class="c-rank">排名</span>
          <span class="c-name">玩家</span>
          <span class="c-net">净输赢</span>
          <span class="c-type">最大牌型</span>
          <span class="c-win">赢局</span>
        </div>
        <div v-for="(p, i) in summary.players" :key="p.userId" class="tr" :class="{ me: p.userId === meId }">
          <span class="c-rank">
            <i v-if="i < 3" class="medal" :class="'m' + i">{{ i + 1 }}</i>
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="c-name">
            <Avatar :user-id="p.userId" :name="p.nickname" :size="26" />
            <em>{{ p.nickname }}<small v-if="p.rebuy" class="rb">补领 {{ p.rebuy }}</small></em>
          </span>
          <span class="c-net" :class="cls(p.net)">{{ fmt(p.net) }}</span>
          <span class="c-type">{{ typeName(p.bestType) }}</span>
          <span class="c-win">{{ p.wins }}</span>
        </div>
      </div>
    </template>

    <div class="tot-title">历场累计输赢</div>
    <div v-if="!totals.length" class="muted">暂无</div>
    <div v-for="t in totals" :key="t.userId" class="trow" :class="{ me: t.userId === meId }">
      <Avatar :user-id="t.userId" :name="t.nickname" :size="24" />
      <span class="tn">{{ t.nickname }}</span>
      <b :class="cls(t.net)">{{ fmt(t.net) }}</b>
    </div>

    <template #footer>
      <button v-if="isOwner" class="btn btn-gold btn-block" @click="$emit('restart')">再来一场</button>
      <div v-else class="wait muted">等待房主开始下一场…</div>
    </template>
  </Modal>
</template>

<style scoped>
.sub {
  margin-bottom: 8px;
  font-size: 13px;
}
.tbl {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.tr {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 14px;
}
.tr:last-child {
  border-bottom: 0;
}
.tr.th {
  min-height: 32px;
  font-size: 12px;
  color: var(--muted);
  background: rgba(0, 0, 0, 0.25);
}
.tr.me {
  background: rgba(230, 184, 79, 0.12);
}
.c-rank {
  flex: none;
  width: 36px;
  text-align: center;
}
.c-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.c-name em {
  margin-left: 6px;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-net {
  flex: none;
  width: 64px;
  padding-right: 6px;
  text-align: right;
  font-weight: 700;
}
.c-type {
  flex: none;
  width: 54px;
  text-align: center;
  font-size: 13px;
}
.c-win {
  flex: none;
  width: 36px;
  text-align: center;
}
.medal {
  display: inline-block;
  width: 22px;
  height: 22px;
  font-style: normal;
  font-weight: 800;
  line-height: 22px;
  color: #3a2603;
  border-radius: 50%;
}
.m0 {
  background: linear-gradient(180deg, #ffe39a, #e6b84f);
}
.m1 {
  background: linear-gradient(180deg, #f3f3f3, #aeb6bd);
}
.m2 {
  background: linear-gradient(180deg, #f1c49a, #c7824a);
}
.tot-title {
  margin: 18px 0 6px;
  font-weight: 700;
  color: var(--gold);
}
.trow {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 2px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.trow.me {
  background: rgba(230, 184, 79, 0.1);
}
.tn {
  flex: 1;
  min-width: 0;
  margin: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wait {
  text-align: center;
  padding: 10px 0;
}
.rb {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: #9fd8b4;
}
</style>
