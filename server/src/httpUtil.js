// HTTP 小工具：JSON 响应与请求体解析
import { err } from './errors.js';

const MAX_BODY = 64 * 1024;

export function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

export function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(err('BAD_REQUEST', '请求内容太大', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolveBody(v && typeof v === 'object' ? v : {});
      } catch {
        reject(err('BAD_REQUEST', '请求内容不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}
