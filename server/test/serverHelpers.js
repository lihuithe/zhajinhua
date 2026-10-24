// 集成测试辅助（后台 / 快照 / 维护模式测试共用）：启动真实服务、HTTP 调用、ws 客户端。本文件不含测试用例
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';

export const SMALL = { hands: 3, initialChips: 300, ante: 5, raiseSteps: [2, 5, 10], capMultiple: 10, maxRounds: 5, actionSeconds: 10 };

/**
 * 启动服务。dir 不传则新建临时目录；传入时复用（用于模拟重启），stop() 不会删除它，由调用方清理。
 */
export async function startServer({ dir, appOpts = {} } = {}) {
  const ownDir = !dir;
  dir = dir || mkdtempSync(join(tmpdir(), 'zjh-test-'));
  const app = await createApp({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    adminUsername: 'boss',
    adminPassword: 'secret-pass',
    version: 'test-1',
    ...appOpts,
    timing: { nextHandDelayMs: 40, dealMs: 0, ...(appOpts.timing || {}) },
  });
  const base = `http://127.0.0.1:${app.port}`;
  const clients = [];
  const ctx = {
    app,
    base,
    dir,
    clients,
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
      if (name.length < 3) name += '_x';
      const r = await ctx.api('/api/register', { method: 'POST', body: { username: name, password } });
      assert.equal(r.ok, true, `注册失败：${JSON.stringify(r)}`);
      return { name, password, token: r.token, user: r.user };
    },
    async connect(account) {
      const c = new Client(`ws://127.0.0.1:${app.port}/ws?token=${account.token}`, account);
      clients.push(c);
      await c.opened;
      return c;
    },
    /** 管理员登录，返回 token */
    async adminLogin() {
      const r = await ctx.api('/api/admin/login', { method: 'POST', body: { username: 'boss', password: 'secret-pass' } });
      assert.equal(r.ok, true, JSON.stringify(r));
      return r.token;
    },
    async admin(path, opts = {}) {
      ctx.adminToken ||= await ctx.adminLogin();
      return ctx.api(path, { ...opts, token: ctx.adminToken });
    },
    async stop({ keepDir = false } = {}) {
      for (const c of clients) c.ws.terminate();
      await app.close();
      if (ownDir && !keepDir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return ctx;
}

export class Client {
  constructor(url, account) {
    this.account = account;
    this.state = null;
    this.states = [];
    this.events = [];
    this.msgs = [];
    this.pending = new Map();
    this.waiters = [];
    this.seq = 0;
    this.closeInfo = null;
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve) => {
      this.ws.once('open', resolve);
      this.ws.once('close', resolve);
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
    } else if (msg.type === 'event') {
      this.events.push(msg.data);
    } else if (msg.type === 'sys') {
      this.sys = msg.data;
    }
    this._wake();
  }

  /** 所有收到的 sys 消息 */
  get sysMsgs() {
    return this.msgs.filter((m) => m.type === 'sys').map((m) => m.data);
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

  until(pred, what = '条件', timeout = 8000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: null };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`等待超时：${what}（${this.account.name}）`));
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

  async ok(action, data) {
    const r = await this.req(action, data);
    assert.equal(r.ok, true, `${action} 失败：${JSON.stringify(r.error)}`);
    return r.data;
  }

  async fail(action, data, code) {
    const r = await this.req(action, data);
    assert.equal(r.ok, false, `${action} 应该失败`);
    assert.equal(r.error.code, code, `${action} 错误码：${JSON.stringify(r.error)}`);
    return r.error;
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

export async function createRoom(srv, owner, config = SMALL) {
  const r = await srv.api('/api/rooms', { method: 'POST', token: owner.token, body: { config } });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.code;
}

export async function joinAndSit(c, code, seatIndex) {
  await c.ok('room.join', { code });
  await c.waitState((s) => s.code === code, '收到房间状态');
  if (seatIndex !== undefined) await c.ok('seat.sit', { seatIndex });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 所有人都跟注，直到全部客户端看到 finished */
export async function playOut(clients, timeout = 10000) {
  const t0 = Date.now();
  const acted = new Map();
  while (Date.now() - t0 < timeout) {
    if (clients.every((c) => c.state && c.state.phase === 'finished')) return;
    for (const c of clients) {
      const h = c.state && c.state.hand;
      if (!h || h.ended || !h.actions) continue;
      const key = `${c.state.sessionNo}:${h.handNo}:${h.round}:${h.turnDeadline}`;
      if (acted.get(c) === key) continue;
      acted.set(c, key);
      c.req(h.actions.call ? 'game.call' : 'game.fold').catch(() => {});
    }
    await sleep(15);
  }
  throw new Error('打牌超时');
}
