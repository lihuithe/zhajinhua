// 一局的状态机（纯逻辑，不含定时器）。
// 时间通过注入的 now() 传入；行动超时由外部在 turnDeadline 到点后调用 tick() 触发。
import { randomInt } from 'node:crypto';
import { newDeck, shuffle } from './cards.js';
import { evaluate, compareHands, bestIndexes, toCardsView } from './hand.js';
import { err } from '../errors.js';

const MAX_LOG = 100; // 下发给客户端的日志条数
const MAX_FULL_LOG = 2000; // 留存（对局记录、快照）的完整日志条数上限

export class HandGame {
  /**
   * @param {object} opts
   * @param {object} opts.config      房间配置（已校验）
   * @param {{seatIndex:number,userId:string,nickname:string,chips:number}[]} opts.players 参与者（至少 2 人，积分须 ≥ 底注）
   * @param {number} opts.dealerSeat  庄家座位（必须是参与者之一）
   * @param {number} opts.handNo      第几局
   * @param {() => number} opts.now   时钟
   * @param {number} [opts.actionMs]  每次行动限时（毫秒），默认 config.actionSeconds * 1000
   * @param {Record<number, object[]>} [opts.cards] 测试用：指定各座位的三张牌
   * @param {(n:number)=>number} [opts.randInt] 洗牌随机数（默认 crypto.randomInt）
   */
  constructor({ config, players, dealerSeat, handNo, now, actionMs, cards, randInt }) {
    if (players.length < 2) throw new Error('至少需要 2 名参与者');
    this.cfg = config;
    this.now = now;
    this.handNo = handNo;
    this.dealerSeat = dealerSeat;
    this.actionMs = actionMs ?? config.actionSeconds * 1000;
    this.events = [];
    this.log = []; // 最近 MAX_LOG 条，随视图下发
    this.fullLog = []; // 本局完整日志，只给对局记录和快照用
    this.startedAt = now();
    this.ended = false;
    this.result = null;
    this.pot = 0;
    this.currentBet = config.ante;
    this.round = 1;
    this.turnDeadline = null;
    this.public = new Set(); // 对所有人公开牌面的座位（强制开牌 / 亮牌 / 喜钱）
    this.reveals = new Map(); // userId -> Set<seatIndex> 该玩家有权看到的他人的牌（比牌）

    // 玩家按座位升序
    this.players = [...players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        nickname: p.nickname,
        chips: p.chips,
        startChips: p.chips,
        state: 'active',
        seen: false,
        bet: 0,
        allIn: false,
        timedOut: false,
        cards: null,
        eval: null,
      }));
    this.bySeat = new Map(this.players.map((p) => [p.seatIndex, p]));
    this.byUser = new Map(this.players.map((p) => [p.userId, p]));
    if (!this.bySeat.has(dealerSeat)) throw new Error('庄家必须是参与者');

    // 行动顺序：庄家顺时针的下一位开始，庄家最后
    const after = this.players.filter((p) => p.seatIndex > dealerSeat);
    const before = this.players.filter((p) => p.seatIndex <= dealerSeat);
    this.order = [...after, ...before];
    this.pos = 0;

    // 发牌
    const deck = shuffle(newDeck(), randInt || randomInt);
    let di = 0;
    for (const p of this.players) {
      p.cards = cards?.[p.seatIndex] ? cards[p.seatIndex].map((c) => ({ ...c })) : [deck[di++], deck[di++], deck[di++]];
      p.eval = evaluate(p.cards, config);
    }

    // 底注
    for (const p of this.players) this._pay(p, config.ante);
    this._log(null, 'ante', `所有人下底注 ${config.ante}`, { amount: config.ante });
    this._startTurn();
  }

  // ---------- 内部工具 ----------

  _log(p, kind, text, extra = {}) {
    const entry = { t: this.now(), seatIndex: p ? p.seatIndex : null, nickname: p ? p.nickname : null, kind, ...extra, text };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.fullLog.push(entry);
    if (this.fullLog.length > MAX_FULL_LOG) this.fullLog.splice(0, this.fullLog.length - MAX_FULL_LOG);
  }

  _pay(p, amount) {
    const a = Math.max(0, Math.min(amount, p.chips));
    p.chips -= a;
    p.bet += a;
    this.pot += a;
    return a;
  }

  _price(p, x) {
    return p.seen ? x * this.cfg.seenMultiplier : x;
  }

  _active() {
    return this.order.filter((p) => p.state === 'active');
  }

  _turnPlayer() {
    return this.ended ? null : this.order[this.pos];
  }

  _startTurn() {
    this.turnDeadline = this.now() + this.actionMs;
  }

  _reveal(viewer, target) {
    let set = this.reveals.get(viewer.userId);
    if (!set) this.reveals.set(viewer.userId, (set = new Set()));
    set.add(target.seatIndex);
  }

  _need(seat) {
    if (this.ended) throw err('INVALID_ACTION', '本局已经结束');
    const p = this.bySeat.get(seat);
    if (!p) throw err('INVALID_ACTION', '你不在本局中');
    if (p.state !== 'active') throw err('INVALID_ACTION', '你已经出局了');
    return p;
  }

  _needTurn(seat) {
    const p = this._need(seat);
    if (this._turnPlayer() !== p) throw err('NOT_YOUR_TURN', '还没轮到你');
    return p;
  }

  // 当前行动者行动完毕后，把回合交给下一位（或结束本局）
  _endTurn() {
    const alive = this._active();
    if (alive.length <= 1) return this._finish('lastStanding', alive);
    const n = this.order.length;
    let idx = -1;
    for (let i = 1; i <= n; i++) {
      const k = (this.pos + i) % n;
      if (this.order[k].state === 'active') {
        idx = k;
        break;
      }
    }
    // 轮到的人位置不大于上一个行动者 => 新一轮
    if (idx <= this.pos) {
      if (this.round + 1 > this.cfg.maxRounds) return this._showdown();
      this.round += 1;
    }
    this.pos = idx;
    this._startTurn();
  }

  _showdown() {
    const alive = this._active();
    this._log(null, 'showdown', `已打满 ${this.cfg.maxRounds} 轮，强制开牌`);
    for (const p of alive) this.public.add(p.seatIndex);
    const idxs = bestIndexes(alive.map((p) => p.eval), this.cfg);
    this._finish('showdown', idxs.map((i) => alive[i]));
  }

  // 结束本局并结算
  _finish(reason, winners) {
    winners = [...winners].sort((a, b) => this.order.indexOf(a) - this.order.indexOf(b)); // 行动顺序
    const n = winners.length;
    const share = Math.floor(this.pot / n);
    const rem = this.pot - share * n; // 除不尽的余数给行动顺序最靠前的赢家
    winners.forEach((w, i) => {
      w.chips += share + (i === 0 ? rem : 0);
    });
    if (n === 1) this._log(winners[0], 'win', `${winners[0].nickname} 赢得 ${share}`, { amount: share });
    else this._log(null, 'win', `${winners.map((w) => w.nickname).join('、')} 平分底池，各得 ${share}`, { amount: share });

    // 喜钱：赢家唯一，且牌型为豹子 / 顺金
    let bonus = null;
    const w0 = winners[0];
    if (this.cfg.bonusEnabled && n === 1 && (w0.eval.type === 'baozi' || w0.eval.type === 'shunjin')) {
      const mult = w0.eval.type === 'baozi' ? this.cfg.bonusBaozi : this.cfg.bonusShunjin;
      const each = this.cfg.ante * mult;
      if (each > 0) {
        let total = 0;
        for (const p of this.players) {
          if (p === w0) continue;
          const a = Math.min(p.chips, each); // 积分不够的付光为止
          p.chips -= a;
          w0.chips += a;
          total += a;
        }
        bonus = { seatIndex: w0.seatIndex, type: w0.eval.type, total };
        this.public.add(w0.seatIndex); // 触发喜钱，赢家的牌向所有人亮出
        this._log(w0, 'bonus', `${w0.nickname} 获得喜钱 ${total}`, { amount: total });
      }
    }

    for (const p of this.players) {
      if (winners.includes(p)) p.state = 'won';
      else if (p.state === 'active') p.state = 'lost';
    }
    this._seal({
      reason,
      winners: winners.map((w) => w.seatIndex),
      potWon: share,
      bonus,
    });
  }

  _seal(partial) {
    this.result = {
      ...partial,
      deltas: this.players.map((p) => ({ seatIndex: p.seatIndex, delta: p.chips - p.startChips })),
      showable: false,
    };
    this.ended = true;
    this.turnDeadline = null;
  }

  // ---------- 随时可做的操作 ----------

  look(seat) {
    const p = this._need(seat);
    if (p.seen) return;
    p.seen = true;
    this._log(p, 'look', `${p.nickname} 看牌`);
  }

  fold(seat) {
    const p = this._need(seat);
    this._doFold(p);
  }

  _doFold(p) {
    const wasTurn = this._turnPlayer() === p;
    p.state = 'folded';
    this._log(p, 'fold', `${p.nickname} 弃牌`);
    if (wasTurn) this._endTurn();
    else if (this._active().length <= 1) this._finish('lastStanding', this._active());
  }

  // ---------- 轮到自己时的操作 ----------

  call(seat) {
    const p = this._needTurn(seat);
    if (p.chips < this._price(p, this.currentBet)) throw err('INSUFFICIENT_CHIPS', '积分不足，无法跟注');
    this._doCall(p);
  }

  _doCall(p) {
    const cost = this._pay(p, this._price(p, this.currentBet));
    this._log(p, 'call', `${p.nickname} ${p.seen ? '明跟' : '闷跟'} ${cost}`, { amount: cost });
    this._endTurn();
  }

  raise(seat, to) {
    const p = this._needTurn(seat);
    const { ante, raiseSteps, capMultiple } = this.cfg;
    if (this.cfg.raiseMode === 'free') {
      // 自由加注：任意整数，高于当前单注、不超过封顶
      if (!Number.isInteger(to)) throw err('INVALID_ACTION', '加注金额必须是整数');
    } else if (!Number.isInteger(to) || to % ante !== 0 || !raiseSteps.includes(to / ante)) {
      throw err('INVALID_ACTION', '加注档位不合法');
    }
    if (to <= this.currentBet) throw err('INVALID_ACTION', '加注必须高于当前单注');
    if (to > ante * capMultiple) throw err('INVALID_ACTION', '超过了单注封顶');
    const cost = this._price(p, to);
    if (p.chips < cost) throw err('INSUFFICIENT_CHIPS', '积分不足，无法加注');
    this.currentBet = to;
    this._pay(p, cost);
    this._log(p, 'raise', `${p.nickname} ${p.seen ? '明' : '闷'}加注到 ${to}，付 ${cost}`, { amount: cost });
    this._endTurn();
  }

  _compareCost(p) {
    return this._price(p, this.currentBet) * this.cfg.compareCost;
  }

  // 玩家当前是否允许主动比牌（不含积分检查）
  _canCompare(p) {
    return this.round > this.cfg.compareAfterRound && (p.seen || this.cfg.blindCanCompare);
  }

  compare(seat, targetSeat) {
    const p = this._needTurn(seat);
    if (this.round <= this.cfg.compareAfterRound) throw err('INVALID_ACTION', `第 ${this.cfg.compareAfterRound} 轮结束后才能比牌`);
    if (!p.seen && !this.cfg.blindCanCompare) throw err('INVALID_ACTION', '闷牌不能主动比牌，请先看牌');
    const t = this.bySeat.get(targetSeat);
    if (!t || t.state !== 'active' || t === p) throw err('INVALID_ACTION', '比牌对象不合法');
    const cost = this._compareCost(p);
    if (p.chips < cost) throw err('INSUFFICIENT_CHIPS', '积分不足，无法比牌');
    this._pay(p, cost);
    const win = compareHands(p.eval, t.eval, this.cfg, 'a') > 0;
    const winner = win ? p : t;
    const loser = win ? t : p;
    loser.state = 'lost';
    // 胜方看到负方的牌，负方看到双方的牌（负方自己的牌由 myCards 提供）
    this._reveal(winner, loser);
    this._reveal(loser, winner);
    this._log(p, 'compare', `${p.nickname} 比牌 ${t.nickname}，${loser.nickname} 输`, {
      amount: cost,
      targetSeat: t.seatIndex,
      loserSeat: loser.seatIndex,
    });
    this.events.push({ kind: 'compare', fromSeat: p.seatIndex, toSeat: t.seatIndex, loserSeat: loser.seatIndex });
    this._endTurn();
  }

  allIn(seat) {
    const p = this._needTurn(seat);
    if (this.cfg.shortStack !== 'allIn') throw err('INVALID_ACTION', '本房间不允许孤注一掷');
    if (p.chips >= this._price(p, this.currentBet)) throw err('INVALID_ACTION', '积分足够跟注，不能孤注一掷');
    const cost = this._pay(p, p.chips);
    p.allIn = true;
    const others = [];
    for (let i = 1; i < this.order.length; i++) {
      const o = this.order[(this.pos + i) % this.order.length];
      if (o.state === 'active') others.push(o);
    }
    // 与所有其他在场玩家依次比牌（发起方按"发起比牌者"处理平局），输给任何一人即失败
    let beatenBy = null;
    for (const o of others) {
      if (compareHands(p.eval, o.eval, this.cfg, 'a') <= 0) {
        beatenBy = o;
        break;
      }
    }
    if (beatenBy) {
      p.state = 'lost';
      // 只暴露"败给谁"这一对：胜方看到孤注者的牌，孤注者看到胜方的牌
      this._reveal(beatenBy, p);
      this._reveal(p, beatenBy);
      this._log(p, 'allIn', `${p.nickname} 孤注一掷（${cost}），败给 ${beatenBy.nickname}`, {
        amount: cost,
        targetSeat: beatenBy.seatIndex,
        loserSeat: p.seatIndex,
      });
      this.events.push({ kind: 'allIn', seat: p.seatIndex, success: false });
      this._endTurn();
    } else {
      for (const o of others) {
        o.state = 'lost';
        this._reveal(p, o);
        this._reveal(o, p);
      }
      this._log(p, 'allIn', `${p.nickname} 孤注一掷（${cost}），赢了所有人`, { amount: cost });
      this.events.push({ kind: 'allIn', seat: p.seatIndex, success: true });
      this._finish('allIn', [p]);
    }
  }

  // ---------- 超时 ----------

  /** 到点后调用；返回是否发生了变化 */
  tick() {
    if (this.ended || this.turnDeadline === null || this.now() < this.turnDeadline) return false;
    const p = this._turnPlayer();
    p.timedOut = true;
    if (this.cfg.timeoutAction === 'call' && p.chips >= this._price(p, this.currentBet)) {
      this._log(p, 'timeout', `${p.nickname} 行动超时，自动跟注`);
      this._doCall(p);
    } else {
      this._log(p, 'timeout', `${p.nickname} 行动超时，自动弃牌`);
      this._doFold(p);
    }
    return true;
  }

  // ---------- 房主提前结束 / 亮牌 ----------

  /** 本局作废：退回每人本局已下的全部积分 */
  void() {
    if (this.ended) return;
    for (const p of this.players) p.chips += p.bet;
    this.pot = 0;
    this._log(null, 'void', '本局作废，已退还所有下注');
    this._seal({ reason: 'voided', winners: [], potWon: 0, bonus: null });
  }

  /** 赢家亮牌 */
  show(userId) {
    if (!this.ended || this.result.reason === 'voided') throw err('INVALID_ACTION', '现在不能亮牌');
    const p = this.byUser.get(userId);
    if (!p || p.state !== 'won') throw err('INVALID_ACTION', '只有赢家可以亮牌');
    if (this.public.has(p.seatIndex)) throw err('INVALID_ACTION', '你的牌已经公开了');
    this.public.add(p.seatIndex);
    this._log(p, 'show', `${p.nickname} 亮牌`);
  }

  /** 该用户是否还在本局中（未弃牌、未出局，且本局未结束） */
  isActive(userId) {
    const p = this.byUser.get(userId);
    return !!p && !this.ended && p.state === 'active';
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- 按接收者裁剪的视图 ----------

  /**
   * @param {string|null} userId 接收者；不在本局中的人按旁观者处理
   * @param {boolean} [canShow] 房间是否处于允许亮牌的阶段
   */
  view(userId, canShow = false) {
    const me = userId ? this.byUser.get(userId) : null;
    const turn = this._turnPlayer();

    // visible：公开的 + 本人比牌看到的；本人的牌走 myCards；弃牌者的牌永远不下发
    const seats = new Set(this.public);
    if (me) for (const s of this.reveals.get(me.userId) || []) seats.add(s);
    const visible = [];
    for (const p of this.players) {
      if (!seats.has(p.seatIndex) || p === me || p.state === 'folded') continue;
      visible.push({ ...toCardsView(p.eval), seatIndex: p.seatIndex });
    }

    let myCards = null;
    if (me && (me.seen || me.state === 'lost' || this.ended)) myCards = toCardsView(me.eval);

    let actions = null;
    if (me && turn === me) actions = this._actionsFor(me);

    const result = this.result
      ? {
          ...this.result,
          winners: [...this.result.winners],
          deltas: this.result.deltas.map((d) => ({ ...d })),
          showable: !!(
            canShow && me && this.ended && this.result.reason !== 'voided' && me.state === 'won' && !this.public.has(me.seatIndex)
          ),
        }
      : null;

    const inGame = !!me && me.state === 'active' && !this.ended;
    return {
      handNo: this.handNo,
      dealerSeat: this.dealerSeat,
      pot: this.pot,
      currentBet: this.currentBet,
      round: this.round,
      turnSeat: turn ? turn.seatIndex : null,
      turnDeadline: this.ended ? null : this.turnDeadline,
      players: this.players.map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        nickname: p.nickname,
        state: p.state,
        seen: p.seen,
        bet: p.bet,
        allIn: p.allIn,
        timedOut: p.timedOut,
      })),
      myCards,
      visible,
      actions,
      canLook: inGame && !me.seen,
      canFold: inGame,
      ended: this.ended,
      result,
      log: this.log.map((l) => ({ ...l })),
    };
  }

  // ---------- 快照 ----------

  /**
   * 序列化一局的全部内部状态（含牌面，仅用于服务端快照文件）。
   * 不含函数 / 定时器；eval 由牌面重新计算。
   */
  toSnapshot() {
    return {
      cfg: this.cfg,
      handNo: this.handNo,
      dealerSeat: this.dealerSeat,
      actionMs: this.actionMs,
      startedAt: this.startedAt,
      ended: this.ended,
      result: this.result,
      pot: this.pot,
      currentBet: this.currentBet,
      round: this.round,
      turnDeadline: this.turnDeadline,
      pos: this.pos,
      order: this.order.map((p) => p.seatIndex),
      players: this.players.map((p) => ({
        seatIndex: p.seatIndex,
        userId: p.userId,
        nickname: p.nickname,
        chips: p.chips,
        startChips: p.startChips,
        state: p.state,
        seen: p.seen,
        bet: p.bet,
        allIn: p.allIn,
        timedOut: p.timedOut,
        cards: p.cards,
      })),
      public: [...this.public],
      reveals: [...this.reveals].map(([uid, set]) => [uid, [...set]]),
      events: this.events,
      fullLog: this.fullLog,
    };
  }

  /**
   * @param {object} data toSnapshot() 的结果（可经过 JSON 往返）
   * @param {{now: () => number, shiftMs?: number}} deps shiftMs：停机时长，turnDeadline 整体后移
   */
  static fromSnapshot(data, { now, shiftMs = 0 }) {
    const d = structuredClone(data);
    const g = Object.create(HandGame.prototype);
    g.cfg = d.cfg;
    g.now = now;
    g.handNo = d.handNo;
    g.dealerSeat = d.dealerSeat;
    g.actionMs = d.actionMs;
    g.startedAt = d.startedAt;
    g.ended = d.ended;
    g.result = d.result;
    g.pot = d.pot;
    g.currentBet = d.currentBet;
    g.round = d.round;
    g.turnDeadline = d.turnDeadline === null ? null : d.turnDeadline + shiftMs;
    g.pos = d.pos;
    g.events = d.events || [];
    g.fullLog = d.fullLog || [];
    g.log = g.fullLog.slice(-MAX_LOG).map((l) => ({ ...l }));
    g.public = new Set(d.public);
    g.reveals = new Map(d.reveals.map(([uid, seats]) => [uid, new Set(seats)]));
    g.players = d.players.map((p) => ({ ...p, eval: evaluate(p.cards, g.cfg) }));
    g.bySeat = new Map(g.players.map((p) => [p.seatIndex, p]));
    g.byUser = new Map(g.players.map((p) => [p.userId, p]));
    g.order = d.order.map((seat) => g.bySeat.get(seat));
    if (g.order.some((p) => !p) || g.order.length !== g.players.length) throw new Error('快照中的行动顺序不合法');
    if (!g.ended && !g.order[g.pos]) throw new Error('快照中的行动位置不合法');
    return g;
  }

  _actionsFor(p) {
    const { ante, raiseSteps, capMultiple } = this.cfg;
    const callCost = this._price(p, this.currentBet);
    const call = p.chips >= callCost ? { cost: callCost } : null;
    const raise = [];
    for (const step of raiseSteps) {
      const to = ante * step;
      if (to <= this.currentBet || to > ante * capMultiple) continue;
      const cost = this._price(p, to);
      if (cost <= p.chips) raise.push({ to, cost });
    }
    // 自由加注：可加到的范围（闷牌价），max 受封顶和积分限制
    let raiseRange = null;
    if (this.cfg.raiseMode === 'free') {
      const min = this.currentBet + 1;
      const max = Math.min(ante * capMultiple, Math.floor(p.chips / this._price(p, 1)));
      if (min <= max) raiseRange = { min, max, mult: this._price(p, 1) };
    }
    let compare = null;
    const cc = this._compareCost(p);
    if (this._canCompare(p) && p.chips >= cc) {
      const targets = this.players.filter((o) => o !== p && o.state === 'active').map((o) => o.seatIndex);
      if (targets.length) compare = { cost: cc, targets };
    }
    const allIn = this.cfg.shortStack === 'allIn' && p.chips < callCost ? { cost: p.chips } : null;
    return { call, raise, raiseRange, compare, allIn };
  }
}
