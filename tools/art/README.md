# 그래픽 자동 생성 (tools/art)

OpenAI 이미지 API로 게임 그래픽 112장을 만들고, 게임 규격(`docs/ASSETS.md`)으로 자동 변환합니다.

## 사용법 (Colab, 설치 없음)

1. OpenAI API 키(`sk-...`)를 발급하고 크레딧을 충전합니다(5달러면 P1 23장을 high 품질로도 충분).
2. [colab.research.google.com](https://colab.research.google.com) → 파일 → 노트 업로드 → `generate_images.ipynb`.
3. (권장) 왼쪽 열쇠 아이콘(보안 비밀)에 `OPENAI_API_KEY` 이름으로 키를 넣고 노트북 액세스를 켭니다.
4. 런타임 → 모두 실행. Drive 연결을 허용하면 `내 드라이브/amnok_art`에 저장되어 런타임이 끊겨도 이어서 할 수 있습니다.
5. 기본값 `PHASE=P1`, `LIMIT=1`이라 1장만 만들고 미리보기를 보여줍니다. 괜찮으면 `LIMIT=0`으로 바꾸고 다시 모두 실행합니다(이미 만든 것은 건너뜀).
6. 마지막에 `game_assets.zip`이 내려받아집니다. 풀어서 나온 `public` 폴더를 GitHub 저장소 루트에 업로드(main 커밋)하면 끝입니다.

| 설정 | 설명 |
| --- | --- |
| `PHASE` | P1(스테이지 1, 23장) → P2(39장) → P3(50장). 개발 일정에 맞춰 나눠 만들기 |
| `ONLY` | 특정 항목만 (예: `ally_A01,enemy_E04`) |
| `LIMIT` | 이번 실행에서 새로 만들 최대 장수, 0은 제한 없음 |
| `QUALITY` | low / medium / high. 캐릭터는 high 권장 |
| `MODEL` | auto면 계정에서 쓸 수 있는 최신 모델을 자동 선택(2.5 flare → 1.5 → 1) |
| `CONCURRENCY` | 동시 요청 수(기본 3). 429가 자주 나면 1~2 |
| `MODERATION` | 전쟁 소재 차단이 과하면 low |
| `REGENERATE` | 다시 만들 항목 이름, 또는 `changed`(프롬프트가 바뀐 항목 전부) |

## 파일

| 파일 | 역할 |
| --- | --- |
| `catalog.py` | 프롬프트와 변환 규격의 원본. **고칠 때는 여기만** |
| `build.py` | `python3 tools/art/build.py` → prompts.json, prompts_plain_oneline.txt, 노트북 재생성 |
| `postprocess.py` | 원본 → 게임 규격 변환. 로컬 실행: `python3 tools/art/postprocess.py --raw <원본 폴더> --out <출력 폴더>` (Pillow, numpy 필요) |
| `selftest.py` | 변환 규격 자체 검증 `python3 tools/art/selftest.py` |
| `prompts_plain_oneline.txt` | 한 줄에 하나씩. ChatGPT 등에 수동으로 붙여넣을 때 |

## 다른 곳에서 만든 그림을 쓸 때

원본 파일 이름을 항목 이름(`prompts.json`의 `name`, 예: `ally_A01.png`)으로 바꿔 한 폴더에 모은 뒤 `postprocess.py`를 돌리면 같은 규격으로 변환됩니다.
