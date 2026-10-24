// 管理后台 HTTP 接口（/api/admin/*）。契约见 docs/ADMIN.md 第 4 节。
// 原则：后台看不到进行中那一局的手牌；局结束后的对局记录才含牌面。
import { err } from './errors.js';
import { sendJson, readJson } from './httpUtil.js';

const OK = { ok: true };

function parsePaging(url) {
  const num = (k, def) => {
    const raw = url.searchParams.get(k);
    if (raw === null || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw err('BAD_REQUEST', `${k} 必须是正整数`);
    return n;
  };
  return { page: num('page', 1), size: Math.min(num('size', 20), 100) };
}

function pagedBody(total, paging, items) {
  return { ok: true, total, page: paging.page, size: paging.size, items };
}

function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    throw err('NOT_FOUND', '接口不存在', 404);
  }
}

function startOfToday(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/**
 * @param {object} deps { db, adminAuth, auth, manager, hub, system, snapshotter, startedAt, version, now }
 * @returns {(req, res, path: string) => Promise<void>}
 */
export function createAdminHandler({ db, adminAuth, auth, manager, hub, system, snapshotter, startedAt, version, now = Date.now }) {
  const store = db.admin;

  function serverInfo() {
    return {
      version,
      startedAt,
      uptimeSec: Math.floor((now() - startedAt) / 1000),
      memoryMB: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
      node: process.version,
      pid: process.pid,
    };
  }

  function adminUser(row) {
    const s = store.userStats(row.id);
    const room = manager.roomOf(row.id);
    return {
      userId: row.id,
      username: row.username,
      nickname: row.nickname,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
      banned: !!row.banned,
      online: hub.isOnline(row.id),
      roomCode: room ? room.code : null,
      sessions: s.sessions,
      hands: s.hands,
      net: s.net,
    };
  }

  /** rec：room_records 行（可能为 null）；room：内存中的房间（可能为 null） */
  function adminRoom(rec, room) {
    const cfg = room ? room.config : safeJson(rec.config_json, {});
    let ownerNickname = rec ? rec.owner_nickname : '';
    if (room) {
      const owner = room.members.get(room.ownerId);
      if (owner) ownerNickname = owner.nickname;
    }
    return {
      code: rec ? rec.code : room.code,
      ownerId: rec ? rec.owner_id : room.ownerId,
      ownerNickname,
      createdAt: rec ? rec.created_at : room.createdAt,
      destroyedAt: rec ? rec.destroyed_at ?? null : null,
      lastActiveAt: rec ? rec.last_active_at ?? null : null,
      live: !!room,
      phase: room ? room.phase : null,
      seated: room ? room.seatedCount : 0,
      spectators: room ? room.spectatorCount : 0,
      online: room ? room.onlineCount() : 0,
      // 已销毁的房间没有当前场 / 局：场次号记为已打完的场数，局号为 0
      sessionNo: room ? room.sessionNo : rec ? rec.sessions_played : 0,
      handNo: room ? room.handNo : 0,
      hands: cfg.hands ?? 0,
      sessionsPlayed: rec ? rec.sessions_played : 0,
      handsPlayed: rec ? rec.hands_played : 0,
      peakSeated: rec ? rec.peak_seated : room ? room.seatedCount : 0,
    };
  }

  function requireAdmin(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    const token = m ? m[1] : null;
    if (!token || !adminAuth.verify(token)) throw err('UNAUTHORIZED', '管理员登录已失效，请重新登录', 401);
    return token;
  }

  function userOr404(userId) {
    const row = db.getUserById(userId);
    if (!row) throw err('NOT_FOUND', '用户不存在', 404);
    return row;
  }

  function noticeId(s) {
    const id = Number(s);
    if (!Number.isInteger(id) || id < 1) throw err('NOT_FOUND', '通知不存在', 404);
    return id;
  }

  return async function handleAdmin(req, res, path) {
    const method = req.method;
    const url = new URL(req.url, 'http://localhost');

    if (path === '/api/admin/login' && method === 'POST') {
      const b = await readJson(req);
      const token = adminAuth.login(b.username, b.password, req.socket.remoteAddress || '-');
      return sendJson(res, 200, { ok: true, token });
    }

    const token = requireAdmin(req);
    let m;

    if (path === '/api/admin/logout' && method === 'POST') {
      adminAuth.logout(token);
      return sendJson(res, 200, OK);
    }

    if (path === '/api/admin/overview' && method === 'GET') {
      const rooms = [...manager.rooms.values()];
      const stats = {
        ...store.stats(startOfToday(now())),
        online: hub.onlineCount(),
        roomsLive: rooms.length,
        roomsPlaying: rooms.filter((r) => r.phase === 'playing').length,
      };
      return sendJson(res, 200, { ok: true, stats, server: serverInfo(), maintenance: system.getMaintenance() });
    }

    // ---------------- 用户
    if (path === '/api/admin/users' && method === 'GET') {
      const paging = parsePaging(url);
      const kw = (url.searchParams.get('q') || '').trim();
      const { total, rows } = store.listUsers({ q: kw, ...paging });
      return sendJson(res, 200, pagedBody(total, paging, rows.map(adminUser)));
    }
    if ((m = /^\/api\/admin\/users\/([^/]+)$/.exec(path)) && method === 'GET') {
      const row = userOr404(dec(m[1]));
      return sendJson(res, 200, { ok: true, user: adminUser(row), sessions: store.userSessions(row.id) });
    }
    if ((m = /^\/api\/admin\/users\/([^/]+)\/password$/.exec(path)) && method === 'POST') {
      const row = userOr404(dec(m[1]));
      const b = await readJson(req);
      await auth.resetPassword(row.id, b.password);
      hub.closeUser(row.id, 4001, 'password reset');
      return sendJson(res, 200, OK);
    }
    if ((m = /^\/api\/admin\/users\/([^/]+)\/ban$/.exec(path)) && method === 'POST') {
      const row = userOr404(dec(m[1]));
      const b = await readJson(req);
      if (typeof b.banned !== 'boolean') throw err('BAD_REQUEST', 'banned 必须是布尔值');
      auth.setBanned(row.id, b.banned);
      if (b.banned) hub.closeUser(row.id, 4001, 'banned');
      return sendJson(res, 200, { ok: true, user: adminUser(db.getUserById(row.id)) });
    }

    // ---------------- 房间
    if (path === '/api/admin/rooms' && method === 'GET') {
      const paging = parsePaging(url);
      const status = url.searchParams.get('status') || 'all';
      if (status !== 'live' && status !== 'all') throw err('BAD_REQUEST', 'status 必须是 live 或 all');
      const kw = (url.searchParams.get('q') || '').trim();
      if (status === 'live') {
        const lc = kw.toLowerCase();
        let items = [...manager.rooms.values()].map((room) => adminRoom(store.getRoomRecord(room.code), room));
        if (lc) items = items.filter((r) => r.code.toLowerCase().includes(lc) || r.ownerNickname.toLowerCase().includes(lc));
        items.sort((a, b) => b.createdAt - a.createdAt);
        const start = (paging.page - 1) * paging.size;
        return sendJson(res, 200, pagedBody(items.length, paging, items.slice(start, start + paging.size)));
      }
      const { total, rows } = store.listRoomRecords({ q: kw, ...paging });
      return sendJson(res, 200, pagedBody(total, paging, rows.map((rec) => adminRoom(rec, manager.getRoom(rec.code)))));
    }
    if ((m = /^\/api\/admin\/rooms\/([^/]+)$/.exec(path)) && method === 'GET') {
      const code = dec(m[1]);
      const room = manager.getRoom(code);
      const rec = store.getRoomRecord(code);
      if (!room && !rec) throw err('NOT_FOUND', '房间不存在', 404);
      const view = adminRoom(rec, room);
      return sendJson(res, 200, {
        ok: true,
        room: view,
        config: room ? room.config : safeJson(rec.config_json, {}),
        live: room ? room.adminView() : null,
        sessions: store.roomSessions(code),
        hands: store.roomHands(code),
      });
    }
    if ((m = /^\/api\/admin\/rooms\/([^/]+)\/dissolve$/.exec(path)) && method === 'POST') {
      const code = dec(m[1]);
      const b = await readJson(req);
      let reason = '';
      if (b.reason !== undefined && b.reason !== null) {
        if (typeof b.reason !== 'string') throw err('BAD_REQUEST', 'reason 必须是字符串');
        reason = b.reason.trim();
        if (Array.from(reason).length > 100) throw err('BAD_REQUEST', '原因最多 100 个字');
      }
      const text = reason ? `房间已被管理员解散：${reason}` : '房间已被管理员解散';
      if (!manager.dissolveRoom(code, text)) throw err('ROOM_NOT_FOUND', '房间不存在或已销毁', 404);
      return sendJson(res, 200, OK);
    }

    // ---------------- 场次与对局
    if (path === '/api/admin/sessions' && method === 'GET') {
      const paging = parsePaging(url);
      const { total, items } = store.listSessions({
        room: (url.searchParams.get('room') || '').trim(),
        user: (url.searchParams.get('user') || '').trim(),
        ...paging,
      });
      return sendJson(res, 200, pagedBody(total, paging, items));
    }
    if (path === '/api/admin/hands' && method === 'GET') {
      const paging = parsePaging(url);
      const room = (url.searchParams.get('room') || '').trim();
      const sessionRaw = url.searchParams.get('session');
      let session;
      if (sessionRaw !== null && sessionRaw !== '') {
        session = Number(sessionRaw);
        if (!Number.isInteger(session) || session < 1) throw err('BAD_REQUEST', 'session 必须是正整数');
        if (!room) throw err('BAD_REQUEST', 'session 需要配合 room 使用');
      }
      const { total, items } = store.listHands({ room, session, user: (url.searchParams.get('user') || '').trim(), ...paging });
      return sendJson(res, 200, pagedBody(total, paging, items));
    }
    if ((m = /^\/api\/admin\/hands\/(\d+)$/.exec(path)) && method === 'GET') {
      const hand = store.getHandDetail(Number(m[1]));
      if (!hand) throw err('NOT_FOUND', '对局记录不存在', 404);
      return sendJson(res, 200, { ok: true, hand });
    }

    // ---------------- 通知
    if (path === '/api/admin/notices' && method === 'GET') {
      return sendJson(res, 200, { ok: true, items: system.listNotices() });
    }
    if (path === '/api/admin/notices' && method === 'POST') {
      const notice = system.createNotice(await readJson(req));
      return sendJson(res, 200, { ok: true, notice });
    }
    if ((m = /^\/api\/admin\/notices\/([^/]+)$/.exec(path))) {
      if (method === 'PUT') {
        const notice = system.updateNotice(noticeId(m[1]), await readJson(req));
        return sendJson(res, 200, { ok: true, notice });
      }
      if (method === 'DELETE') {
        system.deleteNotice(noticeId(m[1]));
        return sendJson(res, 200, OK);
      }
    }

    // ---------------- 系统
    if (path === '/api/admin/system' && method === 'GET') {
      return sendJson(res, 200, { ok: true, maintenance: system.getMaintenance(), server: serverInfo(), snapshot: snapshotter.status() });
    }
    if (path === '/api/admin/system/maintenance' && method === 'POST') {
      const maintenance = system.setMaintenance(await readJson(req));
      return sendJson(res, 200, { ok: true, maintenance });
    }

    throw err('NOT_FOUND', '接口不存在', 404);
  };
}
