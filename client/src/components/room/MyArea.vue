<script setup>
// 本人区域：我的 3 张牌 + 操作栏（按阶段切换：准备 / 对局 / 局间 / 结算）
import { ref, computed, watch } from 'vue';
import PlayingCard from '../PlayingCard.vue';
import Avatar from '../Avatar.vue';
import { confirmDialog } from '../../lib/ui';

const props = defineProps({
  view: { type: Object, required: true },
  comparing: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  cardW: { type: Number, default: 50 },
  compact: { type: Boolean, default: false }, // 矮屏：操作按钮排成一行
  srvNow: { type: Number, default: 0 },
  myTurn: { type: Boolean, default: false },
  dealing: { type: Boolean, default: false }, // 正在发牌：操作按钮暂不可用
  dealt: { type: Number, default: 3 }, // 发牌动画中，我已经拿到手的张数
});
const emit = defineEmits(['act', 'toggleCompare', 'editConfig', 'openSummary', 'endSession']);

const hand = computed(() => props.view.hand);
const me = computed(() => props.view.me);
const phase = computed(() => props.view.phase);
const seated = computed(() => me.value.seatIndex !== null && me.value.seatIndex !== undefined);
const mySeat = computed(() => (seated.value ? props.view.seats[me.value.seatIndex] : null));
const myPlayer = computed(() =>
  hand.value && seated.value ? hand.value.players.find((p) => p.seatIndex === me.value.seatIndex) || null : null,
);
const live = computed(() => !!(hand.value && !hand.value.ended && myPlayer.value));
const showActions = computed(() => live.value && myPlayer.value.state === 'active');
const actions = computed(() => (hand.value && !hand.value.ended ? hand.value.actions : null));
const myCards = computed(() => (hand.value ? hand.value.myCards : null));
const result = computed(() => (hand.value ? hand.value.result : null));
const lock = computed(() => props.busy || props.dealing);
const canStand = computed(() => seated.value && !live.value && phase.value !== 'playing');

// 操作区固定高度：三个区域高度都不随状态变化，避免牌桌上下抖动
const zoneCards = computed(() => Math.round(props.cardW * 1.4 + 30));
const zoneActs = computed(() => (props.compact ? 46 : 108));
const heroStyle = computed(() => ({
  '--zc': zoneCards.value + 'px',
  '--za': zoneActs.value + 'px',
  '--hh': 8 + zoneCards.value + 28 + 9 + zoneActs.value + 10 + 'px',
}));
const raiseOpen = ref(false);
const canRaise = computed(() => !!(actions.value && (actions.value.raise.length || actions.value.raiseRange)));
const range = computed(() => (actions.value && actions.value.raiseRange) || null);
const freeTo = ref(0);
watch(raiseOpen, (v) => {
  if (v && range.value) freeTo.value = range.value.min;
});
watch(range, (r) => {
  if (r) freeTo.value = Math.min(r.max, Math.max(r.min, freeTo.value || r.min));
});
function nudge(d) {
  const r = range.value;
  if (!r) return;
  freeTo.value = Math.min(r.max, Math.max(r.min, (Number(freeTo.value) || r.min) + d));
}
function onFreeInput(e) {
  const n = parseInt(String(e.target.value).replace(/[^0-9]/g, ''), 10);
  if (!isNaN(n)) freeTo.value = n;
}
const freeValid = computed(() => {
  const r = range.value;
  const v = Number(freeTo.value);
  return !!r && Number.isInteger(v) && v >= r.min && v <= r.max;
});
watch(actions, (a) => {
  if (!a || !a.raise.length) raiseOpen.value = false;
});

const turnLeft = computed(() => {
  const h = hand.value;
  if (!h || h.ended || !h.turnDeadline) return 0;
  return Math.max(0, Math.ceil((h.turnDeadline - props.srvNow) / 1000));
});
const turnFrac = computed(() => {
  const h = hand.value;
  if (!h || h.ended || !h.turnDeadline) return 0;
  return Math.max(0, Math.min(1, (h.turnDeadline - props.srvNow) / (props.view.config.actionSeconds * 1000)));
});
const turnSeatView = computed(() => {
  const h = hand.value;
  if (!h || h.ended || h.turnSeat === null || h.turnSeat === undefined) return null;
  return props.view.seats[h.turnSeat] || null;
});
const turnName = computed(() => {
  const h = hand.value;
  if (!h || h.turnSeat === null || h.turnSeat === undefined) return '';
  const s = props.view.seats[h.turnSeat];
  return s ? s.nickname : '';
});

const seatedList = computed(() => props.view.seats.filter(Boolean));
const startReason = computed(() => {
  if (seatedList.value.length < 2) return '至少需要 2 人入座才能开始';
  const n = seatedList.value.filter((s) => s.userId !== props.view.ownerId && !s.ready).length;
  if (n > 0) return '还有 ' + n + ' 人未准备';
  return '';
});

const hint = computed(() => {
  const ph = phase.value;
  if (ph === 'waiting') {
    if (!seated.value) return me.value.isOwner ? '你是房主，可以入座，也可以只观战主持房间' : '你在观战，点击牌桌上的空座位即可入座';
    if (me.value.isOwner) return startReason.value || '人到齐后点“开始游戏”';
    return mySeat.value && mySeat.value.ready ? '已准备，等待房主开始' : '请点“准备”';
  }
  if (ph === 'finished') return '本场已结束';
  if (props.view.paused) {
    if (seated.value) return '本场暂停：等待其他玩家入座（有积分的玩家至少 2 人）';
    return '本场暂停：空座位可以入座，坐下后本场继续';
  }
  const h = hand.value;
  if (!h) return '';
  if (h.ended) return h.handNo >= props.view.config.hands ? '本场最后一局已结束，稍后进入结算' : '本局已结束，稍后自动开始下一局';
  if (myPlayer.value) {
    const st = myPlayer.value.state;
    if (st === 'folded') return '你已弃牌，等待本局结束';
    if (st === 'lost') return '你已比牌出局，等待本局结束';
    if (h.actions) return props.comparing ? '请点击牌桌上高亮的对手' : '轮到你了！';
    return turnName.value ? '等待 ' + turnName.value + ' 行动' : '';
  }
  if (seated.value && mySeat.value) {
    if (mySeat.value.status === 'sittingOut') return '积分不足底注，本局不参与';
    return '本局结束后开始参与';
  }
  return '观战中';
});

function onCardClick() {
  if (hand.value && hand.value.canLook && !lock.value) emit('act', 'game.look');
}

async function fold() {
  const ok = await confirmDialog({ title: '弃牌', message: '确定弃牌吗？已下的注不会退还。', okText: '弃牌', danger: true, tag: 'turn' });
  if (ok) emit('act', 'game.fold');
}
async function allIn() {
  const a = actions.value && actions.value.allIn;
  if (!a) return;
  const ok = await confirmDialog({
    title: '孤注一掷',
    message:
      '将剩余的 ' +
      a.cost +
      ' 积分全部放入底池，并和所有在场玩家比牌。\n全部赢下才能赢得底池，输给任何一人就出局。确定吗？',
    okText: '孤注一掷',
    danger: true,
    tag: 'turn',
  });
  if (ok) emit('act', 'game.allIn');
}
function raise(to) {
  raiseOpen.value = false;
  emit('act', 'game.raise', { to });
}
function toggleReady() {
  emit('act', 'room.ready', { ready: !(mySeat.value && mySeat.value.ready) });
}
</script>

<template>
  <div class="hero" :class="{ hasCards: !!myPlayer, compact, turn: myTurn }" :style="heroStyle">
    <!-- 区域 1：我的牌（固定高度） -->
    <div class="z-cards">
      <div v-if="myPlayer" class="mycards" :class="{ gone: myPlayer.state === 'folded' || myPlayer.state === 'lost' }">
        <div class="cards" :class="{ canLook: !!(hand && hand.canLook), dealing }" @click="onCardClick">
          <PlayingCard
            v-for="i in 3"
            :key="i"
            :class="{ hide: dealing && i > dealt }"
            :card="myCards ? myCards.cards[i - 1] : null"
            :face-up="!!myCards"
            :w="cardW"
            :clickable="!!(hand && hand.canLook)"
          />
        </div>
        <div v-if="myCards" class="ribbon">
          {{ myCards.label }}<small v-if="myCards.is235">特殊235</small>
        </div>
        <div v-else-if="dealing" class="ribbon blind">发牌中…</div>
        <div v-else-if="myPlayer.state === 'active'" class="ribbon blind">
          闷牌中<small v-if="hand && hand.canLook"> · 轻点牌面可看</small>
        </div>
      </div>
      <div v-else class="z-empty">
        <span class="ze-ic">{{ seated ? '🪑' : '👀' }}</span>
        <span>{{ seated ? (phase === 'waiting' ? '已入座' : '等待下一局') : '观战中' }}</span>
      </div>
    </div>

    <!-- 区域 2：状态行（固定高度） + 倒计时条（始终占位） -->
    <div class="z-status">
      <div v-if="dealing" class="status"><span class="deal-ic"></span>荷官发牌中…</div>
      <div v-else-if="myTurn" class="status mine">
        <span class="dot"></span>轮到你了<b>{{ turnLeft }}s</b>
      </div>
      <div v-else-if="turnSeatView && !comparing" class="status">
        <Avatar :user-id="turnSeatView.userId" :name="turnSeatView.nickname" :size="20" />
        <span class="nm">{{ turnSeatView.nickname }}</span> 思考中<b>{{ turnLeft }}s</b>
      </div>
      <div v-else class="hint">{{ hint }}</div>
    </div>
    <div class="tbar" :class="{ mine: myTurn, low: turnLeft <= 5, off: !turnSeatView || dealing }">
      <i :style="{ transform: 'scaleX(' + (turnSeatView ? turnFrac : 0) + ')' }"></i>
    </div>

    <!-- 区域 3：操作区（固定高度） -->
    <div class="z-acts">
      <div v-if="showActions" class="acts" :class="{ compact }">
        <div class="row3">
          <button class="btn btn-gray act" :disabled="lock || !(hand && hand.canFold)" @click="fold">
            <span class="al">弃牌</span>
          </button>
          <button class="btn btn-blue act" :disabled="lock || !(hand && hand.canLook)" @click="onCardClick">
            <span class="al">看牌</span>
          </button>
          <button
            v-if="!comparing"
            class="btn btn-red act"
            :disabled="lock || !(actions && actions.compare)"
            @click="emit('toggleCompare', true)"
          >
            <span class="al">比牌</span>
            <span v-if="actions && actions.compare" class="ac">{{ actions.compare.cost }}</span>
          </button>
          <button v-else class="btn btn-gray act cancel" @click="emit('toggleCompare', false)">
            <span class="al">取消比牌</span>
          </button>
        </div>
        <div class="row2">
          <button v-if="actions && actions.allIn" class="btn btn-red act big" :disabled="lock" @click="allIn">
            <span class="al">孤注一掷</span>
            <span class="ac">{{ actions.allIn.cost }}</span>
          </button>
          <button
            v-else
            class="btn btn-green act big"
            :disabled="lock || !(actions && actions.call)"
            @click="emit('act', 'game.call')"
          >
            <span class="al">跟注</span>
            <span v-if="actions && actions.call" class="ac">{{ actions.call.cost }}</span>
          </button>
          <button
            class="btn btn-orange act big"
            :class="{ on: raiseOpen }"
            :disabled="lock || !canRaise"
            @click="raiseOpen = !raiseOpen"
          >
            <span class="al">加注 {{ raiseOpen ? '▾' : '▴' }}</span>
          </button>
        </div>

        <!-- 加注档位弹层 -->
        <div v-if="raiseOpen && actions" class="raise-pop">
          <div class="rp-title">选择加注档位<small>（按闷牌价计，实际支付见下方）</small></div>
          <div class="rp-list">
            <button
              v-for="(r, k) in actions.raise"
              :key="r.to"
              class="chip"
              :class="'t' + (k % 5)"
              :disabled="lock"
              @click="raise(r.to)"
            >
              <b>{{ r.to }}</b>
              <small>付 {{ r.cost }}</small>
            </button>
          </div>
          <div v-if="range" class="rp-free">
            <div class="rf-top">
              <span>自定义金额</span>
              <span class="rf-val">
                加到
                <input class="rf-in" type="text" inputmode="numeric" :value="freeTo" @input="onFreeInput" />
                <small>付 {{ (Number(freeTo) || 0) * range.mult }}</small>
              </span>
            </div>
            <div class="rf-row">
              <button class="rf-b rf-end" @click="freeTo = range.min">最低</button>
              <button class="rf-b" @click="nudge(-view.config.ante)">−</button>
              <input v-model.number="freeTo" class="rf-slider" type="range" :min="range.min" :max="range.max" step="1" />
              <button class="rf-b" @click="nudge(view.config.ante)">＋</button>
              <button class="rf-b rf-end" @click="freeTo = range.max">加满</button>
            </div>
            <div class="rf-lim">可加 {{ range.min }} – {{ range.max }}（闷牌价）</div>
            <button class="btn btn-orange btn-block rf-go" :disabled="lock || !freeValid" @click="raise(Number(freeTo))">
              确定加到 {{ freeTo }}
            </button>
          </div>
          <button class="rp-close" @click="raiseOpen = false">收起</button>
        </div>
      </div>

      <!-- 局间：赢家亮牌 -->
      <div v-else-if="result && result.showable" class="one-row">
        <button class="btn btn-gold main" :disabled="busy" @click="emit('act', 'game.show')">亮牌</button>
      </div>

      <!-- 准备阶段：一行放下 -->
      <div v-else-if="phase === 'waiting'" class="one-row">
        <button
          v-if="me.isOwner"
          class="btn btn-gold main"
          :disabled="busy || !!startReason"
          @click="emit('act', 'room.start')"
        >
          开始游戏
        </button>
        <button
          v-else-if="seated"
          class="btn main"
          :class="mySeat && mySeat.ready ? '' : 'btn-gold'"
          :disabled="busy"
          @click="toggleReady"
        >
          {{ mySeat && mySeat.ready ? '取消准备' : '准备' }}
        </button>
        <button v-if="me.isOwner" class="btn btn-ghost side" @click="emit('editConfig')">修改配置</button>
        <button v-if="canStand" class="btn btn-ghost side" :disabled="busy" @click="emit('act', 'seat.stand')">
          改为观战模式
        </button>
      </div>

      <!-- 结算 -->
      <div v-else-if="phase === 'finished'" class="one-row">
        <button v-if="me.isOwner" class="btn btn-gold main" :disabled="busy" @click="emit('act', 'room.restart')">
          再来一场
        </button>
        <button class="btn btn-ghost side" @click="emit('openSummary')">查看结算榜</button>
        <button v-if="canStand" class="btn btn-ghost side" :disabled="busy" @click="emit('act', 'seat.stand')">
          改为观战模式
        </button>
      </div>
    </div>
  </div>
</template>


<style scoped>
.hero {
  position: relative;
  flex: none;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 12px calc(10px + var(--sab));
  background: linear-gradient(180deg, rgba(14, 34, 26, 0.85), rgba(4, 12, 9, 0.95));
  border-top: 1px solid rgba(240, 207, 122, 0.35);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45);
}

/* 我的牌：扇形 */
.mycards {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: -2px 0 2px;
}
.mycards.gone .cards {
  opacity: 0.45;
  filter: grayscale(0.7);
}
.cards {
  position: relative;
  display: flex;
  padding-top: 6px;
}
.cards.canLook {
  cursor: pointer;
}
.cards > :deep(.pc) {
  transition: transform 0.25s;
}
.cards > :deep(.pc:nth-child(1)) {
  transform: rotate(-9deg) translate(6px, 6px);
}
.cards > :deep(.pc:nth-child(2)) {
  z-index: 1;
}
.cards > :deep(.pc:nth-child(3)) {
  transform: rotate(9deg) translate(-6px, 6px);
  z-index: 2;
}
.cards > :deep(.pc + .pc) {
  margin-left: -8px;
}
/* 发牌：每张牌从上方（牌桌方向）落进手里 */
.cards.dealing > :deep(.pc) {
  animation: card-in 0.32s cubic-bezier(0.2, 0.8, 0.3, 1.15) both;
}
.cards.dealing > :deep(.pc.hide) {
  visibility: hidden;
  animation: none;
}
/* 飞来的牌落进手里时正好对齐，这里只做一个很轻的落定 */
@keyframes card-in {
  from {
    scale: 1.04;
  }
}
.deal-ic {
  display: inline-block;
  width: 12px;
  height: 16px;
  margin-right: 6px;
  vertical-align: -2px;
  border-radius: 2px;
  background: #7d1426;
  border: 1.5px solid #fbf3df;
  animation: deal-ic 0.5s ease-in-out infinite alternate;
}
@keyframes deal-ic {
  from {
    transform: translateX(-3px) rotate(-12deg);
  }
  to {
    transform: translateX(3px) rotate(12deg);
  }
}
.look-tip {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(-50%, -50%);
  z-index: 5;
  padding: 3px 12px;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  color: #3a2603;
  background: linear-gradient(180deg, #fff0b8, #f0c24f);
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  animation: tip 1.4s ease-in-out infinite;
}
@keyframes tip {
  50% {
    transform: translate(-50%, -50%) scale(1.08);
  }
}
.ribbon {
  position: relative;
  z-index: 3;
  margin-top: -6px;
  padding: 2px 16px;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 1px;
  color: #3a2603;
  background: linear-gradient(180deg, #fff0b8 0%, #f0c24f 60%, #c8901f 100%);
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}
.ribbon small {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 11px;
  color: #fff;
  background: #c0392b;
  border-radius: 4px;
  vertical-align: 2px;
}
.ribbon.blind small {
  margin-left: 0;
  padding: 0;
  font-size: 12px;
  font-weight: 400;
  color: #b8c6bf;
  background: none;
  vertical-align: 0;
}
.ribbon.blind {
  font-size: 13px;
  font-weight: 700;
  color: #e3ebe6;
  background: linear-gradient(180deg, #5d6a66, #3a4441);
}

.hint {
  min-height: 20px;
  margin: 6px 0 6px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.hint.turn {
  font-size: 15px;
  font-weight: 800;
  color: #ffe39a;
  text-shadow: 0 0 10px rgba(255, 200, 80, 0.6);
}
@keyframes blink {
  50% {
    opacity: 0.6;
  }
}

/* 操作按钮 */
.acts {
  position: relative;
}
.row3,
.row2 {
  display: grid;
  gap: 8px;
}
.row3 {
  grid-template-columns: repeat(3, 1fr);
}
.row2 {
  grid-template-columns: 1fr 1fr;
  margin-top: 8px;
}
.act {
  flex-direction: column;
  min-width: 0;
  min-height: 46px;
  padding: 2px 4px 4px;
  border-radius: 14px;
  letter-spacing: 1px;
  line-height: 1.1;
}
.act.big {
  min-height: 52px;
}
.al {
  font-size: 16px;
  font-weight: 800;
}
.act.big .al {
  font-size: 18px;
}
.ac {
  margin-top: 2px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.btn-orange .ac {
  background: rgba(255, 255, 255, 0.35);
}
.btn.on {
  filter: brightness(1.12);
}

/* 加注档位弹层：筹码样式 */
.raise-pop {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  padding: 12px 12px 10px;
  background: linear-gradient(180deg, rgba(26, 64, 46, 0.98), rgba(10, 30, 21, 0.98));
  border: 1px solid rgba(240, 207, 122, 0.6);
  border-radius: 16px;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.6);
  animation: popUp 0.18s ease-out;
}
@keyframes popUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.rp-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #ffe39a;
  text-align: center;
}
.rp-title small {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}
.rp-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}
.chip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 66px;
  height: 66px;
  margin: 4px 6px;
  border-radius: 50%;
  color: #fff;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.4), 0 6px 12px rgba(0, 0, 0, 0.4);
  transition: transform 0.1s;
}
.chip::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 9px;
  right: 9px;
  bottom: 9px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.75);
  background: rgba(0, 0, 0, 0.12);
}
.chip:active:not(:disabled) {
  transform: translateY(2px) scale(0.96);
}
.chip:disabled {
  opacity: 0.4;
}
.chip b,
.chip small {
  position: relative;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.chip b {
  font-size: 18px;
  font-weight: 900;
  line-height: 1.05;
}
.chip small {
  font-size: 10px;
  opacity: 0.95;
}
.chip.t0 {
  background: repeating-conic-gradient(#2f9e5b 0 30deg, #e9f7ee 30deg 45deg);
}
.chip.t1 {
  background: repeating-conic-gradient(#2f7fd6 0 30deg, #e8f1fc 30deg 45deg);
}
.chip.t2 {
  background: repeating-conic-gradient(#d9412e 0 30deg, #fdeceb 30deg 45deg);
}
.chip.t3 {
  background: repeating-conic-gradient(#7b4fd6 0 30deg, #f1ebfc 30deg 45deg);
}
.chip.t4 {
  background: repeating-conic-gradient(#1d1d1d 0 30deg, #f0c24f 30deg 45deg);
}
.chip.t0::before {
  background: radial-gradient(circle, #36b469, #217a45);
}
.chip.t1::before {
  background: radial-gradient(circle, #3b8ff0, #1f5fa8);
}
.chip.t2::before {
  background: radial-gradient(circle, #ee5a45, #a82c1d);
}
.chip.t3::before {
  background: radial-gradient(circle, #9068ec, #5a35b0);
}
.chip.t4::before {
  background: radial-gradient(circle, #3a3a3a, #111);
}
.rp-close {
  display: block;
  width: 100%;
  height: 36px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.row1 {
  margin-top: 8px;
}
.row1 .btn {
  min-height: 50px;
  font-size: 18px;
  border-radius: 14px;
}
.reason {
  margin-top: 5px;
  text-align: center;
  font-size: 12.5px;
  color: #ffb4a6;
}
.sub-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.sub-row .btn {
  margin: 6px 4px 0;
  min-height: 36px;
  border-radius: 999px;
}
.sub-row .danger {
  color: #ff9a88;
  border-color: rgba(255, 154, 136, 0.4);
}

/* 行动状态胶囊 + 倒计时条 */
.status {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 6px auto 4px;
  font-size: 13px;
  color: #cfdcd5;
  white-space: nowrap;
}
.status :deep(.avatar) {
  margin-right: 6px;
}
.status .nm {
  max-width: 9em;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 700;
  color: #ffe9b0;
  margin-right: 4px;
}
.status b {
  min-width: 34px;
  margin-left: 8px;
  padding: 0 7px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  color: #ffe39a;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.status.mine {
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 2px;
  color: #ffe39a;
  text-shadow: 0 0 10px rgba(255, 200, 80, 0.6);
}
.status.mine b {
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #f0c24f);
  letter-spacing: 0;
}
.status .dot {
  width: 8px;
  height: 8px;
  margin-right: 8px;
  background: #ffd56b;
  border-radius: 50%;
  box-shadow: 0 0 8px #ffbf3a;
  animation: dot 1s ease-in-out infinite;
}
@keyframes dot {
  50% {
    transform: scale(1.6);
    opacity: 0.6;
  }
}
.tbar {
  height: 3px;
  margin: 2px 8% 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}
.tbar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #7fd8a0, #ffd56b);
  transform-origin: left center;
  transition: transform 0.25s linear;
}
.tbar.mine i {
  background: linear-gradient(90deg, #ffd56b, #ffef9a);
}
.tbar.low i {
  background: linear-gradient(90deg, #ff7a5c, #ffb36b);
}
/* 轮到我：操作区金边呼吸 */
.hero.turn {
  border-top-color: #ffd56b;
  animation: heroTurn 1.6s ease-in-out infinite;
}
@keyframes heroTurn {
  0%,
  100% {
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45), 0 -2px 18px rgba(255, 200, 80, 0.25);
  }
  50% {
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45), 0 -4px 30px rgba(255, 200, 80, 0.6);
  }
}

/* 自由加注 */
.rp-free {
  margin-top: 10px;
  padding: 10px 10px 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(240, 207, 122, 0.25);
  border-radius: 12px;
}
.rf-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
}
.rf-val {
  display: flex;
  align-items: center;
  color: #ffe39a;
}
.rf-in {
  width: 72px;
  height: 32px;
  margin: 0 6px;
  font-size: 18px;
  font-weight: 800;
  text-align: center;
  color: #ffe39a;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(240, 207, 122, 0.5);
  border-radius: 8px;
  outline: none;
}
.rf-val small {
  font-size: 12px;
  color: var(--muted);
}
.rf-row {
  display: flex;
  align-items: center;
  margin-top: 10px;
}
.rf-b {
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 22px;
  color: #ffe39a;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(240, 207, 122, 0.35);
  border-radius: 10px;
}
.rf-b.rf-end {
  width: auto;
  padding: 0 9px;
  font-size: 13px;
  font-weight: 700;
}
.rf-b + .rf-b {
  margin-left: 6px;
}
.rf-slider {
  flex: 1;
  min-width: 0;
  margin: 0 8px;
  accent-color: #f0c24f;
  height: 28px;
}
.rf-lim {
  margin-top: 4px;
  font-size: 11px;
  text-align: center;
  color: var(--muted);
}
.rf-go {
  min-height: 44px;
  margin-top: 8px;
}

/* 矮屏：五个按钮一行 */
.acts.compact {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.acts.compact .row3,
.acts.compact .row2 {
  display: contents;
}
.acts.compact .act,
.acts.compact .act.big {
  min-height: 44px;
  padding: 2px 2px 3px;
  letter-spacing: 0;
}
.acts.compact .al,
.acts.compact .act.big .al {
  font-size: 14px;
}
.acts.compact .ac {
  padding: 0 5px;
  font-size: 11px;
}
.hero.compact {
  padding-top: 4px;
}
.hero.compact .hint {
  margin: 3px 0 4px;
}

/* 固定高度的三个区域 */
.hero {
  display: flex;
  flex-direction: column;
  height: calc(var(--hh) + var(--sab));
  padding-top: 8px;
  overflow: visible;
}
.z-cards {
  flex: none;
  height: var(--zc);
  display: flex;
  align-items: center;
  justify-content: center;
}
.z-cards .mycards {
  margin: 0;
}
.z-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 14px;
  color: var(--muted);
}
.ze-ic {
  font-size: 30px;
  margin-bottom: 4px;
  opacity: 0.8;
}
.z-status {
  flex: none;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.z-status .status,
.z-status .hint {
  margin: 0;
  min-height: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.tbar {
  flex: none;
}
.tbar.off {
  visibility: hidden;
}
.z-acts {
  position: relative;
  flex: none;
  height: var(--za);
}
.one-row {
  display: flex;
  gap: 8px;
  height: 100%;
  max-height: 52px;
}
.one-row .btn {
  min-height: 0;
  height: 100%;
  min-width: 0;
  padding: 0 8px;
  border-radius: 14px;
  letter-spacing: 0;
}
.one-row .main {
  flex: 2;
  font-size: 18px;
}
.one-row .side {
  flex: 1;
  font-size: 14px;
}
.hero.compact .one-row .main {
  font-size: 16px;
}
.hero.compact .one-row .side {
  font-size: 12px;
}

/* 宽屏：牌在左，状态和操作在右；高度同样固定 */
@media (min-width: 1100px) {
  .hero {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: 28px 9px var(--za);
    grid-template-areas: 'cards status' 'cards tbar' 'cards acts';
    column-gap: 22px;
    align-content: center;
    height: calc(max(var(--zc), 28px + 9px + var(--za)) + 26px);
    padding: 12px 18px;
    border: 1px solid rgba(240, 207, 122, 0.3);
    border-bottom: 0;
  }
  .z-cards {
    grid-area: cards;
    min-width: 230px;
  }
  .z-status {
    grid-area: status;
  }
  .tbar {
    grid-area: tbar;
    margin: 3px 0 4px;
  }
  .z-acts {
    grid-area: acts;
  }
}
</style>
