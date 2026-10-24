// 聊天：表情（与服务端 CHAT_EMOJIS 一致）、快捷语、互动道具（与服务端 PROP_IDS 一致）
export const CHAT_EMOJIS = [
  '😀', '😂', '🤣', '😎', '😍', '😭', '😡', '😱', '🤔', '😏', '🙄', '😴',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '🎉', '💰', '🔥', '💯', '🍺', '🌹',
];

// 常用语：发出去时用发送者的声音念出来（语音按文字匹配，见 tools/audio/voice_lines.py 的 PHRASES）
export const CHAT_PHRASES = [
  '快点吧，等得花儿都谢了',
  '闷到底，谁怕谁',
  '这把稳了',
  '跟不跟？给句痛快话',
  '手气太差了',
  '大哥手下留情',
  '再来一把！',
  '我先撤了，下次再战',
  '你的牌打得也太好了吧',
  '不要走，决战到天亮',
  '别怂，就是干！',
  '风水轮流转，下把到我家',
  '今天手气爆棚！',
  '运气好不是我的错',
  '让你一把又何妨',
  '老板大气！',
];

export const CHAT_MAX_LEN = 60;

// 表情的声音：v = 用发送者的声音念（脸部表情），s = 音效
export const EMOJI_SOUND = {
  '😀': { v: 'emo_grin' },
  '😂': { v: 'emo_laugh' },
  '🤣': { v: 'emo_rofl' },
  '😎': { v: 'emo_cool' },
  '😍': { v: 'emo_love' },
  '😭': { v: 'emo_cry' },
  '😡': { v: 'emo_angry' },
  '😱': { v: 'emo_shock' },
  '🤔': { v: 'emo_think' },
  '😏': { v: 'emo_smirk' },
  '🙄': { v: 'emo_eyeroll' },
  '😴': { v: 'emo_sleep' },
  '👍': { s: 'like' },
  '👎': { s: 'thumbsdown' },
  '👏': { s: 'applause' },
  '🙏': { s: 'pray' },
  '💪': { s: 'muscle' },
  '🤝': { s: 'handshake' },
  '🎉': { s: 'party' },
  '💰': { s: 'coins', gain: 0.7 },
  '🔥': { s: 'fire' },
  '💯': { s: 'hundred' },
  '🍺': { s: 'clink' },
  '🌹': { s: 'sparkle' },
};

// 互动道具：点别人的头像扔过去。hit：落到对方头像时的音效；react：对方的反应（用对方的声音）
export const PROPS = [
  { id: 'flower', icon: '🌹', name: '送花', hit: 'sparkle', react: 'thanks', verb: '送给', tail: '一朵玫瑰' },
  { id: 'kiss', icon: '💋', name: '飞吻', hit: 'kiss', react: 'thanks', verb: '送给', tail: '一个飞吻' },
  { id: 'beer', icon: '🍺', name: '干杯', hit: 'clink', react: 'cheers', verb: '敬了', tail: '一杯' },
  { id: 'like', icon: '👍', name: '点赞', hit: 'like', react: 'thanks', verb: '给', tail: '点了个赞' },
  { id: 'egg', icon: '🥚', name: '鸡蛋', hit: 'splat', react: 'hit', verb: '向', tail: '扔了个鸡蛋', mean: true },
  { id: 'tomato', icon: '🍅', name: '番茄', hit: 'squish', react: 'hit', verb: '向', tail: '扔了个番茄', mean: true },
  { id: 'bomb', icon: '💣', name: '炸弹', hit: 'kaboom', react: 'hit', verb: '向', tail: '扔了颗炸弹', mean: true },
];
export const propOf = (id) => PROPS.find((p) => p.id === id) || null;
// 道具飞行时长（声音与动画共用）；炸弹落地后引线再烧一会儿才爆
export const PROP_FLY_MS = 720;
export const BOMB_FUSE_MS = 650;
/** 聊天记录里道具消息的文字：小王 向 小李 扔了个鸡蛋 */
export function propText(msg) {
  const p = propOf(msg.text);
  if (!p) return '使用了道具';
  const to = msg.toNickname || '对方';
  return p.verb === '敬了' ? `敬了 ${to} ${p.tail}` : `${p.verb} ${to} ${p.tail}`;
}
