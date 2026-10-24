<script setup>
import BrandLogo from '../components/BrandLogo.vue';
import SoundButton from '../components/SoundButton.vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../lib/api';
import { session, setToken, safeRedirect } from '../lib/session';
import { connect } from '../lib/ws';
import { toast } from '../lib/ui';

const route = useRoute();
const router = useRouter();

const mode = ref('login'); // login | register
const username = ref('');
const password = ref('');
const loading = ref(false);
const touched = ref(false);

const userErr = computed(() => {
  const u = username.value.trim();
  if (!u) return '请输入账号 ID';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) return '账号 ID 为 3–16 位字母、数字或下划线';
  return '';
});
const pwdErr = computed(() => {
  const p = password.value;
  if (!p) return '请输入密码';
  if (p.length < 4 || p.length > 64) return '密码为 4–64 位';
  return '';
});

function target() {
  return safeRedirect(route.query.redirect) || '/';
}

onMounted(() => {
  if (session.token) router.replace(target());
});

async function submit() {
  touched.value = true;
  if (userErr.value || pwdErr.value || loading.value) return;
  loading.value = true;
  try {
    const fn = mode.value === 'login' ? api.login : api.register;
    const res = await fn(username.value.trim(), password.value);
    setToken(res.token);
    session.user = res.user;
    connect();
    router.replace(target());
  } catch (e) {
    toast(e.message, 'error', 3200);
  } finally {
    loading.value = false;
  }
}

function switchMode(m) {
  mode.value = m;
  touched.value = false;
}
</script>

<template>
  <div class="page-wrap login">
    <div class="snd-corner"><SoundButton variant="tb" /></div>
    <BrandLogo class="logo" sub="和朋友一起玩 · 虚拟积分" />

    <div class="card-box">
      <div class="tabs">
        <button :class="{ on: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button :class="{ on: mode === 'register' }" @click="switchMode('register')">注册</button>
      </div>

      <form @submit.prevent="submit">
        <label class="lab">账号 ID</label>
        <input
          v-model="username"
          class="input"
          :class="{ bad: touched && userErr }"
          type="text"
          autocomplete="username"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          maxlength="16"
          placeholder="3–16 位字母、数字、下划线"
        />
        <div v-if="touched && userErr" class="err">{{ userErr }}</div>

        <label class="lab">密码</label>
        <input
          v-model="password"
          class="input"
          :class="{ bad: touched && pwdErr }"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          maxlength="64"
          placeholder="4–64 位任意字符"
        />
        <div v-if="touched && pwdErr" class="err">{{ pwdErr }}</div>

        <button class="btn btn-gold btn-block btn-lg submit" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入' }}
        </button>
      </form>

      <p v-if="mode === 'register'" class="tip">注册即登录，无需验证。密码无法找回，请牢记。</p>
      <p v-else class="tip">同一账号只能在一处在线，新登录会让旧设备下线。</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.snd-corner {
  position: fixed;
  top: calc(12px + var(--sat));
  right: calc(12px + var(--sar));
  z-index: 5;
}
.logo {
  text-align: center;
  margin-bottom: 22px;
}
.suits {
  font-size: 30px;
  letter-spacing: 10px;
  color: #ddd;
}
.suits .r {
  color: #e8574f;
}
h1 {
  margin: 4px 0 2px;
  font-size: 44px;
  letter-spacing: 8px;
  color: var(--gold);
  text-shadow: 0 2px 0 #6b4c0e, 0 6px 18px rgba(0, 0, 0, 0.6);
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.tabs button {
  height: 44px;
  font-size: 16px;
  font-weight: 700;
  color: var(--muted);
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.05);
}
.tabs button.on {
  color: #3a2603;
  background: linear-gradient(180deg, var(--gold-l), var(--gold));
}
.lab {
  display: block;
  margin: 12px 0 6px;
  color: var(--muted);
  font-size: 14px;
}
.err {
  margin-top: 6px;
  font-size: 13px;
  color: #ff8d7a;
}
.submit {
  margin-top: 22px;
}
.tip {
  margin: 14px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}
</style>
