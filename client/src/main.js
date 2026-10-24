import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { setRouter } from './lib/session';
import './lib/ws'; // 注册 ws 单例的钩子
import { wantMusic } from './lib/audio';
import './styles/base.css';

setRouter(router);

// 背景音乐：用户第一次点击页面后开始播放（浏览器自动播放限制）
wantMusic(true);

// 禁用 iOS 的双指缩放手势
document.addEventListener('gesturestart', (e) => e.preventDefault());

createApp(App).use(router).mount('#app');
