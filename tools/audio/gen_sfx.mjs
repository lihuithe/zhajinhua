// 音效与背景音乐合成：纯代码生成，无第三方素材 → client/public/audio/{sfx/*.mp3, sfx/tension.json, bgm.mp3, bgm.json}
// 用法（项目根目录）：node tools/audio/gen_sfx.mjs   依赖 ffmpeg
//   --only=a,b,c 只生成列出的音效；--sfx-only 跳过 bgm；--bgm-only 只生成 bgm
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'client/public/audio');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zjh-sfx-'));
const SR = 44100;

/* ---------------- 基础工具 ---------------- */
let seed = 20261023;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
const buf = (sec, sr = SR) => new Float32Array(Math.ceil(sec * sr));
function mixInto(dst, src, at, gain = 1, sr = SR) {
  const o = Math.round(at * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
}
function normalize(b, peak = 0.89) {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}
function fadeOut(b, sec, sr = SR) {
  const n = Math.min(b.length, Math.round(sec * sr));
  for (let i = 0; i < n; i++) b[b.length - 1 - i] *= i / n;
  return b;
}

// 二阶带通 / 低通 / 高通（RBJ），f 可以是随时间变化的函数
function biquad(input, type, fFn, q = 0.9, sr = SR) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const f = typeof fFn === 'function' ? fFn(i / sr) : fFn;
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const a = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    let b0, b1, b2;
    if (type === 'bp') [b0, b1, b2] = [a, 0, -a];
    else if (type === 'lp') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    const x = input[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
function noise(sec, sr = SR) {
  const b = buf(sec, sr);
  for (let i = 0; i < b.length; i++) b[i] = rnd() * 2 - 1;
  return b;
}
// 包络：attack 线性起，指数衰减
function envExp(b, attack, tau, sr = SR) {
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] *= (t < attack ? t / attack : 1) * Math.exp(-(t - Math.min(t, attack)) / tau);
  }
  return b;
}
// 正弦（可扫频）
function tone(sec, f0, f1 = f0, sr = SR) {
  const b = buf(sec, sr);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const f = f0 * Math.pow(f1 / f0, i / b.length);
    ph += (2 * Math.PI * f) / sr;
    b[i] = Math.sin(ph);
  }
  return b;
}
// 钟 / 金属：一组分音各自衰减
function bell(freq, sec, partials, sr = SR) {
  const b = buf(sec, sr);
  for (const [ratio, amp, tau] of partials) {
    const ph0 = rnd() * 6.28;
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      b[i] += amp * Math.sin(ph0 + 2 * Math.PI * freq * ratio * t) * Math.exp(-t / tau) * Math.min(1, t / 0.002);
    }
  }
  return b;
}
// 简易混响：4 个梳状 + 2 个全通（Schroeder）
function reverb(input, mix = 0.25, room = 0.82, sr = SR) {
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round((d * sr) / 44100));
  const out = new Float32Array(input.length);
  for (const d of combs) {
    const line = new Float32Array(d);
    let idx = 0, lp = 0;
    for (let i = 0; i < input.length; i++) {
      const y = line[idx];
      lp = y * 0.7 + lp * 0.3;
      line[idx] = input[i] + lp * room;
      idx = (idx + 1) % d;
      out[i] += y / combs.length;
    }
  }
  for (const d of [225, 556].map((x) => Math.round((x * sr) / 44100))) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const bv = line[idx];
      const y = -out[i] * 0.5 + bv;
      line[idx] = out[i] + bv * 0.5;
      idx = (idx + 1) % d;
      out[i] = y;
    }
  }
  const res = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) res[i] = input[i] * (1 - mix) + out[i] * mix * 2.2;
  return res;
}

function writeWav(file, data, sr = SR) {
  const n = data.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}
function toMp3(name, data, { sr = SR, br = '96k', dir = 'sfx' } = {}) {
  const wav = path.join(TMP, name + '.wav');
  writeWav(wav, data, sr);
  const out = path.join(OUT, dir, name + '.mp3');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', br, out]);
  console.log(path.relative(ROOT, out), (data.length / sr).toFixed(2) + 's', fs.statSync(out).size + 'B');
}

/* ---------------- 音效零件 ---------------- */
// 筹码碰撞：陶瓷质感的高频分音 + 噪声瞬态
function clink(pitch = 1, amp = 1) {
  const b = bell(1, 0.25, [
    [3150 * pitch, 0.5, 0.035],
    [4420 * pitch, 0.35, 0.028],
    [5980 * pitch, 0.25, 0.02],
    [7300 * pitch, 0.15, 0.015],
  ]);
  const n = envExp(biquad(noise(0.02), 'hp', 2500), 0.0005, 0.004);
  mixInto(b, n, 0, 0.6);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}
// 陶土筹码相撞：短促厚实的“咔嗒”（比金属的 clink 低、更有肉），用在推筹码上
function clack(pitch = 1, amp = 1) {
  const b = bell(1, 0.12, [
    [1750 * pitch, 0.6, 0.02],
    [2550 * pitch, 0.5, 0.016],
    [3600 * pitch, 0.38, 0.012],
    [4900 * pitch, 0.22, 0.008],
  ]);
  mixInto(b, envExp(biquad(noise(0.035), 'bp', 2900 * pitch, 0.7), 0.0003, 0.007), 0, 1.1);
  mixInto(b, envExp(tone(0.05, 620 * pitch, 480 * pitch), 0.0005, 0.01), 0, 0.45);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}
// 一把筹码“哗啦啦”：n 枚碰撞按密度包络撒开（先密后疏），再叠一层细碎的沙沙声
function cascade(sec, n, at0 = 0, amp = 1) {
  const b = buf(sec + 0.2);
  for (let k = 0; k < n; k++) {
    const t = at0 + Math.pow(rnd(), 1.7) * sec;
    mixInto(b, clack(0.8 + rnd() * 0.45, (0.35 + rnd() * 0.65) * amp), t);
  }
  const r = biquad(noise(sec), 'bp', 3800, 0.6);
  for (let i = 0; i < r.length; i++) {
    const t = i / SR;
    const grain = rnd() < 0.08 ? 1 : 0.15;
    r[i] *= grain * Math.exp(-t / (sec * 0.45)) * 0.5 * amp;
  }
  mixInto(b, r, at0, 1);
  return b;
}
// 软压缩（tanh）：把瞬态压一压、整体响度提上来，听起来更“实”
function squash(b, drive = 2.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / k;
  return b;
}
// 筹码在绒布桌面上推过去的滑动声
function slide(sec, amp = 1) {
  const n = biquad(noise(sec), 'lp', (t) => 700 + 1500 * (t / sec), 0.7);
  for (let i = 0; i < n.length; i++) n[i] *= Math.sin((Math.PI * i) / n.length) * amp;
  return n;
}
// 纸牌划过：带通噪声扫频
function swish(dur = 0.08, f0 = 1500, f1 = 4500, amp = 1) {
  const n = noise(dur);
  const b = biquad(n, 'bp', (t) => f0 * Math.pow(f1 / f0, t / dur), 1.2);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] *= amp * Math.sin(Math.PI * Math.min(1, t / dur)) ** 1.5;
  }
  return b;
}
function tap(f = 700, amp = 1) {
  const b = envExp(tone(0.03, f, f * 0.7), 0.0005, 0.006);
  const n = envExp(biquad(noise(0.02), 'bp', 2200, 1.5), 0.0005, 0.004);
  mixInto(b, n, 0, 0.8);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}
function impact(sec = 0.9) {
  const b = envExp(tone(sec, 90, 38), 0.002, 0.18);
  mixInto(b, envExp(biquad(noise(0.25), 'lp', 1800), 0.001, 0.04), 0, 0.9);
  mixInto(b, bell(1, sec, [[520, 0.25, 0.25], [1236, 0.15, 0.18], [1873, 0.1, 0.12], [2630, 0.06, 0.08]]), 0, 1);
  return b;
}
function gongHit(base = 98, sec = 2.6) {
  const parts = [
    [1, 0.5, 1.6], [1.52, 0.35, 1.3], [1.97, 0.3, 1.1], [2.44, 0.22, 0.9], [2.98, 0.18, 0.7],
    [3.53, 0.14, 0.55], [4.12, 0.1, 0.45], [5.06, 0.07, 0.35], [6.3, 0.05, 0.25],
  ];
  const b = buf(sec);
  for (const [r, a, tau] of parts) {
    const ph0 = rnd() * 6.28;
    let ph = ph0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const f = base * r * (1 + 0.012 * (1 - Math.exp(-t / 0.4))); // 锣声音高微微上扬
      ph += (2 * Math.PI * f) / SR;
      b[i] += a * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.004);
    }
  }
  mixInto(b, envExp(biquad(noise(0.3), 'bp', 900, 0.6), 0.001, 0.05), 0, 0.5);
  return reverb(b, 0.3, 0.84);
}
function bellNote(f, sec = 1.2, amp = 1) {
  const b = bell(f, sec, [[1, 0.6, 0.5], [2.0, 0.25, 0.25], [3.01, 0.12, 0.14], [4.2, 0.06, 0.08]]);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

// 铜管：锯齿波（加法合成）+ 滤波包络逐渐打开 + 轻微颤音
function brass(freq, sec, amp = 1) {
  const b = buf(sec);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, Math.max(0, (t - 0.15) / 0.2));
    let v = 0;
    for (let h = 1; h <= 14; h++) v += Math.sin(2 * Math.PI * freq * h * vib * t) / h;
    const env = Math.min(1, t / 0.04) * (t < sec - 0.12 ? 1 : Math.max(0, (sec - t) / 0.12));
    b[i] = v * env * amp * 0.5;
  }
  return biquad(b, 'lp', (t) => 700 + 3200 * Math.min(1, t / 0.12), 0.8);
}
// 低沉的鼓：心跳 / 轰鸣用
function thump(f0 = 70, sec = 0.25, amp = 1) {
  const b = envExp(tone(sec, f0, f0 * 0.6), 0.003, sec * 0.35);
  mixInto(b, envExp(biquad(noise(0.04), 'lp', 400), 0.001, 0.01), 0, 0.4);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}
function snare(amp = 1) {
  const b = envExp(biquad(noise(0.12), 'bp', 2400, 0.7), 0.0008, 0.035);
  mixInto(b, envExp(tone(0.08, 220, 180), 0.001, 0.02), 0, 0.5);
  for (let i = 0; i < b.length; i++) b[i] *= amp;
  return b;
}

/* ---------------- 音效 ---------------- */
const SFX = {
  click() {
    const b = envExp(tone(0.06, 1500, 900), 0.001, 0.012);
    mixInto(b, envExp(biquad(noise(0.01), 'hp', 3000), 0.0005, 0.002), 0, 0.3);
    return normalize(b, 0.5);
  },
  chip() {
    const b = buf(0.3);
    mixInto(b, clink(1, 1), 0);
    mixInto(b, clink(1.06, 0.6), 0.045);
    return normalize(b, 0.75);
  },
  // 普通跟注：推一小把，哗啦一下
  chips() {
    const b = buf(0.8);
    mixInto(b, slide(0.18, 0.5), 0);
    mixInto(b, cascade(0.35, 10, 0.1, 1), 0);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.08), 0.95), 2.6), 0.95), 0.1);
  },
  deal() {
    const b = buf(0.95);
    for (let k = 0; k < 6; k++) {
      const at = k * 0.13;
      mixInto(b, swish(0.075, 1400 + rnd() * 300, 4800, 0.9), at);
      mixInto(b, tap(650 + rnd() * 120, 0.35), at + 0.07);
    }
    return normalize(b, 0.7);
  },
  flip() {
    const b = buf(0.22);
    mixInto(b, swish(0.06, 2500, 6000, 0.8), 0);
    mixInto(b, tap(900, 0.9), 0.07);
    return normalize(b, 0.7);
  },
  fold() {
    const b = buf(0.45);
    mixInto(b, swish(0.22, 3200, 800, 1), 0);
    mixInto(b, envExp(tone(0.15, 140, 90), 0.002, 0.04), 0.18, 0.6);
    return normalize(b, 0.55);
  },
  compare() {
    const b = buf(1.5);
    const rise = biquad(noise(0.45), 'bp', (t) => 400 * Math.pow(7, t / 0.45), 1.0);
    for (let i = 0; i < rise.length; i++) rise[i] *= Math.pow(i / rise.length, 2);
    mixInto(b, rise, 0, 0.7);
    mixInto(b, impact(1.0), 0.45, 1);
    return fadeOut(normalize(reverb(b, 0.2), 0.9), 0.2);
  },
  allin() {
    const b = buf(2.0);
    const riser = tone(1.0, 180, 900);
    for (let i = 0; i < riser.length; i++) {
      const t = i / SR;
      riser[i] = (riser[i] > 0 ? 0.6 : -0.6) * Math.pow(t / 1.0, 2) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 14 * t));
    }
    mixInto(b, biquad(riser, 'lp', 2500), 0, 0.5);
    const nr = biquad(noise(1.0), 'bp', (t) => 500 * Math.pow(10, t), 0.8);
    for (let i = 0; i < nr.length; i++) nr[i] *= Math.pow(i / nr.length, 2);
    mixInto(b, nr, 0, 0.6);
    mixInto(b, impact(1.0), 1.0, 1.2);
    return fadeOut(normalize(reverb(b, 0.25), 0.9), 0.3);
  },
  win() {
    const b = buf(2.0);
    [62, 66, 69, 74, 78, 81].forEach((m, k) => mixInto(b, bellNote(NOTE(m), 1.2, 0.8), k * 0.085));
    for (let k = 0; k < 14; k++) mixInto(b, clink(0.9 + rnd() * 0.3, 0.25 + rnd() * 0.35), 0.55 + rnd() * 0.9);
    return fadeOut(normalize(reverb(b, 0.25), 0.85), 0.3);
  },
  lose() {
    const b = buf(1.2);
    [69, 66, 62].forEach((m, k) => {
      const n = buf(0.5);
      const f = NOTE(m - 12);
      for (let i = 0; i < n.length; i++) {
        const t = i / SR;
        n[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 3 * f * t) + 0.12 * Math.sin(2 * Math.PI * 5 * f * t)) * Math.exp(-t / 0.18) * Math.min(1, t / 0.01);
      }
      mixInto(b, n, k * 0.17, 0.7);
    });
    return fadeOut(normalize(reverb(b, 0.2), 0.55), 0.2);
  },
  turn() {
    const b = buf(1.4);
    mixInto(b, bellNote(NOTE(85), 1.1, 1), 0);
    mixInto(b, bellNote(NOTE(81), 1.2, 0.9), 0.22);
    return fadeOut(normalize(reverb(b, 0.22), 0.8), 0.2);
  },
  tick() {
    const b = envExp(tone(0.08, 1900, 1700), 0.0005, 0.012);
    mixInto(b, envExp(tone(0.08, 950), 0.0005, 0.02), 0, 0.5);
    mixInto(b, envExp(biquad(noise(0.01), 'bp', 3000, 2), 0.0005, 0.002), 0, 0.4);
    return normalize(b, 0.55);
  },
  sit() {
    const b = envExp(tone(0.12, 420, 980), 0.002, 0.03);
    return normalize(b, 0.5);
  },
  ready() {
    const b = buf(0.6);
    mixInto(b, bellNote(NOTE(88), 0.6, 1), 0);
    return fadeOut(normalize(b, 0.5), 0.1);
  },
  start() {
    return fadeOut(normalize(gongHit(98, 2.8), 0.85), 0.5);
  },
  bonus() {
    const b = buf(2.6);
    mixInto(b, gongHit(131, 2.2), 0, 0.9);
    for (let k = 0; k < 22; k++) mixInto(b, clink(0.9 + rnd() * 0.35, 0.25 + rnd() * 0.4), 0.15 + rnd() * 1.6);
    return fadeOut(normalize(b, 0.9), 0.4);
  },
  notice() {
    const b = buf(0.5);
    mixInto(b, bellNote(NOTE(79), 0.5, 0.8), 0);
    mixInto(b, bellNote(NOTE(86), 0.5, 0.6), 0.08);
    return fadeOut(normalize(b, 0.45), 0.1);
  },
  // 推一大摞筹码：滑动 + 一大把哗啦啦 + 落定的闷响
  push() {
    const b = buf(1.2);
    mixInto(b, slide(0.3, 0.7), 0);
    mixInto(b, cascade(0.6, 26, 0.18, 1), 0);
    mixInto(b, thump(95, 0.18, 0.6), 0.2);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.12), 0.97), 2.8), 0.97), 0.15);
  },
  // 豪气 / 霸气：更长的滑动 + 筹码山倒塌（两波哗啦啦）+ 轰鸣
  pushbig() {
    const b = buf(2.0);
    mixInto(b, slide(0.42, 0.8), 0);
    mixInto(b, cascade(0.75, 40, 0.25, 1), 0);
    mixInto(b, cascade(0.6, 22, 0.75, 0.7), 0);
    mixInto(b, impact(1.2), 0.28, 0.9);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.18), 0.98), 2.8), 0.98), 0.3);
  },
  // 赢牌号角：铜管上行琶音 + 大和弦 + 镲
  fanfare() {
    const b = buf(2.6);
    [60, 64, 67].forEach((m, k) => mixInto(b, brass(NOTE(m), 0.16, 0.8), k * 0.12));
    for (const m of [72, 76, 79, 84]) mixInto(b, brass(NOTE(m), 1.5, 0.5), 0.36);
    mixInto(b, brass(NOTE(48), 1.5, 0.6), 0.36);
    const cym = biquad(noise(2.0), 'hp', 5000);
    for (let i = 0; i < cym.length; i++) cym[i] *= Math.exp(-i / SR / 0.7) * Math.min(1, i / SR / 0.01);
    mixInto(b, cym, 0.36, 0.35);
    [84, 88, 91, 96].forEach((m, k) => mixInto(b, bellNote(NOTE(m), 1.0, 0.35), 0.4 + k * 0.07));
    return fadeOut(normalize(reverb(b, 0.3, 0.86), 0.92), 0.4);
  },
  // 金币哗啦啦：密集碰撞，先密后疏
  coins() {
    const b = buf(2.0);
    for (let k = 0; k < 46; k++) {
      const at = Math.pow(rnd(), 1.6) * 1.6;
      mixInto(b, clink(0.95 + rnd() * 0.45, 0.25 + rnd() * 0.55), at);
    }
    return fadeOut(normalize(reverb(b, 0.2), 0.85), 0.35);
  },
  // 输了：弱音长号式的下行“哇哇哇哇——”
  lose2() {
    const b = buf(2.2);
    const notes = [[67, 0.3], [66, 0.3], [65, 0.3], [64, 1.1]];
    let at = 0;
    for (const [m, d] of notes) {
      const n = brass(NOTE(m - 12), d, 0.9);
      const w = biquad(n, 'lp', (t) => 500 + 900 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * t)), 1.5);
      mixInto(b, w, at, 1);
      at += d;
    }
    return fadeOut(normalize(reverb(b, 0.2), 0.6), 0.4);
  },
  // 心跳：咚-咚
  heartbeat() {
    const b = buf(0.6);
    mixInto(b, thump(62, 0.22, 1), 0);
    mixInto(b, thump(55, 0.25, 0.75), 0.17);
    return normalize(b, 0.9);
  },
  // 鼓点：小军鼓滚奏渐强（比牌开牌前）
  drumroll() {
    const b = buf(1.0);
    for (let t = 0, k = 0; t < 0.85; k++) {
      mixInto(b, snare(0.25 + 0.75 * (t / 0.85)), t);
      t += 0.045 - 0.012 * (t / 0.85);
    }
    return fadeOut(normalize(b, 0.7), 0.05);
  },
  // 轰：大事件（豹子、豪气加注、大赢）
  boom() {
    const b = buf(1.6);
    mixInto(b, thump(55, 1.2, 1), 0);
    mixInto(b, impact(1.4), 0, 0.8);
    return fadeOut(normalize(reverb(b, 0.25), 0.95), 0.3);
  },
  // 单张发牌：划一下 + 落桌
  card() {
    const b = buf(0.2);
    mixInto(b, swish(0.06, 1800, 5200, 0.9), 0);
    mixInto(b, tap(720, 0.5), 0.055);
    return normalize(b, 0.6);
  },
};

/* ---------------- 新增音效零件 ---------------- */
// 新增音效各用一个由名字派生的独立种子：不扰动全局随机序列（完整重跑时已有 26 个音效和 bgm 的结果不变），
// 用 --only 单独生成某几个时结果也可复现
function withSeed(name, fn) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const keep = seed;
  seed = h;
  try {
    return fn();
  } finally {
    seed = keep;
  }
}
function scale(b, g) {
  for (let i = 0; i < b.length; i++) b[i] *= g;
  return b;
}
// 逐点乘包络：env(t 秒, p 进度 0..1)
function shape(b, env, sr = SR) {
  for (let i = 0; i < b.length; i++) b[i] *= env(i / sr, i / b.length);
  return b;
}
// 钟琴 / 金属片：非谐分音 1 : 2.76 : 5.4 : 8.93，比 bellNote 更亮、更“金属”；超过奈奎斯特的分音直接丢掉，避免混叠
function glock(f, sec = 0.8, amp = 1) {
  const parts = [[1, 0.6, sec * 0.45], [2.76, 0.28, 0.12], [5.4, 0.14, 0.05], [8.93, 0.06, 0.025]];
  const b = bell(f, sec, parts.filter(([r]) => f * r < SR * 0.45));
  mixInto(b, envExp(biquad(noise(0.006), 'hp', 6000), 0.0002, 0.0012), 0, 0.15);
  return scale(b, amp);
}
// 柔和的钟：分音少、起音稍缓、再低通，圆润不刺耳
function softBell(f, sec = 0.8, amp = 1) {
  const b = bell(f, sec, [[1, 0.7, 0.4], [2.0, 0.2, 0.18], [3.0, 0.06, 0.09], [4.07, 0.03, 0.05]]);
  shape(b, (t) => Math.min(1, t / 0.008) * amp);
  return biquad(b, 'lp', Math.min(f * 4, 6000), 0.7);
}
// 音高上弯的小铃：分音一起从 f0 滑到 f1（“叮~↗”）
function glideBell(f0, f1, sec = 0.5, amp = 1) {
  const b = buf(sec);
  for (const [r, a, tau] of [[1, 0.6, 0.25], [2.0, 0.22, 0.12], [3.0, 0.08, 0.06]]) {
    let ph = rnd() * 6.28;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * r * (f1 + (f0 - f1) * Math.exp(-t / 0.04))) / SR;
      b[i] += a * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.002);
    }
  }
  return scale(b, amp);
}
// 玻璃杯：分音稀疏、衰减长；每个主分音配一个微失谐的孪生分音，产生“嗡嗡”的拍频余韵
function glass(f, sec = 1.0, amp = 1) {
  const b = bell(f, sec, [
    [1, 0.55, 0.55], [1.003, 0.3, 0.6], [2.32, 0.3, 0.3], [2.327, 0.15, 0.28],
    [4.25, 0.14, 0.15], [6.63, 0.07, 0.08],
  ]);
  mixInto(b, envExp(biquad(noise(0.015), 'hp', 4000), 0.0003, 0.0025), 0, 0.35);
  return scale(b, amp);
}
// 玻璃碎片：随机的非谐高频分音，极短衰减，带一下脆响
function shard(f, amp = 1) {
  const parts = [
    [1, 0.6, 0.015 + rnd() * 0.04],
    [1.38 + rnd() * 0.3, 0.4, 0.01 + rnd() * 0.03],
    [2.1 + rnd() * 0.5, 0.25, 0.008 + rnd() * 0.02],
    [3.3 + rnd() * 0.6, 0.12, 0.006 + rnd() * 0.01],
  ];
  const b = bell(f, 0.2, parts.filter(([r]) => f * r < SR * 0.45));
  mixInto(b, envExp(biquad(noise(0.008), 'hp', 5000), 0.0002, 0.0015), 0, 0.5);
  return scale(b, amp);
}
// 钵 / 磬：稀疏的非谐分音，每个分音配一个相差 1~3Hz 的孪生分音，形成缓慢的“嗡——嗡——”；软槌起音
function bowl(f, sec = 1.5, amp = 1) {
  const b = buf(sec);
  for (const [r, a, tau, beat] of [[1, 0.6, 1.6, 0.9], [2.76, 0.3, 0.8, 1.6], [5.2, 0.12, 0.4, 2.4], [8.4, 0.05, 0.2, 3.3]]) {
    const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const e = Math.exp(-t / tau) * Math.min(1, t / 0.004);
      b[i] += (a * e * (Math.sin(ph1 + 2 * Math.PI * f * r * t) + 0.7 * Math.sin(ph2 + 2 * Math.PI * (f * r + beat) * t))) / 1.7;
    }
  }
  mixInto(b, envExp(biquad(noise(0.03), 'lp', 1500), 0.001, 0.006), 0, 0.12);
  return scale(b, amp);
}
// “啵”：极短的正弦，音高从 f0 迅速趋向 f1（f0 > f1 是下滑的 pop，反之是上扬的气泡）
function pop(f0, f1, sec = 0.05, amp = 1) {
  const b = buf(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, p = i / b.length;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-p * 5))) / SR;
    b[i] = Math.sin(ph) * Math.min(1, t / 0.001) * (1 - p) * (1 - p) * amp;
  }
  return b;
}
// 噼啪颗粒：随机时刻的极短爆裂，每颗带一个很快衰减的共鸣音高（燃烧、碎屑、气泡嘶嘶都用它）
function crackle(sec, rate, fLo = 1500, fHi = 6000, amp = 1, envFn = () => 1) {
  const b = buf(sec + 0.03);
  const n = Math.round(rate * sec);
  for (let k = 0; k < n; k++) {
    const at = rnd() * sec;
    const g = envFn(at) * (0.15 + 0.85 * rnd() * rnd()) * amp;
    const f = fLo * Math.pow(fHi / fLo, rnd());
    const tau = 0.0008 + rnd() * 0.003;
    const ph0 = rnd() * 6.28;
    const o = Math.round(at * SR);
    const len = Math.ceil(tau * 6 * SR);
    for (let i = 0; i < len && o + i < b.length; i++) {
      const t = i / SR;
      b[o + i] += g * Math.exp(-t / tau) * (Math.sin(ph0 + 2 * Math.PI * f * t) + (i < 3 ? (rnd() * 2 - 1) * 1.5 : 0));
    }
  }
  return b;
}
// 拍手：几个相隔 1~3ms 的噪声小爆发叠在一起（手掌的多次接触），带通中心决定手掌大小 / 空心程度
function clap(fc = 1500, amp = 1, q = 1.1) {
  const raw = buf(0.06);
  let at = 0;
  for (let k = 0; k < 3; k++) {
    mixInto(raw, envExp(noise(0.04), 0.0002, k < 2 ? 0.0012 : 0.008), at, k < 2 ? 0.6 : 1);
    at += 0.001 + rnd() * 0.0025;
  }
  const b = biquad(raw, 'bp', fc, q);
  mixInto(b, biquad(raw, 'hp', 3000), 0, 0.15);
  return scale(b, amp);
}
// 方波“哔”：只叠奇次谐波（限带，避免混叠刺耳），音高可滑，wob 是科幻感的快速颤音深度
function beep(sec, f0, f1 = f0, amp = 1, wob = 0) {
  const b = buf(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, i / b.length) * (1 + wob * Math.sin(2 * Math.PI * 32 * t));
    ph += (2 * Math.PI * f) / SR;
    let v = 0;
    for (let h = 1; h <= 11 && h * f < 12000; h += 2) v += Math.sin(h * ph) / h;
    b[i] = v * Math.min(1, t / 0.004) * Math.min(1, (sec - t) / 0.02) * amp;
  }
  return b;
}
// 卡通弹簧“嘣～”：音高先往上弹，再带着越来越小的快速颤动，tanh 加点毛边，起音处一点弹簧金属的“铮”
function boing(f = 140, sec = 0.6, amp = 1) {
  const b = buf(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const glide = 1 + 0.6 * (1 - Math.exp(-t / 0.12));
    const wob = 1 + 0.28 * Math.exp(-t / 0.25) * Math.sin(2 * Math.PI * 17 * t);
    ph += (2 * Math.PI * f * glide * wob) / SR;
    const v = Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.3) + 0.25 * Math.sin(3 * ph);
    b[i] = Math.tanh(1.8 * v) * Math.min(1, t / 0.003) * Math.exp(-t / (sec * 0.38)) * amp;
  }
  mixInto(b, bell(1, 0.15, [[1850, 0.25, 0.03], [2970, 0.15, 0.02], [4400, 0.08, 0.012]]), 0, amp);
  return biquad(b, 'lp', 3000, 0.8);
}
// 关门：低频门板共鸣 + 门框撞击噪声 + 门锁的小咔嗒
function doorSlam(amp = 1) {
  const b = thump(75, 0.4, 1);
  mixInto(b, bell(1, 0.3, [[190, 0.5, 0.08], [310, 0.35, 0.06], [520, 0.22, 0.04], [890, 0.12, 0.025]]), 0, 0.7);
  mixInto(b, envExp(biquad(noise(0.08), 'bp', 1200, 0.8), 0.0005, 0.012), 0, 0.6);
  mixInto(b, tap(1800, 0.25), 0.035);
  return scale(b, amp);
}
// 金属锁扣：短促的高频金属分音 + 尖脆的咔嗒 + 一点机械本体的低音
function latch(pitch = 1, amp = 1) {
  const b = bell(1, 0.12, [[2350 * pitch, 0.5, 0.014], [3720 * pitch, 0.4, 0.01], [5150 * pitch, 0.3, 0.007], [6900 * pitch, 0.18, 0.005]]);
  mixInto(b, envExp(biquad(noise(0.015), 'hp', 3000), 0.0002, 0.002), 0, 0.8);
  mixInto(b, envExp(tone(0.04, 520 * pitch, 380 * pitch), 0.0005, 0.008), 0, 0.5);
  return scale(b, amp);
}
// 定音鼓：膜振动分音（约 1 : 1.5 : 1.74 : 2 : 2.24 : 2.49）+ 鼓槌的低通噪声；敲下瞬间音高略高随即回落
function timpani(f = 65, sec = 1.2, amp = 1) {
  const b = buf(sec);
  for (const [r, a, tau] of [[1, 0.7, 0.55], [1.504, 0.4, 0.35], [1.742, 0.22, 0.25], [2.0, 0.18, 0.22], [2.245, 0.1, 0.16], [2.494, 0.08, 0.12]]) {
    let ph = rnd() * 6.28;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * f * r * (1 + 0.04 * Math.exp(-t / 0.03))) / SR;
      b[i] += a * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.002);
    }
  }
  mixInto(b, envExp(biquad(noise(0.05), 'lp', 700), 0.0005, 0.012), 0, 0.5);
  return scale(b, amp);
}
// 大镲：高通噪声 + 一层带通的金属嘶声，长衰减
function crash(sec = 1.5, tau = 0.6, amp = 1) {
  const n = noise(sec);
  const b = biquad(n, 'hp', 4200, 0.7);
  const shimmer = biquad(n, 'bp', 7500, 2);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = (b[i] + shimmer[i] * 0.8) * Math.min(1, t / 0.003) * Math.exp(-t / tau) * amp;
  }
  return b;
}
// 物体飞过：带通噪声中心频率先升后降（接近时变高、远去时变低的多普勒感），音量在峰值处最大，再叠一层窄带“哨音”
function whooshNoise(sec, fStart, fPeak, fEnd, amp = 1, peak = 0.55) {
  const fc = (t) => {
    const p = Math.min(1, t / sec);
    return p < peak ? fStart * Math.pow(fPeak / fStart, p / peak) : fPeak * Math.pow(fEnd / fPeak, (p - peak) / (1 - peak));
  };
  const n = noise(sec);
  const wide = biquad(n, 'bp', fc, 0.9);
  const narrow = biquad(n, 'bp', fc, 6);
  const b = buf(sec);
  for (let i = 0; i < b.length; i++) {
    const p = i / b.length;
    const e = Math.exp(-(((p - peak) / (p < peak ? 0.28 : 0.18)) ** 2));
    b[i] = (wide[i] + narrow[i] * 1.8) * e * amp;
  }
  return b;
}
// 缓慢随机起伏（火苗、引线的闪烁）：每 step 个样本换一个目标值，平滑追随
function flicker(len, step = 1000, lo = 0.4, smooth = 0.003) {
  const b = new Float32Array(len);
  let s = lo + (1 - lo) * 0.5, target = s;
  for (let i = 0; i < len; i++) {
    if (i % step === 0) target = lo + (1 - lo) * rnd();
    s += (target - s) * smooth;
    b[i] = s;
  }
  return b;
}

/* ---------------- 新增音效：牌局事件 / 互动道具 / 聊天表情 / 紧张铺底 ---------------- */
const SFX_MORE = {
  // “出局”印章重重盖下：落下的风声 + 厚实的木头/橡胶闷响 + 纸面拍击
  stamp() {
    const b = buf(0.42);
    const hit = 0.05;
    mixInto(b, swish(0.06, 600, 1600, 0.25), 0);
    mixInto(b, envExp(tone(0.3, 170, 65), 0.0008, 0.055), hit, 1);
    mixInto(b, bell(1, 0.2, [[310, 0.45, 0.045], [690, 0.3, 0.03], [1130, 0.18, 0.02], [1720, 0.1, 0.012]]), hit, 0.8);
    mixInto(b, envExp(biquad(noise(0.06), 'lp', 900), 0.0005, 0.014), hit, 0.9);
    mixInto(b, envExp(biquad(noise(0.04), 'bp', 2800, 0.8), 0.0003, 0.007), hit, 0.55);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.08, 0.7), 0.95), 2.4), 0.9), 0.06);
  },
  // 起身离座：椅腿在地上挪动（共振带通 + 低通噪声扫频，带“粘-滑”颤动）+ 放稳的轻敲
  stand() {
    const b = buf(0.52);
    const sec = 0.34;
    const n = noise(sec);
    const scrape = biquad(n, 'bp', (t) => 240 + 520 * (t / sec), 3);
    const body = biquad(n, 'lp', (t) => 500 + 900 * (t / sec), 0.7);
    let ph = 0;
    for (let i = 0; i < scrape.length; i++) {
      const p = i / scrape.length;
      ph += (2 * Math.PI * (48 + 30 * p + 10 * (rnd() - 0.5))) / SR;
      const chatter = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(ph), 3);
      scrape[i] = (scrape[i] * 2.2 + body[i] * 0.6) * chatter * Math.pow(Math.sin(Math.PI * p), 0.7);
    }
    mixInto(b, scrape, 0, 1);
    mixInto(b, tap(520, 0.6), 0.37);
    mixInto(b, envExp(tone(0.08, 160, 110), 0.001, 0.02), 0.37, 0.35);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.08), 0.95), 1.8), 0.55), 0.05);
  },
  // 机器人入座：“哔-啵-哔”三连方波电子音，最后一声带科幻颤音
  robot() {
    const b = buf(0.62);
    mixInto(b, beep(0.11, 1180, 1320, 1), 0);
    mixInto(b, beep(0.13, 760, 390, 1, 0.02), 0.17);
    mixInto(b, beep(0.17, 1320, 1760, 1, 0.035), 0.36);
    return fadeOut(normalize(reverb(biquad(b, 'lp', 5000, 0.7), 0.12), 0.6), 0.06);
  },
  // 被请出房间：卡通弹簧“嘣～”+ 一声关门闷响
  kick() {
    const b = buf(0.95);
    mixInto(b, boing(140, 0.6, 1), 0);
    mixInto(b, doorSlam(1.1), 0.58);
    return fadeOut(normalize(reverb(b, 0.15, 0.8), 0.85), 0.12);
  },
  // 强制开牌：0.5s 上升风声 → 明亮冲击 + 闪亮的高音铃尾巴
  reveal() {
    const b = buf(1.65);
    const hit = 0.5;
    const rise = biquad(noise(hit), 'bp', (t) => 280 * Math.pow(14, t / hit), 1.1);
    mixInto(b, shape(rise, (t, p) => Math.pow(p, 2.2)), 0, 0.9);
    mixInto(b, shape(tone(hit, 110, 440), (t, p) => p * p), 0, 0.15);
    mixInto(b, impact(1.0), hit, 0.9);
    mixInto(b, envExp(biquad(noise(0.05), 'hp', 3500), 0.0003, 0.008), hit, 0.7);
    [84, 88, 91, 96].forEach((m) => mixInto(b, glock(NOTE(m), 1.1, 0.4), hit + 0.005));
    const sp = [96, 98, 100, 103, 105, 108];
    for (let k = 0; k < 20; k++) {
      const t = hit + 0.06 + Math.pow(rnd(), 1.4) * 0.85;
      mixInto(b, glock(NOTE(sp[Math.floor(rnd() * sp.length)]), 0.35, 0.3 * Math.exp(-(t - hit) / 0.5) * (0.5 + rnd() * 0.5)), t);
    }
    return fadeOut(normalize(reverb(b, 0.25, 0.85), 0.9), 0.25);
  },
  // 235 吃豹子：低沉轰击 + 玻璃碎裂（大量高频碎片先密后疏撒开）→ 竖琴式快速上行滑音 → 锣 + 镲
  b235() {
    const b = buf(2.45);
    mixInto(b, thump(45, 1.4, 1), 0);
    mixInto(b, impact(1.2), 0, 0.8);
    mixInto(b, envExp(biquad(noise(0.12), 'hp', 2500), 0.0003, 0.035), 0.01, 1.2);
    for (let k = 0; k < 90; k++) {
      const t = 0.01 + Math.pow(rnd(), 2) * 0.9;
      mixInto(b, shard(2400 + rnd() * 6500, (0.25 + 0.75 * rnd()) * Math.exp(-t / 0.45)), t, 0.8);
    }
    // 上行滑音：五声音阶竖琴拨弦一口气刷上去，底下垫一条锯齿扫频 + 噪声推进
    const g0 = 0.42, gl = 0.36;
    const harp = [55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
    harp.forEach((m, k) => mixInto(b, pluck(NOTE(m), 0.6, SR, 0.8, 0.996), g0 + (k * gl) / harp.length, 0.25 + 0.35 * (k / harp.length)));
    const sweep = buf(gl);
    let ph = 0;
    for (let i = 0; i < sweep.length; i++) {
      const p = i / sweep.length;
      ph += (2 * Math.PI * 110 * Math.pow(8, p)) / SR;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * ph) / h;
      sweep[i] = v * p * p;
    }
    mixInto(b, biquad(sweep, 'lp', 3000, 0.8), g0, 0.3);
    const nr = biquad(noise(gl), 'bp', (t) => 600 * Math.pow(10, t / gl), 1);
    mixInto(b, shape(nr, (t, p) => p * p), g0, 0.6);
    const hit = g0 + gl;
    mixInto(b, impact(1.2), hit, 0.7);
    mixInto(b, crash(1.5, 0.6), hit, 0.3);
    const out = reverb(b, 0.2, 0.85);
    mixInto(out, gongHit(110, 1.65), hit, 0.85);
    return fadeOut(normalize(out, 0.95), 0.35);
  },
  // 连胜：明亮的上行琶音（钟琴 + 铃）+ 收尾的金属闪光
  streak() {
    const b = buf(1.05);
    [76, 79, 84, 88, 91, 96].forEach((m, k) => {
      mixInto(b, glock(NOTE(m), 0.7, 0.8), k * 0.07);
      mixInto(b, bellNote(NOTE(m - 12), 0.5, 0.25), k * 0.07);
    });
    for (let k = 0; k < 10; k++) mixInto(b, clink(1.1 + rnd() * 0.4, 0.15 + rnd() * 0.2), 0.3 + rnd() * 0.5);
    return fadeOut(normalize(reverb(b, 0.22), 0.85), 0.2);
  },
  // 本场冠军：两句铜管号角（三连音拾音 → 大和弦长音）+ 镲 + 定音鼓滚奏渐强 → 高八度大和弦强奏收尾
  champion() {
    const b = buf(3.5);
    const horn = (m, at, d, a) => mixInto(b, brass(NOTE(m), d, a), at);
    [0, 0.13, 0.26].forEach((at) => {
      horn(67, at, 0.12, 0.8);
      horn(55, at, 0.12, 0.4);
    });
    horn(72, 0.39, 0.42, 0.8);
    horn(64, 0.39, 0.42, 0.45);
    horn(48, 0.39, 0.42, 0.45);
    mixInto(b, timpani(NOTE(36), 0.8, 0.6), 0.39);
    horn(72, 0.86, 0.12, 0.8);
    horn(76, 0.98, 0.12, 0.8);
    for (const m of [72, 76, 79]) horn(m, 1.1, 1.35, 0.55);
    horn(60, 1.1, 1.35, 0.5);
    horn(48, 1.1, 1.35, 0.55);
    mixInto(b, crash(1.6, 0.7), 1.1, 0.35);
    mixInto(b, timpani(NOTE(36), 1.0, 0.9), 1.1);
    [84, 88, 91, 96].forEach((m, k) => mixInto(b, glock(NOTE(m), 0.9, 0.3), 1.14 + k * 0.06));
    // 定音鼓滚奏（属音 G）：越滚越密、越滚越响
    const rolls = [0.997, 1, 1.003].map((d) => timpani(NOTE(43) * d, 0.5, 1));
    for (let t = 1.5, k = 0; t < 2.42; k++) {
      const p = (t - 1.5) / 0.92;
      mixInto(b, rolls[k % 3], t, 0.15 + 0.6 * p * p);
      t += 0.06 - 0.018 * p;
    }
    // 收尾：上到高八度的大和弦强奏（起音重、随后略收）+ 定音鼓重击（主音 C）+ 镲
    const end = 2.45;
    for (const m of [72, 76, 79, 84]) mixInto(b, shape(brass(NOTE(m), 0.75, 0.6), (t) => 0.55 + 0.45 * Math.exp(-t / 0.12)), end);
    horn(48, end, 0.75, 0.6);
    horn(36, end, 0.75, 0.5);
    mixInto(b, timpani(NOTE(36), 1.05, 1.3), end);
    mixInto(b, thump(55, 0.6, 0.8), end);
    mixInto(b, crash(1.05, 0.5), end, 0.45);
    return fadeOut(normalize(reverb(b, 0.3, 0.86), 0.93), 0.4);
  },
  // 单注封顶：金属锁扣“咔-哒”+ 一记低音铜管短促强奏
  capped() {
    const b = buf(0.82);
    mixInto(b, latch(1.25, 0.5), 0);
    mixInto(b, latch(1, 1), 0.045);
    const at = 0.1;
    for (const [m, a] of [[36, 0.7], [43, 0.6], [48, 0.5]]) {
      mixInto(b, shape(brass(NOTE(m), 0.4, a), (t) => 0.4 + 0.6 * Math.exp(-t / 0.08)), at);
    }
    mixInto(b, thump(70, 0.3, 0.6), at);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.18), 0.95), 2), 0.88), 0.15);
  },
  // 本场暂停：两个柔和的下行钟音
  paused() {
    const b = buf(0.85);
    mixInto(b, softBell(NOTE(79), 0.8, 1), 0);
    mixInto(b, softBell(NOTE(74), 0.65, 0.9), 0.2);
    return fadeOut(normalize(reverb(b, 0.22), 0.55), 0.15);
  },
  // 本场继续：两个柔和的上行钟音
  resume() {
    const b = buf(0.85);
    mixInto(b, softBell(NOTE(74), 0.8, 0.9), 0);
    mixInto(b, softBell(NOTE(79), 0.65, 1), 0.2);
    return fadeOut(normalize(reverb(b, 0.22), 0.55), 0.15);
  },
  // 道具飞过空中的呼啸
  whoosh() {
    const b = buf(0.5);
    mixInto(b, whooshNoise(0.48, 350, 1500, 480, 1, 0.55), 0);
    return fadeOut(normalize(b, 0.6), 0.05);
  },
  // 鸡蛋砸中：蛋壳“咔”的脆裂（15ms 内挤着几颗高频碎裂颗粒）+ 湿漉漉的“啪叽”（截止频率急降的低通噪声 + 小气泡）
  splat() {
    const b = buf(0.6);
    mixInto(b, crackle(0.015, 500, 2500, 7000, 1), 0, 0.9);
    mixInto(b, envExp(biquad(noise(0.02), 'hp', 3000), 0.0003, 0.003), 0, 0.5);
    const wet = biquad(noise(0.35), 'lp', (t) => 300 + 2600 * Math.exp(-t / 0.05), 1.4);
    mixInto(b, shape(wet, (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.09)), 0.008, 1.1);
    mixInto(b, envExp(tone(0.1, 220, 110), 0.001, 0.025), 0.008, 0.5);
    for (let k = 0; k < 6; k++) mixInto(b, pop(350 + rnd() * 700, 900 + rnd() * 900, 0.025, 0.15 + rnd() * 0.25), 0.03 + rnd() * 0.25);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.08), 0.95), 2), 0.7), 0.08);
  },
  // 番茄砸中：更厚更湿的“噗叽”——更低的共振低通、更长的尾巴、更多更低的气泡，外加果肉滑落的第二下
  squish() {
    const b = buf(0.6);
    const wet = biquad(noise(0.45), 'lp', (t) => 200 + 1400 * Math.exp(-t / 0.08), 2);
    mixInto(b, shape(wet, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.14)), 0, 1.2);
    mixInto(b, envExp(tone(0.15, 150, 70), 0.002, 0.04), 0, 0.7);
    const wet2 = biquad(noise(0.2), 'lp', (t) => 180 + 700 * Math.exp(-t / 0.05), 2.5);
    mixInto(b, shape(wet2, (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.06)), 0.13, 0.6);
    for (let k = 0; k < 10; k++) mixInto(b, pop(200 + rnd() * 300, 500 + rnd() * 500, 0.035, 0.2 + rnd() * 0.3), 0.02 + rnd() * 0.32);
    return fadeOut(normalize(reverb(b, 0.08), 0.7), 0.08);
  },
  // 送花：魔法般的钟琴快速上行琶音 + 细碎的高频闪光
  sparkle() {
    const b = buf(1.25);
    [84, 88, 91, 96, 100, 103, 108].forEach((m, k) => mixInto(b, glock(NOTE(m), 0.8, 0.7), k * 0.045));
    for (let k = 0; k < 36; k++) {
      const t = 0.04 + Math.pow(rnd(), 1.3) * 0.95;
      mixInto(b, bell(1, 0.12, [[6000 + rnd() * 5000, 1, 0.012 + rnd() * 0.03]]), t, (0.08 + rnd() * 0.15) * Math.exp(-t / 0.6));
    }
    return fadeOut(normalize(reverb(b, 0.3, 0.85), 0.7), 0.25);
  },
  // 干杯：两只玻璃杯几乎同时相碰（音高略不同，拍频余韵）+ 香槟气泡的细碎嘶嘶
  clink() {
    const b = buf(1.05);
    mixInto(b, glass(1520, 1.0, 1), 0);
    mixInto(b, glass(1610, 1.0, 0.75), 0.004);
    mixInto(b, envExp(biquad(noise(0.01), 'hp', 5000), 0.0002, 0.0015), 0, 0.4);
    const fizzEnv = (t) => Math.min(1, t / 0.1) * Math.exp(-t / 0.6);
    mixInto(b, crackle(0.95, 90, 3500, 9000, 1, fizzEnv), 0.03, 0.12);
    mixInto(b, shape(biquad(noise(0.95), 'hp', 6000), fizzEnv), 0.03, 0.03);
    return fadeOut(normalize(reverb(b, 0.18), 0.7), 0.2);
  },
  // 炸弹引线：闪烁的高通嘶嘶燃烧声 + 噼里啪啦的爆裂小颗粒
  fuse() {
    const sec = 0.8;
    const b = buf(sec);
    const hiss = biquad(noise(sec), 'hp', 3000, 0.7);
    const fl = flicker(hiss.length, 900, 0.35, 0.004);
    for (let i = 0; i < hiss.length; i++) hiss[i] *= fl[i] * Math.min(1, i / SR / 0.04);
    mixInto(b, hiss, 0, 0.5);
    mixInto(b, crackle(sec, 70, 1200, 7000, 1), 0, 1);
    mixInto(b, crackle(sec, 12, 500, 1500, 1.4), 0, 1);
    return fadeOut(normalize(squash(normalize(b, 0.95), 2.2), 0.55), 0.08);
  },
  // 炸弹爆炸：起爆爆裂 + 低频轰鸣（音高下坠 + 隆隆低通噪声）+ 碎屑落下的噼啪，整体压到饱和
  kaboom() {
    const b = buf(1.8);
    mixInto(b, envExp(noise(0.06), 0.0002, 0.012), 0, 1);
    mixInto(b, envExp(biquad(noise(0.5), 'bp', 600, 0.5), 0.001, 0.09), 0, 1.4);
    mixInto(b, envExp(tone(1.7, 80, 28), 0.002, 0.5), 0, 1.1);
    const rum = biquad(noise(1.7), 'lp', (t) => 90 + 1400 * Math.exp(-t / 0.15), 0.8);
    mixInto(b, shape(rum, (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.55)), 0, 2.2);
    for (let k = 0; k < 45; k++) {
      const t = 0.18 + Math.pow(rnd(), 1.5) * 1.35;
      mixInto(b, tap(350 + rnd() * 1400, (0.15 + rnd() * 0.35) * Math.exp(-(t - 0.18) / 0.7)), t);
    }
    mixInto(b, crackle(1.4, 70, 1000, 5000, 0.5, (t) => Math.exp(-t / 0.5)), 0.12, 1);
    return fadeOut(normalize(reverb(squash(normalize(b, 0.95), 3.2), 0.22, 0.85), 0.95), 0.4);
  },
  // 飞吻：俏皮的“啵”（气流 + 音高下滑的 pop）+ 心形上扬的小铃音
  kiss() {
    const b = buf(0.7);
    mixInto(b, envExp(biquad(noise(0.02), 'bp', 2500, 1), 0.0003, 0.003), 0, 0.4);
    mixInto(b, pop(1400, 420, 0.06, 1), 0.002);
    mixInto(b, glideBell(NOTE(86), NOTE(93), 0.5, 0.7), 0.13);
    mixInto(b, glock(NOTE(98), 0.35, 0.18), 0.21);
    return fadeOut(normalize(reverb(b, 0.15), 0.6), 0.15);
  },
  // 点赞：按下的小 pop + 明亮清脆的“叮”
  like() {
    const b = buf(0.5);
    mixInto(b, pop(500, 1100, 0.04, 0.7), 0);
    mixInto(b, glock(NOTE(91), 0.45, 1), 0.035);
    mixInto(b, bellNote(NOTE(91), 0.4, 0.35), 0.035);
    return fadeOut(normalize(reverb(b, 0.12), 0.6), 0.1);
  },
  // 👏 一群人鼓掌：每人各自的拍速、手掌音色，起拍时间错开；整体先强后弱
  applause() {
    const sec = 1.6;
    const b = buf(sec + 0.1);
    for (let p = 0; p < 22; p++) {
      const rate = 3.6 + rnd() * 1.8;
      const fc = 900 + rnd() * 1800;
      const gp = 0.5 + rnd() * 0.5;
      for (let t = rnd() * 0.12; t < sec; t += (0.85 + rnd() * 0.3) / rate) {
        const env = Math.min(1, t / 0.06) * Math.exp(-Math.max(0, t - 0.25) / 0.55);
        mixInto(b, clap(fc * (0.9 + rnd() * 0.2), gp * env * (0.7 + rnd() * 0.3)), t);
      }
    }
    return fadeOut(normalize(squash(normalize(reverb(b, 0.18, 0.8), 0.95), 2.2), 0.7), 0.25);
  },
  // 🎉 拉礼花：“砰”+ 彩纸沙沙 + 小铃铛
  party() {
    const b = buf(1.0);
    mixInto(b, envExp(biquad(noise(0.06), 'hp', 800), 0.0003, 0.01), 0, 1);
    mixInto(b, envExp(tone(0.12, 260, 90), 0.0008, 0.025), 0, 0.8);
    mixInto(b, envExp(biquad(noise(0.15), 'lp', 1500), 0.0005, 0.03), 0, 0.6);
    const rustle = biquad(noise(0.85), 'bp', 5200, 0.8);
    for (let i = 0; i < rustle.length; i++) {
      const t = i / SR;
      rustle[i] *= (rnd() < 0.12 ? 1 : 0.2) * Math.min(1, t / 0.03) * Math.exp(-t / 0.35);
    }
    mixInto(b, rustle, 0.03, 0.45);
    [91, 96, 100, 103, 98].forEach((m) => mixInto(b, glock(NOTE(m), 0.5, 0.25 + rnd() * 0.2), 0.08 + rnd() * 0.45));
    for (let k = 0; k < 8; k++) mixInto(b, shard(5500 + rnd() * 2500, 0.2 + rnd() * 0.2), 0.1 + rnd() * 0.5, 0.5);
    return fadeOut(normalize(reverb(b, 0.15), 0.85), 0.15);
  },
  // 🔥 火焰“呼”地窜起：截止频率先猛升后回落的低通噪声 + 低频轰鸣 + 闪烁 + 噼啪
  fire() {
    const sec = 0.9;
    const b = buf(sec);
    const env = (t) => Math.min(1, t / 0.06) * Math.exp(-Math.max(0, t - 0.1) / 0.3);
    const roar = biquad(noise(sec), 'lp', (t) => 180 + 1300 * (t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) / 0.25)), 0.9);
    const fl = flicker(roar.length, 1200, 0.55, 0.002);
    for (let i = 0; i < roar.length; i++) roar[i] *= env(i / SR) * fl[i];
    mixInto(b, roar, 0, 1.6);
    mixInto(b, shape(tone(sec, 62, 44), env), 0, 0.35);
    mixInto(b, crackle(0.8, 30, 1200, 5000, 0.8, (t) => Math.min(1, t / 0.1) * Math.exp(-t / 0.4)), 0.05, 1);
    return fadeOut(normalize(squash(normalize(b, 0.95), 2), 0.75), 0.15);
  },
  // 💯 两声上扬的“叮叮”
  hundred() {
    const b = buf(0.6);
    mixInto(b, glock(NOTE(86), 0.5, 0.9), 0);
    mixInto(b, bellNote(NOTE(86), 0.4, 0.35), 0);
    mixInto(b, glock(NOTE(93), 0.48, 1), 0.12);
    mixInto(b, bellNote(NOTE(93), 0.4, 0.35), 0.12);
    return fadeOut(normalize(reverb(b, 0.12), 0.65), 0.1);
  },
  // 👎 答错题的“哇呜”：双振荡锯齿嗡鸣音高下滑，共振低通先张开再合上
  thumbsdown() {
    const sec = 0.55;
    const b = buf(sec);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, p = i / b.length;
      const f = 240 * Math.pow(0.6, Math.pow(p, 0.8));
      ph += (2 * Math.PI * f) / SR;
      ph2 += (2 * Math.PI * f * 1.007) / SR;
      let v = 0;
      for (let h = 1; h <= 16; h++) v += (Math.sin(h * ph) + Math.sin(h * ph2) * 0.6) / h;
      b[i] = v * Math.min(1, t / 0.012) * Math.min(1, (sec - t) / 0.08);
    }
    const w = biquad(b, 'lp', (t) => 380 + 1900 * (t < 0.07 ? t / 0.07 : Math.exp(-(t - 0.07) / 0.17)), 3);
    return fadeOut(normalize(reverb(w, 0.12), 0.6), 0.05);
  },
  // 🙏 柔和悠长的钵音 / 磬
  pray() {
    const b = buf(1.55);
    mixInto(b, bowl(NOTE(74), 1.55, 1), 0);
    return fadeOut(normalize(reverb(b, 0.25, 0.86), 0.6), 0.35);
  },
  // 💪 出拳风声 + 一记重击
  muscle() {
    const b = buf(0.5);
    const hit = 0.12;
    mixInto(b, swish(0.13, 350, 2200, 1), 0, 0.7);
    mixInto(b, envExp(tone(0.3, 140, 50), 0.001, 0.07), hit, 1);
    mixInto(b, envExp(biquad(noise(0.08), 'bp', 900, 0.8), 0.0004, 0.015), hit, 0.9);
    mixInto(b, envExp(biquad(noise(0.02), 'hp', 2500), 0.0002, 0.003), hit, 0.4);
    return fadeOut(normalize(reverb(squash(normalize(b, 0.95), 2.5), 0.1), 0.85), 0.08);
  },
  // 🤝 两只手啪地握住（比鼓掌更闷更饱满的掌拍）+ 握紧时的轻微摩擦
  handshake() {
    const b = buf(0.4);
    mixInto(b, swish(0.05, 600, 1800, 0.25), 0);
    mixInto(b, clap(1100, 1, 0.9), 0.03);
    mixInto(b, envExp(tone(0.06, 210, 160), 0.0005, 0.012), 0.03, 0.5);
    const rub = biquad(noise(0.2), 'bp', 1800, 0.7);
    mixInto(b, shape(rub, (t, p) => Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 22 * t))), 0.08, 0.12);
    return fadeOut(normalize(squash(normalize(reverb(b, 0.08), 0.95), 2.2), 0.6), 0.06);
  },
  // 紧张氛围铺底，正好 8 秒一圈、可无缝循环：
  // 低频嗡鸣（频率都取 1/8Hz 的整数倍，8 秒内走整数个周期）+ 每 2 秒一次远处的低沉脉冲 + 很轻的高频颤动。
  // 做法同 bgm：所有成分都按 8 秒周期铺三遍，滤波器、混响进入稳态后截取中间一遍再多 1 秒，
  // 前端用 tension.json 的 start / loop 设 loopStart / loopEnd（避开 mp3 编码延迟造成的开头偏移）
  tension() {
    const L = 8;
    const N = L * SR;
    const total = N * 3;
    const per = (f) => Math.round(f * L) / L;
    const lfo = (t, cycles, ph = 0) => Math.sin((2 * Math.PI * cycles * t) / L + ph); // 8 秒内走 cycles 圈
    const tile = (one) => {
      const b = new Float32Array(total);
      for (let i = 0; i < total; i++) b[i] = one[i % N];
      return b;
    };
    // 1) 低频嗡鸣：A1 与五度 E2 各带一个微失谐副本（8 秒内 3 次 / 2 次缓慢拍频），再加一丝 Bb1 的小二度不协和；
    //    限带锯齿 + 截止频率缓慢“呼吸”的低通
    const drone = new Float32Array(total);
    for (const [f, a] of [[55, 1], [per(55.375), 0.5], [82.5, 0.55], [per(82.25), 0.3], [110, 0.2], [per(58.27), 0.14]]) {
      const ph0 = rnd() * 6.28;
      for (let h = 1; h <= 8; h++) {
        const w = (2 * Math.PI * f * h) / SR, g = a / Math.pow(h, 1.25);
        for (let i = 0; i < total; i++) drone[i] += g * Math.sin(ph0 * h + w * i);
      }
    }
    const droneF = biquad(drone, 'lp', (t) => 300 + 150 * lfo(t, 1), 1.0);
    for (let i = 0; i < total; i++) droneF[i] *= 0.82 + 0.18 * lfo(i / SR, 2, 0.7);
    // 2) 每 2 秒一次远处的低沉脉冲（定音鼓 + 闷鼓，低通后显得遥远），每圈第一下略重
    const one = buf(1.8);
    mixInto(one, timpani(per(NOTE(31)), 1.8, 1), 0);
    mixInto(one, thump(58, 0.5, 0.9), 0);
    const far = biquad(one, 'lp', 420, 0.7);
    const pulses = new Float32Array(total);
    for (let k = 0; k * 2 < total / SR; k++) mixInto(pulses, far, k * 2, k % 4 === 0 ? 1 : 0.8);
    // 3) 很轻的高频颤动：相距小二度的两个高音做弦乐式 7Hz 颤音（8 秒 56 圈），再叠一层同样颤动的带通噪声（噪声按 8 秒平铺）
    const hi = new Float32Array(total);
    for (const [f, a] of [[per(NOTE(88)), 1], [per(NOTE(89)), 0.7], [per(NOTE(100)), 0.25]]) {
      const ph0 = rnd() * 6.28, w = (2 * Math.PI * f) / SR;
      for (let i = 0; i < total; i++) hi[i] += a * Math.sin(ph0 + w * i);
    }
    const air = biquad(tile(noise(L)), 'bp', 5200, 0.8);
    for (let i = 0; i < total; i++) {
      const t = i / SR;
      hi[i] = (hi[i] * 0.6 + air[i] * 0.8) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 7 * t)) * (0.55 + 0.45 * lfo(t, 1, 2.1));
    }
    const mix = new Float32Array(total);
    for (let i = 0; i < total; i++) mix[i] = droneF[i] * 0.2 + pulses[i] + hi[i] * 0.02;
    const wet = reverb(mix, 0.25, 0.85);
    const out = normalize(wet.slice(N, 2 * N + SR), 0.7);
    let seam = 0;
    for (let i = 0; i < SR; i++) seam = Math.max(seam, Math.abs(out[i] - out[i + N]));
    console.log('tension 循环误差（t 与 t+8s 的最大样本差）', seam.toExponential(2));
    fs.writeFileSync(path.join(OUT, 'sfx', 'tension.json'), JSON.stringify({ loop: L, start: 0.5 }) + '\n');
    return out;
  },
};
// 并入 SFX（排在已有音效之后），每个新音效在独立种子下生成
for (const [name, fn] of Object.entries(SFX_MORE)) SFX[name] = () => withSeed(name, fn);

/* ---------------- 背景音乐：欢快民乐风（笛子主旋律 + 琵琶和弦 + 锣鼓点），可无缝循环 ---------------- */
function pluck(freq, sec, sr, bright = 0.5, decay = 0.996) {
  const N = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp = lp + bright * ((rnd() * 2 - 1) - lp); // 初始噪声先低通，音色更柔
    line[i] = lp;
  }
  const out = new Float32Array(Math.ceil(sec * sr));
  let idx = 0, prev = 0;
  for (let i = 0; i < out.length; i++) {
    const cur = line[idx];
    const y = decay * 0.5 * (cur + prev);
    prev = cur;
    line[idx] = y;
    idx = (idx + 1) % N;
    out[i] = cur * Math.min(1, i / (sr * 0.002));
  }
  return out;
}

// 笛子：基音 + 少量泛音，起音快，后段带颤音，再叠一点气声
function flute(freq, dur, sr) {
  const tail = 0.07;
  const n = Math.ceil((dur + tail) * sr);
  const out = new Float32Array(n);
  const breath = biquad(noise(dur + tail, sr), 'bp', Math.min(freq * 2, sr * 0.4), 2.5, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vibAmt = Math.min(1, Math.max(0, (t - 0.12) / 0.15)) * 0.005;
    ph += (2 * Math.PI * freq * (1 + vibAmt * Math.sin(2 * Math.PI * 5.6 * t))) / sr;
    const env = Math.min(1, t / 0.016) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / tail)) * (0.88 + 0.12 * Math.exp(-t / 0.06));
    out[i] = env * (Math.sin(ph) + 0.36 * Math.sin(2 * ph) + 0.17 * Math.sin(3 * ph) + 0.06 * Math.sin(4 * ph) + 0.35 * breath[i]);
  }
  return out;
}
// 堂鼓：音高快速下滑的低频 + 鼓皮噪声
function bigDrum(sr) {
  const b = buf(0.45, sr);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (52 + 48 * Math.exp(-t / 0.035))) / sr;
    b[i] = Math.sin(ph) * Math.exp(-t / 0.17) * Math.min(1, t / 0.002);
  }
  mixInto(b, envExp(biquad(noise(0.06, sr), 'lp', 900, 0.7, sr), 0.001, 0.015, sr), 0, 0.5, sr);
  return b;
}
// 小镲：高通噪声，短促
function cymbal(sr, len = 0.08) {
  const b = biquad(biquad(noise(len * 4, sr), 'hp', 5500, 0.7, sr), 'bp', 8500, 0.8, sr);
  return envExp(b, 0.001, len, sr);
}
// 梆子：短促的木质高音
function woodblock(sr) {
  const b = envExp(tone(0.08, 1250, 1180, sr), 0.0005, 0.022, sr);
  mixInto(b, envExp(tone(0.08, 1890, 1850, sr), 0.0005, 0.015, sr), 0, 0.45, sr);
  return b;
}
// 小锣：“当”，音高上扬的金属声（京剧锣鼓里的小锣）
function smallGong(sr) {
  const b = buf(1.0, sr);
  for (const [r, a, tau] of [[1, 0.6, 0.45], [1.47, 0.35, 0.32], [2.09, 0.25, 0.22], [2.93, 0.12, 0.14]]) {
    let ph = rnd() * 6.28;
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * 610 * r * (1 + 0.14 * (1 - Math.exp(-t / 0.07)))) / sr;
      b[i] += a * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.002);
    }
  }
  return b;
}

function makeBgm() {
  const sr = 32000;
  const BPM = 132;
  const beat = 60 / BPM;
  const e8 = beat / 2; // 八分音符
  // 旋律：每小节 8 个八分音符，[MIDI 音高, 八分音符个数]，0 = 休止
  const A1 = [
    [[76, 1], [79, 1], [81, 2], [79, 1], [76, 1], [79, 2]],
    [[84, 2], [81, 1], [79, 1], [76, 2], [74, 2]],
    [[72, 1], [74, 1], [76, 1], [79, 1], [81, 2], [84, 2]],
    [[79, 3], [76, 1], [79, 4]],
    [[74, 1], [76, 1], [79, 1], [81, 1], [79, 2], [76, 2]],
    [[74, 1], [76, 1], [72, 2], [67, 2], [69, 2]],
    [[81, 2], [79, 1], [76, 1], [74, 2], [76, 1], [74, 1]],
    [[72, 6], [0, 2]],
  ];
  const A2 = [
    [[79, 1], [81, 1], [84, 2], [81, 1], [79, 1], [81, 2]],
    [[88, 2], [86, 1], [84, 1], [81, 2], [79, 2]],
    [[81, 1], [84, 1], [81, 1], [79, 1], [81, 2], [79, 1], [76, 1]],
    [[79, 4], [76, 2], [79, 2]],
    [[86, 2], [84, 1], [81, 1], [79, 2], [81, 1], [79, 1]],
    [[76, 2], [79, 1], [76, 1], [74, 2], [72, 2]],
    [[74, 1], [76, 1], [79, 1], [81, 1], [79, 2], [74, 2]],
    [[72, 4], [67, 2], [72, 2]],
  ];
  const B = [
    [[81, 2], [84, 2], [88, 2], [86, 1], [84, 1]],
    [[81, 3], [79, 1], [81, 2], [84, 2]],
    [[79, 2], [76, 1], [79, 1], [84, 2], [81, 1], [79, 1]],
    [[74, 4], [76, 2], [79, 2]],
    [[81, 1], [79, 1], [81, 1], [84, 1], [88, 2], [86, 2]],
    [[84, 1], [81, 1], [79, 1], [81, 1], [84, 4]],
    [[86, 2], [84, 1], [81, 1], [79, 1], [81, 1], [79, 1], [76, 1]],
    [[74, 4], [79, 2], [0, 2]],
  ];
  const A3 = A1.slice(0, 7).concat([[[72, 2], [76, 1], [79, 1], [84, 4]]]);
  const melody = A1.concat(A2, B, A3);
  // 和弦（每半小节一个）
  const CA = [['C', 'C'], ['C', 'C'], ['F', 'F'], ['C', 'C'], ['G', 'G'], ['C', 'C'], ['F', 'G'], ['C', 'C']];
  const CB = [['Am', 'Am'], ['F', 'F'], ['C', 'C'], ['G', 'G'], ['Am', 'Am'], ['F', 'F'], ['G', 'G'], ['G', 'G']];
  const chords = CA.concat(CA, CB, CA);
  const CHORD = { C: [60, 64, 67], F: [60, 65, 69], G: [59, 62, 67], Am: [60, 64, 69] };
  const ROOT = { C: 36, F: 41, G: 43, Am: 45 };
  // 倚音：上方相邻的五声音
  const UP = { 67: 69, 69: 72, 72: 74, 74: 76, 76: 79, 79: 81, 81: 84, 84: 86, 86: 88, 88: 91 };

  const BARS = melody.length; // 32
  const LOOP = BARS * 4 * beat;
  const total = LOOP * 2 + 4;
  const mix = new Float32Array(Math.ceil(total * sr));
  const add = (b, at, g) => {
    for (const rep of [0, LOOP, 2 * LOOP]) mixInto(mix, b, at + rep, g, sr); // 叠三遍：截取的窗口首尾都完整
  };
  // 预先合成打击乐，反复使用
  const DRUM = bigDrum(sr);
  const CYM = cymbal(sr, 0.07);
  const CYM_OPEN = cymbal(sr, 0.35);
  const WOOD = woodblock(sr);
  const GONG = smallGong(sr);

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * beat;
    const phraseStart = bar % 8 === 0;
    const phraseEnd = bar % 8 === 7;
    // 旋律
    let pos = 0;
    for (const [m, len] of melody[bar]) {
      const at = t0 + pos * e8;
      const dur = len * e8;
      if (m) {
        let start = at;
        let d = dur * 0.95;
        if (len >= 2 && UP[m] && rnd() < 0.45) {
          add(flute(NOTE(UP[m]), 0.055, sr), at, 0.26);
          start += 0.055;
          d -= 0.055;
        }
        add(flute(NOTE(m), d, sr), start, 0.3);
      }
      pos += len;
    }
    // 低音：第 1 拍根音、第 3 拍五度；琵琶和弦在第 2、4 拍（“嘭—恰”）
    for (let half = 0; half < 2; half++) {
      const c = chords[bar][half];
      const tb = t0 + half * 2 * beat;
      add(pluck(NOTE(ROOT[c] + (half ? 7 : 0)), 0.9, sr, 0.45, 0.994), tb, 0.55);
      CHORD[c].forEach((n, k) => add(pluck(NOTE(n), 0.45, sr, 0.75, 0.99), tb + beat + k * 0.012, 0.16));
    }
    // 锣鼓点
    add(DRUM, t0, 0.55);
    add(DRUM, t0 + 2 * beat, 0.38);
    add(phraseStart ? CYM_OPEN : CYM, t0 + beat, phraseStart ? 0.2 : 0.16);
    add(CYM, t0 + 3 * beat, 0.16);
    for (let k = 0; k < 4; k++) add(WOOD, t0 + k * beat + e8, 0.1);
    if (phraseStart) add(GONG, t0, 0.16);
    if (phraseEnd) {
      // 句尾鼓点：咚咚咚咚
      for (let k = 0; k < 4; k++) add(DRUM, t0 + 2 * beat + k * e8, 0.28 + k * 0.05);
    }
  }

  const wet = reverb(mix, 0.12, 0.8, sr);
  // 截取第二遍：内容是周期性的，任取一段长度为 LOOP 的窗口都能无缝循环
  const from = Math.round(LOOP * sr);
  const to = Math.round((LOOP * 2 + 1.0) * sr);
  const out = normalize(wet.slice(from, to), 0.8);
  toMp3('bgm', out, { sr, br: '96k', dir: '.' });
  fs.writeFileSync(path.join(OUT, 'bgm.json'), JSON.stringify({ loop: +LOOP.toFixed(6), start: 0.5 }) + '\n');
}

fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });
const only = process.argv.find((x) => x.startsWith('--only='));
if (!process.argv.includes('--bgm-only')) for (const [name, fn] of Object.entries(SFX)) if (!only || only.slice(7).split(',').includes(name)) toMp3(name, fn());
if (!process.argv.includes('--sfx-only')) makeBgm();
fs.rmSync(TMP, { recursive: true, force: true });
