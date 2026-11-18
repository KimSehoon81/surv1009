#!/usr/bin/env python3
"""지역별 레트로 전투 음악 작곡기(2026-11-18): 곡 설정(조·음계·빠르기·코드 진행·리듬 꼴) → data/music.json 악보.

결정적(곡 이름으로 시드)이라 다시 돌려도 같은 곡이 나온다. 마음에 안 드는 곡은 SONGS의 seed만 바꿔 다시 돌리거나,
music.json의 악보를 손으로 고치면 된다(이 스크립트를 다시 돌리면 여기 있는 곡만 덮어씀).
사용: python3 tools/audio/compose_bgm.py   → music.json songs, sfx.json bgm.tracks, stages.json bgm 갱신

악곡 구조: 16마디 = A(4) A'(4) B(4) A''(4). A'는 A의 앞 3마디 선율을 그대로 되풀이하고 끝만 바꿔 귀에 남게,
B는 한 옥타브 가까이 올라가 긴장, A''는 다시 처음 주제로 돌아와 으뜸음으로 끝(무한 반복 이음매가 자연스럽게).
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
SCALES = {
    'minor': [0, 2, 3, 5, 7, 8, 10],
    'harmonic': [0, 2, 3, 5, 7, 8, 11],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'major': [0, 2, 4, 5, 7, 9, 11],
}
# 리듬 꼴(8칸 = 8분음표): n 소리, . 이어서, - 쉼
RHYTHMS = {
    'march': ['n . n n n . n n', 'n . n n n . . .', 'n n n . n . n n', 'n . . n n . n .'],
    'drive': ['n n n . n n n .', 'n . n n . n n .', 'n n . n n . n n', 'n . n . n n n .'],
    'gallop': ['n . n n n . n n', 'n n n . n n n .', 'n . n n n n n .', 'n . n . n . n n'],
    'walk': ['n . . . n . n .', 'n . n . n . . .', 'n . . n n . n .', 'n . n . n n n .'],
    'epic': ['n . . . n . . .', 'n . . n n . . .', 'n . n . n . . .', 'n . . . n . n .'],
}
ENDING = 'n . . . . . - -'
BASS = {
    'march': lambda r, f, o: [r, '.', f, '.', r, '.', f, '.'],
    'drive': lambda r, f, o: [r, r, o, r, r, r, o, r],
    'gallop': lambda r, f, o: [r, '.', r, r, f, '.', f, f],
    'walk': lambda r, f, o: [r, '.', f, '.', o, '.', f, '.'],
    'epic': lambda r, f, o: [r, '.', '.', '.', f, '.', '.', '.'],
}
DRUMS = {
    'march': ('K H S H K H S H', 'K H S R K S R R'),
    'drive': ('K H S H K K S H', 'K K S H K S R R'),
    'gallop': ('K H K K S H K K', 'K H K K S R R R'),
    'walk': ('K . H . S . H H', 'K . H . S S R R'),
    'epic': ('K . H . S . H .', 'K . S . R R R R'),
}

# 코드: 음계 도수(0 = 으뜸). 16마디 진행 = A A' B A''
SONGS = [
    # 이름, 지역, 조, 음계, 빠르기, 꼴, 선율 음(5음계면 'penta'), 리드 듀티, 시드, A, A'끝, B, 설명
    dict(name='bgm_stage02', stage='S2', key='D', scale='minor', bpm=132, style='march', duty=0.25,
         A=[0, 6, 5, 4], A2=[0, 6, 5, 0], B=[3, 0, 5, 4], note='D단조 행진곡 — 호남 들판을 되찾으러'),
    dict(name='bgm_stage03', stage='S3', key='E', scale='harmonic', bpm=150, style='drive', duty=0.125,
         A=[0, 5, 3, 4], A2=[0, 5, 4, 0], B=[5, 2, 3, 4], note='E화성단조 — 몰아붙이는 시가 탈환전'),
    dict(name='bgm_stage04', stage='S4', key='D', scale='dorian', bpm=118, style='walk', duty=0.5, penta=True,
         A=[0, 3, 0, 6], A2=[0, 3, 6, 0], B=[3, 6, 0, 4], note='D도리아 5음계 — 산악 능선, 느긋하지만 단단하게'),
    dict(name='bgm_stage05', stage='S5', key='C', scale='major', bpm=152, style='gallop', duty=0.25,
         A=[0, 4, 5, 3], A2=[0, 4, 3, 0], B=[5, 3, 0, 4], note='C장조 질주 — 상륙 뒤 북진의 기세'),
    dict(name='bgm_stage06', stage='S6', key='G', scale='minor', bpm=140, style='drive', duty=0.25,
         A=[0, 3, 6, 2], A2=[0, 3, 4, 0], B=[5, 6, 0, 4], note='G단조 — 서울 시가전, 엇박 베이스'),
    dict(name='bgm_stage07', stage='S7', key='B', scale='harmonic', bpm=158, style='gallop', duty=0.125,
         A=[0, 5, 6, 4], A2=[0, 5, 4, 0], B=[3, 0, 5, 4], note='B화성단조 — 38선 돌파, 가장 빠르게'),
    dict(name='bgm_stage08', stage='S8', key='F#', scale='harmonic', bpm=136, style='march', duty=0.25,
         A=[0, 3, 4, 0], A2=[0, 3, 4, 0], B=[5, 3, 5, 4], note='F#화성단조 — 강을 사이에 둔 긴장'),
    dict(name='bgm_stage09', stage='S9', key='C', scale='minor', bpm=148, style='drive', duty=0.125,
         A=[0, 6, 5, 6], A2=[0, 6, 4, 0], B=[3, 4, 5, 4], note='C단조 — 평양 탈환, 무겁게 밀고 들어감'),
    dict(name='bgm_stage10', stage='S10', key='A', scale='minor', bpm=112, style='epic', duty=0.5, penta=True,
         A=[0, 5, 2, 6], A2=[0, 5, 6, 0], B=[3, 5, 6, 4], note='A단조 5음계 — 압록강의 겨울, 장엄하게'),
]


def midi_name(m: int) -> str:
    return f'{NAMES[m % 12]}{m // 12 - 1}'


class Key:
    def __init__(self, key: str, scale: str, penta: bool):
        self.tonic = NAMES.index(key)
        self.steps = SCALES[scale]
        # 5음계 선율: 2·6도(장조는 4·7도)를 뺌
        self.allowed = {0, 2, 3, 4, 6} if scale == 'major' and penta else ({0, 2, 3, 4, 6} if penta else set(range(7)))
        if penta and scale != 'major':
            self.allowed = {0, 2, 3, 4, 6}

    def midi(self, idx: int, base_oct: int) -> int:
        """음계 위치(idx: 도수 + 7×옥타브) → MIDI"""
        o, d = divmod(idx, 7)
        return 12 * (base_oct + 1 + o) + self.tonic + self.steps[d]

    def triad(self, deg: int) -> list[int]:
        return [deg, deg + 2, deg + 4]


def compose(cfg: dict) -> dict:
    rng = random.Random(f"{cfg['name']}:{cfg.get('seed', 1)}")
    k = Key(cfg['key'], cfg['scale'], cfg.get('penta', False))
    prog = cfg['A'] + cfg['A2'] + cfg['B'] + cfg['A']
    style = cfg['style']
    # 선율 음역: 음계 위치 7~16(대략 으뜸 위 옥타브 근처), B 부분은 +2
    lo, hi = 5, 14

    def chord_tones(deg: int) -> list[int]:
        return [t % 7 for t in k.triad(deg)]

    def nearest(target: int, cands_deg: list[int], lo_: int, hi_: int) -> int:
        best = None
        for idx in range(lo_, hi_ + 1):
            if idx % 7 in cands_deg and (idx % 7) in k.allowed | set(cands_deg[:1]):
                if best is None or abs(idx - target) < abs(best - target):
                    best = idx
        return best if best is not None else target

    rhythms = RHYTHMS[style]
    motif_r = [rng.choice(rhythms) for _ in range(4)]
    b_r = [rng.choice(rhythms) for _ in range(4)]
    lead_bars: list[list[int | str]] = []
    cur = 10
    direction = 1
    for bar, deg in enumerate(prog):
        part = bar // 4
        pos = bar % 4
        if part == 2:
            pattern = b_r[pos]
        else:
            pattern = motif_r[pos]
        last_of_song = bar == 15
        if pos == 3:
            pattern = ENDING if last_of_song or part == 1 else pattern
        # A'·A''의 앞 3마디는 A를 그대로(주제가 귀에 남게)
        if part in (1, 3) and pos < 3:
            lead_bars.append(list(lead_bars[pos]))
            continue
        shift = 2 if part == 2 else 0
        tones = chord_tones(deg)
        out: list[int | str] = []
        for i, tk in enumerate(pattern.split()):
            if tk != 'n':
                out.append(tk)
                continue
            strong = i in (0, 4)
            if (last_of_song or (part == 1 and pos == 3)) and i == 0:
                # 단락 끝은 으뜸음으로(되풀이 이음매가 자연스럽게)
                cur = nearest(7 if cur < 11 else 14, [0], lo, hi)
            elif strong:
                cur = nearest(cur + rng.choice([-1, 0, 1, 2]) * direction, tones, lo + shift, hi + shift)
            else:
                step = rng.choice([1, 1, 1, 2, -1]) * direction
                nxt = cur + step
                # 5음계면 허용 음으로
                tries = 0
                while nxt % 7 not in k.allowed and tries < 3:
                    nxt += direction
                    tries += 1
                cur = max(lo + shift, min(hi + shift, nxt))
            if cur >= hi + shift - 1:
                direction = -1
            elif cur <= lo + shift + 1:
                direction = 1
            elif rng.random() < 0.25:
                direction = -direction
            out.append(cur)
        lead_bars.append(out)

    # 리드 으뜸음(음계 위치 7)이 D#4~D5 사이에 오게: C·C#·D 조는 한 옥타브 위
    lead_base = 3 if k.tonic >= 3 else 4
    lead = [' '.join(midi_name(k.midi(t, lead_base)) if isinstance(t, int) else t for t in bar) for bar in lead_bars]
    # 받침 화음(사각파 50%): 마디 앞은 3음, 뒤는 5음
    pad = []
    for deg in prog:
        tri = k.triad(deg)
        a = midi_name(k.midi(tri[1], 3))
        b = midi_name(k.midi(tri[2], 3))
        pad.append(f'{a} . . . {b} . . .')
    # 베이스(삼각파)
    bass = []
    for deg in prog:
        # 베이스 으뜸음은 C2~B2(삼각파가 뭉개지지 않는 높이)
        r = midi_name(k.midi(deg, 2))
        f = midi_name(k.midi(deg + 4, 2))
        o = midi_name(k.midi(deg + 7, 2))
        bass.append(' '.join(BASS[style](r, f, o)))
    beat, fill = DRUMS[style]
    drums = [fill if i % 4 == 3 else beat for i in range(16)]
    if style == 'epic':
        # 아르페지오(삼각파, 높은 음역): 장엄한 겨울 분위기
        arp = []
        for deg in prog:
            t = k.triad(deg)
            ns = [midi_name(k.midi(x, 3)) for x in (t[0], t[1], t[2])]
            arp.append(f'{ns[0]} {ns[1]} {ns[2]} {ns[1]} {ns[0]} {ns[1]} {ns[2]} {ns[1]}')
    melody = [
        {'wave': 'square', 'duty': cfg['duty'], 'vol': 0.2, 'env': {'a': 0.004, 'd': 0.07, 's': 0.55, 'r': 0.04}, 'gate': 0.85 if style != 'epic' else 0.95,
         'vibrato': [0.25, 5.5, 0.18], 'bars': lead},
        {'wave': 'square', 'duty': 0.5, 'vol': 0.08, 'env': {'a': 0.02, 'd': 0.2, 's': 0.5, 'r': 0.12}, 'gate': 0.95, 'bars': pad},
        {'wave': 'triangle', 'vol': 0.42, 'env': {'a': 0.003, 'd': 0.05, 's': 0.8, 'r': 0.03}, 'gate': 0.8 if style != 'epic' else 0.95, 'bars': bass},
    ]
    if style == 'epic':
        melody.append({'wave': 'triangle', 'vol': 0.12, 'env': {'a': 0.002, 'd': 0.08, 's': 0.3, 'r': 0.05}, 'gate': 0.6, 'bars': arp})
    return {'bpm': cfg['bpm'], 'steps': 8, 'vol': 1.35, 'melody': melody, 'drums': {'vol': 0.5 if style != 'epic' else 0.42, 'bars': drums}}


def main() -> None:
    mp = ROOT / 'src/data/music.json'
    sp = ROOT / 'src/data/sfx.json'
    tp = ROOT / 'src/data/stages.json'
    music = json.loads(mp.read_text(encoding='utf-8'))
    sfx = json.loads(sp.read_text(encoding='utf-8'))
    stages = json.loads(tp.read_text(encoding='utf-8'))
    for cfg in SONGS:
        music['songs'][cfg['name']] = compose(cfg)
        sfx['bgm']['tracks'].setdefault(cfg['name'], {'vol': 0.55, 'loopStart': 0, 'loopEnd': 0})
        stages['stages'][cfg['stage']]['bgm'] = cfg['name']
        print(f"{cfg['stage']} {cfg['name']}: {cfg['note']}")
    for path, data in ((mp, music), (sp, sfx), (tp, stages)):
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
