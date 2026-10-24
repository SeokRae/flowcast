# vendor/anatomy

`flowcast:mechanism`이 기계 그림을 그릴 때 쓰는 아이소메트릭 렌더 kit와 검증 스크립트, 작법 문서다. 외부 Agent Skill anatomy에서 2D SVG 범위만 원문 그대로 가져왔다. 이 폴더만으로 동작하므로 anatomy를 따로 설치할 필요가 없다.

| 항목 | 값 |
|---|---|
| 출처 | https://github.com/wheresryan22/anatomy |
| 버전 | v1.1.0 (커밋 `be2fa9b47a7e4b05dec468be9ffc42e830c2101c`, 2026-10-12) |
| 라이선스 | MIT, Copyright (c) 2026 Ryan. 원문은 `LICENSE` |
| 가져온 날 | 2026-10-24 (flowcast #135) |

## 포함

| 경로 | 역할 |
|---|---|
| `kit/iso-kit.mjs` | 카메라, 솔리드, 부품 라이브러리, SVG 문자열 렌더러, 카드와 페이지 빌더, `ISO_CSS` |
| `kit/lathe.mjs` | 임의 축의 회전체(플랜지, 밸브, 구), 곡면 리브와 볼트 원 |
| `kit/tube.mjs` | 파이프와 케이블을 깊이 정렬 가능한 조각으로 |
| `kit/audit.mjs` | 기하 감사(간섭, 끝점, 지지, 깊이 순서). `build.mjs --audit` 훅 |
| `scripts/inline-kit.mjs` | kit 소스를 페이지에 인라인할 문자열로 (`kitScript()`만 쓴다) |
| `scripts/capture.mjs` | 헤드리스 Chrome 스크린샷, 확대, 콘솔 검사 |
| `scripts/drive.mjs` | 스크립트로 조작하는 헤드리스 Chrome (`eval`, 연속 촬영, 라인 검사) |
| `scripts/lines.mjs`, `scripts/line-ends.mjs` | 선 끝이 모두 무언가에 닿는지 검사 |
| `scripts/chrome-port.mjs` | Chrome DevTools 포트 대기 |
| `references/craft.md`, `kit.md`, `motion.md`, `verify.md`, `walkthrough.md` | 작법, API, 모션, 검증, 설계 과정 예시 |
| `examples/dial-indicator/build.mjs` | 가장 작은 Figure 예제 (약 275줄) |
| `examples/desk-computer/build.mjs` | 기계 표시창에 글자를 그리는 예제 |
| `UPSTREAM-SKILL.md` | 원본 `SKILL.md`. 이름만 바꿨다(중첩 스킬로 등록되지 않게) |

## 제외 (이 저장소에서 쓸 수 없음)

- WebGL 셰이더: `kit/gl.mjs`, `kit/gl-shared.mjs`, `references/webgl.md`
- 3D 모드(beta): `kit/turn*.mjs`, `kit/canvas-painter.mjs`, `references/3d.md`, `scripts/turn-*.mjs`
- React: `kit/react/`, `kit/iso-kit.ts`, `kit/iso.css`, `references/react.md`
- 커뮤니티 갤러리 게시: `scripts/publish.mjs`, `references/publish.md`
- 나머지 예제(빌드 결과 HTML과 이미지 포함 약 27MB), `tests/`, `evals/`, `agents/`

`UPSTREAM-SKILL.md`와 `references/`의 문서는 위 제외 항목과 빠진 예제를 가리키는 곳이 있다. 그 안내는 이 저장소에서 따를 수 없다. `inline-kit.mjs`의 `glScript()`, `turnScript()`, `fixedScript()`, `glSharedScript()`는 제외한 파일을 읽으므로 호출하면 실패한다.

## 규칙

1. **원문을 고치지 않는다.** 동작을 바꿔야 하면 `skills/mechanism/` 쪽 빌드 코드에서 감싼다. 원문과 다르면 다음 업데이트 때 차이를 추적할 수 없다.
2. **업데이트는 통째로 한다.** 새 태그를 받아 위 "포함" 목록을 같은 경로로 다시 복사하고, 이 파일의 버전과 커밋을 고친 뒤 아래를 모두 통과시킨다.

```bash
bash scripts/scan-sensitive.sh
node skills/mechanism/examples/jvm-bytecode/check.mjs
node skills/mechanism/examples/jvm-bytecode/build.mjs && node skills/mechanism/examples/jvm-bytecode/build.mjs --light
# 이어서 skills/mechanism/SKILL.md ⑥ 검사 전부
```

3. **빌드 결과 HTML은 kit 소스를 인라인한다.** 배포하는 HTML에는 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->` 주석을 남긴다.
