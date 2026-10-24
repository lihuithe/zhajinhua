// 启动入口。环境变量：PORT、HOST、DATA_DIR、STATIC_DIR、ADMIN_USERNAME、ADMIN_PASSWORD、RESTORE_SNAPSHOT
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { loadEnv } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const dataDir = resolve(env.dataDir || join(here, '..', 'data'));
const staticDir = resolve(env.staticDir || join(here, '..', '..', 'client', 'dist'));

const app = await createApp({
  port: env.port,
  host: env.host,
  dataDir,
  staticDir,
  adminUsername: env.adminUsername,
  adminPassword: env.adminPassword,
  restore: env.restoreSnapshot,
});
console.log(`炸金花服务已启动：http://${env.host}:${app.port}（版本 ${app.version}）`);
console.log(`数据目录：${dataDir}`);
console.log(existsSync(staticDir) ? `静态文件：${staticDir}` : `静态文件目录不存在（${staticDir}），仅提供 API`);
if (app.adminAuth.isDefaultCredential) console.warn('警告：管理员账号仍是默认的 admin / admin，请设置环境变量 ADMIN_USERNAME / ADMIN_PASSWORD');

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`收到 ${sig}，正在关闭…`);
  // 兜底：快照写完之后才开始计时，避免写快照的时间被算进去
  try {
    await app.close({
      afterSnapshot: () => {
        console.log('快照已写入');
        setTimeout(() => process.exit(0), 3000).unref();
      },
    });
  } catch (e) {
    console.error('关闭出错', e);
    process.exit(1);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
