<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { session, clearToken, goLogin } from '../lib/session';
import { toast, confirmDialog } from '../lib/ui';
import Avatar from '../components/Avatar.vue';
import Modal from '../components/Modal.vue';
import BrandLogo from '../components/BrandLogo.vue';
import SoundButton from '../components/SoundButton.vue';
import { sysState, MAINT_DEFAULT } from '../lib/sys';
import PlayingCard from '../components/PlayingCard.vue';

// 牌型大小示例
const C = (r, s) => ({ r, s });
// 电脑宽屏：左右两栏
const wide = ref(false);
let mq = null;
const onMq = () => (wide.value = !!(mq && mq.matches));
onMounted(() => {
  if (!window.matchMedia) return;
  mq = window.matchMedia('(min-width: 960px)');
  onMq();
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);
});
onBeforeUnmount(() => {
  if (!mq) return;
  if (mq.removeEventListener) mq.removeEventListener('change', onMq);
  else if (mq.removeListener) mq.removeListener(onMq);
});

// 玩法速览（宽屏右栏）
const GUIDE = [
  { ic: '💰', t: '先下底注', d: '每局开始每人先付底注，按顺时针轮流行动' },
  { ic: '🙈', t: '闷牌更便宜', d: '不看牌跟注按单注付；看过牌要按明牌倍率付（默认 ×3）' },
  { ic: '📈', t: '加注 / 跟注', d: '加注抬高单注，后面的人要跟就得付更多' },
  { ic: '⚔️', t: '比牌', d: '付一份单注和任意在场玩家比大小，输的出局' },
  { ic: '🔥', t: '孤注一掷', d: '积分不够跟注时押上全部，和所有人比，全赢才拿底池' },
  { ic: '🧧', t: '喜钱', d: '豹子、顺金赢牌，其他人额外给喜钱；人不够还能加机器人' },
];

const RANKS = [
  { name: '豹子', desc: '三张点数相同', cards: [C(14, 's'), C(14, 'h'), C(14, 'd')] },
  { name: '顺金', desc: '同花顺', cards: [C(12, 'h'), C(13, 'h'), C(14, 'h')] },
  { name: '金花', desc: '同花不连', cards: [C(2, 'c'), C(7, 'c'), C(11, 'c')] },
  { name: '顺子', desc: '连续不同花', cards: [C(4, 's'), C(5, 'h'), C(6, 'd')] },
  { name: '对子', desc: '两张相同', cards: [C(9, 's'), C(9, 'd'), C(13, 'c')] },
  { name: '单张', desc: '比最大的牌', cards: [C(3, 's'), C(8, 'h'), C(13, 'd')] },
];

const router = useRouter();
const codeInput = ref('');
const entering = ref(false);
const nickOpen = ref(false);
const nickInput = ref('');
const nickSaving = ref(false);

async function loadMe() {
  try {
    const res = await api.me();
    session.user = res.user;
    session.roomCode = res.roomCode || null;
  } catch (e) {
    if (e.code === 'NETWORK') toast(e.message, 'error');
  }
}
onMounted(loadMe);

// 去掉首尾空格；如果粘贴的是完整链接，取出其中的房间号。房间号不区分大小写，统一转成小写
function parseCode(text) {
  let t = String(text || '').trim();
  const m = t.match(/\/r\/([^/?#\s]+)/);
  if (m) t = m[1];
  return t.toLowerCase();
}

async function enterRoom() {
  const code = parseCode(codeInput.value);
  if (!code) {
    toast('请输入房间号');
    return;
  }
  if (entering.value) return;
  entering.value = true;
  try {
    const res = await api.roomInfo(code);
    if (res.exists === false) {
      toast('房间不存在，请检查房间号', 'error', 3000);
      return;
    }
    router.push('/r/' + encodeURIComponent(code));
  } catch (e) {
    if (e.status === 404 || e.code === 'ROOM_NOT_FOUND') toast('房间不存在，请检查房间号', 'error', 3000);
    else toast(e.message, 'error');
  } finally {
    entering.value = false;
  }
}

function openNick() {
  nickInput.value = (session.user && session.user.nickname) || '';
  nickOpen.value = true;
}
async function saveNick() {
  const n = nickInput.value.trim();
  if (!n || Array.from(n).length > 12) {
    toast('昵称为 1–12 个字符', 'error');
    return;
  }
  nickSaving.value = true;
  try {
    const res = await api.setNickname(n);
    session.user = res.user;
    nickOpen.value = false;
    toast('昵称已修改', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    nickSaving.value = false;
  }
}

async function doLogout() {
  const ok = await confirmDialog({ title: '退出登录', message: '确定要退出登录吗？', okText: '退出' });
  if (!ok) return;
  try {
    await api.logout();
  } catch (e) {
    /* 忽略，本地照样清除 */
  }
  clearToken();
  goLogin('');
}
</script>

<template>
  <div class="page-wrap lobby" :class="{ wide }">
    <header class="top">
      <Avatar v-if="session.user" :user-id="session.user.userId" :name="session.user.nickname" :size="46" />
      <div class="who">
        <div class="nick">{{ session.user ? session.user.nickname : '…' }}</div>
        <div class="uid">ID：{{ session.user ? session.user.username : '' }}</div>
      </div>
      <button class="tbtn" @click="openNick">改昵称</button>
      <button class="tbtn" @click="doLogout">退出</button>
      <SoundButton variant="plain" />
    </header>

    <div class="cols">
    <section class="col-main">
    <BrandLogo class="brand" :size="wide ? 'lg' : 'sm'" sub="朋友局 · 虚拟积分" />

    <div v-if="session.roomCode" class="back">
      <div>
        <div class="b1">你还在房间里</div>
        <div class="mono code">{{ session.roomCode }}</div>
      </div>
      <button class="btn btn-gold" @click="router.push('/r/' + encodeURIComponent(session.roomCode))">回到房间</button>
    </div>

    <div v-if="sysState.maintenance.enabled" class="maint">
      <b>🛠 系统维护中</b>
      <span>{{ sysState.maintenance.message || MAINT_DEFAULT }}</span>
    </div>
    <button class="create" :disabled="sysState.maintenance.enabled" @click="router.push('/create')">
      <span class="plus">+</span>
      <span class="ct">
        <b>创建房间</b>
        <small>自定义规则 · 邀请好友一起玩</small>
      </span>
    </button>

    <div class="join">
      <div class="label">输入房间号进入</div>
      <div class="row">
        <input
          v-model="codeInput"
          class="input mono"
          type="text"
          placeholder="8 位房间号（不区分大小写）"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="enterRoom"
        />
        <button class="btn btn-gold" :disabled="entering" @click="enterRoom">进入</button>
      </div>
    </div>
    </section>

    <section class="col-side">

    <div class="ranks">
      <div class="label">牌型大小 <small>从大到小</small></div>
      <div v-for="(t, i) in RANKS" :key="t.name" class="rk">
        <span class="no">{{ i + 1 }}</span>
        <span class="nm">{{ t.name }}</span>
        <span class="cs"><PlayingCard v-for="(c, k) in t.cards" :key="k" :card="c" :w="26" flat /></span>
        <span class="ds">{{ t.desc }}</span>
      </div>
      <p class="note">默认规则：花色不全相同的 2、3、5 可以吃豹子；A23 是最小的顺子。开房时可以改。</p>
    </div>

    <div v-if="wide" class="guide">
      <div class="label">玩法速览</div>
      <div v-for="x in GUIDE" :key="x.t" class="gd">
        <span class="gi">{{ x.ic }}</span>
        <span class="gt">{{ x.t }}</span>
        <span class="gs">{{ x.d }}</span>
      </div>
    </div>
    </section>
    </div>

    <p class="foot">朋友之间娱乐，使用虚拟积分，不涉及任何充值和兑换。</p>

    <Modal v-model="nickOpen" title="修改昵称" :width="360">
      <input
        v-model="nickInput"
        class="input"
        type="text"
        maxlength="12"
        placeholder="1–12 个字符"
        @keyup.enter="saveNick"
      />
      <template #footer>
        <div class="two">
          <button class="btn btn-ghost" @click="nickOpen = false">取消</button>
          <button class="btn btn-gold" :disabled="nickSaving" @click="saveNick">保存</button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  align-items: center;
  padding: 8px 8px 8px 8px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(240, 207, 122, 0.18);
  border-radius: 999px;
}
.who {
  flex: 1;
  min-width: 0;
  margin: 0 10px;
}
.nick {
  font-size: 17px;
  font-weight: 700;
  color: #ffe9b0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uid {
  font-size: 12px;
  color: var(--muted);
}
.tbtn {
  height: 34px;
  margin-left: 6px;
  padding: 0 12px;
  font-size: 13px;
  color: #e9dfc3;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
}
.brand {
  margin: 26px 0 22px;
}
.back {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 12px 14px;
  background: linear-gradient(90deg, rgba(240, 194, 79, 0.2), rgba(240, 194, 79, 0.06));
  border: 1px solid rgba(240, 207, 122, 0.5);
  border-radius: 14px;
}
.b1 {
  font-size: 13px;
  color: var(--gold);
}
.code {
  font-size: 20px;
  letter-spacing: 2px;
  color: #ffe9b0;
}
.create {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 84px;
  padding: 0 20px;
  text-align: left;
  color: #3a2603;
  background: linear-gradient(135deg, #fff0b8 0%, #f0c24f 45%, #c8861a 100%);
  border: 1px solid #ffeab0;
  border-radius: 20px;
  box-shadow: 0 6px 0 #7a520f, 0 12px 26px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6);
  transition: transform 0.08s;
}
.create:disabled {
  filter: grayscale(0.9) brightness(0.7);
  cursor: not-allowed;
}
.maint {
  display: flex;
  flex-direction: column;
  margin-bottom: 14px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: #ffd2c9;
  background: rgba(217, 65, 46, 0.16);
  border: 1px solid rgba(217, 65, 46, 0.5);
  border-radius: 14px;
}
.maint b {
  color: #ffb4a6;
}
.create:active {
  transform: translateY(3px);
  box-shadow: 0 3px 0 #7a520f, 0 8px 18px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6);
}
.plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-right: 16px;
  font-size: 36px;
  font-weight: 300;
  line-height: 1;
  color: #fff6d8;
  background: radial-gradient(circle at 35% 30%, #c8861a, #7a4a0a);
  border-radius: 50%;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.5);
}
.ct {
  display: flex;
  flex-direction: column;
}
.ct b {
  font-size: 26px;
  letter-spacing: 4px;
}
.ct small {
  margin-top: 2px;
  font-size: 13px;
  color: #6b4a0e;
}
.join,
.ranks {
  margin-top: 22px;
  padding: 14px 14px 16px;
  background: linear-gradient(180deg, rgba(22, 50, 38, 0.8), rgba(10, 26, 19, 0.8));
  border: 1px solid rgba(240, 207, 122, 0.2);
  border-radius: 18px;
}
.label {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--gold);
}
.label small {
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
}
.row {
  display: flex;
}
.row .input {
  flex: 1;
  min-width: 0;
  letter-spacing: 1px;
}
.row .btn {
  margin-left: 10px;
  flex: none;
  min-width: 76px;
}
.rk {
  display: flex;
  align-items: center;
  padding: 6px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.no {
  width: 20px;
  height: 20px;
  margin-right: 8px;
  font-size: 12px;
  font-weight: 800;
  line-height: 20px;
  text-align: center;
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #e6b84f);
  border-radius: 50%;
  flex: none;
}
.nm {
  width: 42px;
  font-weight: 700;
  color: #ffe9b0;
  flex: none;
}
.cs {
  display: flex;
  margin: 0 12px 0 4px;
  flex: none;
}
.cs > * + * {
  margin-left: 3px;
}
.ds {
  font-size: 13px;
  color: var(--muted);
}
.note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #c9b98a;
}
.foot {
  margin: 22px 0 6px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.guide {
  margin-top: 22px;
  padding: 14px 14px 10px;
  background: linear-gradient(180deg, rgba(22, 50, 38, 0.8), rgba(10, 26, 19, 0.8));
  border: 1px solid rgba(240, 207, 122, 0.2);
  border-radius: 18px;
}
.gd {
  display: grid;
  grid-template-columns: 30px 82px 1fr;
  align-items: center;
  padding: 7px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.gi {
  font-size: 18px;
}
.gt {
  font-weight: 700;
  color: #ffe9b0;
}
.gs {
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}

/* 电脑宽屏：左右两栏，整体在屏幕中间 */
.lobby.wide {
  max-width: 1160px;
  padding-left: 32px;
  padding-right: 32px;
  padding-bottom: calc(12px + var(--sab));
}
.lobby.wide .top {
  padding: 10px 14px 10px 10px;
}
.lobby.wide .cols {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  align-items: center;
  gap: 48px;
  padding: 16px 0 0;
}
.lobby.wide .foot {
  margin: 14px 0 0;
}
.lobby.wide .col-main {
  display: flex;
  flex-direction: column;
}
.lobby.wide .brand {
  margin: 0 0 30px;
}
.lobby.wide .create {
  min-height: 104px;
}
.lobby.wide .ct b {
  font-size: 30px;
}
.lobby.wide .col-side .ranks {
  margin-top: 0;
}
.lobby.wide .rk {
  padding: 4px 2px;
}
/* 玩法速览：宽屏两列小卡片 */
.lobby.wide .guide {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 10px;
  margin-top: 16px;
}
.lobby.wide .guide .label {
  grid-column: 1 / -1;
  margin-bottom: 4px;
}
.lobby.wide .gd {
  grid-template-columns: 26px 1fr;
  grid-template-areas: 'i t' 'i s';
  align-items: start;
  padding: 7px 4px;
}
.lobby.wide .gi {
  grid-area: i;
  font-size: 17px;
}
.lobby.wide .gt {
  grid-area: t;
  font-size: 14px;
}
.lobby.wide .gs {
  grid-area: s;
  font-size: 12px;
  line-height: 1.45;
}
</style>
