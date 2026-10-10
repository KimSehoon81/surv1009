"""후처리 자체 검증: AI 출력처럼 생긴 합성 이미지로 규격(크기·기준점·투명도)을 확인한다.

    python3 tools/art/selftest.py
"""

import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import postprocess as pp  # noqa: E402

with open(os.path.join(HERE, "prompts.json"), encoding="utf-8") as f:
    ITEMS = {it["name"]: it for it in json.load(f)}


def unit_sheet(cols, rows, body_ratio, bg=None, wide=False, overflow=False):
    """칸마다 몸체(사각형)를 baseline 8% 위에 그린 시트. bg가 있으면 불투명 배경(투명 미지원 모델 흉내)."""
    im = Image.new("RGBA", (1024, 1024), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw, ch = 1024 / cols, 1024 / rows
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw, r * ch
            base = y0 + ch * 0.92
            bh = ch * body_ratio
            bw = cw * (0.85 if wide else 0.3)
            cx = x0 + cw / 2 + (c - cols / 2) * 2  # 프레임마다 살짝 흔들림
            d.rectangle([cx - bw / 2, base - bh, cx + bw / 2, base], fill=(90, 110, 60, 255), outline=(42, 26, 16, 255), width=3)
            if overflow and r == 0 and c == 3:
                d.rectangle([cx + bw / 2, base - bh * 0.7, x0 + cw - 2, base - bh * 0.6], fill=(255, 230, 80, 255))
    return im


def fx_sheet():
    im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw, ch = 1024 / 6, 1024 / 5
    for r in range(5):
        for c in range(6):
            cx, cy = c * cw + cw / 2, r * ch + ch / 2
            rad = 10 + c * 10
            d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(255, 160, 40, 140))
            d.ellipse([cx - rad / 2, cy - rad / 2, cx + rad / 2, cy + rad / 2], fill=(255, 250, 200, 255))
    return im


def tiles_sheet():
    rng = np.random.default_rng(1)
    arr = (rng.integers(60, 90, (1024, 1024, 3))).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, np.full((1024, 1024), 255, np.uint8)]), "RGBA")


def card_row():
    im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w, gap = 180, 24
    x = (1024 - 5 * w - 4 * gap) // 2
    for i in range(5):
        d.rectangle([x, 386, x + w - 1, 386 + 252 - 1], fill=(100 + i * 20, 90, 60, 255), outline=(42, 26, 16, 255), width=6)
        x += w + gap
    return im


def grid_sheet(cols, rows, opaque=False):
    im = Image.new("RGBA", (1024, 1024), (40, 40, 40, 255) if opaque else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw, ch = 1024 / cols, 1024 / rows
    for r in range(rows):
        for c in range(cols):
            d.ellipse([c * cw + cw * 0.25, r * ch + ch * 0.25, c * cw + cw * 0.75, r * ch + ch * 0.75], fill=(200, 60 + c * 30, 60, 255))
    return im


def foot_and_height(sheet_path, fs, frame_index=0):
    arr = pp.load_rgba(sheet_path)
    r, c = divmod(frame_index, pp.OUT_GRID)
    f = arr[r * fs:(r + 1) * fs, c * fs:(c + 1) * fs]
    b = pp.bbox(f)
    return b, set(np.unique(f[..., 3]).tolist())


def main():
    fails = []

    def check(cond, msg):
        print(("  ok  " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "raw")
        out = os.path.join(tmp, "out")
        os.makedirs(raw)
        unit_sheet(6, 6, 0.8).save(os.path.join(raw, "ally_A01.png"))
        unit_sheet(5, 5, 0.6, bg=(255, 0, 255, 255)).save(os.path.join(raw, "enemy_E01.png"))
        unit_sheet(5, 5, 0.5, bg=(255, 0, 255, 255), wide=True).save(os.path.join(raw, "enemy_E04.png"))
        # 몸체를 작게 그리고 섬광이 칸 끝까지 뻗은 경우 → 목표 크기로 키우면 프레임을 넘친다
        unit_sheet(5, 5, 0.3, overflow=True).save(os.path.join(raw, "enemy_E05.png"))
        unit_sheet(5, 5, 0.6).save(os.path.join(raw, "npc_N01.png"))
        tiles_sheet().save(os.path.join(raw, "tiles_1.png"))
        fx_sheet().save(os.path.join(raw, "vfx_1.png"))
        unit_sheet(6, 5, 0.7).save(os.path.join(raw, "props_1.png"))
        card_row().save(os.path.join(raw, "card_frames.png"))
        grid_sheet(3, 3).save(os.path.join(raw, "card_tags.png"))
        grid_sheet(4, 4, opaque=True).save(os.path.join(raw, "card_art_p.png"))
        grid_sheet(3, 2).save(os.path.join(raw, "card_overlays.png"))
        Image.new("RGB", (1024, 1536), (30, 60, 70)).save(os.path.join(raw, "map_korea.png"))

        reps = {r["name"]: r for r in pp.process_all(list(ITEMS.values()), raw, out)}
        A = os.path.join(out, "public", "assets")

        print("\n[검증]")
        check(all(r["ok"] for r in reps.values()), "모든 항목 처리 성공")
        b, alphas = foot_and_height(os.path.join(A, "chars", "A01_move_slow.png"), 100)
        check(Image.open(os.path.join(A, "chars", "A01_attack.png")).size == (400, 400), "아군 시트 400x400")
        check(b is not None and abs((b[3] - b[1]) - 62) <= 2, f"아군 몸체 높이 62px 근처 (실제 {b[3] - b[1] if b else None})")
        check(b is not None and abs(b[3] - 92) <= 1, f"아군 발 기준선 y=92 (실제 {b[3] if b else None})")
        check(alphas <= {0, 255}, "아군 알파 하드닝(0/255)")
        check(len(reps["ally_A01"]["outputs"]) == 6, "아군 6동작 출력")
        b, _ = foot_and_height(os.path.join(A, "enemies", "E01_move.png"), 100)
        check(b is not None and abs((b[3] - b[1]) - 62) <= 2, "적(보병) 마젠타 배경 제거 + 몸체 62px")
        check(any("배경색" in w for w in reps["enemy_E01"]["warnings"]), "배경 제거 경고 기록")
        check(Image.open(os.path.join(A, "enemies", "E04_move_L.png")).size == (800, 800), "대형 적 _L 시트 800x800")
        # 기준 동작(move) 5프레임 전체의 합친 너비가 목표값(프레임마다 위치가 흔들려도 같은 배율)
        sheet = pp.load_rgba(os.path.join(A, "enemies", "E04_move_L.png"))
        ub = pp.union([pp.bbox(sheet[(i // 4) * 200:(i // 4 + 1) * 200, (i % 4) * 200:(i % 4 + 1) * 200]) for i in range(5)])
        check(ub is not None and abs((ub[2] - ub[0]) - 140) <= 3, f"차량 너비(동작 전체) 140px 근처 (실제 {ub[2] - ub[0] if ub else None})")
        check(any("넘쳐" in w for w in reps["enemy_E05"]["warnings"]), "프레임 넘침 시 배율 축소 경고")
        _, al = foot_and_height(os.path.join(A, "npcs", "N01_give.png"), 100)
        check(len(reps["npc_N01"]["outputs"]) == 3, "NPC 3동작 출력")
        t = Image.open(os.path.join(A, "tiles", "T01.png"))
        check(t.size == (64, 64) and len(reps["tiles_1"]["outputs"]) == 4, "타일 64x64 4장")
        fxa = pp.load_rgba(os.path.join(A, "fx", "explosion_l.png"))
        check(fxa.shape[:2] == (800, 800), "대형 이펙트 800x800")
        check(set(np.unique(fxa[..., 3]).tolist()) <= {0, 64, 128, 191, 255}, "이펙트 알파 5단계")
        check(os.path.exists(os.path.join(A, "props", "tree_leaf_L.png")), "소품 대형 시트(_L)")
        check(Image.open(os.path.join(A, "cards", "frame_common.png")).size == (120, 168), "카드 프레임 120x168")
        check(not any("균등" in w for w in reps["card_frames"]["warnings"]), "카드 5장 간격 감지")
        check(Image.open(os.path.join(A, "ui", "tag_infantry.png")).size == (32, 32), "아이콘 32x32")
        check(Image.open(os.path.join(A, "cards", "P01.png")).size == (104, 104), "카드 일러스트 104x104")
        check(Image.open(os.path.join(A, "ui", "overlay_smoke.png")).size == (120, 168), "오버레이 120x168")
        check(Image.open(os.path.join(A, "map", "korea_map.png")).size == (360, 540), "지도 360x540")
        check(os.path.exists(os.path.join(out, "preview", "ally_A01.png")), "미리보기 생성")
        colors = len(np.unique(pp.load_rgba(os.path.join(A, "chars", "A01_attack.png")).reshape(-1, 4), axis=0))
        check(colors <= pp.PALETTE["unit"] + 1, f"팔레트 제한 (색 {colors}개)")

    print(f"\n{'실패 ' + str(len(fails)) + '개' if fails else '전부 통과'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
