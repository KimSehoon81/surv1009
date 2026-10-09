# 그래픽·사운드 에셋 납품 가이드

그래픽은 사용자가 별도로 준비합니다. 이 문서는 **어떤 파일을, 어떤 규격으로, 어디에, 언제까지** 넣으면 되는지 정리합니다.
기준: `docs/PRD_v0.1.md` §9·§10, 작업 일정: `docs/WORKPLAN.md`

## 1. 원칙

- 파일이 없으면 게임은 자리표시자(진영 색 사각형 + ID 글자)로 그립니다. **그래픽이 늦어도 개발은 멈추지 않습니다.**
- 아래 경로·파일명대로 `public/assets/`에 PNG를 넣으면 다음 실행부터 자동으로 교체됩니다. 코드 수정 불필요.
- 그래픽을 넣은 날 세션을 시작할 때 "그래픽 넣었어"라고 덧붙이면 그날 끝에 크기·정렬·투명도 점검을 합니다.

## 2. 화면 크기와 캐릭터 크기 (중요)

- 논리 해상도 960×540, 화면에는 정수 ×2(1920×1080)로 확대합니다.
- PRD §10의 "정수 배율 3~4배"를 그대로 쓰면 100×100 프레임이 화면 높이의 55~75%를 차지해, 적 300체가 몰려오는 서바이벌 화면이 성립하지 않습니다. 그래서 ×2로 조정했습니다.
- **프레임은 100×100 그대로, 캐릭터 몸체는 프레임 안에서 높이 약 56~64px**로 그려 주세요. 남는 여백은 총구 화염·근접 휘두르기·방패 같은 동작 여유 공간입니다. (화면에서 캐릭터 키 ≈ 화면 높이의 1/9)
- 보스·전차·대형 적은 같은 100×100 프레임을 꽉 채우거나, 200×200 프레임 시트로 납품해도 됩니다(파일명에 `_L` 접미사: `E05_move_L.png`).

### 2.1 모든 캐릭터 프레임 공통 정렬

| 항목 | 규칙 |
| --- | --- |
| 바라보는 방향 | **오른쪽**. 왼쪽은 코드가 좌우 반전 |
| 발 위치(기준점) | 모든 프레임에서 **x=50, y=92** 부근 고정 (프레임마다 발이 흔들리면 미끄러져 보임) |
| 배경 | 완전 투명(알파). 마젠타(#FF00FF) 배경으로 납품하면 변환 도구가 투명 처리 |
| 안티앨리어싱 | 없음(경계 반투명 픽셀 금지). 외곽선 짙은 갈색 1~2px |
| 팔레트 | 캐릭터 48색 이내, 배경 32색 이내, UI 16색 (PRD §10) |

## 3. 시트 규격

| 종류 | 프레임 | 시트 | 배치 |
| --- | --- | --- | --- |
| 캐릭터·적·NPC 동작 | 100×100 | 400×400 (4×4 격자) | 좌→우, 위→아래로 **앞 10칸** 사용, 나머지 6칸 투명 |
| 대형 적·보스(선택) | 200×200 | 800×800 (4×4 격자) | 동일 |
| 이펙트(일반) | 100×100 | 400×400 | 동일 |
| 이펙트(대형 연출) | 200×200 | 800×800 | 동일 |
| 배경 소품 루프 | 100×100 | 400×400 | 앞 6칸(흔들림 6프레임 루프), 풀 밟힘은 2칸 |
| 바닥 타일 | 64×64 단일 이미지 | — | 상하좌우 이음매 없이 반복 |
| 카드 | 120×168 단일 이미지 | — | 프레임과 일러스트 분리 납품 권장(4장 참고) |

## 4. 폴더와 파일명

```
public/assets/
  chars/    A01_attack.png  A01_defend.png  A01_skill.png  A01_move_slow.png  A01_move_fast.png  A01_crit.png
            (선택) A01_idle.png — 없으면 move_slow 첫 프레임을 대기 자세로 사용
  enemies/  E01_move.png  E01_attack.png  E01_defend.png  E01_crit.png  E01_hit.png
  npcs/     N01_idle.png  N01_talk.png  N01_give.png
  tiles/    T01.png ~ T20.png
  props/    tree_leaf.png  tree_pine.png  tree_dead.png  grass.png  reed.png  grass_step.png
            flag.png  drum_fire.png  smoke_column.png
            (정지 소품) rock.png  wire.png  sandbag.png  burnt_truck.png
  cards/    frame_common.png  frame_rare.png  frame_legend.png  frame_minus.png  card_back.png
            P01.png ~ P16.png  M01.png ~ M08.png   (일러스트만, 프레임 안쪽 영역 크기)
  fx/       spark.png  hit_ring.png  explosion_s.png  explosion_l.png  smoke.png  muzzle.png  shell.png
            bomber.png  fighter.png  bomb.png  shell_naval.png  tank.png  crate_parachute.png
            ally_gunner_XX.png (참전국 코드: kr us uk tr ca au et gr ph fr nl th)
            marker_ally.png  marker_enemy.png  crater.png  heal_aura.png  shield_dome.png
  skills/   AS01.png ~ AS12.png   (QWER 슬롯 아이콘 32×32)
  ui/       hud_*.png  icon_upgrade_*.png  star_xp.png  seal.png  font_pixel.png(선택)
  map/      korea_map.png  fog.png  flag_ally.png
  audio/    (선택, 7장 참고)
docs/mockup/
  main.png  — 메인화면 목업 (D29에 반영)
```

동작 이름은 PRD §4.3과 같습니다. 아군 6동작: attack · defend · skill · move_slow · move_fast · crit / 적 5동작: move · attack · defend · crit · hit / NPC 3동작: idle · talk · give

## 5. 필요 시점 (이 Day 전에 넣으면 그날 화면에서 바로 확인)

| 시점 | 에셋 | 수량(시트) |
| --- | --- | --- |
| D02 | A01~A03 6동작, T01·T02 | 18 + 타일 2 |
| D03 | E01·E02 5동작 | 10 |
| D04 | 탄환, 경험치 별 | 소형 2 |
| D05 | spark, hit_ring, explosion_s/l, smoke, muzzle, shell | 이펙트 7 |
| D06 | 업그레이드 아이콘 | 10~15 |
| D08 | 카드 프레임 4종 + 뒷면, P01~P16·M01~M08 일러스트 | 29 |
| D10 | bomber, bomb, crater, marker_ally | 4 |
| D11 | ally_gunner(국가별), tank, shell_naval, crate_parachute, heal_aura | 6~17 |
| D12 | fighter, AS03 아이콘, E03·E04 | 1 + 1 + 10 |
| D13 | E05(보스), flag | 5 + 1 |
| D14 | N01·N02 3동작, 픽셀 폰트(선택) | 6 |
| **P1 합계** | | 시트 약 60장 + 단일 이미지 약 50장 |
| D17 | korea_map, fog, flag_ally | 3 |
| D20~D21 | A04~A15 6동작 | 72 |
| D22~D25 | E06~E09, E11~E14, E16~E19, E21~E24 / T03~T10 | 80 + 타일 8 |
| D23~D25 | AS01·AS04·AS05·AS06·AS08 아이콘 + 해당 이펙트 | 5 + α |
| D26 | N03~N05 | 9 |
| D27~D28 | E10·E15·E20·E25 (보스) | 20 |
| D29 | docs/mockup/main.png, 로고, UI 패널 | — |
| D30~D31 | A16~A30 | 90 |
| D32~D36 | E26~E50, T11~T20, AS02·AS07·AS09~AS12 | 125 + 타일 10 + 6 |
| D37 | N06~N10, 배경 소품 시트 | 15 + 소품 약 13 |

## 6. 시트 변환 도구 (D02 이후 사용 가능)

Dreamina 등에서 1024×1024(4×4 격자)로 생성한 이미지를 게임 규격으로 바꿉니다.

```
node tools/slice-sheet.mjs <입력.png> <출력.png> [--frame 100] [--key FF00FF]
```

1. 4×4 칸으로 자름 → 2. 칸마다 100×100으로 최근접 축소 → 3. 마젠타 배경 투명화 → 4. 400×400 시트로 저장
(폴더 일괄 처리와 상세 옵션은 D02 작업 후 이 절에 추가됩니다.)

## 7. 사운드 (선택)

없으면 합성 칩튠 효과음을 씁니다(D15). 넣고 싶다면 `public/assets/audio/`에 OGG 또는 MP3로:
`bgm_stage01.ogg ~ bgm_stage10.ogg`, `bgm_boss.ogg`, `bgm_menu.ogg`, `sfx_hit.ogg`, `sfx_crit.ogg`, `sfx_explode.ogg`, `sfx_shot.ogg`, `sfx_card_flip.ogg`, `sfx_card_success.ogg`, `sfx_card_fail.ogg`, `sfx_beep.ogg`, `sfx_plane.ogg`, `sfx_ui.ogg`

## 8. 표현 원칙 체크 (PRD §1)

혈흔·신체 훼손 없음(스파크·먼지·연기), 민간인 피해 묘사 없음, 실존 인물 실명·초상 미사용(지휘관은 직책명), 외모 희화화 금지(군복·장비·실루엣으로 진영 구분)
