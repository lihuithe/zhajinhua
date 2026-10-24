#!/usr/bin/env bash
# 一键部署：本地构建前端 → 打包 → 上传 → 服务器安装依赖 → 重启服务
# 用法（在项目根目录，Git Bash 中执行）：
#   bash deploy/deploy.sh           日常更新（热更新）：重启约 1 秒，房间和进行中的牌局自动恢复
#   bash deploy/deploy.sh --fresh   大更新：不恢复房间快照（所有房间清空），需提前发停服通知
# 服务器信息写在项目根目录的 .env 里（不提交到 git），格式见 .env.example
set -euo pipefail

FRESH=0
for a in "$@"; do
  case "$a" in
    --fresh) FRESH=1 ;;
    *) echo "未知参数：$a" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
: "${DEPLOY_HOST:?请在项目根目录的 .env 里设置 DEPLOY_HOST（参考 .env.example）}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"
SERVER="$DEPLOY_USER@$DEPLOY_HOST"
REMOTE_DIR="/opt/zhajinhua"  # 与 deploy/zhajinhua.service 里的路径一致
SITE_URL="${DEPLOY_URL:-http://$DEPLOY_HOST/}"

# 优先用密钥免密登录；密钥登录不了、又配了 DEPLOY_PASSWORD 且装了 sshpass 时，用密码登录
SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
PASS_CMD=()
if ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" true 2>/dev/null; then
  SSH_OPTS+=(-o BatchMode=yes); SCP_OPTS+=(-o BatchMode=yes)
elif [ -n "$DEPLOY_PASSWORD" ] && command -v sshpass >/dev/null 2>&1; then
  export SSHPASS="$DEPLOY_PASSWORD"
  PASS_CMD=(sshpass -e)
  SSH_OPTS+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no)
  SCP_OPTS+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no)
else
  echo "无法免密登录 $SERVER。请先把本机公钥加到服务器（ssh-copy-id -p $DEPLOY_PORT $SERVER），" >&2
  echo "或者安装 sshpass 并在 .env 里设置 DEPLOY_PASSWORD。" >&2
  exit 1
fi
remote() { "${PASS_CMD[@]}" ssh "${SSH_OPTS[@]}" "$SERVER" "$@"; }
upload() { "${PASS_CMD[@]}" scp "${SCP_OPTS[@]}" "$@"; }

PKG="$ROOT/release/zhajinhua.tar.gz"

echo "==> 1/4 构建前端"
cd "$ROOT/client"
# 已安装过依赖就不重装（npm ci 会删 node_modules，开发服务器占用文件时会失败）
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build

echo "==> 2/4 打包"
cd "$ROOT"
VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then VERSION="$VERSION+dirty"; fi
VERSION="$VERSION-$(date +%Y%m%d%H%M)"
printf '{ "version": "%s", "builtAt": %s }\n' "$VERSION" "$(date +%s)000" > server/version.json
echo "版本：$VERSION"
mkdir -p "$ROOT/release"
# 背景音乐文件大、很少改：服务器当前版本里已有完全相同的文件就不再上传（安装时从当前版本拷过去）
MUSIC_DIR="client/dist/audio/music"
EXCL_MUSIC=()
if [ -d "$MUSIC_DIR" ]; then
  LOCAL_SUM="$(cd "$MUSIC_DIR" && md5sum *.mp3 | sed "s/ [ *]/ /" | sort)"
  REMOTE_SUM="$(remote "cd $REMOTE_DIR/app/$MUSIC_DIR 2>/dev/null && md5sum *.mp3 | sort" 2>/dev/null | sed "s/ [ *]/ /" | sort || true)"
  if [ -n "$REMOTE_SUM" ] && [ "$LOCAL_SUM" = "$REMOTE_SUM" ]; then
    EXCL_MUSIC=(--exclude="$MUSIC_DIR")
    echo "背景音乐没有变化，不重新上传"
  fi
fi
tar -czf "$PKG" \
  --exclude='server/node_modules' --exclude='server/data' --exclude='server/test' ${EXCL_MUSIC[@]+"${EXCL_MUSIC[@]}"} \
  server/package.json server/package-lock.json server/src server/version.json \
  client/dist \
  deploy/zhajinhua.service
ls -lh "$PKG"

echo "==> 3/4 上传"
upload "$PKG" "$SERVER:/tmp/zhajinhua.tar.gz"

if [ "$FRESH" = 1 ]; then echo "==> 4/4 服务器安装并重启（大更新：不恢复房间）"; else echo "==> 4/4 服务器安装并热更新"; fi
remote "REMOTE_DIR=$REMOTE_DIR FRESH=$FRESH bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$REMOTE_DIR/data"
# 先在临时目录装好依赖，再切换，尽量缩短重启时间
STAGE="$REMOTE_DIR/app.new"
rm -rf "$STAGE" && mkdir -p "$STAGE"
tar -xzf /tmp/zhajinhua.tar.gz -C "$STAGE"
# 包里没带背景音乐（没有变化）：从当前版本拷过去
MUSIC_SUB="client/dist/audio/music"
if [ ! -d "$STAGE/$MUSIC_SUB" ] && [ -d "$REMOTE_DIR/app/$MUSIC_SUB" ]; then
  cp -r "$REMOTE_DIR/app/$MUSIC_SUB" "$STAGE/$MUSIC_SUB"
fi
cd "$STAGE/server"
npm ci --omit=dev --no-audit --no-fund
# 切换版本，保留上一版用于回滚（旧进程已把代码载入内存，移动目录不影响它运行）
rm -rf "$REMOTE_DIR/app.prev"
[ -d "$REMOTE_DIR/app" ] && mv "$REMOTE_DIR/app" "$REMOTE_DIR/app.prev"
mv "$STAGE" "$REMOTE_DIR/app"
cp "$REMOTE_DIR/app/deploy/zhajinhua.service" /etc/systemd/system/zhajinhua.service
systemctl daemon-reload
systemctl enable zhajinhua >/dev/null 2>&1
T0=$(date +%s%3N)
if [ "$FRESH" = 1 ]; then
  # 大更新：停服务（会写快照）→ 删掉快照 → 启动
  systemctl stop zhajinhua
  rm -f "$REMOTE_DIR/data/rooms-snapshot.json"
  systemctl start zhajinhua
else
  # 热更新：SIGTERM 时旧进程写快照，新进程启动后自动恢复
  systemctl restart zhajinhua
fi
# 等服务就绪
for i in $(seq 1 50); do
  if curl -fs -o /dev/null http://127.0.0.1/api/notices; then break; fi
  sleep 0.1
done
T1=$(date +%s%3N)
systemctl is-active zhajinhua
echo "服务不可用时长约 $((T1 - T0)) ms"
curl -s http://127.0.0.1/api/notices | head -c 200; echo
journalctl -u zhajinhua -n 6 --no-pager -o cat | tail -n 6
rm -f /tmp/zhajinhua.tar.gz
REMOTE

echo "==> 部署完成：$SITE_URL  （管理后台：${SITE_URL%/}/admin）"
