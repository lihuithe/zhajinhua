// 系统设置：维护模式、系统通知（持久化在数据库），以及向在线连接广播 sys 消息
import { err } from './errors.js';

export const DEFAULT_MAINT_MESSAGE = '系统维护中，暂时不能开新房间';
export const NOTICE_LEVELS = ['info', 'warn', 'maint'];
const LEVEL_RANK = { maint: 3, warn: 2, info: 1 };
const MAINT_KEY = 'maintenance';
const MAX_TIMER_MS = 2 ** 31 - 1;

const len = (s) => Array.from(s).length;

function bad(msg) {
  return err('BAD_REQUEST', msg);
}

function boolField(v, name) {
  if (typeof v !== 'boolean') throw bad(`${name} 必须是布尔值`);
  return v;
}

function timeField(v, name) {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(`${name} 必须是毫秒时间戳或 null`);
  return Math.floor(v);
}

/** 校验并合并通知字段（base 为已有通知或默认值）；未知字段忽略 */
export function validateNotice(input, base) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('请求内容不正确');
  const n = { ...base };
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') throw bad('标题必须是字符串');
    n.title = input.title.trim();
  }
  if (input.content !== undefined) {
    if (typeof input.content !== 'string') throw bad('内容必须是字符串');
    n.content = input.content.replace(/\r\n/g, '\n').trim();
  }
  if (input.level !== undefined) {
    if (!NOTICE_LEVELS.includes(input.level)) throw bad('级别必须是 info / warn / maint');
    n.level = input.level;
  }
  if (input.banner !== undefined) n.banner = boolField(input.banner, 'banner');
  if (input.popup !== undefined) n.popup = boolField(input.popup, 'popup');
  if (input.enabled !== undefined) n.enabled = boolField(input.enabled, 'enabled');
  for (const k of ['startsAt', 'endsAt', 'maintStart', 'maintEnd']) {
    if (input[k] !== undefined) n[k] = timeField(input[k], k);
  }
  if (typeof n.title !== 'string' || len(n.title) < 1 || len(n.title) > 40) throw bad('标题长度必须是 1–40 个字');
  if (typeof n.content !== 'string' || len(n.content) > 500) throw bad('内容最多 500 个字');
  if (n.startsAt !== null && n.endsAt !== null && n.endsAt <= n.startsAt) throw bad('失效时间必须晚于生效时间');
  if (n.maintStart !== null && n.maintEnd !== null && n.maintEnd <= n.maintStart) throw bad('维护结束时间必须晚于开始时间');
  return n;
}

const NOTICE_DEFAULTS = {
  title: '',
  content: '',
  level: 'info',
  banner: true,
  popup: false,
  startsAt: null,
  endsAt: null,
  maintStart: null,
  maintEnd: null,
  enabled: true,
};

export class SystemService {
  /**
   * @param {object} opts
   * @param {object} opts.db openDb() 的返回值
   * @param {string} [opts.version]
   * @param {() => number} [opts.now]
   * @param {{set: Function, clear: Function}} [opts.scheduler] 注入定时器（测试用）
   */
  constructor({ db, version = 'dev', now = Date.now, scheduler } = {}) {
    this.db = db;
    this.version = version;
    this.now = now;
    this.scheduler = scheduler || { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h) };
    this.broadcaster = null; // (payload) => void，由 app 绑定到 WsHub
    this.timer = null;
    this.timerAt = null;
    this.stopped = false;
    const saved = db.admin.getSetting(MAINT_KEY, null);
    this.maintenance = {
      enabled: !!(saved && saved.enabled),
      message: saved && typeof saved.message === 'string' ? saved.message : '',
    };
  }

  // ---------------------------------------------------------------- 维护模式

  /** 后台看到的原始设置 */
  getMaintenance() {
    return { ...this.maintenance };
  }

  /** 对玩家展示的版本：开启且提示语为空时用默认提示语 */
  publicMaintenance() {
    const m = this.maintenance;
    return { enabled: m.enabled, message: m.enabled ? m.message || DEFAULT_MAINT_MESSAGE : m.message };
  }

  setMaintenance(input) {
    if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') throw bad('enabled 必须是布尔值');
    let message = this.maintenance.message;
    if (input.message !== undefined) {
      if (typeof input.message !== 'string') throw bad('提示语必须是字符串');
      message = input.message.trim();
      if (len(message) > 100) throw bad('提示语最多 100 个字');
    }
    this.maintenance = { enabled: input.enabled, message };
    this.db.admin.setSetting(MAINT_KEY, this.maintenance);
    this.broadcast();
    return this.getMaintenance();
  }

  /** 维护模式下拒绝开新房间 / 开始新的一场 */
  checkMaintenance() {
    if (this.maintenance.enabled) throw err('MAINTENANCE', this.publicMaintenance().message, 503);
  }

  // ---------------------------------------------------------------- 通知

  listNotices() {
    return this.db.admin.listNotices();
  }

  activeNotices(now = this.now()) {
    return this.listNotices()
      .filter((n) => n.enabled && (n.startsAt === null || n.startsAt <= now) && (n.endsAt === null || n.endsAt > now))
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.updatedAt - a.updatedAt || b.id - a.id);
  }

  createNotice(input) {
    const n = validateNotice(input, NOTICE_DEFAULTS);
    const notice = this.db.admin.insertNotice(n, this.now());
    this.changed();
    return notice;
  }

  updateNotice(id, input) {
    const cur = this.db.admin.getNotice(id);
    if (!cur) throw err('NOT_FOUND', '通知不存在', 404);
    const n = validateNotice(input, cur);
    const notice = this.db.admin.updateNotice(id, n, this.now());
    this.changed();
    return notice;
  }

  deleteNotice(id) {
    if (!this.db.admin.deleteNotice(id)) throw err('NOT_FOUND', '通知不存在', 404);
    this.changed();
  }

  // ---------------------------------------------------------------- 推送

  /** 公开接口 GET /api/notices 与 ws sys 消息共用的内容 */
  payload() {
    return { version: this.version, notices: this.activeNotices(), maintenance: this.publicMaintenance() };
  }

  broadcast() {
    try {
      this.broadcaster?.(this.payload());
    } catch (e) {
      console.error('广播 sys 出错', e);
    }
  }

  /** 通知有增删改：广播并重新安排“到点重推”的定时器 */
  changed() {
    this.broadcast();
    this._rearm();
  }

  _nextBoundary(now) {
    let t = Infinity;
    for (const n of this.listNotices()) {
      if (!n.enabled) continue;
      if (n.startsAt !== null && n.startsAt > now) t = Math.min(t, n.startsAt);
      if (n.endsAt !== null && n.endsAt > now) t = Math.min(t, n.endsAt);
    }
    return t;
  }

  _rearm() {
    if (this.timer) this.scheduler.clear(this.timer);
    this.timer = null;
    this.timerAt = null;
    if (this.stopped) return;
    const now = this.now();
    const at = this._nextBoundary(now);
    if (at === Infinity) return;
    this.timerAt = at;
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      const due = this.timerAt;
      this.timerAt = null;
      if (this.now() >= due) this.broadcast();
      this._rearm();
    }, Math.min(Math.max(1, at - now), MAX_TIMER_MS));
    this.timer.unref?.();
  }

  start() {
    this.stopped = false;
    this._rearm();
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.scheduler.clear(this.timer);
    this.timer = null;
  }
}
