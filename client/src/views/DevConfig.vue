<script setup>
// 仅开发模式：单独查看配置表单。访问 /dev/config
import { ref } from 'vue';
import ConfigForm from '../components/ConfigForm.vue';
import { mergeDefaults } from '../lib/configMeta';

const cfg = ref(mergeDefaults(null));
</script>

<template>
  <div class="page-wrap">
    <div class="card-box">
      <ConfigForm v-model="cfg" :locked-keys="['initialChips']" advanced-open />
    </div>
  </div>
</template>
