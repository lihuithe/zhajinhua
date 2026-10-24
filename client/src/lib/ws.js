// WebSocket 单例：请求-响应匹配、推送分发、心跳、指数退避重连、重连后自动 room.join
import { reactive } from 'vue';
import { session, hooks, clearToken, goLogin } from './session';
import { toast } from './ui';
import { api } from './api';
import { applySys } from './sys';

export const wsState = reactive({
  connected: false,
  replaced: false, // 被同账号的其他设备 / 标签页挤下线
  restarting: false, // 服务器正在更新重启（关闭码 1012）
  offset: 0, // serverTime - Date.now()，用于校正倒计时
});

let ws = null;
let reqSeq = 0;
const pending = new Map();
let retry = 0;
let retryTimer = 0;
let hbTimer = 0;
let lastRecv = 0;
let wanted = false; // 是否应当保持连接
let giveUp = false; // 被顶号 / token 失效后不再重连
let activeRoom = null; // 当前所在房间页的房间号，重连后自动 join
let joinHandler = null; // (err|null, code) => void

const stateListeners = new Set();
const eventListeners = new Set();

export function serverNow() {
  return Date.now() + wsState.offset;
}

function updateOffset(serverTime) {
  if (typeof serverTime === 'number' && isFinite(serverTime)) {
    wsState.offset = serverTime - Date.now();
  }
}

function makeError(code, message, local) {
  const e = new Error(message);
  e.code = code;
  e.local = !!local; // 本地产生的错误（超时 / 离线），不是服务端明确拒绝
  return e;
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + '/ws?token=' + encodeURIComponent(session.token);
}

export function onState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

function rejectAll(msg) {
  pending.forEach((p) => {
    clearTimeout(p.timer);
    p.reject(makeError('OFFLINE', msg || '连接已断开，请稍后重试', true));
  });
  pending.clear();
}

function stopHeartbeat() {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = 0;
}

function startHeartbeat() {
  stopHeartbeat();
  hbTimer = setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    // 超过 50 秒没收到任何消息，认为是半死连接，强制重连
    if (Date.now() - lastRecv > 50000) {
      forceReconnect();
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch (e) {
      /* 忽略 */
    }
  }, 20000);
}

function scheduleRetry(first) {
  if (!wanted || giveUp || retryTimer) return;
  const delay = first || Math.min(1000 * Math.pow(2, retry), 10000);
  retry++;
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    open();
  }, delay);
  // 连续多次连不上时，顺便验证 token（若失效 api 层会自动跳登录）
  if (retry >= 3 && session.token) {
    api.me().catch(() => {});
  }
}

function authLost(message) {
  giveUp = true;
  teardown();
  clearToken();
  if (message) toast(message, 'error', 3500);
  goLogin();
}

// 被顶号：停止重连，但不清除 token。
// 同一浏览器的多个标签页共用 token，清掉会让后打开的那页刷新后也掉登录。
function replacedElsewhere() {
  giveUp = true;
  teardown();
  wsState.replaced = true;
}

// 用户点“在这里继续”：重新连接，把另一端挤下线。
// 若是另一台设备登录过，本端 token 已作废，服务端返回 4001，再走登录流程。
export function resumeHere() {
  try {
    const t = localStorage.getItem('zjh_token');
    if (t) session.token = t;
  } catch (e) {
    /* 忽略 */
  }
  wsState.replaced = false;
  wanted = true;
  giveUp = false;
  retry = 0;
  open();
}

function teardown() {
  stopHeartbeat();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = 0;
  const sock = ws;
  ws = null;
  wsState.connected = false;
  rejectAll();
  if (sock) {
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      sock.close();
    } catch (e) {
      /* 忽略 */
    }
  }
}

function open() {
  if (!wanted || giveUp || !session.token) return;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  let sock;
  try {
    sock = new WebSocket(wsUrl());
  } catch (e) {
    scheduleRetry();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    retry = 0;
    lastRecv = Date.now();
    wsState.connected = true;
    wsState.restarting = false;
    startHeartbeat();
    if (activeRoom) doJoin();
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    lastRecv = Date.now();
    handleMessage(e.data);
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = null;
    stopHeartbeat();
    wsState.connected = false;
    rejectAll();
    if (e.code === 4001) {
      authLost('登录已失效，请重新登录');
    } else if (e.code === 4002) {
      replacedElsewhere();
    } else if (e.code === 1012) {
      // 服务器更新重启：很快就能连上，先短间隔重试
      wsState.restarting = true;
      retry = 0;
      scheduleRetry(500);
    } else {
      scheduleRetry();
    }
  };
  sock.onerror = () => {
    /* onclose 会随后触发 */
  };
}

// 立即丢弃当前连接并重新连接（页面回到前台、心跳超时等）
export function forceReconnect() {
  if (!wanted || giveUp) return;
  teardown();
  retry = 0;
  open();
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return;
  }
  switch (msg.type) {
    case 'res': {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else {
        const er = msg.error || {};
        p.reject(makeError(er.code || 'ERROR', er.message || '操作失败', false));
      }
      break;
    }
    case 'state':
      if (msg.data) {
        updateOffset(msg.data.serverTime);
        stateListeners.forEach((fn) => fn(msg.data));
      }
      break;
    case 'event':
      if (msg.data) eventListeners.forEach((fn) => fn(msg.data));
      break;
    case 'pong':
      updateOffset(msg.serverTime);
      break;
    case 'replaced':
      replacedElsewhere();
      break;
    case 'sys':
      applySys(msg.data);
      break;
    default:
      break;
  }
}

// 发请求，返回 Promise<data>；失败 reject Error{ code, message, local }
export function request(action, data, timeout) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) {
      reject(makeError('OFFLINE', '连接中，请稍后再试', true));
      return;
    }
    const id = 'c-' + ++reqSeq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(makeError('TIMEOUT', '请求超时，请重试', true));
    }, timeout || 10000);
    pending.set(id, { resolve, reject, timer });
    try {
      ws.send(JSON.stringify({ type: 'req', id, action, data: data || {} }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(makeError('OFFLINE', '连接中，请稍后再试', true));
    }
  });
}

function doJoin() {
  const code = activeRoom;
  if (!code) return;
  request('room.join', { code })
    .then((data) => joinHandler && code === activeRoom && joinHandler(null, code, data))
    .catch((err) => joinHandler && code === activeRoom && joinHandler(err, code));
}

// 房间页挂载时设置当前房间；已连接则立即 join，否则连接后自动 join。传 null 取消。
export function setActiveRoom(code, handler) {
  activeRoom = code || null;
  joinHandler = code ? handler || null : null;
  if (!code) return;
  if (ws && ws.readyState === 1) doJoin();
  else connect();
}

export function connect() {
  // 被顶号后只能由用户点“在这里继续”恢复，路由切换不自动重连（否则会把另一端挤下去）
  if (!session.token || wsState.replaced) return;
  wanted = true;
  giveUp = false;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  retry = 0;
  open();
}

export function disconnect() {
  wanted = false;
  wsState.replaced = false;
  activeRoom = null;
  joinHandler = null;
  teardown();
}

hooks.onClear = disconnect;

// 页面回到前台 / 网络恢复时，立刻检查连接
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !wanted || giveUp) return;
    if (!ws || ws.readyState !== 1 || Date.now() - lastRecv > 30000) forceReconnect();
  });
  window.addEventListener('online', () => {
    if (wanted && !giveUp && (!ws || ws.readyState !== 1)) forceReconnect();
  });
}
