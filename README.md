# flowcast

> IF/서비스 흐름도 생성 하네스 — 데이터를 다이어그램 단위로 라우팅하고 drawer 서브에이전트를 **병렬 팬아웃**해 흐름도를 렌더링하는 Claude Code 플러그인.

flowcast는 JSON을 손으로 짜지 않게 한다. 데이터와 패턴 의도를 주면, 라우터가 다이어그램 단위로 쪼개고 뷰를 판별한 뒤, 여러 drawer가 각자 하나씩 렌더·파일링한다. 한 요청에서 **여러 다이어그램을 동시에** 뽑을 수 있다.

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

Python 3.9+ (표준 라이브러리만). PDF 출력은 Chrome(headless) 필요.

## 사용

**오케스트레이터 (권장)** — 데이터를 주면 알아서 쪼개고 병렬로 그린다:

```
/flowcast
{여러 다이어그램 분량의 데이터 또는 파일 경로}
```

**단일 뷰 직접 호출** — 뷰가 확실할 때:

```
flowcast:sequence   {한 다이어그램 데이터}
flowcast:topology   {한 다이어그램 데이터}
flowcast:component  {한 다이어그램 데이터}
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
   │     데이터 → 다이어그램 단위로 분할 + 뷰 판별 (그리지 않음)
   │
   └─ diagram-drawer 에이전트 × N  (run_in_background 병렬 팬아웃)
         각 인스턴스가 (데이터 1건, 뷰 1개) → 해당 뷰 스킬 로드
         → 표준 JSON → scripts/render.py 렌더 → 페어드 MD 파일링
```

drawer끼리는 통신하지 않는다(독립 팬아웃). N=1 단일 다이어그램도 같은 경로.

## 데이터 스키마

`scripts/render.py` 상단 docstring이 스키마의 단일 진실. 각 뷰 스킬(`skills/{view}/SKILL.md`)에 필드·결정 지점·질의 대본이 있다. 예제: `examples/*.json` (합성).

## 개발

```bash
python3 -m pytest tests/          # 렌더러 검증·SVG/HTML 출력 테스트
bash scripts/scan-sensitive.sh    # 실 데이터 유입 차단 게이트
```

**정책 — 실 데이터 금지**: 이 repo는 public이다. 실제 파트너·내부 식별자(계정·거래/정산 ID 등)를 절대 커밋하지 않는다. 모든 예제는 합성이다. `scripts/scan-sensitive.sh`가 CI에서 매 push마다 검사하며, 한 건이라도 매치되면 빌드가 실패한다.

## 라이선스

MIT © SeokRae
