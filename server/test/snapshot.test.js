// 快照与恢复：Room / HandGame / RoomManager 往返、时间平移、格式与过期检查、快照器写盘
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeManagerEnv, rigFrom, NO_BONUS_CARDS } from './helpers.js';
import { SNAPSHOT_FORMAT, Snapshotter, readSnapshotFile, SNAPSHOT_FILE, SNAPSHOT_RESTORED_FILE } from '../src/snapshot.js';

const CFG = { hands: 3, initialChips: 300, ante: 5, maxRounds: 5, actionSeconds: 10, nextHandSeconds: 5, settleSeconds: 5 };
const DELAY = 5000;

function newEnv(startAt) {
  const env = makeManagerEnv({ timing: { nextHandDelayMs: DELAY }, rig: rigFrom(NO_BONUS_CARDS) });
  if (startAt !== undefined) env.clock.t = startAt;
  return env;
}

/** 房主 u0、入座 u0/u1/u2、观战 u3，已开始第一场 */
function startedRoom(env) {
  const { manager } = env;
  const code = manager.createRoom('u0', CFG, 'N0');
  for (let i = 0; i < 4; i++) manager.join(`u${i}`, `N${i}`, code);
  for (let i = 0; i < 3; i++) manager.handle(`u${i}`, 'seat.sit', { seatIndex: i });
  for (let i = 1; i < 3; i++) manager.handle(`u${i}`, 'room.ready', { ready: true });
  manager.handle('u0', 'room.start');
  return manager.getRoom(code);
}

/** 当前行动者做一次动作 */
function turnUser(room) {
  const g = room.game;
  return g.order[g.pos].userId;
}
function act(room, kind) {
  const uid = turnUser(room);
  const a = room.viewFor(uid).hand.actions;
  if (kind === 'raise') room.handle(uid, 'game.raise', { to: a.raise[0].to });
  else room.handle(uid, `game.${kind}`);
  return uid;
}

/** 打到局中：u1 看牌加注，u2 跟，u0 跟；第 2 轮 u1 比牌 u2；轮到 u0 */
function playToMidHand(room) {
  room.handle('u1', 'game.look');
  assert.equal(turnUser(room), 'u1');
  act(room, 'raise');
  act(room, 'call');
  act(room, 'call');
  assert.equal(turnUser(room), 'u1');
  room.handle('u1', 'game.compare', { targetSeat: 2 }); // Q 大于 10：u2 输，u1 看到 u2 的牌
  room.handle('u0', 'chat.send', { kind: 'text', text: '快点' });
  assert.equal(turnUser(room), 'u0');
  assert.equal(room.game.ended, false);
}

function snapshotOf(env) {
  return JSON.parse(JSON.stringify(env.manager.toSnapshot({ version: 'v-test' })));
}

/** 去掉随时间 / 在线状态变化的字段，便于比较 */
function normalize(view) {
  const v = JSON.parse(JSON.stringify(view));
  delete v.serverTime;
  delete v.nextHandAt;
  if (v.hand) delete v.hand.turnDeadline;
  for (const s of v.seats) if (s) s.online = false;
  for (const s of v.spectators) s.online = false;
  return v;
}

function assertSameViews(a, b, uids) {
  for (const uid of uids) assert.deepEqual(normalize(b.viewFor(uid)), normalize(a.viewFor(uid)), `成员 ${uid} 的视图应一致`);
}

/** 把当前这一场打完（所有人只跟注），推进时间直到进入 finished */
function finishSession(env, room) {
  let guard = 0;
  while (room.phase === 'playing' && guard++ < 200) {
    if (room.game && !room.game.ended) {
      const uid = turnUser(room);
      const a = room.viewFor(uid).hand.actions;
      if (a.call) room.handle(uid, 'game.call');
      else room.handle(uid, 'game.fold');
    } else {
      env.clock.t += DELAY;
      room.tick();
    }
  }
  assert.equal(room.phase, 'finished');
}

test('快照往返：局中状态（看牌 / 比牌 / 加注 / 聊天）恢复后每个成员的视图一致', () => {
  const env1 = newEnv();
  const room1 = startedRoom(env1);
  playToMidHand(room1);
  const snap = snapshotOf(env1);
  assert.equal(snap.formatVersion, SNAPSHOT_FORMAT);
  assert.equal(snap.version, 'v-test');
  assert.equal(snap.rooms.length, 1);

  const SHIFT = 90_000;
  const env2 = newEnv(env1.clock.t + SHIFT);
  const res = env2.manager.restore(snap);
  assert.deepEqual({ ok: res.ok, restored: res.restored, failed: res.failed, shiftMs: res.shiftMs }, { ok: true, restored: 1, failed: 0, shiftMs: SHIFT });
  const room2 = env2.manager.getRoom(room1.code);
  assert.ok(room2 && room2 !== room1);

  assertSameViews(room1, room2, ['u0', 'u1', 'u2', 'u3', 'stranger']);
  // 已看牌的人仍能看到自己的牌；比牌赢家看到输家的牌；闷牌的 u0 看不到
  assert.ok(room2.viewFor('u1').hand.myCards);
  assert.equal(room2.viewFor('u1').hand.visible.length, 1);
  assert.equal(room2.viewFor('u0').hand.myCards, null);
  assert.equal(room2.chat.length, 1);

  // 所有成员离线，userRoom 重建
  for (const m of room2.members.values()) assert.equal(m.online, false);
  for (const uid of ['u0', 'u1', 'u2', 'u3']) assert.equal(env2.manager.roomOf(uid), room2);
  assert.equal(env2.manager.roomOf('nobody'), null);
  // 离线计时从恢复时刻起算
  assert.equal(room2.members.get('u1').offlineSince, env2.clock.t);
  assert.equal(room2.emptySince, env2.clock.t);
  // 定时器已重新安排
  assert.ok(env2.timers.size >= 1);
  // 快照不应对原房间有副作用
  assert.equal(room1.game.ended, false);
});

test('时间平移：turnDeadline 与 nextHandAt 整体后移停机时长，其余时间不变', () => {
  const env1 = newEnv();
  const room1 = startedRoom(env1);
  playToMidHand(room1);
  const deadline = room1.game.turnDeadline;
  const log = room1.viewFor('u0').hand.log;
  const SHIFT = 123_456;
  const env2 = newEnv(env1.clock.t + SHIFT);
  env2.manager.restore(snapshotOf(env1));
  const room2 = env2.manager.getRoom(room1.code);
  assert.equal(room2.game.turnDeadline, deadline + SHIFT);
  assert.equal(room2.createdAt, room1.createdAt);
  assert.deepEqual(room2.viewFor('u0').hand.log, log, '日志时间不平移');
  // 剩余思考时间不变
  assert.equal(room2.game.turnDeadline - env2.clock.t, deadline - env1.clock.t);

  // 局间：nextHandAt 平移
  const env3 = newEnv();
  const room3 = startedRoom(env3);
  room3.handle('u1', 'game.fold');
  room3.handle('u2', 'game.fold');
  assert.equal(room3.game.ended, true);
  const next = room3.nextHandAt;
  assert.ok(next);
  const env4 = newEnv(env3.clock.t + 1000);
  env4.manager.restore(snapshotOf(env3));
  const room4 = env4.manager.getRoom(room3.code);
  assert.equal(room4.nextHandAt, next + 1000);
  assert.equal(room4.game.turnDeadline, null);
  assertSameViews(room3, room4, ['u0', 'u1', 'u2', 'u3']);
});

test('恢复后可继续打完这一局和这一场，并可开下一场', () => {
  const env1 = newEnv();
  const room1 = startedRoom(env1);
  playToMidHand(room1);
  const env2 = newEnv(env1.clock.t + 60_000);
  env2.manager.restore(snapshotOf(env1));
  const room2 = env2.manager.getRoom(room1.code);

  // 客户端重连
  for (const uid of ['u0', 'u1', 'u2', 'u3']) env2.manager.onConnect(uid);
  assert.equal(room2.onlineCount(), 4);
  const r = env2.manager.join('u0', 'N0', room2.code);
  assert.equal(r.chat.length, 1);

  // u0（闷牌，轮到它）可以看牌并操作
  room2.handle('u0', 'game.look');
  assert.ok(room2.viewFor('u0').hand.myCards);
  assert.equal(turnUser(room2), 'u0');
  const sessionEnds = [];
  room2.deps.onSessionEnd = (_r, s) => sessionEnds.push(s);
  finishSession(env2, room2);
  assert.equal(room2.phase, 'finished');
  assert.equal(room2.summary.sessionNo, 1);
  assert.equal(room2.summary.handsPlayed, 3);
  assert.equal(sessionEnds.length, 1);
  // 积分守恒
  const sum = room2.summary.players.reduce((n, p) => n + p.finalChips, 0);
  assert.equal(sum, 3 * 300);

  // 结算态再做一次快照往返，并继续下一场
  const env3 = newEnv(env2.clock.t + 5000);
  env3.manager.restore(snapshotOf(env2));
  const room3 = env3.manager.getRoom(room1.code);
  assertSameViews(room2, room3, ['u0', 'u1', 'u2', 'u3']);
  env3.manager.onConnect('u0');
  room3.handle('u0', 'room.restart');
  assert.equal(room3.phase, 'waiting');
  assert.equal(room3.sessionNo, 2);
  for (const uid of ['u1', 'u2']) room3.handle(uid, 'room.ready', { ready: true });
  room3.handle('u0', 'room.start');
  assert.equal(room3.phase, 'playing');
  assert.equal(room3.totals.size, 3);
});

test('恢复后行动超时仍按剩余时间触发（定时器重建）', () => {
  const env1 = newEnv();
  const room1 = startedRoom(env1);
  const first = turnUser(room1);
  env1.clock.t += 4000; // 已经用掉 4 秒
  const env2 = newEnv(env1.clock.t + 30_000);
  env2.manager.restore(snapshotOf(env1));
  const room2 = env2.manager.getRoom(room1.code);
  const remain = room2.game.turnDeadline - env2.clock.t;
  assert.equal(remain, 6000);
  env2.clock.t += remain - 1;
  room2.tick();
  assert.equal(turnUser(room2), first, '还没到点');
  env2.clock.t += 1;
  room2.tick();
  assert.notEqual(turnUser(room2), first, '到点后自动弃牌，轮到下一位');
});

test('对局中离开的待清理成员、被踢名单、等下一局入座者都能往返', () => {
  const env1 = newEnv();
  const { manager } = env1;
  const code = manager.createRoom('u0', CFG, 'N0');
  for (let i = 0; i < 5; i++) manager.join(`u${i}`, `N${i}`, code);
  const room = manager.getRoom(code);
  for (let i = 0; i < 3; i++) manager.handle(`u${i}`, 'seat.sit', { seatIndex: i });
  for (let i = 1; i < 3; i++) manager.handle(`u${i}`, 'room.ready', { ready: true });
  manager.handle('u0', 'room.kick', { userId: 'u4', ban: true });
  manager.handle('u0', 'room.start');
  manager.handle('u3', 'seat.sit', { seatIndex: 5 }); // 局中入座，等下一局
  room.handle('u2', 'room.leave'); // 对局中离开：座位保留到本局结束
  const env2 = newEnv(env1.clock.t + 1000);
  env2.manager.restore(snapshotOf(env1));
  const room2 = env2.manager.getRoom(code);
  assert.ok(room2.banned.has('u4'));
  assert.equal(room2.members.get('u2').pendingLeave, true);
  assert.equal(env2.manager.roomOf('u2'), null, '待清理成员不再属于该房间');
  assert.equal(room2.viewFor('u3').seats[5].status, 'waitingNext');
  assertSameViews(room, room2, ['u0', 'u1', 'u3']);
  assert.throws(() => env2.manager.join('u4', 'N4', code), (e) => e.code === 'BANNED');
});

test('格式版本不一致 / 已过期 / 结构不对：放弃恢复且不改动任何状态', () => {
  const env1 = newEnv();
  startedRoom(env1);
  const snap = snapshotOf(env1);

  const wrongFormat = { ...snap, formatVersion: SNAPSHOT_FORMAT + 1 };
  const e1 = newEnv(env1.clock.t + 1000);
  const r1 = e1.manager.restore(wrongFormat);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /格式版本/);
  assert.equal(e1.manager.rooms.size, 0);
  assert.equal(e1.manager.restore({ ...snap, formatVersion: undefined }).ok, false);

  const e2 = newEnv(env1.clock.t + 31 * 60 * 1000);
  const r2 = e2.manager.restore(snap);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /过期/);
  assert.equal(e2.manager.rooms.size, 0);
  // 30 分钟以内可以恢复
  const e3 = newEnv(env1.clock.t + 29 * 60 * 1000);
  assert.equal(e3.manager.restore(snap).ok, true);

  assert.equal(newEnv().manager.restore(null).ok, false);
  assert.equal(newEnv().manager.restore({ formatVersion: SNAPSHOT_FORMAT, rooms: 'x' }).ok, false);
});

test('单个房间数据损坏只跳过该房间，其余照常恢复', () => {
  const env1 = newEnv();
  const a = startedRoom(env1);
  const code2 = env1.manager.createRoom('u9', CFG, 'N9');
  env1.manager.join('u9', 'N9', code2);
  const snap = snapshotOf(env1);
  snap.rooms.find((r) => r.code === a.code).seats[0].userId = 'ghost'; // 座位与成员不一致
  const env2 = newEnv(env1.clock.t + 1000);
  const res = env2.manager.restore(snap);
  assert.deepEqual({ ok: res.ok, restored: res.restored, failed: res.failed }, { ok: true, restored: 1, failed: 1 });
  assert.equal(env2.manager.getRoom(a.code), null);
  assert.ok(env2.manager.getRoom(code2));
  assert.equal(env2.manager.roomOf('u9').code, code2);
});

test('恢复的房间无人回来：按“无人销毁”规则从恢复时刻起算', () => {
  const env1 = newEnv();
  const room1 = startedRoom(env1);
  const env2 = newEnv(env1.clock.t + 1000);
  env2.manager.restore(snapshotOf(env1));
  env2.clock.t += 29 * 60 * 1000;
  env2.manager.sweep();
  assert.ok(env2.manager.getRoom(room1.code));
  env2.clock.t += 61 * 1000;
  env2.manager.sweep();
  assert.equal(env2.manager.getRoom(room1.code), null);
});

test('manager.close() 不记录销毁；destroyRoom 会通知 onRoomDestroyed', () => {
  const destroyed = [];
  const env = makeManagerEnv();
  env.manager.hooks.onRoomDestroyed = (room, reason) => destroyed.push([room.code, reason]);
  const c1 = env.manager.createRoom('u0', CFG);
  const c2 = env.manager.createRoom('u1', CFG);
  env.manager.destroyRoom(c1, 'dissolved');
  assert.deepEqual(destroyed, [[c1, 'dissolved']]);
  env.manager.close();
  assert.deepEqual(destroyed, [[c1, 'dissolved']], '关闭进程不算销毁');
  assert.equal(env.manager.rooms.size, 0);
  assert.ok(c2);
});

// ---------------------------------------------------------------- 快照器 / 文件

test('快照器：没有变化不写盘；原子写入不留临时文件；恢复后改名 .restored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-snap-'));
  try {
    const env = newEnv();
    const sn = new Snapshotter({ manager: env.manager, dir, version: 'v1', now: () => env.clock.t });
    assert.equal(sn.saveIfDirty(), false, '没有任何变化');
    assert.equal(existsSync(join(dir, SNAPSHOT_FILE)), false);

    const room = startedRoom(env);
    assert.equal(env.manager.dirty, true);
    assert.equal(sn.saveIfDirty(), true);
    assert.equal(env.manager.dirty, false);
    assert.equal(sn.saveIfDirty(), false, '写过之后没有新变化');
    assert.equal(sn.writes, 1);
    assert.deepEqual(readdirSync(dir), [SNAPSHOT_FILE]);

    // 房间状态变化（操作、聊天）会重新置脏
    room.handle('u1', 'game.look');
    assert.equal(sn.saveIfDirty(), true);
    env.clock.t += 1000;
    room.handle('u0', 'chat.send', { kind: 'text', text: 'hi' });
    assert.equal(sn.saveIfDirty(), true);
    assert.equal(sn.saveIfDirty(), false);
    assert.equal(sn.writes, 3);
    assert.equal(sn.status().lastSavedAt, env.clock.t);

    // 无条件保存（关闭时）
    assert.equal(sn.save(), true);
    assert.equal(sn.writes, 4);

    // 新进程恢复
    const env2 = newEnv(env.clock.t + 2000);
    const sn2 = new Snapshotter({ manager: env2.manager, dir, now: () => env2.clock.t });
    const r = sn2.restore();
    assert.equal(r.status, 'restored');
    assert.equal(r.restored, 1);
    assert.deepEqual(readdirSync(dir).sort(), [SNAPSHOT_RESTORED_FILE]);
    assert.equal(sn2.status().restoredRooms, 1);
    assert.equal(sn2.status().restoredAt, env2.clock.t);
    assert.equal(env2.manager.dirty, true, '恢复后应尽快重新写一份快照');
    // 下次启动不会再读
    assert.equal(new Snapshotter({ manager: newEnv().manager, dir }).restore().status, 'none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('快照文件解析失败 / 格式不对：只记日志，不抛错，不改名', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-snap-'));
  try {
    const file = join(dir, SNAPSHOT_FILE);
    writeFileSync(file, '{ 这不是 json');
    assert.equal(readSnapshotFile(dir).status, 'invalid');
    const env = newEnv();
    const sn = new Snapshotter({ manager: env.manager, dir });
    assert.equal(sn.restore().status, 'invalid');
    assert.equal(existsSync(file), true);
    assert.equal(env.manager.rooms.size, 0);

    // 格式版本不同
    const env1 = newEnv();
    startedRoom(env1);
    writeFileSync(file, JSON.stringify({ ...snapshotOf(env1), formatVersion: SNAPSHOT_FORMAT + 5 }));
    const env2 = newEnv(env1.clock.t + 1000);
    assert.equal(new Snapshotter({ manager: env2.manager, dir }).restore().status, 'rejected');
    assert.equal(env2.manager.rooms.size, 0);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).formatVersion, SNAPSHOT_FORMAT + 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('快照器：dir 为 null 时不写盘', () => {
  const env = newEnv();
  startedRoom(env);
  const sn = new Snapshotter({ manager: env.manager, dir: null });
  assert.equal(sn.save(), false);
  assert.equal(sn.restore().status, 'none');
});

test('旧版本快照缺少后来新增的配置项（rebuyMax）：恢复时用默认值补齐', async () => {
  const { makeEnv } = await import('./helpers.js');
  const { Room } = await import('../src/room/room.js');
  const env = makeEnv();
  env.seatPlayers(2);
  const snap = JSON.parse(JSON.stringify(env.room.toSnapshot()));
  delete snap.config.rebuyMax;
  const r = Room.fromSnapshot(snap, env.deps);
  assert.equal(r.config.rebuyMax, 0);
  assert.equal(r.viewFor('u0').config.rebuyMax, 0);
});
