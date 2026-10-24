// 维护模式与系统通知：持久化、拦截、公开接口、ws sys 推送、到点重推
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, createRoom, joinAndSit, playOut, SMALL } from './serverHelpers.js';
import { rigFrom, NO_BONUS_CARDS } from './helpers.js';
import { openDb } from '../src/db.js';
import { SystemService, DEFAULT_MAINT_MESSAGE } from '../src/system.js';
import { loadVersion } from '../src/version.js';
import { writeFileSync } from 'node:fs';

const APP = { rig: rigFrom(NO_BONUS_CARDS), randInt: () => 0 };
const H = 3600 * 1000;

async function setMaint(srv, enabled, message) {
  const r = await srv.admin('/api/admin/system/maintenance', { method: 'POST', body: message === undefined ? { enabled } : { enabled, message } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.maintenance;
}

test('维护模式：拦截创建房间 / room.start / room.restart，进行中的一场可以打完，关闭后恢复', async () => {
  const srv = await startServer({ appOpts: APP });
  try {
    const owner = await srv.register('alice');
    const p2 = await srv.register('bobby');
    const code = await createRoom(srv, owner);
    const [ca, cb] = [await srv.connect(owner), await srv.connect(p2)];
    await joinAndSit(ca, code, 0);
    await joinAndSit(cb, code, 1);
    await cb.ok('room.ready', { ready: true });

    // 开启：提示语生效
    assert.deepEqual(await setMaint(srv, true, '今晚 22:00 停服更新'), { enabled: true, message: '今晚 22:00 停服更新' });
    let r = await srv.api('/api/rooms', { method: 'POST', token: owner.token, body: { config: SMALL } });
    assert.equal(r.status, 503);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'MAINTENANCE');
    assert.equal(r.error.message, '今晚 22:00 停服更新');
    await ca.fail('room.start', {}, 'MAINTENANCE');
    assert.equal(ca.state.phase, 'waiting');
    // 创建房间的校验顺序：维护优先于配置校验
    r = await srv.api('/api/rooms', { method: 'POST', token: owner.token, body: { config: { hands: -1 } } });
    assert.equal(r.error.code, 'MAINTENANCE');
    // 其他接口不受影响
    r = await srv.api('/api/me', { token: owner.token });
    assert.equal(r.status, 200);
    await cb.ok('room.ready', { ready: false });
    await cb.ok('room.ready', { ready: true });

    // 提示语为空：用默认提示语（后台仍看到原始设置）
    assert.deepEqual(await setMaint(srv, true, ''), { enabled: true, message: '' });
    r = await srv.api('/api/rooms', { method: 'POST', token: owner.token, body: { config: SMALL } });
    assert.equal(r.error.message, DEFAULT_MAINT_MESSAGE);
    assert.equal(DEFAULT_MAINT_MESSAGE, '系统维护中，暂时不能开新房间');
    await ca.fail('room.start', {}, 'MAINTENANCE');

    // 关闭后可以开始
    assert.equal((await setMaint(srv, false)).enabled, false);
    await ca.ok('room.start');
    await ca.waitState((s) => s.phase === 'playing', '开始');

    // 一场进行中开启维护：这一场照常打完
    await setMaint(srv, true, '维护中');
    await playOut([ca, cb]);
    assert.equal(ca.state.phase, 'finished');
    assert.equal(ca.state.summary.handsPlayed, 3);
    // 但不能开始下一场
    await ca.fail('room.restart', {}, 'MAINTENANCE');
    assert.equal(ca.state.phase, 'finished');
    await setMaint(srv, false);
    await ca.ok('room.restart');
    assert.equal(ca.state.phase, 'waiting');
    assert.equal(ca.state.sessionNo, 2);

    // 参数校验
    r = await srv.admin('/api/admin/system/maintenance', { method: 'POST', body: { enabled: 'yes' } });
    assert.equal(r.status, 400);
    r = await srv.admin('/api/admin/system/maintenance', { method: 'POST', body: { enabled: true, message: 'x'.repeat(101) } });
    assert.equal(r.status, 400);
    // 省略 message 时保留原提示语
    await setMaint(srv, true, '保留我');
    assert.equal((await setMaint(srv, false)).message, '保留我');
    r = await srv.admin('/api/admin/system');
    assert.equal(r.maintenance.message, '保留我');
  } finally {
    await srv.stop();
  }
});

test('维护模式持久化：重启后保持', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-sys-'));
  let srv = await startServer({ dir });
  let srv2 = null;
  try {
    await setMaint(srv, true, '持久化提示');
    const n = await srv.admin('/api/admin/notices', { method: 'POST', body: { title: '重启也在', level: 'warn' } });
    assert.equal(n.status, 200);
    await srv.stop({ keepDir: true });
    srv2 = await startServer({ dir });
    const r = await srv2.api('/api/notices');
    assert.deepEqual(r.maintenance, { enabled: true, message: '持久化提示' });
    assert.equal(r.notices.length, 1);
    assert.equal(r.notices[0].title, '重启也在');
    const u = await srv2.register('alice');
    const rr = await srv2.api('/api/rooms', { method: 'POST', token: u.token, body: { config: SMALL } });
    assert.equal(rr.error.code, 'MAINTENANCE');
  } finally {
    if (srv2) await srv2.stop({ keepDir: true }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test('通知：校验、CRUD、有效期 / 启用过滤与排序、公开接口', async () => {
  const srv = await startServer();
  try {
    const now = Date.now();
    // 默认值
    let r = await srv.admin('/api/admin/notices', { method: 'POST', body: { title: ' 普通通知 ' } });
    assert.equal(r.status, 200);
    const n1 = r.notice;
    assert.deepEqual(
      { ...n1, id: 0, createdAt: 0, updatedAt: 0 },
      {
        id: 0,
        title: '普通通知',
        content: '',
        level: 'info',
        banner: true,
        popup: false,
        startsAt: null,
        endsAt: null,
        maintStart: null,
        maintEnd: null,
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    );
    assert.equal(typeof n1.id, 'number');
    assert.ok(n1.createdAt >= now - 1000 && n1.updatedAt === n1.createdAt);

    // 校验
    const bad = async (body, what) => {
      const x = await srv.admin('/api/admin/notices', { method: 'POST', body });
      assert.equal(x.status, 400, what);
      assert.equal(x.error.code, 'BAD_REQUEST');
      assert.equal(typeof x.error.message, 'string');
    };
    await bad({}, '缺标题');
    await bad({ title: '   ' }, '空标题');
    await bad({ title: '字'.repeat(41) }, '标题过长');
    await bad({ title: 't', content: '字'.repeat(501) }, '内容过长');
    await bad({ title: 't', level: 'urgent' }, '级别不合法');
    await bad({ title: 't', banner: 'yes' }, 'banner 类型');
    await bad({ title: 't', startsAt: 'soon' }, 'startsAt 类型');
    await bad({ title: 't', startsAt: now + 2 * H, endsAt: now + H }, '失效早于生效');
    await bad({ title: 't', maintStart: now + 2 * H, maintEnd: now + H }, '维护结束早于开始');
    r = await srv.admin('/api/admin/notices', { method: 'POST', body: { title: '字'.repeat(40), content: '字'.repeat(500) } });
    assert.equal(r.status, 200, '边界长度合法');
    await srv.admin(`/api/admin/notices/${r.notice.id}`, { method: 'DELETE' });

    // 过滤与排序：maint > warn > info，同级按 updatedAt 降序
    const mk = async (body) => (await srv.admin('/api/admin/notices', { method: 'POST', body })).notice;
    const warn = await mk({ title: '重要', level: 'warn', popup: true, content: '内容\n换行' });
    const maint = await mk({ title: '停服', level: 'maint', maintStart: now + H, maintEnd: now + 2 * H });
    const future = await mk({ title: '未生效', startsAt: now + H });
    const expired = await mk({ title: '已过期', endsAt: now - 1000 });
    const disabled = await mk({ title: '已停用', enabled: false });
    const infoNew = await mk({ title: '较新的普通', level: 'info' });
    r = await srv.api('/api/notices');
    assert.equal(r.status, 200);
    assert.equal(r.ok, true);
    assert.deepEqual(r.notices.map((n) => n.title), ['停服', '重要', '较新的普通', '普通通知']);
    assert.equal(r.version, 'test-1');
    assert.deepEqual(r.maintenance, { enabled: false, message: '' });
    assert.equal(r.notices[0].maintStart, maint.maintStart);
    assert.equal(r.notices[1].content, '内容\n换行');

    // 后台列表含全部，按 updatedAt 降序
    r = await srv.admin('/api/admin/notices');
    assert.equal(r.items.length, 7);
    assert.ok(r.items.map((n) => n.title).includes('未生效'));
    assert.ok(r.items.every((n, i, a) => i === 0 || a[i - 1].updatedAt >= n.updatedAt));

    // 部分更新
    await new Promise((x) => setTimeout(x, 5));
    r = await srv.admin(`/api/admin/notices/${disabled.id}`, { method: 'PUT', body: { enabled: true } });
    assert.equal(r.status, 200);
    assert.equal(r.notice.enabled, true);
    assert.equal(r.notice.title, '已停用', '未提供的字段保持不变');
    assert.ok(r.notice.updatedAt > disabled.updatedAt);
    assert.equal(r.notice.createdAt, disabled.createdAt);
    r = await srv.admin(`/api/admin/notices/${expired.id}`, { method: 'PUT', body: { endsAt: null } });
    assert.equal(r.notice.endsAt, null);
    r = await srv.admin(`/api/admin/notices/${future.id}`, { method: 'PUT', body: { startsAt: null } });
    r = await srv.api('/api/notices');
    assert.deepEqual(r.notices.map((n) => n.title).sort(), ['停服', '重要', '较新的普通', '普通通知', '已停用', '已过期', '未生效'].sort());
    r = await srv.admin(`/api/admin/notices/${warn.id}`, { method: 'PUT', body: { title: '' } });
    assert.equal(r.status, 400);
    r = await srv.admin(`/api/admin/notices/${warn.id}`, { method: 'PUT', body: { startsAt: now + 3 * H } });
    assert.equal(r.status, 200);
    assert.equal((await srv.api('/api/notices')).notices.find((n) => n.id === warn.id), undefined, '改成未来生效后不再显示');
    r = await srv.admin('/api/admin/notices/99999', { method: 'PUT', body: { title: 'x' } });
    assert.equal(r.status, 404);

    // 删除
    r = await srv.admin(`/api/admin/notices/${infoNew.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    r = await srv.admin(`/api/admin/notices/${infoNew.id}`, { method: 'DELETE' });
    assert.equal(r.status, 404);
    assert.ok(!(await srv.api('/api/notices')).notices.some((n) => n.id === infoNew.id));

    // 需要管理员；公开接口不需要
    r = await srv.api('/api/admin/notices', { method: 'POST', body: { title: 'x' } });
    assert.equal(r.status, 401);
    r = await srv.api(`/api/admin/notices/${n1.id}`, { method: 'DELETE' });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test('ws sys 推送：连接后立即下发；通知增删改、维护开关时向全部在线连接广播', async () => {
  const srv = await startServer();
  try {
    const [u1, u2] = [await srv.register('alice'), await srv.register('bobby')];
    const c1 = await srv.connect(u1);
    await c1.until(() => c1.sys, '收到 sys');
    assert.deepEqual(c1.sys, { version: 'test-1', notices: [], maintenance: { enabled: false, message: '' } });
    assert.equal(c1.msgs[0].type, 'sys', 'sys 是连接后的第一条消息');
    const c2 = await srv.connect(u2);
    await c2.until(() => c2.sys, '收到 sys');

    const both = (n) => Promise.all([c1, c2].map((c) => c.until(() => c.sysMsgs.length >= n, `第 ${n} 条 sys`)));
    let r = await srv.admin('/api/admin/notices', { method: 'POST', body: { title: '广播测试', level: 'warn', popup: true } });
    const id = r.notice.id;
    await both(2);
    for (const c of [c1, c2]) assert.deepEqual(c.sys.notices.map((n) => n.title), ['广播测试']);

    await srv.admin(`/api/admin/notices/${id}`, { method: 'PUT', body: { title: '改过了' } });
    await both(3);
    assert.equal(c1.sys.notices[0].title, '改过了');

    await setMaint(srv, true, '维护提示');
    await both(4);
    for (const c of [c1, c2]) assert.deepEqual(c.sys.maintenance, { enabled: true, message: '维护提示' });

    await srv.admin(`/api/admin/notices/${id}`, { method: 'DELETE' });
    await both(5);
    assert.deepEqual(c1.sys.notices, []);

    // 新连接立刻拿到当前状态
    const c3 = await srv.connect(await srv.register('carol'));
    await c3.until(() => c3.sys, '收到 sys');
    assert.deepEqual(c3.sys.maintenance, { enabled: true, message: '维护提示' });
    // 不在线的人不会收到、也不会出错
    await c2.close();
    await setMaint(srv, false);
    await c1.until(() => c1.sysMsgs.length >= 6, '第 6 条');
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------- SystemService 单元（假时钟 / 假定时器）

function fakeEnv() {
  const clock = { t: 1_000_000 };
  const timers = new Set();
  const scheduler = {
    set(fn, ms) {
      const h = { fn, ms };
      timers.add(h);
      return h;
    },
    clear(h) {
      timers.delete(h);
    },
  };
  const db = openDb(':memory:');
  const sys = new SystemService({ db, now: () => clock.t, scheduler, version: 'v' });
  const broadcasts = [];
  sys.broadcaster = (p) => broadcasts.push(JSON.parse(JSON.stringify(p)));
  sys.start();
  const fire = () => {
    assert.equal(timers.size, 1, '应有且仅有一个到点定时器');
    const [h] = timers;
    timers.delete(h);
    h.fn();
  };
  return { clock, timers, db, sys, broadcasts, fire };
}

test('到达 startsAt / endsAt 时重推 sys（定时器），无需等待', () => {
  const { clock, timers, sys, broadcasts, fire } = fakeEnv();
  assert.equal(timers.size, 0);
  sys.createNotice({ title: '定时', startsAt: clock.t + 1000, endsAt: clock.t + 5000 });
  assert.equal(broadcasts.length, 1, '创建时广播一次');
  assert.deepEqual(broadcasts[0].notices, []);
  assert.equal([...timers][0].ms, 1000);

  clock.t += 1000;
  fire();
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(broadcasts[1].notices.map((n) => n.title), ['定时']);
  assert.equal([...timers][0].ms, 4000, '随后等待 endsAt');

  clock.t += 3999;
  fire(); // 定时器提前触发：不广播，重新等待剩余的 1ms
  assert.equal(broadcasts.length, 2);
  assert.equal([...timers][0].ms, 1);
  clock.t += 1;
  fire();
  assert.equal(broadcasts.length, 3);
  assert.deepEqual(broadcasts[2].notices, []);
  assert.equal(timers.size, 0, '没有后续边界，不再设置定时器');
});

test('停用的通知不产生定时器；修改 / 删除会重新计算下一个边界', () => {
  const { clock, timers, sys, broadcasts } = fakeEnv();
  const a = sys.createNotice({ title: 'a', enabled: false, startsAt: clock.t + 100 });
  assert.equal(timers.size, 0);
  sys.updateNotice(a.id, { enabled: true });
  assert.equal([...timers][0].ms, 100);
  const b = sys.createNotice({ title: 'b', startsAt: clock.t + 50 });
  assert.equal(timers.size, 1);
  assert.equal([...timers][0].ms, 50);
  sys.deleteNotice(b.id);
  assert.equal([...timers][0].ms, 100);
  sys.deleteNotice(a.id);
  assert.equal(timers.size, 0);
  assert.equal(broadcasts.length, 5);
  sys.stop();
  sys.createNotice({ title: 'c', startsAt: clock.t + 100 });
  assert.equal(timers.size, 0, '停止后不再设置定时器');
});

test('超过 setTimeout 上限的等待会被截断并在到点前重新计算', () => {
  const { clock, timers, sys, broadcasts, fire } = fakeEnv();
  const far = 40 * 24 * H;
  sys.createNotice({ title: '很久以后', startsAt: clock.t + far });
  assert.equal([...timers][0].ms, 2 ** 31 - 1);
  clock.t += 2 ** 31 - 1;
  fire();
  assert.equal(broadcasts.length, 1, '还没到点，不广播');
  assert.equal([...timers][0].ms, far - (2 ** 31 - 1));
});

test('维护模式的默认提示语与持久化（SystemService）', () => {
  const { sys, db } = fakeEnv();
  assert.throws(() => sys.setMaintenance({}), (e) => e.code === 'BAD_REQUEST');
  sys.setMaintenance({ enabled: true });
  assert.throws(() => sys.checkMaintenance(), (e) => e.code === 'MAINTENANCE' && e.status === 503 && e.message === DEFAULT_MAINT_MESSAGE);
  assert.deepEqual(sys.payload().maintenance, { enabled: true, message: DEFAULT_MAINT_MESSAGE });
  assert.deepEqual(sys.getMaintenance(), { enabled: true, message: '' });
  const again = new SystemService({ db });
  assert.equal(again.getMaintenance().enabled, true);
  again.setMaintenance({ enabled: false });
  assert.doesNotThrow(() => again.checkMaintenance());
});

test('版本号：读取 version.json，不存在或损坏时为 dev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-ver-'));
  try {
    assert.equal(loadVersion(join(dir, 'nope.json')), 'dev');
    writeFileSync(join(dir, 'v.json'), JSON.stringify({ version: 'abc1234-202610231830', builtAt: 1 }));
    assert.equal(loadVersion(join(dir, 'v.json')), 'abc1234-202610231830');
    writeFileSync(join(dir, 'bad.json'), '{oops');
    assert.equal(loadVersion(join(dir, 'bad.json')), 'dev');
    writeFileSync(join(dir, 'empty.json'), '{}');
    assert.equal(loadVersion(join(dir, 'empty.json')), 'dev');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createApp 读取 versionFile 并随 sys / notices / overview 下发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zjh-ver-'));
  try {
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ version: 'deadbee-202601010000', builtAt: 1 }));
    const srv = await startServer({ appOpts: { version: undefined, versionFile: join(dir, 'version.json') } });
    try {
      assert.equal((await srv.api('/api/notices')).version, 'deadbee-202601010000');
      assert.equal((await srv.admin('/api/admin/overview')).server.version, 'deadbee-202601010000');
      const c = await srv.connect(await srv.register('alice'));
      await c.until(() => c.sys, 'sys');
      assert.equal(c.sys.version, 'deadbee-202601010000');
    } finally {
      await srv.stop();
    }
    const srv2 = await startServer({ appOpts: { version: undefined, versionFile: join(dir, 'nope.json') } });
    try {
      assert.equal((await srv2.api('/api/notices')).version, 'dev');
    } finally {
      await srv2.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
