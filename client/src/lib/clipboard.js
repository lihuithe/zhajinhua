// 复制：优先 navigator.clipboard；HTTP 下降级为隐藏 textarea + execCommand
import { toast } from './ui';

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* 继续降级 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

export async function copyWithToast(text, okText) {
  const ok = await copyText(text);
  if (ok) toast(okText || '已复制', 'ok');
  else toast('请长按手动复制', 'error', 3000);
  return ok;
}
