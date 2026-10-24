<script setup>
import { sysState, MAINT_DEFAULT } from '../lib/sys';
import SoundButton from '../components/SoundButton.vue';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { toast } from '../lib/ui';
import ConfigForm from '../components/ConfigForm.vue';
import { mergeDefaults, mergeLimits, normalizeConfig, validateConfig } from '../lib/configMeta';

const router = useRouter();
const cfg = ref(null);
const limits = ref(mergeLimits(null));
const formRef = ref(null);
const submitting = ref(false);

// 电脑宽屏：配置表单两列 + 右侧房间概要（固定在视野里）；一开始就按当前宽度判断，避免首屏布局跳动
const WIDE_Q = '(min-width: 960px)';
const wide = ref(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(WIDE_Q).matches);
let mq = null;
const onMq = () => (wide.value = !!(mq && mq.matches));
onMounted(() => {
  if (!window.matchMedia) return;
  mq = window.matchMedia(WIDE_Q);
  if (mq.addEventListener) mq.addEventListener('change', onMq);
  else if (mq.addListener) mq.addListener(onMq);
});
onBeforeUnmount(() => {
  if (!mq) return;
  if (mq.removeEventListener) mq.removeEventListener('change', onMq);
  else if (mq.removeListener) mq.removeListener(onMq);
});

// 房间概要：关键配置一览
const summary = computed(() => {
  const c = cfg.value;
  if (!c) return [];
  const steps = (c.raiseSteps || []).map((x) => '×' + x).join(' ');
  return [
    { k: '局数', v: c.hands + ' 局' },
    { k: '初始积分', v: c.initialChips + ' 分' },
    { k: '额外领分', v: c.rebuyMax ? '最多 ' + c.rebuyMax + ' 分' : '不允许' },
    { k: '底注', v: c.ante + ' 分' },
    { k: '明牌倍率', v: '×' + c.seenMultiplier },
    { k: '加注', v: c.raiseMode === 'free' ? '自由加注（' + steps + '）' : '档位 ' + steps },
    { k: '单注封顶', v: c.capMultiple + ' 倍（' + c.ante * c.capMultiple + ' 分）' },
    { k: '轮数上限', v: c.maxRounds + ' 轮' },
    { k: '行动限时', v: c.actionSeconds + ' 秒' },
    { k: '喜钱', v: c.bonusEnabled ? '豹子 ×' + c.bonusBaozi + '　顺金 ×' + c.bonusShunjin : '不收' },
  ];
});

onMounted(async () => {
  try {
    const res = await api.configDefaults();
    limits.value = mergeLimits(res.limits);
    cfg.value = mergeDefaults(res.config);
  } catch (e) {
    // 获取失败：使用 RULES.md 的默认值兜底
    cfg.value = mergeDefaults(null);
  }
});

async function submit() {
  if (submitting.value || !cfg.value) return;
  if (sysState.maintenance.enabled) {
    toast(sysState.maintenance.message || MAINT_DEFAULT, 'error', 3500);
    return;
  }
  const config = normalizeConfig(cfg.value);
  const errs = validateConfig(config, limits.value);
  const keys = Object.keys(errs);
  if (keys.length) {
    if (formRef.value) formRef.value.revealErrors();
    toast(errs[keys[0]], 'error', 3200);
    return;
  }
  submitting.value = true;
  try {
    const res = await api.createRoom(config);
    router.replace('/r/' + encodeURIComponent(res.code));
  } catch (e) {
    toast(e.message, 'error', 3500);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-wrap create" :class="{ wide }">
    <header class="bar">
      <button class="btn btn-sm back" @click="router.push('/')">‹ 返回</button>
      <h2>创建房间</h2>
      <span class="sp"><SoundButton variant="plain" /></span>
    </header>

    <div v-if="!cfg" class="muted loading">加载配置中…</div>
    <div v-else class="layout">
      <div class="form-col">
        <ConfigForm ref="formRef" v-model="cfg" :limits="limits" :wide="wide" />
      </div>
      <aside v-if="wide" class="side">
        <div class="sum">
          <div class="sum-title">房间概要</div>
          <div v-for="r in summary" :key="r.k" class="sum-row">
            <span class="sk">{{ r.k }}</span>
            <span class="sv">{{ r.v }}</span>
          </div>
          <button class="btn btn-gold btn-block btn-lg go" :disabled="submitting" @click="submit">
            {{ submitting ? '创建中…' : '创建房间' }}
          </button>
          <p class="sum-tip">创建后把链接发给好友就能进来；准备阶段还可以改配置（初始积分除外）。</p>
        </div>
      </aside>
      <div v-else class="submit-bar">
        <button class="btn btn-gold btn-block btn-lg" :disabled="submitting" @click="submit">
          {{ submitting ? '创建中…' : '创建房间' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.bar h2 {
  margin: 0;
  font-size: 20px;
  color: var(--gold);
  letter-spacing: 2px;
}
.bar .back,
.bar .sp {
  width: 76px;
}
.bar .sp {
  display: flex;
  justify-content: flex-end;
}
.loading {
  text-align: center;
  padding: 40px 0;
}

/* 电脑宽屏：左边表单（内部两列），右边房间概要固定在视野里 */
.create.wide {
  max-width: 1200px;
  padding-left: 32px;
  padding-right: 32px;
}
.create.wide .bar {
  margin-bottom: 18px;
}
.create.wide .bar h2 {
  font-size: 24px;
}
.create.wide .layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: 24px;
}
.create.wide .form-col {
  min-width: 0;
}
.side {
  position: sticky;
  top: calc(16px + var(--sat));
}
.sum {
  padding: 18px 18px 16px;
  background: linear-gradient(180deg, rgba(30, 64, 48, 0.92), rgba(12, 30, 22, 0.92));
  border: 1px solid rgba(240, 207, 122, 0.35);
  border-radius: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.sum-title {
  margin-bottom: 8px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--gold);
}
.sum-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.sk {
  flex: none;
  color: var(--muted);
}
.sv {
  min-width: 0;
  margin-left: 12px;
  text-align: right;
  font-weight: 700;
  color: #ffe9b0;
  word-break: break-all;
}
.go {
  margin-top: 16px;
}
.sum-tip {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--muted);
}
.submit-bar {
  position: sticky;
  bottom: 0;
  padding: 12px 0 calc(8px + var(--sab));
  margin-top: 14px;
  background: linear-gradient(180deg, rgba(7, 20, 15, 0) 0%, rgba(7, 20, 15, 0.95) 35%);
}
</style>
