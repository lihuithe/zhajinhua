// 版本号：部署脚本写入 server/version.json，格式 { "version": "<git 短哈希>-<yyyyMMddHHmm>", "builtAt": <ms> }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const DEFAULT_VERSION_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'version.json');

/** 文件不存在或内容不对时返回 'dev' */
export function loadVersion(file = DEFAULT_VERSION_FILE) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    if (v && typeof v.version === 'string' && v.version) return v.version;
  } catch {
    /* 不存在或解析失败：视为开发环境 */
  }
  return 'dev';
}
