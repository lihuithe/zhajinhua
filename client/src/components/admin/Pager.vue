<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: { type: Number, default: 1 },
  size: { type: Number, default: 20 },
  total: { type: Number, default: 0 },
});
const emit = defineEmits(['change']);
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));
function go(p) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('change', p);
}
</script>

<template>
  <div class="pager">
    <span class="muted">共 {{ total }} 条</span>
    <button class="btn btn-xs" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
    <span class="pg">{{ page }} / {{ pages }}</span>
    <button class="btn btn-xs" :disabled="page >= pages" @click="go(page + 1)">下一页</button>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
  font-size: 13px;
}
.pg {
  min-width: 56px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
