# 변경 이력

flowcast 하네스의 변경 이력이다. `CLAUDE.md`에서 원문 그대로 이관했다(#98) — 규칙과 이력이 한 파일에서 경쟁하면 규칙의 신호 대 잡음비가 떨어진다.

지금도 코드를 구속하는 결정은 `CLAUDE.md`의 **설계 결정** 절에 남겨 두었다. 여기는 "언제 왜 바뀌었나"의 기록이다.

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-11 | 초기 구축 — router/drawer 팬아웃 + 3뷰 + render.py 이관 + 합성 예제 | 전체 | - |
| 2026-07-11 | B-in PPT 입력 변환 + 하네스 범위 재정의 | `scripts/pptx_import.py`·router | .pptx 덱을 draft로 추출해 라우팅 (#1) |
| 2026-07-11 | B-out PPT export 1·2차 (component·topology) | `scripts/pptx_export.py` | 편집가능 .pptx 출력 (#3·#5) |
| 2026-07-11 | B-out PPT export 3뷰 완성 (sequence 추가) | `scripts/pptx_export.py`·`render.py` | component·topology·sequence export 대칭 완성 (#8) |
| 2026-07-11 | B-out export를 하네스에 배선 | `agents/diagram-drawer`·`skills/flowcast` | export가 raw 스크립트로만 도달되던 drift 해소 — `/flowcast`에서 `export` 옵션으로 노출 (#9) |
| 2026-07-11 | B-in 파서 그룹 좌표 보정 + `connectors_loose[]` | `scripts/pptx_import.py` | 그룹 덱 좌표 왜곡·glue 없는 커넥터 탈락 해소 (#11) |
| 2026-07-11 | 편집 경로(⓪ 컨텍스트 확인)·`_workspace` 배선·문서 위생 | `skills/*`·`agents/*`·CLAUDE.md | 하네스 감사 후속 — 후속 요청 절차 부재·draft 경로 충돌 해소 (#12) |
| 2026-07-11 | B-out 품질 개선 — 멀티라인 전 문단 스타일·topology 배지+범례·wide(1920×1080) 캔버스 기본값 | `scripts/pptx_export.py` | 실사용에서 둘째 줄 18pt 누수·라벨 겹침·비표준 슬라이드 비율 확인 (#17) |
| 2026-07-11 | topology 번호 배지 겹침 자동 회피 — `_t_badge_geom`/`_t_spread_badges` 공용화(HTML·pptx 단일 진실) | `scripts/render.py`·`scripts/pptx_export.py` | 교차 엣지 배지 완전 중첩(구간 3×8) 실사용 확인 (#19) |
| 2026-07-11 | 배지 spread 부호를 분리 벡터 내적 기반으로 — 역평행(왕복 A→B/B→A) 퇴행 수정 + 무개선 시 부호 반전 폴백 | `scripts/render.py` | 왕복 구간(12×13) 배지가 같은 방향으로 밀려 겹침 유지되던 실사용 퇴행 (#21) |
| 2026-07-11 | 워크플로우 게이트 4종 — 소스 게이트(지식 계층: 개념 노트→흐름 문서→다이어그램→PPT)·2축 페어링(sequence+topology 번호 공유)·순서 검증(업무 트리거=n1)·속성 근거 규칙 | `skills/flowcast`·`agents/diagram-router`·`skills/{sequence,topology}` | 실사용 검토에서 업무 순서 어긋남·근거 없는 속성(async 등)·계보 부재 확인 (#23) |
| 2026-07-11 | pptx z-순서 패리티 — topology·component 드로잉 순서를 존→커넥터→노드(→배지·라벨) 로 (HTML과 동일, 노드가 관통 선을 가림) | `scripts/pptx_export.py` | 같은 행 관통 릴레이(VIP→WEB)가 pptx에서만 노드 위로 노출 (#25) |
| 2026-07-11 | 소스 게이트 세분화 — 지식 계층에 **시나리오 노트**(업무별: 트리거·전제·정상 흐름·분기·예외) 추가, sequence 소스 요건·분기/예외 복수 슬라이드 규칙 | `skills/flowcast`·`skills/sequence`·`agents/diagram-router` | 시나리오 노트 없이 분석 노트→시퀀스 직행 시 분기·예외 소실 (실사용, #27) |
| 2026-07-13 | runtime contract 안정화 — manifest schema 1.0 검증 게이트·소스/페어 메타데이터·선택 PDF·partial 상태 | `skills/*`·`agents/*`·plugin manifest | fan-out 전 입력 계약과 선택 출력 실패 의미를 고정 (#39) |
| 2026-07-14 | B-out PlantUML export — 3뷰 JSON → `.puml`(stdlib·좌표 미사용·검증기 재사용, flowcast 팔레트 skinparam+smetana) + `plantuml` 옵션 배선 | `scripts/plantuml_export.py`·`agents/diagram-drawer`·`skills/flowcast` | PlantUML 계보 다이어그램과 정합·Obsidian 네이티브 렌더 지원 (#53) |
| 2026-07-17 | **rectangle 뷰 레이아웃 기본값을 dot 으로 전환**(동작 변경) — `!pragma layout smetana` 강제 해제하고 `--smetana` opt-in 으로. pragma/skinparam 직교화(`RECT_PRAGMA` 분리) | `scripts/plantuml_export.py`·`agents/diagram-drawer` | smetana 가 캔버스를 클리핑 — 자체 예제 `three-tier` 마저 "5. 캐시 갱신"→"5. 캐시" 절단(243×541 vs dot 271×664). 강제 근거였던 "Obsidian=graphviz-free" 전제도 오류(플러그인 `dotPath` 절대경로면 dot 사용) (#55) |
| 2026-07-17 | topology `.puml` 라벨 겹침 해소 — 엣지엔 번호만, 설명은 `legend` 표로(render.py 배지+범례 패턴 패리티). 세그먼트가 덮는 pair 의 정적 링크 생략 | `scripts/plantuml_export.py` | 한 pair 에 링크 1+세그먼트 N 이 걸리면 PlantUML 이 라벨을 같은 지점에 스택 → 노드명까지 가림(dot·smetana 공통). 실사용에서 `.puml` 수기 유지를 강요한 원인 (#57) |
| 2026-07-18 | GitHub Pages 예제 갤러리 — `docs/index.html`(3뷰 합성 예제 카드·라이브 iframe 프리뷰·다크/라이트 테마 공유) + `docs/examples/*.html` 게시용 복사본 | `docs/`·README·CLAUDE.md | 자체완결 예제 HTML을 라이브로 보여줄 진입점 부재 — Pages `main /docs` 정적 게시 (#59) |
| 2026-07-18 | plantuml_export 별칭 정규화 — `_alias()`로 노드 id 의 하이픈·점·공백 등을 `_` 로 치환, 선언·화살표·note·링크·세그먼트·엣지 전 방출 지점에 일관 적용 | `scripts/plantuml_export.py` | 하이픈 든 id(`fw-edge`)가 PlantUML 화살표(`client --> fw-edge`) 파싱을 깨뜨려 `firewall-boundary` flow 다이어그램 렌더 실패 — 표시명은 원문 보존 (#61) |
| 2026-07-18 | Pages 갤러리에 PlantUML showcase 추가 — `docs/plantuml.html`(예제별 렌더 SVG·`.puml` 소스 링크·index 상호 내비) + `docs/examples/puml/*.{puml,svg}` 스냅샷 | `docs/`·README·CLAUDE.md | HTML 출력만 있던 갤러리에 B-out PlantUML export 결과를 함께 노출 (#63) |
| 2026-07-19 | `scan-sensitive` 블록리스트의 짧은 파트너 코드 토큰을 단어경계(`\b…\b`)로 고정 — PlantUML 자동 링크 id `lnk7`의 부분문자열 오탐 해소(링크 7개 이상 SVG면 재발하던 게이트 버그) | `scripts/scan-sensitive.sh` | #63 SVG가 게이트에 걸려 push 차단 (#64) |
| 2026-07-19 | Pages `index.html`을 갤러리→'이해' 페이지로 보강 — 동작 파이프라인 4단계·세 관점(질문 프레이밍)·블로그(flowcast 1편) 링크. 기존 디자인 토큰·테마 재사용, AA 유지 | `docs/index.html` | 갤러리만 있고 flowcast 동작·관점 설명이 없어 'flowcast를 이해하는' 목적에 미달 (#67) |
| 2026-07-20 | 예제 산출물 재생성(`regen-examples.sh`) + 골든 회귀 게이트 — 렌더 결과·docs 게시본·`.puml` 3축을 바이트 비교 | `scripts/regen-examples.sh`·`tests/test_render.py`·`tests/test_plantuml_export.py` | 커밋된 예제 HTML이 초기 구축 이후 재생성되지 않아 #57 구간 범례 표가 빠진 렌더를 Pages가 게시 중이었고, 이를 잡는 게이트가 없었음 (#69) |
| 2026-07-20 | 하네스 감사 Tier 1 일괄 — out_dir 절대경로·실행 산출물 gitignore(#70) · pptx_export 검증 게이트(#71) · plantuml 별칭 충돌 회피(#72) · pptx topology/component 패리티(fw·l4·rail·self·평행엣지, #73) · CLAUDE_PLUGIN_ROOT 폴백 실행가능화(#74) · scan-sensitive 회귀 테스트(#75) · keywords 교차 검증(#77) | `scripts/*`·`skills/*`·`agents/*`·`tests/*`·`.claude-plugin/*` | 다중 에이전트 하네스 감사(72건 발견)의 Tier 1 해소. 부수 발견 2건도 함께 수정 — HTML 역평행 엣지 겹침(#21 계열)과 `-nometadata` 없는 SVG 재생성이 게이트를 무작위로 막던 문제 |
| 2026-07-20 | `requirements-dev.txt` 선언 + CI 매트릭스 3.9·3.12 — 3.9 잡은 pytest 단독 설치(코어 stdlib 검증)에 `compileall`+import 스모크, 3.12 잡이 전체 게이트 | `requirements-dev.txt`·`.github/workflows/ci.yml`·README·CLAUDE.md | 개발 의존성 선언 파일이 전무해 클린 체크아웃에서 문서화된 `pytest`가 즉시 실패했고, "Python 3.9+ (stdlib만)" 주장이 CI 3.12 단일이라 미검증이었다 (#96) |
