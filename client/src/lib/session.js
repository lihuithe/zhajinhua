// 登录状态：token 存 localStorage.zjh_token
import { reactive } from 'vue';

const TOKEN_KEY = 'zjh_token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export const session = reactive({
  token: readToken(),
  user: null, // { userId, username, nickname }
  roomCode: null, // /api/me 返回的当前所在房间
});

// 供 ws.js 等注册“清除登录态时”的回调，避免循环依赖
export const hooks = { onClear: null };

let routerRef = null;
export function setRouter(r) {
  routerRef = r;
}

export function setToken(token) {
  session.token = token || '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* 隐私模式下可能写入失败，忽略 */
  }
}

export function clearToken() {
  setToken('');
  session.user = null;
  session.roomCode = null;
  if (hooks.onClear) hooks.onClear();
}

// 只接受站内相对路径，防止开放重定向
export function safeRedirect(p) {
  if (typeof p !== 'string') return '';
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/login')) return '';
  return p;
}

// 跳转登录页。redirect 缺省时取当前路由
export function goLogin(redirect) {
  if (!routerRef) return;
  const cur = routerRef.currentRoute.value;
  if (cur.path === '/login') return;
  const target = safeRedirect(redirect !== undefined ? redirect : cur.fullPath);
  routerRef.replace({ path: '/login', query: target && target !== '/' ? { redirect: target } : {} });
}
