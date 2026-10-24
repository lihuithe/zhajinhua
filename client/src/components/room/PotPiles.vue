<script setup>
// 底池筹码堆：围着桌心摆几簇筹码，每簇 2–4 摞，底池越大摞得越多越高，大底池时周围还散落几枚平放的筹码
// 每摞用 SVG 画：侧面有白色边花和圆柱明暗，顶面有花纹；每枚筹码稍微错位，看起来像手码出来的
// 位置是固定的“槽位”（从里往外、先上后下填），底池涨了只会多出新的摞或把摞垒高，不会整体跳动
import { computed } from 'vue';

const props = defineProps({
  pot: { type: Number, default: 0 },
  ante: { type: Number, default: 1 },
  cx: { type: Number, default: 0 },
  cy: { type: Number, default: 0 },
  ax: { type: Number, default: 200 }, // 可摆放区域的半宽
  ay: { type: Number, default: 120 }, // 可摆放区域的半高
  holeW: { type: Number, default: 160 }, // 中间要空出来的区域（底池数字面板）
  holeH: { type: Number, default: 110 },
  chipW: { type: Number, default: 24 },
});

// 筹码颜色：[面色, 侧面暗色, 边花色]
const PALETTE = {
  r: ['#d23a2e', '#8e1c14', '#fff'],
  b: ['#2f74d0', '#16437f', '#fff'],
  g: ['#25995a', '#125a33', '#fff'],
  k: ['#2e2e33', '#0d0d10', '#f2d27a'],
  p: ['#8a49c9', '#4d2478', '#fff'],
  y: ['#f0b42c', '#9a6a0c', '#fff7dc'],
};
const ORDER = ['r', 'k', 'g', 'b', 'y', 'p'];

// 伪随机（按槽位固定，不随底池变化而跳）
const prand = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const units = computed(() => props.pot / Math.max(1, props.ante));
// 筹码总数（按底池 / 底注的倍数）：300 倍以内增长快；之后每翻一倍再多约 60 枚，一直涨到约 1.7 万倍才封顶
// （以前 220 枚就封顶，底注 1 时底池七八百分就不再变化）
const MAX_CHIPS = 480;
function chipCount(u) {
  if (u <= 0) return 0;
  if (u <= 300) return Math.max(3, Math.round(4.2 * Math.pow(u, 0.6)));
  return Math.min(MAX_CHIPS, Math.round(4.2 * Math.pow(300, 0.6) + 60 * Math.log2(u / 300)));
}
const total = computed(() => chipCount(units.value));
// 普通面额（红绿蓝）和大面额（黑紫金）：后面加出来的摞越来越多用大面额，底池越大越气派
const STD = ['r', 'g', 'b'];
const BIG = ['k', 'p', 'y'];
function stackColor(k) {
  const bigP = k < 8 ? 0.15 : k < 20 ? 0.45 : 0.85;
  const pal = prand(k * 13 + 7) < bigP ? BIG : STD;
  return pal[Math.floor(prand(k * 5 + 3) * pal.length)];
}

// 簇的位置：沿着中间面板外圈。宽桌（电脑）先放上方两侧，再左右、再下方；
// 窄桌（手机竖屏，左右离座位很近）优先放上下方，正左正右放到最后，横向也收窄一些
const clusters = computed(() => {
  const cw = props.chipW;
  const tall = props.ay > props.ax * 1.2;
  const rx = props.holeW / 2 + cw * 1.5;
  const ry = props.holeH / 2 + cw * (tall ? 1.7 : 0.95);
  const xMax = Math.max(cw, props.ax - cw * (tall ? 1.6 : 0.3));
  const angles = tall
    ? [-115, -65, 115, 65, -90, 90, -145, -35, 145, 35, 180, 0]
    : [-125, -55, 180, 0, -90, 125, 55, 90, -155, -25, 155, 25];
  return angles.map((deg) => {
    const t = (deg * Math.PI) / 180;
    return {
      x: Math.max(-xMax, Math.min(xMax, Math.cos(t) * rx * 1.08)),
      // 桌心面板下面还有一行“闷 / 明 / 第几轮”，下方的簇再往下挪一点，别压住文字
      y: Math.max(-props.ay, Math.min(props.ay, Math.sin(t) * ry + (Math.sin(t) > 0.2 ? cw * 0.9 : 0))),
    };
  });
});

// 每簇里几摞的相对位置（挨着摆，前后错开一点）
const IN = [
  [0, 0],
  [0.95, 0.12],
  [0.45, -0.42],
  [-0.5, 0.38],
];

const stacks = computed(() => {
  const cw = props.chipW;
  const out = [];
  let left = total.value;
  let k = 0;
  for (let c = 0; c < clusters.value.length && left > 0; c++) {
    for (let j = 0; j < IN.length && left > 0; j++, k++) {
      // 每摞 5–12 枚；后面的摞更高（8–16 枚），整体越堆越高
      const cap = k < 20 ? 5 + Math.floor(prand(k) * 8) : 8 + Math.floor(prand(k) * 9);
      const n = Math.min(cap, left);
      left -= n;
      const base = stackColor(k);
      // 偶尔混一段别的颜色
      const alt = stackColor(k + 101);
      const chips = [];
      for (let i = 0; i < n; i++) {
        const mix = prand(k * 31 + Math.floor(i / 3)) < 0.18;
        chips.push({ c: mix ? alt : base, dx: (prand(k * 97 + i) - 0.5) * cw * 0.12 });
      }
      const cl = clusters.value[c];
      out.push({
        key: 's' + k,
        x: props.cx + cl.x + IN[j][0] * cw,
        y: props.cy + cl.y + IN[j][1] * cw,
        chips,
      });
    }
  }
  return out.sort((a, b) => a.y - b.y);
});

// 散落的平放筹码：底池大于 40 倍底注后，每簇旁边一枚
const loose = computed(() => {
  if (units.value < 40) return [];
  const cw = props.chipW;
  // 只放在已经有筹码的簇旁边（每簇 4 摞）
  const used = Math.ceil(stacks.value.length / IN.length);
  const n = Math.min(used, Math.floor((units.value - 40) / 25) + 1);
  const out = [];
  for (let c = 0; c < n; c++) {
    const cl = clusters.value[c];
    const a = prand(c + 50) * Math.PI * 2;
    out.push({
      key: 'l' + c,
      x: props.cx + cl.x + Math.cos(a) * cw * 1.25,
      y: props.cy + cl.y + Math.sin(a) * cw * 0.7 + cw * 0.3,
      c: ORDER[(c + 4) % ORDER.length],
      rot: Math.round(prand(c + 80) * 40 - 20),
    });
  }
  return out;
});

const geo = computed(() => {
  const cw = props.chipW;
  return { w: cw, rx: cw / 2, ry: cw * 0.21, step: cw * 0.15 };
});
function stackH(n) {
  const g = geo.value;
  return Math.ceil(g.ry * 2 + g.step * n + 4);
}
// 第 i 枚（从下往上）的顶面椭圆中心
function chipY(n, i) {
  const g = geo.value;
  return stackH(n) - 2 - g.ry - g.step * (i + 1);
}
// 侧面：上沿是顶面椭圆的中线，下沿是厚度往下的半个椭圆
function sidePath(i, n, dx) {
  const g = geo.value;
  const y = chipY(n, i);
  const x0 = 1 + dx;
  const x1 = x0 + g.w;
  return `M${x0},${y} L${x0},${y + g.step} A${g.rx},${g.ry} 0 0 0 ${x1},${y + g.step} L${x1},${y} Z`;
}
// 侧面中线（下半个椭圆往下挪半个厚度）：边花沿着它画，不会压到上下两枚
function spotPath(i, n, dx) {
  const g = geo.value;
  const y = chipY(n, i) + g.step / 2;
  const x0 = 1 + dx;
  return `M${x0},${y} A${g.rx},${g.ry} 0 0 0 ${x0 + g.w},${y}`;
}
</script>

<template>
  <div class="piles">
    <!-- 公用的渐变 / 花纹 -->
    <svg class="defs" width="0" height="0" aria-hidden="true">
      <defs>
        <linearGradient id="pp-shade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0.45" />
          <stop offset="0.3" stop-color="#fff" stop-opacity="0.12" />
          <stop offset="0.55" stop-color="#fff" stop-opacity="0.04" />
          <stop offset="1" stop-color="#000" stop-opacity="0.5" />
        </linearGradient>
        <radialGradient id="pp-face" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stop-color="#fff" stop-opacity="0.35" />
          <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
    </svg>

    <!-- 散落的平放筹码 -->
    <svg
      v-for="l in loose"
      :key="l.key"
      class="loose"
      :width="geo.w + 2"
      :height="geo.ry * 2 + geo.step + 3"
      :style="{ left: l.x + 'px', top: l.y + 'px', transform: 'translate(-50%, -50%) rotate(' + l.rot + 'deg)' }"
    >
      <path
        :d="`M1,${geo.ry + 1} L1,${geo.ry + 1 + geo.step} A${geo.rx},${geo.ry} 0 0 0 ${geo.w + 1},${geo.ry + 1 + geo.step} L${geo.w + 1},${geo.ry + 1} Z`"
        :fill="PALETTE[l.c][1]"
      />
      <ellipse :cx="geo.rx + 1" :cy="geo.ry + 1" :rx="geo.rx" :ry="geo.ry" :fill="PALETTE[l.c][0]" />
      <ellipse
        :cx="geo.rx + 1"
        :cy="geo.ry + 1"
        :rx="geo.rx * 0.82"
        :ry="geo.ry * 0.82"
        fill="none"
        :stroke="PALETTE[l.c][2]"
        :stroke-width="geo.w * 0.07"
        :stroke-dasharray="geo.w * 0.18 + ' ' + geo.w * 0.14"
      />
      <ellipse :cx="geo.rx + 1" :cy="geo.ry + 1" :rx="geo.rx * 0.5" :ry="geo.ry * 0.5" :fill="PALETTE[l.c][0]" stroke="rgba(255,255,255,.55)" stroke-width="0.8" />
    </svg>

    <transition-group name="pile">
      <svg
        v-for="s in stacks"
        :key="s.key"
        class="stack"
        :width="geo.w + 4"
        :height="stackH(s.chips.length)"
        :style="{ left: s.x + 'px', top: s.y + 'px', zIndex: Math.round(s.y) }"
      >
        <!-- 影子 -->
        <ellipse
          :cx="geo.rx + 2"
          :cy="stackH(s.chips.length) - geo.ry - 1"
          :rx="geo.rx * 1.12"
          :ry="geo.ry * 1.2"
          fill="rgba(0,0,0,.4)"
        />
        <g v-for="(c, i) in s.chips" :key="i" class="chip" :style="{ animationDelay: (i % 4) * 0.03 + 's' }">
          <path :d="sidePath(i, s.chips.length, c.dx)" :fill="PALETTE[c.c][1]" />
          <!-- 边花：侧面上的白色方块 -->
          <path
            :d="spotPath(i, s.chips.length, c.dx)"
            fill="none"
            :stroke="PALETTE[c.c][2]"
            :stroke-width="geo.step * 0.72"
            :stroke-dasharray="geo.w * 0.11 + ' ' + geo.w * 0.17"
            :stroke-dashoffset="(i % 3) * geo.w * 0.09"
            opacity="0.92"
          />
          <path :d="sidePath(i, s.chips.length, c.dx)" fill="url(#pp-shade)" />
          <!-- 顶面：只有最上面一枚露出来 -->
          <template v-if="i === s.chips.length - 1">
            <ellipse :cx="geo.rx + 1 + c.dx" :cy="chipY(s.chips.length, i)" :rx="geo.rx" :ry="geo.ry" :fill="PALETTE[c.c][0]" />
            <ellipse
              :cx="geo.rx + 1 + c.dx"
              :cy="chipY(s.chips.length, i)"
              :rx="geo.rx * 0.8"
              :ry="geo.ry * 0.8"
              fill="none"
              :stroke="PALETTE[c.c][2]"
              :stroke-width="geo.w * 0.075"
              :stroke-dasharray="geo.w * 0.17 + ' ' + geo.w * 0.13"
            />
            <ellipse
              :cx="geo.rx + 1 + c.dx"
              :cy="chipY(s.chips.length, i)"
              :rx="geo.rx * 0.5"
              :ry="geo.ry * 0.5"
              :fill="PALETTE[c.c][0]"
              stroke="rgba(255,255,255,.6)"
              stroke-width="0.8"
            />
            <ellipse :cx="geo.rx + 1 + c.dx" :cy="chipY(s.chips.length, i)" :rx="geo.rx" :ry="geo.ry" fill="url(#pp-face)" />
          </template>
        </g>
      </svg>
    </transition-group>
  </div>
</template>

<style scoped>
.piles {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 2;
}
.defs {
  position: absolute;
}
.stack,
.loose {
  position: absolute;
  overflow: visible;
}
/* 摞的底部中心对准槽位 */
.stack {
  transform: translate(-50%, -100%);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}
.chip {
  animation: drop 0.3s cubic-bezier(0.3, 1.5, 0.5, 1) both;
}
@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
}
.loose {
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45));
  animation: loose-in 0.35s ease-out both;
}
@keyframes loose-in {
  from {
    opacity: 0;
  }
}
.pile-enter-active {
  transition: opacity 0.25s, transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1);
}
.pile-leave-active {
  transition: opacity 0.4s, transform 0.4s;
}
.pile-enter-from {
  opacity: 0;
  transform: translate(-50%, -100%) scale(0.4);
}
.pile-leave-to {
  opacity: 0;
  transform: translate(-50%, -100%) scale(0.6);
}
</style>
