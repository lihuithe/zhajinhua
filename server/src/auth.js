// 账号：注册、登录、token、昵称、声音包
import { randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { err } from './errors.js';
import { isVoiceId } from './voices.js';

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 64, (e, key) => (e ? reject(e) : resolve(key)));
  });
}

export function toUser(row) {
  return { userId: row.id, username: row.username, nickname: row.nickname, voice: row.voice || null };
}

// 昵称：1–12 个字符，去掉首尾空白，不允许控制字符
export function validateNickname(raw) {
  if (typeof raw !== 'string') throw err('BAD_NICKNAME', '昵称格式不正确');
  const nick = raw.trim();
  const len = Array.from(nick).length;
  if (len < 1 || len > 12) throw err('BAD_NICKNAME', '昵称长度必须是 1–12 个字符');
  if (/[\u0000-\u001f\u007f]/.test(nick)) throw err('BAD_NICKNAME', '昵称包含不允许的字符');
  return nick;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 4 || password.length > 64) {
    throw err('BAD_PASSWORD', '密码长度必须是 4–64 位');
  }
}

export class Auth {
  constructor(db, now = Date.now) {
    this.db = db;
    this.now = now;
  }

  _issueToken(userId) {
    const token = randomBytes(32).toString('hex');
    const t = this.now();
    this.db.replaceToken(userId, token, t, t + TOKEN_TTL_MS);
    this.db.touchLogin(userId, t);
    return token;
  }

  async register(username, password) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw err('BAD_USERNAME', '账号 ID 必须是 3–16 位字母、数字或下划线');
    }
    validatePassword(password);
    if (this.db.getUserByName(username)) throw err('USERNAME_TAKEN', '这个账号 ID 已经被注册了', 409);
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt);
    const id = 'u' + randomUUID().replace(/-/g, '').slice(0, 16);
    try {
      this.db.insertUser({ id, username, nickname: username, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: this.now() });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw err('USERNAME_TAKEN', '这个账号 ID 已经被注册了', 409);
      throw e;
    }
    const row = this.db.getUserById(id);
    return { token: this._issueToken(id), user: toUser(row) };
  }

  async login(username, password) {
    const bad = () => err('BAD_CREDENTIALS', '账号或密码错误', 401);
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) throw bad();
    const row = this.db.getUserByName(username);
    if (!row) {
      // 对不存在的账号也做一次哈希，避免通过耗时差异探测账号
      await scryptAsync(password, Buffer.alloc(16));
      throw bad();
    }
    const hash = await scryptAsync(password, Buffer.from(row.pass_salt, 'hex'));
    const expect = Buffer.from(row.pass_hash, 'hex');
    if (hash.length !== expect.length || !timingSafeEqual(hash, expect)) throw bad();
    if (row.banned) throw err('BANNED', '账号已被封禁', 403);
    return { token: this._issueToken(row.id), user: toUser(row) };
  }

  /** 返回用户行，token 无效或过期返回 null */
  verifyToken(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const t = this.db.getToken(token);
    if (!t) return null;
    if (t.expires_at < this.now()) {
      this.db.deleteToken(token);
      return null;
    }
    const user = this.db.getUserById(t.user_id);
    return user && !user.banned ? user : null;
  }

  logout(token) {
    this.db.deleteToken(token);
  }

  /** 管理员重置密码：作废该用户全部 token */
  async resetPassword(userId, password) {
    validatePassword(password);
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt);
    this.db.resetPassword(userId, salt.toString('hex'), hash.toString('hex'));
  }

  /** 管理员封禁 / 解封：封禁时作废全部 token */
  setBanned(userId, banned) {
    this.db.setBanned(userId, banned);
    if (banned) this.db.deleteUserTokens(userId);
  }

  setNickname(userId, raw) {
    const nick = validateNickname(raw);
    this.db.setNickname(userId, nick);
    return toUser(this.db.getUserById(userId));
  }

  /** 设置喊话声音包：voice 为 VOICE_IDS 之一，null 表示恢复默认 */
  setVoice(userId, voice) {
    if (voice !== null && !isVoiceId(voice)) throw err('BAD_VOICE', '不支持的声音');
    this.db.setVoice(userId, voice);
    return toUser(this.db.getUserById(userId));
  }
}
