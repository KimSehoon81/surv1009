# 압록강 서바이벌 (가칭)

6·25전쟁 배경 레트로 2D 도트 뱀파이어 서바이벌류 + 성공 30% 확률형 전략카드 조합 스킬 게임.

- 게임 PRD: `docs/PRD_v0.1.md` (전체를 읽지 말 것. 필요한 절만 grep으로 찾아 읽기)
- 일일 작업계획: `docs/WORKPLAN.md` (그날 Day 절만 읽기)
- Day별 실행 프롬프트: `docs/PROMPTS.md` (`/day`일 때 그날 절만 읽기)
- 진척도 대시보드: `docs/PROGRESS.md` (매 세션 시작·종료 시 읽고 갱신)
- 에셋 규격: `docs/ASSETS.md`

## 기술 스택과 구조

Phaser 3 + TypeScript + Vite, 테스트 Vitest. 논리 해상도 960×540, 정수 배율 우선(1920×1080에서 ×2), `pixelArt: true`.
캐릭터 프레임 100×100(몸체 56~64px, 발 기준점 50,92), 카드 120×168을 HUD에서 0.5배 표시.
(PROGRESS.md "결정 사항"에 다른 값이 있으면 그것을 따름)

- `src/core/`: 게임 규칙 순수 함수. **Phaser import 금지**. 모든 확률은 `core/rng.ts`의 시드 RNG. 테스트 필수
- `src/data/*.json`: 카드·적·스킬·스테이지·수치. 밸런스 숫자를 코드에 하드코딩하지 않음
- `src/systems/`, `src/entities/`, `src/scenes/`, `src/ui/`: Phaser 쪽 표현·입력
- 전투 로직의 시간은 전부 `systems/clock.ts`의 배율 적용 delta를 사용(일시정지·히트스톱·슬로모를 한 곳에서)
- `src/assets/manifest.ts`: 에셋 키 → 경로. 파일이 없으면 자리표시자 텍스처 생성. 그래픽은 사용자가 별도 제작하므로 **에셋 부재로 작업을 멈추지 않음**
- 적 행동은 behavior 부품 조합(data), 스킬·조합 연출은 타임라인 JSON + 효과 handler. 개별 캐릭터·적을 위한 코드 분기 금지
- 대량 개체는 오브젝트 풀 + 공간 해시. 파티클 300, 데미지 숫자 40 상한(PRD §4.4)

## 명령

- `npm run dev` 개발 서버 (백그라운드로만, 필요할 때만)
- `npm run check` = `tsc --noEmit` + `vitest run` + `vite build` — 커밋 전 필수
- `npm run assets:check` 그래픽 규격 검사, 주소 `?gallery=1` 그래픽 갤러리, `?debug=1` 디버그 키
- 스크린샷: `vite preview` + Playwright, chromium 경로 `/opt/pw-browsers`

## 일일 작업 절차

0. (SessionStart 훅이 자동 처리) `npm install`, `origin/main`을 현재 브랜치로 fast-forward. 훅이 경고를 출력했으면 그 내용을 먼저 해결
1. `docs/PROGRESS.md`에서 "다음 작업", "이월", "결정 사항" 확인. 직전 완료 Day의 산출물이 코드에 없으면(전날 main 반영 실패) 작업 전에 사용자에게 알리고 멈춤
2. `docs/WORKPLAN.md`의 해당 Day 절만 읽기(`grep -n "^### D"`로 위치를 찾고 그 범위만)
3. Day에 적힌 PRD 절만 읽기
4. 이월 → [필수] → [여유] 순으로 구현. [필수]를 마치기 전에는 [여유]에 손대지 않음
5. `npm run check` 통과. 실패를 남긴 채 커밋하지 않음(부득이하면 실패 내용을 PROGRESS 이월에 기록)
6. `docs/PROGRESS.md` 갱신: 파일 맨 아래 "갱신 규칙"대로(다음 작업, Day 줄, 진행 막대, 이월, 측정값)
7. 커밋 `Dxx: 한 줄 요약` 후 main 반영
   - 사용자 프롬프트에 "main에 바로 푸시해도 된다"가 있으면: `git push origin HEAD:main`
   - 거부되면: 세션 브랜치 푸시 → main 대상 PR 생성 → squash 병합
   - 그것도 안 되면: 세션 브랜치까지만 푸시하고 PROGRESS "이월"에 "main 반영 실패(브랜치명)" 기록, 사용자에게 알림
   - 허용 문구가 없으면 세션 브랜치까지만 푸시
8. 종료 보고는 3줄: 완료 / 이월 / 다음 작업. 사용량(%)을 알려주면 PROGRESS에 적겠다고 한 줄 덧붙임

사용자가 **"마무리해"** 라고 하면: 진행 중 항목을 컴파일되는 지점에서 멈추고(미완성 기능은 설정 플래그로 끔) 5~8단계만 수행.
사용자가 사용량(%)을 알려주면 PROGRESS의 해당 Day "사용량" 칸에 적는다.
현재 기준: Day 1개 ≈ 5시간 창의 20%(D02~D04 실측) → 한 세션에 `/day 4`, 무거운 Day(D05·D07·D13·D16)가 섞이면 `/day 3`. D03 완료 시점(그리고 각 단계 끝 Day)에 PROGRESS의 사용량 기록을 보고 WORKPLAN 1.2 보정 규칙에 따라 이후 분량을 조정하고, WORKPLAN·PROMPTS·PROGRESS를 함께 고친 뒤 "계획 변경 이력"에 기록.

## 사용량 절약 규칙

- PRD·WORKPLAN·PROMPTS 전체 읽기 금지. 이미 읽은 파일 재독 금지. 큰 파일은 필요한 범위만
- 하위 에이전트(Agent)·워크플로 사용 금지
- 테스트·빌드 출력은 요약/오류만. 긴 로그는 `tail`로
- 스크린샷은 ★마일스톤 Day에만 1~2장
- 설명은 짧게. 계획은 5줄 이내, 종료 보고는 3줄

## 코드 규칙

- 주석은 의도가 드러나지 않는 곳에만, 한국어 가능
- 수치는 data JSON에. PRD에 없는 값을 정할 때는 data에 두고 결정 이유를 커밋 메시지나 PROGRESS 메모에 한 줄
- 역사 소재 표현 원칙(PRD §1): 혈흔·신체 훼손·민간인 피해 묘사 없음, 실존 인물 실명 미사용
