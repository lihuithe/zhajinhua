// 系统状态：版本号、系统通知、维护模式（来自 GET /api/notices 与 ws 的 sys 消息）
import { reactive } from 'vue';

export const sysState = reactive({
  version: '', // 服务端当前版本
  loadedVersion: '', // 页面加载后第一次拿到的版本
  newVersion: false, // 服务端版本变了：提示刷新
  notices: [],
  maintenance: { enabled: false, message: '' },
  busy: false, // 本人正在行动（此时不弹通知弹窗）
});

export function applySys(data) {
  if (!data) return;
  if (typeof data.version === 'string' && data.version) {
    if (!sysState.loadedVersion) sysState.loadedVersion = data.version;
    sysState.version = data.version;
    sysState.newVersion = data.version !== sysState.loadedVersion;
  }
  if (Array.isArray(data.notices)) sysState.notices = data.notices;
  if (data.maintenance) sysState.maintenance = { enabled: !!data.maintenance.enabled, message: data.maintenance.message || '' };
}

// 未登录（登录页）时也要能看到通知
export function fetchSys() {
  return fetch('/api/notices')
    .then((r) => r.json())
    .then((d) => d && d.ok && applySys(d))
    .catch(() => {});
}

export const MAINT_DEFAULT = '系统维护中，暂时不能开新房间';
