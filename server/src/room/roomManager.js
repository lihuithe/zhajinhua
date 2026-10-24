// 房间管理：房间号生成、用户与房间的对应关系、进入/切换房间、30 分钟无人销毁
import { randomInt } from 'node:crypto';
import { Room, DEFAULT_TIMING } from './room.js';
import { normalizeConfig } from '../config.js';
import { err } from '../errors.js';
import { SNAPSHOT_FORMAT, SNAPSHOT_MAX_AGE_MS } from '../snapshot.js';

// 35 个字符：数字 23456789 + 大写 ABDEFGHJLMNRTY + 小写 abdefghjmnrty
// 只用小写字母和数字，去掉易混淆的 0 1 i l o q；输入时不区分大小写
export const ROOM_CODE_CHARS = '23456789abcdefghjkmnprstuvwxyz';
const codeKey = (c) => (typeof c === 'string' ? c.trim().toLowerCase() : '');
export const ROOM_CODE_LENGTH = 8;
const MAX_ROOMS = 300;
const MAX_ROOMS_PER_OWNER = 5;

export class RoomManager {
  /**
   * @param {object} opts
   * @param {(userId:string,msg:object)=>void} opts.send 向用户的 WebSocket 推送
   * @param {()=>number} [opts.now]
   * @param {object} [opts.timing] 覆盖 DEFAULT_TIMING（测试用）
   * @param {(room:Room, summary:object)=>void} [opts.onSessionEnd]
   * @param {object} [opts.scheduler] 注入定时器（测试用）
   * @param {Function} [opts.rig] 测试用：指定发牌
   * @param {Function} [opts.randInt]
   * @param {object} [opts.hooks] 记录 / 维护模式回调：
   *   onRoomCreated(info)、onRoomRestored(room)、onRoomDestroyed(room, reason)、onSeat(room)、onHandEnd(room, record)、checkMaintenance()
   */
  constructor({ send, now = Date.now, timing, onSessionEnd, scheduler, rig, randInt, hooks = {} } = {}) {
    this.hooks = hooks;
    this.dirty = false; // 房间状态自上次快照以来有变化
    this.now = now;
    this.timing = { ...DEFAULT_TIMING, ...(timing || {}) };
    this.rooms = new Map();
    this.userRoom = new Map(); // userId -> Room
    this.sweeper = null;
    this.deps = {
      now,
      send: (uid, msg) => send?.(uid, msg),
      timing: this.timing,
      scheduler,
      rig,
      randInt,
      onSessionEnd,
      onMemberRemoved: null, // 创建房间时按房间绑定
      onDirty: () => {
        this.dirty = true;
      },
      onSeat: (room) => hooks.onSeat?.(room),
      onHandEnd: (room, record) => hooks.onHandEnd?.(room, record),
      checkMaintenance: () => hooks.checkMaintenance?.(),
    };
  }

  /** 每个房间独立的 deps：onMemberRemoved 需要引用房间本身 */
  _roomDeps(getRoom) {
    return {
      ...this.deps,
      onMemberRemoved: (uid) => {
        if (this.userRoom.get(uid) === getRoom()) this.userRoom.delete(uid);
      },
    };
  }

  _genCode() {
    for (let tries = 0; tries < 100; tries++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw err('SERVER_BUSY', '生成房间号失败，请稍后再试', 500);
  }

  createRoom(ownerId, configInput, ownerNickname = '') {
    this.hooks.checkMaintenance?.();
    const config = normalizeConfig(configInput);
    if (this.rooms.size >= MAX_ROOMS) throw err('TOO_MANY_ROOMS', '服务器房间数已达上限，请稍后再试', 409);
    let owned = 0;
    for (const r of this.rooms.values()) if (r.ownerId === ownerId) owned++;
    if (owned >= MAX_ROOMS_PER_OWNER) throw err('TOO_MANY_ROOMS', '你创建的房间太多了，请先使用已有的房间', 409);
    const code = this._genCode();
    const room = new Room({ code, ownerId, config, deps: this._roomDeps(() => room) });
    this.rooms.set(code, room);
    this.dirty = true;
    try {
      this.hooks.onRoomCreated?.({ code, ownerId, ownerNickname, config, createdAt: room.createdAt });
    } catch (e) {
      console.error('记录开房失败', e);
    }
    // 房间还没有人进入，也要有定时器来处理"无人销毁"由 sweep 负责，这里无需额外调度
    return code;
  }

  getRoom(code) {
    return this.rooms.get(codeKey(code)) || null;
  }

  roomOf(userId) {
    return this.userRoom.get(userId) || null;
  }

  /** room.join：自动退出旧房间；旧房间对局中未弃牌则拒绝。voice 是该用户的喊话声音包（可为 null） */
  join(userId, nickname, rawCode, voice = null) {
    const room = this.rooms.get(codeKey(rawCode));
    if (!room) throw err('ROOM_NOT_FOUND', '房间不存在', 404);
    const cur = this.userRoom.get(userId);
    if (cur && cur !== room) {
      if (cur.isActiveInHand(userId)) throw err('IN_OTHER_GAME', '你在另一个房间的对局中，请先结束那边的对局', 409);
      room.checkJoin(userId);
      cur.leave(userId);
    }
    room.join(userId, nickname, voice);
    this.userRoom.set(userId, room);
    return { chat: room.chatHistory() };
  }

  handle(userId, action, data) {
    const room = this.userRoom.get(userId);
    if (!room) throw err('NOT_IN_ROOM', '你不在任何房间里');
    return room.handle(userId, action, data);
  }

  onConnect(userId) {
    const room = this.userRoom.get(userId);
    if (room) room.setOnline(userId, true);
  }

  onDisconnect(userId) {
    const room = this.userRoom.get(userId);
    if (room) room.setOnline(userId, false);
  }

  updateNickname(userId, nickname) {
    const room = this.userRoom.get(userId);
    if (room) room.updateNickname(userId, nickname);
  }

  updateVoice(userId, voice) {
    const room = this.userRoom.get(userId);
    if (room) room.updateVoice(userId, voice);
  }

  /** 销毁长期无人在线的房间 */
  sweep(now = this.now()) {
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince >= this.timing.emptyDestroyMs) {
        this.destroyRoom(code, 'empty');
      }
    }
  }

  /**
   * 销毁房间。reason：'empty' 无人超时 / 'dissolved' 管理员解散 / 其他；
   * reason 为 null 表示进程关闭，不记录销毁（房间会随快照保留）
   */
  destroyRoom(code, reason = 'destroyed') {
    code = codeKey(code);
    const room = this.rooms.get(code);
    if (!room) return;
    if (reason !== null) {
      try {
        this.hooks.onRoomDestroyed?.(room, reason);
      } catch (e) {
        console.error('记录房间销毁失败', e);
      }
      this.dirty = true;
    }
    room.destroy(); // 会清理定时器，并通过 onMemberRemoved 释放 userRoom
    this.rooms.delete(code);
  }

  /** 管理员解散房间：先向成员推送 dissolved 事件，再销毁。房间不存在返回 false */
  dissolveRoom(code, text) {
    code = codeKey(code);
    const room = this.rooms.get(code);
    if (!room) return false;
    room.notifyDissolved(text);
    this.destroyRoom(code, 'dissolved');
    return true;
  }

  // ---------------------------------------------------------------- 快照

  toSnapshot({ version = 'dev' } = {}) {
    return {
      formatVersion: SNAPSHOT_FORMAT,
      version,
      savedAt: this.now(),
      rooms: [...this.rooms.values()].map((r) => r.toSnapshot()),
    };
  }

  /**
   * 从快照恢复全部房间（在空的 manager 上调用）。
   * 格式不一致 / 已过期 / 结构不对时返回 { ok: false, reason }，不改动任何状态；
   * 单个房间数据损坏只跳过该房间。
   */
  restore(snapshot, { maxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.rooms)) return { ok: false, reason: '快照结构不正确' };
    if (snapshot.formatVersion !== SNAPSHOT_FORMAT) {
      return { ok: false, reason: `快照格式版本不一致（快照 ${snapshot.formatVersion}，当前 ${SNAPSHOT_FORMAT}）` };
    }
    const now = this.now();
    const age = now - snapshot.savedAt;
    if (!Number.isFinite(snapshot.savedAt)) return { ok: false, reason: '快照缺少写入时间' };
    if (age > maxAgeMs) return { ok: false, reason: `快照已过期（距写入 ${Math.round(age / 1000)} 秒）` };
    const shiftMs = Math.max(0, age); // 停机时长；时钟回拨时不平移
    let restored = 0;
    let failed = 0;
    for (const data of snapshot.rooms) {
      try {
        if (this.rooms.has(codeKey(data.code))) throw new Error('房间号重复');
        const room = Room.fromSnapshot(data, this._roomDeps(() => room), { shiftMs });
        this.rooms.set(codeKey(room.code), room); // 旧的大小写混合房间号也按小写索引
        for (const m of room.members.values()) if (!m.pendingLeave) this.userRoom.set(m.userId, room);
        restored++;
      } catch (e) {
        failed++;
        console.error('恢复房间失败，已跳过', data && data.code, e);
      }
    }
    for (const room of this.rooms.values()) {
      room.resume();
      try {
        this.hooks.onRoomRestored?.(room);
      } catch (e) {
        console.error('记录恢复房间失败', e);
      }
    }
    if (restored) this.dirty = true;
    return { ok: true, restored, failed, shiftMs };
  }

  startSweeper(intervalMs = 30 * 1000) {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  close() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const code of [...this.rooms.keys()]) this.destroyRoom(code, null);
    this.userRoom.clear();
  }
}
