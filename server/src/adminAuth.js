// 管理员账号与 token：账号来自环境变量，token 存在 admin_tokens 表，与玩家 token 完全独立
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { err } from './errors.js';

export const ADMIN_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 10;

const sha = (s) => createHash('sha256').update(String(s)).digest();

export class AdminAuth {
  /**
   * @param {object} db openDb() 的返回值
   * @param {{username?: string, password?: string, now?: () => number}} [opts]
   */
  constructor(db, { username = 'admin', password = 'admin', now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    this.username = String(username);
    this.password = String(password);
    this.fails = new Map(); // 客户端标识 -> { count, since }
  }

  /** 使用的是默认口令 admin / admin（启动时提示修改） */
  get isDefaultCredential() {
    return this.username === 'admin' && this.password === 'admin';
  }

  _checkThrottle(key) {
    const f = this.fails.get(key);
    if (!f) return;
    if (this.now() - f.since > FAIL_WINDOW_MS) {
      this.fails.delete(key);
      return;
    }
    if (f.count >= FAIL_LIMIT) throw err('TOO_MANY_ATTEMPTS', '登录失败次数过多，请稍后再试', 429);
  }

  _fail(key) {
    const f = this.fails.get(key);
    if (!f || this.now() - f.since > FAIL_WINDOW_MS) this.fails.set(key, { count: 1, since: this.now() });
    else f.count++;
    if (this.fails.size > 1000) this.fails.clear();
  }

  /** 账号密码正确则签发 token，否则 401 BAD_CREDENTIALS。key 用于限制同一来源的连续失败次数 */
  login(username, password, key = '-') {
    this._checkThrottle(key);
    const ok =
      typeof username === 'string' &&
      typeof password === 'string' &&
      // 两项都比较，避免通过耗时差异探测
      timingSafeEqual(sha(username), sha(this.username)) & timingSafeEqual(sha(password), sha(this.password));
    if (!ok) {
      this._fail(key);
      throw err('BAD_CREDENTIALS', '账号或密码错误', 401);
    }
    this.fails.delete(key);
    const token = randomBytes(32).toString('hex');
    const t = this.now();
    this.db.admin.insertAdminToken(token, t, t + ADMIN_TOKEN_TTL_MS);
    return token;
  }

  verify(token) {
    if (typeof token !== 'string' || token.length !== 64) return false;
    const row = this.db.admin.getAdminToken(token);
    if (!row) return false;
    if (row.expires_at < this.now()) {
      this.db.admin.deleteAdminToken(token);
      return false;
    }
    return true;
  }

  logout(token) {
    this.db.admin.deleteAdminToken(token);
  }
}
