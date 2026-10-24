<script setup>
// 牌桌中央：准备阶段提示 / 底池与单注 / 本局结果
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import Modal from '../Modal.vue';
import Avatar from '../Avatar.vue';
import PlayingCard from '../PlayingCard.vue';

const props = defineProps({
  view: { type: Object, required: true },
  srvNow: { type: Number, default: 0 }, // 校正后的服务器时间（毫秒）
  width: { type: Number, default: 160 },
  cy: { type: Number, default: 0 }, // 牌桌中心的纵坐标（像素），0 表示居中
  compact: { type: Boolean, default: false }, // 牌桌很矮时隐藏筹码堆
});

// 底池数字滚动上涨 + 跳动
const potShow = ref(0);
const bump = ref(false);
let raf = 0;
let bumpT = 0;
watch(
  () => (props.view.hand ? props.view.hand.pot : 0),
  (to, from) => {
    cancelAnimationFrame(raf);
    if (from === undefined || to < from) {
      potShow.value = to;
      return;
    }
    const start = potShow.value;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 450);
      potShow.value = Math.round(start + (to - start) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    if (to > from) {
      bump.value = false;
      requestAnimationFrame(() => (bump.value = true));
      clearTimeout(bumpT);
      bumpT = setTimeout(() => (bump.value = false), 400);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  clearTimeout(bumpT);
});
// 底池热度：越大越“热”
const heat = computed(() => {
  const h = props.view.hand;
  if (!h) return 0;
  const r = h.pot / Math.max(1, props.view.config.ante);
  return r >= 150 ? 3 : r >= 60 ? 2 : r >= 20 ? 1 : 0;
});


const detailOpen = ref(false);

const cfg = computed(() => props.view.config);
const hand = computed(() => props.view.hand);
const phase = computed(() => props.view.phase);
const seatedCount = computed(() => props.view.seats.filter(Boolean).length);
const result = computed(() => (hand.value ? hand.value.result : null));
const ended = computed(() => !!(hand.value && hand.value.ended));

const REASON = {
  lastStanding: '其他人都已出局',
  allIn: '孤注一掷',
  showdown: '强制开牌',
  voided: '本局作废，已退还下注',
};

function nameOf(seatIndex) {
  const h = hand.value;
  const p = h && h.players.find((x) => x.seatIndex === seatIndex);
  if (p) return p.nickname;
  const s = props.view.seats[seatIndex];
  return s ? s.nickname : '座位' + (seatIndex + 1);
}

const winnerText = computed(() => {
  const r = result.value;
  if (!r || !r.winners.length) return '';
  const names = r.winners.map(nameOf);
  return names.length <= 2 ? names.join('、') : names.slice(0, 2).join('、') + ' 等' + names.length + '人';
});

const bonusText = computed(() => {
  const b = result.value && result.value.bonus;
  if (!b) return '';
  return nameOf(b.seatIndex) + ' ' + (b.type === 'baozi' ? '豹子' : '顺金') + '喜钱 +' + b.total;
});

const countdown = computed(() => {
  const at = props.view.nextHandAt;
  if (!at || phase.value !== 'playing') return 0;
  return Math.max(0, Math.ceil((at - props.srvNow) / 1000));
});

const detailRows = computed(() => {
  const r = result.value;
  const h = hand.value;
  if (!r || !h) return [];
  const myIdx = props.view.me.seatIndex;
  return r.deltas
    .map((d) => {
      const p = h.players.find((x) => x.seatIndex === d.seatIndex);
      let cards = null;
      const v = h.visible.find((x) => x.seatIndex === d.seatIndex);
      if (v) cards = v;
      else if (d.seatIndex === myIdx && h.myCards) cards = h.myCards;
      return { seatIndex: d.seatIndex, delta: d.delta, p, cards, win: r.winners.indexOf(d.seatIndex) >= 0 };
    })
    .sort((a, b) => b.delta - a.delta);
});

const fmt = (n) => (n > 0 ? '+' + n : String(n));
</script>

<template>
  <div class="center" :class="{ compact }" :style="{ width: width + 'px', top: cy ? cy + 'px' : '50%' }">
    <!-- 准备阶段 -->
    <template v-if="phase === 'waiting' || !hand">
      <div class="wait-card">
        <div class="big">等待开始</div>
        <div class="line">已入座 <b>{{ seatedCount }}</b> / 15 人</div>
        <div class="chipsline">
          <span>底注 {{ cfg.ante }}</span><span>{{ cfg.hands }} 局</span><span>明牌 ×{{ cfg.seenMultiplier }}</span>
        </div>
      </div>
    </template>

    <!-- 对局中 -->
    <template v-else-if="!ended">
      <div class="pot" :class="['heat' + heat, { bump }]">
        <span class="pl">底池</span>
        <b>{{ potShow }}</b>
      </div>
      <div class="chipsline">
        <span>闷 <b>{{ hand.currentBet }}</b></span>
        <span>明 <b>{{ hand.currentBet * cfg.seenMultiplier }}</b></span>
        <span>第 <b>{{ hand.round }}</b>/{{ cfg.maxRounds }} 轮</span>
      </div>
    </template>

    <!-- 本场暂停：有积分的入座玩家不足 2 人 -->
    <template v-else-if="view.paused">
      <div class="wait-card paused">
        <div class="big">本场暂停</div>
        <div class="line">等待玩家入座</div>
        <div class="line muted">有积分的入座玩家至少 2 人后，自动继续</div>
        <div v-if="view.me.isOwner" class="line muted">房主也可以点“提前结束本场”</div>
      </div>
    </template>

    <!-- 本局结束 -->
    <template v-else>
      <div class="res-card">
        <div class="big">{{ phase === 'finished' ? '本场结束' : '本局结束' }}</div>
        <template v-if="result">
          <div class="line muted">{{ REASON[result.reason] }}</div>
          <div v-if="winnerText" class="win">
            <b>{{ winnerText }}</b> 赢 <b class="amt">+{{ result.potWon }}</b>
          </div>
          <div v-if="bonusText" class="line bonus">{{ bonusText }}</div>
        </template>
        <div class="res-foot">
          <button class="det" @click="detailOpen = true">本局详情 ›</button>
          <span v-if="countdown" class="cd">{{ countdown }}s 后{{ hand.handNo >= cfg.hands ? '结算' : '下一局' }}</span>
        </div>
      </div>
    </template>

    <Modal v-model="detailOpen" title="本局结果" :width="460" variant="sheet">
      <div v-if="result" class="d-head">
        {{ REASON[result.reason] }}<template v-if="winnerText"> · 赢家 {{ winnerText }}</template>
      </div>
      <div v-for="r in detailRows" :key="r.seatIndex" class="d-row" :class="{ win: r.win }">
        <Avatar v-if="r.p" :user-id="r.p.userId" :name="r.p.nickname" :size="30" />
        <div class="d-name">
          <div>{{ r.p ? r.p.nickname : nameOf(r.seatIndex) }}</div>
          <div v-if="r.cards" class="d-label">{{ r.cards.label }}</div>
        </div>
        <div v-if="r.cards" class="d-cards">
          <PlayingCard v-for="(c, i) in r.cards.cards" :key="i" :card="c" :w="22" flat />
        </div>
        <b class="d-delta" :class="r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''">{{ fmt(r.delta) }}</b>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  z-index: 3; /* 在底池筹码堆之上 */
}
.big {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 3px;
  color: #ffe39a;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.line {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.35;
  color: #efe6cc;
}
.line b {
  color: #ffe39a;
}
.muted {
  color: rgba(239, 230, 204, 0.65);
}
.wait-card,
.res-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 12px 12px 10px;
  background: radial-gradient(ellipse at 50% 0%, rgba(255, 220, 140, 0.12), rgba(0, 0, 0, 0) 70%), rgba(5, 25, 16, 0.55);
  border: 1px solid rgba(240, 207, 122, 0.28);
  border-radius: 16px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.chipsline {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}
.chipsline span {
  margin: 2px 3px;
  padding: 1px 8px;
  font-size: 12px;
  line-height: 20px;
  color: #d9e6dd;
  background: rgba(0, 0, 0, 0.32);
  border-radius: 999px;
  white-space: nowrap;
}
.chipsline b {
  color: #ffe39a;
}
.pot {
  display: flex;
  align-items: baseline;
  padding: 2px 16px 4px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.35));
  border: 1px solid rgba(240, 207, 122, 0.5);
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 230, 160, 0.15);
}
.pl {
  font-size: 13px;
  color: #d8c690;
}
.pot b {
  margin-left: 8px;
  font-size: 26px;
  font-weight: 900;
  color: #ffe39a;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(255, 200, 80, 0.45);
}
.win {
  margin-top: 6px;
  font-size: 15px;
  color: #efe6cc;
}
.win b {
  color: #ffe39a;
}
.amt {
  font-size: 20px;
  color: #7dffab !important;
}
.bonus {
  color: #ffb4a6;
}
.res-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 8px;
}
.pot.bump b {
  animation: potBump 0.4s ease-out;
}
@keyframes potBump {
  30% {
    transform: scale(1.25);
    color: #fff6c8;
  }
}
.pot b {
  display: inline-block;
}
.pot.heat1 {
  border-color: rgba(255, 200, 90, 0.8);
  box-shadow: 0 0 16px rgba(255, 190, 60, 0.45), 0 4px 12px rgba(0, 0, 0, 0.4);
}
.pot.heat2 {
  border-color: #ffb347;
  box-shadow: 0 0 26px rgba(255, 150, 40, 0.7), 0 4px 12px rgba(0, 0, 0, 0.4);
}
.pot.heat2 b {
  color: #ffd27a;
}
.pot.heat3 {
  border-color: #ff7a3a;
  animation: potFire 0.9s ease-in-out infinite alternate;
}
.pot.heat3 b {
  color: #fff0b0;
  text-shadow: 0 0 12px #ff6a00, 0 0 24px #ff3000;
}
@keyframes potFire {
  from {
    box-shadow: 0 0 22px rgba(255, 110, 30, 0.75), 0 -6px 28px rgba(255, 60, 20, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  to {
    box-shadow: 0 0 34px rgba(255, 150, 40, 0.95), 0 -12px 40px rgba(255, 80, 20, 0.7), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
}
.center.compact .pot b {
  font-size: 20px;
}
.center.compact .chipsline {
  margin-top: 4px;
}
.det {
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
  color: #ffe39a;
  background: rgba(240, 207, 122, 0.14);
  border: 1px solid rgba(240, 207, 122, 0.4);
  border-radius: 999px;
}
.cd {
  margin-left: 8px;
  font-size: 13px;
  color: #ffd56b;
  font-weight: 700;
}
.d-head {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--muted);
}
.d-row {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.d-row.win {
  background: rgba(230, 184, 79, 0.12);
}
.d-name {
  flex: 1;
  min-width: 0;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-label {
  font-size: 12px;
  color: var(--gold);
}
.d-cards {
  display: flex;
  margin: 0 8px;
}
.d-cards > * + * {
  margin-left: 2px;
}
.d-delta {
  min-width: 52px;
  text-align: right;
  font-size: 16px;
}
</style>
