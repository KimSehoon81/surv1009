# 압록강 서바이벌 (가칭)

6·25전쟁 배경 레트로 2D 도트 서바이벌 액션 + 성공 30% 확률형 전략카드 조합 스킬 게임.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run check    # 타입 검사 + 테스트 + 빌드
npm run build    # dist/ 에 배포용 빌드
```

- 게임 중 `F1`: 디버그 표시(FPS, 개체 수, 전투 시계). 이동 WASD·방향키, 일시정지 Esc
- 개발용 주소: `?debug=1`(디버그 키 J공격 K방어 L스킬 U치명 O느림 C캐릭터), `?char=A02`(시작 캐릭터), `?gallery=1`(그래픽 갤러리: 모든 유닛 동작을 기준선과 함께 재생)
- `npm run assets:check`: `public/assets` 파일 규격(크기·파일명·투명 채널) 검사
- 그래픽은 `public/assets/` 아래에 규격대로 PNG를 넣으면 자동으로 교체됩니다. 없으면 자리표시자로 그립니다. 규격은 [에셋 납품 가이드](docs/ASSETS.md) 참고.

## 문서

| 문서 | 내용 |
| --- | --- |
| [진척도 대시보드](docs/PROGRESS.md) | 오늘 할 일, 단계별 진행 막대, Day별 현황 |
| [Day별 실행 프롬프트](docs/PROMPTS.md) | 매일 Claude Code에 붙여넣는 프롬프트 |
| [일일 작업계획](docs/WORKPLAN.md) | 45일 작업 항목과 완료 기준 |
| [에셋 납품 가이드](docs/ASSETS.md) | 그래픽 규격·파일명·필요 시점 |
| [게임 PRD](docs/PRD_v0.1.md) | 게임 기획 원문 |

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/core/` | 게임 규칙 순수 함수(Phaser 없음, 테스트 대상) |
| `src/data/` | 수치·콘텐츠 JSON |
| `src/systems/` | 전투 시계, 에셋 로더, 자리표시자, 디버그 등 |
| `src/scenes/` | Boot → Preload → Battle |
| `src/assets/manifest.ts` | 에셋 키·경로·규격 |
| `tools/` | 에셋 목록 생성 등 보조 스크립트 |
| `tests/` | Vitest |
