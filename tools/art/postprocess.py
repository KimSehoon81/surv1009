"""AI 생성 원본 → 게임 규격 PNG 변환 (ASSETS.md 규격).

    python3 tools/art/postprocess.py --raw <원본 폴더> --out <출력 폴더> [--only ally_A01,tiles_1]

원본 파일명은 <항목 이름>.png (예: raw/ally_A01.png). 출력은 <out>/public/assets/... 구조라서
그대로 저장소 루트에 덮어 복사하면 게임이 자동으로 사용한다.

하는 일
  1. 투명 배경이 없으면 테두리의 지배적인 색(마젠타·단색·가짜 체크무늬)을 투명 처리
  2. 격자 칸 자르기
  3. 유닛: 기준 동작(걷기/이동/대기)의 몸체 크기로 배율을 정해 모든 프레임에 같은 변환 적용
     → 몸체 높이(보병 62px)·발 기준점(50, 92)·좌우 중심이 시트마다 일정
  4. 축소는 premultiplied BOX 필터, 알파는 경계 하드닝(이펙트는 5단계), 시트별 팔레트 제한
  5. 출력 시트는 4x4 격자(앞 N칸 사용), 품질 경고(report.json)와 미리보기 이미지 생성

Colab 노트북(generate_images.ipynb)에 이 파일 내용이 그대로 들어간다. 필요: Pillow, numpy.
"""


import json
import math
import os
import sys

import numpy as np
from PIL import Image

OUT_GRID = 4  # 출력 시트: 4x4 격자, 좌→우·위→아래로 앞 N칸 사용
BASELINE = 0.92  # 발 기준점 y (프레임 높이 비율)

UNIT_SPEC = {
    "ally": {"grid": (6, 6), "actions": ["attack", "defend", "skill", "move_slow", "move_fast", "crit"], "ref": "move_slow"},
    "enemy": {"grid": (5, 5), "actions": ["move", "attack", "defend", "crit", "hit"], "ref": "move"},
    "npc": {"grid": (5, 5), "actions": ["idle", "talk", "give"], "ref": "idle"},
}
UNIT_FOLDER = {"ally": "chars", "enemy": "enemies", "npc": "npcs"}
# 태그 → (프레임 크기, 기준 치수, 목표 px). 보병 몸체 62px = 화면 높이의 약 1/9 (×2 배율 기준)
UNIT_TARGET = {"S": (100, "h", 62), "B": (200, "h", 112), "L": (200, "w", 140)}
NPC_TARGET = (100, "h", 60)

PALETTE = {"unit": 48, "tile": 32, "prop": 48, "fx": 64, "icon": 24, "card": 48, "overlay": 32, "map": 64}
SOFT_PROPS = {"burnt_truck", "drum_fire"}  # 연기·불꽃이 있어 알파 5단계 유지
ALPHA_STEPS = np.array([0, 64, 128, 191, 255], dtype=np.int16)


# ------------------------------------------------------------------ 기본 연산

def load_rgba(path: str) -> np.ndarray:
    with Image.open(path) as im:
        return np.array(im.convert("RGBA"))


def save_rgba(arr: np.ndarray, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp.png"
    Image.fromarray(arr, "RGBA").save(tmp, optimize=True)
    os.replace(tmp, path)


def ensure_alpha(arr: np.ndarray) -> tuple[np.ndarray, bool]:
    """투명 픽셀이 거의 없으면 테두리 지배색(최대 2색, 체크무늬 대비)을 투명 처리한다."""
    a = arr[..., 3]
    if (a < 250).mean() > 0.02:
        return arr, False
    h, w = a.shape
    k = max(2, min(h, w) // 128)
    border = np.concatenate([
        arr[:k, :, :3].reshape(-1, 3), arr[-k:, :, :3].reshape(-1, 3),
        arr[:, :k, :3].reshape(-1, 3), arr[:, -k:, :3].reshape(-1, 3),
    ]).astype(np.int32)
    q = border // 16
    keys, counts = np.unique(q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2], return_counts=True)
    order = np.argsort(-counts)
    out = arr.copy()
    rgb = arr[..., :3].astype(np.int32)
    keyed = False
    for idx in order[:2]:
        if counts[idx] / len(border) < 0.15:
            break
        sel = border[(q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]) == keys[idx]]
        color = np.median(sel, axis=0)
        dist = np.sqrt(((rgb - color) ** 2).sum(axis=-1))
        out[dist < 48, 3] = 0
        keyed = True
    return out, keyed


def cell_boxes(w: int, h: int, cols: int, rows: int) -> list[list[tuple[int, int, int, int]]]:
    xs = [round(i * w / cols) for i in range(cols + 1)]
    ys = [round(j * h / rows) for j in range(rows + 1)]
    return [[(xs[c], ys[r], xs[c + 1], ys[r + 1]) for c in range(cols)] for r in range(rows)]


def crop(arr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return arr[y0:y1, x0:x1]


def _best_cut(profile: np.ndarray, nominal: float, window: float) -> int:
    """nominal 근처(±window)에서 불투명 픽셀이 가장 적은 줄. 동률이면 nominal에 가장 가까운 줄"""
    lo = max(1, int(nominal - window))
    hi = min(len(profile) - 1, int(nominal + window))
    seg = profile[lo:hi + 1]
    cand = np.nonzero(seg == seg.min())[0] + lo
    return int(cand[np.argmin(np.abs(cand - nominal))])


def smart_boxes(arr: np.ndarray, cols: int, rows: int, search: float = 0.3):
    """그림 사이 빈 곳을 따라 자른 격자.
    AI는 행·열을 정확한 균등 간격으로 그리지 않아서(조금씩 밀림) 균등 분할로 자르면 이웃 칸의 발끝·총구가 잘려 들어온다.
    균등 분할선 근처(칸 크기의 ±search)에서 그림이 가장 적은 줄을 골라 자른다. 열은 행마다 따로 찾는다."""
    h, w = arr.shape[:2]
    opaque = arr[..., 3] >= 64
    ch, cw = h / rows, w / cols
    rprof = opaque.sum(axis=1)
    ys = [0] + [_best_cut(rprof, k * ch, ch * search) for k in range(1, rows)] + [h]
    boxes = []
    for r in range(rows):
        cprof = opaque[ys[r]:ys[r + 1]].sum(axis=0)
        xs = [0] + [_best_cut(cprof, k * cw, cw * search) for k in range(1, cols)] + [w]
        boxes.append([(xs[c], ys[r], xs[c + 1], ys[r + 1]) for c in range(cols)])
    return boxes


def components(mask: np.ndarray):
    """8-연결 성분 라벨링(런 길이 기반, 의존성 없음). 성분별 {area, box(x0,y0,x1,y1), runs[(y,s,e)]}"""
    parent: list[int] = []
    runs: list[tuple[int, int, int]] = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    prev: list[int] = []
    m8 = mask.astype(np.int8)
    for y in range(mask.shape[0]):
        if not mask[y].any():
            prev = []
            continue
        d = np.diff(np.concatenate(([0], m8[y], [0])))
        cur = []
        for st, en in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            idx = len(runs)
            runs.append((y, int(st), int(en)))
            parent.append(idx)
            cur.append(idx)
            for p in prev:
                _, ps, pe = runs[p]
                if ps <= en and pe >= st:  # 대각선 포함 인접
                    ra, rb = find(idx), find(p)
                    if ra != rb:
                        parent[ra] = rb
        prev = cur
    comps: dict[int, dict] = {}
    for i, (y, st, en) in enumerate(runs):
        c = comps.setdefault(find(i), {"area": 0, "box": [st, y, en, y + 1], "runs": []})
        c["area"] += en - st
        b = c["box"]
        b[0], b[1], b[2], b[3] = min(b[0], st), min(b[1], y), max(b[2], en), max(b[3], y + 1)
        c["runs"].append((y, st, en))
    return list(comps.values())


def remove_edge_fragments(cell: np.ndarray, ratio: float = 0.15) -> tuple[np.ndarray, int]:
    """칸 테두리에 닿아 있고 가장 큰 덩어리의 ratio 미만인 조각(이웃 칸에서 넘어온 것)을 지운다.
    테두리에 닿지 않는 작은 조각(먼지·섬광·탄피)은 남긴다."""
    comps = components(cell[..., 3] >= 64)
    if len(comps) < 2:
        return cell, 0
    h, w = cell.shape[:2]
    largest = max(c["area"] for c in comps)
    out, removed = cell, 0
    for c in comps:
        x0, y0, x1, y1 = c["box"]
        if c["area"] < largest * ratio and (x0 == 0 or y0 == 0 or x1 == w or y1 == h):
            if removed == 0:
                out = cell.copy()
            for y, st, en in c["runs"]:
                out[y, st:en] = 0
            # 반투명 가장자리(알파 64 미만)도 같이 지운다
            out[max(0, y0 - 1):min(h, y1 + 1), max(0, x0 - 1):min(w, x1 + 1)][out[max(0, y0 - 1):min(h, y1 + 1), max(0, x0 - 1):min(w, x1 + 1), 3] < 64] = 0
            removed += 1
    return out, removed


def extract_cells(arr: np.ndarray, cols: int, rows: int, search: float = 0.3, clean: bool = True):
    """smart_boxes로 자르고 조각을 정리한 칸들을, 균등 격자 기준 좌표계를 유지한 같은 크기 캔버스에 담아 돌려준다.
    (자르는 선은 칸마다 달라도 좌표 원점은 균등 격자 그대로여야 프레임 간 위치·발 기준선이 흔들리지 않는다)"""
    h, w = arr.shape[:2]
    ch, cw = h / rows, w / cols
    pw, ph = int(math.ceil(cw * search)) + 1, int(math.ceil(ch * search)) + 1
    W, H = int(math.ceil(cw)) + 2 * pw, int(math.ceil(ch)) + 2 * ph
    boxes = smart_boxes(arr, cols, rows, search)
    grid, removed = [], 0
    for r in range(rows):
        row = []
        for c in range(cols):
            x0, y0, x1, y1 = boxes[r][c]
            part = arr[y0:y1, x0:x1]
            if clean:
                part, n = remove_edge_fragments(part)
                removed += n
            ox, oy = int(round(c * cw)) - pw, int(round(r * ch)) - ph
            cell = np.zeros((H, W, 4), np.uint8)
            dx0, dy0 = max(0, x0 - ox), max(0, y0 - oy)
            dx1, dy1 = min(W, x1 - ox), min(H, y1 - oy)
            cell[dy0:dy1, dx0:dx1] = part[dy0 - (y0 - oy):dy1 - (y0 - oy), dx0 - (x0 - ox):dx1 - (x0 - ox)]
            row.append(cell)
        grid.append(row)
    return grid, removed


def bbox(arr: np.ndarray, thr: int = 128):
    ys, xs = np.nonzero(arr[..., 3] >= thr)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


def resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """premultiplied 알파로 크기 변경(테두리 검은 번짐 방지). 축소 BOX, 확대 NEAREST."""
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    if (w, h) == (arr.shape[1], arr.shape[0]):
        return arr.copy()
    shrink = w < arr.shape[1] or h < arr.shape[0]
    im = Image.fromarray(arr, "RGBA").convert("RGBa")
    im = im.resize((w, h), Image.Resampling.BOX if shrink else Image.Resampling.NEAREST)
    return np.array(im.convert("RGBA"))


def paste(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    """알파 합성으로 붙이기(범위 밖은 잘림)."""
    H, W = dst.shape[:2]
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    d = dst[y0:y1, x0:x1].astype(np.float32)
    sa = s[..., 3:4] / 255.0
    da = d[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = np.where(oa > 0, (s[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6), 0)
    dst[y0:y1, x0:x1, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    dst[y0:y1, x0:x1, 3] = np.clip(oa[..., 0] * 255, 0, 255).astype(np.uint8)


def harden_alpha(arr: np.ndarray, mode: str) -> np.ndarray:
    out = arr.copy()
    a = out[..., 3].astype(np.int16)
    if mode == "hard":
        a = np.where(a >= 128, 255, 0)
    elif mode == "steps":
        a = ALPHA_STEPS[np.abs(a[..., None] - ALPHA_STEPS[None, None, :]).argmin(axis=-1)]
    elif mode == "none":
        a = np.full_like(a, 255)
    out[..., 3] = a.astype(np.uint8)
    out[out[..., 3] == 0, :3] = 0
    return out


def quantize(arr: np.ndarray, colors: int) -> np.ndarray:
    """불투명 픽셀 색을 colors개 이하로(디더링 없음). 시트 전체에 한 팔레트."""
    mask = arr[..., 3] > 0
    if mask.sum() == 0:
        return arr
    rgb = arr[..., :3].copy()
    rgb[~mask] = rgb[mask].mean(axis=0).astype(np.uint8)
    q = Image.fromarray(rgb, "RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = arr.copy()
    out[..., :3] = np.where(mask[..., None], np.array(q.convert("RGB")), 0)
    return out


def to_sheet(frames: list[np.ndarray], fs: int) -> np.ndarray:
    sheet = np.zeros((fs * OUT_GRID, fs * OUT_GRID, 4), np.uint8)
    for i, f in enumerate(frames[: OUT_GRID * OUT_GRID]):
        r, c = divmod(i, OUT_GRID)
        sheet[r * fs:(r + 1) * fs, c * fs:(c + 1) * fs] = f
    return sheet


def fit_frames(cells: list[np.ndarray], fs: int, metric: str, target: float, anchor_bottom: bool, ref_cells=None, warn=None):
    """같은 배율·같은 기준점으로 여러 칸을 fs×fs 프레임에 배치한다."""
    ref = ref_cells if ref_cells is not None else cells
    rb = union([bbox(c) for c in ref]) or union([bbox(c) for c in cells])
    if rb is None:
        return [np.zeros((fs, fs, 4), np.uint8) for _ in cells], 1.0
    rw, rh = rb[2] - rb[0], rb[3] - rb[1]
    if metric == "contain":
        s = min(fs * target / rw, fs * target / rh)
    else:
        s = target / (rh if metric == "h" else rw)
    cx = (rb[0] + rb[2]) / 2
    ay_src = rb[3] if anchor_bottom else (rb[1] + rb[3]) / 2
    ax_dst = fs / 2
    ay_dst = fs * BASELINE if anchor_bottom else fs / 2
    # 모든 프레임이 프레임 안에 들어오는지 확인하고 넘치면 배율을 줄인다
    ab = union([bbox(c) for c in cells])
    if ab:
        need = [
            (cx - ab[0]) / ax_dst if cx > ab[0] else 0,
            (ab[2] - cx) / (fs - ax_dst) if ab[2] > cx else 0,
            (ay_src - ab[1]) / ay_dst if ay_src > ab[1] else 0,
            (ab[3] - ay_src) / (fs - ay_dst) if ab[3] > ay_src else 0,
        ]
        smax = 1 / max(max(need), 1e-6)
        if s > smax:
            if warn is not None and s > smax * 1.08:
                warn.append(f"프레임에 넘쳐 배율 {s:.3f}→{smax:.3f}로 축소(일부 프레임의 동작 범위가 큼)")
            s = smax
    out = []
    for c in cells:
        h, w = c.shape[:2]
        scaled = resize(c, w * s, h * s)
        frame = np.zeros((fs, fs, 4), np.uint8)
        paste(frame, scaled, int(round(ax_dst - cx * s)), int(round(ay_dst - ay_src * s)))
        out.append(frame)
    return out, s


# ------------------------------------------------------------------ 종류별 처리

def process_unit(img, post, out_root, report):
    spec = UNIT_SPEC[post["faction"]]
    cols, rows = spec["grid"]
    nframes = cols
    grid, removed = extract_cells(img, cols, rows)
    cells = {a: grid[r][:nframes] for r, a in enumerate(spec["actions"])}
    if removed:
        report["warnings"].append(f"이웃 칸에서 넘어온 조각 {removed}개 제거")
    for a, row in cells.items():
        empty = sum(bbox(c) is None for c in row)
        if empty:
            report["warnings"].append(f"{a}: 빈 프레임 {empty}개")

    fs, metric, target = NPC_TARGET if post["faction"] == "npc" else UNIT_TARGET[post["tag"]]
    all_cells = [c for row in cells.values() for c in row]
    frames, s = fit_frames(all_cells, fs, metric, target, True, ref_cells=cells[spec["ref"]], warn=report["warnings"])
    frames = [harden_alpha(f, "hard") for f in frames]
    # 유닛 전체에 한 팔레트: 프레임을 이어 붙여 양자화 후 다시 나눈다
    strip = quantize(np.concatenate(frames, axis=1), PALETTE["unit"])
    frames = [strip[:, i * fs:(i + 1) * fs] for i in range(len(frames))]
    report["scale"] = round(s, 4)

    suffix = "_L" if fs > 100 else ""
    outs = []
    for r, a in enumerate(spec["actions"]):
        sheet = to_sheet(frames[r * nframes:(r + 1) * nframes], fs)
        rel = f"{UNIT_FOLDER[post['faction']]}/{post['id']}_{a}{suffix}.png"
        save_rgba(sheet, os.path.join(out_root, rel))
        outs.append((rel, frames[r * nframes:(r + 1) * nframes]))
    return outs


def process_tiles(img, post, out_root, report):
    img = harden_alpha(img, "none")
    boxes = cell_boxes(img.shape[1], img.shape[0], 2, 2)
    outs = []
    for i, tid in enumerate(post["ids"]):
        r, c = divmod(i, 2)
        tile = quantize(resize(crop(img, boxes[r][c]), 64, 64), PALETTE["tile"])
        rgb = tile[..., :3].astype(np.int16)
        inner = np.abs(np.diff(rgb, axis=1)).mean() + 1e-6
        seam = max(np.abs(rgb[:, 0] - rgb[:, -1]).mean(), np.abs(rgb[0] - rgb[-1]).mean())
        if seam > inner * 2.5:
            report["warnings"].append(f"{tid}: 이음매가 보일 수 있음(경계 차이 {seam:.0f} vs 내부 {inner:.0f})")
        rel = f"tiles/{tid}.png"
        save_rgba(tile, os.path.join(out_root, rel))
        outs.append((rel, [np.tile(tile, (2, 2, 1))]))
    return outs


def process_strips(img, post, out_root, report, kind):
    """props·fx: 6열 x 5행, 행마다 하나의 6프레임 애니메이션"""
    grid, removed = extract_cells(img, 6, 5)
    if removed:
        report["warnings"].append(f"이웃 칸에서 넘어온 조각 {removed}개 제거")
    outs = []
    for r, row in enumerate(post["rows"]):
        cells = grid[r]
        if all(bbox(c, 32) is None for c in cells):
            report["warnings"].append(f"{row['name']}: 행이 비어 있음")
            continue
        fs = row["frame"]
        if kind == "prop":
            frames, _ = fit_frames(cells, fs, row["fit"], row["px"], True, warn=report["warnings"])
            mode = "steps" if row["name"] in SOFT_PROPS else "hard"
            folder = "props"
        else:
            frames, _ = fit_frames(cells, fs, "contain", 0.96, False, warn=report["warnings"])
            mode = "steps"
            folder = "fx"
        frames = [harden_alpha(f, mode) for f in frames]
        strip = quantize(np.concatenate(frames, axis=1), PALETTE[kind])
        frames = [strip[:, i * fs:(i + 1) * fs] for i in range(6)]
        suffix = "_L" if kind == "prop" and fs > 100 else ""
        rel = f"{folder}/{row['name']}{suffix}.png"
        save_rgba(to_sheet(frames, fs), os.path.join(out_root, rel))
        outs.append((rel, frames))
    return outs


def _cover(cell, w, h):
    ch, cw = cell.shape[:2]
    s = max(w / cw, h / ch)
    big = resize(cell, cw * s, ch * s)
    y0 = (big.shape[0] - h) // 2
    x0 = (big.shape[1] - w) // 2
    return big[y0:y0 + h, x0:x0 + w]


def process_grid(img, post, out_root, report):
    """아이콘·오버레이·카드 일러스트: cols x rows 격자, 칸마다 하나의 이미지"""
    w, h = post["w"], post["h"]
    mode = post.get("alpha", "hard")
    fill = post.get("fill", "contain")
    # 꽉 찬 그림(일러스트·오버레이)은 균등 분할, 투명 배경 아이콘은 빈 곳을 따라 자르고 조각 정리
    boxes = cell_boxes(img.shape[1], img.shape[0], post["cols"], post["rows"])
    smart = None
    if fill != "stretch":
        smart, removed = extract_cells(img, post["cols"], post["rows"])
        if removed:
            report["warnings"].append(f"이웃 칸에서 넘어온 조각 {removed}개 제거")
    pal = PALETTE["card"] if mode == "none" else PALETTE["overlay"] if mode == "steps" else PALETTE["icon"]
    outs = []
    for i, name in enumerate(post["names"]):
        r, c = divmod(i, post["cols"])
        cell = smart[r][c] if smart else crop(img, boxes[r][c])
        if fill == "stretch":
            m = max(1, int(min(cell.shape[:2]) * 0.02))  # 이웃 칸이 번진 가장자리 제거
            out = _cover(cell[m:-m, m:-m], w, h)
        else:
            b = bbox(cell, 32)
            if b is None:
                report["warnings"].append(f"{name}: 빈 칸")
                continue
            part = cell[b[1]:b[3], b[0]:b[2]]
            s = min((w - 2) / part.shape[1], (h - 2) / part.shape[0])
            out = np.zeros((h, w, 4), np.uint8)
            small = resize(part, part.shape[1] * s, part.shape[0] * s)
            paste(out, small, (w - small.shape[1]) // 2, (h - small.shape[0]) // 2)
        out = quantize(harden_alpha(out, mode), pal)
        rel = f"{post['folder']}/{name}.png"
        save_rgba(out, os.path.join(out_root, rel))
        outs.append((rel, [out]))
    return outs


def process_row(img, post, out_root, report):
    """카드 프레임 5장: 투명 열 간격으로 나누고(실패 시 균등 분할) 각 카드를 w×h로"""
    n, w, h = post["count"], post["w"], post["h"]
    colmask = (img[..., 3] >= 64).any(axis=0)
    segs, start = [], None
    for x, on in enumerate(colmask):
        if on and start is None:
            start = x
        elif not on and start is not None:
            segs.append((start, x))
            start = None
    if start is not None:
        segs.append((start, len(colmask)))
    segs = [s for s in segs if s[1] - s[0] > img.shape[1] / (n * 4)]
    if len(segs) != n:
        report["warnings"].append(f"카드 {n}장을 간격으로 구분하지 못해 균등 분할({len(segs)}개 감지)")
        segs = [(round(i * img.shape[1] / n), round((i + 1) * img.shape[1] / n)) for i in range(n)]
    outs = []
    for (x0, x1), name in zip(segs, post["names"]):
        part = img[:, x0:x1]
        b = bbox(part, 64)
        if b is None:
            report["warnings"].append(f"{name}: 비어 있음")
            continue
        card = resize(part[b[1]:b[3], b[0]:b[2]], w, h)
        card = quantize(harden_alpha(card, "steps"), PALETTE["card"])
        rel = f"{post['folder']}/{name}.png"
        save_rgba(card, os.path.join(out_root, rel))
        outs.append((rel, [card]))
    return outs


def process_map(img, post, out_root, report):
    out = quantize(harden_alpha(resize(img, post["w"], post["h"]), "none"), PALETTE["map"])
    rel = "map/korea_map.png"
    save_rgba(out, os.path.join(out_root, rel))
    return [(rel, [out])]


PROCESSORS = {
    "unit": process_unit,
    "tiles": process_tiles,
    "props": lambda i, p, o, r: process_strips(i, p, o, r, "prop"),
    "fx": lambda i, p, o, r: process_strips(i, p, o, r, "fx"),
    "grid": process_grid,
    "row": process_row,
    "map": process_map,
}


# ------------------------------------------------------------------ 미리보기

def checker(h, w, size=8):
    yy, xx = np.mgrid[0:h, 0:w]
    v = np.where(((yy // size) + (xx // size)) % 2 == 0, 70, 90).astype(np.uint8)
    return np.dstack([v, v, v, np.full_like(v, 255)])


def build_preview(outs, scale=2, max_w=1600) -> np.ndarray:
    """출력 프레임들을 체크무늬 위에 2배로 늘어놓은 확인용 이미지"""
    rows = []
    for _rel, frames in outs:
        tiles = [np.repeat(np.repeat(f, scale, 0), scale, 1) for f in frames]
        h = max(t.shape[0] for t in tiles)
        line = []
        for t in tiles:
            pad = np.zeros((h, t.shape[1] + 4, 4), np.uint8)
            pad[: t.shape[0], : t.shape[1]] = t
            line.append(pad)
        row = np.concatenate(line, axis=1)
        if row.shape[1] > max_w:
            row = row[:, :max_w]
        rows.append(row)
    W = max(r.shape[1] for r in rows)
    H = sum(r.shape[0] + 4 for r in rows)
    canvas = checker(H, W)
    y = 0
    for r in rows:
        paste(canvas, r, 0, y)
        y += r.shape[0] + 4
    return canvas


# ------------------------------------------------------------------ 진입점

def process_item(item: dict, raw_path: str, out_dir: str) -> dict:
    report = {"name": item["name"], "ok": False, "outputs": [], "warnings": []}
    try:
        img = load_rgba(raw_path)
        if item.get("transparent", True) and item["post"]["kind"] not in ("tiles", "map"):
            img, keyed = ensure_alpha(img)
            if keyed:
                report["warnings"].append("원본에 투명 배경이 없어 배경색을 제거함")
        out_root = os.path.join(out_dir, "public", "assets")
        outs = PROCESSORS[item["post"]["kind"]](img, item["post"], out_root, report)
        report["outputs"] = [rel for rel, _ in outs]
        if outs:
            save_rgba(build_preview(outs), os.path.join(out_dir, "preview", f"{item['name']}.png"))
        report["ok"] = bool(outs)
    except Exception as e:  # 한 장의 실패가 전체를 멈추지 않게
        report["warnings"].append(f"처리 실패: {type(e).__name__}: {e}")
    return report


def process_all(items: list[dict], raw_dir: str, out_dir: str, only=None) -> list[dict]:
    reports = []
    for item in items:
        if only and item["name"] not in only:
            continue
        raw = os.path.join(raw_dir, item["name"] + ".png")
        if not os.path.exists(raw):
            continue
        rep = process_item(item, raw, out_dir)
        reports.append(rep)
        flag = "OK " if rep["ok"] else "ERR"
        print(f"[{flag}] {item['name']}: 출력 {len(rep['outputs'])}개" + (f" / 경고 {len(rep['warnings'])}" if rep["warnings"] else ""))
        for w in rep["warnings"]:
            print("      -", w)
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(reports, f, ensure_ascii=False, indent=1)
    return reports


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="AI 원본 이미지를 게임 규격 에셋으로 변환")
    ap.add_argument("--raw", required=True, help="원본 폴더(<항목 이름>.png)")
    ap.add_argument("--out", required=True, help="출력 폴더(public/assets, preview, report.json 생성)")
    ap.add_argument("--prompts", default=os.path.join(here, "prompts.json"))
    ap.add_argument("--only", default="", help="쉼표로 구분한 항목 이름")
    args = ap.parse_args(argv)
    with open(args.prompts, encoding="utf-8") as f:
        items = json.load(f)
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    reps = process_all(items, args.raw, args.out, only)
    bad = [r for r in reps if not r["ok"]]
    print(f"\n처리 {len(reps)}개, 실패 {len(bad)}개 → {os.path.join(args.out, 'public', 'assets')}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
