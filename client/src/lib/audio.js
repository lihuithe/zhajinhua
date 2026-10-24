// 声音：背景音乐 / 音效 / 语音播报（WebAudio）
// - 浏览器要求用户手势后才能出声：首次点击 / 触摸时解锁（兼容 iOS、微信）
// - 开关、音量、播报风格、立体声方位保存在 localStorage；电脑 / 安卓切到后台照常出声（iOS 系统限制，后台无声）
// - 音效：每次播放音高、音量都轻微随机，听起来不机械；可以按座位方位偏左 / 偏右
// - 语音：同一时间只播一条，按优先级调度——重要的打断次要的，次要的排队，等太久就丢掉
// - 语音文件多（上千条）：压缩数据整份缓存，解码后的只保留最近用过的一部分，手机内存吃得消
// - 紧张铺底：牌局紧张时循环播放一层低沉的铺底，同时压低背景音乐
import { reactive, watch } from 'vue';

const BASE = '/audio/';
// 每次构建不同：部署后浏览器会重新拉取音频，而不是用缓存里的旧文件
const V = '?v=' + (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev');
const KEY = 'zjh_audio';
const VOL = { music: 0.32, sfx: 0.8, voice: 1 };

// 背景音乐曲目：前 5 首是真实乐器录制（Kevin MacLeod，incompetech.com，CC BY 4.0），最后一首是自己合成的
export const MUSIC_TRACKS = [
  { id: 'carefree', name: '轻快尤克里里', desc: '尤克里里、马林巴，欢快', credit: 'Carefree', file: 'music/carefree' },
  { id: 'shenyang', name: '民乐 · 沈阳', desc: '二胡、琵琶、扬琴，明快', credit: 'Shenyang', file: 'music/shenyang' },
  { id: 'guzheng', name: '古筝', desc: '古筝配手鼓，舒缓', credit: 'Guzheng City', file: 'music/guzheng' },
  { id: 'bossa', name: '酒廊吉他', desc: '原声吉他波萨诺瓦，轻松', credit: 'Bossa Antigua', file: 'music/bossa' },
  { id: 'monkeys', name: '俏皮弦乐', desc: '长笛、小提琴，活泼', credit: 'Monkeys Spinning Monkeys', file: 'music/monkeys' },
  { id: 'festive', name: '喜庆锣鼓（合成）', desc: '笛子、拨弦、锣鼓，热闹', file: 'bgm', synth: true },
];
const trackOf = (id) => MUSIC_TRACKS.find((t) => t.id === id) || MUSIC_TRACKS[0];
const ANNOUNCER_IDS = ['std', 'fun', 'db', 'yue'];
const clamp01 = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);

function loadPrefs() {
  const base = { music: true, sfx: true, voice: true, track: MUSIC_TRACKS[0].id, vol: { music: 1, sfx: 1, voice: 1 }, announcer: 'std', spatial: true };
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v3：背景音乐默认开启，默认曲目“轻快尤克里里”；更早的版本保存的设置重置一次。v4 增加音量、播报风格、立体声
    if (p.v !== 3 && p.v !== 4) return { ...base, sfx: p.sfx !== false, voice: p.voice !== false };
    const vol = p.vol || {};
    return {
      music: p.music !== false,
      sfx: p.sfx !== false,
      voice: p.voice !== false,
      track: trackOf(p.track).id,
      vol: { music: clamp01(vol.music, 1), sfx: clamp01(vol.sfx, 1), voice: clamp01(vol.voice, 1) },
      announcer: ANNOUNCER_IDS.includes(p.announcer) ? p.announcer : 'std',
      spatial: p.spatial !== false,
    };
  } catch (e) {
    return base;
  }
}

export const audioState = reactive({ ...loadPrefs(), unlocked: false, supported: true });

/** 语音清单：每个声音包 / 播报风格每类有几条，常用语的文字（tools/audio/gen_voice.py 生成） */
export const voiceManifest = reactive({ ready: false, packs: {}, styles: {}, phrases: [] });
let manifestP = null;
export function loadManifest() {
  if (!manifestP) {
    manifestP = fetch(BASE + 'voice/manifest.json' + V)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((m) => {
        voiceManifest.packs = m.packs || {};
        voiceManifest.styles = m.styles || {};
        voiceManifest.phrases = m.phrases || [];
        voiceManifest.ready = true;
      })
      .catch(() => {
        manifestP = null; // 下次再试
      });
  }
  return manifestP;
}

watch(
  () => [audioState.music, audioState.sfx, audioState.voice, audioState.track, audioState.vol.music, audioState.vol.sfx, audioState.vol.voice, audioState.announcer, audioState.spatial],
  ([music, sfx, voice, track]) => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ v: 4, music, sfx, voice, track, vol: { ...audioState.vol }, announcer: audioState.announcer, spatial: audioState.spatial }),
      );
    } catch (e) {
      /* 忽略 */
    }
    applyGains();
    if (!sfx) setTension(0);
    if (!voice) stopVoices();
    if (musicSrc && musicSrc.id !== trackOf(track).id) stopMusic(true);
    if (music) startMusic();
    else stopMusic();
  },
);

/** 在点击事件里直接调用：iOS 只允许在用户手势里开始播放 */
export function setMusic(on) {
  audioState.music = !!on;
  if (on) startMusic();
  else stopMusic();
}
export function setTrack(id) {
  const t = trackOf(id).id;
  if (t === audioState.track && musicSrc) return;
  audioState.track = t;
  stopMusic(true);
  audioState.music = true;
  startMusic();
}

let ctx = null;
let bus = null; // { music, sfx, voice } GainNode
let musicSrc = null;
let musicWanted = false;
let voiceDucking = false;
let duckTimer = 0;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) {
    audioState.supported = false;
    return null;
  }
  ctx = new AC();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  bus = {};
  for (const k of ['music', 'sfx', 'voice']) {
    bus[k] = ctx.createGain();
    bus[k].connect(master);
  }
  applyGains();
  return ctx;
}

function busTarget(k) {
  if (!audioState[k]) return 0;
  let v = VOL[k] * audioState.vol[k];
  if (k === 'music') {
    if (voiceDucking) v *= 0.35; // 说话时压低背景音乐
    if (tensionLevel > 0) v *= 0.55; // 紧张时背景音乐退后，让铺底出来
  }
  return v;
}
function applyGains() {
  if (!ctx || !bus) return;
  const t = ctx.currentTime;
  for (const k of ['music', 'sfx', 'voice']) {
    bus[k].gain.cancelScheduledValues(t);
    bus[k].gain.setTargetAtTime(busTarget(k), t, 0.06);
  }
}

function decode(ab) {
  return new Promise((resolve, reject) => {
    // 老 Safari 只支持回调形式
    const p = ctx.decodeAudioData(ab, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

/* ---------------- 加载与缓存 ---------------- */
// bytes：语音的压缩数据（几 KB 一条，整份留着）；buffers：解码后的音频（Map 的插入顺序当 LRU 用）
const bytes = new Map();
const fetching = new Map();
const buffers = new Map();
const decoding = new Map();
const VOICE_DECODED_MAX = 90; // 解码后的语音最多留这么多条（1 秒约 0.2MB）
const isVoiceKey = (name) => name.startsWith('voice/');

function fetchBytes(name) {
  if (bytes.has(name)) return Promise.resolve(bytes.get(name));
  if (fetching.has(name)) return fetching.get(name);
  const p = fetch(BASE + name + '.mp3' + V)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((ab) => {
      fetching.delete(name);
      if (isVoiceKey(name)) bytes.set(name, ab);
      return ab;
    })
    .catch(() => {
      fetching.delete(name);
      return null;
    });
  fetching.set(name, p);
  return p;
}
function touch(name) {
  const b = buffers.get(name);
  buffers.delete(name);
  buffers.set(name, b);
}
function trimVoices() {
  let n = 0;
  for (const k of buffers.keys()) if (isVoiceKey(k)) n++;
  for (const k of [...buffers.keys()]) {
    if (n <= VOICE_DECODED_MAX) break;
    if (isVoiceKey(k) && !(curVoice && curVoice.name === k)) {
      buffers.delete(k);
      n--;
    }
  }
}
function load(name) {
  if (buffers.has(name)) {
    touch(name);
    return Promise.resolve(buffers.get(name));
  }
  if (decoding.has(name)) return decoding.get(name);
  if (!ensureCtx()) return Promise.resolve(null);
  const p = fetchBytes(name)
    .then((ab) => (ab ? decode(isVoiceKey(name) ? ab.slice(0) : ab) : null)) // 解码会占用（detach）数据，语音留一份原始数据
    .then((b) => {
      decoding.delete(name);
      if (b) {
        buffers.set(name, b);
        if (isVoiceKey(name)) trimVoices();
      }
      return b;
    })
    .catch(() => {
      decoding.delete(name);
      return null;
    });
  decoding.set(name, p);
  return p;
}

const SFX = [
  'click', 'chip', 'chips', 'push', 'pushbig', 'fanfare', 'coins', 'lose2', 'heartbeat', 'drumroll', 'boom', 'deal', 'card', 'flip', 'fold',
  'compare', 'allin', 'win', 'lose', 'turn', 'tick', 'sit', 'ready', 'start', 'bonus', 'notice',
  'stamp', 'stand', 'robot', 'kick', 'reveal', 'b235', 'streak', 'champion', 'capped', 'paused', 'resume',
  'whoosh', 'splat', 'squish', 'sparkle', 'clink', 'fuse', 'kaboom', 'kiss', 'like',
  'applause', 'party', 'fire', 'hundred', 'thumbsdown', 'pray', 'muscle', 'handshake', 'crowd_ooh', 'crowd_cheer', 'crowd_laugh',
];
// 这些音效每次播放时音高、音量轻微随机（音乐性的号角、和弦不随机，免得跑调）
const VARY = new Set(['click', 'chip', 'chips', 'push', 'pushbig', 'coins', 'deal', 'card', 'flip', 'fold', 'sit', 'stand', 'compare', 'stamp', 'whoosh', 'splat', 'squish', 'kiss', 'like', 'handshake', 'muscle', 'fire', 'party']);

export function preloadAll() {
  if (!ensureCtx()) return;
  SFX.forEach((n) => load('sfx/' + n));
}
/** 预先解码（马上可能要播的） */
export function preloadVoices(names) {
  if (!ensureCtx()) return;
  names.forEach((n) => load('voice/' + n));
}
// 后台预取压缩数据（只下载不解码），最多同时 3 个请求
const prefetchQ = [];
let prefetching = 0;
function pumpPrefetch() {
  while (prefetching < 3 && prefetchQ.length) {
    const k = prefetchQ.shift();
    if (bytes.has(k) || fetching.has(k)) continue;
    prefetching++;
    fetchBytes(k).finally(() => {
      prefetching--;
      pumpPrefetch();
    });
  }
}
export function prefetchVoices(names) {
  for (const n of names) {
    const k = 'voice/' + n;
    if (!bytes.has(k) && !fetching.has(k) && prefetchQ.indexOf(k) < 0) prefetchQ.push(k);
  }
  pumpPrefetch();
}

function running() {
  return ctx && ctx.state === 'running' && audioState.unlocked;
}

// 调试：localStorage.zjh_audio_debug = '1' 时记录每一次播放（window.__zjhAudioLog）
let DEBUG = false;
try {
  DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('zjh_audio_debug') === '1';
} catch (e) {
  /* 忽略 */
}
const debugLog = [];
if (DEBUG && typeof window !== 'undefined') window.__zjhAudioLog = debugLog;

/**
 * 播放一段已解码的音频：src →（音量）→（声像）→ 总线
 * @returns {AudioBufferSourceNode|null}
 */
function playBuffer(name, busName, { gain = 1, delay = 0, pan = 0, rate = 1, loop = false, maxLate = 600 } = {}) {
  if (!audioState[busName] || !running()) return null;
  const b = buffers.get(name);
  if (!b) {
    // 还没加载完：加载后只在很短时间内补播，避免声音明显滞后
    const t0 = Date.now();
    load(name).then((buf) => {
      if (buf && Date.now() - t0 < maxLate) playBuffer(name, busName, { gain, delay, pan, rate, loop, maxLate: 0 });
    });
    return null;
  }
  if (isVoiceKey(name)) touch(name);
  if (DEBUG) {
    debugLog.push({ t: Math.round(performance.now()), name, pan: Math.round(pan * 100) / 100, delay });
    if (debugLog.length > 400) debugLog.splice(0, debugLog.length - 400);
  }
  const src = ctx.createBufferSource();
  try {
    src.buffer = b;
  } catch (e) {
    buffers.clear();
    return null;
  }
  if (rate !== 1) src.playbackRate.value = rate;
  src.loop = loop;
  let node = src;
  if (gain !== 1) {
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    node = g;
  }
  if (pan && audioState.spatial && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    node = p;
  }
  node.connect(bus[busName]);
  src.start(ctx.currentTime + delay);
  return src;
}

/**
 * 音效
 * @param {string} name 见 SFX
 * @param {{gain?:number, delay?:number, pan?:number, rate?:number, vary?:boolean}} o
 *   pan：-1 最左 ~ 1 最右（按座位方位）；vary：是否随机微调音高音量（默认按音效类型）
 */
export function sfx(name, { gain = 1, delay = 0, pan = 0, rate = 1, vary } = {}) {
  if (vary === undefined ? VARY.has(name) : vary) {
    rate *= 1 + (Math.random() * 2 - 1) * 0.045;
    gain *= 0.88 + Math.random() * 0.12;
  }
  playBuffer('sfx/' + name, 'sfx', { gain, delay, pan, rate });
}

/* ---------------- 语音调度 ---------------- */
// 优先级：4 和我直接相关的系统播报（轮到你、输赢、235）> 3 其他系统播报 > 2 玩家动作喊话 > 1 闲聊（常用语、表情、反应）
// - 更高优先级的到来：打断正在播的
// - 同为玩家喊话（2）：新的打断旧的（最新的动作最有意义）
// - 其他情况：排队，等到超过 wait 毫秒还没轮到就丢掉
let curVoice = null; // { name, src, prio, endAt }
let vQueue = [];
let vSeq = 0;
const WAIT = { 1: 2200, 2: 900, 3: 2400, 4: 3500 };

function stopVoices() {
  vQueue = [];
  if (curVoice) {
    try {
      curVoice.src.stop();
    } catch (e) {
      /* 忽略 */
    }
    curVoice = null;
  }
}

function startVoice(item) {
  const name = 'voice/' + item.file;
  const src = playBuffer(name, 'voice', { pan: item.pan, gain: item.gain });
  if (!src) return false;
  const me = { name, src, prio: item.prio, endAt: performance.now() + (src.buffer.duration * 1000) / (src.playbackRate.value || 1) };
  curVoice = me;
  src.onended = () => {
    if (curVoice === me) {
      curVoice = null;
      pumpVoice();
    }
  };
  duck(src.buffer.duration + 0.3);
  if (item.onStart) item.onStart(src.buffer.duration);
  return true;
}
function pumpVoice() {
  const now = performance.now();
  vQueue = vQueue.filter((x) => x.expire > now);
  if (curVoice || !vQueue.length) return;
  vQueue.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
  const next = vQueue.shift();
  if (!startVoice(next)) pumpVoice();
}
function offerVoice(item) {
  const now = performance.now();
  if (now > item.expire || !audioState.voice || !running()) return;
  const name = 'voice/' + item.file;
  if (!buffers.has(name)) {
    load(name).then((b) => b && offerVoice(item));
    return;
  }
  const busy = curVoice && curVoice.endAt > now + 60;
  if (!busy) {
    curVoice = null;
    if (!startVoice(item)) pumpVoice();
    return;
  }
  if (item.prio > curVoice.prio || (item.prio === 2 && curVoice.prio === 2)) {
    const old = curVoice;
    curVoice = null;
    try {
      old.src.onended = null;
      old.src.stop();
    } catch (e) {
      /* 忽略 */
    }
    startVoice(item);
    return;
  }
  vQueue.push(item);
}

/**
 * 语音（文件名不含 voice/ 前缀和扩展名，例如 'p/m/call_0'、's/std/your_turn_1'）
 * @param {{delay?:number, prio?:number, pan?:number, wait?:number, gain?:number, onStart?:(sec:number)=>void}} o
 */
export function voice(file, { delay = 0, prio = 2, pan = 0, wait, gain = 1, onStart } = {}) {
  if (!audioState.voice || !running()) return;
  const item = { file, prio, pan, gain, onStart, seq: ++vSeq, expire: 0 };
  const go = () => {
    item.expire = performance.now() + (wait === undefined ? WAIT[prio] || 1500 : wait);
    offerVoice(item);
  };
  if (delay > 0) setTimeout(go, delay * 1000);
  else go();
}
/** 试听：打断一切，立刻播放 */
export function previewVoice(file) {
  stopVoices();
  voice(file, { prio: 9, wait: 3000 });
}

function duck(sec) {
  if (!bus || !audioState.music) return;
  voiceDucking = true;
  applyGains();
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    voiceDucking = false;
    applyGains();
  }, sec * 1000);
}

/* ---------------- 紧张铺底 ---------------- */
// level：0 无 / 1 有点紧张（只剩两人、底池变大）/ 2 很紧张（自己最后 10 秒、孤注一掷）
let tensionLevel = 0;
let tensionSrc = null; // { src, g }
let tensionMeta = null;
const TENSION_GAIN = [0, 0.32, 0.55];
export function setTension(level) {
  level = audioState.sfx ? level : 0;
  if (level === tensionLevel) return;
  tensionLevel = level;
  applyGains();
  if (!ctx || !bus) return;
  if (level === 0) {
    const t = tensionSrc;
    tensionSrc = null;
    if (t) {
      const now = ctx.currentTime;
      t.g.gain.cancelScheduledValues(now);
      t.g.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => {
        try {
          t.src.stop();
          t.g.disconnect();
        } catch (e) {
          /* 忽略 */
        }
      }, 2200);
    }
    return;
  }
  if (tensionSrc) {
    const now = ctx.currentTime;
    tensionSrc.g.gain.cancelScheduledValues(now);
    tensionSrc.g.gain.setTargetAtTime(TENSION_GAIN[level], now, 0.5);
    return;
  }
  if (!running()) return;
  Promise.all([
    load('sfx/tension'),
    tensionMeta ||
      fetch(BASE + 'sfx/tension.json' + V)
        .then((r) => r.json())
        .then((m) => (tensionMeta = m))
        .catch(() => (tensionMeta = { loop: 0, start: 0 })),
  ]).then(([b]) => {
    if (!b || tensionSrc || tensionLevel === 0 || !running()) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const m = tensionMeta || {};
    if (m.loop && m.start + m.loop <= b.duration) {
      src.loopStart = m.start;
      src.loopEnd = m.start + m.loop;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.setTargetAtTime(TENSION_GAIN[tensionLevel], ctx.currentTime, 0.6);
    src.connect(g);
    g.connect(bus.sfx);
    src.start(0, m.start || 0);
    tensionSrc = { src, g };
  });
}

/* ---------------- 背景音乐 ---------------- */
// 真实录制的曲子比较长，用 <audio> 流式播放再接进 WebAudio（不整首解码，省内存）；合成曲用解码后的缓冲区无缝循环
let bgmMeta = null;
function startMusic() {
  musicWanted = true;
  if (!audioState.music || musicSrc) return;
  const tr = trackOf(audioState.track);
  if (tr.synth) startSynthMusic();
  else startStreamMusic(tr);
}
function startStreamMusic(tr) {
  if (!ensureCtx()) return;
  const el = new Audio();
  el.src = BASE + tr.file + '.mp3' + V;
  el.loop = true;
  el.preload = 'auto';
  let node;
  try {
    node = ctx.createMediaElementSource(el);
  } catch (e) {
    return;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
  node.connect(g);
  g.connect(bus.music);
  const entry = { el, node, g, id: tr.id };
  musicSrc = entry;
  const p = el.play();
  // 没有用户手势时浏览器会拒绝播放：清掉，等下一次点击（unlock）再试
  if (p && p.catch) p.catch(() => musicSrc === entry && killMusic());
}
function startSynthMusic() {
  if (!running()) return;
  Promise.all([
    load('bgm'),
    bgmMeta ||
      fetch(BASE + 'bgm.json' + V)
        .then((r) => r.json())
        .then((m) => (bgmMeta = m))
        .catch(() => (bgmMeta = { loop: 0, start: 0 })),
  ]).then(([b]) => {
    if (!b || musicSrc || !audioState.music || !musicWanted || !running()) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const m = bgmMeta || {};
    // 文件内容是周期性的：任取一段长度为 loop 的窗口都能无缝循环
    if (m.loop && m.start + m.loop <= b.duration) {
      src.loopStart = m.start;
      src.loopEnd = m.start + m.loop;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    src.connect(g);
    g.connect(bus.music);
    src.start(0, m.start || 0);
    musicSrc = { src, g, id: 'festive' };
  });
}
function endEntry(m, later) {
  const done = () => {
    try {
      if (m.src) m.src.stop();
      if (m.el) {
        m.el.pause();
        m.el.removeAttribute('src');
        m.el.load();
      }
      if (m.node) m.node.disconnect();
      m.g.disconnect();
    } catch (e) {
      /* 忽略 */
    }
  };
  if (later) setTimeout(done, 650);
  else done();
}
/** 立即停掉背景音乐（切后台、重建音频上下文时） */
function killMusic() {
  const m = musicSrc;
  musicSrc = null;
  if (m) endEntry(m, false);
}
/** 淡出后停止；force：换曲目时即使 musicWanted 也停 */
function stopMusic(force) {
  if (!force) musicWanted = audioState.music && musicWanted;
  if (!musicSrc || !ctx) return;
  const m = musicSrc;
  musicSrc = null;
  const t = ctx.currentTime;
  m.g.gain.cancelScheduledValues(t);
  m.g.gain.setValueAtTime(m.g.gain.value, t);
  m.g.gain.linearRampToValueAtTime(0, t + 0.6);
  endEntry(m, true);
}
export function wantMusic(on) {
  musicWanted = !!on;
  if (on) startMusic();
  else stopMusic();
}

/* ---------------- 解锁 / 前后台 ---------------- */
// 切到后台再回来时，iOS Safari / 微信里 AudioContext 常会卡在 interrupted（或显示 running 却没声音），
// resume() 救不回来，只能新建一个。所以：回到前台后，第一次点击时重建 AudioContext；已解码的音频直接复用。
const IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
let needRecreate = false;

function recreate() {
  killMusic();
  const old = ctx;
  ctx = null;
  bus = null;
  musicSrc = null;
  curVoice = null;
  vQueue = [];
  tensionSrc = null;
  const lv = tensionLevel;
  tensionLevel = 0;
  try {
    if (old && old.close) old.close();
  } catch (e) {
    /* 忽略 */
  }
  ensureCtx();
  if (lv) setTimeout(() => setTension(lv), 300);
}

function unlock() {
  if (ctx && needRecreate && (IOS || ctx.state !== 'running')) {
    needRecreate = false;
    recreate();
  }
  if (!ensureCtx()) return;
  const done = () => {
    if (!audioState.unlocked) {
      audioState.unlocked = true;
      preloadAll();
      loadManifest();
    }
    if (musicWanted) startMusic();
  };
  if (ctx.state !== 'running') {
    // iOS：在手势回调里播一段静音并 resume
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) {
      /* 忽略 */
    }
    const p = ctx.resume();
    if (p && p.then) p.then(done, () => {});
    else done();
  } else done();
}

function onHidden() {
  if (!ctx) return;
  needRecreate = true;
  // 电脑 / 安卓：切到后台什么都不停，音效、语音、背景音乐照常播放（不然切走就不知道牌局动态了）
  // iOS 后台本来就放不了声音：停掉音乐、挂起音频，回来后在第一次点击时重建
  if (!IOS) return;
  killMusic();
  try {
    ctx.suspend();
  } catch (e) {
    /* 忽略 */
  }
}
function onVisible() {
  if (!ctx || !audioState.unlocked) return;
  // 桌面浏览器通常不需要手势就能恢复；恢复不了的（iOS 等）会在下一次点击时重建
  const p = ctx.resume();
  const go = () => {
    if (ctx && musicWanted) startMusic();
  };
  if (p && p.then) p.then(go, () => {});
  else go();
}

if (typeof document !== 'undefined') {
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((ev) => document.addEventListener(ev, unlock, true));
  // 所有按钮点击声
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target && e.target.closest && e.target.closest('button, .seat.canSit, .seat.selectable, .chip');
      if (el && !el.disabled && !el.hasAttribute('data-nosfx')) sfx('click', { gain: 0.8 });
    },
    true,
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      needRecreate = true;
      onVisible();
    }
  });
}

// 调试用：在控制台执行 __zjhAudio() 查看声音状态
if (typeof window !== 'undefined') {
  window.__zjhAudio = () => ({
    state: ctx ? ctx.state : 'none',
    unlocked: audioState.unlocked,
    music: !!musicSrc,
    needRecreate,
    buffers: buffers.size,
    voiceBytes: bytes.size,
    voice: curVoice ? curVoice.name : null,
    queue: vQueue.map((x) => x.file),
    tension: tensionLevel,
  });
}
