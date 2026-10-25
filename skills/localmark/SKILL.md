---
name: localmark
description: Search and read the user's Localmark vault (X/Threads posts saved as local Markdown) through the read-only QMD MCP tools. Use when the user asks to find, summarize, compare, or reference their saved/bookmarked social posts, authors, threads, or topics from their personal collection.
---

# Localmark 읽기 전용 검색 스킬

Localmark는 사용자가 X·Threads에서 북마크·좋아요·저장·리포스트한 글을 로컬 Markdown으로 보관한 Vault다. 이 스킬은 그 Vault를 **읽기 전용**으로 검색하고 인용하는 방법을 정의한다.

## 전제

- `localmark` 이름의 QMD MCP 서버가 등록되어 있어야 한다. 등록 방법은 저장소의 README "QMD로 검색과 AI 연결" 절을 따른다(`corepack yarn --silent cli rag --data PATH --print-mcp`).
- MCP를 쓸 수 없는 환경이면 Vault의 `posts/**/*.md`를 직접 읽는 방식으로 대체한다. 이 경우에도 아래 읽기 전용 규칙은 동일하게 적용한다.

## 도구 사용 순서

1. **`query`로 검색한다.** 사용자의 질문을 그대로 길게 넣지 말고 핵심 키워드 2~4개로 나눠 여러 번 질의한다. 한국어와 영어를 모두 시도하면 누락이 줄어든다.
2. **후보를 묶는다.** 플랫폼·작성자·주제별로 정리한다. 연글은 `thread_root` 기준 문서 하나에 전체 파트가 들어 있으므로 중복해서 세지 않는다.
3. **`get`/`multi_get`으로 원문을 확인한다.** 검색 스니펫만으로 답하지 말고, 인용할 문서는 반드시 원문을 연다.
4. 답변에는 각 주장의 근거 문서를 붙인다.

## 읽기 전용 규칙

- Vault의 어떤 파일도 생성·수정·삭제하지 않는다. QMD 인덱스 갱신(`update`, `embed`)이나 수집(`sync`)도 실행하지 않는다.
- 사용자가 메모를 요청하면 Vault 밖에 작성하거나, 별도 승인을 받은 뒤 `annotations/`에만 쓴다.

## 인용과 신뢰도 표기

- 인용 형식: `@{author} · {platform} · {published_at} · {source_url}`.
- `observation_scope`를 확인한다. `rendered_body_partial`이면 화면에서 읽은 부분 원문이라는 뜻이므로 전체 원문이라고 단정하지 않는다. `summary_only_unverified`이면 원문이 아니라 기존 요약이므로 "요약 기반, 원문 미확인"이라고 명시한다.
- 연글 문서는 첫 글(root) 기준 하나이며 `thread_total`과 `Thread` 섹션에 전체 파트가 있다. `collected_posts`는 어떤 파트를 수집했는지 나타내는 정보이지 문서에 포함된 파트의 범위가 아니다. 이전 버전 문서에는 `thread_position`이 남아 있을 수 있으며 다음 수집·갱신 때 root 문서로 통합된다.
- 검색 결과가 없거나 약하면 "저장된 자료에서 찾지 못했다"고 말하고, 일반 지식으로 대신 답하지 않는다. 일반 지식을 덧붙일 때는 Vault 근거가 아님을 구분한다.

## 응답 예시

사용자: "영상 자동화로 수익화하는 얘기 저장한 거 있어?"

1. `query`에 "영상 자동화 수익화", "video automation monetization"을 각각 질의한다.
2. 상위 문서를 `multi_get`으로 읽고 주제별로 묶는다.
3. 각 항목에 `source_url`을 붙여 요약하고, 원문 확인이 필요한 항목은 링크를 안내한다.
