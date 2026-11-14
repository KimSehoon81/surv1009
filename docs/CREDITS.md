# 크레딧

소리·그래픽의 출처·라이선스·생성 도구·날짜를 적는다(PRD §11, ASSETS.md 7장). 비상업(NC) 라이선스는 쓰지 않는다.

## 소리

| 이름 | 종류 | 출처 | 라이선스 | 생성 도구 | 날짜 |
| --- | --- | --- | --- | --- | --- |
| `src/data/sfx.json` sources 전부(shot·hit·explode·boom·judge_* 등) | 효과음 | 자체 합성(코드) | 프로젝트 소유 | `src/core/synth.ts`, `npm run audio:bake`로 파일화 가능 | 2026-10-11~ |
| BGM(bgm_stage01·bgm_boss·bgm_menu) | 음악 | 아직 없음(무음) | — | — | — |

파일을 `public/assets/audio/`에 넣으면 합성음 대신 그 파일이 쓰인다. 넣을 때 이 표에 한 줄씩 추가한다.

## 그래픽

| 범위 | 출처 | 라이선스 | 생성 도구 | 날짜 |
| --- | --- | --- | --- | --- |
| `public/assets/` 유닛·카드·이펙트·UI | 사용자 제작(AI 생성 파이프라인) | 프로젝트 소유 | `tools/art` Colab 노트북(이미지 생성 API) | 2026-10-10~ |

## 글꼴

| 이름 | 출처 | 라이선스 | 날짜 |
| --- | --- | --- | --- |
| 갈무리(Galmuri11·Galmuri14, `public/fonts`) | Lee Minseo(quiple), npm `galmuri` 2.40.3 | SIL OFL 1.1(`public/fonts/Galmuri-OFL.txt`) | 2026-11-14 |
