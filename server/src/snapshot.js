// 快照：格式版本常量、文件读写（原子替换）、定期快照器
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 快照格式版本。房间或单局（Room / HandGame）的内部结构有不兼容的改动时必须加 1，
 * 旧快照会被丢弃（这类更新需要走“大更新”流程，见 docs/ADMIN.md 1.4）。
 */
export const SNAPSHOT_FORMAT = 1;
export const SNAPSHOT_FILE = 'rooms-snapshot.json';
export const SNAPSHOT_RESTORED_FILE = 'rooms-snapshot.restored.json';
export const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const SNAPSHOT_INTERVAL_MS = 20 * 1000;

/** 原子写：先写临时文件再 rename */
export function writeSnapshotFile(dir, snapshot) {
  const file = join(dir, SNAPSHOT_FILE);
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, file);
}

/** 读取快照文件。返回 { status: 'none' | 'ok' | 'invalid', snapshot?, error? } */
export function readSnapshotFile(dir) {
  const file = join(dir, SNAPSHOT_FILE);
  if (!existsSync(file)) return { status: 'none' };
  try {
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.rooms)) throw new Error('快照结构不正确');
    return { status: 'ok', snapshot };
  } catch (e) {
    return { status: 'invalid', error: e };
  }
}

/** 恢复成功后改名留作排查（覆盖旧的 .restored 文件） */
export function markSnapshotRestored(dir) {
  const from = join(dir, SNAPSHOT_FILE);
  const to = join(dir, SNAPSHOT_RESTORED_FILE);
  try {
    if (existsSync(to)) unlinkSync(to);
    renameSync(from, to);
  } catch (e) {
    console.error('快照改名失败', e);
  }
}

/**
 * 快照器：负责把 RoomManager 的状态落盘。
 * 定期调用 saveIfDirty()；优雅退出时调用 save()。写盘失败只记日志，不影响服务。
 */
export class Snapshotter {
  /**
   * @param {object} opts
   * @param {import('./room/roomManager.js').RoomManager} opts.manager
   * @param {string|null} opts.dir 为 null 时不写盘（内存库）
   * @param {string} [opts.version]
   * @param {() => number} [opts.now]
   */
  constructor({ manager, dir, version = 'dev', now = Date.now }) {
    this.manager = manager;
    this.dir = dir;
    this.version = version;
    this.now = now;
    this.timer = null;
    this.lastSavedAt = null;
    this.restoredAt = null;
    this.restoredRooms = 0;
    this.writes = 0;
  }

  /** 无条件写一次快照；返回是否成功 */
  save() {
    if (!this.dir) return false;
    try {
      const snap = this.manager.toSnapshot({ version: this.version });
      this.manager.dirty = false; // 先清标记：写盘期间不会有别的代码插入（同步执行）
      writeSnapshotFile(this.dir, snap);
      this.lastSavedAt = snap.savedAt;
      this.writes++;
      return true;
    } catch (e) {
      this.manager.dirty = true;
      console.error('写快照失败', e);
      return false;
    }
  }

  /** 房间状态有变化才写盘 */
  saveIfDirty() {
    if (!this.manager.dirty) return false;
    return this.save();
  }

  start(intervalMs = SNAPSHOT_INTERVAL_MS) {
    if (this.timer || !this.dir) return;
    this.timer = setInterval(() => this.saveIfDirty(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 启动时尝试恢复。返回 { status, restored?, reason? } */
  restore() {
    if (!this.dir) return { status: 'none' };
    const r = readSnapshotFile(this.dir);
    if (r.status === 'none') return r;
    if (r.status === 'invalid') {
      console.error('快照文件无法解析，放弃恢复：', r.error?.message);
      return r;
    }
    let res;
    try {
      res = this.manager.restore(r.snapshot);
    } catch (e) {
      console.error('恢复快照出错，放弃恢复：', e);
      return { status: 'invalid', error: e };
    }
    if (!res.ok) {
      console.log(`快照未恢复：${res.reason}`);
      return { status: 'rejected', reason: res.reason };
    }
    markSnapshotRestored(this.dir);
    this.restoredAt = this.now();
    this.restoredRooms = res.restored;
    console.log(`已从快照恢复 ${res.restored} 个房间${res.failed ? `（${res.failed} 个失败）` : ''}`);
    return { status: 'restored', restored: res.restored, failed: res.failed };
  }

  status() {
    return { lastSavedAt: this.lastSavedAt, restoredAt: this.restoredAt, restoredRooms: this.restoredRooms };
  }
}
