// 时间格式化小工具
const p2 = (n) => String(n).padStart(2, '0');

// 'MM-DD HH:mm'；跨年时带年份
export function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const now = new Date();
  const md = p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '-' + md;
}

// 'YYYY-MM-DD HH:mm:ss'
export function fmtFull(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return (
    d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
  );
}

// 'HH:mm'
export function fmtHM(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return p2(d.getHours()) + ':' + p2(d.getMinutes());
}

// 秒数 → 'm:ss' / 'h:mm:ss'
export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? h + ':' + p2(m) + ':' + p2(s) : m + ':' + p2(s);
}

// 秒数 → '3 天 4 小时' 之类
export function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return d + ' 天 ' + h + ' 小时';
  if (h) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

// 'YYYY-MM-DDTHH:mm'（datetime-local 输入框用）↔ 毫秒
export function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}
export function fromLocalInput(s) {
  if (!s) return null;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}
