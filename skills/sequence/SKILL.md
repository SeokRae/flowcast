---
name: sequence
description: 시퀀스(스윔레인) 흐름도 1건을 생성한다. 행위자 간 시간순 요청/응답 상호작용을 actors + scenarios[].steps JSON으로 옮겨 render.py로 렌더·파일링. diagram-drawer 에이전트가 view=sequence 단위를 받아 호출하거나, 사용자가 직접 시퀀스/스윔레인 다이어그램을 요청할 때 사용. 인프라 공간배치는 flowcast:topology, 포트 달린 컴포넌트 프로세스도는 flowcast:component 로 라우팅.
allowed-tools: Bash, Read, Write, Edit
---

# flowcast:sequence — 시퀀스 뷰 드로잉

> 한 다이어그램(스윔레인 시퀀스)을 표준 JSON으로 옮겨 플러그인의 `scripts/render.py`로 렌더·파일링한다.

행위자 간 **시간순 상호작용**(요청/응답)을 좌→우 레인의 시퀀스로 그린다. JSON을 손으로 짜지 않게, 데이터를 받아 결정 지점만 확인하고 JSON을 생성한다.

## 언제 이 스킬이 도는가

- `diagram-drawer` 에이전트가 `(데이터 1건, view=sequence)`를 받아 호출 — 팬아웃의 한 갈래
- 또는 사용자가 직접 단일 시퀀스 다이어그램을 요청

## 스키마 필드

- `actors[]`: `{ id, name, zone?, port?, line? }` — **배열 순서 = 좌→우 레인 순서**
- `zones[]`: `{ id, name }` — 상단 밴드. **존 소속 액터는 연속 배치 필수**(비연속이면 render 에러)
- `scenarios[].steps[]`: `{ n?, from, to, label, kind, sub?, protocol? }`
- `kind`: `req`(실선) · `res`(점선 응답) · `relay`(중계, 이탤릭) · `self`(자기호출) · `note`(설명 박스, label 필수)
- `label` 개행(`\n`) = 다단 라벨. 빈 label의 `res` = 무라벨 응답 화살표. `n` 중복은 warning(원문 보존 허용).

## 매핑 결정 지점 (데이터 → JSON, 순서대로)

1. **액터 목록과 좌→우 순서?** — 배열 순서가 화면 레인 순서가 된다.
2. **존(밴드) 있나?** 각 존 소속 액터는? → 소속 액터가 **연속**인지 확인(아니면 순서 조정).
3. 액터에 **port·line** 부가 라벨 있나?
4. **시나리오 몇 개**, 각 제목?
5. 각 **스텝**: `from`→`to`, 라벨, `kind`? (요청=req, 응답=res 점선, 중계=relay, 자기호출=self, 화살표 없는 설명=note)
   - 원본이 실선만 쓰면 방향 기준(하위 밴드=req / 상위 밴드=res)으로 res 부여.
6. 스텝 **번호(n)** 매기나? 라벨 **다단(`\n`)**·**protocol**·**sub** 부가라벨 있나?

**원문 보존**: 라벨·포트·프로토콜은 원문 그대로(오타 포함). 축약·병합 금지.

## JSON 작성

표준 스키마로 `{out_dir}/{name}.json`. 이름은 `{시스템}-{주제}` 케밥 케이스. `view` 미지정 시 sequence(기본).

## 렌더

플러그인 렌더러를 쓴다 — `${CLAUDE_PLUGIN_ROOT}`(플러그인 설치 루트 환경변수)가 있으면 그대로, 없으면 이 SKILL.md 기준 두 단계 상위가 플러그인 루트다:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/render.py" "{out_dir}/{name}.json" --pdf
```

검증 에러(exit 1)면 메시지대로 JSON 수정 후 재렌더. 번호 중복 등 warning은 원문 보존 시 허용.

## 파일링

페어드 MD `{out_dir}/{name}.md` — frontmatter(`type: diagram`, `html: {name}.html`) + iframe 임베드 + Step 테이블 + 흐름 서술.

- **기본(portable)**: iframe `src`는 **상대경로**(`{name}.html`).
- **vault 모드(옵션)**: 오케스트레이터가 `vault_iframe` 절대경로 옵션을 넘기면 `file://` 절대경로로 임베드.

## 원본 대조 검증 (원본 파일이 있을 때)

생성물을 원본과 육안 대조한다. 원본 슬라이드 → PNG(`qlmanage -t -s 1600`), 생성 JSON → `render.py --pdf` → `pdftoppm -png`, 두 PNG를 나란히 비교(노드·라벨·화살표 방향·번호). 불일치 → JSON 수정 후 반복.

## 예제

`examples/order-service-sequence.json` (합성) — 다중 시나리오 시퀀스.
