<script setup>
// 聊天面板：消息列表 + 表情 / 快捷语 / 清空 + 输入框（单独一行）
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Avatar from '../Avatar.vue';
import { CHAT_EMOJIS, CHAT_PHRASES, CHAT_MAX_LEN, propOf, propText } from '../../lib/chatMeta';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  meId: { type: String, default: '' },
  ownerId: { type: String, default: '' },
  send: { type: Function, required: true }, // ({ kind, text }) => Promise
  cleared: { type: Boolean, default: false }, // 自己清空过聊天记录
});
const emit = defineEmits(['clear']);

const input = ref('');
const tray = ref(''); // '' | 'emoji' | 'phrase'
const sending = ref(false);
const listEl = ref(null);

// 有新消息时始终滚到最底部（消息条数有上限，所以按最后一条的 id 判断）
function scrollBottom() {
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      const e2 = listEl.value;
      if (e2) e2.scrollTop = e2.scrollHeight;
    });
  });
}
const lastId = computed(() => {
  const a = props.messages;
  return a.length ? a[a.length - 1].id + ':' + a.length : '';
});
watch(lastId, scrollBottom);
// 列表高度变化（弹窗打开、表情栏收起、窗口缩放）时，原本在底部就保持在底部
let ro = null;
let atBottom = true;
function onScroll() {
  const el = listEl.value;
  if (el) atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
onMounted(() => {
  scrollBottom();
  if (typeof ResizeObserver !== 'undefined' && listEl.value) {
    ro = new ResizeObserver(() => {
      if (atBottom) {
        const el = listEl.value;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(listEl.value);
  }
});
onBeforeUnmount(() => ro && ro.disconnect());

async function doSend(kind, text) {
  if (sending.value) return false;
  sending.value = true;
  try {
    await props.send({ kind, text });
    return true;
  } catch (e) {
    return false;
  } finally {
    sending.value = false;
  }
}
async function sendText() {
  const t = input.value.trim();
  if (!t) return;
  if (await doSend('text', t)) input.value = '';
}
async function sendEmoji(e) {
  if (await doSend('emoji', e)) tray.value = '';
}
async function sendPhrase(p) {
  if (await doSend('text', p)) tray.value = '';
}
function toggleTray(k) {
  tray.value = tray.value === k ? '' : k;
}
function timeText(t) {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
</script>

<template>
  <div class="chat">
    <div ref="listEl" class="list soft-scroll" @scroll.passive="onScroll">
      <div v-if="!messages.length" class="empty">{{ cleared ? '聊天记录已清空' : '还没有人说话，打个招呼吧～' }}</div>
      <template v-for="m in messages" :key="m.id">
      <!-- 互动道具：居中的一行小字 -->
      <div v-if="m.kind === 'prop'" class="prop-line">
        <span class="pi">{{ (propOf(m.text) || {}).icon || '🎁' }}</span>
        <b>{{ m.nickname }}</b> {{ propText(m) }}
      </div>
      <div v-else class="msg" :class="{ mine: m.userId === meId }">
        <Avatar :user-id="m.userId" :name="m.nickname" :size="28" />
        <div class="body">
          <div class="who">
            <span class="nm">{{ m.nickname }}</span>
            <span v-if="m.userId === ownerId" class="tag owner">房主</span>
            <span v-if="m.seatIndex === null" class="tag spec">观战</span>
            <span class="tm">{{ timeText(m.t) }}</span>
          </div>
          <div class="bubble selectable" :class="{ emoji: m.kind === 'emoji' }">{{ m.text }}</div>
        </div>
      </div>
      </template>
    </div>

    <div v-if="tray === 'emoji'" class="tray emojis soft-scroll">
      <button v-for="e in CHAT_EMOJIS" :key="e" class="em" :disabled="sending" data-nosfx @click="sendEmoji(e)">{{ e }}</button>
    </div>
    <div v-else-if="tray === 'phrase'" class="tray phrases soft-scroll">
      <button v-for="p in CHAT_PHRASES" :key="p" class="ph" :disabled="sending" data-nosfx @click="sendPhrase(p)"><i>🔊</i>{{ p }}</button>
    </div>

    <div class="tools">
      <button class="ib" :class="{ on: tray === 'emoji' }" aria-label="表情" @click="toggleTray('emoji')">😀</button>
      <button class="ib txt" :class="{ on: tray === 'phrase' }" @click="toggleTray('phrase')">常用语</button>
      <span class="sp"></span>
      <button class="ib txt clr" :disabled="!messages.length" title="只清空自己这里的记录" @click="emit('clear')">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z"/></svg>
        清空
      </button>
    </div>
    <div class="bar">
      <input
        v-model="input"
        class="input"
        type="text"
        :maxlength="CHAT_MAX_LEN"
        placeholder="说点什么…"
        enterkeyhint="send"
        @keyup.enter="sendText"
        @focus="tray = ''"
      />
      <button class="btn btn-gold send" :disabled="sending || !input.trim()" data-nosfx @click="sendText">发送</button>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 2px 8px;
  -webkit-overflow-scrolling: touch;
}
.empty {
  padding: 30px 0;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.msg {
  display: flex;
  align-items: flex-start;
  margin-top: 10px;
}
.msg.mine {
  flex-direction: row-reverse;
}
.body {
  min-width: 0;
  max-width: 78%;
  margin: 0 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.msg.mine .body {
  align-items: flex-end;
}
.who {
  display: flex;
  align-items: center;
  margin-bottom: 3px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.msg.mine .who {
  flex-direction: row-reverse;
}
.who > * + * {
  margin-left: 5px;
}
.msg.mine .who > * + * {
  margin-left: 0;
  margin-right: 5px;
}
.nm {
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e6dcc0;
}
.tag {
  padding: 0 4px;
  font-size: 10px;
  line-height: 15px;
  border-radius: 4px;
}
.tag.owner {
  color: #3a2603;
  background: #f0c24f;
}
.tag.spec {
  color: #d5ddd8;
  background: rgba(255, 255, 255, 0.12);
}
.tm {
  font-size: 11px;
  opacity: 0.6;
}
.bubble {
  padding: 7px 11px;
  font-size: 14px;
  line-height: 1.45;
  color: #f3ecd8;
  word-break: break-word;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px 14px 14px 14px;
}
.msg.mine .bubble {
  color: #3a2603;
  background: linear-gradient(180deg, #ffe9a8, #f0c24f);
  border-color: #ffe9a8;
  border-radius: 14px 4px 14px 14px;
}
.bubble.emoji,
.msg.mine .bubble.emoji {
  padding: 0 2px;
  font-size: 34px;
  line-height: 1.15;
  background: none;
  border: 0;
}
.tray {
  flex: none;
  max-height: 168px;
  overflow-y: auto;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.emojis {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}
.em {
  height: 40px;
  font-size: 24px;
  border-radius: 10px;
}
.em:active {
  background: rgba(255, 255, 255, 0.1);
}
.phrases {
  display: flex;
  flex-wrap: wrap;
}
.ph {
  margin: 3px;
  padding: 6px 10px;
  font-size: 13px;
  color: #e9dfc3;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(240, 207, 122, 0.25);
  border-radius: 999px;
}
.ph i {
  margin-right: 4px;
  font-size: 11px;
  font-style: normal;
  opacity: 0.7;
}
.prop-line {
  margin: 10px auto 0;
  padding: 4px 12px;
  width: fit-content;
  max-width: 92%;
  font-size: 12px;
  line-height: 1.5;
  color: #d9cfb4;
  text-align: center;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 999px;
}
.prop-line b {
  color: #ffe39a;
  font-weight: 700;
}
.prop-line .pi {
  margin-right: 4px;
  font-size: 15px;
  vertical-align: -1px;
}
.tools {
  flex: none;
  display: flex;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.tools .sp {
  flex: 1;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  padding-top: 6px;
}
.ib {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 32px;
  margin-right: 6px;
  font-size: 18px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}
.ib.txt {
  width: auto;
  padding: 0 10px;
  font-size: 12px;
  color: #e9dfc3;
}
.ib.clr {
  margin-right: 0;
  color: #cfc6ad;
}
.ib.clr svg {
  margin-right: 3px;
}
.ib:disabled {
  opacity: 0.4;
}
.ib.on {
  border-color: var(--gold);
  background: rgba(240, 207, 122, 0.15);
}
.bar .input {
  flex: 1;
  min-width: 0;
  height: 38px;
}
.send {
  flex: none;
  min-width: 64px;
  min-height: 38px;
  margin-left: 8px;
  padding: 0 10px;
  font-size: 14px;
}
</style>
