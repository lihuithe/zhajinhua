// 共享的“当前时间”心跳：整个应用只有一个定时器，供倒计时使用
import { ref, onMounted, onBeforeUnmount } from 'vue';

const now = ref(Date.now());
let users = 0;
let timer = 0;

export function useNow() {
  onMounted(() => {
    users++;
    now.value = Date.now();
    if (!timer) timer = setInterval(() => (now.value = Date.now()), 250);
  });
  onBeforeUnmount(() => {
    users--;
    if (users <= 0 && timer) {
      clearInterval(timer);
      timer = 0;
      users = 0;
    }
  });
  return now;
}
