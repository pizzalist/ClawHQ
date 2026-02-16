# QC Opus Fix Result

- 작성일: 2026-02-16 (KST)
- 근거: QC_BUG_BACKLOG.md, QC_USER_JOURNEY_DEEP.md, QC_MARKDOWN_RENDERING.md, QC_AUDIT_SECOND_OPINION.md

## 수정 요약

### Fix 1: Markdown 파서 — fenced code block 인식 강화 [HIGH]
- **이슈**: BUG-001 (D07/D08 FAIL) — code fence + inline code + 줄바꿈 혼합 시 렌더 깨짐
- **원인**: fence 감지 정규식 `^```(\w+)?\s*$`이 trailing 텍스트 있는 fence(예: ` ```javascript title="example" `)를 인식 못함. 또한 paragraph collector가 fence-start 행을 흡수하여 코드블록이 paragraph에 병합됨.
- **수정**:
  - `markdown.tsx`: fence 정규식을 `` ^(`{3,})(\w*)\s*.*$ ``로 확장, 가변 길이 backtick fence 지원
  - closing fence를 opening fence의 backtick 수에 매칭하도록 동적 RegExp 생성
  - paragraph collector에 `` /^`{3,}/ `` 및 `` /^\|.*\|\s*$/ `` (table) break 조건 추가
- **전**: backtick이 paragraph 텍스트로 노출, `<pre><code>` 블록 미생성
- **후**: fenced block이 안정적으로 `<pre><code>` 렌더링, table도 paragraph에 병합되지 않음

### Fix 2: 한글 숫자 파싱 — "한명", "두명" 인식 [MEDIUM]
- **이슈**: C28/C29 (QC_AUDIT_SECOND_OPINION 반례) — "개발자 한명"이 기본 템플릿으로 회귀
- **원인**: `parseExplicitRoleCounts()`가 아라비아 숫자만 파싱, 한글 수량어("한", "두", "세"…) 미지원
- **수정**:
  - `chief-agent.ts`: `KOREAN_NUMS` 매핑 테이블 (한/하나/일→1 ~ 열/십→10) 추가
  - `parseKoreanOrArabicNum()` 헬퍼 함수로 아라비아/한글 수량어 통합 파싱
  - 정규식 패턴에 한글 수량어 대안을 동적 삽입
- **전**: "개발자 한명" → `{pm:1, developer:2, reviewer:1}` (기본 템플릿)
- **후**: "개발자 한명" → `{developer:1}` (정확 파싱)

### Fix 3: Paragraph collector 누수 방어 [LOW]
- **이슈**: BUG-002 — 줄바꿈 많은 문장에서 backtick/문단 경계 처리 불일치
- **수정**: paragraph while-loop에 table 패턴 break 조건 추가 (Fix 1과 동일 파일)

## 빌드 검증

```
npx turbo build → 3 successful, 3 total (3.98s)
node packages/server/dist/task-queue.chain.test.js → ✅ 7 assertions
node packages/server/dist/regression-qc.js → ✅ 12/12 passed
```

## 회귀 테스트 12건 상세

| ID | 테스트 | 결과 |
|----|--------|------|
| R01 | "개발자 한명" → developer 1 | ✅ |
| R02 | "PM 두명" → pm 2 | ✅ |
| R03 | "리뷰어 세명" → reviewer 3 | ✅ |
| R04 | "한명의 개발자" → developer 1 | ✅ |
| R05 | Arabic "개발자 2명" (기존 호환) | ✅ |
| R06 | "디자이너 한명 개발자 두명" → mixed | ✅ |
| R07 | Report → PM 단독 종료 | ✅ |
| R08 | Web 구현 → PM→Developer 체인 | ✅ |
| R09 | Web+리뷰 → Developer→Reviewer | ✅ |
| R10 | 상태 조회 분류 | ✅ |
| R11 | "개발자 1명 추가" explicit | ✅ |
| R12 | "개발자 99명" → clamped to 5 | ✅ |

## 남은 리스크

1. **중첩 리스트/복합 테이블**: 경량 파서 한계. 필요 시 `remark/rehype` 도입 고려.
2. **BUG-003 탭 라벨 비일관성**: 코드 상 탭 라벨은 상수 배열로 안정적. 재현 불가 — 일시적 상태 이슈로 판단.
3. **BUG-004 응답 간결성**: LLM 모드에서는 `toConciseModeReply()` 클램핑이 작동하나, LLM 자체의 장황성은 프롬프트 의존.
4. **한글 숫자 동음이의어**: "이"(2)와 조사 "이"의 충돌 가능성. 현재는 role alias + 수량어 조합에서만 매칭하므로 오탐 최소화.
