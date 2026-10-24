// 集成测试：真实启动服务（随机端口、临时 DATA_DIR），用 ws 客户端模拟多个用户
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { cardPaths } from './helpers.js';

// ---------------------------------------------------------------- 工具

async function startServer({ timing, staticDir = null, heartbeatMs, deadMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-test-'));
  const app = await createApp({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    staticDir,
    timing: { nextHandDelayMs: 40, dealMs: 0, ...timing },
    heartbeatMs,
    deadMs,
  });
  const base = `http://127.0.0.1:${app.port}`;
  const clients = [];
  const ctx = {
    app,
    base,
    port: app.port,
    dir,
    async api(path, { method = 'GET', body, token } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      return { status: res.status, ...json };
    },
    async register(name, password = 'pass1234') {
      if (name.length < 3) name += '_x'; // 账号 ID 至少 3 位
      const r = await ctx.api('/api/register', { method: 'POST', body: { username: name, password } });
      assert.equal(r.ok, true, `注册失败：${JSON.stringify(r)}`);
      return { name, token: r.token, user: r.user };
    },
    async connect(account) {
      const c = new Client(`ws://127.0.0.1:${app.port}/ws?token=${account.token}`, account);
      clients.push(c);
      await c.opened;
      return c;
    },
    async stop() {
      for (const c of clients) c.ws.terminate();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return ctx;
}

class Client {
  constructor(url, account, wsOpts = {}) {
    this.account = account;
    this.state = null;
    this.states = [];
    this.events = [];
    this.msgs = [];
    this.pending = new Map();
    this.waiters = [];
    this.seq = 0;
    this.autoplay = null;
    this.lastPlayKey = null;
    this.closeInfo = null;
    this.ws = new WebSocket(url, wsOpts);
    this.opened = new Promise((resolve) => {
      this.ws.once('open', resolve);
      this.ws.once('close', resolve); // 被服务端立刻关闭（如 4001）时也要 resolve
    });
    this.closed = new Promise((resolve) => {
      this.ws.once('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        resolve(this.closeInfo);
        this._wake();
      });
    });
    this.ws.on('error', () => {});
    this.ws.on('message', (data) => this._onMessage(JSON.parse(data.toString())));
  }

  _onMessage(msg) {
    this.msgs.push(msg);
    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p(msg);
      }
    } else if (msg.type === 'state') {
      this.state = msg.data;
      this.states.push(msg.data);
      this._maybeAutoplay();
    } else if (msg.type === 'event') {
      this.events.push(msg.data);
    }
    this._wake();
  }

  _maybeAutoplay() {
    if (!this.autoplay) return;
    const h = this.state.hand;
    if (!h || h.ended || !h.actions) return;
    const key = `${this.state.sessionNo}:${h.handNo}:${h.round}:${h.turnDeadline}`;
    if (key === this.lastPlayKey) return;
    const act = this.autoplay(this.state);
    if (!act) return;
    if (act[0] !== 'game.look') this.lastPlayKey = key; // 看牌不占回合，之后还要继续行动
    this.req(act[0], act[1]).catch(() => {});
  }

  _wake() {
    for (const w of [...this.waiters]) {
      let v;
      try {
        v = w.pred();
      } catch {
        v = false;
      }
      if (v) {
        clearTimeout(w.timer);
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(v === true ? undefined : v);
      }
    }
  }

  /** 等待条件成立（立刻检查一次）。返回 pred 的真值（非 true 时） */
  until(pred, what = '条件', timeout = 8000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: null };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`等待超时：${what}（${this.account.name}）\n最后状态：${JSON.stringify(this.state && { phase: this.state.phase, hand: this.state.hand && { no: this.state.hand.handNo, turn: this.state.hand.turnSeat, ended: this.state.hand.ended } })}`));
      }, timeout);
      this.waiters.push(w);
      this._wake();
    });
  }

  async waitState(pred, what, timeout) {
    await this.until(() => this.state && pred(this.state), what, timeout);
    return this.state;
  }

  req(action, data = {}) {
    const id = `c-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`请求超时 ${action}`)), 5000);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.ws.send(JSON.stringify({ type: 'req', id, action, data }));
    });
  }

  /** 请求必须成功 */
  async ok(action, data) {
    const r = await this.req(action, data);
    assert.equal(r.ok, true, `${action} 失败：${JSON.stringify(r.error)}`);
    return r.data;
  }

  /** 请求必须失败并返回指定错误码 */
  async fail(action, data, code) {
    const r = await this.req(action, data);
    assert.equal(r.ok, false, `${action} 应该失败`);
    assert.equal(r.error.code, code, `${action} 错误码：${JSON.stringify(r.error)}`);
    assert.equal(typeof r.error.message, 'string');
    return r.error;
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

// 校验每一份 state 的牌面安全性
function checkStateSafety(state, userId) {
  for (const p of cardPaths(state)) assert.match(p, /^hand\.(myCards|visible\[\d+\])$/, `牌面出现在非法位置 ${p}`);
  const h = state.hand;
  if (!h) return;
  const me = h.players.find((p) => p.userId === userId);
  if (!me) {
    assert.equal(h.myCards, null, '不在本局的人不应收到自己的牌');
  } else if (!h.ended && me.state === 'active' && !me.seen) {
    assert.equal(h.myCards, null, '闷牌玩家不应收到自己的牌');
  }
  if (!h.ended) {
    // 未结束时，visible 里的人必须不是弃牌者
    for (const v of h.visible) assert.notEqual(h.players.find((p) => p.seatIndex === v.seatIndex).state, 'folded');
  }
}

function botPolicy(state) {
  const a = state.hand.actions;
  const r = Math.random();
  if (state.hand.round >= 2 && r < 0.35) return ['game.fold', {}];
  if (a.compare && r < 0.6) return ['game.compare', { targetSeat: a.compare.targets[Math.floor(Math.random() * a.compare.targets.length)] }];
  if (a.raise.length && r < 0.7) return ['game.raise', { to: a.raise[0].to }];
  if (r > 0.9 && state.hand.canLook) return ['game.look', {}];
  if (a.call) return ['game.call', {}];
  if (a.allIn) return ['game.allIn', {}];
  return ['game.fold', {}];
}

const SMALL = { hands: 3, initialChips: 300, ante: 5, raiseSteps: [2, 5, 10], capMultiple: 10, maxRounds: 5, actionSeconds: 10 };

async function createRoom(srv, owner, config = SMALL) {
  const r = await srv.api('/api/rooms', { method: 'POST', token: owner.token, body: { config } });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.code;
}

async function joinAndSit(c, code, seatIndex) {
  await c.ok('room.join', { code });
  await c.waitState((s) => s.code === code, '收到房间状态');
  if (seatIndex !== undefined) await c.ok('seat.sit', { seatIndex });
}

// ---------------------------------------------------------------- HTTP / 账号

test('账号：注册 / 登录 / 大小写不敏感 / 旧 token 作废 / 昵称 / 退出', async () => {
  const srv = await startServer();
  try {
    let r = await srv.api('/api/register', { method: 'POST', body: { username: 'Alice_1', password: 'abcd' } });
    assert.equal(r.status, 200);
    assert.match(r.token, /^[0-9a-f]{64}$/);
    assert.equal(r.user.username, 'Alice_1');
    assert.equal(r.user.nickname, 'Alice_1');
    assert.equal(typeof r.user.userId, 'string');
    const token1 = r.token;

    // 唯一性不区分大小写
    r = await srv.api('/api/register', { method: 'POST', body: { username: 'alice_1', password: 'abcd' } });
    assert.equal(r.status, 409);
    assert.equal(r.error.code, 'USERNAME_TAKEN');
    // 格式校验
    for (const [username, password, code] of [
      ['ab', 'abcd', 'BAD_USERNAME'],
      ['has space', 'abcd', 'BAD_USERNAME'],
      ['x'.repeat(17), 'abcd', 'BAD_USERNAME'],
      ['中文名字', 'abcd', 'BAD_USERNAME'],
      ['okname', 'abc', 'BAD_PASSWORD'],
      ['okname', 'x'.repeat(65), 'BAD_PASSWORD'],
    ]) {
      r = await srv.api('/api/register', { method: 'POST', body: { username, password } });
      assert.equal(r.status, 400, `${username}/${password}`);
      assert.equal(r.error.code, code);
      assert.equal(typeof r.error.message, 'string');
    }

    // 登录不区分大小写；新登录让旧 token 失效
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'ALICE_1', password: 'abcd' } });
    assert.equal(r.status, 200);
    assert.equal(r.user.username, 'Alice_1');
    const token2 = r.token;
    assert.notEqual(token1, token2);
    r = await srv.api('/api/me', { token: token1 });
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'UNAUTHORIZED');
    r = await srv.api('/api/me', { token: token2 });
    assert.equal(r.status, 200);
    assert.equal(r.roomCode, null);

    // 错误凭证
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'alice_1', password: 'wrong' } });
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'BAD_CREDENTIALS');
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'nobody', password: 'wrong' } });
    assert.equal(r.status, 401);
    assert.equal(r.error.code, 'BAD_CREDENTIALS');
    r = await srv.api('/api/me');
    assert.equal(r.status, 401);

    // 昵称
    r = await srv.api('/api/me/nickname', { method: 'POST', token: token2, body: { nickname: '  小王  ' } });
    assert.equal(r.user.nickname, '小王');
    r = await srv.api('/api/me/nickname', { method: 'POST', token: token2, body: { nickname: '这个昵称实在是太长太长了呀' } });
    assert.equal(r.status, 400);
    r = await srv.api('/api/me/nickname', { method: 'POST', token: token2, body: { nickname: '   ' } });
    assert.equal(r.status, 400);
    r = await srv.api('/api/me', { token: token2 });
    assert.equal(r.user.nickname, '小王');

    // 密码是加盐哈希，数据库里不能有明文
    const row = srv.app.db.raw.prepare('SELECT * FROM users').get();
    assert.ok(!JSON.stringify(row).includes('abcd'));
    assert.equal(row.pass_salt.length, 32);

    // 退出登录
    r = await srv.api('/api/logout', { method: 'POST', token: token2 });
    assert.equal(r.ok, true);
    r = await srv.api('/api/me', { token: token2 });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('token 有效期 30 天', async () => {
  const srv = await startServer();
  try {
    const a = await srv.register('tokuser');
    const row = srv.app.db.raw.prepare('SELECT * FROM tokens WHERE token = ?').get(a.token);
    const days = (row.expires_at - row.created_at) / 86400000;
    assert.equal(Math.round(days), 30);
    // 手动让它过期
    srv.app.db.raw.prepare('UPDATE tokens SET expires_at = ? WHERE token = ?').run(Date.now() - 1, a.token);
    const r = await srv.api('/api/me', { token: a.token });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('配置与房间接口：defaults / 创建 / 查询 / 非法配置', async () => {
  const srv = await startServer();
  try {
    let r = await srv.api('/api/config/defaults');
    assert.equal(r.ok, true);
    assert.equal(r.config.hands, 5);
    assert.deepEqual(r.config.raiseSteps, [5, 10, 20, 30, 50, 100]);
    assert.deepEqual(r.limits.hands, { min: 1, max: 100, quick: [5, 10, 20, 30] });
    assert.deepEqual(r.limits.actionSeconds, { min: 10, max: 180, quick: [30, 60, 80, 120] });
    assert.equal(r.config.actionSeconds, 80);
    assert.equal(r.config.nextHandSeconds, 5);
    assert.equal(r.config.settleSeconds, 5);
    assert.deepEqual(Object.keys(r.limits).sort(), Object.keys(r.config).sort());

    const a = await srv.register('roomowner');
    r = await srv.api('/api/rooms', { method: 'POST', body: { config: {} } });
    assert.equal(r.status, 401);
    r = await srv.api('/api/rooms', { method: 'POST', token: a.token, body: { config: { hands: 101 } } });
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'BAD_CONFIG');
    assert.match(r.error.message, /局数/);
    r = await srv.api('/api/rooms', { method: 'POST', token: a.token, body: { config: { raiseSteps: [2, 5, 20], capMultiple: 10 } } });
    assert.equal(r.error.code, 'BAD_CONFIG');
    r = await srv.api('/api/rooms', { method: 'POST', token: a.token, body: { config: { a23: 'weird' } } });
    assert.equal(r.error.code, 'BAD_CONFIG');

    r = await srv.api('/api/rooms', { method: 'POST', token: a.token, body: { config: { hands: 5, ante: 10 } } });
    assert.equal(r.ok, true);
    assert.match(r.code, /^[23456789abcdefghjkmnprstuvwxyz]{8}$/);
    // 查询房间号不区分大小写
    assert.equal((await srv.api('/api/rooms/' + r.code.toUpperCase(), { token: a.token })).exists, true);
    const code = r.code;

    r = await srv.api(`/api/rooms/${code}`, { token: a.token });
    assert.deepEqual({ ok: r.ok, exists: r.exists, phase: r.phase, seated: r.seated, spectators: r.spectators }, { ok: true, exists: true, phase: 'waiting', seated: 0, spectators: 0 });
    r = await srv.api(`/api/rooms/${encodeURIComponent('  ' + code + ' ')}`, { token: a.token });
    assert.equal(r.exists, true, '首尾空格被忽略');
    r = await srv.api('/api/rooms/ZZZZZZZZ', { token: a.token });
    assert.equal(r.exists, false);
    r = await srv.api(`/api/rooms/${code}`);
    assert.equal(r.status, 401);
    r = await srv.api('/api/nope', { token: a.token });
    assert.equal(r.status, 404);
    assert.equal(r.error.code, 'NOT_FOUND');
  } finally {
    await srv.stop();
  }
});

test('静态文件与 SPA 回退；没有 STATIC_DIR 时只提供 API，不崩溃', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>zjh</title>');
  writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log("hi")');
  writeFileSync(join(dir, '..', 'zjh-secret.txt'), 'secret');
  const srv = await startServer({ staticDir: dir });
  const noStatic = await startServer({ staticDir: join(dir, 'does-not-exist') });
  try {
    let res = await fetch(srv.base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<title>zjh<\/title>/);
    for (const p of ['/r/abc12345', '/login', '/create']) {
      res = await fetch(srv.base + p);
      assert.equal(res.status, 200, p);
      assert.match(await res.text(), /zjh/);
    }
    res = await fetch(srv.base + '/assets/app-123.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.equal(await res.text(), 'console.log("hi")');
    res = await fetch(srv.base + '/assets/missing.js');
    assert.equal(res.status, 404);
    res = await fetch(srv.base + '/api/whatever');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /json/);
    // 路径穿越
    const raw = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: srv.port, path: '/..%2fzjh-secret.txt' }, (r) => {
          let b = '';
          r.on('data', (c) => (b += c));
          r.on('end', () => resolve({ status: r.statusCode, body: b }));
        })
        .on('error', reject);
    });
    assert.ok(!raw.body.includes('secret'));

    res = await fetch(noStatic.base + '/');
    assert.equal(res.status, 404);
    res = await fetch(noStatic.base + '/api/config/defaults');
    assert.equal(res.status, 200);
  } finally {
    await srv.stop();
    await noStatic.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'zjh-secret.txt'), { force: true });
  }
});

// ---------------------------------------------------------------- WebSocket

test('WebSocket：token 无效以 4001 关闭；ping/pong；未知操作与未入房', async () => {
  const srv = await startServer();
  try {
    const bad = new Client(`ws://127.0.0.1:${srv.port}/ws?token=${'0'.repeat(64)}`, { name: 'bad' });
    const info = await bad.closed;
    assert.equal(info.code, 4001);
    const none = new Client(`ws://127.0.0.1:${srv.port}/ws`, { name: 'none' });
    assert.equal((await none.closed).code, 4001);

    const a = await srv.register('wsuser');
    const c = await srv.connect(a);
    c.ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await c.until(() => c.msgs.find((m) => m.type === 'pong'), 'pong');
    assert.ok(Math.abs(pong.serverTime - Date.now()) < 5000);
    await c.fail('seat.sit', { seatIndex: 0 }, 'NOT_IN_ROOM');
    await c.fail('no.such.action', {}, 'NOT_IN_ROOM');
    await c.fail('room.join', { code: 'ZZZZZZZZ' }, 'ROOM_NOT_FOUND');
    const code = await createRoom(srv, a);
    await c.ok('room.join', { code });
    await c.fail('no.such.action', {}, 'UNKNOWN_ACTION');
    await c.fail('seat.sit', { seatIndex: 99 }, 'INVALID_ACTION');
    // 房间号首尾空格会被忽略；已在房间内重复 join 只是重新同步
    await c.ok('room.join', { code: ` ${code} ` });
    const s = await c.waitState((st) => st.code === code, '状态');
    assert.equal(s.me.isOwner, true);
    assert.equal(s.seats.length, 15);
    assert.equal(s.phase, 'waiting');
    assert.equal(s.hand, null);
    assert.equal(s.me.seatIndex, null);
    // 创建者没有进入房间之前 /api/me 的 roomCode 为 null，进入之后有值
    const me = await srv.api('/api/me', { token: a.token });
    assert.equal(me.roomCode, code);
  } finally {
    await srv.stop();
  }
});

test('顶号：新连接让旧连接收到 replaced 并以 4002 关闭，旧连接不再触发断线', async () => {
  const srv = await startServer();
  try {
    const a = await srv.register('dupuser');
    const b = await srv.register('other');
    const code = await createRoom(srv, a);
    const c1 = await srv.connect(a);
    await joinAndSit(c1, code, 0);
    const cb = await srv.connect(b);
    await joinAndSit(cb, code);
    const c2 = await srv.connect(a);
    const info = await c1.closed;
    assert.equal(info.code, 4002);
    assert.ok(c1.msgs.some((m) => m.type === 'replaced'));
    // 旧连接关闭后，该用户仍然在线（新连接在线），房间里没有闪成离线
    await cb.waitState((s) => s.seats[0] && s.seats[0].online === true, 'A 在线');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(cb.state.seats[0].online, true);
    // 新连接重新 join 即可恢复
    await c2.ok('room.join', { code });
    const st = await c2.waitState((s) => s.code === code, '状态');
    assert.equal(st.me.seatIndex, 0);
  } finally {
    await srv.stop();
  }
});

test('死连接清理：不响应协议层 ping 的连接会被服务端断开，并标记为离线', async () => {
  const srv = await startServer({ heartbeatMs: 40, deadMs: 150 });
  try {
    const a = await srv.register('alive');
    const d = await srv.register('deadconn');
    const code = await createRoom(srv, a);
    const ca = await srv.connect(a);
    await joinAndSit(ca, code, 0);
    // autoPong:false —— 不回应服务端的 ping，但 ca 正常
    const dead = new Client(`ws://127.0.0.1:${srv.port}/ws?token=${d.token}`, d, { autoPong: false });
    await dead.opened;
    await joinAndSit(dead, code, 1);
    await ca.waitState((s) => s.seats[1] && s.seats[1].online, '对方在线');
    await dead.closed;
    await ca.waitState((s) => s.seats[1] && s.seats[1].online === false, '对方被标记为离线');
    assert.equal(ca.state.seats[1].userId, d.user.userId, '座位保留');
    // 心跳正常的连接不受影响
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(ca.ws.readyState, WebSocket.OPEN);
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- 完整流程

test('完整流程：注册 → 建房 → 进入 → 入座 → 准备 → 开始 → 打完整场 → 结算 → 再来一场', async () => {
  const srv = await startServer({ timing: { actionScale: 0.05 } });
  try {
    const accts = [];
    for (const n of ['pa', 'pb', 'pc', 'pd']) accts.push(await srv.register(n));
    const [A, B, C, D] = accts;
    const code = await createRoom(srv, A, SMALL);
    const [ca, cb, cc, cd] = [];
    const clients = [];
    for (const acc of accts) clients.push(await srv.connect(acc));
    const [a, b, c, d] = clients;

    // 每份 state 都做安全检查
    for (const cl of clients) {
      cl.ws.on('message', (data) => {
        const m = JSON.parse(data.toString());
        if (m.type === 'state') checkStateSafety(m.data, cl.account.user.userId);
        if (m.type === 'event') assert.deepEqual(cardPaths(m), []);
      });
    }

    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 3);
    await joinAndSit(c, code, 7);
    await joinAndSit(d, code); // 观战者
    const w = await d.waitState((s) => s.seats.filter(Boolean).length === 3, '三人入座');
    assert.equal(w.spectators.length, 1);
    assert.equal(w.me.seatIndex, null);

    await a.fail('room.start', {}, 'NOT_ALL_READY');
    await b.ok('room.ready', { ready: true });
    await c.ok('room.ready', { ready: true });
    // 非房主不能开始
    await b.fail('room.start', {}, 'NOT_OWNER');
    for (const cl of [a, b, c]) cl.autoplay = botPolicy;
    await a.ok('room.start', {});

    // 观战者 d 在对局中入座，从下一局起参与
    await d.waitState((s) => s.phase === 'playing', '开始');
    await d.ok('seat.sit', { seatIndex: 11 });
    d.autoplay = botPolicy;
    assert.equal(d.state.seats[11].status === 'waitingNext' || d.state.hand.ended, true);

    const fin = await a.waitState((s) => s.phase === 'finished', '本场结算', 30000);
    assert.equal(fin.summary.sessionNo, 1);
    assert.equal(fin.summary.handsPlayed, 3);
    assert.equal(fin.summary.players.reduce((x, p) => x + p.net, 0), 0, '积分守恒');
    assert.ok(fin.summary.players.length >= 3);
    assert.ok(fin.summary.players.every((p) => p.finalChips >= 0));
    assert.equal(fin.summary.players.reduce((x, p) => x + p.wins, 0), 3);
    assert.equal(fin.sessions.length, 1);
    assert.equal(fin.totals.reduce((x, t) => x + t.net, 0), 0);
    assert.ok(a.events.some((e) => e.kind === 'sessionEnd'));
    assert.equal(a.events.filter((e) => e.kind === 'handStart').length, 3);
    assert.equal(a.events.filter((e) => e.kind === 'handEnd').length, 3);
    // 观战者 d 入座后参与了后续局
    assert.ok(fin.summary.players.some((p) => p.userId === D.user.userId));
    // 数据库里有战绩
    assert.equal(srv.app.db.raw.prepare('SELECT COUNT(*) c FROM session_results').get().c, 1);
    assert.equal(srv.app.db.raw.prepare('SELECT COUNT(*) c FROM session_players').get().c, fin.summary.players.length);

    // 结算阶段：只有房主可以再来一场
    await b.fail('room.restart', {}, 'NOT_OWNER');
    await a.ok('room.restart', {});
    const w2 = await b.waitState((s) => s.phase === 'waiting' && s.sessionNo === 2, '第二场准备');
    assert.ok(w2.seats.filter(Boolean).every((s) => s.chips === 300 && !s.ready));
    assert.equal(w2.sessions.length, 1);

    // 第二场：修改配置（只打 1 局），准备，开始，打完
    await a.ok('room.updateConfig', { config: { ...w2.config, hands: 1 } });
    for (const cl of [b, c, d]) await cl.ok('room.ready', { ready: true });
    await a.ok('room.start', {});
    const fin2 = await a.waitState((s) => s.phase === 'finished' && s.sessionNo === 2, '第二场结算', 30000);
    assert.equal(fin2.summary.handsPlayed, 1);
    assert.equal(fin2.sessions.length, 2);
    assert.equal(fin2.sessions[0].sessionNo, 2);
    // 历场累计 = 两场 net 之和
    for (const t of fin2.totals) {
      const sum = fin2.sessions.reduce((x, s) => x + (s.players.find((p) => p.userId === t.userId)?.net || 0), 0);
      assert.equal(t.net, sum);
    }
    assert.equal(srv.app.db.raw.prepare('SELECT COUNT(*) c FROM session_results').get().c, 2);
    void [ca, cb, cc, cd];
  } finally {
    await srv.stop();
  }
});

test('房主提前结束本场：当前局作废、退还下注，进入结算', async () => {
  const srv = await startServer();
  try {
    const [A, B] = [await srv.register('ea'), await srv.register('eb')];
    const code = await createRoom(srv, A, { ...SMALL, actionSeconds: 30 });
    const [a, b] = [await srv.connect(A), await srv.connect(B)];
    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 1);
    await b.ok('room.ready', { ready: true });
    await b.fail('room.endSession', {}, 'NOT_OWNER');
    await a.fail('room.endSession', {}, 'BAD_PHASE');
    await a.ok('room.start', {});
    await a.waitState((s) => s.hand && !s.hand.ended, '局开始');
    const turn = a.state.hand.turnSeat;
    const actor = turn === 0 ? a : b;
    await actor.ok('game.call', {});
    await a.ok('room.endSession', {});
    const fin = await b.waitState((s) => s.phase === 'finished', '结算');
    assert.equal(fin.hand.result.reason, 'voided');
    assert.ok(fin.seats.filter(Boolean).every((s) => s.chips === 300));
    assert.equal(fin.summary.handsPlayed, 0);
  } finally {
    await srv.stop();
  }
});

test('断线重连：恢复自己已看的牌；掉线期间保留座位并按规则超时', async () => {
  const srv = await startServer();
  try {
    const [A, B] = [await srv.register('ra'), await srv.register('rb')];
    const code = await createRoom(srv, A, { ...SMALL, actionSeconds: 30 });
    let a = await srv.connect(A);
    const b = await srv.connect(B);
    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 1);
    await b.ok('room.ready', { ready: true });
    await a.ok('room.start', {});
    await a.waitState((s) => s.hand && !s.hand.ended, '局开始');
    assert.equal(a.state.hand.myCards, null);
    await a.ok('game.look', {});
    const st = await a.waitState((s) => s.hand.myCards, '看牌后收到牌');
    const mine = JSON.parse(JSON.stringify(st.hand.myCards));
    assert.equal(mine.cards.length, 3);
    // B 看不到 A 的牌
    await b.until(() => b.state.hand.players.find((p) => p.seatIndex === 0).seen, 'B 看到 A 已看牌');
    assert.equal(b.state.hand.myCards, null);
    assert.deepEqual(b.state.hand.visible, []);

    // A 掉线：B 看到 A 离线；/api/me 仍指向房间
    await a.close();
    await b.waitState((s) => s.seats[0].online === false, 'A 离线');
    assert.equal((await srv.api('/api/me', { token: A.token })).roomCode, code);

    // A 重连，重新 join，恢复已看的牌
    a = await srv.connect(A);
    await a.waitState((s) => s.code === code, '重连后自动同步（服务端按用户记住房间）').catch(() => {});
    await a.ok('room.join', { code });
    const re = await a.waitState((s) => s.hand && s.hand.myCards, '恢复牌');
    assert.deepEqual(re.hand.myCards, mine);
    assert.equal(re.me.seatIndex, 0);
    assert.equal(re.seats[0].online, true);
    await b.waitState((s) => s.seats[0].online === true, 'A 回来了');
  } finally {
    await srv.stop();
  }
});

test('掉线玩家轮到他时正常计时，超时按规则处理', async () => {
  const srv = await startServer({ timing: { actionScale: 0.05 } });
  try {
    const [A, B, C] = [await srv.register('ta'), await srv.register('tb'), await srv.register('tc')];
    const code = await createRoom(srv, A, { ...SMALL, actionSeconds: 10, timeoutAction: 'fold' });
    const [a, b, c] = [await srv.connect(A), await srv.connect(B), await srv.connect(C)];
    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 1);
    await joinAndSit(c, code, 2);
    await b.ok('room.ready', { ready: true });
    await c.ok('room.ready', { ready: true });
    await a.ok('room.start', {});
    await b.close();
    await c.close();
    // 全员超时：A（在线但不操作）与离线的 B、C 都会因超时弃牌，本局结束
    const s = await a.waitState((st) => st.hand && st.hand.ended, '超时结束本局', 5000);
    assert.ok(s.hand.players.filter((p) => p.timedOut).length >= 2);
    assert.ok(s.hand.log.some((l) => l.kind === 'timeout'));
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- 房主 / 踢人 / 观战 / 配置

test('房主退出转移；踢人后不能再进入；准备阶段改配置清空准备', async () => {
  const srv = await startServer();
  try {
    const [A, B, C, D] = [await srv.register('oa'), await srv.register('ob'), await srv.register('oc'), await srv.register('od')];
    const code = await createRoom(srv, A, { ...SMALL, actionSeconds: 30 });
    const [a, b, c, d] = [await srv.connect(A), await srv.connect(B), await srv.connect(C), await srv.connect(D)];
    await joinAndSit(a, code, 0);
    await joinAndSit(c, code); // 观战者，较早进入
    await joinAndSit(b, code, 5);
    await joinAndSit(d, code, 2);
    await b.ok('room.ready', { ready: true });
    await d.ok('room.ready', { ready: true });
    await a.waitState((s) => s.seats[5]?.ready && s.seats[2]?.ready, '准备');

    // 改配置：清空准备并通知全房间；initialChips 被忽略
    await b.fail('room.updateConfig', { config: { ante: 10 } }, 'NOT_OWNER');
    await a.fail('room.updateConfig', { config: { ante: 0 } }, 'BAD_CONFIG');
    const cfg = { ...a.state.config, ante: 10, initialChips: 777 };
    await a.ok('room.updateConfig', { config: cfg });
    const st = await b.waitState((s) => s.config.ante === 10, '配置更新');
    assert.equal(st.config.initialChips, 300);
    assert.ok(st.seats.filter(Boolean).every((s) => !s.ready));
    assert.ok(b.events.some((e) => e.kind === 'notice' && /重新准备/.test(e.text)));

    // 踢人：被踢者收到 kicked 事件，且无法再进入
    await c.ok('room.leave', {}).catch(() => {});
    await a.fail('room.kick', { userId: 'nope' }, 'INVALID_ACTION');
    await d.ok('room.ready', { ready: false });
    await a.ok('room.kick', { userId: D.user.userId, ban: true });
    await d.until(() => d.events.some((e) => e.kind === 'kicked'), '收到 kicked');
    await d.fail('room.join', { code }, 'BANNED');
    assert.equal((await srv.api('/api/me', { token: D.token })).roomCode, null);
    await a.waitState((s) => s.seats[2] === null, '座位已清空');

    // 房主退出：转给最早入座的在线玩家 B
    await a.ok('room.leave', {});
    const after = await b.waitState((s) => s.ownerId === B.user.userId, '房主转移给 B');
    assert.equal(after.me.isOwner, true);
    assert.ok(b.events.some((e) => e.kind === 'notice' && /成为房主/.test(e.text)));
    assert.equal((await srv.api('/api/me', { token: A.token })).roomCode, null);
    // 旧房主回来是普通观战者，不再有房主权限
    await a.ok('room.join', { code });
    await a.fail('room.kick', { userId: B.user.userId }, 'NOT_OWNER');
    // B 离开后，没有入座者，转给观战者（A 比 C 晚进入；C 已离开，所以是 A）
    await b.ok('room.leave', {});
    await a.waitState((s) => s.ownerId === A.user.userId, '房主转移给观战者');
  } finally {
    await srv.stop();
  }
});

test('观战者在一场进行中入座，等下一局才参与；本局中不能站起', async () => {
  const srv = await startServer();
  try {
    const [A, B, C] = [await srv.register('sa'), await srv.register('sb'), await srv.register('sc')];
    const code = await createRoom(srv, A, { ...SMALL, hands: 5, actionSeconds: 30 });
    const [a, b, c] = [await srv.connect(A), await srv.connect(B), await srv.connect(C)];
    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 1);
    await joinAndSit(c, code);
    await b.ok('room.ready', { ready: true });
    await a.ok('room.start', {});
    await c.waitState((s) => s.phase === 'playing' && s.hand && !s.hand.ended, '第 1 局');
    await c.fail('game.fold', {}, 'INVALID_ACTION');
    await c.ok('seat.sit', { seatIndex: 8 });
    const mid = await c.waitState((s) => s.seats[8], '入座');
    assert.equal(mid.seats[8].status, 'waitingNext');
    assert.equal(mid.hand.players.length, 2);
    assert.equal(mid.hand.myCards, null);
    // 对局中不能站起
    await a.fail('seat.stand', {}, 'IN_HAND');
    // 让这一局结束：B 弃牌
    await b.ok('game.fold', {});
    const ended = await c.waitState((s) => s.hand.ended, '第 1 局结束');
    assert.equal(ended.hand.handNo, 1);
    // 下一局 C 参与
    const next = await c.waitState((s) => s.hand.handNo === 2 && !s.hand.ended, '第 2 局');
    assert.equal(next.hand.players.length, 3, JSON.stringify({ seats: next.seats.filter(Boolean), players: next.hand.players }));
    assert.equal(next.seats[8].status, 'playing');
    assert.equal(next.seats[8].chips, 300 - 5);
    // 局间可以站起（等本局结束），站起后积分保留
  } finally {
    await srv.stop();
  }
});

test('局间站起并重新入座，恢复同一场的积分', async () => {
  const srv = await startServer({ timing: { nextHandDelayMs: 600 } });
  try {
    const [A, B] = [await srv.register('ga'), await srv.register('gb')];
    const code = await createRoom(srv, A, { ...SMALL, hands: 5, actionSeconds: 30 });
    const [a, b] = [await srv.connect(A), await srv.connect(B)];
    await joinAndSit(a, code, 0);
    await joinAndSit(b, code, 1);
    await b.ok('room.ready', { ready: true });
    await a.ok('room.start', {});
    await b.waitState((s) => s.hand && !s.hand.ended, '开局');
    await a.ok('game.fold', {}); // A 弃牌，B 赢
    await b.waitState((s) => s.hand.ended, '本局结束');
    const chipsBefore = a.state.seats[0].chips;
    assert.equal(chipsBefore, 295);
    await a.ok('seat.stand', {});
    await a.waitState((s) => s.seats[0] === null, '已站起');
    await a.ok('seat.sit', { seatIndex: 4 });
    const s = await a.waitState((st) => st.seats[4], '重新入座');
    assert.equal(s.seats[4].chips, chipsBefore);
    // 在场的赢家 B 可以亮牌（NO bonus 时才有 showable）
    assert.equal(b.state.hand.result.reason, 'lastStanding');
  } finally {
    await srv.stop();
  }
});
