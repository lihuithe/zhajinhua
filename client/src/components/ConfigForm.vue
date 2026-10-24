<script setup>
// 可复用的房间配置表单：创建房间页 与 房间内“修改配置”共用
// 基础设置固定展开；高级配置按 SECTIONS 分组，每组单独折叠，组标题下显示当前取值概要
import { reactive, ref, computed, watch, nextTick } from 'vue';
import {
  FIELDS,
  FIELD_MAP,
  SECTIONS,
  MAX_RAISE_STEPS,
  cloneConfig,
  validateConfig,
  findOption,
  mergeLimits,
  valueText,
} from '../lib/configMeta';

const props = defineProps({
  modelValue: { type: Object, required: true },
  limits: { type: Object, default: null },
  // 只读字段，例如房间准备阶段的 initialChips
  lockedKeys: { type: Array, default: () => [] },
  advancedOpen: { type: Boolean, default: false }, // 高级配置各组一开始是否展开
  wide: { type: Boolean, default: false }, // 电脑宽屏：标签在左、选项在右
});
const emit = defineEmits(['update:modelValue']);

const cfg = reactive(cloneConfig(props.modelValue));
const lim = computed(() => mergeLimits(props.limits));
const errors = computed(() => validateConfig(cfg, lim.value));
const stepInput = ref('');
const raw = reactive({}); // 整数输入框的原始文本，允许输入过程中出现中间态
const root = ref(null);

FIELDS.forEach((f) => {
  if (f.kind === 'int') raw[f.key] = String(cfg[f.key]);
});

function emitAll() {
  emit('update:modelValue', cloneConfig(cfg));
}
watch(cfg, emitAll, { deep: true });

const basicSection = {
  key: 'basic',
  title: '基础设置',
  mark: '基',
  fixed: true,
  desc: '局数、积分、底注与明牌倍率',
  fields: FIELDS.filter((f) => f.group === 'basic'),
};
const advSections = SECTIONS.map((s) => Object.assign({}, s, { fields: s.keys.map((k) => FIELD_MAP[k]) }));
// 新增的高级字段没归进任何一组时，兜底放进“其他”，不至于在界面上消失
const grouped = advSections.reduce((m, s) => m.concat(s.keys), []);
const rest = FIELDS.filter((f) => f.group !== 'basic' && grouped.indexOf(f.key) < 0);
if (rest.length) {
  advSections.push({
    key: 'other',
    title: '其他',
    mark: '他',
    fields: rest,
    summary: (c) => rest.map((f) => f.label + ' ' + valueText(f, c)),
  });
}
const sections = [basicSection].concat(advSections);

const open = reactive({});
advSections.forEach((s) => (open[s.key] = props.advancedOpen));
const allOpen = computed(() => advSections.every((s) => open[s.key]));
function toggle(s) {
  open[s.key] = !open[s.key];
}
function toggleAll() {
  const v = !allOpen.value;
  advSections.forEach((s) => (open[s.key] = v));
}
function isOpen(s) {
  return s.fixed || open[s.key];
}
function sectionBad(s) {
  return s.fields.some((f) => errors.value[f.key]);
}

function locked(key) {
  return props.lockedKeys.indexOf(key) >= 0;
}

function onInt(key, text) {
  const t = String(text).replace(/[^0-9]/g, '');
  raw[key] = t;
  cfg[key] = t === '' ? null : Number(t);
}
function setInt(key, v) {
  if (locked(key)) return;
  raw[key] = String(v);
  cfg[key] = v;
}
function setEnum(key, v) {
  if (locked(key)) return;
  cfg[key] = v;
}

function enumOptions(f) {
  const allowed = lim.value[f.key] && lim.value[f.key].options;
  return f.options.filter((o) => !allowed || allowed.indexOf(o.value) >= 0);
}
function selectedDesc(f) {
  const o = findOption(f, cfg[f.key]);
  return o && o.desc ? o.desc : '';
}

function addStep() {
  const n = Number(String(stepInput.value).replace(/[^0-9]/g, ''));
  if (!n) return;
  if (cfg.raiseSteps.length >= MAX_RAISE_STEPS || cfg.raiseSteps.indexOf(n) >= 0) {
    stepInput.value = '';
    return;
  }
  cfg.raiseSteps = cfg.raiseSteps.concat([n]).sort((a, b) => a - b);
  stepInput.value = '';
}
function removeStep(i) {
  cfg.raiseSteps = cfg.raiseSteps.filter((_, idx) => idx !== i);
}

function disabledByNeeds(f) {
  return !!(f.needs && !cfg[f.needs]);
}

function help(f) {
  return f.help(cfg);
}

// 供父组件调用：返回错误表，空对象表示通过
function validate() {
  return errors.value;
}
// 提交被拦下时：展开有错误的组，并把第一条错误滚到眼前
function revealErrors() {
  advSections.forEach((s) => {
    if (sectionBad(s)) open[s.key] = true;
  });
  nextTick(() => {
    const el = root.value && root.value.querySelector('.err');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
defineExpose({ validate, errors, revealErrors });
</script>

<template>
  <div ref="root" class="cfg" :class="{ wide }">
    <template v-for="(s, si) in sections" :key="s.key">
      <div v-if="si === 1" class="adv-hd">
        <span class="adv-tt">高级配置</span>
        <button class="adv-all" @click="toggleAll">{{ allOpen ? '全部收起' : '全部展开' }}</button>
      </div>

      <section class="sec" :class="{ open: isOpen(s), fixed: s.fixed, bad: sectionBad(s) }">
        <div v-if="s.fixed" class="sec-hd">
          <span class="mark">{{ s.mark }}</span>
          <span class="sec-main">
            <span class="sec-tt">{{ s.title }}</span>
            <span class="sec-desc">{{ s.desc }}</span>
          </span>
        </div>
        <button v-else class="sec-hd" :aria-expanded="isOpen(s) ? 'true' : 'false'" @click="toggle(s)">
          <span class="mark">{{ s.mark }}</span>
          <span class="sec-main">
            <span class="sec-tt">
              {{ s.title }}
              <span v-if="sectionBad(s)" class="sec-bad">有误</span>
            </span>
            <span class="sec-sum">
              <span v-for="(t, ti) in s.summary(cfg)" :key="ti" class="sum-t">{{ t }}</span>
            </span>
          </span>
          <span class="chev" :class="{ up: isOpen(s) }"></span>
        </button>

        <div v-show="isOpen(s)" class="sec-bd">
          <div v-for="f in s.fields" :key="f.key" class="field" :class="{ dim: disabledByNeeds(f) }">
            <div class="label">
              {{ f.label }}
              <span v-if="locked(f.key)" class="lock">创建后不可修改</span>
              <span v-else-if="disabledByNeeds(f)" class="lock">需先开启喜钱</span>
            </div>

            <div class="ctl">
              <!-- 整数：快捷值 + 自定义输入 -->
              <div v-if="f.kind === 'int'" class="opts">
                <button
                  v-for="q in lim[f.key].quick || []"
                  :key="q"
                  class="chip"
                  :class="{ on: cfg[f.key] === q }"
                  :disabled="locked(f.key)"
                  @click="setInt(f.key, q)"
                >
                  {{ q }}
                </button>
                <label class="cus">
                  <input
                    class="input"
                    :class="{ bad: errors[f.key] }"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="7"
                    :disabled="locked(f.key)"
                    :value="raw[f.key]"
                    placeholder="自定义"
                    @input="onInt(f.key, $event.target.value)"
                  />
                  <span class="unit">{{ f.unit }}</span>
                </label>
              </div>

              <!-- 枚举 -->
              <template v-else-if="f.kind === 'enum'">
                <div class="opts">
                  <button
                    v-for="o in enumOptions(f)"
                    :key="String(o.value)"
                    class="chip"
                    :class="{ on: cfg[f.key] === o.value }"
                    :disabled="locked(f.key)"
                    @click="setEnum(f.key, o.value)"
                  >
                    {{ o.label }}
                  </button>
                </div>
                <div v-if="selectedDesc(f)" class="sel-desc">{{ selectedDesc(f) }}</div>
              </template>

              <!-- 加注档位 -->
              <template v-else-if="f.kind === 'steps'">
                <div class="opts">
                  <span v-for="(s2, i) in cfg.raiseSteps" :key="s2" class="tag">
                    ×{{ s2 }}
                    <button class="tag-x" :aria-label="'删除档位' + s2" @click="removeStep(i)">×</button>
                  </span>
                  <span v-if="!cfg.raiseSteps.length" class="tag-empty">暂无档位</span>
                </div>
                <div class="opts add-row">
                  <label class="cus">
                    <input
                      v-model="stepInput"
                      class="input"
                      type="text"
                      inputmode="numeric"
                      pattern="[0-9]*"
                      maxlength="3"
                      :placeholder="cfg.raiseSteps.length >= MAX_RAISE_STEPS ? '最多 ' + MAX_RAISE_STEPS + ' 个，先删一个' : '输入倍数'"
                      :disabled="cfg.raiseSteps.length >= MAX_RAISE_STEPS"
                      @keyup.enter="addStep"
                    />
                  </label>
                  <button class="btn btn-ghost btn-sm add-btn" :disabled="cfg.raiseSteps.length >= MAX_RAISE_STEPS" @click="addStep">
                    添加
                  </button>
                </div>
              </template>

              <div v-if="errors[f.key]" class="err">{{ errors[f.key] }}</div>
              <div class="help">{{ help(f) }}</div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* ---------- 分组卡片 ---------- */
.sec {
  margin-bottom: 10px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(240, 207, 122, 0.16);
  border-radius: 16px;
  transition: border-color 0.2s, background-color 0.2s;
}
.sec.open {
  border-color: rgba(240, 207, 122, 0.34);
}
.sec.bad {
  border-color: rgba(255, 141, 122, 0.6);
}
.sec-hd {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 60px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 16px;
}
button.sec-hd:hover {
  background: rgba(255, 255, 255, 0.03);
}
.sec.open > .sec-hd {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.mark {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-right: 12px;
  font-size: 15px;
  font-weight: 800;
  color: #4a3104;
  background: radial-gradient(circle at 35% 30%, #fff1c4 0%, var(--gold-l) 22%, var(--gold) 62%, var(--gold-d) 100%);
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 0 0 3px rgba(255, 255, 255, 0.2), inset 0 0 0 4px rgba(120, 80, 10, 0.35);
}
.sec:not(.open) .mark {
  filter: saturate(0.75) brightness(0.92);
}
.sec-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.sec-tt {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--gold);
}
.sec-bad {
  margin-left: 8px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  color: #fff;
  background: var(--danger);
  border-radius: 8px;
}
/* 概要：每段一个小标签，放不下整段换行 */
.sec-sum {
  display: block;
  margin-top: 1px;
  font-size: 12px;
  line-height: 1.5;
}
.sum-t {
  display: inline-block;
  max-width: 100%;
  margin: 4px 6px 0 0;
  padding: 1px 7px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: top;
  color: #b7c8bc;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
.sec-desc {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--muted);
}
.chev {
  flex: none;
  width: 9px;
  height: 9px;
  margin: 0 6px 4px 12px;
  border-right: 2px solid var(--gold);
  border-bottom: 2px solid var(--gold);
  transform: rotate(45deg);
  transition: transform 0.2s, margin 0.2s;
}
.chev.up {
  margin-bottom: -4px;
  transform: rotate(-135deg);
}
.sec-bd {
  padding: 0 14px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  animation: sec-in 0.18s ease-out;
}
.sec.fixed .sec-bd {
  animation: none;
}
@keyframes sec-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* “高级配置”小标题 + 全部展开 */
.adv-hd {
  display: flex;
  align-items: center;
  margin: 20px 2px 10px;
}
.adv-tt {
  display: flex;
  align-items: center;
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--muted);
}
.adv-tt::after {
  content: '';
  flex: 1;
  height: 1px;
  margin: 0 12px;
  background: linear-gradient(90deg, rgba(240, 207, 122, 0.3), rgba(240, 207, 122, 0));
}
.adv-all {
  flex: none;
  min-height: 36px;
  padding: 0 4px;
  font-size: 13px;
  color: var(--gold);
}

/* ---------- 字段 ---------- */
.field {
  padding: 14px 0 16px;
}
.field + .field {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.field.dim {
  opacity: 0.55;
}
.label {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--gold);
}
.lock {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
/* 选项行：老浏览器不支持 flex gap，用外边距留空 */
.opts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0 -4px -8px;
}
.opts + .opts {
  margin-top: 10px;
}
.chip {
  min-width: 56px;
  height: 40px;
  margin: 0 4px 8px;
  padding: 0 14px;
  font-size: 15px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  transition: background-color 0.15s, border-color 0.15s;
}
.chip:hover:not(:disabled):not(.on) {
  border-color: rgba(240, 207, 122, 0.5);
}
.chip.on {
  color: #3a2603;
  font-weight: 700;
  background: linear-gradient(180deg, var(--gold-l), var(--gold));
  border-color: var(--gold-l);
}
.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 自定义输入：放得下就跟在快捷值后面，放不下自动换到下一行并占满 */
.cus {
  display: flex;
  align-items: center;
  flex: 1 1 140px;
  min-width: 0;
  margin: 0 4px 8px;
}
.cus .input {
  flex: 1;
  min-width: 0;
  height: 40px;
}
.unit {
  flex: none;
  margin-left: 8px;
  font-size: 14px;
  color: var(--muted);
}
.add-btn {
  flex: none;
  margin: 0 4px 8px;
}
.err {
  margin-top: 8px;
  font-size: 13px;
  color: #ff8d7a;
}
.sel-desc {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--gold-l);
}
.help {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--muted);
}
.tag {
  display: inline-flex;
  align-items: center;
  height: 36px;
  margin: 0 4px 8px;
  padding: 0 2px 0 12px;
  font-weight: 700;
  color: var(--gold-l);
  background: rgba(230, 184, 79, 0.14);
  border: 1px solid var(--line);
  border-radius: 18px;
}
.tag-x {
  width: 30px;
  height: 30px;
  font-size: 18px;
  color: var(--muted);
  border-radius: 50%;
}
.tag-x:hover {
  color: var(--gold-l);
}
.tag-empty {
  margin: 0 4px 8px;
  line-height: 36px;
  color: var(--muted);
}

/* ---------- 电脑宽屏：标签在左、选项在右 ---------- */
.cfg.wide .sec {
  margin-bottom: 12px;
}
.cfg.wide .sec-hd {
  min-height: 68px;
  padding: 14px 22px;
}
.cfg.wide .mark {
  width: 38px;
  height: 38px;
  margin-right: 14px;
  font-size: 16px;
}
.cfg.wide .sec-tt {
  font-size: 17px;
}
.cfg.wide .sec-sum,
.cfg.wide .sec-desc {
  font-size: 13px;
}
.cfg.wide .sec-bd {
  padding: 0 22px 4px;
}
.cfg.wide .field {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  column-gap: 20px;
  padding: 18px 0 20px;
}
.cfg.wide .label {
  margin: 0;
  padding-top: 9px;
  line-height: 1.4;
}
.cfg.wide .lock {
  display: block;
  margin: 4px 0 0;
}
.cfg.wide .cus {
  max-width: 220px;
}
.cfg.wide .adv-hd {
  margin-top: 26px;
}
/* 窄一些的电脑屏幕：标签列收窄，给选项多留空间 */
@media (max-width: 1180px) {
  .cfg.wide .field {
    grid-template-columns: 100px minmax(0, 1fr);
    column-gap: 16px;
  }
}
</style>
