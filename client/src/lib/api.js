// HTTP API 封装
import { session, clearToken, goLogin } from './session';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

async function call(method, path, body, opts) {
  const o = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (session.token && o.auth !== false) headers.Authorization = 'Bearer ' + session.token;

  let ctrl = null;
  let timer = 0;
  if (typeof AbortController !== 'undefined') {
    ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), 15000);
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    throw new ApiError('NETWORK', '网络连接失败，请检查网络后重试', 0);
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  // 401：token 失效，清除并跳登录（登录/注册接口除外）
  if (res.status === 401 && !o.skip401) {
    clearToken();
    goLogin();
  }
  if (!res.ok || !data || data.ok === false) {
    const err = (data && data.error) || {};
    throw new ApiError(err.code || 'HTTP_' + res.status, err.message || '请求失败（' + res.status + '）', res.status);
  }
  return data;
}

export const api = {
  register: (username, password) =>
    call('POST', '/api/register', { username, password }, { auth: false, skip401: true }),
  login: (username, password) =>
    call('POST', '/api/login', { username, password }, { auth: false, skip401: true }),
  logout: () => call('POST', '/api/logout', {}, { skip401: true }),
  me: () => call('GET', '/api/me'),
  setNickname: (nickname) => call('POST', '/api/me/nickname', { nickname }),
  setVoice: (voice) => call('POST', '/api/me/voice', { voice }),
  configDefaults: () => call('GET', '/api/config/defaults', undefined, { auth: false, skip401: true }),
  createRoom: (config) => call('POST', '/api/rooms', { config }),
  roomInfo: (code) => call('GET', '/api/rooms/' + encodeURIComponent(code)),
};
