/*
 * 압록강 서바이벌 배너 — 사이트에 한 줄로 넣기:
 *   <script src="https://kimsehoon81.github.io/surv1009/banner/banner.js" data-size="728x90"></script>
 * data-size: 728x90(기본) · 320x100 · 300x250 · 600x300, data-size="auto"면 좁은 화면(600px 미만)에서 320x100
 * 누르면 PC는 새 창(게임 화면 크기에 맞춘 팝업), 휴대폰·태블릿은 새 탭으로 게임이 열립니다.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var base = script.src.replace(/banner\.js(\?.*)?$/, '');
  var game = script.getAttribute('data-game') || base.replace(/banner\/$/, '');
  var size = script.getAttribute('data-size') || '728x90';
  if (size === 'auto') size = window.innerWidth < 600 ? '320x100' : '728x90';
  var wh = size.split('x');

  var a = document.createElement('a');
  a.href = game;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = '압록강 서바이벌 — 지금 플레이';
  a.style.cssText = 'display:inline-block;max-width:100%;line-height:0';
  var img = document.createElement('img');
  img.src = base + 'banner_' + size + '.png';
  img.width = +wh[0];
  img.height = +wh[1];
  img.alt = '압록강 서바이벌 — 6·25 배경 도트 서바이벌 게임';
  img.style.cssText = 'max-width:100%;height:auto;border:0;display:block';
  a.appendChild(img);

  a.addEventListener('click', function (e) {
    // 터치 기기는 새 탭 그대로(게임이 알아서 가로 화면·터치 조작으로 바뀜)
    var touch = navigator.maxTouchPoints > 0 && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch) return;
    // PC: 게임 화면(960×540)의 정수배 창. 화면이 넉넉하면 2배
    var big = screen.availWidth >= 1960 && screen.availHeight >= 1170;
    var w = big ? 1920 : 960;
    var h = big ? 1080 : 540;
    var left = Math.max(0, Math.round((screen.availWidth - w) / 2));
    var top = Math.max(0, Math.round((screen.availHeight - h) / 2));
    var win = window.open(game, 'amnok_survival', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes');
    // 팝업이 막혔으면 링크의 기본 동작(새 탭)에 맡김
    if (win) {
      e.preventDefault();
      win.focus();
    }
  });
  script.parentNode.insertBefore(a, script);
})();
