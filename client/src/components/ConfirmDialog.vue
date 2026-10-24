<script setup>
import { confirmState, settleConfirm } from '../lib/ui';
import Modal from './Modal.vue';
</script>

<template>
  <Modal
    :model-value="confirmState.open"
    :title="confirmState.title"
    :width="360"
    :z-index="2000"
    :closable="false"
    :mask-close="false"
  >
    <div class="msg">{{ confirmState.message }}</div>
    <template #footer>
      <div class="row">
        <button class="btn btn-ghost" @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
        <button class="btn" :class="confirmState.danger ? 'btn-danger' : 'btn-gold'" @click="settleConfirm(true)">
          {{ confirmState.okText }}
        </button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.msg {
  font-size: 16px;
  line-height: 1.6;
  padding: 8px 0;
  white-space: pre-line;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
</style>
