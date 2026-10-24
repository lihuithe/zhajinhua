// HTTP：API 路由、JSON 解析、静态文件、SPA 回退（只用 node:http）
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, sep, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AppError, err } from './errors.js';
import { sendJson, readJson } from './httpUtil.js';
import { getDefaults, LIMITS } from './config.js';
import { toUser } from './auth.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.webmanifest']);

/**
 * @param {object} deps { auth, manager, hub, staticDir, system, adminHandler, isClosing }
 */
export function createHttpHandler({ auth, manager, hub, staticDir, system, adminHandler, isClosing }) {
  const staticRoot = staticDir ? resolve(staticDir) : null;
  const cache = new Map(); // 小文件缓存：path -> { mtimeMs, size, buf, gz }

  function authUser(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    const token = m ? m[1] : null;
    const row = token ? auth.verifyToken(token) : null;
    if (!row) throw err('UNAUTHORIZED', '登录已失效，请重新登录', 401);
    return { row, token };
  }

  async function api(req, res, path) {
    const method = req.method;

    if (path === '/api/register' && method === 'POST') {
      const b = await readJson(req);
      const r = await auth.register(b.username, b.password);
      return sendJson(res, 200, { ok: true, ...r });
    }
    if (path === '/api/login' && method === 'POST') {
      const b = await readJson(req);
      const r = await auth.login(b.username, b.password);
      return sendJson(res, 200, { ok: true, ...r });
    }
    if (path === '/api/logout' && method === 'POST') {
      const { row, token } = authUser(req);
      auth.logout(token);
      hub.closeUser(row.id, 4001, 'logout');
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/me' && method === 'GET') {
      const { row } = authUser(req);
      const room = manager.roomOf(row.id);
      return sendJson(res, 200, {
        ok: true,
        user: toUser(row),
        roomCode: room ? room.code : null,
      });
    }
    if (path === '/api/me/nickname' && method === 'POST') {
      const { row } = authUser(req);
      const b = await readJson(req);
      const user = auth.setNickname(row.id, b.nickname);
      manager.updateNickname(row.id, user.nickname);
      return sendJson(res, 200, { ok: true, user });
    }
    if (path === '/api/me/voice' && method === 'POST') {
      const { row } = authUser(req);
      const b = await readJson(req);
      const user = auth.setVoice(row.id, b.voice);
      manager.updateVoice(row.id, user.voice);
      return sendJson(res, 200, { ok: true, user });
    }
    if (path === '/api/notices' && method === 'GET') {
      return sendJson(res, 200, { ok: true, ...system.payload() });
    }
    if (path.startsWith('/api/admin/')) return adminHandler(req, res, path);
    if (path === '/api/config/defaults' && method === 'GET') {
      return sendJson(res, 200, { ok: true, config: getDefaults(), limits: LIMITS });
    }
    if (path === '/api/rooms' && method === 'POST') {
      const { row } = authUser(req);
      const b = await readJson(req);
      const code = manager.createRoom(row.id, b.config, row.nickname);
      return sendJson(res, 200, { ok: true, code });
    }
    const m = /^\/api\/rooms\/([^/]+)$/.exec(path);
    if (m && method === 'GET') {
      authUser(req);
      let code;
      try {
        code = decodeURIComponent(m[1]).trim();
      } catch {
        code = '';
      }
      const room = manager.getRoom(code);
      if (!room) return sendJson(res, 200, { ok: true, exists: false, phase: null, seated: 0, spectators: 0 });
      return sendJson(res, 200, { ok: true, ...room.info() });
    }
    throw err('NOT_FOUND', '接口不存在', 404);
  }

  // ---------- 静态文件 ----------

  function serveFile(req, res, file, ext, st) {
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Vite 产物带 hash 的 assets 可长期缓存，html 每次都要校验
    headers['Cache-Control'] = ext === '.html' ? 'no-cache' : file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    const acceptGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (st.size <= 1024 * 1024) {
      let c = cache.get(file);
      if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
        const buf = readFileSync(file);
        c = { mtimeMs: st.mtimeMs, size: st.size, buf, gz: COMPRESSIBLE.has(ext) && buf.length > 256 ? gzipSync(buf) : null };
        if (cache.size > 200) cache.clear();
        cache.set(file, c);
      }
      let body = c.buf;
      if (acceptGzip && c.gz) {
        body = c.gz;
        headers['Content-Encoding'] = 'gzip';
      }
      headers.Vary = 'Accept-Encoding';
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      return res.end(body);
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  function serveStatic(req, res, path) {
    if (!staticRoot || !existsSync(join(staticRoot, 'index.html'))) {
      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '未找到页面（尚未部署前端）' } });
    }
    let rel;
    try {
      rel = decodeURIComponent(path);
    } catch {
      rel = '/';
    }
    if (rel.includes('\0')) rel = '/';
    const file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
      return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: '禁止访问' } });
    }
    let st = null;
    try {
      st = statSync(file);
    } catch {
      /* 不存在 */
    }
    if (st && st.isFile()) return serveFile(req, res, file, extname(file).toLowerCase(), st);
    // 带扩展名的静态资源不存在：404；其余走 SPA 回退
    const ext = extname(rel).toLowerCase();
    if (ext && ext !== '.html') {
      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '文件不存在' } });
    }
    const index = join(staticRoot, 'index.html');
    return serveFile(req, res, index, '.html', statSync(index));
  }

  return async function handler(req, res) {
    try {
      let path;
      try {
        path = new URL(req.url, 'http://localhost').pathname;
      } catch {
        return sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: '请求地址不正确' } });
      }
      if (path === '/api' || path.startsWith('/api/')) {
        if (isClosing?.()) throw err('SHUTTING_DOWN', '服务器正在更新，请稍后重试', 503);
        return await api(req, res, path);
      }
      if (path === '/ws') return sendJson(res, 426, { ok: false, error: { code: 'UPGRADE_REQUIRED', message: '请使用 WebSocket 连接' } });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法' } });
      }
      return serveStatic(req, res, path);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof AppError) {
        return sendJson(res, e.status, { ok: false, error: { code: e.code, message: e.message } });
      }
      console.error('HTTP 处理出错', req.method, req.url, e);
      return sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: '服务器内部错误' } });
    }
  };
}
