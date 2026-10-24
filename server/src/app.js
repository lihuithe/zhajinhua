// 组装应用：数据库 + 账号 + 房间管理 + 系统设置 + HTTP + WebSocket + 快照
import http from 'node:http';
import { openDb } from './db.js';
import { Auth } from './auth.js';
import { AdminAuth } from './adminAuth.js';
import { RoomManager } from './room/roomManager.js';
import { WsHub } from './ws.js';
import { createHttpHandler } from './http.js';
import { createAdminHandler } from './admin.js';
import { SystemService } from './system.js';
import { Snapshotter, SNAPSHOT_INTERVAL_MS } from './snapshot.js';
import { loadVersion, DEFAULT_VERSION_FILE } from './version.js';

/**
 * @param {object} opts
 * @param {number} [opts.port] 0 表示随机端口
 * @param {string} [opts.host]
 * @param {string} opts.dataDir 数据库与快照目录（':memory:' 时数据库在内存、不写快照）
 * @param {string|null} [opts.staticDir] 静态文件目录，不存在时只提供 API
 * @param {object} [opts.timing] 覆盖房间时间参数（测试用）
 * @param {Function} [opts.rig] 测试用：指定发牌
 * @param {Function} [opts.randInt]
 * @param {number} [opts.heartbeatMs]
 * @param {number} [opts.deadMs]
 * @param {string} [opts.adminUsername] 管理员账号，默认 admin
 * @param {string} [opts.adminPassword] 管理员密码，默认 admin
 * @param {string} [opts.version] 覆盖版本号（默认读取 server/version.json，不存在为 dev）
 * @param {string} [opts.versionFile]
 * @param {boolean} [opts.restore] 启动时是否恢复快照，默认 true
 * @param {number} [opts.snapshotIntervalMs] 定期快照间隔，默认 20 秒
 */
export async function createApp({
  port = 3000,
  host = '0.0.0.0',
  dataDir,
  staticDir = null,
  timing,
  rig,
  randInt,
  heartbeatMs,
  deadMs,
  adminUsername = 'admin',
  adminPassword = 'admin',
  version,
  versionFile = DEFAULT_VERSION_FILE,
  restore = true,
  snapshotIntervalMs = SNAPSHOT_INTERVAL_MS,
} = {}) {
  const db = openDb(dataDir);
  const auth = new Auth(db);
  const adminAuth = new AdminAuth(db, { username: adminUsername, password: adminPassword });
  db.purgeExpiredTokens(Date.now());
  const startedAt = Date.now();
  const ver = version || loadVersion(versionFile);
  const system = new SystemService({ db, version: ver });
  const store = db.admin;

  let manager;
  const hub = new WsHub({ auth, getManager: () => manager, getSys: () => system.payload(), heartbeatMs, deadMs });
  system.broadcaster = (payload) => hub.broadcast({ type: 'sys', data: payload });

  manager = new RoomManager({
    send: (uid, msg) => hub.send(uid, msg),
    timing,
    rig,
    randInt,
    onSessionEnd: (room, summary, meta) => {
      db.saveSessionResult(room.code, room.config, summary, meta?.startedAt ?? null);
      store.roomSessionEnded(room.code, summary.endedAt);
    },
    hooks: {
      checkMaintenance: () => system.checkMaintenance(),
      onRoomCreated: (info) => store.roomCreated(info),
      onRoomRestored: (room) => {
        const owner = room.members.get(room.ownerId);
        store.roomRestored({ code: room.code, ownerId: room.ownerId, ownerNickname: owner ? owner.nickname : '', config: room.config, createdAt: room.createdAt });
      },
      onRoomDestroyed: (room) => store.roomDestroyed(room.code, Date.now()),
      onSeat: (room) => store.roomSeated(room.code, room.seatedCount, Date.now()),
      onHandEnd: (room, record) => store.recordHand(record),
    },
  });

  // 快照：内存库不写盘
  const snapshotDir = dataDir && dataDir !== ':memory:' ? dataDir : null;
  const snapshotter = new Snapshotter({ manager, dir: snapshotDir, version: ver });
  if (restore) snapshotter.restore();
  // 上次进程退出时没有带走的房间（崩溃、大更新）：开房记录标为已销毁
  store.closeOrphanRooms([...manager.rooms.keys()], Date.now());

  manager.startSweeper();
  system.start();
  snapshotter.start(snapshotIntervalMs);

  let closing = false;
  const adminHandler = createAdminHandler({ db, adminAuth, auth, manager, hub, system, snapshotter, startedAt, version: ver });
  const server = http.createServer(createHttpHandler({ auth, manager, hub, staticDir, system, adminHandler, isClosing: () => closing }));
  server.keepAliveTimeout = 30000;
  hub.attach(server);

  // 每小时清理一次过期 token
  const purge = setInterval(() => db.purgeExpiredTokens(Date.now()), 3600 * 1000);
  purge.unref?.();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  let closePromise = null;
  /**
   * 优雅关闭：停止接收新连接 → 写快照 → 以 1012 关闭所有 WebSocket → 释放资源。
   * afterSnapshot 在快照写完后立即调用（index.js 用它启动强制退出的兜底定时器）。
   */
  function close({ afterSnapshot } = {}) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      clearInterval(purge);
      snapshotter.stop();
      system.stop();
      hub.beginClose(); // 此后的请求一律拒绝，断线不再改房间状态
      const serverClosed = new Promise((resolve) => server.close(() => resolve())); // 停止接收新连接
      snapshotter.save();
      try {
        afterSnapshot?.();
      } catch (e) {
        console.error(e);
      }
      manager.close(); // 房间随快照保留，这里只释放定时器，不记录销毁
      await hub.closeAll(1012, 'restart');
      hub.close();
      server.closeAllConnections?.();
      await serverClosed;
      db.close();
    })();
    return closePromise;
  }

  return { server, port: server.address().port, db, auth, adminAuth, manager, hub, system, snapshotter, version: ver, close };
}
