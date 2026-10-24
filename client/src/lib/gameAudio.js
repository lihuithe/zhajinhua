// 牌局声音：根据 state / event 的变化播放音效与语音
// - 玩家喊话：每人一个声音包（自己选的，没选就按 userId 固定分一个），按座位方位偏左 / 偏右
// - 喊话看局势：连闷几手、被人加注后再加、加到封顶、看完就弃、下了重注才弃、闷着赢、偷鸡亮牌……各有说法
// - 系统播报：可选播报风格（标准 / 搞笑解说 / 东北话 / 粤语）；报牌型（含“二三五吃豹子”）、连胜、翻盘、名次
// - 轮到自己：提示音 + 播报 + 震动；没操作隔一会儿再提醒；最后 10 秒心跳，最后 5 秒加滴答和催促
// - 聊天：常用语用发送者的声音念出来；脸部表情念出来，其他表情配音效；道具有飞行、命中音效和对方的反应
// - 紧张铺底：只剩两人、底池大、自己最后 10 秒、孤注一掷时，循环一层低沉的铺底并压低背景音乐
import { sfx, voice, preloadVoices, prefetchVoices, loadManifest, voiceManifest, audioState, setTension } from './audio';
import { betTier } from './betTier';
import { voiceOfMember, autoPack } from './voicePacks';
import { EMOJI_SOUND, propOf, PROP_FLY_MS, BOMB_FUSE_MS } from './chatMeta';

// 入座的声音包会提前下载这些类别（其余用到时再下载）
const CORE = [
  'call_blind', 'call_blind_long', 'call', 'call_big', 'raise', 'reraise', 'raise_cap', 'raise_big', 'look', 'look_react',
  'compare', 'compare_win', 'fold', 'fold_quick', 'fold_pain', 'allin', 'show', 'show_bluff', 'win', 'win_big', 'win_blind', 'lose',
];
// 这些马上解码（最常用）
const HOT = ['call_blind', 'call', 'look', 'fold', 'raise', 'compare'];
const SYS_HOT = ['your_turn', 'new_hand', 'you_win', 'you_lose', 'cmp_others', 'hurry'];

// 同一种话不连着两次说一模一样的
const lastPick = {};
function pick(key, n) {
  if (n <= 1) return 0;
  let k = Math.floor(Math.random() * n);
  if (k === lastPick[key]) k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n;
  lastPick[key] = k;
  return k;
}
const chance = (p) => Math.random() < p;
// 日志文字去掉开头的昵称（昵称里可能有“闷”“跟”之类的字）
const restOf = (e) => (e.nickname && e.text.indexOf(e.nickname) === 0 ? e.text.slice(e.nickname.length) : e.text);

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';
const REMIND_MS = 15000; // 页面在前台：轮到自己后每 15 秒再提醒一次
const REMIND_HIDDEN_MS = 8000; // 页面在后台：每 8 秒提醒一次
const isHidden = () => typeof document !== 'undefined' && document.hidden;

/**
 * @param {object} opts
 * @param {() => boolean} [opts.isDealing] 正在播发牌动画时，“轮到你了”等发完牌再响
 * @param {(seatIndex: number) => number} [opts.panOf] 座位的左右方位：-1 最左 ~ 1 最右
 */
export function createGameAudio(opts = {}) {
  const isDealing = opts.isDealing || (() => false);
  const panOfSeat = opts.panOf || (() => 0);
  loadManifest();

  let pendingTurn = false;
  let lastAlert = 0; // 上一次“轮到你了”提醒的时间（服务器时间）
  let curNow = 0;
  let inited = false;
  let handNo = -1;
  let done = new Set(); // 本局已处理过的日志
  let prevSeats = [];
  let prevPaused = false;
  let turnKey = '';
  let myTurn = false;
  let deadline = 0;
  let lastBeat = 0;
  let hurried = false;
  let view = null;
  let prevActive = 0;
  let compareUntil = 0; // 比牌动画（鼓点、开牌）播放到什么时候
  let allInUntil = 0; // 孤注一掷的紧张时刻
  const once = new Set(); // 每局 / 每场只说一次的话：'hand:<局号>:<类>'、'sess:<场次>:<类>'
  let pendingReveal = null; // 强制开牌：等 state 里出现亮出的牌再报牌型
  let pendingCompare = false; // 和我有关的比牌：等 state 里出现对方的牌再看是不是“二三五吃豹子”
  let pendingAfterHand = false; // 本局刚结束：等新 state 检查输光 / 翻盘
  let myMinChips = Infinity; // 本场自己积分的最低点（翻盘用）
  let minSession = 0;
  const loadedPacks = new Set();
  let loadedStyle = '';

  const logKey = (e) => e.t + '|' + e.kind + '|' + e.seatIndex + '|' + e.text;
  const ante = () => (view ? view.config.ante : 1);
  const mySeat = () => (view && view.me.seatIndex !== null && view.me.seatIndex !== undefined ? view.me.seatIndex : null);

  /* ---------- 谁在说话：声音包与方位 ---------- */
  function memberOf(userId) {
    const v = view;
    if (!v) return null;
    return v.seats.find((s) => s && s.userId === userId) || v.spectators.find((s) => s.userId === userId) || null;
  }
  function packOf(userId) {
    const m = memberOf(userId);
    return m ? voiceOfMember(m) : autoPack(userId);
  }
  function seatOf(userId) {
    const v = view;
    if (!v) return null;
    const s = v.seats.find((x) => x && x.userId === userId);
    if (s) return s.seatIndex;
    const p = v.hand && v.hand.players.find((x) => x.userId === userId);
    return p ? p.seatIndex : null;
  }
  const panOf = (seat) => (seat === null || seat === undefined || seat === mySeat() ? 0 : panOfSeat(seat));
  const panOfUser = (userId) => panOf(seatOf(userId));
  function uidOfSeat(v, seat) {
    const s = v.seats[seat];
    if (s) return s.userId;
    const p = v.hand && v.hand.players.find((x) => x.seatIndex === seat);
    return p ? p.userId : String(seat);
  }

  const countOf = (table, id, cat) => {
    const m = voiceManifest[table][id];
    return m ? m[cat] || 0 : 0;
  };
  /** 玩家喊话：cat 类别；idx 指定第几条（常用语），否则随机 */
  function say(userId, cat, o = {}) {
    const pk = packOf(userId);
    const n = countOf('packs', pk, cat);
    if (!n) return false;
    const k = o.idx !== undefined ? o.idx : pick(pk + cat, n);
    if (k >= n) return false;
    voice('p/' + pk + '/' + cat + '_' + k, { prio: 2, pan: panOfUser(userId), ...o });
    return true;
  }
  /** 系统播报：用当前选的播报风格，没有这类就用标准的 */
  function sys(cat, delay = 0, o = {}) {
    let st = audioState.announcer;
    let n = countOf('styles', st, cat);
    if (!n) {
      st = 'std';
      n = countOf('styles', st, cat);
    }
    if (!n) return;
    voice('s/' + st + '/' + cat + '_' + pick('s' + cat, n), { prio: 3, delay, ...o });
  }
  function onceFor(key) {
    if (once.has(key)) return false;
    once.add(key);
    return true;
  }
  const handKey = (cat) => 'hand:' + (view && view.hand ? view.hand.handNo : 0) + ':' + (view ? view.sessionNo : 0) + ':' + cat;
  const sessKey = (cat) => 'sess:' + (view ? view.sessionNo : 0) + ':' + cat;

  /* ---------- 预加载：桌上用到的声音包、当前播报风格 ---------- */
  function preloadFor(v) {
    if (!voiceManifest.ready) return;
    const style = audioState.announcer;
    if (style !== loadedStyle && voiceManifest.styles[style]) {
      loadedStyle = style;
      const m = voiceManifest.styles[style];
      preloadVoices(SYS_HOT.filter((c) => m[c]).map((c) => 's/' + style + '/' + c + '_0'));
      const all = [];
      for (const [c, n] of Object.entries(m)) for (let k = 0; k < n; k++) all.push('s/' + style + '/' + c + '_' + k);
      prefetchVoices(all);
    }
    for (const s of v.seats) {
      if (!s) continue;
      const pk = voiceOfMember(s);
      if (loadedPacks.has(pk) || !voiceManifest.packs[pk]) continue;
      loadedPacks.add(pk);
      const m = voiceManifest.packs[pk];
      preloadVoices(HOT.filter((c) => m[c]).map((c) => 'p/' + pk + '/' + c + '_0'));
      const list = [];
      for (const c of CORE) for (let k = 0; k < (m[c] || 0); k++) list.push('p/' + pk + '/' + c + '_' + k);
      prefetchVoices(list);
    }
  }

  /* ---------- 音效 ---------- */
  // 推筹码声（哗啦啦）：1 普通 / 2 有点料 / 3 豪气 / 4 霸气
  function chipSound(tier, pan) {
    if (tier <= 1) sfx('chips', { pan });
    else if (tier === 2) sfx('push', { pan });
    else if (tier === 3) sfx('pushbig', { pan });
    else {
      sfx('pushbig', { pan });
      sfx('boom', { delay: 0.55, gain: 0.8 });
    }
  }

  /* ---------- 操作记录 → 喊话 ---------- */
  // 这一手之前，同一个人连续闷跟了几次（含这一手）
  function blindRun(log, i, seat) {
    let n = 0;
    for (let k = i; k >= 0; k--) {
      const x = log[k];
      if (x.seatIndex !== seat) continue;
      if (x.kind === 'call' && /闷/.test(restOf(x))) n++;
      else if (x.kind !== 'look') break;
    }
    return n;
  }
  // 自己上一次行动之后，有没有别人加过注（被加注后再加 = 针锋相对）
  function raisedSinceMine(log, i, seat) {
    for (let k = i - 1; k >= 0; k--) {
      const x = log[k];
      if (x.kind === 'ante') return false;
      if (x.seatIndex === seat && x.kind !== 'look') return false;
      if (x.kind === 'raise' && x.seatIndex !== seat) return true;
    }
    return false;
  }
  function prevActOf(log, i, seat) {
    for (let k = i - 1; k >= 0; k--) if (log[k].seatIndex === seat) return log[k];
    return null;
  }

  function playLog(e, v, i) {
    const h = v.hand;
    const log = h.log;
    const seat = e.seatIndex;
    const uid = uidOfSeat(v, seat);
    const pan = panOf(seat);
    const a = v.config.ante;
    switch (e.kind) {
      case 'look':
        sfx('flip', { pan });
        say(uid, 'look');
        // 看完牌的反应：纯随机，和牌好坏无关
        if (chance(0.45)) say(uid, 'look_react', { delay: 1.15, prio: 1 });
        // 自己看到好牌：只有自己听得到的一点点闪光
        if (seat === mySeat() && h.myCards && (h.myCards.type === 'baozi' || h.myCards.type === 'shunjin')) sfx('sparkle', { gain: 0.45, delay: 0.3 });
        break;
      case 'call': {
        const t = betTier('call', e.amount, a);
        chipSound(t, pan);
        if (t >= 3) say(uid, 'call_big');
        else if (/闷/.test(restOf(e))) say(uid, blindRun(log, i, seat) >= 5 ? 'call_blind_long' : 'call_blind');
        else say(uid, 'call');
        break;
      }
      case 'raise': {
        const t = betTier('raise', e.amount, a);
        chipSound(t, pan);
        const capped = h.currentBet >= a * v.config.capMultiple && !log.slice(i + 1).some((x) => x.kind === 'raise');
        if (capped) {
          say(uid, 'raise_cap');
          if (onceFor(handKey('capped'))) {
            sfx('capped', { delay: 0.5 });
            sys('capped', 1.2);
          }
        } else if (t >= 3) say(uid, 'raise_big');
        else if (raisedSinceMine(log, i, seat)) say(uid, 'reraise');
        else say(uid, 'raise');
        break;
      }
      case 'compare':
        // 比牌的喊话在 onEvent('compare') 里按“和我有没有关系”分别处理
        break;
      case 'allIn':
        chipSound(4, pan);
        say(uid, 'allin');
        break;
      case 'fold': {
        sfx('fold', { pan });
        sfx('stamp', { pan, delay: 0.3, gain: 0.8 });
        const p = h.players.find((x) => x.seatIndex === seat);
        const prev = prevActOf(log, i, seat);
        if (p && p.bet >= a * 15) say(uid, 'fold_pain');
        else if (prev && prev.kind === 'look') say(uid, 'fold_quick');
        else say(uid, 'fold');
        break;
      }
      case 'timeout':
        sfx('fold', { gain: 0.8, pan });
        if (seat === mySeat()) sys(/跟/.test(restOf(e)) ? 'timeout_call' : 'timeout_fold', 0.2, { prio: 4 });
        else if (chance(0.35)) sys('timeout_other', 0.3, { prio: 1 });
        break;
      case 'showdown':
        sfx('drumroll');
        sfx('reveal', { delay: 0.9 });
        sys('showdown', 0.2);
        pendingReveal = { handNo: h.handNo, at: Date.now() };
        break;
      case 'show': {
        sfx('flip', { pan });
        const cv = h.visible.find((x) => x.seatIndex === seat);
        if (cv && (cv.type === 'sanpai' || cv.type === 'duizi')) say(uid, 'show_bluff');
        else say(uid, 'show');
        if (cv) sys('type_' + cv.type, 1.3);
        break;
      }
      default:
        break;
    }
  }

  // 牌型播报：二三五吃豹子 > 豹子 / 顺金 > 其他
  function announceType(cv, beatBaozi, delay) {
    if (!cv) return;
    if (cv.is235 && beatBaozi) {
      sfx('b235', { delay });
      sfx('crowd_ooh', { delay: delay + 0.6, gain: 0.8 });
      sys('type_235', delay + 0.3, { prio: 4 });
      return;
    }
    if (cv.type === 'baozi' || cv.type === 'shunjin') sfx('crowd_ooh', { delay: delay + 0.2, gain: 0.6 });
    sys('type_' + cv.type, delay);
  }

  function onState(v) {
    view = v;
    const h = v.hand;
    const me = mySeat();
    if (voiceManifest.ready) preloadFor(v);
    if (!inited) {
      // 首次进入（含刷新、重连）：只记录基线，不补播历史
      inited = true;
      prevSeats = v.seats.map((s) => (s ? { userId: s.userId, ready: s.ready } : null));
      prevPaused = !!v.paused;
      if (h) {
        handNo = h.handNo;
        done = new Set(h.log.map(logKey));
        turnKey = h.handNo + ':' + h.turnSeat + ':' + h.turnDeadline;
        once.add(handKey('two_left'));
        once.add(handKey('big_pot'));
      }
      if (audioState.unlocked && onceFor('welcome:' + v.code)) sys('welcome', 0.6);
      return;
    }

    // 入座 / 离座 / 准备
    let sat = false;
    let readied = false;
    v.seats.forEach((s, i) => {
      const p = prevSeats[i];
      if (p && (!s || s.userId !== p.userId)) sfx('stand', { pan: panOf(i), gain: 0.8 });
      if (s && (!p || p.userId !== s.userId)) {
        if (s.isBot) {
          sfx('robot', { pan: panOf(i) });
          sys('robot_join', 0.5);
        } else {
          sat = true;
          if (s.userId !== v.me.userId && v.phase === 'waiting') sys('player_join', 0.4, { prio: 1 });
        }
      } else if (s && p && !p.ready && s.ready) readied = true;
    });
    prevSeats = v.seats.map((s) => (s ? { userId: s.userId, ready: s.ready } : null));
    if (sat) sfx('sit');
    if (readied) sfx('ready');

    // 本场暂停 / 继续
    if (!!v.paused !== prevPaused) {
      prevPaused = !!v.paused;
      sfx(prevPaused ? 'paused' : 'resume');
      sys(prevPaused ? 'paused' : 'resumed', 0.4);
    }

    // 自己积分的最低点（翻盘用）
    if (me !== null && v.seats[me] && v.phase === 'playing') {
      if (minSession !== v.sessionNo) {
        minSession = v.sessionNo;
        myMinChips = Infinity;
      }
      myMinChips = Math.min(myMinChips, v.seats[me].chips);
    }

    if (h) {
      if (h.handNo !== handNo) {
        handNo = h.handNo;
        done = new Set();
        prevActive = h.players.length;
      }
      // 新的操作记录：只播最近 3 条，避免网络卡顿后一下子冒出一串
      const fresh = [];
      h.log.forEach((e, i) => {
        const k = logKey(e);
        if (!done.has(k)) {
          done.add(k);
          fresh.push([e, i]);
        }
      });
      fresh.slice(-3).forEach(([e, i]) => playLog(e, v, i));

      if (!h.ended) {
        const act = h.players.filter((p) => p.state === 'active');
        const active = act.length;
        const a = v.config.ante;
        // 只剩两人（从多人减到两人时）
        if (active === 2 && prevActive > 2 && onceFor(handKey('two_left'))) {
          sfx('drumroll', { gain: 0.6 });
          sys('two_left', 0.9);
        }
        prevActive = active;
        // 底池变大 / 爆了
        if (h.pot >= a * 120 && onceFor(handKey('huge_pot'))) {
          once.add(handKey('big_pot'));
          sfx('crowd_ooh', { gain: 0.5, delay: 0.6 });
          sys('huge_pot', 1.2);
        } else if (h.pot >= a * 40 && onceFor(handKey('big_pot'))) {
          sys('big_pot', 1.2);
        }
        // 全员闷牌好几轮
        if (h.round >= 4 && active >= 2 && act.every((p) => !p.seen) && onceFor(handKey('all_blind'))) sys('all_blind', 1.0, { prio: 1 });
        // 可以比牌了：每场提醒一次，只提醒还在局里的自己
        const mine = me !== null && act.some((p) => p.seatIndex === me);
        if (mine && h.round > v.config.compareAfterRound && onceFor(sessKey('can_compare'))) sys('can_compare', 0.8, { prio: 1 });
      }

      // 强制开牌：亮出的牌到了就报赢家牌型
      if (pendingReveal && h.ended && h.handNo === pendingReveal.handNo && h.result) {
        const w = h.result.winners[0];
        const cv = h.visible.find((x) => x.seatIndex === w);
        if (cv) {
          const beat = h.visible.some((x) => x.seatIndex !== w && x.type === 'baozi');
          const wait = Math.max(0, 1.6 - (Date.now() - pendingReveal.at) / 1000);
          announceType(cv, beat, wait);
          pendingReveal = null;
        } else if (Date.now() - pendingReveal.at > 4000) pendingReveal = null;
      }
      // 和我有关的比牌：赢家是二三五、输家是豹子
      if (pendingCompare && h.visible) {
        pendingCompare = false;
        const mineCv = h.myCards;
        const cards = h.visible.concat(mineCv ? [{ ...mineCv, seatIndex: me }] : []);
        const b235 = cards.find((x) => x.is235);
        if (b235 && cards.some((x) => x !== b235 && x.type === 'baozi')) {
          const wait = Math.max(0.2, (compareUntil - Date.now()) / 1000 - 0.6);
          announceType(b235, true, wait);
        }
      }
    }

    // 本局刚结束：输光 / 翻盘
    if (pendingAfterHand && h && h.ended && me !== null && v.seats[me]) {
      pendingAfterHand = false;
      const chips = v.seats[me].chips;
      const init = v.config.initialChips;
      if (chips <= 0 && onceFor(sessKey('bust:' + h.handNo))) sys('bust', 3.6, { prio: 4 });
      else if (myMinChips < init * 0.4 && chips > init && onceFor(sessKey('comeback'))) {
        sfx('crowd_cheer', { delay: 3.4, gain: 0.6 });
        sys('comeback', 3.6, { prio: 4 });
      }
    }

    // 轮到自己
    const isMine = !!(h && !h.ended && me !== null && h.turnSeat === me);
    const key = h ? h.handNo + ':' + h.turnSeat + ':' + h.turnDeadline : '';
    if (isMine && key !== turnKey) {
      hurried = false;
      lastBeat = 0;
      if (isDealing()) pendingTurn = true;
      else turnAlert();
    }
    if (!isMine) pendingTurn = false;
    turnKey = key;
    myTurn = isMine;
    deadline = isMine ? h.turnDeadline || 0 : 0;
    if (typeof document !== 'undefined') {
      document.title = isMine && document.hidden ? '【轮到你了】' + BASE_TITLE : BASE_TITLE;
    }
  }

  function turnAlert() {
    pendingTurn = false;
    lastAlert = curNow;
    sfx('turn');
    sys('your_turn', 0.45, { prio: 4 });
    try {
      if (navigator.vibrate) navigator.vibrate([60, 50, 60]);
    } catch (e) {
      /* 忽略 */
    }
  }

  // 紧张程度：0 无 / 1 有点紧张 / 2 很紧张
  function tensionNow(srvNow) {
    const v = view;
    const h = v && v.hand;
    if (!h || h.ended || v.phase !== 'playing') return 0;
    if (Date.now() < allInUntil) return 2;
    if (myTurn && deadline && deadline - srvNow <= 10000) return 2;
    const active = h.players.filter((p) => p.state === 'active').length;
    const a = v.config.ante;
    if (active === 2 && h.pot >= a * 60) return 2;
    if (active === 2 && h.players.length > 2) return 1;
    if (h.pot >= a * 40 || h.round >= v.config.maxRounds - 1) return 1;
    return 0;
  }

  // 每 250ms 调用一次（后台时浏览器会放慢到每秒一次）
  function onTick(srvNow) {
    curNow = srvNow;
    setTension(tensionNow(srvNow));
    if (typeof document !== 'undefined' && !isHidden() && document.title !== BASE_TITLE) document.title = BASE_TITLE;
    if (pendingTurn && myTurn && !isDealing()) turnAlert();
    if (!myTurn || !deadline) return;
    const left = deadline - srvNow;
    // 还没操作：隔一会儿再提醒（最后 10 秒交给心跳和催促）
    if (!pendingTurn && left > 10500 && srvNow - lastAlert >= (isHidden() ? REMIND_HIDDEN_MS : REMIND_MS)) turnAlert();
    // 后台时标题栏闪烁
    if (typeof document !== 'undefined' && isHidden()) {
      document.title = (Math.floor(srvNow / 1000) % 2 ? '【轮到你了】' : '【　　　　】') + BASE_TITLE;
    }
    if (pendingTurn || left <= 0) return;
    // 最后 10 秒：心跳每秒一下；最后 5 秒：每半秒一下，越来越响，再加滴答
    const step = left <= 5000 ? 500 : 1000;
    const beat = Math.ceil(left / step);
    if (left <= 10000 && beat !== lastBeat) {
      lastBeat = beat;
      const k = 1 - left / 10000;
      sfx('heartbeat', { gain: 0.55 + 0.45 * k });
      if (left <= 5000 && step === 500 && beat % 2 === 0) sfx('tick', { gain: 0.6 + 0.4 * k });
      if (left <= 5000 && !hurried) {
        hurried = true;
        sys('hurry', 0.15, { prio: 4 });
      }
    }
  }

  /* ---------- 聊天：常用语、表情、道具 ---------- */
  function onChat(msg) {
    const v = view;
    const fromMe = v && msg.userId === v.me.userId;
    const pan = panOf(msg.seatIndex);
    if (msg.kind === 'emoji') {
      const s = EMOJI_SOUND[msg.text];
      if (s && s.v) say(msg.userId, s.v, { prio: 1, wait: 2500 });
      else if (s && s.s) sfx(s.s, { pan, gain: s.gain || 0.9 });
      return;
    }
    if (msg.kind === 'prop') {
      const p = propOf(msg.text);
      if (!p) return;
      const to = panOf(msg.toSeat);
      const fly = PROP_FLY_MS / 1000;
      sfx('whoosh', { pan: (pan + to) / 2, gain: 0.9 });
      if (p.id === 'bomb') {
        sfx('fuse', { delay: fly, pan: to });
        sfx('kaboom', { delay: fly + BOMB_FUSE_MS / 1000, pan: to });
        say(msg.toUserId, 'hit', { delay: fly + BOMB_FUSE_MS / 1000 + 0.5, prio: 1 });
        if (chance(0.5)) sfx('crowd_laugh', { delay: fly + BOMB_FUSE_MS / 1000 + 0.9, gain: 0.45 });
        return;
      }
      sfx(p.hit, { delay: fly, pan: to });
      say(msg.toUserId, p.react, { delay: fly + 0.35, prio: 1, wait: 2500 });
      if (p.mean && chance(0.45)) sfx('crowd_laugh', { delay: fly + 0.4, gain: 0.45 });
      return;
    }
    // 文字：常用语用发送者的声音念出来；其他消息只响一声提示
    const idx = voiceManifest.phrases.indexOf(msg.text);
    if (idx >= 0 && say(msg.userId, 'phrase', { idx, prio: 1, wait: 2500 })) return;
    if (!fromMe) sfx('sit', { gain: 0.7, pan });
  }

  function onEvent(ev) {
    const v = view;
    const me = v ? mySeat() : null;
    switch (ev.kind) {
      case 'handStart':
        // 发牌声由 RoomScreen 的发牌动画逐张播放
        if (ev.handNo === 1) {
          sfx('start', { gain: 0.8 });
          sys('start', 0.7);
        } else if (v && ev.handNo === v.config.hands) {
          sys('last_hand', 0.6);
        } else {
          sys('new_hand', 0.3);
        }
        break;
      case 'compare': {
        compareUntil = Date.now() + 2400;
        const mine = me !== null && (ev.fromSeat === me || ev.toSeat === me);
        const winSeat = ev.loserSeat === ev.fromSeat ? ev.toSeat : ev.fromSeat;
        if (mine) {
          // 和我有关：鼓点 → 开牌的一声 → 结果；我发起的喊“开你”，别人找我比的播“有人和你比牌”
          pendingCompare = true;
          sfx('drumroll');
          sfx('compare', { delay: 0.5 });
          if (ev.fromSeat === me) say(v.me.userId, 'compare', { prio: 3 });
          else sys('cmp_me', 0, { prio: 4 });
          if (ev.loserSeat === me) {
            sfx('lose', { delay: 1.2 });
            say(uidOfSeat(v, winSeat), 'compare_win', { delay: 1.3 });
            sys('compare_lose', 2.2, { prio: 4 });
          } else {
            sfx('chips', { delay: 1.15 });
            sys('compare_win', 1.5, { prio: 4 });
          }
        } else if (v) {
          // 别人之间比牌：声音轻一些、偏向他们的方位，没有鼓点；赢家得意一句或者输家叹一句
          const pan = (panOf(ev.fromSeat) + panOf(ev.toSeat)) / 2;
          sfx('compare', { gain: 0.45, pan });
          say(uidOfSeat(v, ev.fromSeat), 'compare', { prio: 2 });
          if (chance(0.5)) sys('cmp_others', 0.9, { prio: 1 });
          if (chance(0.5)) say(uidOfSeat(v, winSeat), 'compare_win', { delay: 1.5 });
          else if (chance(0.7)) say(uidOfSeat(v, ev.loserSeat), 'lose', { delay: 1.5 });
        }
        break;
      }
      case 'allIn':
        allInUntil = Date.now() + 3500;
        sfx('heartbeat');
        sfx('allin', { delay: 0.2 });
        if (ev.success) sfx('crowd_ooh', { delay: 1.5, gain: 0.55 });
        sys(ev.success ? 'allin_ok' : 'allin_fail', 1.8, { prio: 4 });
        break;
      case 'handEnd': {
        const r = ev.result;
        if (!r) break;
        if (r.reason === 'voided') {
          sfx('notice');
          break;
        }
        pendingAfterHand = true;
        const iWin = me !== null && r.winners.indexOf(me) >= 0;
        const myD = r.deltas.find((d) => d.seatIndex === me);
        const played = !!myD;
        const bigWin = iWin && myD && myD.delta >= ante() * 25;
        // 比牌直接结束本局：等比牌的声音播完
        let t = Math.max(0, (compareUntil - Date.now()) / 1000);
        if (r.bonus) {
          sfx('bonus', { delay: t + 0.2 });
          sfx('boom', { delay: t + 0.2, gain: 0.8 });
          sfx('crowd_ooh', { delay: t + 0.5, gain: 0.7 });
          sys(r.bonus.type, t + 0.3, { prio: 4 });
          t += 1.6;
        }
        // 赢家的一句：闷着赢的、大赢的、普通赢的
        const w = r.winners[0];
        const wp = v && v.hand ? v.hand.players.find((p) => p.seatIndex === w) : null;
        const wD = r.deltas.find((d) => d.seatIndex === w);
        const winCat = wp && !wp.seen ? 'win_blind' : wD && wD.delta >= ante() * 25 ? 'win_big' : 'win';
        const wUid = v && w !== undefined ? uidOfSeat(v, w) : null;
        if (iWin) {
          sfx('fanfare', { delay: t + 0.9 });
          sfx('coins', { delay: t + 1.1 });
          if (bigWin) {
            sfx('boom', { delay: t + 0.9, gain: 0.7 });
            sfx('crowd_cheer', { delay: t + 1.3, gain: 0.65 });
          }
          say(v.me.userId, winCat, { delay: t + 0.35 });
          sys(bigWin ? 'big_win' : 'you_win', t + 1.6, { prio: 4 });
        } else if (played) {
          sfx('lose2', { delay: t + 0.8 });
          // 赢家先得意一句，再安慰自己
          if (wUid) say(wUid, winCat, { delay: t + 0.4 });
          sys('you_lose', t + 2.0, { prio: 4 });
        } else {
          sfx('coins', { delay: t + 0.6, gain: 0.7, pan: panOf(w) });
          if (wUid) say(wUid, winCat, { delay: t + 0.5 });
        }
        // 连胜 / 连胜被终结（所有人都听得到）
        if (r.streak && r.streak.n >= 2) {
          const n = r.streak.n;
          const cat = n === 2 ? 'streak2' : n === 3 ? 'streak3' : n === 5 ? 'streak5' : 'streak_hot';
          sfx('streak', { delay: t + 3.0 });
          if (n >= 5) sfx('crowd_cheer', { delay: t + 3.2, gain: 0.55 });
          sys(cat, t + 3.3);
        } else if (r.streakEnd && r.streakEnd.n >= 3) {
          sfx('crowd_ooh', { delay: t + 3.0, gain: 0.5 });
          sys('streak_end', t + 3.3);
        }
        break;
      }
      case 'rebuy':
        if (ev.seat === me) {
          sfx('coins', { gain: 0.8 });
          sys('rebuy_me', 0.6, { prio: 4 });
        } else {
          sfx('coins', { gain: 0.5, pan: panOf(ev.seat) });
        }
        break;
      case 'sessionEnd': {
        const ps = (ev.summary && ev.summary.players) || [];
        const k = v ? ps.findIndex((p) => p.userId === v.me.userId) : -1;
        if (k < 0) {
          sfx('notice');
          sys('session_end', 0.3);
        } else if (k === 0) {
          sfx('champion', { delay: 0.2 });
          sfx('crowd_cheer', { delay: 0.8, gain: 0.7 });
          sys('champion', 1.2, { prio: 4 });
        } else if (k === ps.length - 1 && ps.length >= 2) {
          sfx('lose2', { delay: 0.2, gain: 0.7 });
          sys('rank_last', 0.9, { prio: 4 });
        } else if (k === 1 || k === 2) {
          sfx('notice');
          sys(k === 1 ? 'rank2' : 'rank3', 0.4, { prio: 4 });
        } else {
          sfx('notice');
          sys('rank_mid', 0.4, { prio: 4 });
        }
        break;
      }
      case 'kicked':
        sfx('kick');
        sys('kicked', 0.5, { prio: 4 });
        break;
      case 'dissolved':
        sfx('notice');
        sys('dissolved', 0.3, { prio: 4 });
        break;
      case 'notice':
        sfx('notice', { gain: 0.6 });
        break;
      case 'chat':
        if (ev.msg) onChat(ev.msg);
        break;
      default:
        break;
    }
  }

  function dispose() {
    setTension(0);
    if (typeof document !== 'undefined') document.title = BASE_TITLE;
  }

  return { onState, onTick, onEvent, dispose };
}
