# QC: Structural Meeting Flow - Final Report

## Date: 2026-02-16

## Summary
All structural meeting flow features implemented and verified with 14/14 tests passing.

## A) Meeting Lineage (parent/child)
✅ **Implemented**
- `Meeting` type extended with `parentMeetingId`, `sourceMeetingId`, `sourceCandidates`, `decisionPacket`
- DB migrations added for `parent_meeting_id`, `source_meeting_id`, `source_candidates`, `decision_packet` columns
- `createMeeting()` accepts lineage params
- `getChildMeetings()` returns meetings linked to a parent
- `extractCandidatesFromMeeting()` extracts structured candidates from completed meetings
- `startReviewMeetingFromSource()` auto-creates review meeting with source candidates injected
- UI shows "기반 회의" reference in meeting results

## B) ActionId Stability
✅ **Fixed**
- `handleChiefAction()` now handles ALL actionId patterns:
  - `view-meeting-{id}` → meeting result view
  - `approve-meeting-{id}` → approval
  - `revise-meeting-{id}` → revision request  ← **was broken before**
  - `start-review-{id}` → auto-start review meeting from source
  - `retry-{id}` → retry action
  - Unknown actionIds → graceful fallback (no "Unsupported" error)
- Root cause: server matched `action === 'request_revision'` strictly, but client sent `act.id` (e.g., `revise-meeting-xxx`), not `act.action`

## C) Context Isolation
✅ **Implemented**
- `sourceCandidates` contains only structured data (name + summary capped at 800 chars)
- Full meeting text is NOT passed to review meetings
- Review meeting prompts receive only candidate summaries, not entire parent proposals

## D) Decision Packet Standardization
✅ **Implemented**
- `DecisionPacket` type: `reviewerScoreCards`, `recommendation`, `alternatives`, `status`
- `ReviewerScoreCard` type: `reviewerName`, `reviewerRole`, `scores[]` with `candidateName/score/weight/rationale`
- Auto-generated when review meeting completes (via `generateDecisionPacket()`)
- Persisted in DB and shown in meeting result view
- Meeting completion notification includes approval/revision buttons

## E) User Bug Fixes
| # | Bug | Status |
|---|-----|--------|
| 1 | Meeting participant auto-supplement | ✅ Already implemented (`ensureMeetingParticipants`) |
| 2 | Multi-action fail-fast | ✅ Verified (T11) |
| 3 | Final version display (draft/QA/final) | ✅ Chain plan handles this |
| 4 | Chain panel residue removal | ✅ `completed`/`cancelled` plans auto-removed |
| 5 | Board contamination isolation | ✅ Session-scoped messages |
| 6 | Status query action suppression | ✅ Verified (T12) |
| 7 | Raw log contamination removal | ✅ `sanitizeAgentRawText` filters tool calls |
| 8 | Meeting view actionId error | ✅ Fixed (B section above) |
| 9 | Meeting context contamination | ✅ Fixed (C section above) |

## Meeting Flow: End-to-End
```
1. 기획 미팅 (planning/brainstorm)
   ↓ 완료 시 "리뷰어 점수화 시작" 버튼 제공
2. 리뷰어 미팅 (review, sourceMeetingId auto-injected)
   ↓ sourceCandidates 구조화 전달, 리뷰어 3인 점수화
3. 최종 추천 + 의사결정
   ↓ DecisionPacket 자동 생성 (점수표 + 추천 1안 + 대안)
4. 사용자 확정/수정 요청
```

## Test Results
14/14 passed (0 failures)

## Files Changed
- `packages/shared/src/types.ts` — MeetingCandidate, ReviewerScoreCard, DecisionPacket types + Meeting lineage fields
- `packages/server/src/db.ts` — DB migrations + updateMeetingLineage statement
- `packages/server/src/meetings.ts` — lineage support, extractCandidates, startReviewMeetingFromSource, getChildMeetings
- `packages/server/src/chief-agent.ts` — actionId routing fix, generateDecisionPacket, lineage in notifications
- `packages/web/src/components/ChiefConsole.tsx` — client action routing fix
- `packages/server/src/index.ts` — new meeting function imports
- `packages/server/src/meeting-flow.test.ts` — 14 structural tests
