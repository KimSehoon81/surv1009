// 전역 오류 처리(D44): 잡히지 않은 오류·거부된 약속 → 콘솔 기록 + 오류 화면(세이브 안내, 다시 불러오기).
// Phaser가 망가졌어도 보이게 DOM으로 그린다. 첫 오류만 화면에, 나머지는 콘솔에만.
import { t } from '../i18n';

let shown = false;

export function showFatal(detail: string): void {
  console.error('[fatal]', detail);
  if (shown || typeof document === 'undefined') return;
  shown = true;
  const box = document.createElement('div');
  box.id = 'fatal-error';
  box.setAttribute('role', 'alertdialog');
  box.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(20,14,10,.94);color:#e8dcc0;font:16px/1.5 monospace;text-align:center';
  const title = document.createElement('div');
  title.textContent = t('error.title');
  title.style.cssText = 'color:#ff8060;font-size:22px';
  const body = document.createElement('div');
  body.textContent = t('error.body');
  body.style.maxWidth = '640px';
  const pre = document.createElement('pre');
  pre.textContent = detail.slice(0, 600);
  pre.style.cssText = 'max-width:80vw;max-height:30vh;overflow:auto;font-size:11px;color:#b0a890;text-align:left;white-space:pre-wrap';
  const btn = document.createElement('button');
  btn.textContent = t('error.reload');
  btn.style.cssText = 'font:16px monospace;padding:6px 18px;background:#ffe14d;color:#1a1410;border:0;cursor:pointer';
  btn.onclick = () => window.location.reload();
  box.append(title, body, pre, btn);
  document.body.appendChild(box);
}

export function installErrorScreen(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => showFatal(e.error instanceof Error ? (e.error.stack ?? e.error.message) : e.message));
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    showFatal(r instanceof Error ? (r.stack ?? r.message) : String(r));
  });
}
