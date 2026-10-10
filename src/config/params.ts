// URL 파라미터(개발·테스트용). 예: ?char=A02&debug=1&seed=test, ?gallery=1
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export const params = {
  /** 시작 캐릭터 */
  char: q.get('char') ?? 'A01',
  /** 그래픽 갤러리 화면으로 시작 */
  gallery: q.has('gallery'),
  /** 디버그 키·표시 */
  debug: import.meta.env.DEV || q.has('debug'),
  /** 바닥 무늬 등 시드 */
  seed: q.get('seed') ?? 'amnok',
};
