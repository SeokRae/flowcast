#!/usr/bin/env bash
# regen-examples.sh — 합성 예제 산출물 재생성 (examples/ + docs/ 게시본)
#
# examples/*.json 을 단일 진실로 삼아 아래를 다시 만든다:
#   examples/{name}.html            render.py 출력
#   docs/examples/{name}.html       Pages 게시본 (examples 와 byte-identical)
#   docs/examples/puml/{name}.puml  B-out PlantUML 소스
#
# .svg 스냅샷(Pages showcase)은 plantuml 바이너리가 있을 때만 갱신한다 — 없으면 건너뛴다.
# 렌더러를 고친 PR 은 이 스크립트를 돌리고 결과를 함께 커밋한다 —
# tests/test_render.py 의 골든 테스트가 누락 시 CI 를 세운다.
#
# 사용: bash scripts/regen-examples.sh   (어느 디렉토리에서든)

set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p docs/examples/puml

for json in examples/*.json; do
  name="$(basename "$json" .json)"
  python3 scripts/render.py "$json" >/dev/null
  cp "examples/$name.html" "docs/examples/$name.html"
  python3 scripts/plantuml_export.py "$json" -o "docs/examples/puml/$name.puml" >/dev/null
  echo "✓ $name — html · docs 게시본 · puml"
done

if command -v plantuml >/dev/null 2>&1; then
  # -nometadata 필수 — 없으면 PlantUML 이 압축 소스 블롭(<?plantuml-src?>)을 SVG 에 심는데,
  # 그 base64 가 실 데이터 blocklist 토큰을 우연히 포함해 scan-sensitive 가 오탐한다
  # (#64 의 lnk7 과 같은 계열, 재생성마다 걸릴지 말지가 복권이 된다).
  ( cd docs/examples/puml && plantuml -tsvg -nometadata ./*.puml )
  echo "✓ .svg 스냅샷 (plantuml -nometadata)"
else
  echo "· plantuml 없음 — .svg 스냅샷 건너뜀 (.puml 변경 시 별도 갱신 필요)"
fi

echo ""
echo "재생성 완료. 'git status' 로 변경분을 확인하고 함께 커밋한다."
