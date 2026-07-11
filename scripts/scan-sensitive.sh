#!/usr/bin/env bash
# scan-sensitive.sh — flowcast 실 데이터 유입 차단 게이트
#
# public repo 이므로 실제 파트너·내부 식별자가 절대 포함되면 안 된다.
# push / 공개 / CI 에서 이 스크립트가 0건(exit 0)일 때만 통과한다.
# 한 건이라도 매치되면 exit 1 로 파이프라인을 세운다.
#
# 사용: bash scripts/scan-sensitive.sh   (repo 루트에서)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 대소문자 무시 라틴 고유 토큰 + 식별자 패턴 (파트너명·계정·거래/정산 ID)
PAT_I='nastec|vpg|lotte|nicepay|k7|acct_[0-9A-Za-z]+|settreport_|payauthz_|refauthz_|payonly|bid_[0-9]|clientId|partnerTransactionId'
# 한글 파트너/내부 표현
PAT_KO='나스텍|롯데|입금정산'
# 회사명 NICE (영어 일반어 nice 와 구분: 대문자 단어경계)
PAT_NICE='\bNICE\b'

# PLAN.md(내부 planning, .gitignore로 미공개) 와 스캔 스크립트 자신은 제외
EXCL="--exclude-dir=.git --exclude-dir=__pycache__ --exclude=scan-sensitive.sh --exclude=PLAN.md"

hits=0

run() {
  local label="$1"; shift
  local out
  out="$(grep -rEn ${EXCL} "$@" . 2>/dev/null || true)"
  if [ -n "$out" ]; then
    echo "⛔ [$label] 실 데이터 의심 매치:"
    echo "$out"
    hits=1
  fi
}

run "latin/id" -i "$PAT_I"
run "korean"   -i "$PAT_KO"
run "NICE"     "$PAT_NICE"

if [ "$hits" -ne 0 ]; then
  echo ""
  echo "❌ 차단: 위 매치를 제거하기 전에는 push/공개 금지."
  exit 1
fi

echo "✅ CLEAN — 실 데이터 blocklist 매치 0건. 공개 가능."
exit 0
