// WebSocket：连接鉴权、顶号、心跳清理、请求分发
import { WebSocketServer } from 'ws';
import { AppError } from './errors.js';

const MAX_PAYLOAD = 16 * 1024;
const MAX_BUFFERED = 2 * 1024 * 1024;
const MAX_MSG_PER_SEC = 40;

export class WsHub {
  /**
   * @param {object} opts
   * @param {import('./auth.js').Auth} opts.auth
   * @param {() => import('./room/roomManager.js').RoomManager} opts.getManager
   * @param {number} [opts.heartbeatMs] 协议层 ping 间隔
   * @param {number} [opts.deadMs] 超过多久没有任何响应就断开
   * @param {() => object} [opts.getSys] 连接建立后立即下发的 sys 消息内容
   */
  constructor({ auth, getManager, getSys, heartbeatMs = 15000, deadMs = 45000 }) {
    this.auth = auth;
    this.getSys = getSys;
    this.closing = false; // 进程正在关闭：断开连接不再更新房间在线状态
    this.getManager = getManager;
    this.heartbeatMs = heartbeatMs;
    this.deadMs = deadMs;
    this.conns = new Map(); // userId -> ws（同一账号只保留一条连接）
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
    this.timer = setInterval(() => this._heartbeat(), heartbeatMs);
    this.timer.unref?.();
  }

  attach(server) {
    this._onUpgrade = (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this._onConnection(ws, url.searchParams.get('token')));
    };
    server.on('upgrade', this._onUpgrade);
    this.server = server;
  }

  send(userId, msg) {
    const ws = this.conns.get(userId);
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_BUFFERED) {
      ws.terminate(); // 客户端读不动了，避免内存堆积
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  /** 向所有在线连接推送同一条消息 */
  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.conns.values()) {
      if (ws.readyState !== 1) continue;
      if (ws.bufferedAmount > MAX_BUFFERED) {
        ws.terminate();
        continue;
      }
      ws.send(text);
    }
  }

  isOnline(userId) {
    const ws = this.conns.get(userId);
    return !!ws && ws.readyState === 1;
  }

  /** 当前在线（有有效连接）的用户数 */
  onlineCount() {
    let n = 0;
    for (const ws of this.conns.values()) if (ws.readyState === 1) n++;
    return n;
  }

  /** 主动断开某用户的连接（如退出登录、被封禁） */
  closeUser(userId, code = 4001, reason = 'logout') {
    const ws = this.conns.get(userId);
    if (!ws) return;
    ws.close(code, reason);
    // 对端不回应关闭帧时，几秒后强制断开
    const t = setTimeout(() => ws.terminate(), 3000);
    t.unref?.();
    ws.once('close', () => clearTimeout(t));
  }

  /**
   * 进程关闭：用 code 关闭所有连接（默认 1012 Service Restart），等对端确认关闭帧，超时则强制断开。
   * 之后的断线不再更新房间在线状态（房间状态已写入快照）。
   */
  /** 进入关闭流程：此后的请求一律拒绝，断线不再更新房间在线状态 */
  beginClose() {
    this.closing = true;
  }

  async closeAll(code = 1012, reason = 'restart', waitMs = 1500) {
    this.closing = true;
    const pending = [];
    for (const ws of this.wss.clients) {
      if (ws.readyState === 3) continue;
      pending.push(new Promise((resolve) => ws.once('close', resolve)));
      try {
        ws.close(code, reason);
      } catch {
        ws.terminate();
      }
    }
    if (!pending.length) return;
    let timer;
    await Promise.race([Promise.all(pending), new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
    clearTimeout(timer);
    for (const ws of this.wss.clients) ws.terminate();
  }

  _onConnection(ws, token) {
    if (this.closing) {
      ws.close(1012, 'restart');
      return;
    }
    const user = this.auth.verifyToken(token);
    if (!user) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const userId = user.id;
    const old = this.conns.get(userId);
    if (old) {
      old.replaced = true;
      try {
        old.send(JSON.stringify({ type: 'replaced' }));
      } catch {
        /* 忽略 */
      }
      old.close(4002, 'replaced');
    }
    ws.userId = userId;
    ws.lastSeen = Date.now();
    ws.rateTs = 0;
    ws.rateCount = 0;
    this.conns.set(userId, ws);
    if (this.getSys) {
      try {
        this._raw(ws, { type: 'sys', data: this.getSys() });
      } catch (e) {
        console.error('下发 sys 出错', e);
      }
    }

    ws.on('pong', () => {
      ws.lastSeen = Date.now();
    });
    ws.on('message', (data) => {
      ws.lastSeen = Date.now();
      this._onMessage(ws, data);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.conns.get(userId) === ws) {
        this.conns.delete(userId);
        if (this.closing) return;
        try {
          this.getManager().onDisconnect(userId);
        } catch (e) {
          console.error('处理断线出错', e);
        }
      }
    });

    try {
      this.getManager().onConnect(userId);
    } catch (e) {
      console.error('处理连接出错', e);
    }
  }

  _onMessage(ws, data) {
    if (this.conns.get(ws.userId) !== ws) return; // 已被顶号的旧连接
    if (this.closing) {
      // 快照已写入，此后的操作不会被保留，明确告知客户端
      let id;
      try {
        id = JSON.parse(data.toString()).id;
      } catch {
        return;
      }
      this._raw(ws, { type: 'res', id, ok: false, error: { code: 'SERVER_RESTARTING', message: '服务器正在更新，请稍后重试' } });
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (ws.rateTs !== nowSec) {
      ws.rateTs = nowSec;
      ws.rateCount = 0;
    }
    if (++ws.rateCount > MAX_MSG_PER_SEC) {
      ws.close(1008, 'too many messages');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      this._raw(ws, { type: 'pong', serverTime: Date.now() });
      return;
    }
    if (msg.type !== 'req') return;
    const id = msg.id;
    const userId = ws.userId;
    try {
      if (typeof msg.action !== 'string') throw new AppError('BAD_REQUEST', '请求格式不正确');
      const manager = this.getManager();
      let result;
      if (msg.action === 'room.join') {
        const row = this.auth.db.getUserById(userId);
        if (!row) throw new AppError('UNAUTHORIZED', '账号不存在', 401);
        result = manager.join(userId, row.nickname, msg.data && msg.data.code, row.voice || null);
      } else {
        result = manager.handle(userId, msg.action, msg.data);
      }
      this._raw(ws, { type: 'res', id, ok: true, data: result || {} });
    } catch (e) {
      if (e instanceof AppError) {
        this._raw(ws, { type: 'res', id, ok: false, error: { code: e.code, message: e.message } });
      } else {
        console.error('处理请求出错', msg.action, e);
        this._raw(ws, { type: 'res', id, ok: false, error: { code: 'INTERNAL', message: '服务器内部错误' } });
      }
    }
  }

  _raw(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  _heartbeat() {
    const now = Date.now();
    for (const ws of this.wss.clients) {
      if (now - ws.lastSeen > this.deadMs) {
        ws.terminate();
        continue;
      }
      try {
        ws.ping();
      } catch {
        /* 忽略 */
      }
    }
  }

  close() {
    clearInterval(this.timer);
    if (this.server && this._onUpgrade) this.server.off('upgrade', this._onUpgrade);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.conns.clear();
  }
}
