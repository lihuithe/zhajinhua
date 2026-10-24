// 玩家喊话用的声音包 id（与前端 client/src/lib/voicePacks.js 一致）
export const VOICE_IDS = Object.freeze(['m', 'f', 'qs', 'xz', 'yj', 'xm', 'db', 'sc', 'yue']);
export const isVoiceId = (v) => VOICE_IDS.includes(v);
