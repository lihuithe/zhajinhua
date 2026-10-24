<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi, setAdminToken } from '../../lib/adminApi';
import { toastError } from '../../lib/ui';
import '../../styles/admin.css';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const busy = ref(false);

async function submit() {
  if (!username.value || !password.value || busy.value) return;
  busy.value = true;
  try {
    const r = await adminApi.login(username.value.trim(), password.value);
    setAdminToken(r.token);
    const to = String(route.query.redirect || '');
    router.replace(to.startsWith('/admin') ? to : '/admin');
  } catch (e) {
    toastError(e.message || '登录失败');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="adm login">
    <form class="box card" @submit.prevent="submit">
      <div class="logo">
        <span class="mark">金</span>
        <div>
          <div class="t1">炸金花 · 管理后台</div>
          <div class="t2 muted">仅限管理员</div>
        </div>
      </div>
      <div class="field">
        <label>账号</label>
        <input v-model="username" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" />
      </div>
      <div class="field">
        <label>密码</label>
        <input v-model="password" class="input" type="password" autocomplete="current-password" />
      </div>
      <button class="btn btn-gold btn-block" type="submit" :disabled="busy || !username || !password">登录</button>
      <router-link to="/" class="back muted">← 返回游戏</router-link>
    </form>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(ellipse at 50% 0%, #163326 0%, #0b1512 60%);
}
.box {
  width: 100%;
  max-width: 380px;
  padding: 26px 24px;
}
.logo {
  display: flex;
  align-items: center;
  margin-bottom: 22px;
}
.mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-right: 12px;
  font-size: 22px;
  font-weight: 900;
  color: #6a0f1f;
  background: radial-gradient(circle at 35% 30%, #fff1c4, #e8b94e 60%, #a8781c);
  border-radius: 12px;
  font-family: 'STKaiti', 'KaiTi', serif;
}
.t1 {
  font-size: 18px;
  font-weight: 800;
  color: #ffe9b0;
}
.t2 {
  font-size: 12px;
}
.btn-block {
  min-height: 44px;
  margin-top: 6px;
}
.back {
  display: block;
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  text-decoration: none;
}
</style>
