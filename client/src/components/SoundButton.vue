<script setup>
// 声音设置：喇叭按钮 + 设置面板
// 「声音」：背景音乐（曲目）/ 音效 / 语音播报的开关和音量，立体声方位
// 「人声」：我的声音（别人听到我喊话用的声音，存在账号上）、播报风格（只影响自己听到的系统播报）
import { ref, computed } from 'vue';
import Modal from './Modal.vue';
import { audioState, sfx, setMusic, setTrack, MUSIC_TRACKS, previewVoice, loadManifest, voiceManifest } from '../lib/audio';
import { VOICE_PACKS, ANNOUNCERS, PACK_PREVIEW, ANNOUNCER_PREVIEW, voiceOfMember } from '../lib/voicePacks';
import { session } from '../lib/session';
import { api } from '../lib/api';
import { toast, toastError } from '../lib/ui';

defineProps({
  variant: { type: String, default: 'pill' }, // pill：圆角胶囊（牌桌角落）；tb：顶栏按钮；plain：大厅
});
const open = ref(false);
const tab = ref('sound'); // sound | voice
const anyOn = computed(() => audioState.music || audioState.sfx || audioState.voice);
const ROWS = [
  { key: 'sfx', label: '音效', desc: '筹码、发牌、比牌、输赢、表情和道具、紧张氛围' },
  { key: 'voice', label: '语音播报', desc: '玩家喊话、常用语与表情配音、荷官播报' },
];
const curTrack = computed(() => MUSIC_TRACKS.find((t) => t.id === audioState.track) || MUSIC_TRACKS[0]);
function openPanel() {
  open.value = true;
  loadManifest();
  // 直接打开房间链接时还没取过账号信息：补取一次（“我的声音”要用）
  if (session.token && !session.user) {
    api
      .me()
      .then((r) => {
        if (!session.user) session.user = r.user;
      })
      .catch(() => {});
  }
}
function toggle(k) {
  if (k === 'music') {
    setMusic(!audioState.music);
    return;
  }
  audioState[k] = !audioState[k];
  if (k === 'sfx' && audioState.sfx) sfx('ready');
}
function allOff() {
  const on = !anyOn.value;
  setMusic(on);
  audioState.sfx = on;
  audioState.voice = on;
}
function setVol(k, e) {
  audioState.vol[k] = Math.max(0, Math.min(1, Number(e.target.value) / 100));
}
// 松手时试一下音量
function tryVol(k) {
  if (k === 'sfx') sfx('chips');
  else if (k === 'voice') previewVoice('s/' + audioState.announcer + '/your_turn_0');
}

/* ---------- 人声 ---------- */
const myVoice = computed(() => (session.user ? voiceOfMember(session.user) : ''));
const chosen = computed(() => (session.user ? session.user.voice || '' : ''));
const saving = ref('');
let pv = 0;
function previewPack(id) {
  const m = voiceManifest.packs[id];
  if (!m) return;
  const cat = PACK_PREVIEW[pv++ % PACK_PREVIEW.length];
  if (m[cat]) previewVoice('p/' + id + '/' + cat + '_0');
}
async function choosePack(id) {
  if (!audioState.voice) audioState.voice = true;
  previewPack(id);
  if (!session.user || saving.value || id === chosen.value) return;
  saving.value = id;
  try {
    const r = await api.setVoice(id);
    session.user = r.user;
    toast('已换成「' + VOICE_PACKS.find((p) => p.id === id).name + '」，牌桌上的人都会听到', 'ok', 2200);
  } catch (e) {
    toastError(e.message || '保存失败');
  } finally {
    saving.value = '';
  }
}
let av = 0;
function chooseAnnouncer(id) {
  if (!audioState.voice) audioState.voice = true;
  audioState.announcer = id;
  const m = voiceManifest.styles[id];
  const cat = ANNOUNCER_PREVIEW[av++ % ANNOUNCER_PREVIEW.length];
  if (m && m[cat]) previewVoice('s/' + id + '/' + cat + '_0');
}
</script>

<template>
  <button class="snd" :class="[variant, { off: !anyOn }]" aria-label="声音设置" @click="openPanel">
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z" />
      <template v-if="anyOn">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5a3.5 3.5 0 0 1 0 5" />
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18.5 7a7 7 0 0 1 0 10" />
      </template>
      <path v-else fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6m0-6-5 6" />
    </svg>
    <span v-if="variant === 'tb'">声音</span>
  </button>

  <Modal v-model="open" title="声音设置" variant="sheet" :width="420">
    <div class="tabs">
      <button :class="{ on: tab === 'sound' }" data-nosfx @click="tab = 'sound'">声音</button>
      <button :class="{ on: tab === 'voice' }" data-nosfx @click="tab = 'voice'">人声</button>
    </div>

    <div v-if="tab === 'sound'" class="rows">
      <div class="row" @click="toggle('music')">
        <div class="txt">
          <div class="lb">背景音乐</div>
          <div class="ds">{{ audioState.music ? '正在播放：' + curTrack.name : '已关闭，打开后可以选曲目' }}</div>
        </div>
        <span class="sw" :class="{ on: audioState.music }"><i></i></span>
      </div>
      <div v-if="audioState.music" class="sub">
        <label class="vol">
          <span>音量</span>
          <input type="range" min="0" max="100" :value="Math.round(audioState.vol.music * 100)" @input="setVol('music', $event)" />
          <b>{{ Math.round(audioState.vol.music * 100) }}</b>
        </label>
        <div class="tracks">
          <button
            v-for="t in MUSIC_TRACKS"
            :key="t.id"
            class="trk"
            :class="{ on: t.id === audioState.track }"
            data-nosfx
            @click="setTrack(t.id)"
          >
            <span class="dot"></span>
            <span class="tn">{{ t.name }}</span>
            <span class="td">{{ t.desc }}</span>
          </button>
        </div>
        <p class="credit">除“喜庆锣鼓”外，曲目来自 Kevin MacLeod（incompetech.com），CC BY 4.0 授权，已转码。</p>
      </div>
      <template v-for="r in ROWS" :key="r.key">
        <div class="row" @click="toggle(r.key)">
          <div class="txt">
            <div class="lb">{{ r.label }}</div>
            <div class="ds">{{ r.desc }}</div>
          </div>
          <span class="sw" :class="{ on: audioState[r.key] }"><i></i></span>
        </div>
        <div v-if="audioState[r.key]" class="sub">
          <label class="vol">
            <span>音量</span>
            <input
              type="range"
              min="0"
              max="100"
              :value="Math.round(audioState.vol[r.key] * 100)"
              @input="setVol(r.key, $event)"
              @change="tryVol(r.key)"
            />
            <b>{{ Math.round(audioState.vol[r.key] * 100) }}</b>
          </label>
        </div>
      </template>
      <div class="row" @click="audioState.spatial = !audioState.spatial">
        <div class="txt">
          <div class="lb">立体声方位</div>
          <div class="ds">按座位方位，左边的人声音偏左、右边的偏右（戴耳机效果最好）</div>
        </div>
        <span class="sw" :class="{ on: audioState.spatial }"><i></i></span>
      </div>
    </div>

    <div v-else class="voice-tab">
      <div class="sec">
        <div class="sec-t">我的声音<small>牌桌上的人听到你喊话、念常用语时用这个声音</small></div>
        <div v-if="session.user" class="grid">
          <button
            v-for="p in VOICE_PACKS"
            :key="p.id"
            class="vc"
            :class="{ on: myVoice === p.id, busy: saving === p.id }"
            data-nosfx
            @click="choosePack(p.id)"
          >
            <span class="vn">{{ p.name }}</span>
            <span class="vd">{{ p.desc }}</span>
            <i class="vt" :class="'t-' + (p.tag === '方言' ? 'd' : p.tag === '女' ? 'f' : 'm')">{{ p.tag }}</i>
          </button>
        </div>
        <p v-if="session.user && !chosen" class="hint">还没选过：系统自动给你分了「{{ (VOICE_PACKS.find((x) => x.id === myVoice) || {}).name }}」，点一个就能换。</p>
        <p v-if="!session.user" class="hint">登录后可以选择自己的声音。</p>
      </div>
      <div class="sec">
        <div class="sec-t">播报风格<small>只影响你自己听到的荷官播报，点一下试听</small></div>
        <div class="list">
          <button
            v-for="a in ANNOUNCERS"
            :key="a.id"
            class="trk"
            :class="{ on: a.id === audioState.announcer }"
            data-nosfx
            @click="chooseAnnouncer(a.id)"
          >
            <span class="dot"></span>
            <span class="tn">{{ a.name }}</span>
            <span class="td">{{ a.desc }}</span>
          </button>
        </div>
      </div>
      <p v-if="!audioState.voice" class="warn">语音播报已关闭，选择声音时会自动打开。</p>
    </div>

    <p v-if="!audioState.supported" class="warn">当前浏览器不支持网页音频。</p>
    <p v-else-if="!audioState.unlocked" class="warn">浏览器要求先点一下页面才能出声。</p>
    <template #footer>
      <button class="btn btn-ghost btn-block" @click="allOff">{{ anyOn ? '全部静音' : '全部打开' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.snd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #e9dfc3;
}
.snd.pill {
  width: 34px;
  height: 34px;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(240, 207, 122, 0.25);
  border-radius: 50%;
}
.snd.pill svg,
.snd.plain svg {
  color: var(--gold);
}
.snd.plain {
  width: 34px;
  height: 34px;
  margin-left: 6px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
}
.snd.tb {
  height: 38px;
  margin-left: 8px;
  padding: 0 14px;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}
.snd.tb svg {
  margin-right: 6px;
  color: var(--gold);
}
.snd.off svg {
  color: #8a9590 !important;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  margin-bottom: 6px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}
.tabs button {
  flex: 1;
  height: 34px;
  font-size: 14px;
  font-weight: 700;
  color: var(--muted);
  border-radius: 9px;
  transition: background 0.18s, color 0.18s;
}
.tabs button.on {
  color: #2a1c05;
  background: linear-gradient(180deg, #ffe08a, #e2a93b);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.rows {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  padding: 12px 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  cursor: pointer;
}
.txt {
  flex: 1;
  min-width: 0;
}
.lb {
  font-size: 16px;
  font-weight: 700;
  color: #ffe9b0;
}
.ds {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}
.sw {
  position: relative;
  flex: none;
  width: 48px;
  height: 28px;
  margin-left: 12px;
  background: #3a4441;
  border-radius: 999px;
  transition: background 0.2s;
}
.sw i {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 22px;
  height: 22px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: transform 0.2s;
}
.sw.on {
  background: linear-gradient(180deg, #5fd68d, #2f9e5b);
}
.sw.on i {
  transform: translateX(20px);
}
.sub {
  padding: 2px 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.vol {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px 4px;
  font-size: 12px;
  color: var(--muted);
}
.vol span {
  flex: none;
}
.vol b {
  flex: none;
  width: 28px;
  font-size: 12px;
  font-weight: 700;
  color: #ffe39a;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.vol input {
  flex: 1;
  min-width: 0;
  height: 28px;
  accent-color: #f0c24f;
  cursor: pointer;
}
.tracks,
.list {
  display: flex;
  flex-direction: column;
  padding: 4px 0 0;
}
.trk {
  display: grid;
  grid-template-columns: 22px auto 1fr;
  align-items: center;
  width: 100%;
  padding: 8px 6px;
  text-align: left;
  border-radius: 10px;
}
.trk:hover {
  background: rgba(255, 255, 255, 0.04);
}
.trk.on {
  background: rgba(240, 207, 122, 0.12);
}
.trk .dot {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
}
.trk.on .dot {
  border-color: #f0c24f;
  background: radial-gradient(circle, #f0c24f 0 45%, transparent 50%);
}
.tn {
  font-size: 14px;
  font-weight: 700;
  color: #f3ecd8;
  white-space: nowrap;
}
.trk.on .tn {
  color: #ffe39a;
}
.td {
  margin-left: 10px;
  overflow: hidden;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.credit {
  margin: 6px 6px 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(159, 179, 166, 0.75);
}
.sec {
  padding: 8px 0 12px;
}
.sec + .sec {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.sec-t {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 2px 10px;
  font-size: 16px;
  font-weight: 700;
  color: #ffe9b0;
}
.sec-t small {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.vc {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 10px 10px 9px;
  text-align: left;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  transition: background 0.18s, border-color 0.18s, transform 0.12s;
}
.vc:active {
  transform: scale(0.97);
}
.vc.on {
  background: linear-gradient(180deg, rgba(255, 214, 110, 0.2), rgba(226, 169, 59, 0.12));
  border-color: rgba(255, 214, 110, 0.75);
  box-shadow: 0 0 0 1px rgba(255, 214, 110, 0.25) inset;
}
.vc.busy {
  opacity: 0.7;
}
.vn {
  max-width: 100%;
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  color: #f3ecd8;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.vc.on .vn {
  color: #ffe39a;
}
.vd {
  font-size: 11px;
  color: var(--muted);
}
.vt {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 5px;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  border-radius: 6px;
}
.t-m {
  color: #9fd2ff;
  background: rgba(80, 150, 230, 0.18);
}
.t-f {
  color: #ffb3cf;
  background: rgba(230, 90, 150, 0.18);
}
.t-d {
  color: #ffd38a;
  background: rgba(230, 160, 60, 0.18);
}
.hint {
  margin: 10px 2px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
.warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: #ffcf8a;
}
</style>
