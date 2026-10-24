// 管理后台 API：独立的管理员 token（localStorage.zjh_admin_token）
import { reactive } from 'vue';

const KEY = 'zjh_admin_token';
function read() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return '';
  }
}
export const adminSession = reactive({ token: read() });
export const adminHooks = { onUnauthorized: null };

export function setAdminToken(t) {
  adminSession.token = t || '';
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch (e) {
    /* 忽略 */
  }
}

function qs(params) {
  const p = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
}

async function req(method, path, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && adminSession.token) headers.authorization = 'Bearer ' + adminSession.token;
  let res;
  try {
    res = await fetch('/api/admin' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    const err = new Error('网络异常，请稍后重试');
    err.code = 'NETWORK';
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 非 JSON */
  }
  if (res.status === 401 && auth) {
    setAdminToken('');
    if (adminHooks.onUnauthorized) adminHooks.onUnauthorized();
  }
  if (!res.ok || !data || data.ok === false) {
    const er = (data && data.error) || {};
    const err = new Error(er.message || '请求失败（HTTP ' + res.status + '）');
    err.code = er.code || 'HTTP_' + res.status;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const adminApi = {
  login: (username, password) => req('POST', '/login', { username, password }, { auth: false }),
  logout: () => req('POST', '/logout'),
  overview: () => req('GET', '/overview'),
  users: (p) => req('GET', '/users' + qs(p)),
  user: (id) => req('GET', '/users/' + encodeURIComponent(id)),
  resetPassword: (id, password) => req('POST', '/users/' + encodeURIComponent(id) + '/password', { password }),
  ban: (id, banned) => req('POST', '/users/' + encodeURIComponent(id) + '/ban', { banned }),
  rooms: (p) => req('GET', '/rooms' + qs(p)),
  room: (code) => req('GET', '/rooms/' + encodeURIComponent(code)),
  dissolve: (code, reason) => req('POST', '/rooms/' + encodeURIComponent(code) + '/dissolve', { reason }),
  sessions: (p) => req('GET', '/sessions' + qs(p)),
  hands: (p) => req('GET', '/hands' + qs(p)),
  hand: (id) => req('GET', '/hands/' + encodeURIComponent(id)),
  notices: () => req('GET', '/notices'),
  createNotice: (n) => req('POST', '/notices', n),
  updateNotice: (id, n) => req('PUT', '/notices/' + id, n),
  deleteNotice: (id) => req('DELETE', '/notices/' + id),
  system: () => req('GET', '/system'),
  setMaintenance: (enabled, message) => req('POST', '/system/maintenance', { enabled, message }),
};

export const REASON_TEXT = { lastStanding: '其他人出局', allIn: '孤注一掷', showdown: '强制开牌', voided: '作废' };
export const PHASE_TEXT = { waiting: '准备中', playing: '对局中', finished: '结算' };
export const LEVEL_TEXT = { info: '普通', warn: '重要', maint: '停服维护' };
