// 管理后台与记录相关的数据访问：设置、通知、管理员 token、开房记录、对局记录与各类查询
// 所有方法都是同步的（node:sqlite）

/** 把 LIKE 的通配符转义（配合 ESCAPE '\'） */
function likePattern(q) {
  return '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

function noticeFromRow(r) {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    level: r.level,
    banner: !!r.banner,
    popup: !!r.popup,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    maintStart: r.maint_start,
    maintEnd: r.maint_end,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function createAdminStore(db, tx) {
  const q = {
    getSetting: db.prepare('SELECT value_json FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'),

    insertAdminToken: db.prepare('INSERT INTO admin_tokens (token, created_at, expires_at) VALUES (?, ?, ?)'),
    adminToken: db.prepare('SELECT expires_at FROM admin_tokens WHERE token = ?'),
    deleteAdminToken: db.prepare('DELETE FROM admin_tokens WHERE token = ?'),
    purgeAdminTokens: db.prepare('DELETE FROM admin_tokens WHERE expires_at < ?'),

    insertNotice: db.prepare(
      'INSERT INTO notices (title, content, level, banner, popup, starts_at, ends_at, maint_start, maint_end, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    updateNotice: db.prepare(
      'UPDATE notices SET title = ?, content = ?, level = ?, banner = ?, popup = ?, starts_at = ?, ends_at = ?, maint_start = ?, maint_end = ?, enabled = ?, updated_at = ? WHERE id = ?',
    ),
    noticeById: db.prepare('SELECT * FROM notices WHERE id = ?'),
    deleteNotice: db.prepare('DELETE FROM notices WHERE id = ?'),
    allNotices: db.prepare('SELECT * FROM notices ORDER BY updated_at DESC, id DESC'),

    insertRoom: db.prepare(
      'INSERT OR REPLACE INTO room_records (code, owner_id, owner_nickname, config_json, created_at, destroyed_at, sessions_played, hands_played, peak_seated, last_active_at) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 0, ?)',
    ),
    ensureRoom: db.prepare(
      'INSERT OR IGNORE INTO room_records (code, owner_id, owner_nickname, config_json, created_at, destroyed_at, sessions_played, hands_played, peak_seated, last_active_at) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 0, ?)',
    ),
    reopenRoom: db.prepare('UPDATE room_records SET destroyed_at = NULL WHERE code = ?'),
    destroyRoom: db.prepare('UPDATE room_records SET destroyed_at = ? WHERE code = ? AND destroyed_at IS NULL'),
    openRooms: db.prepare('SELECT code, created_at, last_active_at FROM room_records WHERE destroyed_at IS NULL'),
    seatRoom: db.prepare('UPDATE room_records SET peak_seated = MAX(peak_seated, ?), last_active_at = ? WHERE code = ?'),
    sessionRoom: db.prepare('UPDATE room_records SET sessions_played = sessions_played + 1, last_active_at = ? WHERE code = ?'),
    handRoom: db.prepare('UPDATE room_records SET hands_played = hands_played + ?, last_active_at = ? WHERE code = ?'),
    roomByCode: db.prepare('SELECT * FROM room_records WHERE code = ? COLLATE NOCASE'),

    insertHand: db.prepare(
      'INSERT INTO hand_records (room_code, session_no, hand_no, started_at, ended_at, reason, pot, winners_json, players_json, log_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    insertHandPlayer: db.prepare('INSERT INTO hand_players (hand_id, user_id, delta) VALUES (?, ?, ?)'),
    handById: db.prepare('SELECT * FROM hand_records WHERE id = ?'),

    sessionPlayers: db.prepare('SELECT user_id, nickname, net, final_chips, best_type, wins FROM session_players WHERE result_id = ? ORDER BY net DESC'),
    userSessionStats: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(net), 0) AS net FROM session_players WHERE user_id = ?'),
    userHandCount: db.prepare(
      "SELECT COUNT(*) AS n FROM hand_players hp JOIN hand_records hr ON hr.id = hp.hand_id WHERE hp.user_id = ? AND hr.reason != 'voided'",
    ),
    userSessions: db.prepare(
      `SELECT sr.id, sr.room_code, sr.session_no, sr.ended_at, sp.net, sp.final_chips, sp.best_type, sp.wins
       FROM session_players sp JOIN session_results sr ON sr.id = sp.result_id
       WHERE sp.user_id = ? ORDER BY sr.ended_at DESC, sr.id DESC LIMIT 50`,
    ),
  };

  function count(sql, ...params) {
    return Number(db.prepare(sql).get(...params).n);
  }

  /** 通用分页：where 是不含 WHERE 关键字的条件（可空） */
  function page({ select, from, where = '', params = [], order, pageNo, size }) {
    const w = where ? ` WHERE ${where}` : '';
    const total = count(`SELECT COUNT(*) AS n FROM ${from}${w}`, ...params);
    const rows = db.prepare(`SELECT ${select} FROM ${from}${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, (pageNo - 1) * size);
    return { total, rows };
  }

  function sessionFromRow(r) {
    return {
      id: r.id,
      roomCode: r.room_code,
      sessionNo: r.session_no,
      startedAt: r.started_at ?? null,
      endedAt: r.ended_at,
      handsPlayed: r.hands_played,
      players: q.sessionPlayers.all(r.id).map((p) => ({
        userId: p.user_id,
        nickname: p.nickname,
        net: p.net,
        finalChips: p.final_chips,
        bestType: p.best_type,
        wins: p.wins,
      })),
    };
  }

  function handRowFromRow(r) {
    const w = parseJson(r.winners_json, {});
    return {
      id: r.id,
      roomCode: r.room_code,
      sessionNo: r.session_no,
      handNo: r.hand_no,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      reason: r.reason,
      pot: r.pot,
      winners: w.names || [],
      playerCount: r.player_count,
    };
  }

  const HAND_ROW_SELECT =
    'id, room_code, session_no, hand_no, started_at, ended_at, reason, pot, winners_json, (SELECT COUNT(*) FROM hand_players WHERE hand_id = hand_records.id) AS player_count';

  return {
    // ---------------- 设置
    getSetting(key, fallback = null) {
      const r = q.getSetting.get(key);
      return r ? parseJson(r.value_json, fallback) : fallback;
    },
    setSetting(key, value) {
      q.setSetting.run(key, JSON.stringify(value));
    },

    // ---------------- 管理员 token
    insertAdminToken: (token, now, expiresAt) => q.insertAdminToken.run(token, now, expiresAt),
    getAdminToken: (token) => q.adminToken.get(token),
    deleteAdminToken: (token) => q.deleteAdminToken.run(token),
    purgeAdminTokens: (now) => q.purgeAdminTokens.run(now),

    // ---------------- 通知
    listNotices: () => q.allNotices.all().map(noticeFromRow),
    getNotice(id) {
      const r = q.noticeById.get(id);
      return r ? noticeFromRow(r) : null;
    },
    insertNotice(n, now) {
      const r = q.insertNotice.run(n.title, n.content, n.level, n.banner ? 1 : 0, n.popup ? 1 : 0, n.startsAt, n.endsAt, n.maintStart, n.maintEnd, n.enabled ? 1 : 0, now, now);
      return noticeFromRow(q.noticeById.get(Number(r.lastInsertRowid)));
    },
    updateNotice(id, n, now) {
      q.updateNotice.run(n.title, n.content, n.level, n.banner ? 1 : 0, n.popup ? 1 : 0, n.startsAt, n.endsAt, n.maintStart, n.maintEnd, n.enabled ? 1 : 0, now, id);
      return noticeFromRow(q.noticeById.get(id));
    },
    deleteNotice: (id) => Number(q.deleteNotice.run(id).changes) > 0,

    // ---------------- 开房 / 对局记录
    roomCreated({ code, ownerId, ownerNickname, config, createdAt }) {
      q.insertRoom.run(code, ownerId, ownerNickname || '', JSON.stringify(config), createdAt, createdAt);
    },
    /** 恢复快照时：记录缺失则补上，已标记销毁的重新打开 */
    roomRestored({ code, ownerId, ownerNickname, config, createdAt }) {
      q.ensureRoom.run(code, ownerId, ownerNickname || '', JSON.stringify(config), createdAt, createdAt);
      q.reopenRoom.run(code);
    },
    roomDestroyed: (code, now) => q.destroyRoom.run(now, code),
    /** 把不在内存中却没有销毁时间的记录标为已销毁（上次进程退出时没带走的房间）；返回处理数量 */
    closeOrphanRooms(liveCodes, now) {
      const live = new Set(liveCodes);
      let n = 0;
      for (const r of q.openRooms.all()) {
        if (live.has(r.code)) continue;
        q.destroyRoom.run(Math.max(now, r.created_at), r.code);
        n++;
      }
      return n;
    },
    roomSeated: (code, seated, now) => q.seatRoom.run(seated, now, code),
    roomSessionEnded: (code, now) => q.sessionRoom.run(now, code),
    /** 写入一局记录（含 hand_players），并更新开房记录的局数；返回 hand id */
    recordHand(rec) {
      return tx(() => {
        const r = q.insertHand.run(
          rec.roomCode,
          rec.sessionNo,
          rec.handNo,
          rec.startedAt,
          rec.endedAt,
          rec.voided ? 'voided' : rec.reason,
          rec.pot,
          JSON.stringify(rec.winners),
          JSON.stringify(rec.players),
          JSON.stringify(rec.log),
        );
        const id = Number(r.lastInsertRowid);
        for (const p of rec.players) q.insertHandPlayer.run(id, p.userId, p.delta);
        q.handRoom.run(rec.voided ? 0 : 1, rec.endedAt, rec.roomCode);
        return id;
      });
    },

    // ---------------- 查询：概览
    stats(todayStart) {
      return {
        usersTotal: count('SELECT COUNT(*) AS n FROM users'),
        usersToday: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', todayStart),
        roomsToday: count('SELECT COUNT(*) AS n FROM room_records WHERE created_at >= ?', todayStart),
        sessionsToday: count('SELECT COUNT(*) AS n FROM session_results WHERE ended_at >= ?', todayStart),
        handsToday: count("SELECT COUNT(*) AS n FROM hand_records WHERE ended_at >= ? AND reason != 'voided'", todayStart),
        sessionsTotal: count('SELECT COUNT(*) AS n FROM session_results'),
        handsTotal: count("SELECT COUNT(*) AS n FROM hand_records WHERE reason != 'voided'"),
      };
    },

    // ---------------- 查询：用户
    listUsers({ q: kw, page: pageNo, size }) {
      let where = '';
      const params = [];
      if (kw) {
        where = "(username_lc LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\')";
        params.push(likePattern(kw.toLowerCase()), likePattern(kw));
      }
      return page({ select: '*', from: 'users', where, params, order: 'created_at DESC, id DESC', pageNo, size });
    },
    userStats(userId) {
      const s = q.userSessionStats.get(userId);
      return { sessions: Number(s.n), net: Number(s.net), hands: Number(q.userHandCount.get(userId).n) };
    },
    userSessions: (userId) =>
      q.userSessions.all(userId).map((r) => ({
        sessionId: r.id,
        roomCode: r.room_code,
        sessionNo: r.session_no,
        endedAt: r.ended_at,
        net: r.net,
        finalChips: r.final_chips,
        bestType: r.best_type,
        wins: r.wins,
      })),

    // ---------------- 查询：房间
    getRoomRecord: (code) => q.roomByCode.get(code) || null,
    listRoomRecords({ q: kw, page: pageNo, size }) {
      let where = '';
      const params = [];
      if (kw) {
        where = "(code LIKE ? ESCAPE '\\' OR owner_nickname LIKE ? ESCAPE '\\')";
        params.push(likePattern(kw), likePattern(kw));
      }
      return page({ select: '*', from: 'room_records', where, params, order: 'created_at DESC, code', pageNo, size });
    },

    // ---------------- 查询：场次与对局
    listSessions({ room, user, page: pageNo, size }) {
      const conds = [];
      const params = [];
      if (room) {
        conds.push('room_code = ? COLLATE NOCASE');
        params.push(room);
      }
      if (user) {
        conds.push('id IN (SELECT result_id FROM session_players WHERE user_id = ?)');
        params.push(user);
      }
      const { total, rows } = page({
        select: '*',
        from: 'session_results',
        where: conds.join(' AND '),
        params,
        order: 'ended_at DESC, id DESC',
        pageNo,
        size,
      });
      return { total, items: rows.map(sessionFromRow) };
    },
    roomSessions(code, limit = 50) {
      return db
        .prepare('SELECT * FROM session_results WHERE room_code = ? ORDER BY ended_at DESC, id DESC LIMIT ?')
        .all(code, limit)
        .map(sessionFromRow);
    },
    listHands({ room, session, user, page: pageNo, size }) {
      const conds = [];
      const params = [];
      if (room) {
        conds.push('room_code = ? COLLATE NOCASE');
        params.push(room);
      }
      if (session !== undefined && session !== null) {
        conds.push('session_no = ?');
        params.push(session);
      }
      if (user) {
        conds.push('id IN (SELECT hand_id FROM hand_players WHERE user_id = ?)');
        params.push(user);
      }
      const { total, rows } = page({
        select: HAND_ROW_SELECT,
        from: 'hand_records',
        where: conds.join(' AND '),
        params,
        order: 'ended_at DESC, id DESC',
        pageNo,
        size,
      });
      return { total, items: rows.map(handRowFromRow) };
    },
    roomHands(code, limit = 50) {
      return db
        .prepare(`SELECT ${HAND_ROW_SELECT} FROM hand_records WHERE room_code = ? ORDER BY ended_at DESC, id DESC LIMIT ?`)
        .all(code, limit)
        .map(handRowFromRow);
    },
    getHandDetail(id) {
      const r = q.handById.get(id);
      if (!r) return null;
      const players = parseJson(r.players_json, []);
      const row = handRowFromRow({ ...r, player_count: players.length });
      const w = parseJson(r.winners_json, {});
      return { ...row, players, log: parseJson(r.log_json, []), winnerSeats: w.seats || [] };
    },
  };
}
