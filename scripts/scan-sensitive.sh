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
# k7 은 단어경계(\b)로 고정한다 — 없으면 PlantUML 자동 생성 링크 id(lnk7 등)의
# 부분 문자열 'k7'에 오탐한다 (#64). 독립 토큰 k7 은 그대로 탐지된다.
PAT_I='nastec|vpg|lotte|nicepay|\bk7\b|acct_[0-9A-Za-z]+|settreport_|payauthz_|refauthz_|payonly|bid_[0-9]|clientId|partnerTransactionId'
# 한글 파트너/내부 표현
PAT_KO='나스텍|롯데|입금정산'
# 회사명 NICE (영어 일반어 nice 와 구분: 대문자 단어경계)
PAT_NICE='\bNICE\b'

# PLAN.md(내부 planning, .gitignore로 미공개) 와 스캔 스크립트 자신은 제외.
# flowcast-out/·_workspace*/ 는 실행 산출물이라 실 데이터가 정상적으로 들어간다 —
# .gitignore 로 커밋되지 않으므로 게이트 대상이 아니다(로컬 실행 시 전량 매치를 막는다).
# .pytest_cache 도 같은 이유 — pytest 가 테스트 id 를 nodeids 에 적어 두는데,
# 게이트 자신의 회귀 테스트(tests/test_scan_sensitive.py)가 바로 그 자리를 채운다.
EXCL="--exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=.pytest_cache --exclude-dir=flowcast-out --exclude-dir=_workspace --exclude-dir=_workspace_prev --exclude=scan-sensitive.sh --exclude=PLAN.md"

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
