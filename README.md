# 압록강 서바이벌 (가칭)

6·25전쟁 배경 레트로 2D 도트 서바이벌 액션 + 성공 30% 확률형 전략카드 조합 스킬 게임.
낙동강에서 압록강까지 10개 지역을 남에서 북으로 점령합니다. 한 판(약 15분)은 **버티며 성장 → 보스 격파 → 점령**입니다.

## 플레이

- 웹: GitHub Pages(저장소 Settings → Pages → Source를 **GitHub Actions**로 두면 main에 푸시할 때마다 `https://<계정>.github.io/surv1009/`에 배포)
- itch.io: `npm run package` → `dist-zip/amnok-survival-<버전>.zip`을 HTML 게임으로 올리고 "This file will be played in the browser"
- 로컬:

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:5173)
npm run check      # 타입 검사 + 테스트 + 빌드(커밋 전 필수)
npm run test:e2e   # 브라우저 스모크 테스트(부팅 → 지도 → 전투 30초 → 결과, 콘솔 오류 0)
npm run build      # dist/ 에 배포용 빌드 (build:release는 아틀라스까지, Python Pillow 필요)
```

## 조작

생각은 멈춘 화면(레벨업·작전판)에서, 전투 중에는 키 하나로. 키는 설정 → 키에서 바꿀 수 있습니다.

| 행동 | 키보드 | 패드 |
| --- | --- | --- |
| 이동(사격은 자동) | WASD / 방향키 | 왼쪽 스틱 |
| 질주(1초, 처음 잠깐 무적, 7초마다) | C | 왼쪽 스틱 누르기 |
| 카드 고르기·해제(최대 3장) | 1~5, 클릭 | 방향 패드·오른쪽 스틱 좌우 + X |
| 작전 개시(빈 선택이면 첫 입력은 추천 조합 채우기) | Space / Enter | A |
| 인장 걸고 제출(확정 성공) | Shift+Space | Y 길게 |
| 선택 해제 | X / Backspace | B |
| 고급 스킬 1~4 | Q · E · R · F | LB · RB · LT · RT |
| 작전판(일시정지 + 조합표·확률) | Tab | View |
| 일시정지 | Esc | Start |

설정에서 언어(한국어 / English), 화면 흔들림·점멸 강도, 이펙트 품질, 신병 모드, 판정 연출 짧게 등을 고를 수 있습니다. 저장이 이상해지면 설정 → "마지막 정상 세이브로 되돌리기".

## 표현 원칙

역사적 배경을 존중하되 표현은 게임답게 합니다.

- 혈흔·신체 훼손 없음(스파크·먼지·연기로 대체), 민간인 피해 묘사 없음
- 실존 인물 실명·초상 미사용(지휘관은 직책명), 외모 희화화 금지(군복·장비·실루엣으로만 진영 구분)
- 엔딩 크레딧에 함께한 전투 지원·의료 지원 국가를 적습니다

## 크레딧

- 기획·그래픽: 사용자 제작(AI 생성 파이프라인 `tools/art`), 출처·라이선스는 [docs/CREDITS.md](docs/CREDITS.md)
- 효과음·음악: 코드 합성음(`src/core/synth.ts`)과 자체 작곡 칩튠(`src/data/music.json` → `src/core/chiptune.ts`), 프로젝트 소유
- 글꼴: 갈무리(Galmuri, SIL OFL 1.1, `public/fonts`)
- 엔진·도구: [Phaser 3](https://phaser.io)(MIT), TypeScript, Vite, Vitest, Playwright
- 개발: Claude Code와 45일 일일 작업계획으로 제작([진척도](docs/PROGRESS.md))

## 개발용 주소

- `?debug=1` 디버그 키(J공격 K방어 L스킬 U치명 I무적 F2적300 …)·계측 표시, `?stage=S5` 시작 스테이지, `?char=A02` 시작 캐릭터
- `?auto=stage1&speed=8&seed=1` 자동 진행(메뉴부터 전투·결과까지 스스로), `?reset=1` 저장 초기화
- `?gallery=1` 그래픽 갤러리, `?gallery=audio` 소리 검수, `npm run assets:check` 그래픽 규격 검사
- 그래픽은 `public/assets/` 아래에 규격대로 PNG를 넣으면 자동으로 교체됩니다(없으면 자리표시자). 규격은 [docs/ASSETS.md](docs/ASSETS.md)

## 문서

| 문서 | 내용 |
| --- | --- |
| [진척도 대시보드](docs/PROGRESS.md) | 45일 결과 요약, Day별 현황, 측정값 |
| [백로그](docs/BACKLOG.md) | 남은 이월과 다음 단계 개선 아이디어 |
| [밸런스 기록](docs/BALANCE.md) | 해석 모델과 조정 이력 |
| [게임 PRD](docs/PRD.md) · [작업계획](docs/WORKPLAN.md) · [Day별 프롬프트](docs/PROMPTS.md) | 기획 원문·45일 계획 |
| [에셋 납품 가이드](docs/ASSETS.md) · [크레딧](docs/CREDITS.md) · [기믹 제안](docs/IDEAS.md) | 그래픽 규격·출처·아이디어 |

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/core/` | 게임 규칙 순수 함수(Phaser 없음, 테스트 대상, 확률은 시드 RNG) |
| `src/data/` | 수치·콘텐츠 JSON(밸런스 숫자는 여기에만) |
| `src/i18n/` | 화면 문자열(ko·en)과 데이터 번역 |
| `src/systems/` · `src/entities/` · `src/scenes/` · `src/ui/` | Phaser 쪽 표현·입력(전투 시간은 `systems/clock`) |
| `tools/` | 에셋 목록·아틀라스·밸런스 모델·시뮬레이터·배포 zip |
| `tests/` | Vitest(단위·픽스처·스냅샷), `tests/e2e` Playwright |
