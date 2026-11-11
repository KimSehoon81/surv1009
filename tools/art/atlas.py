#!/usr/bin/env python3
"""아틀라스 패커(D40 빌드 단계): public/assets의 시트를 종류별로 2048 이하 페이지에 묶는다.

- 대상: fx·chars·enemies·npcs·props·skills (카드·UI 아이콘·타일·지도는 캔버스 합성·반복 무늬에 원본이 필요해 제외)
- 출력: public/atlas/<종류>-<번호>.png + .json(Phaser JSON Hash, 프레임 이름 = public/assets 기준 경로), index.json(페이지·파일·생성 시각)
- 게임은 index.json을 npm run assets가 읽어 src/assets/atlases.json으로 만들고, 거기 있는 파일만 아틀라스에서 꺼낸다.
  아틀라스보다 새로 바뀐 원본은 자동으로 빠지고(개별 로드), 그림이 없는 키는 지금처럼 자리표시자.
사용: python3 tools/art/atlas.py   (npm run atlas)
"""
import json
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'public' / 'assets'
OUT = ROOT / 'public' / 'atlas'
CATS = ['fx', 'chars', 'enemies', 'npcs', 'props', 'skills']
PAGE = 2048
PAD = 2


def shelf_pack(items):
    """높이 내림차순 선반 채우기. items: [(rel, w, h)] → pages: [[(rel, x, y, w, h)]]"""
    pages, page, x, y, row = [], [], 0, 0, 0
    for rel, w, h in sorted(items, key=lambda t: (-t[2], -t[1], t[0])):
        if w > PAGE or h > PAGE:
            print(f'  건너뜀(너무 큼): {rel} {w}x{h}')
            continue
        if x + w > PAGE:
            x, y, row = 0, y + row + PAD, 0
        if y + h > PAGE:
            pages.append(page)
            page, x, y, row = [], 0, 0, 0
        page.append((rel, x, y, w, h))
        x += w + PAD
        row = max(row, h)
    if page:
        pages.append(page)
    return pages


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        old.unlink()
    index = {'builtAt': time.time(), 'pages': []}
    for cat in CATS:
        files = sorted((SRC / cat).glob('*.png')) if (SRC / cat).exists() else []
        items = []
        for f in files:
            with Image.open(f) as im:
                items.append((f'{cat}/{f.name}', im.width, im.height))
        for n, page in enumerate(shelf_pack(items)):
            w = max(x + pw for _, x, _, pw, _ in page)
            h = max(y + ph for _, _, y, _, ph in page)
            sheet = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            frames = {}
            for rel, x, y, pw, ph in page:
                with Image.open(SRC / rel) as im:
                    sheet.paste(im.convert('RGBA'), (x, y))
                frames[rel] = {'frame': {'x': x, 'y': y, 'w': pw, 'h': ph}, 'rotated': False, 'trimmed': False,
                               'spriteSourceSize': {'x': 0, 'y': 0, 'w': pw, 'h': ph}, 'sourceSize': {'w': pw, 'h': ph}}
            name = f'{cat}-{n}'
            sheet.save(OUT / f'{name}.png', optimize=True)
            (OUT / f'{name}.json').write_text(json.dumps({'frames': frames, 'meta': {'image': f'{name}.png', 'size': {'w': w, 'h': h}, 'scale': '1'}}), encoding='utf-8')
            index['pages'].append({'name': name, 'files': [rel for rel, *_ in page]})
            print(f'  {name}: {len(page)}장 {w}x{h}')
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'[atlas] 페이지 {len(index["pages"])}개 → public/atlas')
    return 0


if __name__ == '__main__':
    sys.exit(main())
