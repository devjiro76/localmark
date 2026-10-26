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

1. **키워드 검색부터 한다.** `query`에 `searches: [{ "type": "lex", "query": "..." }]`만 넣으면 BM25 검색이라 1초 안에 끝난다. 일반 `query` 문자열은 질의 확장과 재정렬 때문에 10~20초 걸리므로, 키워드로 부족할 때 의미 검색으로 쓴다.
2. **질의를 나눈다.** 사용자의 질문을 그대로 길게 넣지 말고 핵심 키워드 2~4개로 나눠 여러 번 질의한다. Vault 글은 대부분 한국어이므로 한국어 키워드를 먼저 쓰고, 영어는 고유명사·도구 이름이나 영어 원문을 찾을 때 보조로 쓴다.
3. **본문이 맞은 결과만 후보로 둔다.** 스니펫이 YAML 머리말(`---`, `id:`, `platform:` 줄)만 보이면 본문이 일치한 것이 아니다. 원문을 열어 본문에 관련 내용이 있을 때만 채택한다. 영어 질의에서 자주 생긴다.
4. **후보를 묶는다.** 플랫폼·작성자·주제별로 정리한다. 연글은 아래 "연글" 규칙대로 root 문서 하나로 센다.
5. **`get`/`multi_get`으로 원문을 확인한다.** 검색 스니펫만으로 답하지 말고, 인용할 문서는 반드시 원문을 연다.
6. 답변에는 각 주장의 근거 문서를 붙인다.

## 읽기 전용 규칙

- Vault의 어떤 파일도 생성·수정·삭제하지 않는다. QMD 인덱스 갱신(`update`, `embed`, `cleanup`)이나 수집(`sync`)도 실행하지 않는다.
- 사용자가 메모를 요청하면 Vault 밖에 작성하거나, 별도 승인을 받은 뒤 `annotations/`에만 쓴다.

## 검색 결과 판단

- **점수는 관련도의 증거가 아니다.** 재정렬 점수는 상대값이라 Vault에 없는 주제에도 높게 나온다(예: "김치찌개 레시피" 질의에 라면 레시피 글이 75%). 채택 여부는 원문 본문이 질문과 맞는지로 판단한다.
- 본문이 맞는 문서가 없으면 "저장된 자료에서 찾지 못했다"고 말하고, 일반 지식으로 대신 답하지 않는다. 비슷하지만 다른 주제의 글만 있으면 그렇다고 밝히고 보여 준다. 일반 지식을 덧붙일 때는 Vault 근거가 아님을 구분한다.

## 인용과 신뢰도 표기

- 인용 형식: `@{author} · {platform} · {published_at} · {source_url}`.
- **잘린 본문을 전체 원문처럼 인용하지 않는다.** 어떤 `observation_scope`든 본문이 문장 중간에 끊기거나 `https://t.co/…` 링크로 끝나면 수집 때 잘린 글일 수 있다. 이때는 "본문 일부(잘림)"라고 표기하고 `source_url`에서 전체를 확인하라고 안내한다.
- `observation_scope`별 표기:

| 값 | 뜻 | 답변 표기 |
| --- | --- | --- |
| `rendered_body_partial` | 화면에서 읽은 부분 원문(현재 수집기 기본값) | "부분 원문" |
| `rendered_page_text` | 상세 화면에서 읽은 텍스트 | 잘림 신호가 없으면 원문으로 인용 |
| `collector_item_text` | 이전 수집기가 목록에서 받은 글 텍스트. X 긴 글은 잘려 있는 경우가 많다 | 잘림 신호를 확인 |
| `bookmark_API_text_projection` | 북마크 API 응답의 텍스트 필드. X 긴 글은 잘릴 수 있다 | 잘림 신호를 확인 |
| `legacy_root_text` | 이전 수집기의 연글 첫 글 텍스트만 있음 | "연글 첫 글만 보관" |
| `summary_only_unverified` | 원문이 아니라 기존 요약 | "요약 기반, 원문 미확인" |

- 표에 없는 값이면 전체 원문이라고 단정하지 않는다.

## 연글

- 연글 문서는 첫 글(root) 기준 하나이며 `thread_total`과 `Thread` 섹션에 전체 파트가 있다. `collected_posts`는 어떤 파트를 수집했는지 나타내는 정보이지 문서에 포함된 파트의 범위가 아니다.
- 이전 버전 문서에는 `thread_position`이 남아 있어 root가 아닌 파트가 검색에 먼저 걸릴 수 있다. 문서의 `thread_root`가 자기 `id`와 다르면 root 문서(`posts/{platform}/**/{thread_root의 post_id}.md`)를 열어 그 문서로 인용하고, 파트 문서는 따로 세지 않는다. root 문서가 Vault에 없으면 파트 문서로 인용하되 "연글 {thread_position}/{thread_total}번째 파트만 보관"이라고 표기한다.
- root 문서와 파트 문서의 `thread_total`이 다르면 root 문서 값을 따른다.

## 응답 예시

사용자: "영상 자동화로 수익화하는 얘기 저장한 거 있어?"

1. `lex`로 "영상 자동화", "쇼츠 자동화", "수익화"를 각각 질의하고, 부족하면 `query`에 "AI 영상 자동화로 수익 내는 방법"을 넣는다.
2. 상위 문서를 `multi_get`으로 읽고, 본문이 맞는 문서만 주제별(수익화 전략 / 제작 자동화 과정)로 묶는다. 파트 문서가 걸리면 `thread_root` 문서로 바꾼다.
3. 각 항목에 인용 형식을 붙여 요약하고, 잘린 글·부분 원문은 그렇게 표기한 뒤 `source_url`을 안내한다.
