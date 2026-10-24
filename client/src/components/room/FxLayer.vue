<script setup>
// 全屏特效层：筹码飞行、金币雨、闪光粒子、动作气泡、飘字、全屏横幅、边缘闪光、发牌
// 挂在 body 上、铺满整个屏幕（不再局限在牌桌区域），坐标默认是牌桌区域内的坐标，由 origin() 换算到屏幕；
// 传 { x, y, abs: true } 表示已经是屏幕坐标。
// 为了在低端手机上流畅：不走 Vue 响应式，直接创建 DOM 元素并用 Web Animations API 播放，播完即删
import { ref } from 'vue';

const props = defineProps({
  origin: { type: Function, default: null }, // () => { x, y }：牌桌区域左上角在屏幕上的位置
});
const root = ref(null);
// 牌桌坐标 → 屏幕坐标
function S(p) {
  if (!p || p.abs || !props.origin) return p;
  const o = props.origin() || { x: 0, y: 0 };
  return { x: p.x + o.x, y: p.y + o.y };
}
const MAX_NODES = 360;
let live = 0;

const rand = (a, b) => a + Math.random() * (b - a);

function node(cls, html) {
  if (!root.value || live >= MAX_NODES) return null;
  const el = document.createElement('div');
  el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  root.value.appendChild(el);
  live++;
  return el;
}
function play(el, frames, opts) {
  if (!el) return null;
  let a;
  try {
    a = el.animate(frames, { fill: 'both', ...opts });
  } catch (e) {
    el.remove();
    live--;
    return null;
  }
  a.onfinish = a.oncancel = () => {
    el.remove();
    live--;
  };
  return a;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * 筹码沿弧线飞行
 * @param {{x,y}} from @param {{x,y}} to @param {number} n 枚数
 * @param {{delay?:number, gap?:number, dur?:number, spread?:number, coin?:boolean}} o
 */
function chips(from, to, n = 3, o = {}) {
  const { delay = 0, gap = 45, dur = 520, spread = 14, coin = false } = o;
  from = S(from);
  to = S(to);
  for (let k = 0; k < n; k++) {
    const el = node(coin ? 'zfx-coin' : 'zfx-chip zfx-c' + (k % 4), coin ? '<i></i>' : undefined);
    if (!el) break;
    const sx = from.x + rand(-6, 6);
    const sy = from.y + rand(-6, 6);
    const ex = to.x + rand(-spread, spread);
    const ey = to.y + rand(-spread * 0.6, spread * 0.6);
    const mx = (sx + ex) / 2 + rand(-30, 30);
    const my = Math.min(sy, ey) - rand(40, 90);
    play(
      el,
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1, offset: 0.08 },
        { transform: `translate(${mx}px, ${my}px) scale(1.15)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.85)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.6)`, opacity: 0 },
      ],
      { duration: dur + rand(-60, 80), delay: delay + k * gap, easing: 'cubic-bezier(.35,.0,.25,1)' },
    );
  }
}

/** 金币雨：从屏幕上方落下，铺满整个屏幕（宽屏按宽度多撒一些） */
function rain(n = 40, o = {}) {
  const { w = window.innerWidth, h = window.innerHeight, dur = 1700 } = o;
  n = Math.round(n * Math.max(1, Math.min(2.2, w / 700)));
  for (let k = 0; k < n; k++) {
    const el = node('zfx-coin zfx-big', '<i></i>');
    if (!el) break;
    const x = rand(0, w);
    const drift = rand(-60, 60);
    const s = rand(0.7, 1.25);
    play(
      el,
      [
        { transform: `translate(${x}px, -40px) scale(${s}) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x + drift}px, ${h * 0.7}px) scale(${s}) rotate(${rand(-200, 200)}deg)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${x + drift * 1.2}px, ${h + 40}px) scale(${s}) rotate(${rand(-260, 260)}deg)`, opacity: 0 },
      ],
      { duration: dur + rand(-300, 500), delay: rand(0, 900), easing: 'cubic-bezier(.45,.05,.85,.6)' },
    );
  }
}

/** 闪光粒子：从一点向四周炸开 */
function burst(p, n = 14, color = '#ffd56b') {
  p = S(p);
  for (let k = 0; k < n; k++) {
    const el = node('zfx-spark');
    if (!el) break;
    el.style.background = color;
    const a = (Math.PI * 2 * k) / n + rand(-0.2, 0.2);
    const r = rand(30, 70);
    play(
      el,
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${p.x + Math.cos(a) * r}px, ${p.y + Math.sin(a) * r}px) scale(0.2)`, opacity: 0 },
      ],
      { duration: rand(450, 750), easing: 'cubic-bezier(.1,.8,.3,1)' },
    );
  }
}

/** 动作气泡：在座位旁弹出，kind = call / raise / look / fold / compare / allin / info */
function callout(p, text, kind = 'info', big = false) {
  p = S(p);
  const el = node('zfx-call zfx-k-' + kind + (big ? ' zfx-bigcall' : ''), esc(text));
  play(
    el,
    [
      { transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(0.3)`, opacity: 0, easing: 'cubic-bezier(.2,1.4,.4,1)' },
      { transform: `translate(${p.x}px, ${p.y - 6}px) translate(-50%, -50%) scale(${big ? 1.3 : 1.12})`, opacity: 1, offset: 0.12 },
      { transform: `translate(${p.x}px, ${p.y - 8}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.22 },
      { transform: `translate(${p.x}px, ${p.y - 14}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${p.x}px, ${p.y - 26}px) translate(-50%, -50%) scale(0.9)`, opacity: 0 },
    ],
    { duration: big ? 1700 : 1350, easing: 'linear' },
  );
}

/** 飘字：+N / -N */
function floatNum(p, text, kind = 'gain', o = {}) {
  const { delay = 0, size = 1 } = o;
  p = S(p);
  const el = node('zfx-num zfx-n-' + kind, esc(text));
  if (el) el.style.fontSize = Math.round(24 * size) + 'px';
  play(
    el,
    [
      { transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(0.4)`, opacity: 0, easing: 'cubic-bezier(.2,1.4,.4,1)' },
      { transform: `translate(${p.x}px, ${p.y - 20}px) translate(-50%, -50%) scale(1.25)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${p.x}px, ${p.y - 30}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${p.x}px, ${p.y - 60}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${p.x}px, ${p.y - 80}px) translate(-50%, -50%) scale(0.9)`, opacity: 0 },
    ],
    { duration: 1800, delay, easing: 'linear' },
  );
}

/**
 * 全屏横幅：kind = win / baozi / shunjin / allin / lose / info
 * o.count：副标题做数字滚动（例如 +1234 从 0 滚到 1234），o.prefix 是数字前缀
 */
function banner(title, sub = '', kind = 'win', o = {}) {
  const { dur = 2200, delay = 0, count = 0, prefix = '+' } = o;
  const el = node(
    'zfx-banner zfx-b-' + kind,
    '<div class="zfx-rays"></div><div class="zfx-bt">' + esc(title) + '</div>' + (sub || count ? '<div class="zfx-bs">' + esc(count ? prefix + '0' : sub) + '</div>' : ''),
  );
  if (el && count) {
    const bs = el.querySelector('.zfx-bs');
    const t0 = performance.now() + delay + dur * 0.12;
    const span = Math.min(1200, dur * 0.45);
    const step = (now) => {
      if (!el.isConnected) return;
      const k = Math.max(0, Math.min(1, (now - t0) / span));
      const e = 1 - Math.pow(1 - k, 3);
      bs.textContent = prefix + Math.round(count * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  play(
    el,
    [
      { transform: 'translate(-50%, -50%) scale(2.2)', opacity: 0, easing: 'cubic-bezier(.3,0,.4,1)' },
      { transform: 'translate(-50%, -50%) scale(0.92)', opacity: 1, offset: 0.12, easing: 'ease-out' },
      { transform: 'translate(-50%, -50%) scale(1.04)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.82 },
      { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0 },
    ],
    { duration: dur, delay, easing: 'linear' },
  );
}

/** 屏幕边缘闪光（红：孤注一掷；金：大赢） */
function flash(color = 'rgba(255,60,40,.55)', dur = 600) {
  const el = node('zfx-flash');
  if (!el) return;
  const k = Math.max(1, Math.min(2, Math.min(window.innerWidth, window.innerHeight) / 500));
  el.style.boxShadow = `inset 0 0 ${Math.round(120 * k)}px ${Math.round(30 * k)}px ${color}`;
  play(el, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
}

/** 全屏光晕：从中间亮起再散去（赢牌金光）；dark=true 时是四周压暗（输牌） */
function glow(color = 'rgba(255,200,60,.55)', dur = 1200, o = {}) {
  const { dark = false } = o;
  const el = node('zfx-glow');
  if (!el) return;
  el.style.background = dark
    ? `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 30%, ${color} 100%)`
    : `radial-gradient(ellipse at 50% 45%, ${color} 0%, rgba(0,0,0,0) 65%)`;
  play(el, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
}

/** 冲击波：一圈光环从一点扩散 */
function ring(p, color = 'rgba(255,214,110,.9)', size = 160, o = {}) {
  const { delay = 0 } = o;
  p = S(p);
  const el = node('zfx-ring');
  if (!el) return;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.margin = -size / 2 + 'px 0 0 ' + -size / 2 + 'px';
  el.style.borderColor = color;
  el.style.boxShadow = `0 0 18px ${color}, inset 0 0 12px ${color}`;
  play(
    el,
    [
      { transform: `translate(${p.x}px, ${p.y}px) scale(0.1)`, opacity: 1 },
      { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 0 },
    ],
    { duration: 650, delay, easing: 'cubic-bezier(.1,.7,.3,1)' },
  );
}

/** 一整摞筹码（竖着的筹码柱）从座位推到底池 */
function stack(from, to, n = 6, o = {}) {
  const { delay = 0, dur = 620, color = 0 } = o;
  from = S(from);
  to = S(to);
  let html = '';
  for (let k = 0; k < n; k++) html += '<i class="zfx-c' + ((color + k) % 4) + '" style="bottom:' + k * 4 + 'px"></i>';
  const el = node('zfx-stack', html);
  if (!el) return;
  el.style.height = 10 + n * 4 + 'px';
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - 20;
  play(
    el,
    [
      { transform: `translate(${from.x}px, ${from.y}px) scale(0.7) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${from.x}px, ${from.y}px) scale(1.15) rotate(-6deg)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${mx}px, ${my}px) scale(1.3) rotate(4deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(1) rotate(0deg)`, opacity: 1, offset: 0.9 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(0.9)`, opacity: 0 },
    ],
    { duration: dur, delay, easing: 'cubic-bezier(.3,.1,.3,1)' },
  );
}

/** 筹码落进底池后四下溅开、弹两下 */
function splash(p, n = 10, o = {}) {
  const { delay = 0, spread = 70, coin = false } = o;
  p = S(p);
  for (let k = 0; k < n; k++) {
    const el = node(coin ? 'zfx-coin' : 'zfx-chip zfx-c' + (k % 4), coin ? '<i></i>' : undefined);
    if (!el) break;
    const a = rand(0, Math.PI * 2);
    const r = rand(spread * 0.35, spread);
    const ex = p.x + Math.cos(a) * r;
    const ey = p.y + Math.sin(a) * r * 0.55;
    const up = rand(30, 70);
    const bx = ex + (ex - p.x) * 0.16;
    play(
      el,
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(0.8)`, opacity: 1 },
        { transform: `translate(${(p.x + ex) / 2}px, ${Math.min(p.y, ey) - up}px) scale(1.1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${ex}px, ${ey}px) scale(1)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${ex + (ex - p.x) * 0.1}px, ${ey - 10}px) scale(1)`, opacity: 1, offset: 0.74 },
        { transform: `translate(${bx}px, ${ey}px) scale(0.95)`, opacity: 1, offset: 0.86 },
        { transform: `translate(${bx}px, ${ey}px) scale(0.7)`, opacity: 0 },
      ],
      { duration: rand(800, 1050), delay: delay + rand(0, 60), easing: 'linear' },
    );
  }
}

/** 金币喷泉：从一点往上喷，再四散落下 */
function fountain(p, n = 30, o = {}) {
  const { delay = 0, h = window.innerHeight } = o;
  p = S(p);
  for (let k = 0; k < n; k++) {
    const el = node('zfx-coin', '<i></i>');
    if (!el) break;
    const vx = rand(-1, 1) * rand(80, 260);
    const top = p.y - rand(160, 360);
    const end = Math.min(h + 40, p.y + rand(60, 260));
    const s = rand(0.8, 1.3);
    play(
      el,
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(${s * 0.5})`, opacity: 0 },
        { transform: `translate(${p.x + vx * 0.2}px, ${p.y - (p.y - top) * 0.6}px) scale(${s})`, opacity: 1, offset: 0.15, easing: 'cubic-bezier(.2,.6,.4,1)' },
        { transform: `translate(${p.x + vx * 0.55}px, ${top}px) scale(${s}) rotate(${rand(-180, 180)}deg)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(.5,0,.9,.5)' },
        { transform: `translate(${p.x + vx}px, ${end}px) scale(${s}) rotate(${rand(-360, 360)}deg)`, opacity: 0 },
      ],
      { duration: rand(1300, 1800), delay: delay + k * 22, easing: 'linear' },
    );
  }
}

const CONFETTI = ['#ff4d4d', '#ffd23f', '#3fd0ff', '#5ff08a', '#ff8af0', '#ffa53f', '#ffffff'];
/** 彩带：从屏幕左下、右下两个角喷出，飘落 */
function confetti(n = 60, o = {}) {
  const { delay = 0, w = window.innerWidth, h = window.innerHeight } = o;
  for (let k = 0; k < n; k++) {
    const el = node('zfx-conf');
    if (!el) break;
    el.style.background = CONFETTI[k % CONFETTI.length];
    if (k % 3 === 0) el.style.borderRadius = '50%';
    const left = k % 2 === 0;
    const sx = left ? rand(-10, w * 0.08) : rand(w * 0.92, w + 10);
    const sy = h + 10;
    const px = left ? rand(w * 0.1, w * 0.6) : rand(w * 0.4, w * 0.9);
    const py = rand(h * 0.05, h * 0.45);
    const ex = px + rand(-80, 80);
    const ey = h + 30;
    const r = rand(360, 1080) * (rand(0, 1) > 0.5 ? 1 : -1);
    play(
      el,
      [
        { transform: `translate(${sx}px, ${sy}px) rotate(0deg) rotateX(0deg)`, opacity: 1 },
        { transform: `translate(${px}px, ${py}px) rotate(${r * 0.3}deg) rotateX(${r}deg)`, opacity: 1, offset: 0.3, easing: 'cubic-bezier(.3,0,.7,1)' },
        { transform: `translate(${(px + ex) / 2 + rand(-40, 40)}px, ${(py + ey) / 2}px) rotate(${r * 0.6}deg) rotateX(${r * 2}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(${ex}px, ${ey}px) rotate(${r}deg) rotateX(${r * 3}deg)`, opacity: 0.8 },
      ],
      { duration: rand(2200, 3200), delay: delay + rand(0, 250), easing: 'cubic-bezier(.15,.6,.5,1)' },
    );
  }
}

/** 牌桌中央的一摞牌（发牌期间显示） */
function deck(p, ms = 2000) {
  p = S(p);
  const el = node('zfx-deck', '<i></i><i></i><i></i><i></i>');
  play(
    el,
    [
      { transform: `translate(${p.x}px, ${p.y}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: Math.min(0.2, 250 / ms) },
      { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: Math.max(0.8, 1 - 300 / ms) },
      { transform: `translate(${p.x}px, ${p.y}px) scale(0.7)`, opacity: 0 },
    ],
    { duration: ms, easing: 'linear' },
  );
}

/**
 * 发一张牌：牌背从牌堆沿弧线滑到落点，边走边转，落下时轻轻一顿
 * o.w：牌的宽度（落地时的大小）；o.s0：起飞时相对 w 的缩放；o.exact：落地角度正好是 spin（发到自己手里时对齐手牌）
 */
function card(from, to, o = {}) {
  const { delay = 0, dur = 420, w = 22, keep = 220, spin = 0, s0 = 1, exact = false } = o;
  from = S(from);
  to = S(to);
  const el = node('zfx-card');
  if (!el) return;
  el.style.width = w + 'px';
  el.style.height = Math.round(w * 1.4) + 'px';
  el.style.margin = `${-Math.round(w * 0.7)}px 0 0 ${-Math.round(w / 2)}px`;
  if (w > 40) el.classList.add('zfx-card-big');
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - 24;
  const r0 = rand(-30, 30);
  const r1 = exact ? spin : spin + rand(-12, 12);
  const s1 = exact ? 1 : 0.92;
  const sm = ((s0 + s1) / 2) * 1.05;
  const total = dur + keep;
  play(
    el,
    [
      { transform: `translate(${from.x}px, ${from.y}px) rotate(${r0}deg) scale(${s0 * 0.9})`, opacity: 0, easing: 'ease-out' },
      { transform: `translate(${from.x}px, ${from.y}px) rotate(${r0}deg) scale(${s0})`, opacity: 1, offset: 0.06, easing: 'cubic-bezier(.3,.6,.4,1)' },
      { transform: `translate(${mx}px, ${my}px) rotate(${(r0 + r1) / 2 + 180}deg) scale(${sm})`, opacity: 1, offset: (dur * 0.5) / total, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `translate(${to.x}px, ${to.y}px) rotate(${r1 + 360}deg) scale(${s1})`, opacity: 1, offset: dur / total },
      { transform: `translate(${to.x}px, ${to.y}px) rotate(${r1 + 360}deg) scale(${s1})`, opacity: 1, offset: 0.97 },
      { transform: `translate(${to.x}px, ${to.y}px) rotate(${r1 + 360}deg) scale(${s1})`, opacity: 0 },
    ],
    { duration: total, delay, easing: 'linear' },
  );
}

/* ---------------- 互动道具 ---------------- */
// 二次贝塞尔曲线上的点
const bez = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
/** 一个 emoji 元素：frames 里的 transform 不含居中偏移（样式里用 margin 居中） */
function emo(ch, frames, opts, size = 34) {
  const el = node('zfx-emo', esc(ch));
  if (!el) return null;
  el.style.fontSize = size + 'px';
  return play(el, frames, opts);
}
/** 一团圆形色块（鸡蛋、番茄砸开的汁、炸弹的烟灰） */
function blob(p, size, bg, frames, opts) {
  const el = node('zfx-blob');
  if (!el) return;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.margin = -size / 2 + 'px 0 0 ' + -size / 2 + 'px';
  el.style.background = bg;
  play(el, frames(p), opts);
}
/** 若干 emoji 从一点向四周飞散（花瓣、爱心、碎片） */
function scatter(p, chars, n, o = {}) {
  const { r0 = 20, r1 = 70, up = 0, size = 20, dur = 900, delay = 0 } = o;
  for (let k = 0; k < n; k++) {
    const a = (Math.PI * 2 * k) / n + rand(-0.3, 0.3);
    const r = rand(r0, r1);
    const ex = p.x + Math.cos(a) * r;
    const ey = p.y + Math.sin(a) * r * 0.8 - up;
    emo(
      chars[k % chars.length],
      [
        { transform: `translate(${p.x}px, ${p.y}px) scale(0.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${(p.x + ex) / 2}px, ${(p.y + ey) / 2 - 10}px) scale(1.1) rotate(${rand(-60, 60)}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.8) rotate(${rand(-120, 120)}deg)`, opacity: 0 },
      ],
      { duration: dur + rand(-120, 160), delay: delay + rand(0, 80), easing: 'cubic-bezier(.15,.7,.4,1)' },
      size,
    );
  }
}
// 砸开的汁：先“啪”地摊开，停一会儿，再往下淌着消失
const smashFrames = (p) => [
  { transform: `translate(${p.x}px, ${p.y}px) scale(0.2)`, opacity: 0 },
  { transform: `translate(${p.x}px, ${p.y}px) scale(1.18)`, opacity: 1, offset: 0.07 },
  { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: 0.13 },
  { transform: `translate(${p.x}px, ${p.y + 6}px) scale(1, 1.06)`, opacity: 0.95, offset: 0.7 },
  { transform: `translate(${p.x}px, ${p.y + 18}px) scale(0.92, 1.18)`, opacity: 0 },
];

/**
 * 互动道具：道具从 from 沿弧线飞到 to（边飞边转），落到头像上播命中效果
 * @param {string} kind flower / kiss / beer / like / egg / tomato / bomb
 * @param {{icon:string, fly?:number, fuse?:number, size?:number}} o size：头像直径
 */
function prop(from, to, kind, o = {}) {
  const { icon = '🎁', fly = 720, fuse = 650, size = 48 } = o;
  // 换算成屏幕坐标后标上 abs，后面再传给 ring / burst 时不会被重复换算
  from = { ...S(from), abs: true };
  to = { ...S(to), abs: true };
  const spin = { egg: 620, tomato: 480, bomb: 300, flower: 30 }[kind] || 0;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - Math.max(50, dist * 0.32);
  const frames = [];
  const N = 8;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const s = 0.7 + Math.sin(Math.PI * t) * 0.65; // 飞到最高处最大，像是朝屏幕飞过来
    frames.push({
      transform: `translate(${bez(from.x, cx, to.x, t)}px, ${bez(from.y, cy, to.y, t)}px) scale(${s}) rotate(${spin * t}deg)`,
      opacity: k === 0 ? 0 : 1,
      offset: t,
    });
  }
  frames[N].opacity = kind === 'bomb' ? 0 : 1;
  emo(icon, frames, { duration: fly, easing: 'cubic-bezier(.35,.1,.55,1)' }, 34);
  const at = (fn, ms) => setTimeout(fn, ms);
  const d = Math.max(36, size);

  at(() => {
    switch (kind) {
      case 'egg':
        blob(to, d * 1.3, 'radial-gradient(circle at 46% 44%, #ffc928 0 24%, #ffe27a 27%, #fffaf0 31% 58%, rgba(255,250,240,0) 62%)', smashFrames, { duration: 1900, easing: 'ease-out' });
        scatter(to, ['🥚'], 3, { r0: 26, r1: 50, size: 12, dur: 600 });
        burst(to, 10, '#fff4d6');
        break;
      case 'tomato':
        blob(to, d * 1.35, 'radial-gradient(circle at 50% 50%, #ff4a36 0 30%, #e0261a 44%, rgba(200,20,10,.85) 52%, rgba(200,20,10,0) 64%)', smashFrames, { duration: 1900, easing: 'ease-out' });
        burst(to, 14, '#ff3b2f');
        burst(to, 6, '#ffd166');
        break;
      case 'flower':
        scatter(to, ['🌸', '🌹', '🌸'], 9, { r0: 30, r1: 80, size: 18, dur: 1100 });
        scatter(to, ['💕'], 3, { r0: 10, r1: 30, up: 50, size: 18, dur: 1200, delay: 150 });
        ring(to, 'rgba(255,120,170,.9)', d * 2.6);
        break;
      case 'kiss':
        emo('💋', [
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.3) rotate(-15deg)`, opacity: 0 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(1.5) rotate(-8deg)`, opacity: 1, offset: 0.15 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(1.2) rotate(-8deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${to.x}px, ${to.y - 6}px) scale(1.2) rotate(-8deg)`, opacity: 0 },
        ], { duration: 1300, easing: 'ease-out' }, 30);
        for (let k = 0; k < 6; k++) {
          const x = to.x + rand(-d * 0.6, d * 0.6);
          emo('❤️', [
            { transform: `translate(${x}px, ${to.y}px) scale(0.3)`, opacity: 0 },
            { transform: `translate(${x + rand(-10, 10)}px, ${to.y - 30}px) scale(1)`, opacity: 1, offset: 0.3 },
            { transform: `translate(${x + rand(-20, 20)}px, ${to.y - 90 - rand(0, 30)}px) scale(0.7)`, opacity: 0 },
          ], { duration: 1300 + rand(0, 300), delay: 120 + k * 90, easing: 'ease-out' }, 16);
        }
        break;
      case 'beer': {
        // 两只杯子从两边碰到一起，溅起泡沫
        const g = d * 0.45;
        for (const side of [-1, 1]) {
          emo('🍺', [
            { transform: `translate(${to.x + side * g * 2}px, ${to.y}px) scale(0.8) rotate(0deg)`, opacity: 0 },
            { transform: `translate(${to.x + side * g * 0.55}px, ${to.y - 6}px) scale(1.15) rotate(${-side * 22}deg)`, opacity: 1, offset: 0.25 },
            { transform: `translate(${to.x + side * g * 0.8}px, ${to.y - 2}px) scale(1.05) rotate(${-side * 8}deg)`, opacity: 1, offset: 0.4 },
            { transform: `translate(${to.x + side * g * 0.8}px, ${to.y - 2}px) scale(1.05) rotate(${-side * 8}deg)`, opacity: 1, offset: 0.8 },
            { transform: `translate(${to.x + side * g}px, ${to.y + 4}px) scale(0.9)`, opacity: 0 },
          ], { duration: 1400, easing: 'ease-out' }, 30);
        }
        scatter({ x: to.x, y: to.y - 18 }, ['🫧', '✨'], 8, { r0: 14, r1: 44, up: 30, size: 12, dur: 900, delay: 320 });
        break;
      }
      case 'like':
        emo('👍', [
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.3)`, opacity: 0 },
          { transform: `translate(${to.x}px, ${to.y - 24}px) scale(1.9)`, opacity: 1, offset: 0.18, easing: 'cubic-bezier(.2,1.4,.4,1)' },
          { transform: `translate(${to.x}px, ${to.y - 30}px) scale(1.4)`, opacity: 1, offset: 0.75 },
          { transform: `translate(${to.x}px, ${to.y - 44}px) scale(1.2)`, opacity: 0 },
        ], { duration: 1300, easing: 'linear' }, 30);
        burst(to, 14, '#ffd56b');
        ring(to, 'rgba(255,214,110,.95)', d * 2.4);
        break;
      case 'bomb': {
        // 落地后滋滋冒火星地抖一会儿，再“轰”
        emo('💣', (() => {
          const fr = [];
          const n = 10;
          for (let k = 0; k <= n; k++) {
            const j = k === n ? 0 : rand(-4, 4);
            fr.push({ transform: `translate(${to.x + j}px, ${to.y + (k % 2 ? -2 : 1)}px) scale(${1 + (k / n) * 0.35}) rotate(${j * 3}deg)`, opacity: 1, offset: k / n });
          }
          return fr;
        })(), { duration: fuse, easing: 'linear' }, 34);
        for (let k = 0; k < 6; k++) at(() => burst({ x: to.x + 10, y: to.y - 16, abs: true }, 4, '#ffd23f'), k * (fuse / 6));
        at(() => {
          emo('💥', [
            { transform: `translate(${to.x}px, ${to.y}px) scale(0.3)`, opacity: 1 },
            { transform: `translate(${to.x}px, ${to.y}px) scale(2.6)`, opacity: 1, offset: 0.3 },
            { transform: `translate(${to.x}px, ${to.y}px) scale(3.2)`, opacity: 0 },
          ], { duration: 650, easing: 'ease-out' }, 40);
          ring(to, 'rgba(255,140,40,.95)', d * 3.4);
          ring(to, 'rgba(255,60,30,.8)', d * 4.4, { delay: 90 });
          burst(to, 20, '#ff8a2a');
          burst(to, 10, '#ffd23f');
          for (let k = 0; k < 6; k++) {
            const a = rand(0, Math.PI * 2);
            const r = rand(20, 50);
            blob(
              { x: to.x + Math.cos(a) * r * 0.4, y: to.y + Math.sin(a) * r * 0.4 },
              rand(30, 52),
              'radial-gradient(circle, rgba(80,80,80,.7), rgba(80,80,80,0) 70%)',
              (p) => [
                { transform: `translate(${p.x}px, ${p.y}px) scale(0.3)`, opacity: 0.9 },
                { transform: `translate(${p.x + Math.cos(a) * r}px, ${p.y + Math.sin(a) * r - 30}px) scale(1.6)`, opacity: 0 },
              ],
              { duration: 1100 + rand(0, 400), delay: 60 + k * 40, easing: 'ease-out' },
            );
          }
          // 头像被熏黑一会儿
          blob(to, d * 1.15, 'radial-gradient(circle, rgba(25,22,20,.82) 0 42%, rgba(25,22,20,0) 68%)', (p) => [
            { transform: `translate(${p.x}px, ${p.y}px) scale(0.6)`, opacity: 0 },
            { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: 0.1 },
            { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 0.9, offset: 0.7 },
            { transform: `translate(${p.x}px, ${p.y + 6}px) scale(1.05)`, opacity: 0 },
          ], { duration: 1800, easing: 'ease-out' });
          flash('rgba(255,120,30,.45)', 500);
        }, fuse);
        break;
      }
      default:
        burst(to, 12);
    }
  }, fly);
}

defineExpose({ chips, rain, burst, callout, floatNum, banner, flash, deck, card, glow, ring, stack, splash, fountain, confetti, prop });
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="zfx-root"></div>
  </Teleport>
</template>

<style>
/* 特效元素由脚本动态创建，所以这里不用 scoped，统一加 zfx- 前缀 */
.zfx-root {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 900; /* 在牌桌之上、弹窗（1000）之下 */
  pointer-events: none;
  overflow: hidden;
}
.zfx-root > * {
  position: absolute;
  left: 0;
  top: 0;
}
.zfx-chip,
.zfx-coin,
.zfx-spark {
  will-change: transform, opacity;
}
/* 互动道具：emoji 与砸开的色块 */
.zfx-emo {
  width: 1em;
  height: 1em;
  margin: -0.5em 0 0 -0.5em;
  font-size: 34px;
  line-height: 1;
  text-align: center;
  will-change: transform, opacity;
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
}
.zfx-blob {
  border-radius: 50%;
  will-change: transform, opacity;
}
.zfx-chip {
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.5), inset 0 0 0 2px rgba(255, 255, 255, 0.85);
}
.zfx-c0 {
  background: radial-gradient(circle, #e8463a 0 38%, #fff 40% 46%, #e8463a 48%);
}
.zfx-c1 {
  background: radial-gradient(circle, #2f7fd6 0 38%, #fff 40% 46%, #2f7fd6 48%);
}
.zfx-c2 {
  background: radial-gradient(circle, #2f9e5b 0 38%, #fff 40% 46%, #2f9e5b 48%);
}
.zfx-c3 {
  background: radial-gradient(circle, #222 0 38%, #f0c24f 40% 46%, #222 48%);
}
.zfx-glow {
  position: fixed !important;
  left: 0 !important;
  top: 0 !important;
  right: 0;
  bottom: 0;
  z-index: 48;
}
.zfx-ring {
  border: 4px solid;
  border-radius: 50%;
  will-change: transform, opacity;
}
.zfx-stack {
  width: 22px;
  margin: -14px 0 0 -11px;
  will-change: transform, opacity;
  filter: drop-shadow(0 4px 4px rgba(0, 0, 0, 0.5));
}
.zfx-stack i {
  position: absolute;
  left: 0;
  width: 22px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.85), 0 1px 0 rgba(0, 0, 0, 0.5);
}
.zfx-conf {
  width: 9px;
  height: 14px;
  margin: -7px 0 0 -4px;
  will-change: transform, opacity;
}
.zfx-coin {
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
}
.zfx-coin.zfx-big {
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
}
.zfx-coin i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff6c8 0%, #ffd34d 35%, #e0a316 70%, #9c6a08 100%);
  box-shadow: inset 0 0 0 2px rgba(255, 240, 180, 0.8), inset 0 0 0 4px rgba(156, 106, 8, 0.6), 0 2px 4px rgba(0, 0, 0, 0.45);
  animation: zfx-flip 0.5s linear infinite;
}
@keyframes zfx-flip {
  0%,
  100% {
    transform: scaleX(1);
  }
  50% {
    transform: scaleX(0.15);
  }
}
.zfx-spark {
  width: 7px;
  height: 7px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  box-shadow: 0 0 8px 2px rgba(255, 214, 110, 0.9);
}
.zfx-call {
  padding: 3px 12px;
  font-size: 15px;
  font-weight: 900;
  white-space: nowrap;
  color: #fff;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  z-index: 2;
}
.zfx-bigcall {
  font-size: 20px;
  padding: 4px 16px;
}
.zfx-k-call {
  background: linear-gradient(180deg, #4fd286, #22894d);
}
.zfx-k-raise {
  color: #3a2603;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
  background: linear-gradient(180deg, #fff0b0, #f6b93a 55%, #e07a12);
  border-color: #fff4cf;
  box-shadow: 0 0 18px rgba(255, 170, 40, 0.8), 0 4px 12px rgba(0, 0, 0, 0.5);
}
.zfx-k-look {
  background: linear-gradient(180deg, #6bb6ff, #2867c4);
}
.zfx-k-fold {
  background: linear-gradient(180deg, #7b8794, #4a5560);
}
.zfx-k-compare {
  background: linear-gradient(180deg, #ff7f6b, #c0392b);
}
.zfx-k-allin {
  background: linear-gradient(180deg, #ff5a3a, #9c1408);
  box-shadow: 0 0 22px rgba(255, 60, 20, 0.9), 0 4px 12px rgba(0, 0, 0, 0.5);
}
.zfx-k-info {
  background: rgba(0, 0, 0, 0.7);
}
.zfx-num {
  font-weight: 900;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  z-index: 3;
}
.zfx-n-gain {
  color: #fff3b0;
  text-shadow: 0 0 10px #ffb200, 0 0 2px #ffb200, 0 3px 0 #8a5a00, 0 4px 6px rgba(0, 0, 0, 0.6);
}
.zfx-n-loss {
  color: #ffb4a6;
  text-shadow: 0 2px 0 #7a1a10, 0 3px 6px rgba(0, 0, 0, 0.6);
}
.zfx-n-rebuy {
  color: #c9ffdf;
  text-shadow: 0 0 8px #2fbf6b, 0 2px 0 #145c33;
}
.zfx-banner {
  position: fixed !important;
  left: 50% !important;
  top: 44% !important;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: clamp(320px, 62vmin, 620px);
  height: clamp(320px, 62vmin, 620px);
}
.zfx-rays {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: repeating-conic-gradient(rgba(255, 220, 120, 0.42) 0 10deg, rgba(255, 220, 120, 0) 10deg 24deg);
  -webkit-mask-image: radial-gradient(circle, #000 0, #000 30%, transparent 70%);
  mask-image: radial-gradient(circle, #000 0, #000 30%, transparent 70%);
  animation: zfx-spin 6s linear infinite;
}
@keyframes zfx-spin {
  to {
    transform: rotate(360deg);
  }
}
.zfx-banner::before {
  content: '';
  position: absolute;
  left: 8%;
  top: 22%;
  width: 84%;
  height: 56%;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(20, 8, 0, 0.72) 0%, rgba(20, 8, 0, 0.45) 45%, rgba(20, 8, 0, 0) 72%);
}
.zfx-bt {
  position: relative;
  font-size: clamp(54px, 9vmin, 100px);
  font-weight: 900;
  letter-spacing: 6px;
  text-indent: 6px;
  white-space: nowrap;
  font-family: 'STKaiti', 'KaiTi', 'Kaiti SC', serif;
  color: #ffe27a;
  text-shadow: 0 2px 0 #c77a12, 0 4px 0 #7a4200, 0 6px 10px rgba(0, 0, 0, 0.6), 0 0 26px rgba(255, 180, 40, 0.95);
}
.zfx-bs {
  position: relative;
  margin-top: 6px;
  padding: 2px 18px;
  font-size: clamp(20px, 3vmin, 32px);
  font-weight: 900;
  color: #3a2603;
  background: linear-gradient(180deg, #fff0b0, #f0c24f);
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}
.zfx-b-baozi .zfx-bt,
.zfx-b-allin .zfx-bt {
  color: #fff0a0;
  text-shadow: 0 2px 0 #e0461a, 0 4px 0 #7a1200, 0 6px 10px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 70, 20, 1), 0 0 60px rgba(255, 120, 30, 0.7);
}
.zfx-b-baozi .zfx-rays,
.zfx-b-allin .zfx-rays {
  background: repeating-conic-gradient(rgba(255, 120, 40, 0.5) 0 10deg, rgba(255, 120, 40, 0) 10deg 24deg);
}
.zfx-b-shunjin .zfx-bt {
  color: #ffffff;
  text-shadow: 0 2px 0 #2f7fd6, 0 4px 0 #123a6a, 0 6px 10px rgba(0, 0, 0, 0.6), 0 0 28px rgba(80, 170, 255, 1);
}
.zfx-b-lose .zfx-bt {
  color: #d9dedb;
  text-shadow: 0 3px 0 #222, 0 6px 10px rgba(0, 0, 0, 0.6);
}
.zfx-b-lose .zfx-rays {
  display: none;
}
.zfx-b-lose .zfx-bs {
  color: #e9eeec;
  background: linear-gradient(180deg, #6d7874, #3e4744);
}
.zfx-b-lose::before {
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.35) 45%, rgba(0, 0, 0, 0) 72%);
}
.zfx-flash {
  position: fixed !important;
  left: 0 !important;
  top: 0 !important;
  right: 0;
  bottom: 0;
  z-index: 49;
}
.zfx-card-big {
  border-radius: 6px !important;
  border-width: 3px !important;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.55) !important;
}
.zfx-card,
.zfx-deck i {
  border-radius: 3px;
  background-color: #7d1426;
  background-image: repeating-linear-gradient(45deg, rgba(240, 200, 110, 0.3) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(-45deg, rgba(240, 200, 110, 0.3) 0 1px, transparent 1px 4px);
  border: 2px solid #fbf3df;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.5);
  will-change: transform, opacity;
}
.zfx-deck {
  width: 30px;
  height: 42px;
  margin: -21px 0 0 -15px;
}
.zfx-deck i {
  position: absolute;
  left: 0;
  top: 0;
  width: 30px;
  height: 42px;
}
.zfx-deck i:nth-child(2) {
  transform: translate(-1px, -2px);
}
.zfx-deck i:nth-child(3) {
  transform: translate(-2px, -4px);
}
.zfx-deck i:nth-child(4) {
  transform: translate(-3px, -6px);
}
@media (prefers-reduced-motion: reduce) {
  .zfx-rays,
  .zfx-coin i {
    animation: none;
  }
}
</style>
