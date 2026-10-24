<script setup>
// 被同账号的其他设备 / 标签页挤下线时的提示层
import { wsState, resumeHere } from '../lib/ws';
import { clearToken, goLogin } from '../lib/session';

function logout() {
  clearToken();
  goLogin('');
}
</script>

<template>
  <transition name="fade">
    <div v-if="wsState.replaced" class="replaced-mask">
      <div class="box">
        <div class="ico">
          <svg viewBox="0 0 24 24" width="34" height="34">
            <path fill="currentColor" d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-6v2h3v2H7v-2h3v-2H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v7h14V7z" />
          </svg>
        </div>
        <h3>账号已在别处打开</h3>
        <p>这个账号在其他设备或浏览器标签页上线了，同一时间只能在一处玩。牌局不受影响，座位和积分都还在。</p>
        <button class="btn btn-gold btn-block" @click="resumeHere">在这里继续</button>
        <button class="btn btn-ghost btn-block" @click="logout">退出登录</button>
        <p class="tip">点“在这里继续”后，另一处会被挤下线。</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.replaced-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(3, 10, 7, 0.82);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.box {
  width: 100%;
  max-width: 360px;
  padding: 26px 22px 18px;
  text-align: center;
  background: linear-gradient(180deg, #17402f, #0b2419);
  border: 1px solid rgba(240, 207, 122, 0.5);
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
}
.ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  color: var(--gold);
  background: rgba(240, 207, 122, 0.12);
  border-radius: 50%;
}
h3 {
  margin: 14px 0 8px;
  font-size: 20px;
  color: #ffe9b0;
}
p {
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.6;
  color: #c9d6cf;
}
.btn + .btn {
  margin-top: 10px;
}
.tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
