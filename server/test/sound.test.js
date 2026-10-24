// 声音丰富化：玩家声音包（voice）、互动道具（chat kind 'prop'）、连胜信息（handEnd 的 streak / streakEnd）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeEnv, rigFrom, NO_BONUS_CARDS } from './helpers.js';
import { startServer, createRoom, joinAndSit } from './serverHelpers.js';
import { Room, PROP_IDS } from '../src/room/room.js';
import { VOICE_IDS, isVoiceId } from '../src/voices.js';
import { openDb } from '../src/db.js';

const throwsCode = (fn, code, msg) =>
  assert.throws(fn, (e) => e.code === code && (!msg || msg.test(e.message)), `应抛出 ${code}${msg ? ` ${msg}` : ''}`);

const chatMsgs = (env, to = 'u0') => env.events(to).filter((e) => e.kind === 'chat').map((e) => e.msg);
const handEnds = (env, to = 'u0') => env.events(to).filter((e) => e.kind === 'handEnd').map((e) => e.result);

// 让当前局快速结束：除 winner 外全部弃牌
function foldAllExcept(env, winner, n) {
  for (let i = 0; i < n; i++) if (i !== winner) env.do(i, 'game.fold');
}

// ---------------------------------------------------------------- 声音包

test('声音包：VOICE_IDS 与校验函数', () => {
  assert.deepEqual([...VOICE_IDS], ['m', 'f', 'qs', 'xz', 'yj', 'xm', 'db', 'sc', 'yue']);
  assert.ok(Object.isFrozen(VOICE_IDS));
  for (const v of VOICE_IDS) assert.equal(isVoiceId(v), true);
  for (const v of ['', 'M', 'x', null, undefined, 1, {}]) assert.equal(isVoiceId(v), false);
});

test('声音包：HTTP 设置 / 读取；非法值 BAD_VOICE；房间内的视图随之更新', async () => {
  const srv = await startServer();
  try {
    const a = await srv.register('voicer');
    assert.equal(a.user.voice, null, '新注册的账号没有声音包');
    let r = await srv.api('/api/me', { token: a.token });
    assert.equal(r.user.voice, null);

    r = await srv.api('/api/me/voice', { method: 'POST', token: a.token, body: { voice: 'qs' } });
    assert.equal(r.status, 200);
    assert.equal(r.ok, true);
    assert.deepEqual(r.user, { userId: a.user.userId, username: 'voicer', nickname: 'voicer', voice: 'qs' });
    r = await srv.api('/api/me', { token: a.token });
    assert.equal(r.user.voice, 'qs');

    // 非法值：不支持的 id、非字符串、缺省
    for (const body of [{ voice: 'nope' }, { voice: 'QS' }, { voice: 3 }, { voice: ['m'] }, {}]) {
      r = await srv.api('/api/me/voice', { method: 'POST', token: a.token, body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.error.code, 'BAD_VOICE');
      assert.equal(r.error.message, '不支持的声音');
    }
    r = await srv.api('/api/me', { token: a.token });
    assert.equal(r.user.voice, 'qs', '失败的设置不改变原值');
    // 需要登录
    r = await srv.api('/api/me/voice', { method: 'POST', body: { voice: 'm' } });
    assert.equal(r.status, 401);

    // room.join 带上账号的声音包；在房间里改声音包会重推 state
    const b = await srv.register('listener');
    const code = await createRoom(srv, a);
    const ca = await srv.connect(a);
    await joinAndSit(ca, code, 0);
    const cb = await srv.connect(b);
    await joinAndSit(cb, code);
    let s = await cb.waitState((st) => st.seats[0] && st.spectators.length === 1, '入座与观战');
    assert.equal(s.seats[0].voice, 'qs');
    assert.equal(s.spectators[0].voice, null);
    r = await srv.api('/api/me/voice', { method: 'POST', token: b.token, body: { voice: 'yue' } });
    assert.equal(r.user.voice, 'yue');
    s = await ca.waitState((st) => st.spectators[0] && st.spectators[0].voice === 'yue', '观战者声音包更新');
    // 设为 null 恢复默认
    r = await srv.api('/api/me/voice', { method: 'POST', token: a.token, body: { voice: null } });
    assert.equal(r.ok, true);
    assert.equal(r.user.voice, null);
    await cb.waitState((st) => st.seats[0] && st.seats[0].voice === null, '入座者声音包恢复默认');

    // 登录返回的 user 同样带 voice
    r = await srv.api('/api/login', { method: 'POST', body: { username: 'listener', password: 'pass1234' } });
    assert.equal(r.user.voice, 'yue');
  } finally {
    await srv.stop();
  }
});

test('声音包：旧数据库缺 voice 列时自动补上，setVoice 可用', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-voice-'));
  try {
    const old = new DatabaseSync(join(dir, 'zjh.db'));
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lc TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'Old', 'old', 'Old', 'aa', 'bb', 1000);
    `);
    old.close();
    const db = openDb(dir);
    assert.ok(db.raw.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'voice'));
    assert.equal(db.getUserById('u1').voice, null);
    db.setVoice('u1', 'db');
    assert.equal(db.getUserById('u1').voice, 'db');
    db.close();
    openDb(dir).close(); // 重复打开不会重复 ALTER
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('声音包：入座者 / 观战者的视图带 voice；重新进入与 updateVoice 会更新', () => {
  const env = makeEnv();
  env.room.join('u0', 'N0', 'm');
  env.sit(0);
  env.room.join('u1', 'N1'); // 不传则为 null
  env.room.join('u2', 'N2', 'sc');
  env.sit(2);
  let v = env.view(1);
  assert.equal(v.seats[0].voice, 'm');
  assert.equal(v.seats[2].voice, 'sc');
  assert.deepEqual(v.spectators, [{ userId: 'u1', nickname: 'N1', online: true, voice: null }]);

  // 重新进入：按最新的账号设置更新
  env.room.join('u0', 'N0', 'f');
  assert.equal(env.view(1).seats[0].voice, 'f');

  // updateVoice：修改后立即推送 state
  const before = env.sent.length;
  env.room.updateVoice('u1', 'xm');
  assert.equal(env.lastState('u0').spectators[0].voice, 'xm');
  assert.ok(env.sent.slice(before).some((s) => s.to === 'u2' && s.msg.type === 'state'));
  env.room.updateVoice('nobody', 'm'); // 不在房间：忽略
});

test('声音包：机器人随机一个合法的声音包，并出现在视图里', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  env.room.rand = () => 0.5; // 固定随机数：VOICE_IDS[4]
  env.do(0, 'room.addBot', { seatIndex: 1 });
  assert.equal(env.view(0).seats[1].voice, VOICE_IDS[4]);
  env.room.rand = Math.random;
  for (let i = 2; i < 8; i++) env.do(0, 'room.addBot', { seatIndex: i });
  for (const s of env.view(0).seats.filter((x) => x && x.isBot)) assert.ok(isVoiceId(s.voice), `机器人声音包 ${s.voice}`);
});

test('声音包 / 连胜 / 道具消息：快照往返保留；旧快照缺少字段时为 null', () => {
  const env = makeEnv({ cfg: { hands: 10 } });
  env.room.join('u0', 'N0', 'qs');
  env.sit(0);
  env.room.join('u1', 'N1', 'yj');
  env.sit(1);
  env.ready(1);
  env.room.join('u2', 'N2', 'db'); // 观战
  env.do(0, 'room.addBot', { seatIndex: 3 });
  const bot = env.view(0).seats[3];
  env.do(0, 'room.start');
  // u1 连赢两局
  for (let k = 0; k < 2; k++) {
    if (k > 0) env.advance(5000);
    env.do(0, 'game.fold');
    env.room.handle(bot.userId, 'game.fold');
  }
  assert.deepEqual(env.room.winStreak, { userId: 'u1', n: 2 });
  env.do(2, 'chat.send', { kind: 'prop', text: 'flower', toSeat: 1 });

  const snap = JSON.parse(JSON.stringify(env.room.toSnapshot()));
  const r = Room.fromSnapshot(snap, env.deps);
  assert.deepEqual(r.winStreak, { userId: 'u1', n: 2 });
  const v = r.viewFor('u2');
  assert.deepEqual(v.seats.filter(Boolean).map((s) => s.voice), ['qs', 'yj', bot.voice]);
  assert.equal(v.spectators[0].voice, 'db');
  const { kind, text, toSeat, toUserId, toNickname } = r.chatHistory().at(-1);
  assert.deepEqual({ kind, text, toSeat, toUserId, toNickname }, { kind: 'prop', text: 'flower', toSeat: 1, toUserId: 'u1', toNickname: 'N1' });

  // 旧快照：成员没有 voice、没有 winStreak
  for (const m of snap.members) delete m.voice;
  delete snap.winStreak;
  const old = Room.fromSnapshot(snap, env.deps);
  assert.equal(old.winStreak, null);
  const ov = old.viewFor('u2');
  assert.ok(ov.seats.filter(Boolean).every((s) => s.voice === null));
  assert.equal(ov.spectators[0].voice, null);
});

// ---------------------------------------------------------------- 互动道具

test('道具：入座者 / 观战者都能对座位上的人使用；消息带目标信息，推送给所有人并进聊天记录', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  env.join(1);
  env.sit(1);
  env.join(2); // 观战
  assert.deepEqual([...PROP_IDS], ['flower', 'kiss', 'beer', 'like', 'egg', 'tomato', 'bomb']);
  assert.ok(Object.isFrozen(PROP_IDS));

  env.do(0, 'chat.send', { kind: 'prop', text: 'flower', toSeat: 1 });
  const { id, t, ...rest } = chatMsgs(env, 'u2')[0];
  assert.equal(typeof id, 'number');
  assert.equal(t, env.clock.t);
  assert.deepEqual(rest, { userId: 'u0', nickname: 'N0', seatIndex: 0, kind: 'prop', text: 'flower', toSeat: 1, toUserId: 'u1', toNickname: 'N1' });
  assert.equal(chatMsgs(env, 'u0').length, 1, '发送者自己也收到');
  assert.equal(chatMsgs(env, 'u1').length, 1);

  // 观战者对入座者使用
  env.clock.t += 3000;
  env.do(2, 'chat.send', { kind: 'prop', text: 'egg', toSeat: 0 });
  const m2 = chatMsgs(env, 'u1').at(-1);
  assert.equal(m2.seatIndex, null);
  assert.equal(m2.toUserId, 'u0');
  assert.equal(m2.toNickname, 'N0');

  // 所有道具都可用；普通消息没有目标字段
  for (const p of PROP_IDS) {
    env.clock.t += 3000;
    env.do(1, 'chat.send', { kind: 'prop', text: p, toSeat: 0 });
  }
  env.clock.t += 3000;
  env.do(1, 'chat.send', { kind: 'text', text: '谢谢' });
  assert.equal('toSeat' in chatMsgs(env, 'u0').at(-1), false);
  assert.deepEqual(
    env.room.chatHistory().map((c) => [c.kind, c.text, c.toSeat]),
    [['prop', 'flower', 1], ['prop', 'egg', 0], ...PROP_IDS.map((p) => ['prop', p, 0]), ['text', '谢谢', undefined]],
  );
});

test('道具：不支持的道具、目标座位没人 / 不合法、对自己使用都被拒绝', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  env.join(1);
  env.sit(1);
  env.join(2); // 观战
  const prop = (i, text, toSeat) => env.do(i, 'chat.send', { kind: 'prop', text, toSeat });
  throwsCode(() => prop(0, 'rose', 1), 'INVALID_ACTION', /不支持的道具/);
  throwsCode(() => prop(0, '', 1), 'INVALID_ACTION', /不支持的道具/);
  throwsCode(() => prop(0, '🌹', 1), 'INVALID_ACTION', /不支持的道具/);
  for (const toSeat of [5, 14, 15, -1, 1.5, '1', null, undefined]) {
    throwsCode(() => prop(0, 'beer', toSeat), 'INVALID_ACTION', /对方不在座位上/);
  }
  throwsCode(() => prop(2, 'beer', 9), 'INVALID_ACTION', /对方不在座位上/);
  throwsCode(() => prop(0, 'bomb', 0), 'INVALID_ACTION', /不能对自己使用道具/);
  throwsCode(() => env.room.handle('u9', 'chat.send', { kind: 'prop', text: 'beer', toSeat: 0 }), 'NOT_IN_ROOM');
  assert.equal(chatMsgs(env, 'u1').length, 0);
  // 失败的请求不占用发言间隔和道具冷却
  prop(0, 'bomb', 1);
  assert.equal(chatMsgs(env, 'u1').length, 1);
});

test('道具：同一人两次道具至少间隔 2.5 秒；普通发言的 800ms 间隔对道具同样生效', () => {
  const env = makeEnv();
  env.join(0);
  env.sit(0);
  env.join(1);
  env.sit(1);
  const send = (i, data) => env.do(i, 'chat.send', data);
  const prop = (i, toSeat, text = 'like') => send(i, { kind: 'prop', text, toSeat });
  prop(0, 1);
  env.clock.t += 900;
  send(0, { kind: 'text', text: '接着' }); // 普通消息只看 800ms 间隔
  env.clock.t += 500; // 距上次道具 1400ms，距上条消息 500ms
  throwsCode(() => prop(0, 1), 'CHAT_TOO_FAST', /发言太快了/);
  env.clock.t += 400; // 距上次道具 1800ms，距上条消息 900ms
  throwsCode(() => prop(0, 1), 'CHAT_TOO_FAST', /道具用得太快了，歇一会儿/);
  env.clock.t += 699; // 距上次道具 2499ms
  throwsCode(() => prop(0, 1), 'CHAT_TOO_FAST', /道具用得太快了/);
  env.clock.t += 1; // 2500ms
  prop(0, 1, 'kiss');
  prop(1, 0, 'beer'); // 冷却按人计算
  // 道具之后普通消息仍受 800ms 间隔限制
  env.clock.t += 500;
  throwsCode(() => send(0, { kind: 'emoji', text: '👍' }), 'CHAT_TOO_FAST', /发言太快了/);
  env.clock.t += 300;
  send(0, { kind: 'emoji', text: '👍' });
  assert.deepEqual(chatMsgs(env, 'u0').map((m) => m.text), ['like', '接着', 'kiss', 'beer', '👍']);
});

test('机器人比牌输给真人：按概率在 2.6 秒后朝赢家扔鸡蛋 / 番茄；到点时对方已离座则不扔；销毁时清理', () => {
  // rand 依次返回给定的值：第 1 个用于机器人的声音包，第 2 个决定扔不扔，第 3 个决定扔什么
  const seq = (...xs) => () => (xs.length ? xs.shift() : 0.99);
  const setup = (rand, cards = ['As Kh 9d', '7s 4h 2d']) => {
    const env = makeEnv({ cfg: { hands: 10, compareAfterRound: 1, blindCanCompare: true }, rig: rigFrom(cards) });
    env.join(0);
    env.sit(0);
    env.room.rand = rand;
    env.do(0, 'room.addBot', { seatIndex: 1 });
    const botId = env.view(0).seats[1].userId;
    env.do(0, 'room.start');
    // 庄家 s0（randInt=0），机器人先行动：第 1 轮各跟一手，第 2 轮机器人比牌 s0
    env.room.handle(botId, 'game.call');
    env.do(0, 'game.call');
    env.room.handle(botId, 'game.compare', { targetSeat: 0 });
    assert.equal(env.view(0).hand.ended, true);
    return { env, botId };
  };

  // 命中概率：2.6 秒后扔鸡蛋
  let { env, botId } = setup(seq(0, 0.1, 0.2));
  assert.deepEqual(env.view(0).hand.result.winners, [0]);
  assert.equal(env.room.sideTimers.size, 1);
  const [h] = env.room.sideTimers;
  assert.equal(h.ms, 2600);
  assert.equal(chatMsgs(env).length, 0, '到点前不扔');
  env.clock.t += 2600;
  h.fn();
  assert.equal(env.room.sideTimers.size, 0);
  const { id, t, ...rest } = chatMsgs(env).at(-1);
  assert.equal(t, env.clock.t);
  assert.deepEqual(rest, { userId: botId, nickname: env.view(0).seats[1].nickname, seatIndex: 1, kind: 'prop', text: 'egg', toSeat: 0, toUserId: 'u0', toNickname: 'N0' });
  assert.equal(env.room.chatHistory().at(-1).id, id);

  // 没命中概率：不扔
  ({ env } = setup(seq(0, 0.15)));
  assert.equal(env.room.sideTimers.size, 0);

  // 机器人赢了：不扔
  ({ env } = setup(seq(0, 0, 0), ['7s 4h 2d', 'As Kh 9d']));
  assert.deepEqual(env.view(0).hand.result.winners, [1]);
  assert.equal(env.room.sideTimers.size, 0);

  // 随机数落在后半段：扔番茄
  ({ env } = setup(seq(0, 0.1, 0.9)));
  [...env.room.sideTimers][0].fn();
  assert.equal(chatMsgs(env).at(-1).text, 'tomato');

  // 到点时赢家已离座：不扔
  ({ env } = setup(seq(0, 0, 0)));
  env.do(0, 'seat.stand');
  [...env.room.sideTimers][0].fn();
  assert.equal(chatMsgs(env).filter((m) => m.kind === 'prop').length, 0);

  // 房间销毁时清理尚未触发的道具定时器
  ({ env } = setup(seq(0, 0, 0)));
  const [h2] = env.room.sideTimers;
  assert.ok(env.timers.has(h2));
  env.room.destroy();
  assert.equal(env.room.sideTimers.size, 0);
  assert.equal(env.timers.has(h2), false);
  h2.fn(); // 残留调用不抛错
});

// ---------------------------------------------------------------- 连胜

test('连胜：唯一赢家连胜 ≥ 2 局给出 streak；≥ 3 连胜被别人终结给出 streakEnd；平分底池清空连胜', () => {
  const env = makeEnv({ cfg: { hands: 20, initialChips: 1000, maxRounds: 5 } });
  env.start(3);
  const win = (winner) => {
    foldAllExcept(env, winner, 3);
    return handEnds(env).at(-1);
  };
  const next = () => env.advance(5000);
  // 平分：s0 弃牌，s1 / s2 牌完全相同，一直跟到强制开牌
  const split = () => {
    env.do(0, 'game.fold');
    for (let k = 0; k < 50 && !env.view(0).hand.ended; k++) env.do(env.view(0).hand.turnSeat, 'game.call');
    return handEnds(env).at(-1);
  };
  const pick = (r) => ({ streak: r.streak, streakEnd: r.streakEnd });

  let r = win(1);
  assert.deepEqual(r.winners, [1]);
  assert.deepEqual(pick(r), { streak: null, streakEnd: null }, '第 1 胜不算连胜');
  assert.deepEqual(env.room.winStreak, { userId: 'u1', n: 1 });
  next();
  assert.deepEqual(pick(win(1)), { streak: { seatIndex: 1, n: 2 }, streakEnd: null });
  next();
  assert.deepEqual(pick(win(1)), { streak: { seatIndex: 1, n: 3 }, streakEnd: null });
  // HandView.result 里没有连胜字段
  assert.equal('streak' in env.view(0).hand.result, false);
  assert.equal('streakEnd' in env.view(0).hand.result, false);
  next();
  assert.deepEqual(pick(win(2)), { streak: null, streakEnd: { seatIndex: 1, n: 3 } }, 'u2 终结 u1 的 3 连胜');
  assert.deepEqual(env.room.winStreak, { userId: 'u2', n: 1 });
  next();
  assert.deepEqual(pick(win(2)), { streak: { seatIndex: 2, n: 2 }, streakEnd: null });

  // 平分底池：连胜清空；之前只有 2 连胜，不给 streakEnd
  env.rigFn = rigFrom(['8s 3h 2d', 'As Kh 9d', 'Ah Ks 9c']);
  next();
  r = split();
  assert.equal(r.reason, 'showdown');
  assert.deepEqual([...r.winners].sort(), [1, 2]);
  assert.deepEqual(pick(r), { streak: null, streakEnd: null });
  assert.equal(env.room.winStreak, null);

  // u1 再连赢 3 局，之后和 u2 平分：连胜清空，但他没有输给别人，不给 streakEnd
  env.rigFn = rigFrom(NO_BONUS_CARDS);
  for (let k = 0; k < 3; k++) {
    next();
    win(1);
  }
  assert.deepEqual(env.room.winStreak, { userId: 'u1', n: 3 });
  env.rigFn = rigFrom(['8s 3h 2d', 'As Kh 9d', 'Ah Ks 9c']);
  next();
  assert.deepEqual(pick(split()), { streak: null, streakEnd: null });
  assert.equal(env.room.winStreak, null);
});

test('连胜：被终结者本局没参与时 streakEnd.seatIndex 为 null；作废局不计也不改变连胜；新一场清空', () => {
  const env = makeEnv({ cfg: { hands: 20 } });
  env.start(3);
  for (let k = 0; k < 3; k++) {
    if (k > 0) env.advance(5000);
    foldAllExcept(env, 1, 3);
  }
  assert.deepEqual(env.room.winStreak, { userId: 'u1', n: 3 });
  env.do(1, 'seat.stand'); // 局间改为观战
  env.advance(5000);
  env.do(0, 'game.fold'); // 只有 s0 / s2 参与，s2 赢
  let r = handEnds(env).at(-1);
  assert.deepEqual(r.winners, [2]);
  assert.equal(r.streak, null);
  assert.deepEqual(r.streakEnd, { seatIndex: null, n: 3 });
  env.advance(5000);
  env.do(0, 'game.fold');
  assert.deepEqual(handEnds(env).at(-1).streak, { seatIndex: 2, n: 2 });

  // 房主提前结束：当前局作废，事件里两个字段都为 null，连胜不变
  env.advance(5000);
  env.do(0, 'room.endSession');
  r = handEnds(env).at(-1);
  assert.equal(r.reason, 'voided');
  assert.equal(r.streak, null);
  assert.equal(r.streakEnd, null);
  assert.deepEqual(env.room.winStreak, { userId: 'u2', n: 2 });

  // 再来一场：清空
  env.do(0, 'room.restart');
  assert.equal(env.room.winStreak, null);
});

