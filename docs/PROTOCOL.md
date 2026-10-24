# 前后端通信协议

本文是前后端之间的契约，双方都必须严格遵守，字段名一律以本文为准。
规则见 [RULES.md](RULES.md)，产品需求见 [REQUIREMENTS.md](REQUIREMENTS.md)。

## 0. 约定

- 同一个 Node 进程、同一个端口提供：静态页面、HTTP API（`/api/*`）、WebSocket（`/ws`）。
- 开发环境：后端端口 `3000`；Vite 开发服务器端口 `5173`，把 `/api` 和 `/ws`（ws 代理）转发到 `http://localhost:3000`。
- 生产环境：后端监听 `PORT`（默认 80），静态文件目录是 `client/dist`。所有非 `/api`、`/ws`、非静态文件的 GET 请求都返回 `index.html`，供前端 history 路由使用。
- 所有时间都是毫秒时间戳（`Date.now()`）。
- 错误信息 `message` 一律用简体中文，可以直接展示给用户。
- 用户 ID `userId` 是服务端生成的字符串，与账号名 `username` 不同。

## 1. 前端路由

| 路径 | 页面 |
|---|---|
| `/login` | 登录 / 注册（支持 `?redirect=/r/xxxx`） |
| `/` | 大厅（未登录跳 `/login`） |
| `/create` | 创建房间配置页 |
| `/r/:code` | 房间页（未登录跳 `/login?redirect=/r/:code`） |

前端把 token 存在 `localStorage` 的 `zjh_token` 键里。

## 2. HTTP API

- 请求和响应都是 JSON。需要登录的接口带请求头 `Authorization: Bearer <token>`。
- 成功响应：`{ "ok": true, ...数据 }`
- 失败响应：`{ "ok": false, "error": { "code": "XXX", "message": "中文说明" } }`，同时返回合适的 HTTP 状态码（400 / 401 / 404 / 409）。

```ts
type User = { userId: string; username: string; nickname: string; voice: VoiceId | null };  // voice：喊话声音包，null = 跟随前端默认
type VoiceId = 'm' | 'f' | 'qs' | 'xz' | 'yj' | 'xm' | 'db' | 'sc' | 'yue';  // VOICE_IDS，服务端 server/src/voices.js 与前端 client/src/lib/voicePacks.js 保持一致
```

| 方法 | 路径 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|---|
| POST | `/api/register` | `{ username, password }` | `{ ok, token, user }` | 用户名已存在时返回 409 `USERNAME_TAKEN` |
| POST | `/api/login` | `{ username, password }` | `{ ok, token, user }` | 新登录会让该用户旧的 token 全部失效。账号或密码错误时返回 401 `BAD_CREDENTIALS`；账号被管理员封禁时返回 403 `BANNED`（“账号已被封禁”） |
| POST | `/api/logout` | — | `{ ok }` | 需要登录 |
| GET | `/api/me` | — | `{ ok, user, roomCode }` | 需要登录。`roomCode` 是当前所在房间，没有则为 `null`。token 无效时返回 401 `UNAUTHORIZED` |
| POST | `/api/me/nickname` | `{ nickname }` | `{ ok, user }` | 需要登录 |
| POST | `/api/me/voice` | `{ voice }` | `{ ok, user }` | 需要登录。`voice` 是 `VOICE_IDS` 之一，或 `null`（恢复默认）；其他值（含缺省）返回 400 `BAD_VOICE`（“不支持的声音”）。所在房间会立即重推 `state` |
| GET | `/api/config/defaults` | — | `{ ok, config, limits }` | 不需要登录。返回默认配置和各字段的取值范围（见 §4） |
| POST | `/api/rooms` | `{ config }` | `{ ok, code }` | 需要登录。创建房间，创建者成为房主（还没进入房间）。配置不合法时返回 400 `BAD_CONFIG`，`message` 说明是哪一项；维护模式下返回 503 `MAINTENANCE`，`message` 为维护提示语 |
| GET | `/api/rooms/:code` | — | `{ ok, exists, phase, seated, spectators }` | 需要登录。大厅输入房间号时先查一下 |
| GET | `/api/notices` | — | `{ ok, notices, maintenance, version }` | 不需要登录。当前有效的系统通知、维护模式状态、服务端版本号，字段见 [ADMIN.md](ADMIN.md) 第 3 节 |

## 3. WebSocket

### 3.1 连接

- 地址：`ws(s)://<host>/ws?token=<token>`。token 无效时，服务端用关闭码 `4001` 关闭连接，前端应跳转登录页。
- 服务端重启（热更新）时，会用关闭码 `1012`（Service Restart）关闭所有连接。前端显示“服务器更新中，正在重连…”，约 0.5 秒后开始重连，重连后重新发送 `room.join`，房间和牌局由服务端从快照恢复（见 [ADMIN.md](ADMIN.md) 第 1 节）。进程正在关闭时收到的请求会返回错误码 `SERVER_RESTARTING`。
- 管理员封禁账号或重置密码时，该用户的连接以 `4001` 关闭（token 已作废），前端按 token 失效处理，回到登录页。
- 同一用户建立新连接时，服务端先给旧连接发 `{ "type": "replaced" }`，再用关闭码 `4002` 关闭它。前端收到后**不要**自动重连，提示“账号已在其他设备登录”并跳转登录页。
- 心跳：前端每 20 秒发一次 `{ "type": "ping" }`，服务端回 `{ "type": "pong", "serverTime": <ms> }`。服务端会用 ws 协议层的 ping 清理死连接（45 秒无响应即断开）。
- 前端断线后指数退避重连（1s、2s、4s… 最大 10s）。重连成功后，如果当前在房间页，重新发送 `room.join`。

### 3.2 消息格式

客户端 → 服务端（请求）：

```json
{ "type": "req", "id": "c-17", "action": "game.raise", "data": { "to": 25 } }
```

服务端 → 客户端（响应，每个请求必回一个）：

```json
{ "type": "res", "id": "c-17", "ok": true, "data": {} }
{ "type": "res", "id": "c-17", "ok": false, "error": { "code": "NOT_YOUR_TURN", "message": "还没轮到你" } }
```

服务端 → 客户端（推送）：

```json
{ "type": "state", "data": RoomView }
{ "type": "event", "data": RoomEvent }
{ "type": "replaced" }
{ "type": "pong", "serverTime": 1730000000000 }
{ "type": "sys", "data": SysInfo }
```

`sys` 是系统消息：连接建立后服务端立即发送一次；管理员增删改通知、切换维护模式时向**所有**在线连接重新发送一次完整内容；通知到达生效 / 失效时间时也会重发。`notices` 只含当前有效的通知，排序同 `GET /api/notices`。

```ts
type SysInfo = {
  version: string;                 // 服务端版本号，未部署时为 "dev"
  notices: Notice[];               // 当前有效的通知，定义见 ADMIN.md 3.1
  maintenance: { enabled: boolean; message: string };   // 开启时 message 非空（为空时服务端填默认提示语）
};
```

### 3.3 客户端请求（`action`）

| action | data | 谁可以 | 说明 |
|---|---|---|---|
| `room.join` | `{ code }` | 任何登录用户 | 进入房间，身份是观战者；已在房间内则只是重新同步状态。成功后服务端立即推送 `state`；响应 `data` 为 `{ chat: ChatMsg[] }`（最近 50 条聊天） |
| `room.leave` | `{}` | 成员 | 退出房间。本局对局中未弃牌的，先自动弃牌 |
| `seat.sit` | `{ seatIndex }` | 观战者 | 0–14，座位必须为空 |
| `seat.stand` | `{}` | 入座者 | 本局对局中不可用 |
| `room.ready` | `{ ready: boolean }` | 入座的非房主 | 仅准备阶段 |
| `room.updateConfig` | `{ config }` | 房主 | 仅准备阶段。`config` 是完整配置对象，`initialChips` 被忽略。成功后所有人的准备状态清空 |
| `room.start` | `{}` | 房主 | 仅准备阶段 |
| `room.kick` | `{ userId, ban? }` | 房主 | 任何阶段。`ban: true` 时被踢者在房间解散前不能再进入（对机器人无效）。踢本局对局中的人：先自动弃牌，本局结束后清理座位 |
| `room.addBot` | `{ seatIndex? }` | 房主 | 往空座位加一个机器人（不传 `seatIndex` 则坐第一个空位），机器人自动准备。座位已有人返回 `SEAT_TAKEN` |
| `room.endSession` | `{}` | 房主 | 仅对局阶段。当前局作废并退还下注，然后进入结算 |
| `room.restart` | `{}` | 房主 | 仅结算阶段。进入下一场的准备阶段 |
| `game.look` | `{}` | 本局在场玩家 | 随时可用 |
| `game.fold` | `{}` | 本局在场玩家 | 随时可用 |
| `game.call` | `{}` | 当前行动者 | |
| `game.raise` | `{ to }` | 当前行动者 | `to` 是新的闷牌单注，必须是 `ante × raiseSteps[i]` 之一 |
| `game.compare` | `{ targetSeat }` | 当前行动者 | |
| `game.allIn` | `{}` | 当前行动者 | 孤注一掷 |
| `game.show` | `{}` | 上一局的赢家 | 仅局间可用，亮牌给所有人 |
| `chat.send` | `{ kind: 'text' \| 'emoji', text }` 或 `{ kind: 'prop', text, toSeat }` | 房间成员（入座者和观战者都可以） | 文字最多 60 字（去掉控制字符、合并空白）；表情必须是 `CHAT_EMOJIS` 之一；同一人两条间隔至少 800ms，否则 `CHAT_TOO_FAST`。成功后向所有在线成员推送 `chat` 事件，不推 `state`。<br>互动道具 `prop`：`text` 必须是 `PROP_IDS` 之一（否则 `INVALID_ACTION`“不支持的道具”）；`toSeat` 必须是有人的座位号（否则 `INVALID_ACTION`“对方不在座位上”），且不能是自己（`INVALID_ACTION`“不能对自己使用道具”）；除 800ms 间隔外，同一人两次道具至少间隔 2500ms，否则 `CHAT_TOO_FAST`（“道具用得太快了，歇一会儿”） |

常用错误码（另有 `UNKNOWN_ACTION`、`BAD_REQUEST`、`INTERNAL`，HTTP 侧还有 `BAD_USERNAME`、`BAD_PASSWORD`、`BAD_NICKNAME`、`BAD_VOICE`、`TOO_MANY_ROOMS`、`NOT_FOUND`）：`NOT_IN_ROOM`、`ROOM_NOT_FOUND`、`ROOM_FULL`、`BANNED`（房间内：被房主移出后无法再次进入；HTTP 登录：账号被管理员封禁，状态码 403）、`MAINTENANCE`（维护模式下创建房间、`room.start`、`room.restart`，HTTP 状态码 503）、`SERVER_RESTARTING`（服务端正在关闭）、`IN_OTHER_GAME`、`NOT_OWNER`、`BAD_PHASE`、`SEAT_TAKEN`、`NOT_SEATED`、`IN_HAND`、`NOT_YOUR_TURN`、`INVALID_ACTION`、`INSUFFICIENT_CHIPS`、`BAD_CONFIG`、`NOT_ENOUGH_PLAYERS`、`NOT_ALL_READY`。

## 4. 数据结构

### 4.1 配置

```ts
type Config = {
  hands: number; initialChips: number; rebuyMax: number; ante: number;
  raiseMode: 'steps' | 'free'; raiseSteps: number[]; capMultiple: number; seenMultiplier: number;
  maxRounds: number; compareAfterRound: 1 | 2 | 3;
  actionSeconds: number; nextHandSeconds: number; settleSeconds: number; timeoutAction: 'fold' | 'call';
  a23: 'lowest' | 'second' | 'none';
  baozi235: 'all' | 'aaa' | 'off'; baozi235Suit: 'mixed' | 'any';
  tieRule: 'challengerLoses' | 'suit';
  compareCost: 1 | 2; blindCanCompare: boolean;
  shortStack: 'allIn' | 'foldOnly';
  bonusEnabled: boolean; bonusBaozi: number; bonusShunjin: number;
};
```

默认值和取值范围见 RULES.md 第 5 节。`GET /api/config/defaults` 返回的 `limits` 格式如下：

```ts
type Limits = Record<keyof Config, { min?: number; max?: number; options?: any[]; quick?: number[]; minItems?: number; maxItems?: number }>;
```

补充：`raiseSteps` 的 `min/max` 约束每一档的取值，`minItems/maxItems`（1 / 5）约束档位个数。除 RULES.md 第 5 节外，服务端额外要求 `ante ≤ initialChips`（否则 `BAD_CONFIG`）。创建房间 / 更新配置时缺失的字段用默认值补齐。

### 4.2 牌

```ts
type Card = { r: number; s: 's' | 'h' | 'c' | 'd' };   // r: 2–14，14 = A；s：黑桃 / 红桃 / 梅花 / 方块
type HandType = 'baozi' | 'shunjin' | 'jinhua' | 'shunzi' | 'duizi' | 'sanpai';
type CardsView = { cards: Card[]; type: HandType; label: string; is235: boolean };
// label 是中文，例如 "豹子 A"、"顺金 QKA"、"对子 9"、"单张 K"
```

### 4.3 RoomView（`state` 推送）

服务端在房间状态有任何变化时，给房间内**每个**连接各推送一份**按接收者裁剪过的**完整快照。前端以最新快照为准渲染，不做增量合并。

```ts
type RoomView = {
  serverTime: number;              // 前端用它校正倒计时：offset = serverTime - Date.now()
  code: string;
  ownerId: string;
  phase: 'waiting' | 'playing' | 'finished';
  config: Config;
  sessionNo: number;               // 第几场，从 1 开始
  handNo: number;                  // 本场当前（或最近一局）是第几局，未开始时为 0
  seats: (SeatView | null)[];      // 固定 15 个元素，下标就是 seatIndex
  spectators: MemberView[];
  me: { userId: string; nickname: string; seatIndex: number | null; isOwner: boolean };
  hand: HandView | null;           // 当前局；局间和结算阶段是刚结束的那一局；准备阶段为 null
  nextHandAt: number | null;       // 局间倒计时，下一局开始的时间点
  paused: boolean;                 // 本场暂停：有积分的入座玩家不足 2 人，等待入座（phase 仍为 playing）
  summary: SessionSummary | null;  // 结算阶段为本场结算，否则为 null
  totals: { userId: string; nickname: string; net: number }[];  // 历场累计输赢，按 net 降序
  sessions: SessionSummary[];      // 已结束的各场，最近的在前，最多 20 条
};

type MemberView = { userId: string; nickname: string; online: boolean; voice: VoiceId | null };  // voice 见第 2 节 User；机器人随机分配一个

type SeatView = MemberView & {
  seatIndex: number;
  chips: number;
  ready: boolean;                  // 准备阶段才有意义
  rebuy: number;                   // 本场已补领的积分（额外领分）
  isBot: boolean;                  // 机器人（userId 以 `bot:` 开头）
  // idle：准备阶段 / 局间 / 结算；playing：本局参与中；waitingNext：本局开始后才入座，等下一局；
  // sittingOut：积分不足底注，本局不参与
  status: 'idle' | 'playing' | 'waitingNext' | 'sittingOut';
};

type HandPlayerView = {
  seatIndex: number; userId: string; nickname: string;
  state: 'active' | 'folded' | 'lost' | 'won';  // won 仅在本局结束后出现
  seen: boolean;                   // 是否已看牌（公开信息）
  bet: number;                     // 本局累计投入（含底注）
  allIn: boolean;
  timedOut: boolean;               // 本局是否超时过
};

type HandView = {
  handNo: number;
  dealerSeat: number;
  pot: number;
  currentBet: number;              // 闷牌单注
  round: number;
  turnSeat: number | null;         // 当前行动者，本局已结束则为 null
  turnDeadline: number | null;
  players: HandPlayerView[];       // 本局参与者，按 seatIndex 升序
  myCards: CardsView | null;       // 只有本人已看牌、比牌输了，或本局已结束时才有值
  visible: (CardsView & { seatIndex: number })[];  // 本人有权看到的他人的牌（规则见 RULES.md 3.7 / 3.9）
  actions: ActionsView | null;     // 只有本人是当前行动者时才有值
  canLook: boolean;                // 本人在场且还没看牌
  canFold: boolean;                // 本人在场
  ended: boolean;
  result: HandResult | null;
  log: LogEntry[];                 // 本局操作记录，按时间顺序，最多 100 条
};

type ActionsView = {
  call: { cost: number } | null;                          // null = 付不起
  raise: { to: number; cost: number }[];                  // 只列出可选、付得起的档位
  raiseRange: { min: number; max: number; mult: number } | null; // 自由加注模式下可加到的闷牌单注范围；实际支付 = to × mult
  compare: { cost: number; targets: number[] } | null;    // targets 是可比的 seatIndex；null = 当前不能比
  allIn: { cost: number } | null;                         // 满足孤注一掷条件时才有值
};

type HandResult = {
  reason: 'lastStanding' | 'allIn' | 'showdown' | 'voided';
  winners: number[];               // seatIndex；voided 时为空数组
  potWon: number;                  // 每位赢家分到的底池积分
  bonus: { seatIndex: number; type: 'baozi' | 'shunjin'; total: number } | null;
  deltas: { seatIndex: number; delta: number }[];   // 本局每位参与者的净积分变化（含底注、下注、喜钱）
  showable: boolean;               // 本人是赢家、还没亮牌、处于局间（用来显示“亮牌”按钮）
};

type LogEntry = {
  t: number; seatIndex: number | null; nickname: string | null;
  kind: 'ante' | 'look' | 'call' | 'raise' | 'compare' | 'allIn' | 'fold' | 'timeout' | 'showdown' | 'win' | 'bonus' | 'show' | 'void';
  amount?: number; targetSeat?: number; loserSeat?: number;
  text: string;                    // 服务端生成的中文描述，例如 "小王 闷跟 10"、"小李 比牌 小张，小张 输"
};

type SessionSummary = {
  sessionNo: number;
  endedAt: number;
  handsPlayed: number;
  hands: number;                   // 配置的局数
  endReason: 'completed' | 'owner' | 'busted'; // 打满局数 / 房主提前结束 / 其他人输光
  // 本场入座过的所有人（包括中途改为观战模式的），按 net 降序
  // net = finalChips − initialChips − rebuy
  players: { userId: string; nickname: string; net: number; finalChips: number; rebuy: number; bestType: HandType | null; wins: number }[];
};
```

### 4.4 RoomEvent（`event` 推送）

事件只用于触发动画和提示，不改变状态；状态一律以 `state` 为准。服务端先推 `event`，再推 `state`。

```ts
type RoomEvent =
  | { kind: 'notice'; text: string }                     // 通用提示，例如 "房主修改了配置，请重新准备"、"小王 成为房主"
  | { kind: 'handStart'; handNo: number }                 // 发牌动画
  | { kind: 'compare'; fromSeat: number; toSeat: number; loserSeat: number }
  | { kind: 'allIn'; seat: number; success: boolean }
  | { kind: 'handEnd'; result: HandResult & HandEndStreak }
  | { kind: 'sessionEnd'; summary: SessionSummary }
  | { kind: 'rebuy'; seat: number; amount: number }      // 某座位自动补领积分（额外领分）
  | { kind: 'kicked'; banned: boolean }                  // 你被踢出房间，前端回大厅；banned=true 表示不能再进入
  | { kind: 'dissolved'; text: string }                   // 房间被管理员解散，text 为可直接展示的说明，前端提示后回大厅
  | { kind: 'chat'; msg: ChatMsg };                       // 聊天消息（发送者自己也会收到）

type ChatMsg = {
  id: number; t: number;
  userId: string; nickname: string;
  seatIndex: number | null;        // 发送时所在座位；观战者为 null
  kind: 'text' | 'emoji' | 'prop';
  text: string;                    // prop 时为道具 id
  // 以下三项只有 prop 消息才有：发送时目标所在座位、目标的 userId 和昵称
  toSeat?: number;
  toUserId?: string;
  toNickname?: string;
};
// CHAT_EMOJIS：😀 😂 🤣 😎 😍 😭 😡 😱 🤔 😏 🙄 😴 👍 👎 👏 🙏 💪 🤝 🎉 💰 🔥 💯 🍺 🌹
// PROP_IDS：flower（鲜花）kiss（飞吻）beer（干杯）like（点赞）egg（鸡蛋）tomato（番茄）bomb（炸弹）
// 机器人比牌输给真人时，偶尔（约 15%）会在约 2.6 秒后朝赢家扔 egg 或 tomato（同样是 prop 消息）

// handEnd 事件里额外带的连胜信息（只在事件里有，HandView.result 没有）
type HandEndStreak = {
  streak: { seatIndex: number; n: number } | null;            // 赢家唯一且本场已连胜 n ≥ 2 局；seatIndex 是赢家座位
  streakEnd: { seatIndex: number | null; n: number } | null;  // 本局之前有人连胜 n ≥ 3、这一局输给了别人；seatIndex 是他在本局的座位，没参与本局为 null
};
// 连胜按本场计：平分底池时清空（被平分的连胜者不给 streakEnd）；作废局两项都为 null，也不影响连胜；新一场开始时清空
```

## 5. 可见性检查清单（服务端必须做到）

裁剪 `RoomView` 时，下面每一条都必须成立。服务端测试里会逐条断言：

1. 闷牌玩家的 `myCards` 为 `null`。
2. `visible` 里只包含：
   - 和本人比牌、本人是胜方时，负方的牌；
   - 本人是比牌负方时，胜方的牌；
   - 强制开牌时所有在场玩家的牌；
   - 赢家亮牌或触发喜钱时赢家的牌。
3. 观战者的 `myCards` 永远为 `null`，`visible` 只含第 2 条中的公开部分：强制开牌、亮牌、喜钱。
4. 弃牌者的牌永远不进入其他人的 `visible`。
5. `event` 消息里不包含任何牌面。


## 6. 服务端实现补充说明（对本文其他章节的澄清，前后端均以此为准）

1. `GET /api/rooms/:code`：房间不存在时返回 HTTP 200，`{ ok: true, exists: false, phase: null, seated: 0, spectators: 0 }`。
2. 打满 `hands` 局后，最后一局结束时同样会设置 `nextHandAt`（`settleSeconds` 秒后），期间 `phase` 仍是 `playing`、`hand.ended = true`，可以亮牌；倒计时结束后 `phase` 变为 `finished`、`summary` 有值，并推送 `sessionEnd` 事件。前端可用 `hand.handNo >= config.hands` 判断“这是最后一局，倒计时后进入结算”。房主 `room.endSession` 则立即进入 `finished`。
3. `game.show` 在局间（`playing` 且上一局已结束）和 `finished` 阶段可用，上一局被作废时不可用；`result.showable` 同此条件。
4. `visible` 永远不含已弃牌者的牌：即使某人曾在比牌中被对方看到过牌，他之后弃牌，其牌也会从对方的 `visible` 中消失。
5. 孤注一掷失败时，只暴露“败给的那一位”与孤注者这一对牌（互相可见）；成功时孤注者与所有人两两互相可见。比牌顺序为行动顺序。
6. `HandResult.potWon` 是每位赢家的底池份额（向下取整）；平分除不尽的余数由行动顺序最靠前的赢家额外获得（体现在 `deltas` 中）。
7. `SessionSummary.players[].bestType` 只统计该玩家**没有弃牌**的局的牌型（避免泄露弃牌者的牌）；作废的局不计入 `handsPlayed`。
8. `room.leave`：对局中未弃牌的先自动弃牌；其座位保留到本局结束后再清理（期间显示离线），退出者的积分记入本场，同一场再次进入并入座可恢复。
9. ws 连接建立 / 断开时，若该用户在某个房间里，服务端会向房间推送最新 `state`（`online` 变化）；前端重连后仍需发 `room.join`。
10. 房主发 `room.ready` 返回 `INVALID_ACTION`（房主无需准备）。房主主动退出且暂时没有在线候选人时，房主身份保留，等有人在线后立即转移。
11. 离线超过 5 分钟且未入座的观战者会被清出房间；入座者的座位始终保留。
12. 默认 `PORT` 为 3000（第 0 节所说生产环境端口以部署时设置的环境变量为准）。
13. 被踢者只会收到 `kicked` 事件，不再收到后续 `state`。
14. 管理员解散房间时，房间内所有成员（含离线者，仅在线者能收到）收到 `dissolved` 事件，之后房间被销毁，不再有 `state`；`/api/me` 的 `roomCode` 变为 `null`。
15. 热更新恢复房间后，所有成员先处于离线状态，直到各自重连并发送 `room.join`（或仅重连，服务端会按在线状态推送 `state`）；局内的行动倒计时整体顺延停机时长，重启的时间不算玩家的思考时间。
16. 房间号只含小写字母和数字；`/api/rooms/:code`、`room.join` 查找房间号时不区分大小写，`state.code` 返回房间的原始房间号。
17. 发牌动画：每局开始时服务端把第一位行动者的 `turnDeadline` 顺延发牌动画的时长（按参与人数计算，2 人约 2.8 秒、15 人约 5.6 秒，见 `room.js` 的 `dealDurationMs`），前端在这段时间里一张一张发牌；机器人也等发完牌再出手。
18. 热更新恢复房间时，旧版本快照里缺少的配置项（后来新增的，例如 `rebuyMax`）用默认值补齐；缺少成员的 `voice`、连胜信息时按 `null` 处理（成员重新 `room.join` 后按账号设置更新 `voice`）。
