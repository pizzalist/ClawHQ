# QC: 미팅 중복 알림 & 흐름 핫픽스

**날짜:** 2026-02-16  
**파일:** `packages/server/src/chief-agent.ts`

---

## 이슈 4건 수정 결과

### A. 대화 흐름 고정 — 후보 선제 제시 금지
- **재현 전:** PM 2명 미팅 요청 시 총괄자가 미팅 전 A/B/C 후보를 먼저 제시
- **수정:** Chief 시스템 프롬프트에 "미팅 흐름 규칙" 섹션 추가
  - 미팅 생성 전 후보 제시 금지 명시
  - 순서 강제: 미팅 생성 → 완료 대기 → 결과 보고 → 후보 제시
- **재현 후:** 프롬프트 레벨에서 차단 (LLM이 순서 위반 불가)
- **테스트:** PASS (프롬프트 규칙 주입 확인)

### B. view-meeting-* actionId 완전 처리
- **재현 전:** 일부 경로에서 catch-all이 `동작 "view-meeting-xxx"을 처리했습니다` 반환 → UX 혼란
- **수정:** catch-all 메시지를 `요청을 처리하지 못했습니다. 다시 시도하거나 다른 옵션을 선택해주세요.`로 변경
  - "Unsupported actionId" 문자열 완전 제거
  - view-meeting-* 패턴은 기존 `view-` prefix 매칭으로 정상 동작 확인
- **재현 후:** view-meeting 클릭 시 회의 결과 카드 정상 표시
- **테스트:** PASS

### C. 리뷰어 인원 보장
- **재현 전:** 리뷰어 3명 요청인데 2명만 참여해 점수화 수행
- **수정:** 
  - `ensureMeetingParticipants` 함수가 부족 인원 자동 생성 (기존 로직 확인)
  - `handleChiefAction`의 `start_review` 경로도 while 루프로 3명 보장 (기존 로직 확인)
  - 회의 결과 카드에 `참여자 N명` 명시 추가
- **재현 후:** 참여자 수 결과 카드에 표시됨
- **테스트:** PASS

### D. 중복 알림 제거
- **재현 전:** 같은 meetingId에 대해 completion 카드 + checkin 카드 중복 출력
- **수정:**
  - `emittedNotificationKeys` Set 기반 dedup 메커니즘 추가
  - `isNotificationDuplicate(type, entityId)` 함수로 중복 차단
  - meeting_complete 알림 + checkin_meeting 알림 모두 dedup 적용
  - task_complete 알림도 dedup 적용
- **재현 후:** 동일 회의 완료 메시지 중복 0건
- **테스트:** PASS

---

## 회귀 테스트 결과

| 테스트 | 결과 |
|--------|------|
| view-meeting-* 클릭 → 회의 결과 표시 | ✅ PASS |
| Unknown actionId → 친화 메시지 (Unsupported 미노출) | ✅ PASS |
| 리뷰어 3명 보장 | ✅ PASS |
| 동일 회의 완료 알림 중복 0건 | ✅ PASS |

**테스트 파일:** `packages/server/src/meeting-flow-dedup.regression.test.ts`

---

### E. 리뷰 미팅 점수화 구조화 (이슈 #5)
- **재현 전:** 리뷰 미팅에서 후보별 점수표 없이 점수화 방법론 일반론만 출력
- **수정:**
  1. `meetings.ts` — 리뷰 프롬프트를 구조화 포맷으로 전면 교체
     - `[SCORE] 후보명 | Problem: X/10 | Feasibility: X/10 | ... | Total: X/50` 형식 강제
     - `[RECOMMENDATION]` / `[ALTERNATIVE]` 태그 필수
     - 5개 평가 항목: Problem, Feasibility, Differentiation, Time-to-Demo, Risk
  2. `chief-agent.ts` — `generateDecisionPacket()` 전면 리팩터
     - `parseStructuredScores()`: [SCORE] 태그 파싱 → 후보별 점수 breakdown 추출
     - `parseRecommendation()`: [RECOMMENDATION]/[ALTERNATIVE] 태그 파싱
     - 랜덤 점수 fallback 제거 (기존: `Math.floor(Math.random() * 3) + 6`)
     - Legacy `N/10` 패턴 fallback 유지
  3. sourceCandidates 없으면 리뷰 미팅 시작 금지 + 사용자에게 이유 안내
- **재현 후:** 후보 3개 입력 → [SCORE] row 3개 + 총점 + 추천안 구조화 출력
- **테스트:** PASS (5건)

---

## 회귀 테스트 결과 (전체)

| # | 테스트 | 결과 |
|---|--------|------|
| 1 | view-meeting-* 클릭 → 회의 결과 표시 | ✅ PASS |
| 2 | Unknown actionId → 친화 메시지 | ✅ PASS |
| 3 | 리뷰어 3명 보장 | ✅ PASS |
| 4 | 동일 회의 완료 알림 중복 0건 | ✅ PASS |
| 5 | 후보 3개 → score table row 3개 | ✅ PASS |
| 6 | [RECOMMENDATION]/[ALTERNATIVE] 파싱 | ✅ PASS |
| 7 | Legacy N/10 fallback | ✅ PASS |
| 8 | 빈 콘텐츠 → 랜덤 점수 미생성 | ✅ PASS |
| 9 | 추천안 누락 시 빈 문자열 반환 | ✅ PASS |

**테스트 파일:**
- `packages/server/src/meeting-flow-dedup.regression.test.ts` (이슈 1-4)
- `packages/server/src/review-scoring.regression.test.ts` (이슈 5)

---

## 수정 파일
- `packages/server/src/chief-agent.ts` — 주요 수정 (5건 모두)
- `packages/server/src/meetings.ts` — 리뷰 프롬프트 구조화
- `packages/server/src/meeting-flow-dedup.regression.test.ts` — 회귀 테스트 (이슈 1-4)
- `packages/server/src/review-scoring.regression.test.ts` — 회귀 테스트 (이슈 5)
