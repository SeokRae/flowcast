# Plain technical English (1단계 글, 영어)

ASD-STE100(Simplified Technical English) Issue 9의 규칙 범주를 따른다. 공식 사전(승인 단어 약 900개)은 ASD가 재배포를 막아서 담지 않았다. 이 파일은 원칙만 쓴다: 가장 흔하고 쉬운 단어를 고르고, 같은 뜻에는 늘 같은 단어를 쓴다. 실제 항공 정비 문서처럼 STE 준수가 필요하면 공식 규격을 받아 단어마다 대조한다(https://www.asd-ste100.org).

Karpathy가 쓴 방식은 "80% of the way to ASD-STE100"이다. 기본 강도가 이것이다.

## 강도

| 강도 | 언제 | 적용 |
|---|---|---|
| 80% (기본) | explanations, READMEs, PR text, narration | 구조 규칙 전부, 어휘 규칙은 권고 |
| strict | procedures, warnings, error messages, tool descriptions | 구조 규칙과 어휘 규칙 전부 |

## 구조 규칙 (항상)

1. **Sentence length.** Procedural sentences: 20 words max. Descriptive sentences: 25 words max.
2. **One instruction per sentence.** Only simultaneous actions share a sentence.
3. **Paragraphs.** One topic, 6 sentences max.
4. **Active voice.** Name the actor. Passive is allowed only in descriptive text when the actor is unknown or irrelevant.
5. **Simple tenses.** Simple present, simple past, simple future, imperative. No progressive or perfect forms.
6. **Noun clusters.** 3 nouns max. Break longer clusters with prepositions.
7. **No phrasal verbs.** "set up" → "install", "carry out" → "do".
8. **Do not drop articles and small words** ("the", "a", "this").
9. **Condition first.** "If the valve is open, close it."
10. **Warnings: instruction first, then the risk.** "Do not touch the brake unit until it is cool. Hot parts can cause injury."
11. **Vertical lists** for complex or sequential text.
12. **Keep every fact, condition, and scope qualifier.** This is a rewrite, not a summary.

## 어휘 규칙 (80%에서는 권고)

| Avoid | Use |
|---|---|
| commence | start |
| ensure | make sure |
| utilize | use |
| approximately | about |
| in order to | to |
| prior to | before |
| replenish | fill |
| close (adj.) | near |

One word, one meaning: "close" is a verb only. Use "near" for the adjective.

## Example

| Before | After |
|---|---|
| It is imperative that the operator ensures the hydraulic reservoir is replenished prior to commencing operation. | Make sure that the hydraulic reservoir is full before you start the operation. |
