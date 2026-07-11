---
name: flowcast
description: IF/서비스 흐름도 생성 하네스의 진입점. 데이터(텍스트·PPTX/PDF·설명)를 받아 다이어그램 단위로 쪼개고 뷰를 판별한 뒤 drawer 서브에이전트를 병렬 팬아웃해 sequence·topology·component 흐름도를 렌더·파일링한다. "흐름도 만들어줘", "여러 다이어그램 한 번에", "시퀀스/구성도/컴포넌트 다이어그램", "IF 흐름도", "PPTX 흐름도 변환", "flowcast" 요청 시 사용. 후속 — "다시 그려줘", "이 다이어그램만 수정", "뷰 바꿔서", "예제 추가"도 이 스킬. 단일 뷰만 확실하면 flowcast:sequence/topology/component 로 바로 갈 수도 있다.
allowed-tools: Agent, Bash, Read, Write, Edit, Skill
---

# flowcast — IF 흐름도 생성 하네스 (오케스트레이터)

> 데이터 한 덩어리를 받아 **여러 다이어그램을 병렬로** 뽑는다. 라우터가 단위로 쪼개고 뷰를 정하면, drawer 서브에이전트들이 각자 하나씩 렌더·파일링한다.

JSON을 사람이 손으로 짜지 않게 한다. 실행 모드는 **서브에이전트 팬아웃/팬인**(drawer끼리 통신 없음).

## 워크플로우

```
① 데이터 수신·out_dir 결정 → ② diagram-router 1회 → ③ 애매한 뷰 확인
→ ④ diagram-drawer 병렬 팬아웃 → ⑤ 결과 취합 → ⑥ 요약 보고
```

### ① 데이터 수신 · 출력 경로 결정
사용자가 준 원문(텍스트/파일 경로)을 파악한다. **출력 디렉토리(`out_dir`)**를 정한다 — 사용자가 지정하지 않으면 현재 작업 디렉토리 하위 `flowcast-out/`를 기본으로 하고 한 줄로 알린다. Obsidian vault 등에서 iframe을 절대경로로 임베드하려면 `vault_iframe`(대상 절대경로 프리픽스)을 옵션으로 받는다.

### ② 라우팅 — diagram-router 1회 호출
`diagram-router` 에이전트(`model: opus`)를 호출해 `{ source, hint }`를 넘기고 `units[]`를 받는다. 라우터는 원본을 다이어그램 단위로 쪼개고 각 단위의 뷰를 판별한다(그리지 않음).

### ③ 애매한 뷰 확인
`units[]`에 `ambiguous: true`가 있으면 그 단위의 `view_candidates`(후보+근거)를 사용자에게 제시하고 뷰를 확정받는다. 단독 확정 금지. 나머지 단위는 그대로 진행 가능.

### ④ 팬아웃 — diagram-drawer 병렬 dispatch
`units[]`의 각 원소마다 `diagram-drawer` 서브에이전트(`model: opus`)를 **병렬로** 띄운다(한 메시지에 여러 Agent 호출, `run_in_background`). 각 drawer 입력:

```json
{ "name": "...", "view": "...", "title": "...", "data": "...",
  "out_dir": "<①에서 정한 경로>", "vault_iframe": <null 또는 절대경로 프리픽스> }
```

drawer는 배정된 뷰 스킬(`flowcast:sequence/topology/component`)만 로드해 JSON→render→파일링하고 결과 객체를 반환한다. **N=1이어도 같은 경로**(팬아웃 1건).

### ⑤ 결과 취합
모든 drawer 반환을 모은다. `status`별로 분류: `ok` / `render_error` / `needs_input`.

### ⑥ 요약 보고
생성된 파일(json/html/md) 목록, 각 단위의 `warnings`(번호 중복 등 원문 보존), 실패 단위와 사유를 표로 보고한다. 실패가 있어도 성공 단위는 그대로 남긴다.

## 옵션

| 옵션 | 의미 | 기본 |
|------|------|------|
| `out_dir` | 파일링 대상 디렉토리 | `./flowcast-out/` |
| `vault_iframe` | 페어드 MD iframe을 `file://` 절대경로로(vault 임베드) | 없음(상대경로) |

## 에러 핸들링

- 라우터가 빈 `units`를 주면 → 데이터 부족. 원문을 다시 요청하고 추정으로 진행하지 않는다.
- drawer 하나가 `render_error`/`needs_input`이면 → 해당 단위만 보고에 실패로 남기고 **나머지는 계속**. 1회 재시도 후에도 실패면 사유 원문을 보고.
- 상충/애매는 삭제·임의결정하지 않고 사용자 확인으로 넘긴다.

## 커밋

파일 작성·렌더까지가 이 스킬의 범위. 커밋·PR은 표준 워크플로우를 따른다.

## 테스트 시나리오

- **정상(다중)**: 3개 다이어그램 분량 데이터 → router가 units 3개 → drawer 3개 병렬 → html/md 3쌍 생성, 요약에 3건 ok.
- **정상(단일)**: sequence 1건 → units 1개 → drawer 1개 → 1쌍 생성.
- **에러**: 한 단위 데이터에 미정의 actor 참조 → 그 단위만 render_error, 나머지 ok로 보고.
