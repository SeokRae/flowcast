# 브리프 템플릿

`{out_dir}/{name}/brief.md`로 채워 anatomy에 넘긴다. anatomy가 받는 입력은 이 파일 하나다. 빈 칸이 남으면 넘기지 않는다.

```markdown
# {그림 제목}

## 대상

- 메커니즘: {하나만}
- 버전과 구현: {예: Linux 6.8 x86-64, OpenJDK 21.0.1 HotSpot, javac 21.0.1}
- 크기: {Figure | Hero} ({부품 수 범위})

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| {상수나 규칙} | {실행 출력, 소스 경로, 명세 절} | `truth/{파일}` |

모델: `model.mjs` (`node check.mjs` 통과). 그림의 숫자는 모두 이 모듈에서 읽는다.

## 기계 매핑

한 문장: {무엇이 움직이면 무엇을 뜻한다}

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| {움직이는 부품} | {개념 하나} | `state.{필드}` |

움직이는 부품은 전부 이 표에 있어야 한다. 표에 없는 부품은 정지한 구조물(베이스, 프레임, 나사)이다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 예: `{readout 예시}`
- 키보드: {예: → 또는 Space = step 1회, Home = reset}
- 포인터: {예: hover로 다음 STEP 미리보기, click = step 1회}
- idle tour: {예: trace 전체를 돌고 1.4초 쉰 뒤 reset}
- 검증 훅: `window.mechanism = { reset(), step(), readout() }`

## 캡션

{대상 버전과 출처를 밝히는 문장}. {생략 범위: 실제로 일어나지만 그리지 않은 것 전부}.

## 고정 제약

1. anatomy 워크플로 1~10을 따른다. 2단계 Truth는 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 이유와 대안을 들고 돌아온다.
2. kit는 anatomy 설치 경로에서 동적 import한다(`ANATOMY_DIR` 환경 변수, 기본 `~/.claude/skills/anatomy`). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다.
4. 출력 HTML은 self-contained다. 첫 줄 근처에 `<!-- anatomy kit {버전}, MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. 커뮤니티 갤러리 게시(`references/publish.md`)는 실행하지 않는다.
6. 산출물: `build.mjs`(필요하면 부품 모듈), `{name}.html`, `{name}-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
```
