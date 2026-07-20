#!/usr/bin/env bash
# regen-examples.sh — 합성 예제 산출물 재생성 (examples/ + docs/ 게시본)
#
# examples/*.json 을 단일 진실로 삼아 아래를 다시 만든다:
#   examples/{name}.html            render.py 출력
#   docs/examples/{name}.html       Pages 게시본 (examples 와 byte-identical)
#   docs/examples/puml/{name}.puml  B-out PlantUML 소스
#
# .svg 스냅샷은 plantuml 바이너리가 필요해 이 스크립트 범위 밖이다.
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

echo ""
echo "재생성 완료. 'git status' 로 변경분을 확인하고 함께 커밋한다."
