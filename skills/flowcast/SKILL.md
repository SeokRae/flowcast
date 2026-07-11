---
name: flowcast
description: IF/서비스 흐름도 생성 하네스의 진입점. 데이터(텍스트·PPTX/PDF·설명)를 받아 다이어그램 단위로 쪼개고 뷰를 판별한 뒤 drawer 서브에이전트를 병렬 팬아웃해 sequence·topology·component 흐름도를 렌더·파일링하고, 요청 시 편집가능 .pptx(B-out)로도 export 한다. "흐름도 만들어줘", "여러 다이어그램 한 번에", "시퀀스/구성도/컴포넌트 다이어그램", "IF 흐름도", "PPTX 흐름도 변환", "PPT로 뽑아줘", "편집가능 PPT/pptx로", "pptx export", "flowcast" 요청 시 사용. 후속 — "다시 그려줘", "이 다이어그램만 수정", "뷰 바꿔서", "예제 추가", "PPT로도 내보내줘"도 이 스킬. 단일 뷰만 확실하면 flowcast:sequence/topology/component 로 바로 갈 수도 있다.
allowed-tools: Agent, Bash, Read, Write, Edit, Skill
---

# flowcast — IF 흐름도 생성 하네스 (오케스트레이터)

> 데이터 한 덩어리를 받아 **여러 다이어그램을 병렬로** 뽑는다. 라우터가 단위로 쪼개고 뷰를 정하면, drawer 서브에이전트들이 각자 하나씩 렌더·파일링한다.

JSON을 사람이 손으로 짜지 않게 한다. 실행 모드는 **서브에이전트 팬아웃/팬인**(drawer끼리 통신 없음).

## 워크플로우

```
⓪ 컨텍스트 확인(초기/편집 판별) → ① 데이터 수신·소스 게이트·out_dir 결정 → ② diagram-router 1회
→ ③ 애매한 뷰·순서 확인 → ④ diagram-drawer 병렬 팬아웃 → ⑤ 결과 취합 → ⑥ 요약 보고
```

### ⓪ 컨텍스트 확인 — 초기 실행인가, 기존 산출물 편집인가
요청이 기존 다이어그램 수정("다시 그려줘"·"이 다이어그램만"·라벨/배치/뷰 변경)이고 대상 경로에 `{name}.json`이 있으면 **편집 경로**로 간다 — router를 다시 돌리지 않는다(원문 재분할은 낭비고, 단위 구성이 바뀌면 파일명·링크가 흔들린다):

- **데이터가 안 바뀌는 수정**(라벨·배치·옵션): 해당 `{name}.json`만 직접 수정 → 재렌더(해당 뷰 스킬 로드). 다른 단위 파일은 건드리지 않는다.
- **원문 데이터가 바뀌거나 여러 단위 수정**: `{out_dir}/_workspace/units.json`에서 해당 unit을 찾아 데이터를 갱신하고 그 unit만 ④로 재dispatch.
- 기존 `_workspace/`가 있는 out_dir에 **새 데이터로 새 실행**이면 `_workspace/`를 `_workspace_prev/`로 옮기고 초기 실행.

기존 산출물이 없으면 초기 실행(①부터).

### ① 데이터 수신 · 소스 게이트 · 출력 경로 결정
사용자가 준 원문(텍스트/파일 경로)을 파악한다. `source`가 `.pptx`면 라우터가 `scripts/pptx_import.py`로 슬라이드별 draft(도형·라벨·좌표·커넥터)를 추출해 쪼갠다.

**소스 게이트 (필수)**: 원문이 **확정 문서**(설계 문서·명세·확정 노트·PPT 원본)인지 확인한다. 대화·구두 설명·조각 지식이 원문이면 다이어그램을 바로 그리지 않는다 — 먼저 흐름 문서(E2E 서술: 단계별 업무 의미·경로·근거) 작성을 제안하고, 문서 확정 후 그 문서를 원문으로 재진입한다.

지식 계층은 아래 순서로 쌓는다 — 상위가 없으면 상위부터:

```
개념·사실 노트 (컴포넌트 정의·설정값·명세 — 원자적)
  → 흐름 문서 (개념 노트를 인용해 단계별 서술 — 종합)
    → 다이어그램 (sequence=비즈니스 / topology=인프라, JSON source 계보 필수)
      → PPT (B-out export)
```

다이어그램은 문서에서 파생되며 JSON `source` 필드에 계보(원문 문서 경로)를 기록한다. 근거 문서 없는 다이어그램은 검토·수정 때 사실 확인이 불가능해진다. 예외: 일회성 탐색 스케치는 라이트 경로(바로 드로잉)를 허용하되, 공유·검토 대상으로 승격되면 문서를 소급 작성한다. **출력 디렉토리(`out_dir`)**를 정한다 — 사용자가 지정하지 않으면 현재 작업 디렉토리 하위 `flowcast-out/`를 기본으로 하고 한 줄로 알린다. Obsidian vault 등에서 iframe을 절대경로로 임베드하려면 `vault_iframe`(대상 절대경로 프리픽스)을 옵션으로 받는다. 사용자가 "편집가능 PPT/pptx로"·"PPT로 뽑아줘"·"export" 등 **편집가능 .pptx(B-out)**를 원하면 `export=true`로 잡아 drawer에 전달한다(기본 `false` — HTML/PDF만). B-in(`.pptx` 입력, 라우터에서 draft 추출)과 B-out(`.pptx` 출력, drawer에서 export)은 방향이 반대다 — 혼동하지 않는다.

### ② 라우팅 — diagram-router 1회 호출
`diagram-router` 에이전트(`model: opus`)를 호출해 `{ source, hint, out_dir }`를 넘기고 `units[]`를 받는다. 라우터는 원본을 다이어그램 단위로 쪼개고 각 단위의 뷰를 판별한다(그리지 않음). 받은 `units[]`는 `{out_dir}/_workspace/units.json`으로 저장한다 — ⓪ 편집 경로의 부분 재실행과 감사 추적의 기준 파일.

### ③ 애매한 뷰·순서 확인
`units[]`에 `ambiguous: true`가 있으면 그 단위의 `view_candidates`(후보+근거) 또는 **구간 번호 순서 의심 사유**(`notes`)를 사용자에게 제시하고 확정받는다. 단독 확정 금지. 나머지 단위는 그대로 진행 가능.

### ④ 팬아웃 — diagram-drawer 병렬 dispatch
`units[]`의 각 원소마다 `diagram-drawer` 서브에이전트(`model: opus`)를 **병렬로** 띄운다(한 메시지에 여러 Agent 호출, `run_in_background`). 각 drawer 입력:

```json
{ "name": "...", "view": "...", "title": "...", "data": "...",
  "out_dir": "<①에서 정한 경로>", "vault_iframe": <null 또는 절대경로 프리픽스>,
  "export": <①에서 판단한 true/false> }
```

drawer는 배정된 뷰 스킬(`flowcast:sequence/topology/component`)만 로드해 JSON→render→파일링(→`export`면 `.pptx`도)하고 결과 객체를 반환한다. **N=1이어도 같은 경로**(팬아웃 1건).

### ⑤ 결과 취합
모든 drawer 반환을 모은다. `status`별로 분류: `ok` / `render_error` / `needs_input`.

### ⑥ 요약 보고
생성된 파일(json/html/md, `export`면 pptx) 목록, 각 단위의 `warnings`(번호 중복 등 원문 보존, python-pptx 미설치로 export 생략 등), 실패 단위와 사유를 표로 보고한다. 실패가 있어도 성공 단위는 그대로 남긴다.

## 옵션

| 옵션 | 의미 | 기본 |
|------|------|------|
| `out_dir` | 파일링 대상 디렉토리 | `./flowcast-out/` |
| `hint` | 라우터에 넘길 분할/뷰 힌트(예: "슬라이드마다 1장", "전부 sequence") | 없음 |
| `vault_iframe` | 페어드 MD iframe을 `file://` 절대경로로(vault 임베드) | 없음(상대경로) |
| `export` | render 후 편집가능 `.pptx`(B-out)도 생성 | `false` |

## 에러 핸들링

- 라우터가 빈 `units`를 주면 → 데이터 부족. 원문을 다시 요청하고 추정으로 진행하지 않는다.
- drawer 하나가 `render_error`/`needs_input`이면 → 해당 단위만 보고에 실패로 남기고 **나머지는 계속**. 재시도는 drawer 내부의 JSON 수정 1회로 끝난다 — 오케스트레이터는 같은 입력으로 재dispatch하지 않는다(같은 실패만 반복된다). 실패 사유는 원문 그대로 보고.
- 상충/애매는 삭제·임의결정하지 않고 사용자 확인으로 넘긴다.

## 커밋

파일 작성·렌더까지가 이 스킬의 범위. 커밋·PR은 표준 워크플로우를 따른다.

## 테스트 시나리오

- **정상(다중)**: 3개 다이어그램 분량 데이터 → router가 units 3개 → drawer 3개 병렬 → html/md 3쌍 생성, 요약에 3건 ok.
- **정상(단일)**: sequence 1건 → units 1개 → drawer 1개 → 1쌍 생성.
- **export**: "PPT로도 뽑아줘" → `export=true` → 각 drawer가 render 후 `pptx_export.py` → html/md/pptx 3종, 요약에 pptx 경로 포함.
- **export(의존성 없음)**: python-pptx 미설치 환경에서 `export=true` → html/md는 생성, pptx는 생략(경고), unit status는 ok 유지.
- **편집(후속)**: 기존 out_dir에 3쌍 산출물이 있는 상태에서 "두 번째 다이어그램 라벨만 수정" → router 생략(⓪), 해당 JSON Edit → 재렌더 1건, 나머지 파일 불변.
- **에러**: 한 단위 데이터에 미정의 actor 참조 → 그 단위만 render_error, 나머지 ok로 보고.
