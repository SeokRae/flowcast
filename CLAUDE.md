# flowcast

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> IF/서비스 흐름도 작업 하네스 — Claude Code 플러그인. 데이터·.pptx를 다이어그램 단위로 라우팅하고 drawer 서브에이전트를 병렬 팬아웃해 sequence·topology·component 뷰를 렌더링하며, 요청 시 편집가능 `.pptx`(B-out)로도 export. (생성·PPT입력(B-in)·PPT출력(B-out, 3뷰)·편집 경로 배선 완료 / 뷰확장 계획)

## 구조

| 경로 | 역할 |
|------|------|
| `skills/flowcast/` | `/flowcast` 오케스트레이터 — router 호출 → drawer 병렬 팬아웃 → 취합 |
| `skills/{sequence,topology,component}/` | 뷰별 드로잉 스킬 (`flowcast:{view}`) — 스키마·질의 대본·렌더·파일링 |
| `agents/diagram-router.md` | 데이터 → 다이어그램 단위 분할 + 뷰 판별 (그리지 않음) |
| `agents/diagram-drawer.md` | 단위 1건 → 뷰 스킬 로드 → JSON → render → 파일링 |
| `scripts/render.py` | JSON → self-contained HTML/PDF 렌더러 (스키마 단일 진실 = 상단 docstring) |
| `scripts/pptx_import.py` | `.pptx` → 슬라이드별 draft JSON (도형·라벨·좌표·커넥터, stdlib) — B-in 입력 변환 |
| `scripts/pptx_export.py` | sequence·component·topology JSON → 편집가능 `.pptx` (python-pptx **선택적** 의존성, render.py 좌표·`layout_sequence` 재사용) — B-out 출력 |
| `scripts/scan-sensitive.sh` | 실 데이터 유입 차단 게이트 |
| `examples/*.json` | 합성 예제 (실 데이터 없음) |
| `tests/test_render.py` | 렌더러 검증·출력 테스트 |

## 명령어

```bash
python3 -m pytest tests/          # 테스트
bash scripts/scan-sensitive.sh    # 실 데이터 스캔 게이트
python3 scripts/render.py {json} [--pdf]       # 생성 → HTML/PDF
python3 scripts/pptx_export.py {json} -o out.pptx  # B-out → 편집가능 .pptx (python-pptx 필요)
```

## 규칙 (필수)

- **실 데이터 절대 금지** (public repo): 파트너·내부 식별자를 커밋하지 않는다. 예제는 전량 합성. 커밋·push 전 `scripts/scan-sensitive.sh`가 0건인지 확인 (CI도 매 push 검사).
- **원문 보존**: 실제 다이어그램을 옮길 때 라벨·포트·프로토콜을 원문 그대로 — 단, 그 산출물은 이 public repo가 아니라 사용자 로컬 `out_dir`에 파일링한다.
- **의존성 격리**: 코어(render/import/생성)는 **stdlib만**. python-pptx는 **PPT export 전용 선택적** 의존성 — `pptx_export.py`에서만 lazy import, 미설치 시 안내 후 종료. 새 기능에 의존성을 더할 땐 이 격리 원칙을 지킨다.
- **새 뷰 추가**: ① `scripts/render.py`에 `render_svg_{view}`·`validate_{view}` + 디스패치, ② `skills/{view}/SKILL.md` 질의 대본, ③ router 라우팅 표 한 행, ④ 합성 예제 + 테스트.

## 릴리즈

버전은 3곳을 함께 올린다: `.claude-plugin/plugin.json`의 `version` · `.claude-plugin/marketplace.json`의 `metadata.version` · 같은 파일의 `plugins[0].version`. 로컬 반영: `~/.claude/plugins/marketplaces/flowcast` git pull → `claude plugin update flowcast` → 세션 재시작.

## 하네스 변경 이력

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

## 라이선스

MIT © SeokRae
