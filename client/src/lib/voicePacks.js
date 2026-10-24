// 声音包（玩家喊话用谁的声音）与播报风格（系统播报用谁的声音）
// id 与 tools/audio/voice_lines.py、server/src/voices.js 一致；每类条数在 /audio/voice/manifest.json 里
export const VOICE_PACKS = [
  { id: 'm', name: '云舟', desc: '沉稳男声', tag: '男' },
  { id: 'f', name: '思思', desc: '爽快女声', tag: '女' },
  { id: 'qs', name: '青叔', desc: '霸气大叔', tag: '男' },
  { id: 'xz', name: '学长', desc: '阳光少年', tag: '男' },
  { id: 'yj', name: '御姐', desc: '高冷御姐', tag: '女' },
  { id: 'xm', name: '学妹', desc: '撒娇可爱', tag: '女' },
  { id: 'db', name: '东北老铁', desc: '东北话', tag: '方言' },
  { id: 'sc', name: '四川妹子', desc: '四川话', tag: '方言' },
  { id: 'yue', name: '粤语靓仔', desc: '粤语', tag: '方言' },
];
export const packOf = (id) => VOICE_PACKS.find((p) => p.id === id) || null;

// 没选过声音的玩家：按 userId 固定分一个普通话声音，让一桌人尽量各不相同
const AUTO = ['m', 'f', 'qs', 'yj', 'xz', 'xm'];
function hash(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export const autoPack = (userId) => AUTO[hash(userId + '#voice') % AUTO.length];
export const voiceOfMember = (m) => (m && packOf(m.voice) ? m.voice : autoPack(m ? m.userId : ''));

export const ANNOUNCERS = [
  { id: 'std', name: '标准荷官', desc: '亲切清晰的女声' },
  { id: 'fun', name: '搞笑解说', desc: '激情澎湃的体育解说' },
  { id: 'db', name: '东北话', desc: '热情幽默的东北大妹子' },
  { id: 'yue', name: '粤语', desc: '地道粤语播报' },
];
export const announcerOf = (id) => ANNOUNCERS.find((a) => a.id === id) || ANNOUNCERS[0];

// 试听用的台词（声音包 / 风格的第一条）
export const PACK_PREVIEW = ['raise_big', 'win', 'emo_laugh'];
export const ANNOUNCER_PREVIEW = ['your_turn', 'type_235', 'you_win'];
