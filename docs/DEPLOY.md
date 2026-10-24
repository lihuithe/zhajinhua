# 部署文档

## 1. 服务器要求与 `.env`

| 项目 | 要求 |
|---|---|
| 系统 | 任意带 systemd 的 Linux x86_64（作者用的是 CentOS Stream 9） |
| 配置 | 2 核 1–2G 内存就够；内存小时建议加 1G swap |
| 端口 | 放行 TCP 80（云服务器还要在安全组里放行） |
| 管理后台 | `http://<服务器>/admin`，默认账号 `admin`，密码 `admin`（在 `deploy/zhajinhua.service` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 里改） |

服务器的地址、账号、密码只写在项目根目录的 `.env` 里，这个文件已加入 `.gitignore`，**不会提交到 git**。第一次使用先复制模板再填写：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|---|---|
| `DEPLOY_HOST` | 服务器 IP 或域名（必填） |
| `DEPLOY_PORT` | SSH 端口，默认 `22` |
| `DEPLOY_USER` | SSH 用户，默认 `root` |
| `DEPLOY_PASSWORD` | SSH 密码（可选）。脚本优先用密钥免密登录；免密登录不了、又装了 `sshpass` 时才用密码 |
| `DEPLOY_URL` | 部署完成后打印的访问地址（可选，默认 `http://DEPLOY_HOST/`） |

建议配置免密登录（Git Bash 中执行，按提示输入一次密码）：

```bash
ssh-copy-id -p 22 root@<服务器>
```

## 2. 部署方式与原因

服务器配置低，所以选了最省资源的方案：

- **一个 Node 进程**直接监听 80 端口，同时提供前端静态页面、HTTP API 和 WebSocket。不装 Nginx，也不用 Docker。
- **systemd 守护进程**：系统自带，不需要额外常驻 PM2 进程；崩溃 1 秒后自动重启，开机自动启动。
- **数据库**用 Node 24 内置的 `node:sqlite`，数据就是一个文件，不装 MySQL / Redis。
- 前端在**本地构建**，服务器只安装后端唯一的运行时依赖 `ws`，服务器上不跑构建。
- Node 堆内存限制在 384MB（`--max-old-space-size=384`），避免把小内存机器拖垮。

## 3. 服务器目录

| 路径 | 用途 |
|---|---|
| `/opt/node/` | Node.js v24.21.0（命令软链在 `/usr/local/bin/node`、`npm`、`npx`） |
| `/opt/zhajinhua/app/` | 当前运行的版本（`server/`、`client/dist/`） |
| `/opt/zhajinhua/app.prev/` | 上一个版本，用于回滚 |
| `/opt/zhajinhua/data/` | SQLite 数据库，部署时**不会**覆盖 |
| `/etc/systemd/system/zhajinhua.service` | systemd 服务文件，源文件在 `deploy/zhajinhua.service` |
| `/swapfile` | 1G swap |

npm 源已经设为 `https://registry.npmmirror.com`。

## 4. 部署（不停服）

在本地项目根目录，用 Git Bash 执行：

```bash
bash deploy/deploy.sh           # 日常更新：热更新，房间和进行中的牌局保留
bash deploy/deploy.sh --fresh   # 大更新：不恢复房间，所有房间清空
```

### 4.1 热更新原理

- 服务收到停止信号（`systemctl restart` 发出的 SIGTERM）时，把所有房间连同进行中的牌局写入 `/opt/zhajinhua/data/rooms-snapshot.json`，然后用 WebSocket 关闭码 1012 通知客户端“服务器更新中”。
- 新进程启动后读取快照，恢复全部房间。重启的这段时间会补回到行动倒计时上，不会因为更新被判超时。
- 客户端 0.5 秒后自动重连，重连后回到原来的房间继续打。整个过程玩家只看到 1–3 秒的“服务器更新中，正在重连…”。
- 前端发现版本号变了，会在顶部提示“已更新到新版本，刷新”，不强制刷新。
- 另外每 20 秒自动存一次快照，进程意外崩溃后也能恢复到最近的状态。
- 恢复成功后快照改名为 `rooms-snapshot.restored.json`，下次启动不会再读。

### 4.2 什么时候算“大更新”

服务端改了房间或单局的内部数据结构，旧快照没法恢复时，开发者会把 `SNAPSHOT_FORMAT` 加 1。这种更新必须停服：

1. 后台「系统通知」→「停服维护通知」，写明维护时间，保存后所有在线用户立即看到横幅和倒计时。
2. 维护前，后台「系统设置」开启**维护模式**：不能开新房间、不能开始新的一场，进行中的那一场可以打完。
3. 到点执行 `bash deploy/deploy.sh --fresh`。
4. 完成后关闭维护模式，停用通知。

即使忘了加 `--fresh`，快照格式不一致时新进程也只会放弃恢复，不会出错。

### 4.3 脚本步骤

脚本 `deploy/deploy.sh` 会依次执行：

1. 本地 `client/` 下构建前端（`node_modules` 不存在时先 `npm ci`），并把版本号（git 短哈希 + 时间）写入 `server/version.json`。
2. 把 `server/`（不含 `node_modules`、`test`、`data`）、`client/dist/` 和服务文件打成 `release/zhajinhua.tar.gz`。
3. `scp` 上传到服务器。
4. 在服务器上解压到临时目录 → `npm ci --omit=dev` → 当前版本移到 `app.prev`，新版本切换为 `app` → 更新 systemd 服务文件 → 重启服务（`--fresh` 时先停服务、删除快照再启动）→ 等待服务就绪，并打印“服务不可用时长”和最近几行日志。

本地需要：Node 24、npm、Git Bash（自带 `ssh` / `scp` / `tar`），配好 `.env`，并且能免密登录服务器（或者装了 `sshpass` 并在 `.env` 里填了 `DEPLOY_PASSWORD`）。

## 5. 首次部署 / 换新服务器

新服务器需要先执行一遍下面这些步骤（只做一次）：

```bash
ssh root@<新服务器IP>

# 1) 安装 Node.js 24（国内镜像）
cd /tmp
curl -L -o node.tar.xz https://registry.npmmirror.com/-/binary/node/v24.21.0/node-v24.21.0-linux-x64.tar.xz
mkdir -p /opt/node && tar -xJf node.tar.xz -C /opt/node --strip-components=1
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/npm  /usr/local/bin/npm
ln -sf /opt/node/bin/npx  /usr/local/bin/npx
npm config set registry https://registry.npmmirror.com
node -v   # v24.21.0

# 2) 加 1G swap（小内存机器防止 OOM）
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab

# 3) 防火墙 / 云安全组：放行 TCP 80
#    如果启用了 firewalld：
#    firewall-cmd --permanent --add-port=80/tcp && firewall-cmd --reload
```

然后把 `.env` 里的 `DEPLOY_HOST` 改成新服务器，在本地执行 `bash deploy/deploy.sh`。

## 6. 运维命令

```bash
systemctl status zhajinhua          # 查看状态
systemctl restart zhajinhua         # 重启（热更新：房间会自动恢复）
systemctl stop zhajinhua            # 停止
journalctl -u zhajinhua -f          # 实时日志
journalctl -u zhajinhua -n 200      # 最近 200 行日志
ss -tlnp | grep :80                 # 确认端口在监听
free -h                             # 内存情况
```

### 回滚到上一版

```bash
cd /opt/zhajinhua
mv app app.bad && mv app.prev app && systemctl restart zhajinhua
```

### 备份数据库

```bash
cp /opt/zhajinhua/data/*.db /root/zjh-backup-$(date +%F).db
```

## 7. 配置项（环境变量）

在 `deploy/zhajinhua.service` 中修改，然后重新部署；或者直接在服务器上改 `/etc/systemd/system/zhajinhua.service`，再执行 `systemctl daemon-reload && systemctl restart zhajinhua`。

| 变量 | 生产值 | 说明 |
|---|---|---|
| `PORT` | `80` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `/opt/zhajinhua/data` | SQLite 数据目录 |
| `STATIC_DIR` | `/opt/zhajinhua/app/client/dist` | 前端静态文件目录 |
| `NODE_ENV` | `production` | |

## 8. 注意事项

- 重启是热更新，房间不会丢；只有 `--fresh` 或快照格式不兼容时才会清空房间。
- 默认是 IP + HTTP 访问。浏览器的 `navigator.clipboard` 在 HTTP 下不可用，前端已经做了降级复制。以后绑定域名并配置 HTTPS 时，在前面加一层 Nginx 或 Caddy 做 TLS，反代到 Node（要转发 WebSocket 的 `Upgrade` 头），Node 改为监听 `127.0.0.1:3000`。
- 用于正式环境时，建议关闭 SSH 密码登录、只用密钥，改掉管理后台的默认密码，并改用非 root 用户运行服务。
