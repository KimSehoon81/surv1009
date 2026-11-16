# 사이트에 게임 배너 넣기 (mrlee.co.kr 등)

게임 주소: **https://kimsehoon81.github.io/surv1009/** (main에 푸시할 때마다 자동 배포)
배너 미리보기: https://kimsehoon81.github.io/surv1009/banner/

배너를 누르면 **PC는 새 창**(게임 화면 크기에 맞춘 팝업, 화면이 크면 2배), **휴대폰·태블릿은 새 탭**으로 게임이 열립니다. 휴대폰에서는 게임이 알아서 가로 화면으로 돌고 터치 조작판이 나옵니다.

## 방법 1 — 한 줄(권장)

배너를 보이고 싶은 자리에 아래 한 줄을 붙여 넣습니다. 그림·링크·새 창 열기가 모두 들어 있고, 배너 그림을 바꿔도 사이트는 손댈 필요가 없습니다.

```html
<script src="https://kimsehoon81.github.io/surv1009/banner/banner.js" data-size="728x90"></script>
```

`data-size`: `728x90`(가로 띠) · `320x100`(모바일 띠) · `300x250`(네모) · `600x300`(큰 네모) · `auto`(화면 폭 600px 미만이면 320x100, 아니면 728x90). 배너는 놓인 칸보다 넓으면 자동으로 줄어듭니다.

## 방법 2 — 스크립트를 못 쓰는 편집기(블로그·게시판 본문)

`<script>`가 지워지는 곳에서는 그림 링크만 넣습니다. 누르면 새 탭으로 열립니다.

```html
<a href="https://kimsehoon81.github.io/surv1009/" target="_blank" rel="noopener">
  <img src="https://kimsehoon81.github.io/surv1009/banner/banner_728x90.png" width="728" height="90"
       alt="압록강 서바이벌 — 6·25 배경 도트 서바이벌 게임" style="max-width:100%;height:auto;border:0">
</a>
```

## 방법 3 — 그림 링크 + PC에서는 팝업 창(스크립트 파일 없이)

```html
<a href="https://kimsehoon81.github.io/surv1009/" target="_blank" rel="noopener"
   onclick="if(!(navigator.maxTouchPoints>0&&matchMedia('(pointer: coarse)').matches)){var b=screen.availWidth>=1960&&screen.availHeight>=1170,w=b?1920:960,h=b?1080:540;if(window.open(this.href,'amnok_survival','popup=yes,width='+w+',height='+h+',resizable=yes'))return false;}">
  <img src="https://kimsehoon81.github.io/surv1009/banner/banner_728x90.png" width="728" height="90"
       alt="압록강 서바이벌" style="max-width:100%;height:auto;border:0">
</a>
```

## 배너 그림 다시 만들기

`node tools/make-banner.mjs` → `public/banner/banner_<크기>.png`(2배 해상도). 문구·크기는 그 파일 위쪽에서 바꿉니다. 첫 화면 배경(`public/assets/sprites/title_bg.png`)과 캐릭터 걷는 그림을 씁니다.

## 모바일에서 어떻게 보이나

- **가로 화면**: 휴대폰을 세로로 들고 있어도 게임이 90° 돌아 가로로 나옵니다(화면 회전 잠금과 무관). 가로로 돌리면 그대로 맞춰집니다. 안드로이드는 메뉴 화면 왼쪽의 `⛶`(전체 화면)를 누르면 주소창이 사라지고 가로로 고정됩니다(아이폰 사파리는 전체 화면을 지원하지 않음 → 공유 → '홈 화면에 추가'로 열면 주소창 없이 실행).
- **터치 조작**(전투): 화면 왼쪽을 끌면 조이스틱(이동), 오른쪽에 `질주` · 스킬 `Q E R F`(가진 것만) · `제출`/`인장`(카드) · `작전표` · `Ⅱ`(일시정지). 카드는 손패를 직접 눌러 고릅니다.
- **터치 조작**(메뉴·멈춘 창): 왼쪽 방향 버튼, 오른쪽 `확인`·`뒤로`. 항목을 직접 눌러도 됩니다.
- 버튼 구성은 `src/data/touch.json`, 크기·자리는 `index.html`의 `.t-*` CSS. 주소에 `?touch=1`을 붙이면 PC에서도 조작판을 볼 수 있습니다.
