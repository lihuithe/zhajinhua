# 不停服部署、系统通知、管理后台

本文是这三项功能的设计与前后端契约。通用约定（响应格式、错误格式、鉴权头）同 [PROTOCOL.md](PROTOCOL.md)。

---

## 1. 不停服部署（热更新）

### 1.1 目标

日常更新时，正在进行的房间和牌局不丢失。玩家只会看到 1–3 秒的“服务器更新中，正在重连…”，重连后自动回到原来的房间，牌局继续。

### 1.2 机制

1. **退出时存快照**：进程收到 `SIGTERM` / `SIGINT` 时，按以下顺序处理：
   1. 停止接收新连接。
   2. 把所有房间的完整状态序列化，写入 `DATA_DIR/rooms-snapshot.json`：先写临时文件再 `rename`，保证原子替换。状态包括成员、座位、场次、历场记录、聊天、封禁名单，以及进行中那一局的全部内部状态（牌、底池、轮次、行动顺序、日志、可见性记录等）。
   3. 用关闭码 **1012**（Service Restart）关闭所有 WebSocket。
   4. 退出进程。
2. **定期快照**：每 20 秒检查一次，房间状态有变化就写快照。进程崩溃后也能恢复到最近一次快照。
3. **启动时恢复**：如果快照存在、`formatVersion` 与当前代码一致、且距离写入不超过 30 分钟，就恢复所有房间：
   - 所有成员先标为离线，等客户端重连。离线时间从启动时刻开始算。
   - 局内的绝对时间（当前行动截止时间 `turnDeadline`、下一局开始时间 `nextHandAt`）整体后移“停机时长”（启动时刻减快照时刻），重启的时间不算进玩家的思考时间。
   - 重新建立“用户 → 房间”的对应关系，重新安排所有定时器。
   - 恢复成功后，把快照改名为 `rooms-snapshot.restored.json` 留作排查，下次启动不会再读。
   - 格式不一致、已过期或解析失败时，记一条日志并放弃恢复，服务正常启动。
4. **快照格式版本**：服务端常量 `SNAPSHOT_FORMAT`。房间或单局的内部结构有不兼容的改动时，必须把它加 1，旧快照就会被丢弃。这种更新就是“大更新”，需要按 1.4 的流程发停服通知。
5. **版本号**：部署脚本把版本信息写进 `server/version.json`，格式为 `{ "version": "<git 短哈希>-<yyyyMMddHHmm>", "builtAt": <ms> }`。文件不存在时版本为 `dev`。服务端把版本号随 `sys` 消息下发给前端（见 3.3）。

### 1.3 前端配合

- WebSocket 关闭码 1012：顶部显示“服务器更新中，正在重连…”，0.5 秒后开始重连，之后按退避策略继续。
- 收到 `sys` 消息时，如果 `version` 和页面加载时记录的不同，显示一个不打断操作的提示：“已更新到新版本，点此刷新”。不强制刷新。

### 1.4 部署命令

| 场景 | 命令 | 效果 |
|---|---|---|
| 日常更新（默认） | `bash deploy/deploy.sh` | 热更新，房间和牌局保留 |
| 大更新 | `bash deploy/deploy.sh --fresh` | 不恢复快照，所有房间清空 |

大更新的流程：

1. 提前在后台发布一条“停服维护”级别的通知，写明维护时间段。
2. 维护前开启“维护模式”：不能开新房间、不能开始新的一场，正在进行的那一场可以打完。
3. 到点后执行 `--fresh` 部署。
4. 部署完成后关闭维护模式，下线通知。

---

## 2. 维护模式

- 系统设置项 `maintenance = { enabled: boolean, message: string }`，持久化在数据库里，重启后保持。
- 开启后：
  - `POST /api/rooms`（创建房间）返回 503，错误码 `MAINTENANCE`，`message` 为设置的提示语；提示语为空时用“系统维护中，暂时不能开新房间”。
  - `room.start` 和 `room.restart` 返回同样的 `MAINTENANCE` 错误。
  - 已经开始的一场照常进行，直到打完。
- 状态变化时，服务端向所有在线连接推送 `sys` 消息。

---

## 3. 系统通知

### 3.1 数据结构

```ts
type Notice = {
  id: number;
  title: string;                 // 1–40 字
  content: string;               // 0–500 字，纯文本，前端按纯文本显示（可换行）
  level: 'info' | 'warn' | 'maint';   // 普通 / 重要 / 停服维护
  banner: boolean;               // 顶部横幅显示
  popup: boolean;                // 弹窗显示（每个用户每条通知只弹一次，内容更新后会再弹）
  startsAt: number | null;       // 生效时间，null = 立即
  endsAt: number | null;         // 失效时间，null = 不过期
  maintStart: number | null;     // 维护开始时间（level = maint 时用于倒计时）
  maintEnd: number | null;       // 预计维护结束时间
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};
```

“当前有效”的条件：`enabled`，且 `startsAt` 为空或 ≤ 当前时间，且 `endsAt` 为空或 > 当前时间。

### 3.2 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notices` | 不需要登录。返回 `{ ok, notices: Notice[], maintenance, version }`，只含当前有效的通知，按 level（maint > warn > info）再按 `updatedAt` 降序排列 |

### 3.3 WebSocket 推送

- 连接建立后，服务端立即发送：

  ```json
  { "type": "sys", "data": { "version": "...", "notices": [], "maintenance": { "enabled": false, "message": "" } } }
  ```

- 管理员增删改通知、切换维护模式时，向**所有**在线连接重新推送一次完整的 `sys`。
- 通知到达 `startsAt` 或 `endsAt` 的时刻，服务端也要重新推送 `sys`（用定时器，或每 30 秒检查一次）。

### 3.4 前端展示

- **顶部横幅**：所有页面都显示（登录页、大厅、房间、创建房间页），后台除外。
  - 有多条有效且 `banner = true` 的通知时轮流显示。
  - 颜色按级别区分：info 蓝、warn 橙、maint 红。
  - 内容过长时横向滚动。
  - `maint` 级别显示维护时间段和“距离停服 mm:ss”倒计时。
  - 用户可以点“×”暂时隐藏某条横幅（本次打开页面有效）。
- **弹窗**：`popup = true` 的通知，每条只弹一次。按 `id + updatedAt` 记在本机 localStorage，内容更新后会重新弹出。在房间里时，不在本人行动期间弹出，等不是自己的回合再弹。
- **维护模式**：大厅显示提示条，“创建房间”按钮置灰，并显示维护提示语。

---

## 4. 管理后台

### 4.1 账号与鉴权

- 管理员账号由环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 指定，默认 `admin` / `admin`。
- 管理员 token 与玩家 token 完全独立：数据库表 `admin_tokens`，有效期 7 天，存在 localStorage 的 `zjh_admin_token`。
- 所有 `/api/admin/*` 接口（登录除外）都需要 `Authorization: Bearer <admin token>`，否则返回 401 `UNAUTHORIZED`。
- 后台页面路由 `/admin`，与玩家端是同一个前端应用，按需加载。

### 4.2 原则

- 后台**看不到进行中那一局的手牌**，房间实时详情里不含任何牌面。
- 局结束后写入的“对局记录”包含所有参与者的手牌，供管理员复盘。

### 4.3 新增的数据记录

| 表 | 内容 |
|---|---|
| `users` 增加列 | `last_login_at INTEGER`、`banned INTEGER NOT NULL DEFAULT 0`（用 `PRAGMA table_info` 检查后 `ALTER TABLE`，兼容旧库） |
| `room_records` | `code PRIMARY KEY, owner_id, owner_nickname, config_json, created_at, destroyed_at, sessions_played, hands_played, peak_seated, last_active_at` |
| `hand_records` | `id, room_code, session_no, hand_no, started_at, ended_at, reason, pot, winners_json, players_json, log_json`，索引 `(room_code)`、`(ended_at)` |
| `hand_players` | `hand_id, user_id, delta`，索引 `(user_id)`，用于按用户查对局 |
| `session_results` 增加列 | `started_at INTEGER` |
| `notices` | 见 3.1 |
| `settings` | `key PRIMARY KEY, value_json`（维护模式等） |
| `admin_tokens` | `token PRIMARY KEY, created_at, expires_at` |

`hand_records.players_json` 的每一项：

```ts
{ userId, nickname, seatIndex, cards: Card[], type: HandType, label: string, is235: boolean,
  seen: boolean, state: 'folded'|'lost'|'won'|'active', bet: number, delta: number, allIn: boolean }
```

`log_json` 就是该局完整的 `LogEntry[]`。作废的局同样记录，`reason = 'voided'`。

### 4.4 接口

分页参数统一为 `page`（从 1 开始，默认 1）和 `size`（默认 20，最大 100）。分页响应格式：`{ ok, total, page, size, items }`。时间字段都是毫秒时间戳。

| 方法 | 路径 | 请求 | 响应（`ok` 之外的字段） |
|---|---|---|---|
| POST | `/api/admin/login` | `{ username, password }` | `{ token }`；错误时返回 401 `BAD_CREDENTIALS` |
| POST | `/api/admin/logout` | — | — |
| GET | `/api/admin/overview` | — | `{ stats, server, maintenance }`，详见下文 |
| GET | `/api/admin/users` | `?q=&page=&size=` | 分页，item 为 `AdminUser`；`q` 模糊匹配账号或昵称 |
| GET | `/api/admin/users/:userId` | — | `{ user: AdminUser, sessions: AdminSessionRow[] }`，最近 50 场 |
| POST | `/api/admin/users/:userId/password` | `{ password }` | 重置密码（4–64 位），作废该用户全部 token，并把在线连接以 4001 断开 |
| POST | `/api/admin/users/:userId/ban` | `{ banned: boolean }` | 封禁时作废 token、以 4001 断开连接；被封禁的用户登录返回 403 `BANNED`，提示“账号已被封禁” |
| GET | `/api/admin/rooms` | `?status=live\|all&q=&page=&size=` | 分页，item 为 `AdminRoom`；`live` 只列内存中存在的房间；`q` 匹配房间号或房主昵称；按创建时间降序 |
| GET | `/api/admin/rooms/:code` | — | `{ room: AdminRoom, config, live: AdminLiveRoom \| null, sessions: AdminSession[], hands: AdminHandRow[] }`，`hands` 为最近 50 局 |
| POST | `/api/admin/rooms/:code/dissolve` | `{ reason? }` | 解散房间：向成员推送事件 `{ kind: 'dissolved', text }`，然后销毁房间 |
| GET | `/api/admin/sessions` | `?room=&user=&page=&size=` | 分页，item 为 `AdminSession`，按结束时间降序 |
| GET | `/api/admin/hands` | `?room=&session=&user=&page=&size=` | 分页，item 为 `AdminHandRow`，按结束时间降序；`session` 为场次号，需配合 `room` 使用 |
| GET | `/api/admin/hands/:id` | — | `{ hand: AdminHandDetail }` |
| GET | `/api/admin/notices` | — | `{ items: Notice[] }`，包括未生效的，按 `updatedAt` 降序 |
| POST | `/api/admin/notices` | Notice 的可写字段 | `{ notice }` |
| PUT | `/api/admin/notices/:id` | Notice 的可写字段（部分即可） | `{ notice }` |
| DELETE | `/api/admin/notices/:id` | — | — |
| GET | `/api/admin/system` | — | `{ maintenance, server, snapshot: { lastSavedAt, restoredAt, restoredRooms } }` |
| POST | `/api/admin/system/maintenance` | `{ enabled, message? }` | `{ maintenance }` |

```ts
type Stats = {
  usersTotal: number; usersToday: number;        // “今天”按服务器本地时区 0 点算
  online: number;                                // 当前在线连接的用户数
  roomsLive: number; roomsPlaying: number;       // 内存中的房间数 / 其中 phase = playing 的数量
  roomsToday: number;
  sessionsToday: number; handsToday: number;
  sessionsTotal: number; handsTotal: number;
};
type ServerInfo = { version: string; startedAt: number; uptimeSec: number; memoryMB: number; node: string; pid: number };

type AdminUser = {
  userId: string; username: string; nickname: string;
  createdAt: number; lastLoginAt: number | null; banned: boolean;
  online: boolean; roomCode: string | null;
  sessions: number; hands: number; net: number;  // 参与的场数、局数、累计净输赢（按 session_players 统计）
};
type AdminSessionRow = { sessionId: number; roomCode: string; sessionNo: number; endedAt: number; net: number; finalChips: number; bestType: string | null; wins: number };

type AdminRoom = {
  code: string; ownerId: string; ownerNickname: string;
  createdAt: number; destroyedAt: number | null; lastActiveAt: number | null;
  live: boolean;
  phase: 'waiting' | 'playing' | 'finished' | null;   // 已销毁时为 null
  seated: number; spectators: number; online: number;  // 已销毁时为 0
  sessionNo: number; handNo: number; hands: number;    // hands = 配置的局数
  sessionsPlayed: number; handsPlayed: number; peakSeated: number;
};
type AdminLiveRoom = {
  phase: string; ownerId: string;
  members: { userId: string; nickname: string; online: boolean; seatIndex: number | null; chips: number | null; ready: boolean }[];
  hand: null | { handNo: number; round: number; pot: number; currentBet: number; turnSeat: number | null; ended: boolean;
                 players: { seatIndex: number; nickname: string; state: string; seen: boolean; bet: number }[] };  // 不含牌面
  chat: ChatMsg[];
};
type AdminSession = {
  id: number; roomCode: string; sessionNo: number; startedAt: number | null; endedAt: number; handsPlayed: number;
  players: { userId: string; nickname: string; net: number; finalChips: number; bestType: string | null; wins: number }[];
};
type AdminHandRow = {
  id: number; roomCode: string; sessionNo: number; handNo: number; startedAt: number; endedAt: number;
  reason: string; pot: number; winners: string[];   // 赢家昵称
  playerCount: number;
};
type AdminHandDetail = AdminHandRow & { players: HandRecordPlayer[]; log: LogEntry[]; winnerSeats: number[] };
```

### 4.5 后台页面

| 页面 | 内容 |
|---|---|
| 登录 | 账号、密码 |
| 概览 | 统计卡片（在线人数、房间、今日新增、今日对局等）、服务器信息、维护模式状态，每 10 秒自动刷新 |
| 用户 | 搜索、分页表格；详情抽屉里有最近对局、重置密码、封禁 / 解封 |
| 开房记录 | 进行中 / 全部 切换、搜索；详情里有实时成员、当前局（不含牌）、聊天、场次、最近对局；可解散房间 |
| 开局记录 | 两个标签：“场次结算”和“每局记录”；可按房间号 / 用户筛选；每局详情含所有人的牌、操作日志、输赢 |
| 系统通知 | 列表、新建 / 编辑（级别、横幅 / 弹窗、生效时间、维护时间段）、启用 / 停用、删除 |
| 系统 | 维护模式开关与提示语、服务器版本与运行信息、快照状态、部署说明 |

---

## 5. 实现补充说明（后端实现时对上文的澄清，前后端均以此为准）

1. **快照文件**：`{ formatVersion, version, savedAt, rooms: [...] }`。恢复条件：`formatVersion === SNAPSHOT_FORMAT`，且 `现在 - savedAt ≤ 30 分钟`。启动时没有被恢复的房间（快照缺失 / 放弃恢复 / 崩溃），其 `room_records` 记录在启动时补上 `destroyed_at`。环境变量 `RESTORE_SNAPSHOT=0` 表示本次启动不恢复快照（`deploy.sh --fresh` 可以用它，或直接删除快照文件）。
2. **进程关闭**：收到信号后先停止接收新连接并拒绝新的 HTTP API 请求（503 `SHUTTING_DOWN`），写完快照后房间即冻结（此后到达的 ws 请求返回 `SERVER_RESTARTING`），再以 1012 关闭所有 ws。“3 秒强退”兜底从快照写完之后开始计时。关闭进程**不会**给开房记录写 `destroyed_at`（房间随快照保留）。
3. **`maintenance.message`**：后台接口（`overview`、`system`、`system/maintenance`）返回管理员设置的原始值；`GET /api/notices` 和 ws `sys` 在维护模式开启且提示语为空时，填入默认提示语“系统维护中，暂时不能开新房间”。`POST /api/admin/system/maintenance` 省略 `message` 时保留原值，最长 100 字。
4. **通知校验**：不合法返回 400 `BAD_REQUEST`（`message` 说明原因）。新建时缺省值为 `level = 'info'`、`banner = true`、`popup = false`、`enabled = true`、各时间为 `null`、`content = ''`；`endsAt` 必须晚于 `startsAt`，`maintEnd` 必须晚于 `maintStart`。时间字段传 `null` 表示清空。
5. **`winners_json`** 的结构为 `{ seats: number[], userIds: string[], names: string[] }`（`names` 即 `AdminHandRow.winners`，`seats` 即 `winnerSeats`）；作废的局三项都是空数组。
6. **局数口径**：`room_records.hands_played`、`Stats.handsToday / handsTotal`、`AdminUser.hands` 都不含 `reason = 'voided'` 的局（与 `SessionSummary.handsPlayed` 一致）；作废的局仍会写入 `hand_records` / `hand_players`（`delta` 全为 0），`pot` 记作废前各人下注之和。
7. **`log_json`**：服务端对局内部保留最多 2000 条日志（客户端视图仍只有最近 100 条），对局记录写入的是这份完整日志。
8. **`AdminRoom`**：房间已销毁时 `sessionNo = sessionsPlayed`、`handNo = 0`（销毁后不再有“当前场 / 局”）；`ownerNickname` 在房间存活时取房主当前昵称，否则取开房时的昵称。`GET /api/admin/rooms` 的 `status` 缺省为 `all`；`live` 与 `GET /api/admin/rooms/:code` 的 `live` 字段都取自内存中的房间。
9. **`GET /api/admin/hands`**：`session` 必须与 `room` 一起使用，否则 400；`page`、`size` 不是正整数时 400。
10. **用户管理**：`POST /api/admin/users/:userId/ban` 额外返回 `{ user: AdminUser }`；封禁状态只在密码校验通过后才提示（密码错误仍是 401 `BAD_CREDENTIALS`）。`POST .../password` 密码不合规时 400 `BAD_PASSWORD`。用户不存在为 404 `NOT_FOUND`。
11. **解散房间**：`reason` 最长 100 字；事件 `text` 为“房间已被管理员解散”，有原因时追加“：原因”。房间不存在（含已销毁）时 404 `ROOM_NOT_FOUND`。解散时进行中的那一局不会写对局记录。
12. **管理员登录限流**：同一来源（TCP 地址）10 分钟内连续失败 10 次后，登录返回 429 `TOO_MANY_ATTEMPTS`，窗口过后恢复。服务启动时如果管理员口令仍是默认的 `admin / admin`，会在日志中给出警告。
13. **已知边界**：崩溃（非优雅退出）后只能恢复到最近一次快照（最多丢 20 秒）。快照之后、崩溃之前结束的那一局已经写入对局记录，恢复后如果这一局被重新打完，会产生一条重复的记录。
