"""catalog.py + postprocess.py → prompts.json, prompts_plain_oneline.txt, generate_images.ipynb

    python3 tools/art/build.py

노트북은 Colab에 파일 하나만 올리면 되도록 프롬프트와 후처리 코드를 모두 내장한다.
노트북을 직접 고치지 말고 이 스크립트의 원본(catalog.py, postprocess.py, 아래 셀 코드)을 고친 뒤 다시 빌드한다.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from catalog import build_items  # noqa: E402

MD_GUIDE = """# 압록강 서바이벌 — 그래픽 자동 생성 (112장)

**처음 한 번**
1. OpenAI API 키(`sk-...`)를 준비합니다. 왼쪽 열쇠 아이콘(보안 비밀)에 이름 `OPENAI_API_KEY`로 넣어 두면 매번 붙여넣지 않아도 됩니다(없으면 실행 중 입력칸이 뜹니다).
2. 런타임 → 모두 실행. Google Drive 연결을 허용하면 그림이 Drive의 `amnok_art` 폴더에 저장되어 런타임이 끊겨도 남습니다.

**사용 순서 (권장)**
1. `LIMIT = 1`로 한 장만 만들어 결과와 미리보기를 확인합니다.
2. 괜찮으면 `LIMIT = 0`(제한 없음)으로 바꾸고 다시 모두 실행합니다. 이미 만든 그림은 건너뜁니다.
3. 끝나면 `game_assets.zip`이 내려받아집니다. 압축을 풀면 `public/assets/...` 구조이므로 GitHub 저장소 루트에 그대로 올리면 게임이 자동으로 사용합니다.

**변환 규칙이 바뀌었을 때(노트북 새 버전)**: `CONVERT_ONLY`를 체크하고 모두 실행하면, Drive에 있는 원본을 다시 생성하지 않고 변환만 새로 합니다.

**마음에 안 드는 그림 다시 만들기**: `REGENERATE`에 항목 이름을 쉼표로 적고 실행합니다(예: `ally_A01,enemy_E04`). 프롬프트가 바뀐 항목만 다시 만들려면 `changed`.

**단계**: `P1`(스테이지 1, 23장) → `P2`(스테이지 1~5) → `P3`(나머지). 필요한 것부터 만들어 비용을 나눠 쓸 수 있습니다.
"""

CELL_SETTINGS = '''#@title 1) 설정 { display-mode: "form" }
#@markdown 체크하면 새로 만들지 않고, 이미 만든 원본(Drive의 raw)을 최신 변환 규칙으로 다시 변환만 함(API 키·비용 불필요)
CONVERT_ONLY = False  #@param {type:"boolean"}
PHASE = "P1"  #@param ["P1", "P2", "P3", "ALL"]
#@markdown 특정 항목만 만들 때(쉼표 구분, 예: ally_A01,enemy_E01). 비우면 PHASE 전체
ONLY = ""  #@param {type:"string"}
#@markdown 이번 실행에서 새로 만들 최대 장수. 처음엔 1로 시험, 0이면 제한 없음
LIMIT = 1  #@param {type:"integer"}
QUALITY = "medium"  #@param ["low", "medium", "high"]
#@markdown auto: 계정에서 쓸 수 있는 최신 이미지 모델을 자동 선택
MODEL = "auto"  #@param ["auto", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-1.5", "gpt-image-1"]
#@markdown 동시 요청 수. 429(속도 제한)가 자주 나면 1~2로
CONCURRENCY = 3  #@param {type:"integer"}
#@markdown 전쟁 소재가 과하게 차단되면 low (지원하지 않는 모델이면 자동으로 빠짐)
MODERATION = "auto"  #@param ["auto", "low"]
SAVE_TO_DRIVE = True  #@param {type:"boolean"}
#@markdown 다시 만들 항목(쉼표 구분) 또는 changed(프롬프트가 바뀐 항목 전부)
REGENERATE = ""  #@param {type:"string"}
#@markdown 원본 이미지 zip도 함께 내려받기
ZIP_RAW = False  #@param {type:"boolean"}
'''

CELL_SETUP = '''#@title 2) 준비 (Drive·API 키) { display-mode: "form" }
import base64, getpass, hashlib, json, os, random, re, threading, time, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

IN_COLAB = False
try:
    import google.colab  # noqa: F401
    IN_COLAB = True
except ImportError:
    pass

BASE = "/content/amnok_art" if IN_COLAB else os.path.abspath("amnok_art")
if IN_COLAB and SAVE_TO_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
    BASE = "/content/drive/MyDrive/amnok_art"
RAW_DIR = os.path.join(BASE, "raw")
OUT_DIR = os.path.join(BASE, "out")
os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)
print("저장 위치:", BASE)

def _get_key():
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"].strip()
    if IN_COLAB:
        try:
            from google.colab import userdata
            k = userdata.get("OPENAI_API_KEY")
            if k:
                return k.strip()
        except Exception:
            pass
    return getpass.getpass("OpenAI API 키를 붙여넣고 Enter: ").strip()

API_KEY = "" if CONVERT_ONLY else _get_key()
if API_KEY:
    os.environ["OPENAI_API_KEY"] = API_KEY  # 다시 실행해도 묻지 않게(이 런타임 안에서만)
    if not API_KEY.startswith("sk-"):
        print("경고: API 키 형식이 sk-로 시작하지 않습니다. 확인해 주세요.")
HEADERS = {"Authorization": "Bearer " + API_KEY}
'''

CELL_POST_HEADER = '''#@title 4) 후처리 코드 (건드리지 마세요) { display-mode: "form" }
# tools/art/postprocess.py 와 동일
'''

CELL_PLAN = '''#@title 5) 모델 확인과 작업 목록 { display-mode: "form" }
PREFERRED = ["gpt-image-2.5-flare", "gpt-image-2.5", "gpt-image-1.5", "gpt-image-1"]

def list_image_models():
    try:
        r = requests.get("https://api.openai.com/v1/models", headers=HEADERS, timeout=30)
        if r.status_code == 401:
            raise SystemExit("API 키가 올바르지 않습니다(401). 키를 다시 확인하세요.")
        r.raise_for_status()
        return sorted(m["id"] for m in r.json().get("data", []) if "image" in m["id"])
    except SystemExit:
        raise
    except Exception as e:
        print("모델 목록을 가져오지 못했습니다:", e)
        return []

available = [] if CONVERT_ONLY else list_image_models()
if not CONVERT_ONLY:
    print("이 계정의 이미지 모델:", ", ".join(available) or "(확인 불가)")
if MODEL != "auto":
    USE_MODEL = MODEL
    if available and MODEL not in available:
        print(f"경고: {MODEL}이(가) 목록에 없습니다. 그대로 시도합니다.")
else:
    USE_MODEL = next((m for m in PREFERRED if m in available), None) or PREFERRED[0]
print("사용할 모델:", USE_MODEL)

def prompt_hash(item):
    return hashlib.sha256(json.dumps([item["prompt"], item["size"], item["transparent"]]).encode()).hexdigest()[:16]

def raw_path(item):
    return os.path.join(RAW_DIR, item["name"] + ".png")

def meta_path(item):
    return os.path.join(RAW_DIR, item["name"] + ".json")

def is_changed(item):
    try:
        with open(meta_path(item), encoding="utf-8") as f:
            return json.load(f).get("prompt_hash") != prompt_hash(item)
    except Exception:
        return False

only = {s.strip() for s in ONLY.split(",") if s.strip()}
regen = {s.strip() for s in REGENERATE.split(",") if s.strip()}
selected = [it for it in PROMPTS if (it["name"] in only if only else (PHASE == "ALL" or it["phase"] == PHASE))]
unknown = (only | (regen - {"changed"})) - {it["name"] for it in PROMPTS}
if unknown:
    print("알 수 없는 항목 이름:", ", ".join(sorted(unknown)))

todo = []
for it in selected:
    exists = os.path.exists(raw_path(it))
    redo = it["name"] in regen or ("changed" in regen and is_changed(it))
    if not exists or redo:
        todo.append(it)
if LIMIT > 0:
    todo = todo[:LIMIT]
if CONVERT_ONLY:
    todo = []
    print("변환만 모드: 새 그림은 만들지 않습니다.")

# 대략적인 비용(장당 달러, 1024x1024 기준). 실제 청구액은 OpenAI 사용량 페이지에서 확인
PRICE = {"low": 0.006, "medium": 0.013, "high": 0.053} if "2.5" in USE_MODEL else {"low": 0.011, "medium": 0.042, "high": 0.167}
est = sum(PRICE[QUALITY] * (1.5 if it["size"] != "1024x1024" else 1) for it in todo)
done_count = sum(os.path.exists(raw_path(it)) for it in selected)
print(f"선택 {len(selected)}개 중 완료 {done_count}개 / 이번에 만들 것 {len(todo)}개, 예상 약 ${est:.2f} ({QUALITY})")
for it in todo[:20]:
    print("  -", it["no"], it["name"])
if len(todo) > 20:
    print(f"  ... 외 {len(todo) - 20}개")
'''

CELL_GENERATE = '''#@title 6) 이미지 만들기 { display-mode: "form" }
class Fatal(Exception):
    pass

print_lock = threading.Lock()
stop = threading.Event()
dropped_params = set()  # 모델이 지원하지 않는 선택 파라미터(한 번 확인되면 모두에 적용)

def log(*a):
    with print_lock:
        print(*a, flush=True)

def make_body(item):
    body = {"model": USE_MODEL, "prompt": item["prompt"], "size": item["size"], "quality": QUALITY,
            "n": 1, "output_format": "png"}
    if item["transparent"]:
        body["background"] = "transparent"
    if MODERATION == "low":
        body["moderation"] = "low"
    for p in dropped_params:
        body.pop(p, None)
    return body

def request_image(item):
    attempt = 0
    while not stop.is_set():
        attempt += 1
        body = make_body(item)
        try:
            r = requests.post("https://api.openai.com/v1/images/generations", headers=HEADERS, json=body, timeout=600)
        except requests.RequestException as e:
            if attempt >= 5:
                raise RuntimeError(f"네트워크 오류 반복: {e}")
            time.sleep(min(60, 5 * 2 ** attempt) + random.random() * 3)
            continue
        if r.status_code == 200:
            return r.json()
        msg = r.text[:600]
        try:
            err = r.json().get("error", {})
            msg = err.get("message", msg)
            code = err.get("code") or ""
            param = err.get("param") or ""
        except Exception:
            code = param = ""
        low = msg.lower()
        if r.status_code in (401, 403):
            hint = " (조직 인증이 필요할 수 있습니다: platform.openai.com → Settings → Organization → Verify)" if "verif" in low else ""
            raise Fatal(f"{r.status_code} 권한 오류: {msg}{hint}")
        if r.status_code == 404:
            raise Fatal(f"모델을 찾을 수 없습니다({USE_MODEL}): {msg}")
        if r.status_code == 429 and ("quota" in low or "billing" in low or code == "insufficient_quota"):
            raise Fatal("크레딧이 부족합니다. platform.openai.com → Billing에서 충전하세요.")
        if r.status_code == 400:
            optional = {"moderation", "background", "output_format", "quality"}
            bad = param if param in optional else next((p for p in optional if p in low and ("unknown" in low or "unsupported" in low or "invalid" in low)), None)
            if bad and bad not in dropped_params and bad in body:
                dropped_params.add(bad)
                log(f"  ({USE_MODEL}가 '{bad}' 파라미터를 지원하지 않아 빼고 다시 시도)")
                continue
            if "safety" in low or "moderation" in low or code in ("moderation_blocked", "content_policy_violation"):
                raise RuntimeError(f"안전 필터에 막힘: {msg[:200]} → MODERATION=low로 다시 시도하거나 프롬프트 수정")
            raise RuntimeError(f"요청 오류 400: {msg[:300]}")
        if r.status_code == 429 or r.status_code >= 500:
            if attempt >= 6:
                raise RuntimeError(f"{r.status_code} 반복: {msg[:200]}")
            wait = float(r.headers.get("retry-after", 0) or 0) or min(90, 5 * 2 ** attempt)
            log(f"  {item['name']}: {r.status_code} 대기 {wait:.0f}초 후 재시도 ({attempt}/6)")
            time.sleep(wait + random.random() * 2)
            continue
        raise RuntimeError(f"{r.status_code}: {msg[:300]}")
    raise RuntimeError("중단됨")

def generate(item):
    t0 = time.time()
    data = request_image(item)
    d = data["data"][0]
    png = base64.b64decode(d["b64_json"]) if d.get("b64_json") else requests.get(d["url"], timeout=120).content
    from PIL import Image
    import io
    with Image.open(io.BytesIO(png)) as im:
        im.load()
        has_alpha = im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 250
        size = f"{im.width}x{im.height}"
    tmp = raw_path(item) + ".tmp"
    with open(tmp, "wb") as f:
        f.write(png)
    os.replace(tmp, raw_path(item))  # 중간에 끊겨도 깨진 파일이 '완료'로 남지 않게
    meta = {"name": item["name"], "prompt_hash": prompt_hash(item), "model": USE_MODEL, "quality": QUALITY,
            "size": size, "transparent_requested": item["transparent"], "has_alpha": has_alpha,
            "seconds": round(time.time() - t0, 1), "usage": data.get("usage"), "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(meta_path(item), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    note = "" if (has_alpha or not item["transparent"]) else " (투명 배경 아님 → 후처리에서 배경 제거)"
    return f"{meta['seconds']}초{note}"

made, failed = [], []
if todo:
    workers = max(1, min(CONCURRENCY, len(todo)))
    log(f"{len(todo)}장 생성 시작 (모델 {USE_MODEL}, 품질 {QUALITY}, 동시 {workers})")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(generate, it): it for it in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            it = futs[fut]
            try:
                log(f"[{i}/{len(todo)}] 완료 {it['no']} {it['name']} - {fut.result()}")
                made.append(it["name"])
            except Fatal as e:
                stop.set()
                log(f"[중단] {e}")
                failed.append((it["name"], str(e)))
            except Exception as e:
                log(f"[{i}/{len(todo)}] 실패 {it['no']} {it['name']} - {e}")
                failed.append((it["name"], str(e)))
elif not CONVERT_ONLY:
    log("새로 만들 그림이 없습니다. (LIMIT, PHASE, ONLY, REGENERATE 설정 확인)")
log(f"\\n이번 실행: 성공 {len(made)}장, 실패 {len(failed)}장")
for name, err in failed:
    log(f"  - {name}: {err[:200]}")
'''

CELL_POSTPROCESS = '''#@title 7) 게임 규격으로 변환 + 미리보기 { display-mode: "form" }
try:
    from IPython.display import Image as IPyImage, display
except ImportError:  # Colab 밖(일반 파이썬)에서는 미리보기 표시 생략
    IPyImage = display = None
targets = {it["name"] for it in selected if os.path.exists(raw_path(it))}
reports = process_all([it for it in PROMPTS if it["name"] in targets], RAW_DIR, OUT_DIR)
shown = 0
for rep in reports:
    if rep["name"] in made or (not made and shown < 6):
        p = os.path.join(OUT_DIR, "preview", rep["name"] + ".png")
        if display and os.path.exists(p) and shown < 12:
            print("미리보기:", rep["name"])
            display(IPyImage(filename=p))
            shown += 1
warn = sum(1 for r in reports if r["warnings"])
print(f"변환 {len(reports)}개 (경고 있는 항목 {warn}개). 전체 미리보기: {os.path.join(OUT_DIR, 'preview')}")
'''

CELL_ZIP = '''#@title 8) 묶어서 내려받기 { display-mode: "form" }
def zip_dir(src, zip_path, arc_root):
    n = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(src):
            for fn in sorted(files):
                if fn.endswith(".tmp") or fn.endswith(".tmp.png"):
                    continue
                full = os.path.join(root, fn)
                z.write(full, os.path.join(arc_root, os.path.relpath(full, src)))
                n += 1
    return n

zips = []
n = zip_dir(os.path.join(OUT_DIR, "public"), os.path.join(BASE, "game_assets.zip"), "public")
zips.append(os.path.join(BASE, "game_assets.zip"))
print(f"game_assets.zip: 파일 {n}개 (압축을 풀어 저장소 루트에 올리면 public/assets에 들어갑니다)")
if ZIP_RAW:
    n = zip_dir(RAW_DIR, os.path.join(BASE, "raw_images.zip"), "raw")
    zips.append(os.path.join(BASE, "raw_images.zip"))
    print(f"raw_images.zip: 파일 {n}개")
if IN_COLAB:
    from google.colab import files
    for zp in zips:
        try:
            files.download(zp)
        except Exception as e:
            print("자동 다운로드가 안 되면 왼쪽 폴더 아이콘(또는 Drive)에서 직접 받으세요:", zp, e)
'''


def cell(source, kind="code"):
    lines = source.splitlines(keepends=True)
    c = {"cell_type": kind, "metadata": {}, "source": lines}
    if kind == "code":
        c["execution_count"] = None
        c["outputs"] = []
    return c


def postprocess_source():
    with open(os.path.join(HERE, "postprocess.py"), encoding="utf-8") as f:
        src = f.read()
    # 노트북에서는 CLI 진입점을 실행하면 안 된다
    cut = src.index('\nif __name__ == "__main__":')
    return src[:cut].rstrip() + "\n"


def main():
    items = build_items()
    names = [it["name"] for it in items]
    assert len(names) == len(set(names)), "항목 이름 중복"
    for it in items:
        assert len(it["prompt"]) < 4000, f"{it['name']} 프롬프트가 4000자를 넘음 ({len(it['prompt'])})"

    with open(os.path.join(HERE, "prompts.json"), "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, "prompts_plain_oneline.txt"), "w", encoding="utf-8") as f:
        for it in items:
            f.write(f"[{it['no']:03d} {it['name']} {it['size']}{' transparent' if it['transparent'] else ''}] "
                    + it["prompt"].replace("\n", " ") + "\n")

    data_json = json.dumps(items, ensure_ascii=False, indent=0)
    assert "'''" not in data_json
    data_cell = ('#@title 3) 프롬프트 데이터 (건드리지 마세요) { display-mode: "form" }\n'
                 f"PROMPTS = json.loads(r'''{data_json}''')\n"
                 'print(len(PROMPTS), "개 항목:", {p: sum(1 for it in PROMPTS if it["phase"] == p) for p in ("P1", "P2", "P3")})\n')

    nb = {
        "nbformat": 4,
        "nbformat_minor": 0,
        "metadata": {"colab": {"provenance": [], "toc_visible": False}, "kernelspec": {"name": "python3", "display_name": "Python 3"},
                     "language_info": {"name": "python"}},
        "cells": [
            cell(MD_GUIDE, "markdown"),
            cell(CELL_SETTINGS),
            cell(CELL_SETUP),
            cell(data_cell),
            cell(CELL_POST_HEADER + postprocess_source()),
            cell(CELL_PLAN),
            cell(CELL_GENERATE),
            cell(CELL_POSTPROCESS),
            cell(CELL_ZIP),
        ],
    }
    with open(os.path.join(HERE, "generate_images.ipynb"), "w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)

    phases = {p: sum(1 for it in items if it["phase"] == p) for p in ("P1", "P2", "P3")}
    longest = max(items, key=lambda it: len(it["prompt"]))
    print(f"항목 {len(items)}개 {phases}, 가장 긴 프롬프트 {longest['name']} {len(longest['prompt'])}자")


if __name__ == "__main__":
    main()
