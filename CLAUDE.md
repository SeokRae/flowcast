# flowcast

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> IF/서비스 흐름도 작업 하네스 — Claude Code 플러그인. 데이터·.pptx를 다이어그램 단위로 라우팅하고 검증한 뒤 drawer 서브에이전트를 병렬 팬아웃해 sequence·topology·component 뷰를 렌더링하며, 요청 시 PDF·편집가능 `.pptx`·PlantUML `.puml`(B-out)로도 출력. (생성·PPT입력(B-in)·PPT/PlantUML출력(B-out, 3뷰)·편집 경로 배선 완료 / 뷰확장 계획)

## 구조

| 경로 | 역할 |
|------|------|
| `skills/flowcast/` | `/flowcast` 오케스트레이터 — router 호출 → drawer 병렬 팬아웃 → 취합 |
| `skills/{sequence,topology,component}/` | 뷰별 드로잉 스킬 (`flowcast:{view}`) — 스키마·질의 대본·렌더·파일링 |
| `agents/diagram-router.md` | 데이터 → 다이어그램 단위 분할 + 뷰 판별 (그리지 않음) |
| `agents/diagram-drawer.md` | 단위 1건 → 뷰 스킬 로드 → JSON → render → 파일링 |
| `scripts/render.py` | JSON → self-contained HTML/PDF 렌더러 (스키마 단일 진실 = 상단 docstring) |
| `scripts/validate_manifest.py` | router manifest schema 1.0 검증 — drawer dispatch 전 필수 게이트 |
| `scripts/validate_plugin_manifest.py` | 플러그인 매니페스트 검증 (`plugin.json`·`marketplace.json` 필드·버전 3곳 일치·keywords 부분집합·스킬 경로 실존) — CI 게이트 |
| `scripts/pptx_import.py` | `.pptx` → 슬라이드별 draft JSON (도형·라벨·좌표·커넥터, stdlib) — B-in 입력 변환 |
| `scripts/pptx_export.py` | sequence·component·topology JSON → 편집가능 `.pptx` (python-pptx **선택적** 의존성, render.py 좌표·`layout_sequence` 재사용) — B-out 출력 |
| `scripts/plantuml_export.py` | sequence·component·topology JSON → PlantUML `.puml` 텍스트 (**stdlib만**, render.py 검증기 재사용·좌표 미사용) — B-out 출력 |
| `scripts/scan-sensitive.sh` | 실 데이터 유입 차단 게이트 |
| `scripts/regen-examples.sh` | `examples/*.json` → 예제 html·docs 게시본·puml 일괄 재생성 (골든 회귀 테스트가 누락을 잡는다) |
| `examples/*.json` | 합성 예제 (실 데이터 없음) |
| `docs/` | GitHub Pages 사이트 — `index.html` HTML 예제 갤러리 + `plantuml.html` PlantUML 출력 showcase + `examples/*.html`(게시용 복사본) + `examples/puml/*.{puml,svg}`(B-out export·렌더 스냅샷). Pages source = `main` `/docs`. 배포 URL `https://seokrae.github.io/flowcast/` |
| `tests/*.py` | 7개 — `test_render`(렌더러·골든 회귀) · `test_manifest` · `test_plugin_manifest` · `test_pptx_import` · `test_pptx_export` · `test_plantuml_export` · `test_scan_sensitive` |
| `requirements-dev.txt` | 개발 의존성 선언 (pytest·python-pptx) — 테스트 전용, 코어는 stdlib만 |

## 명령어

```bash
python3 -m pip install -r requirements-dev.txt  # 개발 의존성 (pytest·python-pptx) — 코어는 stdlib만
python3 -m pytest tests/          # 테스트
bash scripts/scan-sensitive.sh    # 실 데이터 스캔 게이트
bash scripts/regen-examples.sh    # 예제 산출물 재생성 (렌더러 수정 후 필수)
python3 scripts/render.py {json}               # 기본 → HTML
python3 scripts/render.py {json} --pdf         # 선택 → HTML+PDF (Chrome 필요)
python3 scripts/validate_manifest.py {units.json}  # drawer dispatch 전 manifest 검증
python3 scripts/validate_plugin_manifest.py        # 플러그인 매니페스트 검증 (CI 게이트)
python3 scripts/pptx_export.py {json} -o out.pptx  # B-out → 편집가능 .pptx (python-pptx 필요)
python3 scripts/plantuml_export.py {json} -o out.puml  # B-out → PlantUML .puml (stdlib, [--no-style] [--smetana])
```

## 규칙 (필수)

- **실 데이터 절대 금지** (public repo): 파트너·내부 식별자를 커밋하지 않는다. 예제는 전량 합성. 커밋·push 전 `scripts/scan-sensitive.sh`가 0건인지 확인 (CI도 매 push 검사).
- **원문 보존**: 실제 다이어그램을 옮길 때 라벨·포트·프로토콜을 원문 그대로 — 단, 그 산출물은 이 public repo가 아니라 사용자 로컬 `out_dir`에 파일링한다.
- **의존성 격리**: 코어(render/import/생성)는 **stdlib만**. python-pptx는 **PPT export 전용 선택적** 의존성 — `pptx_export.py`에서만 lazy import, 미설치 시 안내 후 종료. PlantUML export(`plantuml_export.py`)는 텍스트 출력이라 **stdlib만**(추가 의존성 없음). 새 기능에 의존성을 더할 땐 이 격리 원칙을 지킨다.
- **manifest 게이트**: router 출력의 미결 단위를 모두 해소해 선택·근거를 기록한 뒤 schema 1.0 manifest (`out_dir`·`units`·선택 `notes`)를 저장하고 `validate_manifest.py`를 실행한다. manifest 전체가 exit 0이 되기 전에는 drawer를 하나도 dispatch하지 않는다.
- **선택 출력 상태**: `pdf=false`, `export=false`, `plantuml=false`가 기본이다. 요청한 PDF에 Chrome이 없거나 PPT export에 python-pptx가 없으면 HTML/MD를 유지하고 `partial`로 보고한다. `plantuml`은 stdlib라 의존성-없음 partial 케이스가 없다. (옵션 전체는 `skills/flowcast/SKILL.md` 옵션표가 단일 진실)
- **새 뷰 추가**: ① `scripts/render.py`에 `render_svg_{view}`·`validate_{view}` + 디스패치, ② `skills/{view}/SKILL.md` 질의 대본, ③ router 라우팅 표 한 행, ④ 합성 예제 + 테스트, ⑤ 아래 **예제 산출물 재생성**.
- **예제 산출물 재생성**: 렌더러·exporter를 고치거나 예제를 추가하면 `bash scripts/regen-examples.sh`를 돌려 `examples/*.html`·`docs/examples/*.html`·`docs/examples/puml/*.puml`을 함께 커밋한다. 빠뜨리면 골든 회귀 테스트가 CI를 세운다. `.svg` 스냅샷은 `plantuml`이 설치돼 있을 때만 갱신된다(없으면 건너뛴다) — **`-nometadata` 필수**: 없으면 PlantUML이 SVG에 심는 압축 소스 블롭이 blocklist 토큰을 우연히 포함해 `scan-sensitive.sh`가 오탐한다. 새 예제는 게시 카드도 수동 등록해야 한다 — `docs/index.html` 카드 한 벌 + `docs/plantuml.html`의 `EXAMPLES` 배열(137행) 한 행.

## 릴리즈

버전은 3곳을 함께 올린다: `.claude-plugin/plugin.json`의 `version` · `.claude-plugin/marketplace.json`의 `metadata.version` · 같은 파일의 `plugins[0].version`. **keywords도 두 파일을 함께 고친다** — `marketplace.plugins[0].keywords`는 `plugin.json`의 부분집합이어야 하며 `validate_plugin_manifest.py`가 검사한다. 로컬 반영: `~/.claude/plugins/marketplaces/flowcast` git pull → `claude plugin update flowcast` → 세션 재시작.

## 설계 결정 (지금도 코드를 구속하는 것)

전체 변경 이력은 [CHANGELOG.md](CHANGELOG.md)에 있다. 아래는 고치면 회귀가 나는 결정만 남긴 것이다.

- **배지 좌표 단일 진실** — topology 번호 배지의 겹침 회피(`_t_badge_geom`/`_t_spread_badges`)는 `render.py`에 있고 `pptx_export.py`가 그대로 참조한다. 한쪽만 고치면 HTML과 PPT가 갈린다 (#19·#21).
- **z-순서** — topology·component는 존 → 커넥터 → 노드 순으로 그린다. 노드가 관통 선을 가려야 해서다. HTML·pptx 양쪽 동일 (#25).
- **rectangle 뷰 기본 레이아웃은 dot** — `!pragma layout smetana`는 캔버스를 클리핑한다(자체 예제에서 라벨 절단 확인). `--smetana`는 graphviz 없는 환경용 opt-in이며 요청 없이 켜지 않는다 (#55).
- **topology `.puml`은 엣지에 번호만, 설명은 `legend`로** — 한 pair에 링크와 세그먼트가 겹치면 PlantUML이 라벨을 같은 지점에 스택해 노드명까지 가린다 (#57).
- **PlantUML SVG 재생성은 `-nometadata` 필수** — 없으면 압축 소스 블롭이 blocklist 토큰을 우연히 포함해 `scan-sensitive.sh`가 오탐한다 (#73).

## 라이선스

MIT © SeokRae
