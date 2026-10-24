// 房间：成员、座位、观战、准备、房主、场次、局间倒计时、超时、按接收者裁剪 RoomView
import { randomInt, randomBytes } from 'node:crypto';
import { HandGame } from '../game/handGame.js';
import { TYPE_RANK, toCardsView } from '../game/hand.js';
import { normalizeConfig, getDefaults } from '../config.js';
import { err } from '../errors.js';
import { BOT_PREFIX, isBot, pickBotName, handStrength, decide, BOT_WIN_LINES } from './bot.js';
import { VOICE_IDS } from '../voices.js';

export const SEAT_COUNT = 15;
export const MAX_SPECTATORS = 30;
const MAX_SESSIONS = 20;

// 聊天
export const CHAT_MAX_LEN = 60; // 文字消息最多字数
const CHAT_KEEP = 50; // 房间保留最近多少条
const CHAT_MIN_INTERVAL_MS = 800; // 同一人两条消息的最小间隔
export const CHAT_EMOJIS = Object.freeze([
  '😀', '😂', '🤣', '😎', '😍', '😭', '😡', '😱', '🤔', '😏', '🙄', '😴',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '🎉', '💰', '🔥', '💯', '🍺', '🌹',
]);
// 互动道具：聊天的 kind 为 'prop'，text 是道具 id，扔向某个座位上的人
export const PROP_IDS = Object.freeze(['flower', 'kiss', 'beer', 'like', 'egg', 'tomato', 'bomb']);
const PROP_MIN_INTERVAL_MS = 2500; // 同一人两次道具的最小间隔
const BOT_PROP_CHANCE = 0.15; // 机器人比牌输给真人后，朝赢家扔鸡蛋 / 番茄的概率
const BOT_PROP_DELAY_MS = 2600; // 等比牌动画播完再扔

export const DEFAULT_TIMING = {
  nextHandDelayMs: null, // 局间 / 结算前等待；null 表示按房间配置（nextHandSeconds / settleSeconds），测试可覆盖
  ownerOfflineMs: 120 * 1000, // 房主掉线多久后转移
  spectatorOfflineMs: 5 * 60 * 1000, // 离线的观战者多久后被清出房间
  emptyDestroyMs: 30 * 60 * 1000, // 无人在线多久后销毁房间
  offlineUnseatMs: 10 * 1000, // 开新一局时，入座者已离线超过这么久就自动改为观战模式（给热更新重连、网络抖动留余量）
  actionScale: 1, // 行动限时缩放（仅测试用）
  dealMs: null, // 发牌动画时长；null 表示按人数计算（dealDurationMs），测试可设为 0
};

/**
 * 发牌动画时长：荷官一张一张发，每人 3 张（与前端 RoomScreen 的发牌节奏保持一致）。
 * 开局时第一位行动者的倒计时顺延这么久，机器人也等发完牌再出手。
 */
export function dealDurationMs(n) {
  const gap = Math.max(100, Math.min(280, Math.round(3000 / (3 * n))));
  return 500 + 3 * n * gap + 450 + 150;
}

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.code
   * @param {string} opts.ownerId
   * @param {object} opts.config 已校验的配置
   * @param {object} opts.deps { now, send(userId,msg), onMemberRemoved(userId), onSessionEnd(room,summary,meta), timing, scheduler, rig, randInt,
   *   rand（0–1 随机数，机器人声音包 / 道具用，测试可覆盖）, onDirty(), onSeat(room), onHandEnd(room,record), checkMaintenance() }
   */
  constructor({ code, ownerId, config, deps }) {
    this.code = code;
    this.ownerId = ownerId;
    this.config = config;
    this.deps = deps;
    this.timing = { ...DEFAULT_TIMING, ...(deps.timing || {}) };
    this.now = deps.now || Date.now;
    this.scheduler = deps.scheduler || {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h),
    };
    this.randInt = deps.randInt || randomInt;
    this.rand = deps.rand || Math.random;

    this.createdAt = this.now();
    this.members = new Map(); // userId -> { userId, nickname, voice, online, joinedAt, seatIndex, offlineSince, pendingLeave }
    this.seats = Array(SEAT_COUNT).fill(null); // { userId, chips, ready, seatedAt }
    this.banned = new Set();
    this.chat = []; // 最近的聊天消息
    this.chatSeq = 0;
    this.chatLast = new Map(); // userId -> 上次发言时间
    this.propLast = new Map(); // userId -> 上次使用道具的时间
    this.sideTimers = new Set(); // 房间主定时器以外的一次性定时器（机器人扔道具），销毁时清理
    this.seq = 0;

    this.phase = 'waiting';
    this.sessionNo = 1;
    this.handNo = 0;
    this.game = null;
    this.sittingOut = new Set(); // 本局因积分不足不参与的 userId
    this.nextHandAt = null;
    this.afterHand = null; // 'next' | 'settle'
    this.paused = false; // 桌上有积分的玩家不足 2 人：本场暂停，等人入座
    this.botDueAt = null; // 轮到机器人时，计划出手的时间
    this.dealUntil = 0; // 本局发牌动画结束的时间
    this.botTurnKey = '';
    this.summary = null;
    this.sessions = [];
    this.totals = new Map(); // userId -> { userId, nickname, net }
    this.sess = null; // 当前场：{ players: Map, handsPlayed }
    this.lastDealerSeat = null;
    this.lastWinnerIds = [];
    this.timeoutStreak = new Map();
    this.winStreak = null; // 本场的连胜：{ userId, n }，没有则为 null

    this.ownerOfflineSince = this.createdAt; // 创建者还没进入房间，视为离线
    this.emptySince = this.createdAt;
    this.timer = null;
    this.pendingEvents = [];
    this.destroyed = false;
  }

  // ---------------------------------------------------------------- 基本查询

  get seatedCount() {
    return this.seats.filter(Boolean).length;
  }

  get spectatorCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.seatIndex === null && !m.pendingLeave) n++;
    return n;
  }

  onlineCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.online && !m.isBot) n++;
    return n;
  }

  _member(userId) {
    const m = this.members.get(userId);
    if (!m || m.pendingLeave) throw err('NOT_IN_ROOM', '你不在这个房间里');
    return m;
  }

  _inHand(userId) {
    return !!this.game && !this.game.ended && this.game.byUser.has(userId);
  }

  /** 该用户在本房间的对局中是否还没弃牌（用于"进入新房间"前的检查） */
  isActiveInHand(userId) {
    return !!this.game && this.game.isActive(userId);
  }

  info() {
    return { exists: true, phase: this.phase, seated: this.seatedCount, spectators: this.spectatorCount };
  }

  // ---------------------------------------------------------------- 进入 / 退出

  checkJoin(userId) {
    if (this.banned.has(userId)) throw err('BANNED', '你已被房主移出该房间，无法再次进入');
    const m = this.members.get(userId);
    if (m && !m.pendingLeave) return;
    if (this.seatedCount >= SEAT_COUNT && this.spectatorCount >= MAX_SPECTATORS) {
      throw err('ROOM_FULL', '房间已满');
    }
  }

  /** voice：该用户的喊话声音包 id（可为 null），每次进入都按账号里的最新设置更新 */
  join(userId, nickname, voice = null) {
    this.checkJoin(userId);
    let m = this.members.get(userId);
    if (!m) {
      m = { userId, nickname, voice, online: true, joinedAt: ++this.seq, seatIndex: null, offlineSince: null, pendingLeave: false };
      this.members.set(userId, m);
    } else {
      m.pendingLeave = false;
      m.nickname = nickname;
      m.voice = voice;
      m.online = true;
      m.offlineSince = null;
    }
    this._afterPresenceChange(userId, true);
    this._flush();
  }

  setOnline(userId, online) {
    const m = this.members.get(userId);
    if (!m || m.pendingLeave) return;
    if (m.online === online) return;
    m.online = online;
    m.offlineSince = online ? null : this.now();
    this._afterPresenceChange(userId, online);
    this._flush();
  }

  _afterPresenceChange(userId, online) {
    if (userId === this.ownerId) this.ownerOfflineSince = online ? null : this.now();
    this._updateEmpty();
    this._maybeTransferOwner();
  }

  _updateEmpty() {
    if (this.onlineCount() === 0) {
      if (this.emptySince === null) this.emptySince = this.now();
    } else {
      this.emptySince = null;
    }
  }

  updateNickname(userId, nickname) {
    const m = this.members.get(userId);
    if (!m) return;
    m.nickname = nickname;
    const g = this.game;
    const p = g && g.byUser.get(userId);
    if (p) p.nickname = nickname;
    const e = this.sess && this.sess.players.get(userId);
    if (e) e.nickname = nickname;
    const t = this.totals.get(userId);
    if (t) t.nickname = nickname;
    this._flush();
  }

  updateVoice(userId, voice) {
    const m = this.members.get(userId);
    if (!m) return;
    m.voice = voice;
    this._flush();
  }

  leave(userId) {
    const m = this._member(userId);
    const wasOwner = userId === this.ownerId;
    if (m.seatIndex !== null && this._inHand(userId)) {
      // 对局中离开：先自动弃牌，座位保留到本局结束后再清理
      if (this.game.isActive(userId)) {
        this.game.fold(m.seatIndex);
        this._afterGameOp();
      }
      m.pendingLeave = true;
      m.online = false;
    } else {
      this._removeMember(m);
    }
    this.deps.onMemberRemoved?.(userId);
    if (wasOwner) {
      // 房主主动退出：立即转移；暂无候选人时，等候选人出现后马上转移
      this.ownerOfflineSince = this.now() - this.timing.ownerOfflineMs;
      this._maybeTransferOwner(true);
    }
    this._updateEmpty();
    this._flush();
  }

  _removeMember(m) {
    if (m.seatIndex !== null) this._standUp(m);
    this.members.delete(m.userId);
    this.timeoutStreak.delete(m.userId);
  }

  // ---------------------------------------------------------------- 房主

  _ownerCandidate() {
    let best = null;
    for (const m of this.members.values()) {
      if (!m.online || m.pendingLeave || m.isBot || m.userId === this.ownerId) continue;
      const seat = m.seatIndex !== null ? this.seats[m.seatIndex] : null;
      // 入座者优先（最早入座），其次是最早进入的观战者
      const rank = seat ? [0, seat.seatedAt] : [1, m.joinedAt];
      if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { m, rank };
    }
    return best ? best.m : null;
  }

  _ownerIsOnline() {
    const o = this.members.get(this.ownerId);
    return !!o && o.online && !o.pendingLeave;
  }

  /** 房主已离开或掉线超过阈值时转移房主；immediate = 房主主动退出，立即转移 */
  _maybeTransferOwner(immediate = false) {
    if (this._ownerIsOnline()) return;
    if (!immediate) {
      if (this.ownerOfflineSince === null || this.now() - this.ownerOfflineSince < this.timing.ownerOfflineMs) return;
    }
    const next = this._ownerCandidate();
    if (!next) return;
    this.ownerId = next.userId;
    this.ownerOfflineSince = null;
    const seat = next.seatIndex !== null ? this.seats[next.seatIndex] : null;
    if (seat) seat.ready = false;
    this._notice(`${next.nickname} 成为房主`);
  }

  // ---------------------------------------------------------------- 座位

  _standUp(m) {
    const seat = this.seats[m.seatIndex];
    if (seat && this.sess) {
      const e = this.sess.players.get(m.userId);
      if (e) e.chips = seat.chips;
    }
    this.seats[m.seatIndex] = null;
    m.seatIndex = null;
    this.timeoutStreak.delete(m.userId);
  }

  _registerSessionPlayer(userId, nickname, chips) {
    if (!this.sess.players.has(userId)) {
      this.sess.players.set(userId, { userId, nickname, chips, bestType: null, wins: 0, rebuy: 0 });
    }
  }

  // ---------------------------------------------------------------- 统一入口

  /** 处理客户端请求（room.join 由 RoomManager 处理）。返回响应的 data */
  handle(userId, action, data) {
    data = data && typeof data === 'object' ? data : {};
    switch (action) {
      case 'room.leave':
        this.leave(userId);
        return {};
      case 'seat.sit':
        this._sit(userId, data);
        break;
      case 'seat.stand':
        this._stand(userId);
        break;
      case 'room.ready':
        this._ready(userId, data);
        break;
      case 'room.updateConfig':
        this._updateConfig(userId, data);
        break;
      case 'room.start':
        this._start(userId);
        break;
      case 'room.addBot':
        this._addBot(userId, data);
        break;
      case 'room.kick':
        this._kick(userId, data);
        break;
      case 'room.endSession':
        this._endSession(userId);
        break;
      case 'room.restart':
        this._restart(userId);
        break;
      case 'game.look':
        this._gameOp(userId, (g, seat) => g.look(seat));
        break;
      case 'game.fold':
        this._gameOp(userId, (g, seat) => g.fold(seat));
        break;
      case 'game.call':
        this._gameOp(userId, (g, seat) => g.call(seat));
        break;
      case 'game.raise':
        this._gameOp(userId, (g, seat) => g.raise(seat, data.to));
        break;
      case 'game.compare':
        this._gameOp(userId, (g, seat) => g.compare(seat, data.targetSeat));
        break;
      case 'game.allIn':
        this._gameOp(userId, (g, seat) => g.allIn(seat));
        break;
      case 'game.show':
        this._show(userId);
        break;
      case 'chat.send':
        this._chat(userId, data);
        return {}; // 聊天只推事件，不需要重推整个状态
      default:
        throw err('UNKNOWN_ACTION', '未知的操作');
    }
    this._flush();
    return {};
  }

  // ---------------------------------------------------------------- 聊天

  /** 最近的聊天记录（进入房间时随 room.join 的响应返回） */
  chatHistory() {
    return this.chat.slice();
  }

  _chat(userId, data) {
    const m = this._member(userId);
    const kind = data.kind === 'emoji' || data.kind === 'prop' ? data.kind : 'text';
    // 去掉控制字符、合并空白
    const text = String(data.text == null ? '' : data.text)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let target = null; // 道具的目标：{ toSeat, toUserId, toNickname }
    if (kind === 'emoji') {
      if (!CHAT_EMOJIS.includes(text)) throw err('INVALID_ACTION', '不支持的表情');
    } else if (kind === 'prop') {
      if (!PROP_IDS.includes(text)) throw err('INVALID_ACTION', '不支持的道具');
      const toSeat = data.toSeat;
      const seat = Number.isInteger(toSeat) && toSeat >= 0 && toSeat < SEAT_COUNT ? this.seats[toSeat] : null;
      if (!seat) throw err('INVALID_ACTION', '对方不在座位上');
      if (seat.userId === userId) throw err('INVALID_ACTION', '不能对自己使用道具');
      target = { toSeat, toUserId: seat.userId, toNickname: this.members.get(seat.userId).nickname };
    } else {
      if (!text) throw err('INVALID_ACTION', '消息不能为空');
      if (Array.from(text).length > CHAT_MAX_LEN) throw err('INVALID_ACTION', `消息最多 ${CHAT_MAX_LEN} 个字`);
    }
    const now = this.now();
    const last = this.chatLast.get(userId);
    if (last !== undefined && now - last < CHAT_MIN_INTERVAL_MS) throw err('CHAT_TOO_FAST', '发言太快了，歇一会儿');
    if (kind === 'prop') {
      // 道具另有更长的冷却（普通消息的间隔同样生效）
      const lastProp = this.propLast.get(userId);
      if (lastProp !== undefined && now - lastProp < PROP_MIN_INTERVAL_MS) throw err('CHAT_TOO_FAST', '道具用得太快了，歇一会儿');
      this.propLast.set(userId, now);
    }
    this.chatLast.set(userId, now);
    this._pushChat({ id: ++this.chatSeq, t: now, userId, nickname: m.nickname, seatIndex: m.seatIndex, kind, text, ...target });
  }

  /** 聊天消息进记录，并推送给所有在线成员（机器人没有连接，不推） */
  _pushChat(msg) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.deps.onDirty?.();
    for (const x of this.members.values()) {
      if (x.online && !x.pendingLeave && !x.isBot) this.deps.send?.(x.userId, { type: 'event', data: { kind: 'chat', msg } });
    }
  }

  _requireOwner(userId) {
    this._member(userId);
    if (userId !== this.ownerId) throw err('NOT_OWNER', '只有房主可以执行此操作');
  }

  _sit(userId, data) {
    const m = this._member(userId);
    if (m.seatIndex !== null) throw err('INVALID_ACTION', '你已经入座了');
    const i = data.seatIndex;
    if (!Number.isInteger(i) || i < 0 || i >= SEAT_COUNT) throw err('INVALID_ACTION', '座位号不合法');
    if (this.seats[i]) throw err('SEAT_TAKEN', '这个座位已经有人了');
    let chips = this.config.initialChips;
    if (this.phase === 'playing') {
      const e = this.sess.players.get(userId);
      if (e) chips = e.chips; // 同一场里重新入座，恢复原来的积分
      else this._registerSessionPlayer(userId, m.nickname, chips);
    }
    this.seats[i] = { userId, chips, ready: false, seatedAt: ++this.seq };
    m.seatIndex = i;
    this._hook('onSeat', this);
    if (this.phase === 'playing' && this.paused) this._tryResume();
  }

  // 暂停中有人入座：有积分的人够 2 个就开始倒计时，继续下一局
  _tryResume() {
    const ante = this.config.ante;
    const n = this.seats.filter((s) => s && (s.chips >= ante || this._rebuyLeft(s.userId) > 0)).length;
    if (n < 2) return;
    this.paused = false;
    this.afterHand = 'next';
    this.nextHandAt = this.now() + (this.timing.nextHandDelayMs ?? this.config.nextHandSeconds * 1000);
    this._notice('玩家已就位，本场继续');
  }

  _stand(userId) {
    const m = this._member(userId);
    if (m.seatIndex === null) throw err('NOT_SEATED', '你还没有入座');
    if (this._inHand(userId)) throw err('IN_HAND', '本局对局中不能改为观战模式，请等本局结束');
    this._standUp(m);
  }

  _ready(userId, data) {
    const m = this._member(userId);
    if (m.seatIndex === null) throw err('NOT_SEATED', '请先入座');
    if (this.phase !== 'waiting') throw err('BAD_PHASE', '现在不能修改准备状态');
    if (userId === this.ownerId) throw err('INVALID_ACTION', '房主无需准备，直接开始即可');
    if (typeof data.ready !== 'boolean') throw err('INVALID_ACTION', '参数不正确');
    this.seats[m.seatIndex].ready = data.ready;
  }

  _updateConfig(userId, data) {
    this._requireOwner(userId);
    if (this.phase !== 'waiting') throw err('BAD_PHASE', '游戏开始后不能修改配置');
    const cfg = normalizeConfig({ ...(data.config || {}), initialChips: this.config.initialChips });
    this.config = cfg;
    for (const s of this.seats) if (s) s.ready = isBot(s.userId);
    this._notice('房主修改了配置，请重新准备');
  }

  _start(userId) {
    this._requireOwner(userId);
    if (this.phase !== 'waiting') throw err('BAD_PHASE', '现在不能开始游戏');
    this.deps.checkMaintenance?.();
    this._unseatOffline();
    const seated = this.seats.filter(Boolean);
    if (seated.length < 2) throw err('NOT_ENOUGH_PLAYERS', '至少需要 2 人入座才能开始');
    if (seated.some((s) => s.userId !== this.ownerId && !s.ready)) throw err('NOT_ALL_READY', '还有玩家没有准备');
    this._beginSession();
  }

  _kick(userId, data) {
    this._requireOwner(userId);
    const target = this.members.get(data.userId);
    if (!target || target.pendingLeave) throw err('INVALID_ACTION', '该用户不在房间里');
    if (target.userId === this.ownerId) throw err('INVALID_ACTION', '不能踢出自己');
    if (data.ban === true && !target.isBot) this.banned.add(target.userId);
    if (!target.isBot) this.deps.send?.(target.userId, { type: 'event', data: { kind: 'kicked', banned: data.ban === true } });
    if (target.seatIndex !== null && this._inHand(target.userId)) {
      // 本局对局中：先弃牌，座位保留到本局结束再清理
      if (this.game.isActive(target.userId)) {
        this.game.fold(target.seatIndex);
        this._afterGameOp();
      }
      target.pendingLeave = true;
      target.online = false;
    } else {
      this._removeMember(target);
    }
    this.deps.onMemberRemoved?.(target.userId);
    this._notice(`${target.nickname} 被房主移出了房间`);
    this._updateEmpty();
  }

  // ---------------------------------------------------------------- 机器人

  _addBot(userId, data) {
    this._requireOwner(userId);
    let i = data.seatIndex;
    if (i === undefined || i === null) i = this.seats.findIndex((x) => !x);
    if (!Number.isInteger(i) || i < 0 || i >= SEAT_COUNT) throw err('INVALID_ACTION', '没有空座位了');
    if (this.seats[i]) throw err('SEAT_TAKEN', '这个座位已经有人了');
    const used = new Set([...this.members.values()].map((m) => m.nickname));
    const botId = BOT_PREFIX + randomBytes(6).toString('hex');
    const nickname = pickBotName(used);
    const voice = VOICE_IDS[Math.floor(this.rand() * VOICE_IDS.length)]; // 机器人随机一个声音包
    this.members.set(botId, { userId: botId, nickname, voice, online: true, isBot: true, joinedAt: ++this.seq, seatIndex: null, offlineSince: null, pendingLeave: false });
    this._sit(botId, { seatIndex: i });
    this.seats[i].ready = true;
    this._notice(`${nickname} 加入了牌桌`);
  }

  /** 轮到机器人时安排出手时间（模拟思考 1.4–3.6 秒） */
  _planBot() {
    const g = this.game;
    const tp = this.phase === 'playing' && g && !g.ended ? g._turnPlayer() : null;
    if (!tp || !isBot(tp.userId)) {
      this.botDueAt = null;
      return;
    }
    const key = this.handNo + ':' + tp.seatIndex + ':' + g.turnDeadline;
    if (key !== this.botTurnKey) {
      this.botTurnKey = key;
      this.botDueAt = Math.max(this.now(), this.dealUntil) + 1400 + Math.floor(Math.random() * 2200);
    }
  }

  _botAct() {
    this.botDueAt = null;
    const g = this.game;
    if (!g || g.ended) return;
    const tp = g._turnPlayer();
    if (!tp || !isBot(tp.userId)) return;
    const seat = tp.seatIndex;
    const ctx = () => ({
      seen: tp.seen,
      strength: handStrength(tp.eval),
      round: g.round,
      actions: g.view(tp.userId).actions,
      maxRounds: this.config.maxRounds,
      ante: this.config.ante,
    });
    try {
      let steps = decide(ctx());
      if (steps[0] && steps[0].type === 'look') {
        g.look(seat);
        steps = decide(ctx()); // 看完牌按明牌价重新决定
      }
      const st = steps.find((x) => x.type !== 'look');
      if (!st || st.type === 'fold') g.fold(seat);
      else if (st.type === 'call') g.call(seat);
      else if (st.type === 'raise') g.raise(seat, st.to);
      else if (st.type === 'compare') g.compare(seat, st.target);
      else if (st.type === 'allIn') g.allIn(seat);
    } catch (e) {
      // 兜底：能跟就跟，跟不了就弃
      try {
        const a = g.view(tp.userId).actions;
        if (a && a.call) g.call(seat);
        else g.fold(seat);
      } catch {
        /* 忽略，超时会处理 */
      }
    }
    this._afterGameOp();
  }

  /** 机器人发一句话（赢了偶尔得意一下） */
  _botSay(userId, text) {
    const m = this.members.get(userId);
    if (!m) return;
    const kind = Array.from(text).length <= 2 && !/[\u4e00-\u9fa5]/.test(text) ? 'emoji' : 'text';
    this._pushChat({ id: ++this.chatSeq, t: this.now(), userId, nickname: m.nickname, seatIndex: m.seatIndex, kind, text });
  }

  /** 比牌事件：机器人输给真人时，偶尔在比牌动画播完后朝赢家扔个鸡蛋 / 番茄 */
  _maybeBotProp(g, ev) {
    const loser = g.bySeat.get(ev.loserSeat);
    const winner = g.bySeat.get(ev.loserSeat === ev.fromSeat ? ev.toSeat : ev.fromSeat);
    if (!loser || !winner || !isBot(loser.userId) || isBot(winner.userId)) return;
    if (this.rand() >= BOT_PROP_CHANCE) return;
    const prop = this.rand() < 0.5 ? 'egg' : 'tomato';
    const h = this.scheduler.set(() => {
      this.sideTimers.delete(h);
      this._botProp(loser.userId, winner.userId, prop);
    }, BOT_PROP_DELAY_MS);
    this.sideTimers.add(h);
  }

  /** 机器人扔道具：到点时机器人和目标都还在座位上才扔 */
  _botProp(botId, targetId, prop) {
    if (this.destroyed) return;
    const bot = this.members.get(botId);
    const target = this.members.get(targetId);
    if (!bot || bot.pendingLeave || bot.seatIndex === null) return;
    if (!target || target.pendingLeave || target.seatIndex === null) return;
    this._pushChat({
      id: ++this.chatSeq,
      t: this.now(),
      userId: botId,
      nickname: bot.nickname,
      seatIndex: bot.seatIndex,
      kind: 'prop',
      text: prop,
      toSeat: target.seatIndex,
      toUserId: targetId,
      toNickname: target.nickname,
    });
  }

  _endSession(userId) {
    this._requireOwner(userId);
    if (this.phase !== 'playing') throw err('BAD_PHASE', '现在不能结束本场');
    if (this.game && !this.game.ended) {
      this.game.void();
      this._afterGameOp(true);
    }
    this._finishSession('owner');
  }

  _restart(userId) {
    this._requireOwner(userId);
    if (this.phase !== 'finished') throw err('BAD_PHASE', '本场还没有结算');
    this.deps.checkMaintenance?.();
    this.phase = 'waiting';
    this.sessionNo += 1;
    this.handNo = 0;
    this.game = null;
    this.summary = null;
    this.sess = null;
    this.sittingOut.clear();
    this.nextHandAt = null;
    this.afterHand = null;
    this.paused = false;
    this.lastDealerSeat = null;
    this.lastWinnerIds = [];
    this.timeoutStreak.clear();
    this.winStreak = null;
    for (const s of this.seats) {
      if (!s) continue;
      s.chips = this.config.initialChips;
      s.ready = isBot(s.userId);
    }
    this._notice('新的一场开始准备，请重新准备');
  }

  _show(userId) {
    this._member(userId);
    if (!this.game || !this.game.ended || this.phase === 'waiting') throw err('BAD_PHASE', '现在不能亮牌');
    this.game.show(userId);
  }

  _gameOp(userId, fn) {
    const m = this._member(userId);
    if (this.phase !== 'playing' || !this.game) throw err('BAD_PHASE', '现在不在对局中');
    if (m.seatIndex === null || !this.game.byUser.has(userId)) throw err('INVALID_ACTION', '你不在本局中');
    fn(this.game, m.seatIndex);
    this._afterGameOp();
  }

  // ---------------------------------------------------------------- 场与局

  _beginSession() {
    this.sess = { players: new Map(), handsPlayed: 0, startedAt: this.now() };
    this.handNo = 0;
    this.paused = false;
    this.summary = null;
    this.lastDealerSeat = null;
    this.lastWinnerIds = [];
    this.timeoutStreak.clear();
    this.winStreak = null;
    for (const s of this.seats) {
      if (!s) continue;
      s.chips = this.config.initialChips;
      s.ready = false;
      this._registerSessionPlayer(s.userId, this.members.get(s.userId).nickname, s.chips);
    }
    this.phase = 'playing';
    this._startHand();
  }

  /** 座位上已离线超过 offlineUnseatMs 的人：自动改为观战模式（积分保留，同一场坐回来恢复） */
  _unseatOffline() {
    const now = this.now();
    for (const s of this.seats) {
      if (!s) continue;
      const m = this.members.get(s.userId);
      if (!m || m.online || m.offlineSince === null || now - m.offlineSince < this.timing.offlineUnseatMs) continue;
      this._standUp(m);
      this._notice(`${m.nickname} 已离线，自动改为观战模式`);
    }
  }

  /** 本场还能补领多少积分 */
  _rebuyLeft(userId) {
    const e = this.sess && this.sess.players.get(userId);
    return Math.max(0, (this.config.rebuyMax || 0) - ((e && e.rebuy) || 0));
  }

  /** 开局前：入座者积分不够底注、且本场还有补领额度 → 自动补领一份初始积分（额度不足一份时补剩下的） */
  _autoRebuy() {
    if (!(this.config.rebuyMax > 0)) return;
    const ante = this.config.ante;
    this.seats.forEach((s, i) => {
      if (!s || s.chips >= ante) return;
      const left = this._rebuyLeft(s.userId);
      if (left <= 0) return;
      const e = this.sess.players.get(s.userId);
      const grant = Math.min(this.config.initialChips, left);
      s.chips += grant;
      e.rebuy = (e.rebuy || 0) + grant;
      const nick = this.members.get(s.userId).nickname;
      this._notice(`${nick} 积分输光，补领 ${grant} 积分（本场已领 ${e.rebuy}/${this.config.rebuyMax}）`);
      this.pendingEvents.push({ kind: 'rebuy', seat: i, amount: grant });
    });
  }

  _startHand() {
    this.nextHandAt = null;
    this.afterHand = null;
    this._unseatOffline();
    this._autoRebuy();
    const ante = this.config.ante;
    const participants = [];
    this.sittingOut.clear();
    this.seats.forEach((s, i) => {
      if (!s) return;
      if (s.chips >= ante) participants.push({ seatIndex: i, userId: s.userId, nickname: this.members.get(s.userId).nickname, chips: s.chips });
      else this.sittingOut.add(s.userId);
    });
    if (participants.length < 2) {
      // 还坐着的人里只剩一人有积分、并且离座的人也都没积分了 → 其他人输光，本场结束
      // 否则是有人离座（可能回来，观战者也可以坐下）→ 暂停等待
      const seatedCount = this.seats.filter(Boolean).length;
      const canReturn = [...this.sess.players.values()].some((e) => {
        const m = this.members.get(e.userId);
        return (!m || m.seatIndex === null) && (e.chips >= ante || this._rebuyLeft(e.userId) > 0);
      });
      if (seatedCount >= 2 && !canReturn) {
        this._notice('其他玩家积分不足，本场提前结束');
        this._finishSession('busted');
        return;
      }
      if (!this.paused) this._notice('桌上不足 2 名有积分的玩家，本场暂停，等待玩家入座');
      this.paused = true;
      this.afterHand = 'next';
      return;
    }
    this.paused = false;
    this.handNo += 1;
    const dealerSeat = this._pickDealer(participants);
    const rig = this.deps.rig ? this.deps.rig(this.handNo, participants) : undefined;
    this.game = new HandGame({
      config: this.config,
      players: participants,
      dealerSeat,
      handNo: this.handNo,
      now: this.now,
      actionMs: Math.max(1, Math.round(this.config.actionSeconds * 1000 * this.timing.actionScale)),
      cards: rig,
      randInt: this.deps.randInt,
    });
    const dealMs = this.timing.dealMs ?? dealDurationMs(participants.length);
    this.dealUntil = this.now() + dealMs;
    if (dealMs > 0 && this.game.turnDeadline !== null) this.game.turnDeadline += dealMs;
    this._syncChips();
    this.pendingEvents.push({ kind: 'handStart', handNo: this.handNo });
  }

  _pickDealer(participants) {
    if (this.lastDealerSeat === null) return participants[this.randInt(participants.length)].seatIndex;
    // 上一局赢家坐庄（平分时取行动顺序最靠前且仍参与的）
    for (const uid of this.lastWinnerIds) {
      const p = participants.find((x) => x.userId === uid);
      if (p) return p.seatIndex;
    }
    // 赢家不参与：上一任庄家顺时针的下一位参与者
    const seatsAsc = participants.map((p) => p.seatIndex).sort((a, b) => a - b);
    return seatsAsc.find((s) => s > this.lastDealerSeat) ?? seatsAsc[0];
  }

  _syncChips() {
    const g = this.game;
    if (!g) return;
    for (const p of g.players) {
      const seat = this.seats[p.seatIndex];
      if (seat && seat.userId === p.userId) seat.chips = p.chips;
      else if (this.sess) {
        // 玩家的座位已被清理（对局中离开后本局结束）
        const e = this.sess.players.get(p.userId);
        if (e) e.chips = p.chips;
      }
    }
  }

  _afterGameOp(voided = false) {
    const g = this.game;
    this._syncChips();
    for (const e of g.drainEvents()) {
      this.pendingEvents.push(e);
      if (e.kind === 'compare') this._maybeBotProp(g, e);
    }
    if (g.ended) this._onHandEnded(voided);
  }

  _onHandEnded(voided) {
    const g = this.game;
    const result = g.result;
    // 连胜只在事件里给出（作废局不算，也不改变连胜）
    const { streak, streakEnd } = voided ? { streak: null, streakEnd: null } : this._updateWinStreak(g, result);
    this.pendingEvents.push({ kind: 'handEnd', result: { ...result, showable: false, streak, streakEnd } });
    for (const w of result.winners || []) {
      const wp = g.bySeat.get(w);
      if (wp && isBot(wp.userId) && Math.random() < 0.35) this._botSay(wp.userId, BOT_WIN_LINES[Math.floor(Math.random() * BOT_WIN_LINES.length)]);
    }
    if (!voided) {
      this.sess.handsPlayed += 1;
      for (const p of g.players) {
        const e = this.sess.players.get(p.userId);
        if (!e) continue;
        if (result.winners.includes(p.seatIndex)) e.wins += 1;
        // 本场拿到过的最大牌型：只统计没有弃牌的局，避免泄露弃牌者的牌
        if (p.state !== 'folded' && (e.bestType === null || TYPE_RANK[p.eval.type] > TYPE_RANK[e.bestType])) e.bestType = p.eval.type;
      }
      this.lastDealerSeat = g.dealerSeat;
      this.lastWinnerIds = result.winners.map((s) => g.bySeat.get(s).userId);
      // 连续 2 局超时的玩家自动改为观战模式
      for (const p of g.players) {
        const n = p.timedOut ? (this.timeoutStreak.get(p.userId) || 0) + 1 : 0;
        if (n >= 2) {
          const m = this.members.get(p.userId);
          if (m && m.seatIndex !== null) {
            this._standUp(m);
            this._notice(`${m.nickname} 连续 2 局超时，已自动改为观战模式`);
          }
          this.timeoutStreak.delete(p.userId);
        } else {
          this.timeoutStreak.set(p.userId, n);
        }
      }
    }
    this._recordHand(voided);
    this._flushPendingLeaves();
    if (!voided) {
      this.afterHand = this.handNo >= this.config.hands ? 'settle' : 'next';
      const waitSec = this.afterHand === 'settle' ? this.config.settleSeconds : this.config.nextHandSeconds;
      this.nextHandAt = this.now() + (this.timing.nextHandDelayMs ?? waitSec * 1000);
    }
  }

  /**
   * 本局（非作废）结束时更新连胜，返回 handEnd 事件的附加字段：
   * streak：唯一赢家已连胜 n ≥ 2 局；streakEnd：之前有人连胜 n ≥ 3、这一局被别人终结
   * （被终结者不在本局参与者里时 seatIndex 为 null）。平分底池时连胜清空。
   */
  _updateWinStreak(g, result) {
    const prev = this.winStreak;
    const winnerIds = result.winners.map((s) => g.bySeat.get(s).userId);
    if (winnerIds.length === 1) {
      const uid = winnerIds[0];
      this.winStreak = { userId: uid, n: prev && prev.userId === uid ? prev.n + 1 : 1 };
    } else {
      this.winStreak = null;
    }
    const cur = this.winStreak;
    const streak = cur && cur.n >= 2 ? { seatIndex: result.winners[0], n: cur.n } : null;
    let streakEnd = null;
    if (prev && prev.n >= 3 && !winnerIds.includes(prev.userId)) {
      const p = g.byUser.get(prev.userId);
      streakEnd = { seatIndex: p ? p.seatIndex : null, n: prev.n };
    }
    return { streak, streakEnd };
  }

  /** 本局结束：生成对局记录（含所有参与者的牌，仅供后台复盘）并交给 onHandEnd */
  _recordHand(voided) {
    const g = this.game;
    const r = g.result;
    const deltaBySeat = new Map(r.deltas.map((d) => [d.seatIndex, d.delta]));
    const players = g.players.map((p) => {
      const cv = toCardsView(p.eval);
      return {
        userId: p.userId,
        nickname: p.nickname,
        seatIndex: p.seatIndex,
        cards: cv.cards,
        type: cv.type,
        label: cv.label,
        is235: cv.is235,
        seen: p.seen,
        state: p.state,
        bet: p.bet,
        delta: deltaBySeat.get(p.seatIndex) ?? 0,
        allIn: p.allIn,
      };
    });
    const winners = r.winners.map((s) => g.bySeat.get(s));
    const record = {
      roomCode: this.code,
      sessionNo: this.sessionNo,
      handNo: g.handNo,
      startedAt: g.startedAt,
      endedAt: this.now(),
      reason: r.reason,
      // 作废时底池已清零，这里记作废前的总下注
      pot: voided ? g.players.reduce((n, p) => n + p.bet, 0) : g.pot,
      voided,
      winners: { seats: r.winners.slice(), userIds: winners.map((p) => p.userId), names: winners.map((p) => p.nickname) },
      players,
      log: g.fullLog.map((l) => ({ ...l })),
    };
    this._hook('onHandEnd', this, record);
  }

  _hook(name, ...args) {
    try {
      this.deps[name]?.(...args);
    } catch (e) {
      console.error(`房间回调 ${name} 出错`, this.code, e);
    }
  }

  // 对局中退出房间的玩家，本局结束后清理座位
  _flushPendingLeaves() {
    for (const m of [...this.members.values()]) {
      if (m.pendingLeave) this._removeMember(m);
    }
  }

  /** @param {'completed'|'owner'|'busted'} endReason 打满局数 / 房主提前结束 / 其他人输光 */
  _finishSession(endReason = 'completed') {
    this.nextHandAt = null;
    this.afterHand = null;
    this.paused = false;
    this.phase = 'finished';
    const initial = this.config.initialChips;
    const players = [...this.sess.players.values()].map((e) => {
      const m = this.members.get(e.userId);
      const seat = m && m.seatIndex !== null ? this.seats[m.seatIndex] : null;
      const chips = seat ? seat.chips : e.chips;
      const rebuy = e.rebuy || 0;
      return {
        userId: e.userId,
        nickname: m ? m.nickname : e.nickname,
        net: chips - initial - rebuy,
        finalChips: chips,
        rebuy,
        bestType: e.bestType,
        wins: e.wins,
      };
    });
    players.sort((a, b) => b.net - a.net);
    const summary = { sessionNo: this.sessionNo, endedAt: this.now(), handsPlayed: this.sess.handsPlayed, hands: this.config.hands, endReason, players };
    this.summary = summary;
    this.sessions.unshift(summary);
    if (this.sessions.length > MAX_SESSIONS) this.sessions.length = MAX_SESSIONS;
    for (const p of players) {
      const t = this.totals.get(p.userId);
      if (t) {
        t.net += p.net;
        t.nickname = p.nickname;
      } else {
        this.totals.set(p.userId, { userId: p.userId, nickname: p.nickname, net: p.net });
      }
    }
    this.pendingEvents.push({ kind: 'sessionEnd', summary });
    try {
      this.deps.onSessionEnd?.(this, summary, { startedAt: this.sess.startedAt ?? null });
    } catch (e) {
      console.error('保存战绩失败', e);
    }
  }

  // ---------------------------------------------------------------- 定时

  /** 到点处理：行动超时、局间倒计时、房主转移、清理离线观战者 */
  tick() {
    if (this.destroyed) return;
    const now = this.now();
    if (this.botDueAt !== null && now >= this.botDueAt && this.phase === 'playing') this._botAct();
    let guard = 0;
    while (this.game && !this.game.ended && this.phase === 'playing' && this.game.turnDeadline !== null && now >= this.game.turnDeadline && guard++ < 200) {
      this.game.tick();
      this._afterGameOp();
    }
    if (this.phase === 'playing' && this.nextHandAt !== null && now >= this.nextHandAt) {
      if (this.afterHand === 'settle') this._finishSession();
      else this._startHand();
    }
    this._maybeTransferOwner();
    for (const m of [...this.members.values()]) {
      if (!m.online && !m.pendingLeave && m.seatIndex === null && m.offlineSince !== null && now - m.offlineSince >= this.timing.spectatorOfflineMs) {
        this._removeMember(m);
        this.deps.onMemberRemoved?.(m.userId);
      }
    }
    this._updateEmpty();
    this._flush();
  }

  _nextWake() {
    let t = Infinity;
    const g = this.game;
    if (this.phase === 'playing' && g && !g.ended && g.turnDeadline !== null) t = Math.min(t, g.turnDeadline);
    if (this.nextHandAt !== null) t = Math.min(t, this.nextHandAt);
    if (this.botDueAt !== null) t = Math.min(t, this.botDueAt);
    if (!this._ownerIsOnline() && this.ownerOfflineSince !== null && this._ownerCandidate()) {
      t = Math.min(t, this.ownerOfflineSince + this.timing.ownerOfflineMs);
    }
    for (const m of this.members.values()) {
      if (!m.online && !m.pendingLeave && m.seatIndex === null && m.offlineSince !== null) {
        t = Math.min(t, m.offlineSince + this.timing.spectatorOfflineMs);
      }
    }
    return t;
  }

  _schedule() {
    if (this.timer) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
    if (this.destroyed) return;
    this._planBot();
    const t = this._nextWake();
    if (t === Infinity) return;
    const delay = Math.min(Math.max(20, t - this.now()), 2 ** 31 - 1);
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error('房间定时处理出错', this.code, e);
        this._schedule();
      }
    }, delay);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) this.scheduler.clear(this.timer);
    this.timer = null;
    for (const h of this.sideTimers) this.scheduler.clear(h);
    this.sideTimers.clear();
    for (const uid of this.members.keys()) this.deps.onMemberRemoved?.(uid);
    this.members.clear();
    this.seats.fill(null);
    this.game = null;
    this.sess = null;
    this.pendingEvents.length = 0;
    this.sessions.length = 0;
    this.totals.clear();
    this.banned.clear();
  }

  // ---------------------------------------------------------------- 推送

  _notice(text) {
    this.pendingEvents.push({ kind: 'notice', text });
  }

  /** 先推 event，再推 state，然后重新安排定时器 */
  _flush() {
    if (this.destroyed) return;
    this.deps.onDirty?.();
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const online = [...this.members.values()].filter((m) => m.online && !m.pendingLeave);
    for (const ev of events) {
      for (const m of online) this.deps.send?.(m.userId, { type: 'event', data: ev });
    }
    for (const m of online) this.deps.send?.(m.userId, { type: 'state', data: this.viewFor(m.userId) });
    this._schedule();
  }

  // ---------------------------------------------------------------- 快照 / 恢复

  /**
   * 序列化房间的完整状态（含局内的牌，仅用于服务端快照文件）。
   * 不含 deps、定时器句柄、待推送事件、在线状态（恢复时所有成员视为离线）。
   * 返回值可能引用房间内部对象，调用方应立即 JSON 序列化。
   */
  toSnapshot() {
    return {
      code: this.code,
      ownerId: this.ownerId,
      config: this.config,
      createdAt: this.createdAt,
      seq: this.seq,
      members: [...this.members.values()].map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        voice: m.voice || null,
        joinedAt: m.joinedAt,
        seatIndex: m.seatIndex,
        pendingLeave: m.pendingLeave,
        isBot: !!m.isBot,
      })),
      seats: this.seats.map((s) => (s ? { userId: s.userId, chips: s.chips, ready: s.ready, seatedAt: s.seatedAt } : null)),
      banned: [...this.banned],
      chat: this.chat,
      chatSeq: this.chatSeq,
      phase: this.phase,
      sessionNo: this.sessionNo,
      handNo: this.handNo,
      game: this.game ? this.game.toSnapshot() : null,
      sittingOut: [...this.sittingOut],
      nextHandAt: this.nextHandAt,
      afterHand: this.afterHand,
      paused: this.paused,
      summary: this.summary,
      sessions: this.sessions,
      totals: [...this.totals.values()],
      sess: this.sess ? { players: [...this.sess.players.values()], handsPlayed: this.sess.handsPlayed, startedAt: this.sess.startedAt ?? null } : null,
      lastDealerSeat: this.lastDealerSeat,
      lastWinnerIds: this.lastWinnerIds,
      timeoutStreak: [...this.timeoutStreak],
      winStreak: this.winStreak,
    };
  }

  /**
   * 从快照恢复房间。所有成员标为离线，离线计时从 deps.now() 起算；
   * 局内绝对时间（turnDeadline、nextHandAt）整体后移 shiftMs（停机时长）。
   * 恢复后需调用 resume() 重新安排定时器。数据不自洽时抛错。
   * @param {object} data toSnapshot() 的结果（可经过 JSON 往返）
   * @param {object} deps 同构造函数
   * @param {{shiftMs?: number}} [opts]
   */
  static fromSnapshot(data, deps, { shiftMs = 0 } = {}) {
    const d = structuredClone(data);
    // 旧版本建的房间缺少后来新增的配置项（例如 rebuyMax）：用默认值补齐
    const room = new Room({ code: d.code, ownerId: d.ownerId, config: { ...getDefaults(), ...d.config }, deps });
    const now = room.now();
    room.createdAt = d.createdAt;
    room.seq = d.seq;
    for (const m of d.members) {
      // 旧快照的成员没有 voice
      room.members.set(m.userId, { ...m, voice: m.voice || null, online: !!m.isBot, offlineSince: m.isBot ? null : now });
    }
    d.seats.forEach((s, i) => {
      if (!s) return;
      const m = room.members.get(s.userId);
      if (!m || m.seatIndex !== i) throw new Error(`快照中座位 ${i} 与成员不一致`);
      room.seats[i] = s;
    });
    for (const m of room.members.values()) {
      if (m.seatIndex !== null && !room.seats[m.seatIndex]) throw new Error('快照中成员的座位不存在');
    }
    room.banned = new Set(d.banned);
    room.chat = d.chat;
    room.chatSeq = d.chatSeq;
    room.phase = d.phase;
    room.sessionNo = d.sessionNo;
    room.handNo = d.handNo;
    room.game = d.game ? HandGame.fromSnapshot(d.game, { now: room.now, shiftMs }) : null;
    room.sittingOut = new Set(d.sittingOut);
    room.nextHandAt = d.nextHandAt === null ? null : d.nextHandAt + shiftMs;
    room.afterHand = d.afterHand;
    room.paused = !!d.paused;
    room.summary = d.summary;
    room.sessions = d.sessions;
    room.totals = new Map(d.totals.map((t) => [t.userId, t]));
    room.sess = d.sess ? { players: new Map(d.sess.players.map((e) => [e.userId, e])), handsPlayed: d.sess.handsPlayed, startedAt: d.sess.startedAt } : null;
    room.lastDealerSeat = d.lastDealerSeat;
    room.lastWinnerIds = d.lastWinnerIds;
    room.timeoutStreak = new Map(d.timeoutStreak);
    room.winStreak = d.winStreak || null; // 旧快照没有连胜信息
    if (!['waiting', 'playing', 'finished'].includes(room.phase)) throw new Error('快照中的房间阶段不合法');
    if (room.phase === 'playing' && !room.sess) throw new Error('快照中进行中的房间缺少场次信息');
    room.ownerOfflineSince = now;
    room.emptySince = now;
    return room;
  }

  /** 恢复后重新安排定时器 */
  resume() {
    this._schedule();
  }

  // ---------------------------------------------------------------- 后台

  /** 管理后台的实时详情：不含任何牌面 */
  adminView() {
    const g = this.game;
    const turn = g && !g.ended ? g._turnPlayer() : null;
    return {
      phase: this.phase,
      ownerId: this.ownerId,
      members: [...this.members.values()]
        .filter((m) => !m.pendingLeave)
        .map((m) => {
          const seat = m.seatIndex !== null ? this.seats[m.seatIndex] : null;
          return {
            userId: m.userId,
            nickname: m.nickname,
            online: m.online,
            seatIndex: m.seatIndex,
            chips: seat ? seat.chips : null,
            ready: seat ? seat.ready : false,
          };
        }),
      hand: g
        ? {
            handNo: g.handNo,
            round: g.round,
            pot: g.pot,
            currentBet: g.currentBet,
            turnSeat: turn ? turn.seatIndex : null,
            ended: g.ended,
            players: g.players.map((p) => ({ seatIndex: p.seatIndex, nickname: p.nickname, state: p.state, seen: p.seen, bet: p.bet })),
          }
        : null,
      chat: this.chat.map((c) => ({ ...c })),
    };
  }

  /** 管理员解散：向所有成员推送 dissolved 事件（随后由 RoomManager 销毁） */
  notifyDissolved(text) {
    for (const m of this.members.values()) this.deps.send?.(m.userId, { type: 'event', data: { kind: 'dissolved', text } });
  }

  // ---------------------------------------------------------------- 视图

  _seatStatus(userId) {
    if (this.phase !== 'playing' || !this.game || this.game.ended) return 'idle';
    if (this.game.byUser.has(userId)) return 'playing';
    return this.sittingOut.has(userId) ? 'sittingOut' : 'waitingNext';
  }

  viewFor(userId) {
    const me = this.members.get(userId);
    const seats = this.seats.map((s, i) => {
      if (!s) return null;
      const m = this.members.get(s.userId);
      return {
        userId: s.userId,
        nickname: m.nickname,
        online: m.online,
        voice: m.voice || null,
        seatIndex: i,
        chips: s.chips,
        ready: s.ready,
        rebuy: this.sess && this.sess.players.get(s.userId) ? this.sess.players.get(s.userId).rebuy || 0 : 0,
        isBot: !!m.isBot,
        status: this._seatStatus(s.userId),
      };
    });
    const spectators = [...this.members.values()]
      .filter((m) => m.seatIndex === null && !m.pendingLeave)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ userId: m.userId, nickname: m.nickname, online: m.online, voice: m.voice || null }));
    const totals = [...this.totals.values()].map((t) => ({ ...t })).sort((a, b) => b.net - a.net);
    return {
      serverTime: this.now(),
      code: this.code,
      ownerId: this.ownerId,
      phase: this.phase,
      config: { ...this.config, raiseSteps: [...this.config.raiseSteps] },
      sessionNo: this.sessionNo,
      handNo: this.handNo,
      seats,
      spectators,
      me: {
        userId,
        nickname: me ? me.nickname : '',
        seatIndex: me ? me.seatIndex : null,
        isOwner: userId === this.ownerId,
      },
      hand: this.game ? this.game.view(userId, this.phase !== 'waiting') : null,
      nextHandAt: this.nextHandAt,
      paused: this.phase === 'playing' && this.paused,
      summary: this.phase === 'finished' ? this.summary : null,
      totals,
      sessions: this.sessions,
    };
  }
}
