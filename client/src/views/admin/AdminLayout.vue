<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi, setAdminToken } from '../../lib/adminApi';
import { confirmDialog } from '../../lib/ui';
import '../../styles/admin.css';

const route = useRoute();
const router = useRouter();
const NAV = [
  { to: '/admin', label: '概览', icon: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z' },
  { to: '/admin/users', label: '用户', icon: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4v2h14v-2c0-2.3-3.7-4-7-4zm8-2a3 3 0 1 0 0-6v6zm1 2h-1.2c1.4 1 2.2 2.4 2.2 4v2h3v-2c0-2-2-3.5-4-4z' },
  { to: '/admin/rooms', label: '开房记录', icon: 'M4 4h16v12H4zm-2 14h20v2H2z' },
  { to: '/admin/records', label: '开局记录', icon: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 4v2h6V7zm0 4v2h6v-2zm0 4v2h4v-2z' },
  { to: '/admin/notices', label: '系统通知', icon: 'M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z' },
  { to: '/admin/system', label: '系统设置', icon: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z' },
];
const title = computed(() => route.meta.title || '管理后台');
function active(to) {
  return to === '/admin' ? route.path === '/admin' : route.path.startsWith(to);
}
async function logout() {
  if (!(await confirmDialog({ title: '退出后台', message: '确定退出管理后台吗？', okText: '退出' }))) return;
  try {
    await adminApi.logout();
  } catch (e) {
    /* 忽略 */
  }
  setAdminToken('');
  router.replace('/admin/login');
}
</script>

<template>
  <div class="adm layout">
    <aside class="side">
      <div class="brand"><span class="mark">金</span>管理后台</div>
      <nav>
        <router-link v-for="n in NAV" :key="n.to" :to="n.to" class="nav" :class="{ on: active(n.to) }">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" :d="n.icon" /></svg>
          <span>{{ n.label }}</span>
        </router-link>
      </nav>
      <div class="foot">
        <router-link to="/" class="nav sm">← 返回游戏</router-link>
        <button class="nav sm" @click="logout">退出登录</button>
      </div>
    </aside>
    <div class="main">
      <header class="head">
        <h1>{{ title }}</h1>
        <div class="head-r">
          <router-link to="/" class="btn btn-ghost btn-xs">游戏</router-link>
          <button class="btn btn-xs" @click="logout">退出</button>
        </div>
      </header>
      <div class="content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
}
.side {
  position: sticky;
  top: 0;
  flex: 0 0 210px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding: 18px 12px;
  background: #0e1a15;
  border-right: 1px solid var(--a-line);
}
.brand {
  display: flex;
  align-items: center;
  padding: 0 8px 18px;
  font-size: 16px;
  font-weight: 800;
  color: #ffe9b0;
}
.mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: 10px;
  font-size: 16px;
  font-weight: 900;
  color: #6a0f1f;
  background: radial-gradient(circle at 35% 30%, #fff1c4, #e8b94e 60%, #a8781c);
  border-radius: 9px;
  font-family: 'STKaiti', 'KaiTi', serif;
}
nav {
  flex: 1;
}
.nav {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  margin-bottom: 4px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--a-muted);
  text-decoration: none;
  border-radius: 10px;
}
.nav svg {
  margin-right: 10px;
}
.nav:hover {
  color: var(--a-text);
  background: rgba(255, 255, 255, 0.04);
}
.nav.on {
  color: #ffe9b0;
  background: linear-gradient(90deg, rgba(230, 184, 79, 0.2), rgba(230, 184, 79, 0.04));
  box-shadow: inset 3px 0 0 #e6b84f;
}
.nav.sm {
  height: 34px;
  font-size: 13px;
}
.main {
  flex: 1;
  min-width: 0;
}
.head {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
  padding: 0 24px;
  background: rgba(11, 21, 18, 0.92);
  border-bottom: 1px solid var(--a-line);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
h1 {
  margin: 0;
  font-size: 18px;
}
.head-r {
  display: none;
}
.content {
  padding: 20px 24px 40px;
  max-width: 1400px;
}

/* 手机：侧栏变成顶部横向导航 */
@media (max-width: 860px) {
  .layout {
    flex-direction: column;
  }
  .side {
    position: sticky;
    top: 0;
    z-index: 20;
    flex: none;
    height: auto;
    padding: 8px 8px 0;
    border-right: 0;
    border-bottom: 1px solid var(--a-line);
  }
  .brand,
  .foot {
    display: none;
  }
  nav {
    display: flex;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .nav {
    flex: none;
    width: auto;
    height: 38px;
    margin: 0 2px 8px;
  }
  .nav.on {
    box-shadow: inset 0 -2px 0 #e6b84f;
  }
  .head {
    position: static;
    height: 50px;
    padding: 0 14px;
  }
  .head-r {
    display: flex;
    gap: 6px;
  }
  .content {
    padding: 14px 12px 30px;
  }
}
</style>
