<script setup>
// 一局的完整记录：所有人的牌、牌型、下注、输赢、操作日志
import { computed } from 'vue';
import PlayingCard from '../PlayingCard.vue';
import Avatar from '../Avatar.vue';
import { REASON_TEXT } from '../../lib/adminApi';
import { fmtFull } from '../../lib/fmt';

const props = defineProps({ hand: { type: Object, required: true } });

const STATE = { won: '赢', lost: '比牌输', folded: '弃牌', active: '在场' };
const players = computed(() => (props.hand.players || []).slice().sort((a, b) => b.delta - a.delta));
const fmtNet = (n) => (n > 0 ? '+' + n : String(n));
</script>

<template>
  <div class="hd">
    <dl class="kv head">
      <dt>房间</dt>
      <dd class="mono">{{ hand.roomCode }} · 第 {{ hand.sessionNo }} 场 第 {{ hand.handNo }} 局</dd>
      <dt>时间</dt>
      <dd>{{ fmtFull(hand.startedAt) }} → {{ fmtFull(hand.endedAt) }}</dd>
      <dt>结束原因</dt>
      <dd>
        <span class="tag" :class="hand.reason === 'voided' ? 'gray' : 'blue'">{{ REASON_TEXT[hand.reason] || hand.reason }}</span>
        底池 <b class="gold">{{ hand.pot }}</b>
        <template v-if="hand.winners && hand.winners.length">
          · 赢家 <b>{{ hand.winners.join('、') }}</b></template
        >
      </dd>
    </dl>

    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>玩家</th>
            <th>手牌</th>
            <th>牌型</th>
            <th>看牌</th>
            <th>结果</th>
            <th class="num">下注</th>
            <th class="num">输赢</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in players" :key="p.seatIndex" :class="{ win: p.state === 'won' }">
            <td>
              <div class="who">
                <Avatar :user-id="p.userId" :name="p.nickname" :size="24" />
                <span>{{ p.nickname }}</span>
                <span class="muted">#{{ p.seatIndex + 1 }}</span>
              </div>
            </td>
            <td>
              <div class="cards">
                <PlayingCard v-for="(c, i) in p.cards" :key="i" :card="c" :w="28" flat />
              </div>
            </td>
            <td>
              {{ p.label }}<span v-if="p.is235" class="tag orange" style="margin-left: 4px">235</span>
            </td>
            <td>{{ p.seen ? '已看' : '闷' }}</td>
            <td>
              <span class="tag" :class="p.state === 'won' ? 'gold' : p.state === 'lost' ? 'red' : 'gray'">{{ STATE[p.state] || p.state }}</span>
              <span v-if="p.allIn" class="tag orange" style="margin-left: 4px">孤注</span>
            </td>
            <td class="num">{{ p.bet }}</td>
            <td class="num" :class="p.delta > 0 ? 'pos' : p.delta < 0 ? 'neg' : ''">
              <b>{{ fmtNet(p.delta) }}</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card-title" style="margin-top: 16px">操作日志</div>
    <ol class="log">
      <li v-for="(l, i) in hand.log || []" :key="i" :class="l.kind">
        <span class="t muted">{{ fmtFull(l.t).slice(11) }}</span>
        <span>{{ l.text }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 14px;
}
.gold {
  color: #ffd56b;
}
.who {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cards {
  display: flex;
  gap: 3px;
}
tr.win td {
  background: rgba(230, 184, 79, 0.08);
}
.log {
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  font-size: 13px;
  line-height: 1.9;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
}
.log .t {
  display: inline-block;
  width: 70px;
  font-variant-numeric: tabular-nums;
}
.log li.compare,
.log li.allIn {
  color: #ffb4a6;
}
.log li.win,
.log li.bonus {
  color: #ffe39a;
  font-weight: 700;
}
</style>
