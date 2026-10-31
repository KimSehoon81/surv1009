// URL 파라미터(개발·테스트용). 예: ?char=A02&debug=1&seed=test, ?gallery=1(그래픽)·?gallery=audio(소리)
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const params = {
  /** 시작 캐릭터 */
  char: q.get('char') ?? 'A01',
  /** 그래픽 갤러리 화면으로 시작 */
  gallery: q.has('gallery'),
  /** 소리 검수 화면 */
  audioGallery: q.get('gallery') === 'audio',
  /** 디버그 키·표시 */
  debug: import.meta.env.DEV || q.has('debug'),
  /** 스테이지(stages.json 키) */
  stage: q.get('stage') ?? 'S1',
  /** 메뉴를 건너뛰고 바로 전투(?debug=1·?battle=1, ?menu=1이면 메뉴부터) */
  quickBattle: (q.has('debug') || q.has('battle')) && !q.has('menu'),
  /** 저장 초기화(첫 실행 흐름 확인용, ?reset=1) */
  reset: q.has('reset'),
  /** 바닥 무늬 등 시드 */
  seed: q.get('seed') ?? 'amnok',
};
