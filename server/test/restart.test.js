// 不停服热更新：优雅关闭写快照、ws 以 1012 关闭、同一 DATA_DIR 重启后恢复房间并继续打完
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, createRoom, joinAndSit, sleep, playOut, SMALL } from './serverHelpers.js';
import { rigFrom, NO_BONUS_CARDS } from './helpers.js';
import { SNAPSHOT_FILE, SNAPSHOT_RESTORED_FILE, SNAPSHOT_FORMAT } from '../src/snapshot.js';

const APP = { rig: rigFrom(NO_BONUS_CARDS), randInt: () => 0 };

test('优雅关闭 → 重启：ws 收到 1012，房间 / 牌局 / 已看过的牌恢复，客户端重连后继续打完', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-restart-'));
  let srv = await startServer({ dir, appOpts: APP });
  let srv2 = null;
  try {
    const [a, b, c] = [await srv.register('alice'), await srv.register('bobby'), await srv.register('carol')];
    const code = await createRoom(srv, a);
    const [ca, cb, cc] = [await srv.connect(a), await srv.connect(b), await srv.connect(c)];
    await joinAndSit(ca, code, 0);
    await joinAndSit(cb, code, 1);
    await joinAndSit(cc, code, 2);
    await cb.ok('room.ready', { ready: true });
    await cc.ok('room.ready', { ready: true });
    await ca.ok('room.start');
    // 庄家 0 号位，行动顺序 1、2、0：bobby 看牌并加注
    await cb.waitState((s) => s.hand && s.hand.turnSeat === 1, '轮到 bobby');
    await cb.ok('game.look');
    await cb.ok('game.raise', { to: 10 });
    await cc.waitState((s) => s.hand.turnSeat === 2 && s.hand.currentBet === 10, '轮到 carol');
    await ca.ok('chat.send', { kind: 'text', text: '更新前的聊天' });
    const before = cb.state;
    assert.ok(before.hand.myCards, 'bobby 已看牌');
    const seenCards = before.hand.myCards;

    // 优雅关闭（不能提前 terminate 客户端，要让它们收到 1012）
    const closes = [ca, cb, cc].map((x) => x.closed);
    await srv.app.close();
    const infos = await Promise.all(closes);
    for (const i of infos) assert.equal(i.code, 1012, '服务端重启关闭码应为 1012');
    assert.ok(existsSync(join(dir, SNAPSHOT_FILE)), '关闭时应写出快照');
    assert.ok(!existsSync(join(dir, SNAPSHOT_FILE + '.tmp')));
    const snap = JSON.parse(readFileSync(join(dir, SNAPSHOT_FILE), 'utf8'));
    assert.equal(snap.formatVersion, SNAPSHOT_FORMAT);
    assert.equal(snap.version, 'test-1');
    assert.equal(snap.rooms.length, 1);

    // 同一 DATA_DIR 再启动
    srv2 = await startServer({ dir, appOpts: APP });
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('rooms-snapshot')), [SNAPSHOT_RESTORED_FILE]);
    assert.equal(srv2.app.snapshotter.status().restoredRooms, 1);
    assert.equal(srv2.app.manager.rooms.size, 1);
    // 开房记录没有被标为已销毁
    assert.equal(srv2.app.db.admin.getRoomRecord(code).destroyed_at, null);
    // 重启后房间里没有人在线
    assert.equal(srv2.app.manager.getRoom(code).onlineCount(), 0);

    const [ca2, cb2, cc2] = [await srv2.connect(a), await srv2.connect(b), await srv2.connect(c)];
    const joined = await cb2.ok('room.join', { code });
    assert.equal(joined.chat.length, 1);
    assert.equal(joined.chat[0].text, '更新前的聊天');
    await ca2.ok('room.join', { code });
    await cc2.ok('room.join', { code });
    const s = await cb2.waitState((st) => st.code === code, '收到房间状态');
    assert.equal(s.phase, 'playing');
    assert.equal(s.hand.handNo, 1);
    assert.deepEqual(s.hand.myCards, seenCards, '已看过的牌仍可见');
    assert.equal(s.hand.currentBet, 10);
    assert.equal(s.hand.turnSeat, 2, '仍然轮到 carol');
    assert.ok(s.hand.turnDeadline > Date.now(), '行动期限已顺延');
    assert.ok(s.hand.players.find((p) => p.userId === b.user.userId).seen);
    assert.equal(ca2.state.hand.myCards, null, '没看牌的人仍然看不到牌');
    assert.ok(s.seats.every((x, i) => i > 2 || x === null || x.online), '重新连接后成员在线');

    // 继续打完这一场
    await playOut([ca2, cb2, cc2]);
    const fin = ca2.state;
    assert.equal(fin.summary.handsPlayed, 3);
    assert.equal(fin.summary.players.reduce((n, p) => n + p.finalChips, 0), 900);
    // 开房记录：整场只算一场，局数正确
    const rec = srv2.app.db.admin.getRoomRecord(code);
    assert.equal(rec.sessions_played, 1);
    assert.equal(rec.hands_played, 3);
  } finally {
    for (const x of [srv, srv2]) if (x) await x.stop({ keepDir: true }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test('快照格式不一致：放弃恢复，服务正常启动，开房记录标为已销毁', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-restart-'));
  let srv = await startServer({ dir });
  let srv2 = null;
  try {
    const a = await srv.register('alice');
    const code = await createRoom(srv, a);
    await srv.app.close();
    const file = join(dir, SNAPSHOT_FILE);
    const snap = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(snap.rooms.length, 1);
    snap.formatVersion = SNAPSHOT_FORMAT + 1;
    writeFileSync(file, JSON.stringify(snap));

    srv2 = await startServer({ dir });
    assert.equal(srv2.app.manager.rooms.size, 0);
    assert.equal(srv2.app.snapshotter.status().restoredRooms, 0);
    assert.equal(typeof srv2.app.db.admin.getRoomRecord(code).destroyed_at, 'number', '没带走的房间记录应标为已销毁');
    const r = await srv2.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'pass1234' } });
    assert.equal(r.ok, true);
  } finally {
    for (const x of [srv, srv2]) if (x) await x.stop({ keepDir: true }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restore: false（大更新 / --fresh）：不恢复快照', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-restart-'));
  let srv = await startServer({ dir });
  let srv2 = null;
  try {
    const a = await srv.register('alice');
    await createRoom(srv, a);
    await srv.app.close();
    srv2 = await startServer({ dir, appOpts: { restore: false } });
    assert.equal(srv2.app.manager.rooms.size, 0);
    assert.ok(existsSync(join(dir, SNAPSHOT_FILE)), '未恢复时不动旧快照文件');
  } finally {
    for (const x of [srv, srv2]) if (x) await x.stop({ keepDir: true }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test('定期快照：有变化才写，没有变化不写盘；崩溃后能从最近一次快照恢复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-restart-'));
  const srv = await startServer({ dir, appOpts: { snapshotIntervalMs: 25 } });
  let srv2 = null;
  try {
    const sn = srv.app.snapshotter;
    await sleep(100);
    assert.equal(sn.writes, 0, '没有房间变化，不应写盘');
    assert.equal(existsSync(join(dir, SNAPSHOT_FILE)), false);

    const a = await srv.register('alice');
    const code = await createRoom(srv, a);
    for (let i = 0; i < 50 && sn.writes === 0; i++) await sleep(20);
    assert.equal(sn.writes, 1);
    await sleep(120);
    assert.equal(sn.writes, 1, '之后没有变化，不再写盘');

    const ca = await srv.connect(a);
    await joinAndSit(ca, code, 0); // 进入 / 入座都是房间变化
    for (let i = 0; i < 50 && sn.writes < 2; i++) await sleep(20);
    assert.ok(sn.writes >= 2);
    const w = sn.writes;
    await sleep(120);
    assert.ok(sn.writes <= w + 1, '在线状态不变时不会持续写盘');

    // 模拟崩溃：不走优雅关闭，直接复制当前快照给新进程（同一目录下另起实例前需释放端口，这里用复制）
    const copyDir = mkdtempSync(join(tmpdir(), 'zjh-restart-copy-'));
    writeFileSync(join(copyDir, SNAPSHOT_FILE), readFileSync(join(dir, SNAPSHOT_FILE)));
    srv2 = await startServer({ dir: copyDir });
    const room = srv2.app.manager.getRoom(code);
    assert.ok(room, '崩溃后可从最近一次快照恢复');
    assert.equal(room.seatedCount, 1);
    await srv2.stop({ keepDir: true });
    rmSync(copyDir, { recursive: true, force: true });
    srv2 = null;
  } finally {
    await srv.stop();
    if (srv2) await srv2.stop({ keepDir: true }).catch(() => {});
  }
});

test('关闭流程：HTTP 停止新请求，关闭后进入的 ws 操作被拒绝', async () => {
  const srv = await startServer({ appOpts: APP });
  try {
    const a = await srv.register('alice');
    const code = await createRoom(srv, a);
    const ca = await srv.connect(a);
    await joinAndSit(ca, code, 0);
    srv.app.hub.beginClose();
    const r = await ca.req('seat.stand');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'SERVER_RESTARTING');
    assert.equal(SMALL.hands, 3);
  } finally {
    await srv.stop();
  }
});
