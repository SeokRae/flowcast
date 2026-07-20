# flowcast

> IF/서비스 흐름도 **작업 하네스** — 데이터를 다이어그램 단위로 라우팅하고 drawer 서브에이전트를 **병렬 팬아웃**해 흐름도를 다루는 Claude Code 플러그인.

flowcast는 흐름도를 "생성"만 하는 도구가 아니라, IF/서비스 흐름도 **작업 전반**(생성·변환·검증·편집·PPT 입출력)을 다루는 하네스다. JSON을 손으로 짜지 않게 한다 — 데이터와 패턴 의도를 주면, 라우터가 다이어그램 단위로 쪼개고 뷰를 판별한 뒤, 여러 drawer가 각자 하나씩 렌더·파일링한다. 한 요청에서 **여러 다이어그램을 동시에** 뽑을 수 있다.

**▶ 라이브 예제**: [seokrae.github.io/flowcast](https://seokrae.github.io/flowcast/) — 3뷰(sequence·topology·component) 합성 예제 갤러리 (HTML 출력 + [PlantUML 출력](https://seokrae.github.io/flowcast/plantuml.html)).

## 범위 / 로드맵

| 영역 | 상태 |
|------|------|
| **생성** — 데이터/설명 → 흐름도 렌더 (3뷰) | ✅ |
| **변환(입력)** — `.pptx` 슬라이드 → draft 추출 (`scripts/pptx_import.py`, stdlib) | ✅ |
| **검증** — 원본 대조(qlmanage/pdftoppm) 루프 | ✅ |
| **출력** — 흐름도 → `.pptx` 네이티브(편집 가능) 도형 | ✅ sequence·component·topology |
| **출력** — 흐름도 → PlantUML `.puml` 텍스트 (stdlib) | ✅ sequence·component·topology |
| **편집·갱신** — 기존 산출물 수정·부분 재실행 (`/flowcast` 편집 경로, router 생략) | ✅ |
| **뷰 확장** — 4번째+ 뷰 | 🚧 계획 |

## 뷰 3종

| 뷰 | 언제 | 스킬 |
|----|------|------|
| **sequence** | 행위자 간 시간순 요청/응답 (스윔레인) | `flowcast:sequence` |
| **topology** | 인프라/존 공간 배치 + 번호 구간 오버레이 | `flowcast:topology` |
| **component** | 포트 달린 컴포넌트 박스 + 프로토콜 방향 엣지 | `flowcast:component` |

## 설치

```
/plugin marketplace add SeokRae/flowcast
/plugin install flowcast@flowcast
```

Python 3.9+ (표준 라이브러리만). 기본 출력은 HTML+MD다. 선택적 PDF 출력은 Chrome(headless), 선택적 PPT export는 python-pptx가 필요하다.

## 사용

**오케스트레이터 (권장)** — 데이터를 주면 알아서 쪼개고 병렬로 그린다:

```
/flowcast
{여러 다이어그램 분량의 데이터 또는 파일 경로}
pdf=false
export=false
plantuml=false
```

`pdf`·`export`·`plantuml`은 모두 기본 `false`다. 요청한 선택 출력의 의존성이 없으면(PDF=Chrome, PPT=python-pptx) HTML/MD는 유지되고 해당 단위는 `partial`로 보고된다. `plantuml`은 stdlib 텍스트 출력이라 추가 의존성이 없다.

**단일 뷰 직접 호출** — 뷰가 확실할 때:

```
flowcast:sequence   {한 다이어그램 데이터}
flowcast:topology   {한 다이어그램 데이터}
flowcast:component  {한 다이어그램 데이터}
```

직접 호출도 `pdf`·`export`·`plantuml` 기본값은 모두 `false`이며, 필요하면 `pdf=true`처럼 함께 준다. `out_dir`을 주지 않으면 `{cwd}/flowcast-out`의 절대경로가 기본이다. 각 뷰 스킬의 `SKILL.md`에 스키마 필수 필드(`system`)·소스 요건·선택 출력 절차가 있다.

**PPT 입력 변환** — `.pptx` 슬라이드에서 도형·라벨·좌표·커넥터를 draft JSON으로 추출 (drawer가 정제):

```bash
python3 scripts/pptx_import.py deck.pptx -o draft.json      # 슬라이드별 draft
python3 scripts/pptx_import.py deck.pptx --canvas 1200      # 슬라이드 폭 매핑 px
```

**PPT 출력** — sequence·component·topology 흐름도를 편집 가능한 네이티브 `.pptx`로 (python-pptx 필요, export 전용 선택적 의존성):

```bash
pip install python-pptx
python3 scripts/pptx_export.py examples/order-service-sequence.json -o seq.pptx
python3 scripts/pptx_export.py examples/microservice-component.json -o out.pptx
python3 scripts/pptx_export.py examples/three-tier-topology.json -o topo.pptx
```

**PlantUML 출력** — sequence·component·topology 흐름도를 PlantUML `.puml` 텍스트로 (stdlib, 추가 의존성 없음. Obsidian PlantUML 플러그인·기존 `.puml` 계보와 정합):

```bash
python3 scripts/plantuml_export.py examples/order-service-sequence.json -o seq.puml
python3 scripts/plantuml_export.py examples/three-tier-topology.json -o topo.puml   # dot(기본)
python3 scripts/plantuml_export.py examples/three-tier-topology.json --smetana      # graphviz 없는 환경
python3 scripts/plantuml_export.py examples/microservice-component.json --no-style   # vanilla
```

**렌더러 직접 실행**:

```bash
python3 scripts/render.py examples/order-service-sequence.json            # → .html
python3 scripts/render.py examples/order-service-sequence.json --pdf      # + PDF
python3 scripts/render.py {data.json} -o {out.html}
```

## 아키텍처

```
/flowcast (오케스트레이터)
   │
   ├─ diagram-router 에이전트
   │     데이터 → schema 1.0 manifest로 분할 + 뷰 판별 (그리지 않음)
   │
   ├─ 미결 단위 해소 → _workspace/units.json 저장 → validate_manifest.py
   │     manifest 전체가 exit 0이 되기 전에는 drawer dispatch 금지
   │
   └─ diagram-drawer 에이전트 × N  (run_in_background 병렬 팬아웃)
         각 인스턴스가 (검증된 데이터 1건, 뷰 1개, 소스/페어 메타데이터)
         → 해당 뷰 스킬 → 표준 JSON → HTML/MD → 선택적 PDF/PPT
```

drawer끼리는 통신하지 않는다(독립 팬아웃). N=1 단일 다이어그램도 같은 경로.

## 데이터 스키마

라우터와 오케스트레이터 사이의 manifest는 `schema_version: "1.0"`으로 고정된다:

```json
{
  "schema_version": "1.0",
  "out_dir": "/absolute/path/flowcast-out",
  "units": [
    {
      "unit_id": "unit-001",
      "system": "order-service",
      "source_ref": "docs/order-flow.md#payment",
      "name": "order-service-payment-sequence",
      "view": "sequence",
      "title": "주문 서비스 결제 FLOW",
      "data": {"source_text": "주문 결제 원문"},
      "ambiguous": false,
      "view_candidates": [],
      "notes": [],
      "pair_id": null,
      "segment_numbers": [1, 2]
    }
  ],
  "notes": []
}
```

`name`은 영문 소문자·숫자·하이픈만 쓰는 안전한 파일명이다. `view_candidates`는 `{ "view": "...", "reason": "..." }` 객체 배열이다. `notes`는 선택 필드이며 있으면 문자열 배열이다. `segment_numbers`는 중복 없는 정수/문자열 배열이고, sequence/topology 페어는 같은 안전한 `pair_id`와 동일한 비어 있지 않은 배열을 공유한다. 오케스트레이터는 `ambiguous: true`인 모든 단위를 사용자와 해소해 선택과 근거를 기록한 뒤 manifest를 `_workspace/units.json`으로 저장하고 `scripts/validate_manifest.py`를 실행한다. manifest 전체가 exit 0이 되기 전에는 drawer를 하나도 dispatch하지 않는다.

drawer 상태는 `ok` / `partial` / `render_error` / `needs_input`이다. 반환에는 `pdf`, `error`, `questions`가 항상 포함된다. PDF를 요청했지만 Chrome이 없거나 PPT export를 요청했지만 python-pptx가 없으면 `partial`이며 HTML/MD는 유효하다.

렌더 JSON은 `scripts/render.py` 상단 docstring이 스키마의 단일 진실이다. 각 뷰 스킬(`skills/{view}/SKILL.md`)에 필드·결정 지점·질의 대본이 있다. 예제: `examples/*.json` (합성).

## 개발

```bash
python3 -m venv .venv && source .venv/bin/activate   # Homebrew·Debian python은 PEP 668로 전역 설치를 막는다
python3 -m pip install -r requirements-dev.txt  # 개발 의존성 (pytest·python-pptx)
python3 -m pytest tests/          # 렌더러 검증·SVG/HTML 출력 테스트
bash scripts/scan-sensitive.sh    # 실 데이터 유입 차단 게이트
python3 scripts/validate_manifest.py {out_dir}/_workspace/units.json
```

CI는 Python 3.9·3.12 두 버전에서 테스트한다. 3.9는 지원 하한이자 macOS 시스템 `python3`이며, 이 잡은 python-pptx 없이 돌려 코어가 stdlib만으로 동작하는지 함께 확인한다(export 테스트는 `importorskip`으로 skip된다).

**정책 — 실 데이터 금지**: 이 repo는 public이다. 실제 파트너·내부 식별자(계정·거래/정산 ID 등)를 절대 커밋하지 않는다. 모든 예제는 합성이다. `scripts/scan-sensitive.sh`가 CI에서 매 push마다 검사하며, 한 건이라도 매치되면 빌드가 실패한다.

## 라이선스

MIT © SeokRae
