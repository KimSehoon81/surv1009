#!/usr/bin/env bash
# 매 세션 시작: main 최신 커밋 동기화 + 의존성 설치. 정상일 때는 아무것도 출력하지 않는다(대화 토큰 절약).
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if git fetch --quiet origin main 2>/dev/null; then
  if ! git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
    if ! git merge --ff-only --quiet origin/main >/dev/null 2>&1; then
      echo "[session-start] 경고: 현재 브랜치가 origin/main을 포함하지 않고 fast-forward도 불가. 작업 전에 git merge origin/main으로 정리할 것."
    fi
  fi
else
  echo "[session-start] 경고: origin/main을 가져오지 못함(원격 main 없음 또는 권한 문제)."
fi

if [ -f package.json ]; then
  if [ -f package-lock.json ]; then cmd="npm ci"; else cmd="npm install"; fi
  if ! $cmd --no-audit --no-fund --loglevel=error >/dev/null 2>&1; then
    echo "[session-start] 경고: $cmd 실패. 작업 전에 직접 실행해 원인을 확인할 것."
  fi
fi
exit 0
