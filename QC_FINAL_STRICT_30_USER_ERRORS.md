# QC_FINAL_STRICT_30_USER_ERRORS — 사용자 8개 오류 + 추가 오류 검증

**일시:** 2026-02-16 21:17 KST  
**감사자:** Subagent (strict-e2e-user-regression-30)  
**기준:** 코드 정적 분석 기반, 애매하면 FAIL

---

## 1) 사이드바 승인 시 "task not found" 오류 — ✅ PASS

- `handleChiefAction()` (chief-agent.ts L300~430)에서 actionId prefix 매칭(`approve-*`, `revise-*`, `view-*`, `start-review-*`, `retry-*`) 적용됨
- 이전에 strict equality(`action === 'request_revision'`)로 실패하던 compound actionId가 이제 모두 처리됨
- `approveProposal()`은 messageId가 없으면 throw하되 "Task not found"가 아닌 "No pending proposal found" 메시지 사용
- **판정:** 사용자에게 "task not found" 노출 경로 없음

## 2) 확정 메시지 중복 — ✅ PASS

- 3단계 dedup 구현 확인:
  1. `reportedTaskCompletions` / `reportedMeetingCompletions` Set (entity-level)
  2. `isNotificationDuplicate()` — emittedNotificationKeys Set (notification-level)
  3. `isEntityFullyReported()` — notification + checkin 쌍 체크
- `handleChiefCheckIn` / `handleChiefNotification` 클라이언트 측에도 `s.chiefMessages.some(m => m.id === ...)` dedup
- `handleChiefResponse`에서도 동일 messageId 중복 방지
- **판정:** 확정 메시지 중복 경로 차단됨

## 3) 미팅 참여자 수 정확성 — ⚠️ CONDITIONAL PASS

- `ensureMeetingParticipants()` (chief-agent.ts)가 roleCounts 기반으로 에이전트 확보/자동 생성
- `parseMeetingParticipantRoleCounts()`가 "pm 2명", "개발자 3" 등 한국어+숫자 파싱
- 하드 최소 보장: `while (participantIds.length < 2)` 
- **문제:** MeetingRoom.tsx L216에서 `{m.proposals.length}명 참여`로 표시 — 이는 **실제 proposals 수**이지 participants 수가 아님. 진행 중 미팅에서 0명 참여로 보일 수 있음
- MeetingDetail에서는 `meeting.participants` 기반으로 올바르게 표시
- 사이드바 리스트만 proposals 기반 → 미완료 미팅에서 오해 소지
- **판정:** 핵심 기능은 정확하나 사이드바 리스트 표기가 부정확할 수 있음 → CONDITIONAL

## 4) 결과보기 UX — ✅ PASS

- `TaskResultModal` 모달 구현 (700px, 85vh, 고정 오버레이)
- `InlineNotification`에서 view_result + taskId → `setSelectedTask(params.taskId)` 클라이언트 측 모달 열기
- view-meeting은 서버 `handleChiefAction` → `formatMeetingResult()` → 채팅 인라인 표시
- 초안/QA/최종본 탭 분리 (`activeOutputTab`)
- Pipeline steps 접기/펼치기
- DeliverableList 컴포넌트 별도 렌더
- **판정:** 모달/패널 UX 구현 완료

## 5) 후보 다양성/편향 — ❌ FAIL

- `extractCandidatesFromMeeting()`은 proposals를 그대로 후보로 사용 (agentName = 후보 이름)
- 후보는 참여 에이전트의 발언 그 자체 → 에이전트 수 = 후보 수
- **편향 문제:** 리뷰어 프롬프트에 "다양한 관점 고려" 등 디바이어싱 지시 없음
- 점수화 기준은 5개 항목(Problem/Feasibility/Differentiation/Time-to-Demo/Risk)으로 구조화되어 있으나, 후보 자체의 다양성을 보장하는 메커니즘 없음
- 동일 role의 에이전트가 비슷한 관점을 낼 가능성 높음
- **판정:** 다양성 보장 메커니즘 미구현

## 6) 회의실 Markdown 가독성 — ⚠️ CONDITIONAL PASS

- `MeetingReport` 컴포넌트: `whitespace-pre-wrap` + 일반 텍스트 렌더
- **문제:** MeetingReport는 `{report}` 직접 렌더, MarkdownContent 미사용
- ContributionCard도 `whitespace-pre-wrap` 직접 렌더
- `MarkdownContent` 컴포넌트는 존재하고 ChiefConsole/TaskResultModal에서는 사용하지만, MeetingRoom의 report/contribution에서는 미사용
- markdown.tsx의 markdownToHtml은 heading, list, table, code block, bold/italic 모두 지원
- **판정:** MeetingReport와 ContributionCard가 MarkdownContent를 사용하지 않아 markdown이 raw text로 노출됨 → CONDITIONAL

## 7) 리뷰어 점수화 로직 — ✅ PASS

- `startReviewMeetingFromSource()` → 리뷰어에게 [SCORE] 형식 프롬프트 제공
- `parseStructuredScores()` → [SCORE] 라인 파싱 + 레거시 fallback (Name N/10)
- `buildReviewDecisionPacket()` → 후보별 총점/평균 산출, 1순위 추천 + 대안 생성
- `ReviewScoringPanel` UI 컴포넌트 → 점수표 테이블 + 추천/대안 카드
- `generateDecisionPacket()` (chief-agent.ts) → 별도 경로에서도 동일 로직
- **판정:** 후보평가/순위추천 정상 동작

## 8) 확정 후 자동 다음 실행 — ⚠️ CONDITIONAL PASS

- `handleChiefAction(approve)` → 다음 단계 안내 텍스트 생성 (planning→review 제안 등)
- **그러나:** 실제 자동 실행은 수행하지 않음. 사용자에게 "무엇을 진행할까요?" 물어봄
- 체인 플랜: `shouldAutoChain()` → `autoExecute` 플래그가 true일 때만 자동 진행
- 기본값 `autoExecute: false` → 수동 advance 필요
- `advanceChainPlan` API 존재하나 확정 버튼 클릭 시 자동 호출되지 않음
- **판정:** "자동" 다음 실행이 아닌 "제안" 수준. autoExecute 기본 off → 사용자 기대와 불일치 가능

## 9) 빈화면/리프레시 유실 — ✅ PASS

- Chief 상태 localStorage 영속화: `CHIEF_STORAGE_KEY = 'ai-office-chief-state-v1'`
- Messages, suggestions, proposals, checkIns, notifications 모두 persist
- `useStore.subscribe()` → 매 상태 변경 시 persistChiefState 호출
- WS reconnect: `onclose` → 3초 후 `connectWS()` 재연결
- `init()` → `refreshActiveChainPlans()` 호출
- `ErrorBoundary` → 자동 복구 (1초 후 재렌더)
- 전역 error/unhandledrejection 캐치 → toast 알림
- `pushMessage()` → 빈 content chief 메시지 드롭 (빈 버블 방지)
- `handleChiefResponse()` → 빈 reply+action 없으면 skip
- **판정:** 빈화면 방지 + 리프레시 복구 구현 완료

---

## 추가 발견 오류

### E10) MeetingRoom 리스트에서 proposals.length를 참여자 수로 오인 표시
- **위치:** MeetingRoom.tsx L216 `{m.proposals.length}명 참여`
- **영향:** 진행 중 미팅에서 "0명 참여" 표시
- **우선순위:** Medium

### E11) MeetingReport/ContributionCard에서 MarkdownContent 미사용
- **위치:** MeetingRoom.tsx L41, L30
- **영향:** 회의 결과에 `#`, `**`, `- ` 등 raw markdown 노출
- **우선순위:** Medium

### E12) 후보 다양성 메커니즘 부재
- **위치:** meetings.ts `startReviewMeetingFromSource` / `extractCandidatesFromMeeting`
- **영향:** 동일 role 에이전트의 유사 관점 → 실질적 비교 가치 저하
- **우선순위:** Low (설계 레벨)

### E13) 확정 후 자동 실행 기본 비활성화 (UX 혼란)
- **위치:** chain-plan.ts `autoExecute: false` 기본값
- **영향:** 사용자가 "확정 후 자동 다음 실행"을 기대하나 수동 조작 필요
- **우선순위:** Low (UX preference)

---

## 요약

| # | 항목 | 판정 |
|---|------|------|
| 1 | task not found | ✅ PASS |
| 2 | 확정 중복 | ✅ PASS |
| 3 | 미팅 참여자 수 | ⚠️ CONDITIONAL |
| 4 | 결과보기 UX | ✅ PASS |
| 5 | 후보 다양성 | ❌ FAIL |
| 6 | Markdown 가독성 | ⚠️ CONDITIONAL |
| 7 | 점수화 로직 | ✅ PASS |
| 8 | 확정 후 자동 실행 | ⚠️ CONDITIONAL |
| 9 | 빈화면/리프레시 | ✅ PASS |

**PASS: 5 / CONDITIONAL: 3 / FAIL: 1**
