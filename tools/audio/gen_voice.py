# 口播合成：火山引擎豆包语音合成 2.0（单向流式 HTTP）→ client/public/audio/voice/
#   voice/p/<声音包>/<类别>_<序号>.mp3   玩家喊话、表情、常用语、道具反应
#   voice/s/<风格>/<类别>_<序号>.mp3     系统播报
#   voice/manifest.json                  每类条数 + 常用语文字（前端据此挑文件，不用写死条数）
#   sfx/crowd_*.mp3                      人群音效：多个音色同时喊，混成一片
# 台词在 voice_lines.py。用法（项目根目录）：
#   python -I tools/audio/gen_voice.py [--only 前缀1,前缀2] [--force] [--crowd-only] [-j 6]
# 凭据：环境变量 VOLC_APP_ID、VOLC_ACCESS_KEY；没设置时读项目根目录的 .env（不提交到 git，格式见 .env.example）
# 默认增量：文字 / 音色 / 参数都没变的文件跳过（记录在 tools/audio/voice_hashes.json）。
# 依赖：Python 标准库 + ffmpeg（去首尾静音、响度统一、转 mp3、混音）
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # -I 模式不会自动把脚本目录加进 sys.path
import voice_lines as L  # noqa: E402

URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
SR = 24000
ROOT = HERE.parents[1]
OUT = ROOT / 'client' / 'public' / 'audio'
HASHES = HERE / 'voice_hashes.json'


def synth(text, speaker, app, key, rate=0, dialect=None, ctx=None):
    additions = {}
    if dialect:
        additions['explicit_dialect'] = dialect
    if ctx:
        additions['context_texts'] = [ctx]
    rp = {'text': text, 'speaker': speaker, 'audio_params': {'format': 'pcm', 'sample_rate': SR, 'speech_rate': rate}}
    if additions:
        rp['additions'] = json.dumps(additions, ensure_ascii=False)
    body = {'user': {'uid': 'zhajinhua'}, 'req_params': rp}
    h = {
        'Content-Type': 'application/json',
        'X-Api-App-Id': app,
        'X-Api-Access-Key': key,
        'X-Api-Resource-Id': 'seed-tts-2.0',
        'X-Api-Request-Id': str(uuid.uuid4()),
    }
    req = urllib.request.Request(URL, data=json.dumps(body, ensure_ascii=False).encode('utf8'), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            logid = r.headers.get('X-Tt-Logid', '')
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read()[:400]!r}')
    # 流式返回：多个 JSON 对象首尾相接
    dec, i, pcm = json.JSONDecoder(), 0, bytearray()
    txt = raw.decode('utf8', 'replace')
    while i < len(txt):
        while i < len(txt) and txt[i] in ' \r\n\t':
            i += 1
        if i >= len(txt):
            break
        o, i = dec.raw_decode(txt, i)
        code = o.get('code', 0)
        if code not in (0, 20000000):
            raise RuntimeError(f'API code {code}: {o.get("message")} logid={logid}')
        if o.get('data'):
            pcm += base64.b64decode(o['data'])
    if not pcm:
        raise RuntimeError('没有收到音频数据 logid=' + logid)
    return bytes(pcm)


def write_wav(pcm, path):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)


# 去首尾静音 → 响度统一 → 末尾留一点余量 → mp3（24kHz 单声道 48kbps，人声足够清楚、文件小）
TRIM = (
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,'
    'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,'
)


def to_mp3(pcm, out):
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / 'a.wav'
        write_wav(pcm, wav)
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-af', TRIM + 'loudnorm=I=-16:TP=-1.5:LRA=11',
             '-ar', '24000', '-ac', '1', '-b:a', '48k', str(out)],
            check=True,
        )


def mix_crowd(pcms, out, seed):
    """多条人声错开一点、音高略微不同、各自压低一些，混成人群的一片声音，加点房间混响"""
    with tempfile.TemporaryDirectory() as td:
        args, parts = [], []
        for k, pcm in enumerate(pcms):
            wav = Path(td) / f'{k}.wav'
            write_wav(pcm, wav)
            args += ['-i', str(wav)]
            delay = int((seed * 37 + k * 173) % 260)  # 0–260ms 错开
            pitch = 1 + (((seed + k * 7) % 9) - 4) * 0.018  # ±7% 音高
            vol = 0.55 + ((k * 13 + seed) % 5) * 0.08
            parts.append(
                f'[{k}:a]{TRIM}asetrate={int(SR * pitch)},aresample={SR},adelay={delay},volume={vol:.2f}[a{k}]'
            )
        n = len(pcms)
        graph = ';'.join(parts) + ';' + ''.join(f'[a{k}]' for k in range(n)) + (
            f'amix=inputs={n}:normalize=0,aecho=0.8:0.6:45|90:0.25|0.15,highpass=f=120,lowpass=f=7500,'
            'loudnorm=I=-18:TP=-1.5:LRA=11[out]'
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', *args, '-filter_complex', graph, '-map', '[out]',
             '-ar', '44100', '-ac', '1', '-b:a', '96k', str(out)],
            check=True,
        )


def job_hash(*parts):
    return hashlib.sha1(json.dumps(parts, ensure_ascii=False).encode('utf8')).hexdigest()[:16]


def build_jobs():
    """返回 (相对路径, 文本, 音色, 语速, 方言, 语气指令) 列表，以及 manifest"""
    jobs = []
    manifest = {'v': 2, 'packs': {}, 'styles': {}, 'phrases': L.PHRASES}
    for pid, pk in L.PACKS.items():
        counts = {}
        over = pk.get('lines', {})
        for cat, (mood, rate, texts) in L.PLAYER.items():
            texts = over.get(cat, texts)
            counts[cat] = len(texts)
            for k, t in enumerate(texts):
                jobs.append((f'voice/p/{pid}/{cat}_{k}.mp3', t, pk['speaker'], rate, pk.get('dialect'), pk['persona'] + '，' + mood))
        mood, rate = L.PHRASE_CTX
        counts['phrase'] = len(L.PHRASES)
        for k, t in enumerate(L.PHRASES):
            jobs.append((f'voice/p/{pid}/phrase_{k}.mp3', t, pk['speaker'], rate, pk.get('dialect'), pk['persona'] + '，' + mood))
        manifest['packs'][pid] = counts
    for sid, st in L.STYLES.items():
        lines = {**L.STD, **st['lines']}  # 缺的类别用标准台词，但仍用本风格的音色 / 方言念
        counts = {}
        for cat, texts in lines.items():
            counts[cat] = len(texts)
            mood = L.SYS_MOOD.get(cat)
            ctx = st['persona'] + ('，' + mood if mood else '')
            for k, t in enumerate(texts):
                jobs.append((f'voice/s/{sid}/{cat}_{k}.mp3', t, st['speaker'], st['rate'], st.get('dialect'), ctx))
        manifest['styles'][sid] = counts
    return jobs, manifest


def load_dotenv():
    """读项目根目录 .env 里的 KEY=VALUE（已有的环境变量优先）"""
    path = ROOT / '.env'
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
            v = v[1:-1]
        os.environ.setdefault(k, v)


def main():
    # Windows 控制台 / 重定向时默认 GBK，部分粤语字打印不出来
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, 'reconfigure'):
            s.reconfigure(encoding='utf-8', errors='replace')
    load_dotenv()
    app = os.environ.get('VOLC_APP_ID')
    key = os.environ.get('VOLC_ACCESS_KEY')
    if not (app and key):
        sys.exit('缺少凭据：请在项目根目录的 .env 里（或用环境变量）设置 VOLC_APP_ID、VOLC_ACCESS_KEY')
    argv = sys.argv[1:]
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    force = '--force' in argv
    workers = int(argv[argv.index('-j') + 1]) if '-j' in argv else 6
    hashes = json.loads(HASHES.read_text(encoding='utf8')) if HASHES.exists() else {}
    lock = threading.Lock()

    def need(rel, h):
        short = rel[len('voice/'):] if rel.startswith('voice/') else rel  # --only 可以省略 voice/ 前缀
        if only and not any(rel.startswith(p) or short.startswith(p) or Path(rel).stem.startswith(p) for p in only):
            return False
        return force or hashes.get(rel) != h or not (OUT / rel).exists()

    def run(fn, *a):
        for attempt in range(4):
            try:
                return fn(*a)
            except Exception as e:  # 限流 / 网络抖动：退避重试
                if attempt == 3:
                    raise
                print('重试', a[0] if a else '', e, file=sys.stderr)
                time.sleep(1.5 * (attempt + 1))

    jobs, manifest = build_jobs()
    todo = []
    if '--crowd-only' not in argv:
        for rel, text, spk, rate, dialect, ctx in jobs:
            h = job_hash(text, spk, rate, dialect, ctx)
            if need(rel, h):
                todo.append((rel, text, spk, rate, dialect, ctx, h))
    print(f'共 {len(jobs)} 条语音，需要合成 {len(todo)} 条')

    def do(item):
        rel, text, spk, rate, dialect, ctx, h = item
        pcm = run(synth, text, spk, app, key, rate, dialect, ctx)
        to_mp3(pcm, OUT / rel)
        with lock:
            hashes[rel] = h
        return rel, text, round(len(pcm) / 2 / SR, 2)

    done = 0
    failed = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(do, it): it for it in todo}
        for f in as_completed(futs):
            try:
                rel, text, sec = f.result()
                done += 1
                if done % 50 == 0 or done == len(todo):
                    print(f'[{done}/{len(todo)}] {rel} {text} {sec}s')
                    with lock:
                        HASHES.write_text(json.dumps(hashes, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf8')
            except Exception as e:
                failed.append((futs[f][0], str(e)))
                print('失败', futs[f][0], e, file=sys.stderr)

    # 人群音效：每个人群用一组音色各喊一句
    for name, (mood, texts) in L.CROWD.items():
        rel = f'sfx/{name}.mp3'
        h = job_hash(mood, texts, L.CROWD_SPEAKERS, 'crowd2')
        if not need(rel, h):
            continue
        pcms = []
        for k, t in enumerate(texts):
            spk = L.CROWD_SPEAKERS[k % len(L.CROWD_SPEAKERS)]
            pcms.append(run(synth, t, spk, app, key, 10, None, mood))
        mix_crowd(pcms, OUT / rel, seed=len(name))
        hashes[rel] = h
        print('人群音效', rel)

    HASHES.write_text(json.dumps(hashes, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf8')
    (OUT / 'voice' / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf8')
    if failed:
        print(f'{len(failed)} 条失败，重新运行即可只补这些：', failed[:10], file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
