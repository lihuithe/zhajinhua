<script setup>
import { computed } from 'vue';
import Modal from '../Modal.vue';
import { describeConfig } from '../../lib/configMeta';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  config: { type: Object, default: null },
});
defineEmits(['update:modelValue']);

const items = computed(() => (props.config ? describeConfig(props.config) : []));
</script>

<template>
  <Modal :model-value="modelValue" title="本房间规则" :width="520" variant="sheet" @update:model-value="$emit('update:modelValue', $event)">
    <div class="basic">
      <b>牌型从大到小：</b>豹子 &gt; 顺金 &gt; 金花 &gt; 顺子 &gt; 对子 &gt; 单张。点数 A 最大、2 最小，花色默认不分大小。
      每人 3 张暗牌，闷牌按闷牌价下注，看牌后按“明牌价”下注。
    </div>
    <ul class="list">
      <li v-for="it in items" :key="it.key" :class="{ dim: it.dim }">
        <div class="r1">
          <span class="k">{{ it.label }}</span>
          <span class="v">{{ it.value }}</span>
        </div>
        <div class="d">{{ it.desc }}</div>
        <div v-if="it.help !== it.desc" class="d2">{{ it.help }}</div>
      </li>
    </ul>
  </Modal>
</template>

<style scoped>
.basic {
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  background: rgba(230, 184, 79, 0.1);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.basic b {
  color: var(--gold);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.list li {
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.list li.dim {
  opacity: 0.55;
}
.r1 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.k {
  font-weight: 700;
  color: var(--gold);
}
.v {
  font-weight: 700;
  color: var(--gold-l);
  text-align: right;
}
.d {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
}
.d2 {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
</style>
