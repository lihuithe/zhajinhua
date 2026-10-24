<div align="center">

# 炸金花 · 多人网页版

**和朋友开个房间，发个链接就能一起玩的炸金花。手机、电脑都能玩，不用下载。**

使用虚拟积分，不涉及任何充值和兑换。

Vue 3 + Node.js 24 + WebSocket ｜ 一个 Node 进程跑完整个服务 ｜ 运行时只依赖 `ws` ｜ 1700 多条真人语音

</div>

![电脑端牌桌](docs/screenshots/table-desktop.jpg)

![手机端：闷牌、看牌、本局结束](docs/screenshots/mobile.jpg)

| 登录 | 本场结算 |
|---|---|
| ![登录页](docs/screenshots/login.jpg) | ![结算榜](docs/screenshots/summary.jpg) |

## 目录

- [亮点](#亮点)
- [功能](#功能)
- [快速开始](#快速开始)
- [部署到服务器](#部署到服务器)
- [管理后台](#管理后台)
- [技术栈与架构](#技术栈与架构)
- [目录结构](#目录结构)
- [测试](#测试)
- [音频资源](#音频资源)
- [文档](#文档)
- [许可证与致谢](#许可证与致谢)

## 亮点

- **服务端权威，防作弊**：发牌、比大小、判输赢、算积分全部在服务端完成；其他玩家的牌永远不会下发到浏览器（有专门的可见性测试逐条断言）。
- **规则可配**：局数、底注、加注档位、封顶、明牌倍率、A23、235 吃豹子、平局判定、比牌费用、闷牌比牌、孤注一掷、喜钱、超时处理……开房时都能改，覆盖各地玩法。
- **不停服更新**：重启时把所有房间和进行中的牌局写入快照，新进程启动后自动恢复，玩家只会看到 1–3 秒“服务器更新中”。
- **声音做得很足**：9 个玩家声音包、4 种荷官风格（含东北话、粤语、搞笑解说），按局势喊话；立体声方位、紧张铺底、人群喝彩。
- **部署极简**：单个 Node 进程同时提供页面、API 和 WebSocket，数据库是 Node 内置的 SQLite 单文件，不需要 Nginx / MySQL / Redis / Docker，1–2G 内存的小服务器就能跑。
- **自带管理后台**：用户、房间、对局记录（含每局所有人的牌和操作日志）、系统通知、维护模式。

## 功能

- 注册即玩：账号 ID 和密码自己定，无需验证。
- 开房间、发链接邀请好友；房间号 8 位，只用小写字母和数字（已去掉容易看错的字符），输入时不区分大小写。每个房间最多 15 个座位，可以观战。
- 机器人：房主可以往空座位加机器人一起开局，机器人自动准备、自动出牌，同样看不到别人的牌。
- 房主任何时候都能踢人（观战者、座位上的人、对局中的人），可勾选“不允许再进入”。
- 开房时可以配置全部规则：局数、初始积分、底注、加注档位、封顶、明牌倍率（如重庆 3 倍）、A23、235、平局判定、比牌费用、闷牌比牌、孤注一掷、喜钱、超时处理等。
- 准备 → 房主开始 → 按局数打完 → 结算榜 → 一键再来一场，可改配置，好友不用重新进入。
- 掉线自动重连，恢复全部状态；同一账号只能一处在线，被挤下线时可以一键“在这里继续”。
- 房间聊天：文字、表情、快捷语，头像旁冒气泡；观战者也能发言。
- 背景音乐（默认开启，默认“轻快尤克里里”，共 6 首可选：尤克里里、二胡琵琶民乐、古筝、酒廊吉他、俏皮弦乐、喜庆锣鼓）、音效、语音播报三项可分别开关、调音量，设置只在本机生效。电脑和安卓切到后台照常出声。
- 语音（火山引擎豆包语音合成 2.0，1700 多条）：
  - 9 个玩家声音包（云舟、思思、青叔、学长、御姐、学妹、东北老铁、四川妹子、粤语靓仔），每人在“声音设置 → 人声”里选，存在账号上，牌桌上所有人听到的都是你选的声音；
  - 喊话看局势：连闷几手、被加注后再加、加到封顶、看完就弃、下了重注才弃、闷着赢、偷鸡亮牌……各有说法；
  - 荷官播报 4 种风格（标准、搞笑解说、东北话、粤语），每人自己选；报牌型（含“二三五吃豹子”）、连胜 / 连胜被终结、翻盘、输光、本场名次；
  - 常用语用发送者的声音念出来，脸部表情也念出来，其他表情配音效。
- 声音层次：按座位方位的立体声（左边的人声音偏左）；音效每次音高音量轻微随机；语音按优先级调度（重要的打断次要的）；只剩两人、底池大、最后 10 秒、孤注一掷时有紧张铺底并压低背景音乐；大场面有人群惊叹 / 喝彩。
- 互动道具：点别人的头像，送花、飞吻、干杯、点赞、扔鸡蛋、扔番茄、扔炸弹，飞过去有动画、命中音效和对方的反应语音；机器人比牌输了偶尔也会扔鸡蛋。
- 轮到自己：提示音 + 语音，没操作每隔一会再提醒一次（后台更频繁、标题栏闪烁）；最后 10 秒心跳声 + 屏幕四周红色脉动，最后 5 秒屏幕中央大号倒数。
- 全屏特效：比牌横贯全屏的 VS 光带；跟注 / 加注按金额分四档（普通、有点料、豪气、霸气），越大越夸张；赢了金光、彩带、金币喷泉和金币雨，输了画面变灰。
- 行动限时、局间等待、结算前等待都可以在开房时配置。
- 额外领分：开房可设每人每场最多补领多少积分，输光后下一局自动补领。
- 牌桌动效：荷官逐张发牌、筹码飞入底池、动作气泡、底池热度光晕、赢家收筹码、金币雨、豹子 / 顺金横幅、比牌震屏。
- 聊天可以一键清空（只清自己这边），新消息自动滚到最底部。登录页也能设置声音。
- **其他玩家的牌永远不会下发到浏览器**：比大小、判输赢、算积分都在服务端完成。

## 快速开始

需要 [Node.js 24](https://nodejs.org/)（用到了内置的 `node:sqlite`）。

```bash
git clone https://github.com/lihuithe/zhajinhua.git
cd zhajinhua

# 后端：http://localhost:3000
cd server && npm install && npm run dev

# 前端（另开一个终端）：http://localhost:5173，/api 和 /ws 会代理到 3000
cd client && npm install && npm run dev
```

打开 <http://localhost:5173>，注册一个账号（ID 和密码自己定，无需验证）→ 开房间 → 把链接发给朋友，或者往空座位加几个机器人，就能开局。

- 开发模式下访问 `/dev/table`，可以用假数据预览牌桌的各种状态（满座、比牌、局间、结算等）。
- 管理后台：<http://localhost:5173/admin>，默认账号 `admin`，密码 `admin`。

### 生产方式本地运行

```bash
cd client && npm install && npm run build   # 产物在 client/dist
cd ../server && npm install --omit=dev && npm start
# 打开 http://localhost:3000 ，后端会直接提供 client/dist 里的页面
```

### 服务端环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `server/data` | SQLite 数据目录（自动创建） |
| `STATIC_DIR` | `client/dist` | 前端静态文件目录；不存在时只提供 API |
| `ADMIN_USERNAME` | `admin` | 管理后台账号 |
| `ADMIN_PASSWORD` | `admin` | 管理后台密码，**对外开放前请务必修改** |
| `RESTORE_SNAPSHOT` | `1` | 设为 `0` 时启动不恢复房间快照 |

## 部署到服务器

部署方案：一个 Node 进程直接监听 80 端口 + systemd 守护，前端在本地构建后上传。服务器只需要装 Node.js 24。

**1. 配置服务器信息。** 服务器地址、SSH 账号和密码放在项目根目录的 `.env` 里（已加入 `.gitignore`，不会提交）：

```bash
cp .env.example .env
```

```ini
DEPLOY_HOST=your.server.ip   # 服务器 IP 或域名
DEPLOY_PORT=22
DEPLOY_USER=root
DEPLOY_PASSWORD=             # 可选，见下
DEPLOY_URL=                  # 可选，部署完成后打印的访问地址
```

脚本优先使用 SSH 密钥免密登录（推荐先执行一次 `ssh-copy-id root@<服务器>`）；免密登录不了时，如果装了 `sshpass`，会用 `DEPLOY_PASSWORD` 登录。

**2. 首次部署前**，在服务器上装好 Node.js 24、放行 80 端口，步骤见 [docs/DEPLOY.md](docs/DEPLOY.md#5-首次部署--换新服务器)。

**3. 一键部署**（在项目根目录用 Git Bash / Linux / macOS 终端执行）：

```bash
bash deploy/deploy.sh           # 日常更新：热更新，房间和进行中的牌局保留
bash deploy/deploy.sh --fresh   # 大更新：不恢复房间，所有房间清空
```

脚本会：本地构建前端 → 打包 → 上传 → 服务器上安装依赖 → 切换版本（保留上一版用于回滚）→ 重启服务并打印不可用时长。

管理后台账号密码在 [`deploy/zhajinhua.service`](deploy/zhajinhua.service) 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 里改。需要 HTTPS 时，在前面加一层 Nginx / Caddy 反代即可（记得转发 WebSocket 的 `Upgrade` 头）。完整说明（目录、回滚、备份、运维命令）见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 管理后台

访问 `/admin`，默认账号 `admin` / 密码 `admin`。

| 页面 | 内容 |
|---|---|
| 概览 | 在线人数、房间数、今日新增、今日对局，服务器信息，维护模式状态 |
| 用户 | 搜索、分页；最近对局、重置密码、封禁 / 解封 |
| 开房记录 | 实时成员、当前局、聊天、场次；可解散房间 |
| 开局记录 | 场次结算和每局记录；每局详情含所有人的牌、操作日志、输赢 |
| 系统通知 | 横幅 / 弹窗通知、停服维护通知（带倒计时） |
| 系统 | 维护模式开关、版本与运行信息、快照状态 |

详见 [docs/ADMIN.md](docs/ADMIN.md)。

## 技术栈与架构

| 部分 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + vue-router，不依赖 UI 组件库，牌面、筹码、牌桌都用 CSS 绘制 |
| 后端 | Node.js 24 + `ws`（唯一的运行时依赖），HTTP 用 `node:http` 实现 |
| 数据库 | Node 内置 `node:sqlite`，单文件 |
| 实时通信 | WebSocket：断线自动重连并恢复全部状态，同一账号只能一处在线 |
| 部署 | 单个 Node 进程 + systemd，热更新靠房间快照 |
| 音频 | 火山引擎豆包语音合成 2.0 生成口播；音效、部分背景音乐用代码合成（ffmpeg） |

```
浏览器（Vue 3）
   │  HTTP /api/*（注册、登录、开房、管理后台）
   │  WebSocket /ws（房间状态、操作、聊天、事件）
   ▼
Node.js 单进程
   ├─ http.js / ws.js      路由、鉴权、静态文件
   ├─ room/                房间、座位、场次、机器人、超时
   ├─ game/                牌型判定（纯函数）+ 单局状态机（纯逻辑，无定时器）
   ├─ snapshot.js          重启前写快照、启动后恢复
   └─ db.js (node:sqlite)  用户、token、对局记录、通知
```

每个玩家收到的房间状态都是服务端按身份裁剪过的：自己的牌只发给自己，比牌结果只发给比牌双方，亮牌 / 强制开牌后才对所有人可见。

## 目录结构

```
client/              前端（Vue 3）
  src/views/         页面：登录、大厅、开房、房间、管理后台
  src/components/    牌桌、座位、聊天、特效等组件
  src/lib/           API、WebSocket、音频调度、声音包等
  public/audio/      音效、背景音乐、语音（已生成好）
server/              后端（Node.js + ws），说明见 server/README.md
  src/game/          牌、牌型、单局状态机
  src/room/          房间、房间管理、机器人
  test/              node:test 测试
deploy/              部署脚本与 systemd 服务文件
docs/                文档
tools/audio/         音频生成脚本（口播合成、音效与背景音乐合成）
.env.example         部署用的服务器信息模板（复制为 .env）
```

## 测试

```bash
cd server && npm test
```

174 个测试，约 6 秒：牌型穷举（22100 种组合）、单局状态机、可见性清单（别人的牌不会泄露）、房间逻辑、热更新恢复、管理后台，以及真实启动服务、用多个 WebSocket 客户端模拟完整对局的集成测试。

## 音频资源

音频文件都在 `client/public/audio/`，已经生成好并提交到仓库，部署时随前端一起发布。需要重新生成时：

```bash
# 音效与背景音乐（纯代码合成，需要 ffmpeg）
node tools/audio/gen_sfx.mjs

# 口播（火山引擎豆包语音合成 2.0，需要 ffmpeg 和凭据：在 .env 里填 VOLC_APP_ID、VOLC_ACCESS_KEY）
python -I tools/audio/gen_voice.py
```

台词、声音包、播报风格都在 `tools/audio/voice_lines.py`；前端按生成的 `client/public/audio/voice/manifest.json` 挑文件（每类几条、常用语文字），增删台词不用改前端代码。新增声音包 / 风格时，要同步 `client/src/lib/voicePacks.js` 和 `server/src/voices.js` 里的 id。
脚本默认增量：文字、音色、参数没变的文件跳过（记录在 `tools/audio/voice_hashes.json`），`--force` 全部重做，`--only p/db/,s/fun/` 只做指定前缀，`-j 8` 并发数。人群音效（`sfx/crowd_*.mp3`）也由这个脚本用多个音色混成。
在浏览器控制台执行 `localStorage.zjh_audio_debug = '1'` 后刷新，`window.__zjhAudioLog` 会记录每一次播放，`__zjhAudio()` 可以看当前语音队列和紧张程度。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/RULES.md](docs/RULES.md) | 游戏规则与房间配置（权威） |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 产品需求 |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | 前后端通信协议（HTTP + WebSocket） |
| [docs/ADMIN.md](docs/ADMIN.md) | 不停服部署、系统通知、管理后台 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署与运维 |
| [server/README.md](server/README.md) | 服务端结构与实现说明 |

## 许可证与致谢

代码以 [MIT License](LICENSE) 开源。

本项目仅供朋友间娱乐和学习交流，使用虚拟积分，不提供任何充值、兑换功能。请勿用于赌博或任何违法用途。

### 背景音乐

`client/public/audio/music/` 下的 5 首是真实乐器录制的曲子，作者 Kevin MacLeod（[incompetech.com](https://incompetech.com)），按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授权使用，已转码为 96kbps 并统一响度：

| 文件 | 原曲名 | 游戏里的名字 |
|---|---|---|
| `shenyang.mp3` | Shenyang | 民乐 · 沈阳 |
| `guzheng.mp3` | Guzheng City | 古筝 |
| `bossa.mp3` | Bossa Antigua | 酒廊吉他 |
| `carefree.mp3` | Carefree | 轻快尤克里里 |
| `monkeys.mp3` | Monkeys Spinning Monkeys | 俏皮弦乐 |

“Shenyang”“Guzheng City”“Bossa Antigua”“Carefree”“Monkeys Spinning Monkeys” Kevin MacLeod (incompetech.com)，Licensed under Creative Commons: By Attribution 4.0 License。游戏内“声音设置”里也有署名。第 6 首“喜庆锣鼓”是 `tools/audio/gen_sfx.mjs` 合成的（`bgm.mp3`）。

### 语音

口播由[火山引擎豆包语音合成 2.0](https://www.volcengine.com/product/tts) 生成，使用时请遵守火山引擎的服务条款。
