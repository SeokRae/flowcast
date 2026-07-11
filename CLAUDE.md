# flowcast

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> IF/서비스 흐름도 작업 하네스 — Claude Code 플러그인. 데이터·.pptx를 다이어그램 단위로 라우팅하고 drawer 서브에이전트를 병렬 팬아웃해 sequence·topology·component 뷰를 렌더링. (생성·PPT입력·PPT출력(3뷰) 구현 / 편집·뷰확장 계획)

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
python3 scripts/render.py {json} [--pdf]
```

## 규칙 (필수)

- **실 데이터 절대 금지** (public repo): 파트너·내부 식별자를 커밋하지 않는다. 예제는 전량 합성. 커밋·push 전 `scripts/scan-sensitive.sh`가 0건인지 확인 (CI도 매 push 검사).
- **원문 보존**: 실제 다이어그램을 옮길 때 라벨·포트·프로토콜을 원문 그대로 — 단, 그 산출물은 이 public repo가 아니라 사용자 로컬 `out_dir`에 파일링한다.
- **의존성 격리**: 코어(render/import/생성)는 **stdlib만**. python-pptx는 **PPT export 전용 선택적** 의존성 — `pptx_export.py`에서만 lazy import, 미설치 시 안내 후 종료. 새 기능에 의존성을 더할 땐 이 격리 원칙을 지킨다.
- **새 뷰 추가**: ① `scripts/render.py`에 `render_svg_{view}`·`validate_{view}` + 디스패치, ② `skills/{view}/SKILL.md` 질의 대본, ③ router 라우팅 표 한 행, ④ 합성 예제 + 테스트.

## 라이선스

MIT © SeokRae
