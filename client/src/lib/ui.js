// 全局 Toast 与确认对话框的状态
import { reactive } from 'vue';

export const toasts = reactive([]);
let tid = 0;

export function toast(text, type = 'info', ms = 2400) {
  if (!text) return;
  const id = ++tid;
  toasts.push({ id, text: String(text), type });
  while (toasts.length > 4) toasts.shift();
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}
export const toastError = (t, ms) => toast(t, 'error', ms || 3000);
export const toastOk = (t, ms) => toast(t, 'ok', ms);

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  okText: '确定',
  cancelText: '取消',
  danger: false,
  tag: '', // 标记：例如 'turn' 表示“轮到自己时的操作确认”，轮次过了就自动关掉
  resolve: null,
});

// 返回 Promise<boolean>
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    if (confirmState.resolve) confirmState.resolve(false);
    Object.assign(confirmState, {
      open: true,
      title: '提示',
      message: '',
      okText: '确定',
      cancelText: '取消',
      danger: false,
      tag: '',
      ...opts,
      resolve,
    });
  });
}

export function settleConfirm(v) {
  const r = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  if (r) r(v);
}

/** 关掉指定标记的确认框（当作取消） */
export function cancelConfirm(tag) {
  if (confirmState.open && confirmState.tag === tag) settleConfirm(false);
}
