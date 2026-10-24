// 管理后台：鉴权、各查询接口、对局记录写入、实时详情无牌面、封禁 / 重置密码、解散房间
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createRoom, joinAndSit, playOut, sleep, SMALL } from './serverHelpers.js';
import { rigFrom, NO_BONUS_CARDS } from './helpers.js';
import { openDb } from '../src/db.js';

const APP = { rig: rigFrom(NO_BONUS_CARDS), randInt: () => 0 };

/** 第一个账号为房主；所有人连接、入座（座位 = 序号）并准备，返回客户端与房间号 */
async function setupRoom(srv, names, cfg = SMALL) {
  const accounts = [];
  for (const n of names) accounts.push(await srv.register(n));
  const code = await createRoom(srv, accounts[0], cfg);
  const clients = [];
  for (let i = 0; i < accounts.length; i++) {
    const c = await srv.connect(accounts[i]);
    await joinAndSit(c, code, i);
    if (i > 0) await c.ok('room.ready', { ready: true });
    clients.push(c);
  }
  return { accounts, clients, code };
}

// ---------------------------------------------------------------- 鉴权

test('管理员鉴权：登录 / 无 token / 玩家 token / 退出 / 过期', async () => {
  const srv = await startServer();
  try {
    let r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'boss', password: 'wrong' } });
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'BAD_CREDENTIALS');
    r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'nobody', password: 'secret-pass' } });
    assert.equal(r.status, 401);
    r = await srv.api('/api/admin/login', { method: 'POST', body: {} });
    assert.equal(r.status, 401);

    r = await srv.api('/api/admin/overview');
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'UNAUTHORIZED');
    r = await srv.api('/api/admin/nope', { token: 'x'.repeat(64) });
    assert.equal(r.status, 401, '未登录时不暴露接口是否存在');

    // 玩家 token 不能访问后台
    const u = await srv.register('alice');
    r = await srv.api('/api/admin/overview', { token: u.token });
    assert.equal(r.status, 401);

    r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'boss', password: 'secret-pass' } });
    assert.equal(r.status, 200);
    assert.match(r.token, /^[0-9a-f]{64}$/);
    const token = r.token;
    r = await srv.api('/api/admin/overview', { token });
    assert.equal(r.status, 200);
    // 管理员 token 不能当玩家 token 用
    r = await srv.api('/api/me', { token });
    assert.equal(r.status, 401);
    r = await srv.api('/api/admin/nope', { token });
    assert.equal(r.status, 404);
    assert.equal(r.error.code, 'NOT_FOUND');

    // token 有效期 7 天
    const row = srv.app.db.raw.prepare('SELECT * FROM admin_tokens WHERE token = ?').get(token);
    assert.equal(row.expires_at - row.created_at, 7 * 24 * 3600 * 1000);

    r = await srv.api('/api/admin/logout', { method: 'POST', token });
    assert.equal(r.status, 200);
    r = await srv.api('/api/admin/overview', { token });
    assert.equal(r.status, 401);

    // 过期
    const t2 = await srv.adminLogin();
    const real = srv.app.adminAuth.now;
    srv.app.adminAuth.now = () => real() + 8 * 24 * 3600 * 1000;
    r = await srv.api('/api/admin/overview', { token: t2 });
    assert.equal(r.status, 401);
    srv.app.adminAuth.now = real;
  } finally {
    await srv.stop();
  }
});

test('管理员登录：默认 admin/admin；连续失败过多后限制尝试', async () => {
  const srv = await startServer({ appOpts: { adminUsername: 'admin', adminPassword: 'admin' } });
  try {
    assert.equal(srv.app.adminAuth.isDefaultCredential, true);
    for (let i = 0; i < 10; i++) {
      const r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'bad' + i } });
      assert.equal(r.status, 401);
    }
    let r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin' } });
    assert.equal(r.status, 429);
    assert.equal(r.error.code, 'TOO_MANY_ATTEMPTS');
    // 过了窗口期恢复
    const real = srv.app.adminAuth.now;
    srv.app.adminAuth.now = () => real() + 11 * 60 * 1000;
    r = await srv.api('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin' } });
    assert.equal(r.status, 200);
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- 记录写入与查询

test('一整场之后：开房记录 / 对局记录 / 场次 / 用户统计 / 概览，以及各列表的筛选与分页', async () => {
  const srv = await startServer({ appOpts: APP });
  try {
    const { accounts, clients, code } = await setupRoom(srv, ['alice', 'bobby', 'carol']);
    const [a, b, c] = accounts;
    const t0 = Date.now();
    await clients[0].ok('room.start');
    await playOut(clients);
    const db = srv.app.db;

    // ---- 数据库内容
    const rec = db.admin.getRoomRecord(code);
    assert.equal(rec.owner_id, a.user.userId);
    assert.equal(rec.owner_nickname, 'alice');
    assert.equal(JSON.parse(rec.config_json).hands, 3);
    assert.equal(rec.sessions_played, 1);
    assert.equal(rec.hands_played, 3);
    assert.equal(rec.peak_seated, 3);
    assert.equal(rec.destroyed_at, null);
    assert.ok(rec.last_active_at >= t0);
    assert.ok(rec.created_at <= t0);

    const hands = db.raw.prepare('SELECT * FROM hand_records ORDER BY hand_no').all();
    assert.equal(hands.length, 3);
    hands.forEach((h, i) => {
      assert.equal(h.room_code, code);
      assert.equal(h.session_no, 1);
      assert.equal(h.hand_no, i + 1);
      assert.equal(h.reason, 'showdown');
      assert.ok(h.started_at <= h.ended_at);
      const players = JSON.parse(h.players_json);
      assert.equal(players.length, 3);
      assert.deepEqual(players.map((p) => p.seatIndex), [0, 1, 2]);
      for (const p of players) {
        assert.equal(p.cards.length, 3);
        assert.ok(p.cards.every((x) => Number.isInteger(x.r) && 'shdc'.includes(x.s)));
        assert.equal(p.type, 'sanpai');
        assert.match(p.label, /^单张 /);
        assert.equal(p.is235, false);
        assert.equal(p.seen, false);
        assert.equal(p.allIn, false);
        assert.ok(p.bet > 0);
      }
      assert.deepEqual(players.map((p) => p.state), ['won', 'lost', 'lost']);
      assert.equal(players.reduce((n, p) => n + p.delta, 0), 0, '净变化之和为 0');
      assert.equal(players[0].delta, -(players[1].delta + players[2].delta));
      assert.equal(players[0].label, '单张 A');
      assert.equal(h.pot, players.reduce((n, p) => n + p.bet, 0));
      assert.deepEqual(JSON.parse(h.winners_json), { seats: [0], userIds: [a.user.userId], names: ['alice'] });
      const log = JSON.parse(h.log_json);
      assert.equal(log[0].kind, 'ante');
      assert.equal(log.at(-1).kind, 'win');
      assert.ok(log.every((l) => typeof l.text === 'string' && typeof l.t === 'number'));
    });
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM hand_players').get().n, 9);
    const sess = db.raw.prepare('SELECT * FROM session_results').get();
    assert.ok(sess.started_at >= t0 - 5000 && sess.started_at <= sess.ended_at, 'started_at 已记录');

    // ---- 接口：对局列表
    let r = await srv.admin(`/api/admin/hands?room=${code}`);
    assert.equal(r.status, 200);
    assert.equal(r.total, 3);
    assert.equal(r.page, 1);
    assert.equal(r.size, 20);
    assert.deepEqual(r.items.map((x) => x.handNo), [3, 2, 1], '按结束时间降序');
    const item = r.items[0];
    assert.deepEqual(Object.keys(item).sort(), ['endedAt', 'handNo', 'id', 'playerCount', 'pot', 'reason', 'roomCode', 'sessionNo', 'startedAt', 'winners'].sort());
    assert.deepEqual(item.winners, ['alice']);
    assert.equal(item.playerCount, 3);
    assert.equal(item.roomCode, code);

    r = await srv.admin(`/api/admin/hands?room=${code}&session=1`);
    assert.equal(r.total, 3);
    r = await srv.admin(`/api/admin/hands?room=${code}&session=2`);
    assert.equal(r.total, 0);
    r = await srv.admin('/api/admin/hands?session=1');
    assert.equal(r.status, 400);
    r = await srv.admin(`/api/admin/hands?user=${b.user.userId}`);
    assert.equal(r.total, 3);
    r = await srv.admin('/api/admin/hands?user=nobody');
    assert.equal(r.total, 0);
    r = await srv.admin('/api/admin/hands?room=ZZZZ9999');
    assert.equal(r.total, 0);
    r = await srv.admin(`/api/admin/hands?room=${code}&size=2&page=2`);
    assert.equal(r.total, 3);
    assert.equal(r.page, 2);
    assert.equal(r.size, 2);
    assert.deepEqual(r.items.map((x) => x.handNo), [1]);
    r = await srv.admin('/api/admin/hands?size=1000');
    assert.equal(r.size, 100, 'size 最大 100');
    for (const bad of ['page=0', 'page=abc', 'size=-1', 'size=1.5']) {
      r = await srv.admin(`/api/admin/hands?${bad}`);
      assert.equal(r.status, 400, bad);
    }

    // ---- 接口：对局详情
    const id = item.id;
    r = await srv.admin(`/api/admin/hands/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.hand.id, id);
    assert.equal(r.hand.players.length, 3);
    assert.equal(r.hand.players[0].nickname, 'alice');
    assert.equal(r.hand.players[0].cards.length, 3);
    assert.deepEqual(r.hand.winnerSeats, [0]);
    assert.ok(r.hand.log.length > 3);
    assert.deepEqual(r.hand.winners, ['alice']);
    r = await srv.admin('/api/admin/hands/999999');
    assert.equal(r.status, 404);
    r = await srv.admin('/api/admin/hands/abc');
    assert.equal(r.status, 404);

    // ---- 接口：场次
    r = await srv.admin(`/api/admin/sessions?room=${code}`);
    assert.equal(r.total, 1);
    const s = r.items[0];
    assert.equal(s.roomCode, code);
    assert.equal(s.sessionNo, 1);
    assert.equal(s.handsPlayed, 3);
    assert.equal(typeof s.startedAt, 'number');
    assert.equal(s.players.length, 3);
    assert.equal(s.players.reduce((n, p) => n + p.net, 0), 0);
    assert.deepEqual(Object.keys(s.players[0]).sort(), ['bestType', 'finalChips', 'net', 'nickname', 'userId', 'wins']);
    r = await srv.admin(`/api/admin/sessions?user=${c.user.userId}`);
    assert.equal(r.total, 1);
    r = await srv.admin('/api/admin/sessions?user=nobody');
    assert.equal(r.total, 0);

    // ---- 接口：房间
    r = await srv.admin('/api/admin/rooms?status=all&q=ALI');
    assert.equal(r.total, 1);
    const room = r.items[0];
    assert.equal(room.code, code);
    assert.equal(room.ownerNickname, 'alice');
    assert.equal(room.live, true);
    assert.equal(room.phase, 'finished');
    assert.equal(room.seated, 3);
    assert.equal(room.online, 3);
    assert.equal(room.hands, 3);
    assert.equal(room.sessionNo, 1);
    assert.equal(room.sessionsPlayed, 1);
    assert.equal(room.handsPlayed, 3);
    assert.equal(room.peakSeated, 3);
    assert.equal(room.destroyedAt, null);
    r = await srv.admin(`/api/admin/rooms?q=${code.slice(2, 5)}`);
    assert.equal(r.total, 1, '按房间号模糊匹配');
    r = await srv.admin('/api/admin/rooms?q=zzzz');
    assert.equal(r.total, 0);
    r = await srv.admin('/api/admin/rooms?status=live');
    assert.equal(r.total, 1);
    r = await srv.admin('/api/admin/rooms?status=bogus');
    assert.equal(r.status, 400);
    r = await srv.admin(`/api/admin/rooms/${code}`);
    assert.equal(r.status, 200);
    assert.equal(r.room.code, code);
    assert.equal(r.config.hands, 3);
    assert.equal(r.live.phase, 'finished');
    assert.equal(r.live.members.length, 3);
    assert.equal(r.sessions.length, 1);
    assert.equal(r.hands.length, 3);
    r = await srv.admin('/api/admin/rooms/NOPE0000');
    assert.equal(r.status, 404);

    // ---- 接口：用户
    r = await srv.admin('/api/admin/users?q=ali');
    assert.equal(r.total, 1);
    const u = r.items[0];
    assert.equal(u.userId, a.user.userId);
    assert.equal(u.username, 'alice');
    assert.equal(u.banned, false);
    assert.equal(u.online, true);
    assert.equal(u.roomCode, code);
    assert.equal(u.sessions, 1);
    assert.equal(u.hands, 3);
    assert.equal(u.net, s.players.find((p) => p.userId === a.user.userId).net);
    assert.equal(typeof u.lastLoginAt, 'number');
    assert.equal(typeof u.createdAt, 'number');
    r = await srv.admin('/api/admin/users?size=2&page=2');
    assert.equal(r.total, 3);
    assert.equal(r.items.length, 1);
    r = await srv.admin('/api/admin/users?q=%25');
    assert.equal(r.total, 0, '通配符被转义');
    r = await srv.admin(`/api/admin/users/${b.user.userId}`);
    assert.equal(r.user.username, 'bobby');
    assert.equal(r.sessions.length, 1);
    assert.deepEqual(Object.keys(r.sessions[0]).sort(), ['bestType', 'endedAt', 'finalChips', 'net', 'roomCode', 'sessionId', 'sessionNo', 'wins']);
    r = await srv.admin('/api/admin/users/nobody');
    assert.equal(r.status, 404);

    // ---- 接口：概览
    r = await srv.admin('/api/admin/overview');
    assert.deepEqual(r.stats, {
      usersTotal: 3,
      usersToday: 3,
      online: 3,
      roomsLive: 1,
      roomsPlaying: 0,
      roomsToday: 1,
      sessionsToday: 1,
      handsToday: 3,
      sessionsTotal: 1,
      handsTotal: 3,
    });
    assert.equal(r.server.version, 'test-1');
    assert.equal(r.server.node, process.version);
    assert.equal(r.server.pid, process.pid);
    assert.ok(r.server.uptimeSec >= 0 && r.server.memoryMB > 0 && r.server.startedAt <= Date.now());
    assert.deepEqual(r.maintenance, { enabled: false, message: '' });
    r = await srv.admin('/api/admin/system');
    assert.deepEqual(r.snapshot, { lastSavedAt: null, restoredAt: null, restoredRooms: 0 });
  } finally {
    await srv.stop();
  }
});

test('实时详情不含任何牌面；作废的局同样记录；解散房间推送 dissolved 并写销毁时间', async () => {
  const srv = await startServer({ appOpts: APP });
  try {
    const { accounts, clients, code } = await setupRoom(srv, ['alice', 'bobby', 'carol'], { ...SMALL, seenMultiplier: 2 });
    const [ca, cb, cc] = clients;
    await ca.ok('room.start');
    await cb.waitState((s) => s.hand && s.hand.turnSeat === 1, '轮到 bobby');
    await cb.ok('game.look');
    await cb.ok('game.raise', { to: 10 });
    await ca.ok('chat.send', { kind: 'text', text: '你好' });
    assert.ok(cb.state.hand.myCards, '玩家自己能看到牌');

    let r = await srv.admin(`/api/admin/rooms/${code}`);
    assert.equal(r.status, 200);
    const live = r.live;
    assert.equal(live.phase, 'playing');
    assert.equal(live.ownerId, accounts[0].user.userId);
    assert.deepEqual(live.members.map((m) => m.seatIndex), [0, 1, 2]);
    assert.ok(live.members.every((m) => m.online && typeof m.chips === 'number'));
    assert.equal(live.hand.handNo, 1);
    assert.equal(live.hand.round, 1);
    assert.equal(live.hand.currentBet, 10);
    assert.equal(live.hand.turnSeat, 2);
    assert.equal(live.hand.ended, false);
    assert.equal(live.hand.pot, 15 + 20);
    assert.deepEqual(Object.keys(live.hand.players[0]).sort(), ['bet', 'nickname', 'seatIndex', 'seen', 'state']);
    assert.equal(live.hand.players.find((p) => p.nickname === 'bobby').seen, true);
    assert.equal(live.chat.length, 1);
    // 整个响应里没有任何牌面
    for (const resp of [r, await srv.admin('/api/admin/rooms?status=live'), await srv.admin('/api/admin/overview')]) {
      const text = JSON.stringify(resp);
      assert.ok(!/"cards"|"label"|"type"|单张|对子|顺子|金花|顺金|豹子|"r":/.test(text), `后台响应不应包含牌面：${text.slice(0, 200)}`);
    }

    // 房主提前结束本场：当前局作废（也要记录）
    await ca.ok('room.endSession');
    const voided = srv.app.db.raw.prepare("SELECT * FROM hand_records WHERE reason = 'voided'").get();
    assert.ok(voided, '作废的局也有记录');
    assert.equal(voided.hand_no, 1);
    assert.equal(voided.pot, 35, '作废前的总下注');
    const vp = JSON.parse(voided.players_json);
    assert.equal(vp.length, 3);
    assert.ok(vp.every((p) => p.delta === 0 && p.cards.length === 3));
    assert.equal(vp.find((p) => p.nickname === 'bobby').seen, true);
    assert.equal(JSON.parse(voided.winners_json).seats.length, 0);
    assert.ok(JSON.parse(voided.log_json).some((l) => l.kind === 'void'));
    const rec = srv.app.db.admin.getRoomRecord(code);
    assert.equal(rec.hands_played, 0, '作废的局不计入局数');
    assert.equal(rec.sessions_played, 1);
    r = await srv.admin(`/api/admin/hands?room=${code}`);
    assert.equal(r.items[0].reason, 'voided');
    assert.equal(r.items[0].pot, 35);
    assert.deepEqual(r.items[0].winners, []);
    r = await srv.admin('/api/admin/overview');
    assert.equal(r.stats.handsTotal, 0, '统计的局数不含作废');

    // 解散
    r = await srv.admin(`/api/admin/rooms/${code}/dissolve`, { method: 'POST', body: { reason: '测试解散' } });
    assert.equal(r.status, 200);
    for (const cl of clients) {
      await cl.until(() => cl.events.some((e) => e.kind === 'dissolved'), '收到 dissolved');
      const ev = cl.events.find((e) => e.kind === 'dissolved');
      assert.equal(typeof ev.text, 'string');
      assert.match(ev.text, /管理员解散/);
      assert.match(ev.text, /测试解散/);
    }
    assert.equal(srv.app.manager.getRoom(code), null);
    const me = await srv.api('/api/me', { token: accounts[1].token });
    assert.equal(me.roomCode, null);
    await cb.fail('seat.stand', {}, 'NOT_IN_ROOM');
    await cb.fail('room.join', { code }, 'ROOM_NOT_FOUND');

    assert.equal(typeof srv.app.db.admin.getRoomRecord(code).destroyed_at, 'number');
    r = await srv.admin(`/api/admin/rooms/${code}`);
    assert.equal(r.live, null);
    assert.equal(r.room.live, false);
    assert.equal(r.room.phase, null);
    assert.equal(r.room.seated, 0);
    assert.equal(r.room.online, 0);
    assert.equal(typeof r.room.destroyedAt, 'number');
    assert.equal(r.config.hands, 3);
    assert.equal(r.sessions.length, 1, '解散前结算的场次');
    r = await srv.admin('/api/admin/rooms?status=live');
    assert.equal(r.total, 0);
    r = await srv.admin('/api/admin/rooms?status=all');
    assert.equal(r.total, 1);
    assert.equal(r.items[0].live, false);
    r = await srv.admin(`/api/admin/rooms/${code}/dissolve`, { method: 'POST', body: {} });
    assert.equal(r.status, 404);
    r = await srv.admin(`/api/admin/rooms/${code}/dissolve`, { method: 'POST', body: { reason: 'x'.repeat(101) } });
    assert.equal(r.status, 400);
    void cc;
  } finally {
    await srv.stop();
  }
});

test('房间无人超时销毁也写 destroyed_at；dissolve 不带原因', async () => {
  const srv = await startServer();
  try {
    const a = await srv.register('alice');
    const code = await createRoom(srv, a);
    const code2 = await createRoom(srv, a);
    assert.equal(srv.app.db.admin.getRoomRecord(code).destroyed_at, null);
    srv.app.manager.sweep(Date.now() + 31 * 60 * 1000);
    assert.equal(srv.app.manager.rooms.size, 0);
    for (const c of [code, code2]) assert.equal(typeof srv.app.db.admin.getRoomRecord(c).destroyed_at, 'number');
  } finally {
    await srv.stop();
  }
});

test('解散房间：未带原因时文案固定；成员收到事件后被移出', async () => {
  const srv = await startServer();
  try {
    const { clients, code } = await setupRoom(srv, ['alice', 'bobby']);
    const r = await srv.admin(`/api/admin/rooms/${code}/dissolve`, { method: 'POST', body: {} });
    assert.equal(r.status, 200);
    await clients[1].until(() => clients[1].events.some((e) => e.kind === 'dissolved'), '收到 dissolved');
    assert.equal(clients[1].events.find((e) => e.kind === 'dissolved').text, '房间已被管理员解散');
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- 用户管理

test('封禁：踢下线、token 失效、登录 403 BANNED，解封后恢复；last_login_at 记录', async () => {
  const srv = await startServer();
  try {
    const u = await srv.register('alice');
    const other = await srv.register('bobby');
    let r = await srv.admin(`/api/admin/users/${u.user.userId}`);
    const regAt = r.user.lastLoginAt;
    assert.equal(typeof regAt, 'number', '注册即视为登录');
    await sleep(5);
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'pass1234' } });
    assert.equal(r.status, 200);
    const token = r.token;
    r = await srv.admin(`/api/admin/users/${u.user.userId}`);
    assert.ok(r.user.lastLoginAt > regAt, '登录更新 last_login_at');

    const c = await srv.connect({ name: 'alice', token });
    r = await srv.admin(`/api/admin/users/${u.user.userId}/ban`, { method: 'POST', body: { banned: true } });
    assert.equal(r.status, 200);
    assert.equal(r.user.banned, true);
    const info = await c.closed;
    assert.equal(info.code, 4001);

    r = await srv.api('/api/me', { token });
    assert.equal(r.status, 401);
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'pass1234' } });
    assert.equal(r.status, 403);
    assert.equal(r.error.code, 'BANNED');
    assert.equal(r.error.message, '账号已被封禁');
    // 密码错误时不泄露封禁状态
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'zzzzzz' } });
    assert.equal(r.status, 401);
    // 被封禁者用旧 token 连 ws 被拒
    const c2 = await srv.connect({ name: 'alice', token });
    assert.equal((await c2.closed).code, 4001);
    // 列表里能看到
    r = await srv.admin('/api/admin/users?q=alice');
    assert.equal(r.items[0].banned, true);
    assert.equal(r.items[0].online, false);
    // 其他人不受影响
    r = await srv.api('/api/me', { token: other.token });
    assert.equal(r.status, 200);

    r = await srv.admin(`/api/admin/users/${u.user.userId}/ban`, { method: 'POST', body: { banned: 'yes' } });
    assert.equal(r.status, 400);
    r = await srv.admin('/api/admin/users/nobody/ban', { method: 'POST', body: { banned: true } });
    assert.equal(r.status, 404);

    r = await srv.admin(`/api/admin/users/${u.user.userId}/ban`, { method: 'POST', body: { banned: false } });
    assert.equal(r.user.banned, false);
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'pass1234' } });
    assert.equal(r.status, 200);
  } finally {
    await srv.stop();
  }
});

test('重置密码：作废全部 token、在线连接以 4001 断开，旧密码失效、新密码可用', async () => {
  const srv = await startServer();
  try {
    const u = await srv.register('alice');
    const c = await srv.connect(u);
    let r = await srv.admin(`/api/admin/users/${u.user.userId}/password`, { method: 'POST', body: { password: 'abc' } });
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'BAD_PASSWORD');
    r = await srv.admin('/api/admin/users/nobody/password', { method: 'POST', body: { password: 'newpass1' } });
    assert.equal(r.status, 404);
    assert.equal((await srv.api('/api/me', { token: u.token })).status, 200, '校验失败时不影响现有登录');

    r = await srv.admin(`/api/admin/users/${u.user.userId}/password`, { method: 'POST', body: { password: 'newpass1' } });
    assert.equal(r.status, 200);
    assert.equal((await c.closed).code, 4001);
    assert.equal((await srv.api('/api/me', { token: u.token })).status, 401);
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'pass1234' } });
    assert.equal(r.status, 401);
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice', password: 'newpass1' } });
    assert.equal(r.status, 200);
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- 兼容旧库

test('旧数据库：缺少的列用 ALTER 补上，已有数据保留', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-old-'));
  try {
    const old = new DatabaseSync(join(dir, 'zjh.db'));
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lc TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE session_results (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, session_no INTEGER NOT NULL, ended_at INTEGER NOT NULL, hands_played INTEGER NOT NULL, config_json TEXT NOT NULL);
      CREATE TABLE session_players (result_id INTEGER NOT NULL, user_id TEXT NOT NULL, nickname TEXT NOT NULL, net INTEGER NOT NULL, final_chips INTEGER NOT NULL, best_type TEXT, wins INTEGER NOT NULL, PRIMARY KEY (result_id, user_id));
      INSERT INTO users VALUES ('u1', 'Old', 'old', 'Old', 'aa', 'bb', 1000);
      INSERT INTO session_results VALUES (1, 'OLDROOM1', 1, 2000, 5, '{}');
      INSERT INTO session_players VALUES (1, 'u1', 'Old', 30, 330, 'duizi', 2);
    `);
    old.close();

    const db = openDb(dir);
    const cols = (t) => db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(cols('users').includes('last_login_at'));
    assert.ok(cols('users').includes('banned'));
    assert.ok(cols('session_results').includes('started_at'));
    const u = db.getUserById('u1');
    assert.equal(u.banned, 0);
    assert.equal(u.last_login_at, null);
    assert.equal(u.username, 'Old');
    assert.equal(db.admin.listSessions({ page: 1, size: 20 }).items[0].startedAt, null);
    assert.equal(db.admin.userStats('u1').net, 30);
    db.close();
    // 重复打开不会重复 ALTER
    openDb(dir).close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
