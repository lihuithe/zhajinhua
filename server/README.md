# 炸金花服务端

Node 24 + ESM，运行时依赖只有 `ws`。HTTP 用 `node:http` 手写，数据库用内置 `node:sqlite`。
协议见 `../docs/PROTOCOL.md`，规则见 `../docs/RULES.md`。

## 目录结构

```
server/
  src/
    index.js            启动入口（读环境变量、优雅退出）
    app.js              组装应用：db + auth + 房间管理 + HTTP + WebSocket（测试也用它）
    config.js           房间配置默认值 / 取值范围 limits / 校验，环境变量读取
    errors.js           业务错误 AppError
    db.js               node:sqlite：users / tokens / session_results / session_players
    auth.js             注册、登录（scrypt + 随机盐）、token（32 字节 hex，30 天）、昵称
    http.js             API 路由、JSON 解析、静态文件（gzip 缓存）、SPA 回退
    ws.js               WebSocket：鉴权、顶号(4002)、协议层 ping 清理死连接、请求分发
    game/cards.js       牌、洗牌（crypto.randomInt + Fisher–Yates）
    game/hand.js        牌型判定与比较（纯函数，规则开关来自 config）
    game/handGame.js    一局的状态机（纯逻辑，无定时器，now() 注入）
    room/room.js        房间：座位 / 观战 / 准备 / 房主 / 场次 / 局间倒计时 / 超时 / RoomView 裁剪
    room/roomManager.js 房间号生成、用户与房间对应、进入/切换房间、30 分钟无人销毁
  test/                 node:test 测试（hand / handGame / visibility / room / integration）
  data/                 默认数据目录（SQLite 文件 zjh.db，已被 .gitignore 忽略）
```

## 运行

```bash
cd server
npm install --registry=https://registry.npmmirror.com   # 可选镜像
npm start          # node src/index.js
npm run dev        # node --watch src/index.js
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `server/data` | SQLite 数据目录（自动创建） |
| `STATIC_DIR` | `<repo>/client/dist` | 前端静态文件目录；不存在时只提供 API，不会崩溃 |

## 测试

```bash
cd server
npm test           # node --test，全部测试约 7 秒
```

- `hand.test.js`：牌型穷举（22100 种组合）、a23 / 235 / tieRule 各组合、逐张比较边界
- `handGame.test.js`：单局状态机（价格、加注、轮次、比牌、孤注一掷、强制开牌、喜钱、作废、超时、随机对局不变量）
- `visibility.test.js`：PROTOCOL.md 第 5 节可见性清单逐条断言
- `room.test.js`：房间逻辑（假时钟 + 假定时器，不会真的等待）与 RoomManager
- `integration.test.js`：真实启动服务（随机端口、临时 DATA_DIR），用 ws 客户端模拟多用户完整流程

集成测试通过 `createApp({ timing: { nextHandDelayMs, actionScale, ... } })` 缩短局间倒计时和行动限时。

## 内存与资源

- 每个房间同一时刻只有一个 `setTimeout`（行动超时 / 局间倒计时 / 房主转移 / 观战者清理共用）；房间销毁时清理定时器并释放成员与对局引用。
- `RoomManager` 每 30 秒扫描一次，无人在线满 30 分钟的房间销毁。
- WebSocket 禁用 permessage-deflate，限制消息大小与频率，发送缓冲积压超过 2MB 的连接会被断开；协议层 ping 每 15 秒一次，45 秒无响应即断开。
