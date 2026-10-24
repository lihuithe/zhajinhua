<script setup>
import { computed, ref } from 'vue';
import Modal from '../Modal.vue';
import { copyWithToast } from '../../lib/clipboard';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  code: { type: String, default: '' },
});
defineEmits(['update:modelValue']);

const linkInput = ref(null);
const link = computed(() => location.origin + '/r/' + props.code);

function selectAll(e) {
  const el = e.target;
  try {
    el.select();
    el.setSelectionRange(0, el.value.length);
  } catch (err) {
    /* 忽略 */
  }
}
function copyLink() {
  if (linkInput.value) selectAll({ target: linkInput.value });
  copyWithToast(link.value, '链接已复制');
}
function copyCode() {
  copyWithToast(props.code, '房间号已复制');
}
</script>

<template>
  <Modal :model-value="modelValue" title="邀请好友" :width="440" variant="sheet" @update:model-value="$emit('update:modelValue', $event)">
    <div class="sec">
      <div class="lab">房间链接</div>
      <input
        ref="linkInput"
        class="input selectable mono"
        type="text"
        readonly
        :value="link"
        @focus="selectAll"
        @click="selectAll"
      />
      <button class="btn btn-gold btn-block copy" @click="copyLink">复制链接</button>
      <div class="hint">把链接发给好友，未登录的好友登录后会自动回到这个房间。</div>
    </div>
    <div class="sec">
      <div class="lab">房间号</div>
      <div class="coderow">
        <div class="codebox selectable mono">{{ code }}</div>
        <button class="btn btn-ghost" @click="copyCode">复制</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.sec + .sec {
  margin-top: 18px;
}
.lab {
  margin-bottom: 8px;
  color: var(--gold);
  font-weight: 700;
  font-size: 14px;
}
.copy {
  margin-top: 10px;
}
.hint {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--muted);
}
.coderow {
  display: flex;
  align-items: center;
}
.codebox {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  font-size: 24px;
  letter-spacing: 3px;
  text-align: center;
  color: var(--gold-l);
  background: rgba(0, 0, 0, 0.35);
  border: 1px dashed var(--line);
  border-radius: 10px;
}
.coderow .btn {
  margin-left: 10px;
}
</style>
