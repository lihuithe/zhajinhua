import { createRouter, createWebHistory } from 'vue-router';
import { session } from './lib/session';
import { connect } from './lib/ws';
import { adminSession, adminHooks } from './lib/adminApi';

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'lobby', component: () => import('./views/LobbyView.vue') },
  { path: '/create', name: 'create', component: () => import('./views/CreateView.vue') },
  { path: '/r/:code', name: 'room', component: () => import('./views/RoomPage.vue') },
  // 管理后台（独立的管理员登录）
  { path: '/admin/login', component: () => import('./views/admin/AdminLogin.vue'), meta: { public: true } },
  {
    path: '/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    meta: { public: true, admin: true },
    children: [
      { path: '', component: () => import('./views/admin/AdminOverview.vue'), meta: { public: true, admin: true, title: '概览' } },
      { path: 'users', component: () => import('./views/admin/AdminUsers.vue'), meta: { public: true, admin: true, title: '用户' } },
      { path: 'rooms', component: () => import('./views/admin/AdminRooms.vue'), meta: { public: true, admin: true, title: '开房记录' } },
      { path: 'records', component: () => import('./views/admin/AdminRecords.vue'), meta: { public: true, admin: true, title: '开局记录' } },
      { path: 'notices', component: () => import('./views/admin/AdminNotices.vue'), meta: { public: true, admin: true, title: '系统通知' } },
      { path: 'system', component: () => import('./views/admin/AdminSystem.vue'), meta: { public: true, admin: true, title: '系统设置' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

// 仅开发模式可访问的牌桌假数据页（生产构建中会被摇树移除）
if (import.meta.env.DEV) {
  routes.unshift({
    path: '/dev/config',
    component: () => import('./views/DevConfig.vue'),
    meta: { public: true },
  });
  routes.unshift({
    path: '/dev/table',
    name: 'devTable',
    component: () => import('./views/DevTable.vue'),
    meta: { public: true },
  });
}

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.meta.admin) return adminSession.token ? true : { path: '/admin/login', query: { redirect: to.fullPath } };
  if (to.meta.public) return true;
  if (!session.token) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  // 已登录：保证 WebSocket 连接存在（用于单点登录检测与房间同步）
  connect();
  return true;
});

adminHooks.onUnauthorized = () => {
  const cur = router.currentRoute.value;
  if (cur.path !== '/admin/login') router.replace({ path: '/admin/login', query: { redirect: cur.fullPath } });
};

export default router;
