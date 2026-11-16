# 사이트에 게임 배너 넣기 (미스털이 mrlee.co.kr)

게임 주소: **https://kimsehoon81.github.io/surv1009/** (main에 푸시할 때마다 자동 배포)

이 주소를 새 창(새 탭)으로 띄우면 됩니다. 휴대폰에서는 게임이 알아서 가로 화면으로 돌고 터치 조작판이 나옵니다.
배너 그림은 사이트 쪽에서 직접 만든 것을 씁니다(이 저장소에는 배너 그림을 두지 않음).

아래 두 코드는 **6.25 서바이벌 ↔ 고스트택틱스** 배너가 번갈아 미끄러지는 슬라이드입니다. 넣을 자리에 통째로 붙여 넣고, 맨 위 `[...]` 세 곳만 실제 주소로 바꿉니다.

- `[6.25 배너 그림 주소]` — 직접 만든 6.25 서바이벌 배너 이미지
- `[고스트택틱스 배너 그림 주소]`, `[고스트택틱스 주소]` — 지금 쓰고 있는 배너 이미지와 링크

두 배너 그림의 가로·세로 비율이 같아야 높이가 흔들리지 않습니다. 넘기는 간격은 `data-interval`(밀리초).

## 1 → 3: PC용 (슬라이드 + 아래 1·2 버튼, 누르면 새 창)

마우스를 올리면 멈추고, 아래 `1` `2`를 누르면 그 배너로 갑니다. 6.25 서바이벌 배너를 누르면 게임 크기에 맞춘 새 창(960×540, 큰 모니터는 1920×1080)이 뜨고, 팝업이 막혀 있으면 새 탭으로 열립니다.

```html
<!-- 게임 배너 슬라이드 (PC) -->
<div class="gbn" id="gbnPc" data-interval="4000">
  <div class="gbn-view">
    <div class="gbn-track">
      <a class="gbn-slide" data-popup="1" href="https://kimsehoon81.github.io/surv1009/" target="_blank" rel="noopener">
        <img src="[6.25 배너 그림 주소]" alt="6.25 서바이벌">
      </a>
      <a class="gbn-slide" href="[고스트택틱스 주소]" target="_blank" rel="noopener">
        <img src="[고스트택틱스 배너 그림 주소]" alt="고스트택틱스">
      </a>
    </div>
  </div>
  <div class="gbn-dots"></div>
</div>
<style>
  .gbn { width: 100%; max-width: 100%; }
  .gbn-view { overflow: hidden; }
  .gbn-track { display: flex; transition: transform .45s ease; will-change: transform; }
  .gbn-slide { flex: 0 0 100%; display: block; line-height: 0; }
  .gbn-slide img { width: 100%; height: auto; display: block; border: 0; }
  .gbn-dots { display: flex; justify-content: center; gap: 6px; margin-top: 6px; }
  .gbn-dots button { min-width: 22px; height: 22px; padding: 0 4px; font-size: 12px; line-height: 20px; cursor: pointer;
    background: transparent; border: 1px solid transparent; color: #555; }
  .gbn-dots button.on { border-color: #0a8f7a; color: #0a8f7a; background: #fff; }
</style>
<script>
(function () {
  var root = document.getElementById('gbnPc');
  if (!root) return;
  var track = root.querySelector('.gbn-track');
  var dots = root.querySelector('.gbn-dots');
  var n = track.children.length;
  var i = 0, timer = 0;
  // 끝에서 처음으로도 같은 방향으로 미끄러지게 첫 배너를 하나 더 붙임
  track.appendChild(track.children[0].cloneNode(true));
  for (var k = 0; k < n; k++) (function (k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = k + 1;
    b.onclick = function () { go(k); start(); };
    dots.appendChild(b);
  })(k);
  function paint() {
    track.style.transform = 'translateX(' + (-100 * i) + '%)';
    for (var k = 0; k < n; k++) dots.children[k].className = k === i % n ? 'on' : '';
  }
  // 덧붙인 첫 배너(끝)에 와 있으면 진짜 첫 배너 자리로 소리 없이 되돌림
  function snap() {
    if (i < n) return;
    track.style.transition = 'none';
    i = 0;
    paint();
    void track.offsetWidth;
    track.style.transition = '';
  }
  function go(to) { snap(); i = to; paint(); }
  function next() { snap(); go(i + 1); }
  track.addEventListener('transitionend', snap);
  function start() {
    clearInterval(timer);
    timer = setInterval(next, +root.getAttribute('data-interval') || 4000);
  }
  root.addEventListener('mouseenter', function () { clearInterval(timer); });
  root.addEventListener('mouseleave', start);
  // 6.25 서바이벌: 게임 화면(960×540)의 정수배 새 창. 팝업이 막히면 링크 그대로(새 탭)
  root.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-popup]') : null;
    if (!a) return;
    var big = screen.availWidth >= 1960 && screen.availHeight >= 1170;
    var w = big ? 1920 : 960, h = big ? 1080 : 540;
    var x = Math.max(0, Math.round((screen.availWidth - w) / 2)), y = Math.max(0, Math.round((screen.availHeight - h) / 2));
    var win = window.open(a.href, 'game625', 'popup=yes,width=' + w + ',height=' + h + ',left=' + x + ',top=' + y + ',resizable=yes');
    if (win) { e.preventDefault(); win.focus(); }
  });
  paint();
  start();
})();
</script>
```

## 2 → 3: 모바일용 (슬라이드 + 손가락으로 넘기기, 누르면 새 탭)

똑같이 번갈아 미끄러지고, 좌우로 밀어 넘길 수 있습니다. 누르면 새 탭으로 게임이 열립니다(휴대폰 브라우저는 창 크기를 정할 수 없어 새 탭이 곧 새 창).

```html
<!-- 게임 배너 슬라이드 (모바일) -->
<div class="gbn" id="gbnMo" data-interval="4000">
  <div class="gbn-view">
    <div class="gbn-track">
      <a class="gbn-slide" href="https://kimsehoon81.github.io/surv1009/" target="_blank" rel="noopener">
        <img src="[6.25 배너 그림 주소]" alt="6.25 서바이벌">
      </a>
      <a class="gbn-slide" href="[고스트택틱스 주소]" target="_blank" rel="noopener">
        <img src="[고스트택틱스 배너 그림 주소]" alt="고스트택틱스">
      </a>
    </div>
  </div>
  <div class="gbn-dots"></div>
</div>
<style>
  .gbn { width: 100%; max-width: 100%; }
  .gbn-view { overflow: hidden; touch-action: pan-y; }
  .gbn-track { display: flex; transition: transform .4s ease; will-change: transform; }
  .gbn-slide { flex: 0 0 100%; display: block; line-height: 0; -webkit-tap-highlight-color: transparent; }
  .gbn-slide img { width: 100%; height: auto; display: block; border: 0; -webkit-user-drag: none; }
  .gbn-dots { display: flex; justify-content: center; gap: 8px; margin-top: 6px; }
  .gbn-dots button { min-width: 26px; height: 26px; padding: 0 4px; font-size: 13px; line-height: 24px;
    background: transparent; border: 1px solid transparent; color: #555; }
  .gbn-dots button.on { border-color: #0a8f7a; color: #0a8f7a; background: #fff; }
</style>
<script>
(function () {
  var root = document.getElementById('gbnMo');
  if (!root) return;
  var view = root.querySelector('.gbn-view');
  var track = root.querySelector('.gbn-track');
  var dots = root.querySelector('.gbn-dots');
  var n = track.children.length;
  var i = 0, timer = 0, x0 = null, moved = false;
  track.appendChild(track.children[0].cloneNode(true));
  for (var k = 0; k < n; k++) (function (k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = k + 1;
    b.onclick = function () { go(k); start(); };
    dots.appendChild(b);
  })(k);
  function paint() {
    track.style.transform = 'translateX(' + (-100 * i) + '%)';
    for (var k = 0; k < n; k++) dots.children[k].className = k === i % n ? 'on' : '';
  }
  // 덧붙인 첫 배너(끝)에 와 있으면 진짜 첫 배너 자리로 소리 없이 되돌림
  function snap() {
    if (i < n) return;
    track.style.transition = 'none';
    i = 0;
    paint();
    void track.offsetWidth;
    track.style.transition = '';
  }
  function go(to) { snap(); i = to; paint(); }
  function next() { snap(); go(i + 1); }
  track.addEventListener('transitionend', snap);
  function start() {
    clearInterval(timer);
    timer = setInterval(next, +root.getAttribute('data-interval') || 4000);
  }
  // 좌우로 40px 넘게 밀면 넘김(밀었을 때는 링크가 열리지 않게)
  view.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; moved = false; clearInterval(timer); }, { passive: true });
  view.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) {
      moved = true;
      if (dx < 0) next();
      else { snap(); go((i + n - 1) % n); }
    }
    start();
  });
  view.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);
  paint();
  start();
})();
</script>
```

PC용과 모바일용을 같은 페이지에 둘 다 넣어도 서로 간섭하지 않습니다(id가 `gbnPc`·`gbnMo`로 다름).

## 모바일에서 게임이 어떻게 보이나

- **가로 화면**: 휴대폰을 세로로 들고 있어도 게임이 90° 돌아 가로로 나옵니다(화면 회전 잠금과 무관). 안드로이드는 메뉴 화면 왼쪽의 `⛶`(전체 화면)를 누르면 주소창이 사라지고 가로로 고정됩니다(아이폰 사파리는 전체 화면을 지원하지 않음 → 공유 → '홈 화면에 추가'로 열면 주소창 없이 실행).
- **터치 조작**(전투): 화면 왼쪽을 끌면 조이스틱(이동), 오른쪽에 `질주` · 스킬 `Q E R F`(가진 것만) · `제출`/`인장`(카드) · `작전표` · `Ⅱ`(일시정지). 카드는 손패를 직접 눌러 고릅니다.
- **터치 조작**(메뉴·멈춘 창): 왼쪽 방향 버튼, 오른쪽 `확인`·`뒤로`. 항목을 직접 눌러도 됩니다.
- 버튼 구성은 `src/data/touch.json`, 크기·자리는 `index.html`의 `.t-*` CSS. 주소에 `?touch=1`을 붙이면 PC에서도 조작판을 볼 수 있습니다.
