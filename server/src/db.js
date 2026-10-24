// SQLite（node:sqlite）：用户、登录 token、每场结算记录，以及后台所需的通知 / 设置 / 开房与对局记录
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminStore } from './dbAdmin.js';

export function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir && dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, 'zjh.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lc TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
    CREATE TABLE IF NOT EXISTS session_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      session_no INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      hands_played INTEGER NOT NULL,
      config_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_players (
      result_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      net INTEGER NOT NULL,
      final_chips INTEGER NOT NULL,
      best_type TEXT,
      wins INTEGER NOT NULL,
      PRIMARY KEY (result_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_players_user ON session_players(user_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_tokens (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'info',
      banner INTEGER NOT NULL DEFAULT 1,
      popup INTEGER NOT NULL DEFAULT 0,
      starts_at INTEGER,
      ends_at INTEGER,
      maint_start INTEGER,
      maint_end INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_records (
      code TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_nickname TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      destroyed_at INTEGER,
      sessions_played INTEGER NOT NULL DEFAULT 0,
      hands_played INTEGER NOT NULL DEFAULT 0,
      peak_seated INTEGER NOT NULL DEFAULT 0,
      last_active_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_room_records_created ON room_records(created_at);
    CREATE TABLE IF NOT EXISTS hand_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT NOT NULL,
      session_no INTEGER NOT NULL,
      hand_no INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      pot INTEGER NOT NULL,
      winners_json TEXT NOT NULL,
      players_json TEXT NOT NULL,
      log_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hand_records_room ON hand_records(room_code);
    CREATE INDEX IF NOT EXISTS idx_hand_records_ended ON hand_records(ended_at);
    CREATE TABLE IF NOT EXISTS hand_players (
      hand_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      PRIMARY KEY (hand_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hand_players_user ON hand_players(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_results_room ON session_results(room_code);
    CREATE INDEX IF NOT EXISTS idx_session_results_ended ON session_results(ended_at);
  `);

  // 兼容已有线上数据库：缺列时 ALTER 补上
  function ensureColumn(table, column, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
  ensureColumn('users', 'last_login_at', 'last_login_at INTEGER');
  ensureColumn('users', 'banned', 'banned INTEGER NOT NULL DEFAULT 0');
  ensureColumn('session_results', 'started_at', 'started_at INTEGER');
  ensureColumn('users', 'voice', 'voice TEXT'); // 喊话声音包 id，null 表示跟随前端默认

  const q = {
    insertUser: db.prepare('INSERT INTO users (id, username, username_lc, nickname, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    userByName: db.prepare('SELECT * FROM users WHERE username_lc = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setNickname: db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),
    setVoice: db.prepare('UPDATE users SET voice = ? WHERE id = ?'),
    insertToken: db.prepare('INSERT INTO tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    deleteUserTokens: db.prepare('DELETE FROM tokens WHERE user_id = ?'),
    deleteToken: db.prepare('DELETE FROM tokens WHERE token = ?'),
    tokenRow: db.prepare('SELECT user_id, expires_at FROM tokens WHERE token = ?'),
    purgeTokens: db.prepare('DELETE FROM tokens WHERE expires_at < ?'),
    insertResult: db.prepare('INSERT INTO session_results (room_code, session_no, ended_at, hands_played, config_json, started_at) VALUES (?, ?, ?, ?, ?, ?)'),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    setBanned: db.prepare('UPDATE users SET banned = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?'),
    insertResultPlayer: db.prepare('INSERT INTO session_players (result_id, user_id, nickname, net, final_chips, best_type, wins) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const admin = createAdminStore(db, tx);

  return {
    raw: db,
    insertUser: (u) => q.insertUser.run(u.id, u.username, u.username.toLowerCase(), u.nickname, u.salt, u.hash, u.createdAt),
    getUserByName: (name) => q.userByName.get(name.toLowerCase()),
    getUserById: (id) => q.userById.get(id),
    setNickname: (id, nickname) => q.setNickname.run(nickname, id),
    setVoice: (id, voice) => q.setVoice.run(voice, id),
    touchLogin: (id, now) => q.touchLogin.run(now, id),
    setBanned: (id, banned) => q.setBanned.run(banned ? 1 : 0, id),
    /** 重置密码并作废该用户全部 token */
    resetPassword(id, salt, hash) {
      tx(() => {
        q.setPassword.run(salt, hash, id);
        q.deleteUserTokens.run(id);
      });
    },
    deleteUserTokens: (id) => q.deleteUserTokens.run(id),
    /** 新登录作废该用户旧 token，再写入新 token */
    replaceToken(userId, token, now, expiresAt) {
      tx(() => {
        q.deleteUserTokens.run(userId);
        q.insertToken.run(token, userId, now, expiresAt);
      });
    },
    deleteToken: (token) => q.deleteToken.run(token),
    getToken: (token) => q.tokenRow.get(token),
    purgeExpiredTokens(now) {
      q.purgeTokens.run(now);
      admin.purgeAdminTokens(now);
    },
    saveSessionResult(roomCode, config, summary, startedAt = null) {
      tx(() => {
        const r = q.insertResult.run(roomCode, summary.sessionNo, summary.endedAt, summary.handsPlayed, JSON.stringify(config), startedAt);
        const id = Number(r.lastInsertRowid);
        for (const p of summary.players) {
          q.insertResultPlayer.run(id, p.userId, p.nickname, p.net, p.finalChips, p.bestType, p.wins);
        }
      });
    },
    admin,
    close: () => db.close(),
  };
}
