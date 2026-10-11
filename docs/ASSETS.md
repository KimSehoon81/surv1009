# 그래픽·사운드 에셋 납품 가이드

그래픽은 사용자가 별도로 준비합니다. 이 문서는 **어떤 파일을, 어떤 규격으로, 어디에, 언제까지** 넣으면 되는지 정리합니다.
기준: `docs/PRD.md` §9·§10, 작업 일정: `docs/WORKPLAN.md`

## 1. 원칙

- 파일이 없으면 게임은 자리표시자(진영 색 사각형 + ID 글자)로 그립니다. **그래픽이 늦어도 개발은 멈추지 않습니다.**
- 아래 경로·파일명대로 `public/assets/`에 PNG를 넣으면 다음 실행부터 자동으로 교체됩니다. 코드 수정 불필요.
- 그래픽을 넣은 날 세션을 시작할 때 프롬프트 끝에 "그래픽 넣었어"라고 덧붙이면 그날 끝에 크기·정렬·투명도 점검을 합니다.
- 넣는 방법: GitHub 웹에서 저장소 → `public/assets/<폴더>/` → Add file → Upload files → **main 브랜치에 커밋**. 다음 세션부터 자동 반영됩니다. (대량이면 `docs/PROMPTS.md`의 "그래픽 교체 점검" 프롬프트로 짧은 세션을 따로 돌리세요.)

## 2. 화면 크기와 캐릭터 크기 (확정)

| 항목 | 확정값 |
| --- | --- |
| 논리 해상도 | 960×540. 1920×1080 화면에서 정수 ×2로 확대(창이 작으면 비율 맞춤) |
| 캐릭터 프레임 | **100×100 그대로** (PRD §10 규격 유지) |
| 캐릭터 몸체 | 프레임 안에서 **높이 56~64px**. 화면에서 캐릭터 키 ≈ 화면 높이의 1/9 |
| 남는 여백 | 총구 화염·근접 휘두르기·방패 등 동작 여유 공간 |
| 보스·전차·대형 적 | 100×100을 꽉 채우거나, 200×200 프레임 시트로 납품(파일명 `_L` 접미사: `E05_move_L.png`) |
| 카드 | 120×168로 그리면 게임이 HUD에서 0.5배로 표시 → ×2 화면에서 **원본 픽셀 그대로** 보임. 일러스트 칸은 104×104 |

PRD §10의 "정수 배율 3~4배"를 그대로 쓰면 100×100 프레임이 화면 높이의 55~75%를 차지해, 적 300체가 몰려오는 서바이벌 화면이 성립하지 않습니다. 그래서 ×2로 확정했습니다. **그림 규격(100×100)은 바뀌지 않았고, 몸체를 프레임 안에서 조금 작게 그리는 것만 다릅니다.**

### 2.1 모든 캐릭터 프레임 공통 정렬

| 항목 | 규칙 |
| --- | --- |
| 바라보는 방향 | **오른쪽**. 왼쪽은 코드가 좌우 반전 |
| 발 위치(기준점) | 모든 프레임에서 **x=50, y=92** 부근 고정 (프레임마다 발이 흔들리면 미끄러져 보임) |
| 배경 | 완전 투명(알파). 투명이 안 되면 마젠타(#FF00FF) 단색 배경 → 변환 도구가 투명 처리 |
| 안티앨리어싱 | 없음(경계 반투명 픽셀 금지). 외곽선 짙은 갈색 1~2px |
| 팔레트 | 캐릭터 48색, 타일 32색, 아이콘 24색 이내 (변환 도구가 자동 제한) |

## 3. 시트 규격

**만드는 방법은 6장의 자동 생성 파이프라인(`tools/art`)을 권장합니다.** 아래 규격으로 자동 변환되어 나옵니다. 직접 그릴 때도 같은 규격을 따르면 됩니다.

| 종류 | 프레임 | 시트 | 프레임 수(앞 N칸 사용) |
| --- | --- | --- | --- |
| 아군 캐릭터 | 100×100 | 400×400 (4×4 격자) | 동작마다 **6** |
| 적 보병·NPC | 100×100 | 400×400 | 동작마다 **5** |
| 적 보스·차량·항공기 (`_L`) | 200×200 | 800×800 | 5 |
| 이펙트 일반 / 대형 | 100×100 / 200×200 | 400×400 / 800×800 | 6 |
| 배경 소품 루프 (나무·잔해는 `_L`) | 100×100 / 200×200 | 400×400 / 800×800 | 6 |
| 바닥 타일 | 64×64 단일 이미지 | — | 상하좌우 이음매 없이 반복 |
| 카드 프레임·뒷면·오버레이 | 120×168 단일 이미지 | — | — |
| 카드 일러스트 | 104×104 단일 이미지 | — | 카드 안 일러스트 칸에 들어감 |
| 아이콘 (병과·스킬·업그레이드·UI) | 32×32 단일 이미지 | — | — |
| 작전지도 | 360×540 | — | — |

배치는 좌→우, 위→아래이며 나머지 칸은 투명입니다. PRD §10의 "동작당 10프레임"은 AI 생성으로 한 장에 전 동작을 그려 캐릭터 일관성을 지키기 위해 6·5프레임으로 조정했습니다(애니메이션 속도는 게임에서 맞춤).

## 4. 폴더와 파일명

```
public/assets/
  chars/    A01_attack.png  A01_defend.png  A01_skill.png  A01_move_slow.png  A01_move_fast.png  A01_crit.png
            (선택) A01_idle.png — 없으면 move_slow 첫 프레임을 대기 자세로 사용
  enemies/  E01_move.png  E01_attack.png  E01_defend.png  E01_crit.png  E01_hit.png
            보스·차량·항공기는 E05_move_L.png 처럼 _L (200×200 프레임)
  npcs/     N01_idle.png  N01_talk.png  N01_give.png
  tiles/    T01.png ~ T20.png
  props/    tree_leaf_L  tree_pine_L  tree_dead_L  tree_snow_L  burnt_truck_L
            grass  reed  bush  flag  drum_fire  wire  sandbag  rock            (.png)
  cards/    frame_common  frame_rare  frame_legend  frame_minus  card_back       (120×168)
            P01 ~ P16  M01 ~ M08  M00(예비)                                      (104×104 일러스트)
  fx/       bomb_fall  explosion_s  explosion_l  bomber  bomber_shadow  timebomb  burst_shell
            support_volley  hit_spark  naval_shell  tank_charge  supply_drop  mines  crit_ring
            muzzle  dust  scorch_decal  dirt_spray  dust_ring(200)  embers  flare_smoke
            skill_AS01 · AS03 · AS04 · AS06 · AS07 · AS09 · AS10 · AS11 · AS12
  skills/   AS01.png ~ AS12.png   (고급 스킬 Q·E·R·F 슬롯 아이콘 32×32)
  ui/       tag_infantry  tag_artillery  tag_armor  tag_air  tag_navy  tag_intel  tag_engineer  tag_medical  tag_allied
            overlay_smoke  overlay_static  overlay_snow  overlay_night  overlay_crack  overlay_success  (120×168)
            icon_upgrade_*  star_xp  seal  bullet  shell  merit  tp  op  lock  flag_ally        (32×32)
  map/      korea_map.png
  audio/    (선택, 7장 참고)
docs/mockup/
  main.png  — 메인화면 목업 (D29에 반영)
```

동작 이름은 PRD §4.3과 같습니다. 아군 6동작: attack · defend · skill · move_slow · move_fast · crit / 적 5동작: move · attack · defend · crit · hit / NPC 3동작: idle · talk · give

## 5. 필요 시점

자동 생성 노트북의 `PHASE`가 개발 단계와 맞춰져 있습니다. 해당 단계 전에 만들어 두면 그날 화면에서 바로 확인할 수 있습니다(없어도 개발은 진행됨).

| PHASE | 장수 | 내용 | 쓰이는 Day |
| --- | --- | --- | --- |
| P1 | 24 | 타일 T01~T04, 아군 A01~A03, 적 E01~E05, NPC N01·N02, 카드 프레임·일러스트·병과 아이콘·오버레이, UI·업그레이드·스킬 아이콘, 이펙트 5시트(vfx_1~4, vfx_6) | D02~D16 |
| P2 | 39 | 작전지도, 타일 T05~T12, 소품 1시트, 아군 A04~A15, 적 E06~E25, NPC N03~N05 | D17~D29 |
| P3 | 50 | 타일 T13~T20, 소품 2시트, 아군 A16~A30, 적 E26~E50, NPC N06~N10, 대형 스킬 이펙트 | D30~D37 |

**다시 만들 것(2026-10-11 회의)**: `vfx_1`(explosion_l·explosion_s: 1프레임이 가장 크고 밝은 흰-노랑 코어, 크레이터 없음 / bomb_fall: 붉은 바닥 링 없음 — 링은 게임이 청록으로 그림)과 새 `vfx_6`(그을음 데칼·흙 튐·먼지 고리·잔불·신호 연기). 노트북에서 `REGENERATE = "vfx_1,vfx_6"`으로 이 두 장만 다시 만들 수 있습니다. 섬광·충격파 링·빛 웅덩이·경고 마커는 코드가 그리므로 시트가 필요 없습니다.

## 6. 자동 생성 파이프라인 (`tools/art`)

| 파일 | 역할 |
| --- | --- |
| `generate_images.ipynb` | **Colab에 올려 실행.** 생성 → 게임 규격 변환 → `game_assets.zip` 다운로드까지 한 번에 |
| `catalog.py` | 프롬프트·규격의 원본(수정은 여기서) |
| `build.py` | catalog → `prompts.json`, `prompts_plain_oneline.txt`, 노트북 재생성 |
| `postprocess.py` | 원본 → 게임 규격 변환(노트북에도 내장). 로컬: `python3 tools/art/postprocess.py --raw raw --out out` |
| `selftest.py` | 변환 규격 자체 검증 |

변환이 하는 일
1. 투명 배경이 없으면 배경색 제거 → 그림 사이 빈 곳을 따라 칸 자르기 → 칸 테두리에 걸린 이웃 칸 조각 제거
2. 위치 정렬: AI는 행·열을 균등하게 그리지 않으므로 행마다 발 기준선을, 프레임마다 몸통 중심을 맞춤(걷기 중 미끄러짐·동작 전환 시 들썩임 방지)
3. 기준 동작의 몸체 크기로 배율 결정(보병 62px, 발 50,92). 넘치는 프레임이 있으면 최대 10%만 줄이고 나머지는 끝을 잘라 유닛 간 크기 유지
4. BOX 축소·알파 하드닝(이펙트는 5단계)·시트당 팔레트 제한 → 4×4 시트 저장
5. 미리보기와 경고(`report.json`): 이웃 조각 제거, 프레임 잘림, 이펙트 배경 칠함, 일러스트 배치 어긋남(다시 생성 권장), 타일 이음매

넣은 뒤 확인: `npm run assets:check`(크기·파일명·투명 채널 검사), 게임 주소 뒤에 `?gallery=1`(모든 유닛 동작을 발 기준선·중심선과 함께 재생).

`game_assets.zip`을 풀면 `public/assets/...` 구조입니다. GitHub 웹에서 저장소 루트에 폴더째 업로드(main 커밋)하면 다음 실행부터 자동 반영됩니다.

## 7. 사운드 (선택)

없어도 됩니다. 효과음은 게임이 코드로 합성합니다(`src/data/sfx.json`의 sources, 파일 0개). 더 좋은 소리로 바꾸고 싶을 때만 `public/assets/audio/`에 **sources와 같은 이름**으로 OGG(+ Safari용 MP3)를 넣으면 그 파일이 우선합니다(D15부터).

- 효과음 이름: `shot` `hit` `crit` `kill` `boom` `explode` `hurt` `block` `pickup` (D08·D10에서 카드 판정·UI·스킬 소리가 추가됨)
- BGM: `bgm_stage01` ~ `bgm_stage10`, `bgm_boss`, `bgm_menu` (없으면 무음)
- 앞 무음 5ms 이하, 피크 −1dB 안팎. 같은 소리 3가지 변형이 있으면 `hit_1`, `hit_2`, `hit_3`
- 만드는 방법: BGM은 상업 이용 가능한 요금제의 AI 음악 생성기(칩튠 + 군악 스네어) 또는 BeepBox. 효과음 겹(폭발 꼬리 등)은 CC0(Kenney 등)만. 생성 날짜·요금제·약관을 크레딧 표에 기록, 비상업(NC) 라이선스 금지
- 표현 원칙: 비명·고통 음성 없음, 실제 군가·국가·당시 방송 음원 금지

## 8. 표현 원칙 체크 (PRD §1)

혈흔·신체 훼손 없음(스파크·먼지·연기), 민간인 피해 묘사 없음, 실존 인물 실명·초상 미사용(지휘관은 직책명), 외모 희화화 금지(군복·장비·실루엣으로 진영 구분)
