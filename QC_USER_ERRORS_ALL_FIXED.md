# QC: User-Reported Errors - All Fixed

## Date: 2026-02-16

## Bug Fix Summary

### 1. 미팅 참여자 자동 보강
- **Status:** ✅ FIXED (already existed)
- **Location:** `chief-agent.ts` → `ensureMeetingParticipants()`
- **Behavior:** When insufficient agents exist for a meeting, auto-creates required agents by role

### 2. Multi-action fail-fast
- **Status:** ✅ VERIFIED
- **Location:** `chief-agent.ts` → `approveProposal()`
- **Behavior:** `continueOnError: false` (default) stops execution on first failure, reports skipped actions
- **Test:** T11 confirms first failure stops, second action skipped

### 3. 최종본 노출 (초안/QA/최종)
- **Status:** ✅ FIXED (chain plan system)
- **Location:** `chain-plan.ts` + `ChainPlanEditor.tsx`
- **Behavior:** Chain steps show progress, final step result is the deliverable

### 4. 체인 패널 잔상 제거
- **Status:** ✅ FIXED
- **Location:** `store.ts` → `updateChainPlan()`
- **Behavior:** `completed` or `cancelled` plans are removed from `chainPlans` array

### 5. 보드 오염 분리
- **Status:** ✅ FIXED
- **Location:** `chief-agent.ts` → session-scoped message maps
- **Behavior:** Each session maintains isolated message history

### 6. Status 조회 액션 억제
- **Status:** ✅ VERIFIED
- **Location:** `chief-agent.ts` → `classifyIntent()` + `shouldSuppressActionsByIntent()`
- **Behavior:** Status/definition queries return direct answers, no ACTION proposals
- **Test:** T12 confirms

### 7. Raw log 오염 제거
- **Status:** ✅ FIXED
- **Location:** `openclaw-adapter.ts` → `sanitizeAgentRawText()`
- **Behavior:** Strips ANSI, tool calls, tracebacks, JSON wrappers from agent output

### 8. Meeting view actionId 에러 제거
- **Status:** ✅ FIXED (this commit)
- **Root cause:** Server `handleChiefAction()` checked `action === 'request_revision'` strictly, but client sent `act.id` (e.g., `revise-meeting-xxx`)
- **Fix:** Prefix-based matching for all compound actionIds (`approve-*`, `revise-*`, `view-*`, `start-review-*`, `retry-*`)
- **Tests:** T03-T08 all pass

### 9. 미팅 문맥 오염 제거
- **Status:** ✅ FIXED (this commit)
- **Fix:** Review meetings receive only structured `sourceCandidates` (name + 800-char summary), not full meeting transcripts
- **Location:** `meetings.ts` → `extractCandidatesFromMeeting()`, `startReviewMeetingFromSource()`

## Regression: 0 issues
All 14 tests pass. No regressions detected.
