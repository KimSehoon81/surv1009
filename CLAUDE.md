# 압록강 서바이벌 (가칭)

6·25전쟁 배경 레트로 2D 도트 뱀파이어 서바이벌류 + 성공 30% 확률형 전략카드 조합 스킬 게임.

- 게임 PRD: `docs/PRD_v0.1.md` (전체를 읽지 말 것. 필요한 절만 grep으로 찾아 읽기)
- 일일 작업계획: `docs/WORKPLAN.md` (그날 Day 절만 읽기)
- 진행 기록: `docs/PROGRESS.md` (매 세션 시작·종료 시 읽고 갱신)
- 에셋 규격: `docs/ASSETS.md`

## 기술 스택과 구조

Phaser 3 + TypeScript + Vite, 테스트 Vitest. 논리 해상도 960×540, 정수 배율 ×2, `pixelArt: true`.
(PROGRESS.md "결정 사항"에 다른 값이 있으면 그것을 따름)

- `src/core/`: 게임 규칙 순수 함수. **Phaser import 금지**. 모든 확률은 `core/rng.ts`의 시드 RNG 사용. 테스트 필수
- `src/data/*.json`: 카드·적·스킬·스테이지·수치. 밸런스 숫자를 코드에 하드코딩하지 않음
- `src/systems/`, `src/entities/`, `src/scenes/`: Phaser 쪽 표현·입력
- `src/assets/manifest.ts`: 에셋 키 → 경로. 파일이 없으면 자리표시자 텍스처를 생성. 그래픽은 사용자가 별도 제작하므로 **에셋 부재로 작업을 멈추지 않음**
- 대량 개체는 오브젝트 풀 + 공간 분할 그리드. 파티클 300, 데미지 숫자 40 상한(PRD §4.4)

## 명령

- `npm run dev` 개발 서버 (출력이 계속되므로 백그라운드로만 실행하고 필요할 때만)
- `npm run check` = `tsc --noEmit` + `vitest run --reporter=dot` + `vite build` — 커밋 전 필수

## 일일 작업 절차 (`/day`)

1. `docs/PROGRESS.md`의 "다음 Day", "이월 항목", "결정 사항" 확인. 직전 완료 Day의 산출물이 현재 코드에 있는지 확인하고, 없으면(전날 브랜치가 main에 병합 안 됨) 작업 전에 사용자에게 알림
2. `docs/WORKPLAN.md`에서 해당 Day 절만 읽기 (`grep -n "### Dxx"`로 위치 찾고 그 범위만)
3. Day에 적힌 PRD 절만 읽기
4. 이월 → [필수] → [여유] 순으로 구현. [필수]를 마치기 전에는 [여유]에 손대지 않음
5. `npm run check` 통과시키기. 실패를 남긴 채 커밋하지 않음 (부득이하면 실패 내용을 PROGRESS에 기록)
6. `docs/PROGRESS.md` 갱신: 일지 한 줄(완료/이월/메모), "다음 Day", 이월 항목, 측정값(FPS 등)
7. 커밋 메시지 `Dxx: 한 줄 요약` 후 현재 세션 브랜치로 푸시
8. `.claude/skills/day/SKILL.md`의 병합 단계 수행

사용자가 **"마무리해"** 라고 하면: 진행 중 항목을 컴파일되는 지점에서 멈추고(미완성 기능은 플래그로 꺼둠) 5~8단계만 수행.

D03 완료 후에는 PROGRESS.md의 "체감 사용량(%)"을 보고 WORKPLAN.md 1.2 보정 규칙에 따라 이후 Day 분량을 조정하고 그 변경을 WORKPLAN.md에 반영.

## 사용량 절약 규칙

- PRD·WORKPLAN 전체 읽기 금지. 이미 읽은 파일 재독 금지. 큰 파일은 필요한 범위만
- 하위 에이전트(Agent) 사용 금지
- 테스트·빌드 출력은 요약/오류만. 긴 로그는 `tail`로
- 스크린샷(Playwright, 크로미움 `/opt/pw-browsers`)은 WORKPLAN의 ★마일스톤 Day에만 1~2장
- 설명은 짧게. 작업 결과 보고는 완료·이월·다음 Day 3줄 이내

## 코드 규칙

- 주석은 의도가 드러나지 않는 곳에만, 한국어 가능
- PRD 수치를 구현할 때는 data JSON에 두고 키 이름 옆에 PRD 절 번호를 남기지 않아도 됨(이력은 커밋으로)
- 역사 소재 표현 원칙(PRD §1): 혈흔·신체 훼손·민간인 피해 묘사 없음, 실존 인물 실명 미사용
