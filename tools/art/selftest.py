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
# 지도 그림은 생성 목록에서 뺐지만(작전지도는 코드가 그림) 변환 규칙은 남아 있어 검증만 계속한다
ITEMS.setdefault("map_korea", {"name": "map_korea", "phase": "-", "size": "1024x1536", "transparent": False, "prompt": "", "post": {"kind": "map", "w": 360, "h": 540}})


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


def drift_sheet(shift=0.04, overlap=False):
    """사용자 보고 재현: AI가 행을 아래로 밀려 그려서 발끝이 다음 칸으로 넘어간 적 시트(5x5).
    overlap=True면 행 사이 빈 틈 없이 다음 행 머리와 겹쳐 그린다(조각 제거로 처리돼야 함)."""
    im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw = ch = 1024 / 5
    body = 0.85 if overlap else 0.6
    for r in range(5):
        for c in range(5):
            cx = c * cw + cw / 2
            base = r * ch + ch * (0.92 + shift)  # 발이 칸 아래로 shift만큼 넘어감
            d.rectangle([cx - 25, base - ch * body, cx + 25, base - 12], fill=(140, 110, 70, 255), outline=(42, 26, 16, 255), width=3)
            d.rectangle([cx - 28, base - 12, cx + 28, base], fill=(70, 40, 25, 255))  # 장화
    return im


def jitter_sheet():
    """실제 결과물에서 측정된 AI 버릇 재현(6x6 아군): 열마다 좌우 ±14px 어긋남, 아래 행일수록 발이 최대 22px 올라감,
    총이 오른쪽으로 길게 튀어나옴(몸통 중심과 bbox 중심이 다름)"""
    rng = np.random.default_rng(7)
    im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw = ch = 1024 / 6
    for r in range(6):
        for c in range(6):
            cx = c * cw + cw / 2 + int(rng.integers(-14, 15))
            base = r * ch + ch * 0.92 - 22 * r / 5
            d.rectangle([cx - 15, base - ch * 0.6, cx + 15, base], fill=(90, 110, 60, 255))
            d.rectangle([cx + 15, base - ch * 0.4, cx + 45, base - ch * 0.36], fill=(60, 50, 40, 255))  # 총
    return im


def single_run(frame):
    ys = np.nonzero((frame[..., 3] > 0).any(axis=1))[0]
    return len(ys) > 0 and (ys[-1] - ys[0] + 1) == len(ys)


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
    return Image.fromarray(np.dstack([arr, np.full((1024, 1024), 255, np.uint8)]))


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


HEAD, LEGS = (200, 60, 60, 255), (60, 70, 160, 255)


def tall_sheet(n, pitch, cols=6):
    """n행을 pitch 높이로 그린 시트(머리 빨강·몸 초록·다리 파랑): 머리·다리가 다 들어왔는지로 행을 제대로 찾았는지 본다"""
    im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cw = 1024 / cols
    for r in range(n):
        base = r * pitch + pitch * 0.92
        fh = pitch * 0.72
        fw = fh * 0.42
        for c in range(cols):
            cx = c * cw + cw / 2 + (c - 3) * 1.5
            d.rectangle([cx - fw * 0.3, base - fh, cx + fw * 0.3, base - fh * 0.75], fill=HEAD, outline=(42, 26, 16, 255))
            d.rectangle([cx - fw / 2, base - fh * 0.75, cx + fw / 2, base - fh * 0.32], fill=(70, 120, 60, 255), outline=(42, 26, 16, 255))
            d.rectangle([cx - fw / 2, base - fh * 0.32, cx - 4, base], fill=LEGS)
            d.rectangle([cx + 4, base - fh * 0.32, cx + fw / 2, base], fill=LEGS)
    return im


def whole_figure(sheet_path, fs=100):
    """첫 프레임에 머리(빨강)와 다리(파랑)가 모두 있고 세로로 긴가"""
    f = pp.load_rgba(sheet_path)[:fs, :fs]
    px = f.reshape(-1, 4)
    px = px[px[:, 3] > 128][:, :3].astype(int)
    near = lambda c: int((np.abs(px - np.array(c[:3])).sum(axis=1) < 90).sum())
    b = pp.bbox(f)
    return b is not None and near(HEAD) > 5 and near(LEGS) > 10 and (b[3] - b[1]) > (b[2] - b[0]) * 1.5


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
        drift_sheet(0.12).save(os.path.join(raw, "enemy_E02.png"))
        jitter_sheet().save(os.path.join(raw, "ally_A02.png"))
        # 이펙트 시트에 배경을 칠한 경우(대형 스킬 이펙트에서 실제 발생)
        fx_bg = fx_sheet()
        ImageDraw.Draw(fx_bg).rectangle([0, 1024 * 4 // 5, 1023, 1023], fill=(30, 80, 140, 255))
        fx_bg.save(os.path.join(raw, "vfx_4.png"))
        # 3x3 일러스트 배치가 어긋나 칸 안에 다른 그림 경계가 보이는 경우(M 카드에서 실제 발생)
        art = Image.new("RGB", (1024, 1024), (60, 90, 60))
        da = ImageDraw.Draw(art)
        for k in range(9):
            r, c = divmod(k, 3)
            da.rectangle([c * 341 + 20, r * 341 + 20, c * 341 + 320, r * 341 + 320], fill=(100 + k * 15, 120, 160 - k * 10))
        da.rectangle([1024 // 2, 0, 1024 // 2 + 170, 1023], fill=(230, 220, 90))  # 칸 가운데를 가로지르는 경계
        art.save(os.path.join(raw, "card_art_m.png"))
        drift_sheet(0.05, overlap=True).save(os.path.join(raw, "enemy_E03.png"))
        tiles_sheet().save(os.path.join(raw, "tiles_1.png"))
        fx_sheet().save(os.path.join(raw, "vfx_1.png"))
        unit_sheet(6, 5, 0.7).save(os.path.join(raw, "props_1.png"))
        card_row().save(os.path.join(raw, "card_frames.png"))
        grid_sheet(3, 3).save(os.path.join(raw, "card_tags.png"))
        grid_sheet(4, 4, opaque=True).save(os.path.join(raw, "card_art_p.png"))
        grid_sheet(3, 2).save(os.path.join(raw, "card_overlays.png"))
        Image.new("RGB", (1024, 1536), (30, 60, 70)).save(os.path.join(raw, "map_korea.png"))

        # (2026-11) 넘치는 보병: 넘치는 동작만 큰 프레임(_L), 몸 크기는 그대로
        unit_sheet(5, 5, 0.3, overflow=True).save(os.path.join(raw, "enemy_E06.png"))
        # (2026-11) 위 n행만 쓰라는 시트를 AI가 더 큰 칸으로 그린 경우: 3행 × 256px, 2행 × 512px, 3행이 캔버스를 채움
        tall_sheet(3, 256).save(os.path.join(raw, "move_A01.png"))
        tall_sheet(2, 512).save(os.path.join(raw, "walk_E01.png"))
        tall_sheet(3, 1024 / 3).save(os.path.join(raw, "critter_W04.png"))
        tall_sheet(3, 1024 / 6).save(os.path.join(raw, "move_A02.png"))  # 규격대로(위 3/6행)

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
        check(any("축소" in w for w in reps["enemy_E05"]["warnings"]), "보스(200px) 넘침: 최대 25% 축소 + 경고")
        # 넘치는 보병: 넘친 동작(move)만 _L, 몸 높이는 목표(62) 그대로, 섬광이 잘리지 않음, 일반 파일은 남지 않음
        e6 = os.path.join(A, "enemies")
        check(os.path.exists(os.path.join(e6, "E06_move_L.png")) and not os.path.exists(os.path.join(e6, "E06_move.png")), "넘치는 동작만 큰 프레임(_L)")
        check(os.path.exists(os.path.join(e6, "E06_attack.png")) and not os.path.exists(os.path.join(e6, "E06_attack_L.png")), "넘치지 않는 동작은 100px 그대로")
        bL, _ = foot_and_height(os.path.join(e6, "E06_move_L.png"), 200)
        bN, _ = foot_and_height(os.path.join(e6, "E06_attack.png"), 100)
        check(abs((bL[3] - bL[1]) - (bN[3] - bN[1])) <= 1 and abs((bN[3] - bN[1]) - 62) <= 2, "큰 프레임에서도 몸 높이 62px 그대로")
        check(bL[3] == 184 and bN[3] == 92, "발 기준선: 100px는 92, 200px는 184")
        fl = pp.load_rgba(os.path.join(e6, "E06_move_L.png"))[0:200, 600:800]
        check(pp.bbox(fl)[2] < 199, "섬광이 프레임 끝에서 잘리지 않음")
        check(not any("잘림" in w for w in reps["enemy_E06"]["warnings"]), "넘치는 보병에 잘림 경고 없음")
        # 행 배치: 더 큰 칸으로 그려도 실제 행을 찾아 온전한 몸이 나옴
        for rel in ("chars/A01_walk.png", "chars/A01_run.png", "chars/A01_sprint.png", "enemies/E01_walk.png", "enemies/E01_run.png",
                    "critters/W04_walk.png", "critters/W04_idle.png", "critters/W04_run.png", "chars/A02_walk.png", "chars/A02_sprint.png"):
            check(whole_figure(os.path.join(A, rel)), f"행 찾기: {rel} 머리부터 발까지 온전")
        check(any("실제 그려진 행" in i for i in reps["move_A01"]["info"]), "큰 칸으로 그린 시트는 행을 찾아 자름")
        check(not any("실제 그려진 행" in i for i in reps["move_A02"]["info"]), "규격대로 그린 시트는 손대지 않음")
        new = ("move_A01", "walk_E01", "critter_W04", "move_A02", "enemy_E06")
        check(not any("지나감" in w for k in new for w in reps[k]["warnings"]), "새 시트: 행을 나누는 선이 그림을 지나가지 않음")
        # 규격(6×6의 위 3행)으로 잘랐다면 걸렸을 것: 256px 행을 170px 격자로 자르면 선이 몸통을 지나감
        check(pp.cut_through(np.array(tall_sheet(3, 256)), 6, 6) > 0.03, "잘못 자르면 '선이 그림을 지나감'으로 걸러짐")
        for uid in ("E02", "E03"):
            frames = []
            for act in ("move", "attack", "defend", "crit", "hit"):
                sh = pp.load_rgba(os.path.join(A, "enemies", f"{uid}_{act}.png"))
                frames += [sh[(i // 4) * 100:(i // 4 + 1) * 100, (i % 4) * 100:(i % 4 + 1) * 100] for i in range(5)]
            label = "행 밀림" if uid == "E02" else "행 겹침"
            check(all(single_run(f) for f in frames), f"{label}: 이웃 행 발끝 조각 없음(25프레임)")
            # 마지막 행(hit)은 합성 이미지에서 캔버스 아래로 잘리므로 제외, 합성 좌표 반올림 오차 1px 허용
            bottoms = {pp.bbox(f)[3] for f in frames[:20] if pp.bbox(f)}
            check(max(bottoms) - min(bottoms) <= 1, f"{label}: 동작 간 발 기준선 일치 ({sorted(bottoms)})")
        frames = []
        for act in ("attack", "defend", "skill", "move_slow", "move_fast", "crit"):
            sh = pp.load_rgba(os.path.join(A, "chars", f"A02_{act}.png"))
            frames += [sh[(i // 4) * 100:(i // 4 + 1) * 100, (i % 4) * 100:(i % 4 + 1) * 100] for i in range(6)]
        mx = [pp.mass_center_x(f) for f in frames]
        bt = [pp.bbox(f)[3] for f in frames]
        check(max(abs(m - 50) for m in mx) <= 1.5, f"열마다 어긋난 그림 → 몸통 중심 x=50 정렬 (범위 {min(mx):.0f}~{max(mx):.0f})")
        check(set(bt) == {92}, f"행마다 다른 발 높이 → 전부 y=92 정렬 ({sorted(set(bt))})")
        check(any("배경" in w for w in reps["vfx_4"]["warnings"]), "이펙트에 배경이 칠해지면 경고")
        check(any("M05" in w and "경계" in w for w in reps["card_art_m"]["warnings"]), "일러스트 칸에 다른 그림 경계가 보이면 경고")
        check(not any("경계" in w for w in reps["card_art_p"]["warnings"]), "정상 일러스트는 경고 없음")
        pole = np.full((104, 104, 4), 255, np.uint8)
        pole[..., :3] = (70, 80, 90)
        pole[8:96, 50:53, :3] = (20, 15, 10)  # 깃대처럼 가는 세로선: 경계가 아님
        check(pp.seam_ratio(pole) == 0, "가는 선(깃대)은 그림 경계로 보지 않음")
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
