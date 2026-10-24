<script setup>
import Toast from './components/Toast.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ReplacedOverlay from './components/ReplacedOverlay.vue';
import NoticeBar from './components/NoticeBar.vue';
import NoticePopup from './components/NoticePopup.vue';
import { fetchSys } from './lib/sys';

fetchSys();
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <Toast />
  <ConfirmDialog />
  <ReplacedOverlay />
  <NoticeBar />
  <NoticePopup />
</template>
