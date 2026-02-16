# QC Hotfix Round 3 — Meeting Flow + UX

**커밋:** `f35cfd5`  
**날짜:** 2026-02-16

## 버그 1: Activity Log 접기/펼치기 ✅

**파일:** `packages/web/src/components/ActivityLog.tsx`

**수정 내용:**
- `collapsed` state 추가, 헤더를 클릭 가능한 토글 버튼으로 변경
- 접힌 상태에서 높이 `h-8` (헤더만), 펼친 상태 `h-48` (기존)
- 화살표 아이콘으로 상태 표시 (▼/▶)

## 버그 2: Planning 요청인데 Review가 자동 시작되는 문제 ✅

**파일:** `packages/server/src/chief-agent.ts`

**근본 원인:** `handleChiefAction`에서 planning meeting `approve` 시 자동으로 `startReviewMeetingFromSource`를 호출하고 있었음. 사용자가 "확정"만 했는데 리뷰어 3명이 자동 생성되어 리뷰 미팅이 시작됨.

**수정 내용:**
- `approve` 핸들러에서 planning/brainstorm 미팅의 자동 리뷰 시작 로직 제거
- 대신 도출된 후보 목록을 보여주고, "리뷰어 점수화 시작" 버튼 안내
- 리뷰는 `start_review` actionId (기존 구현 유지)로만 실행 가능

**올바른 흐름:**
1. Planning meeting 완료 → 알림 카드 (📄 결과 보기 / 🔍 리뷰어 점수화 시작 / ✅ 확정)
2. 사용자가 "확정" → 후보 목록 표시, 리뷰 자동 시작 안 함
3. 사용자가 "리뷰어 점수화 시작" → review meeting 시작

## 버그 3: 참여자 수 부족 (3명 요청 → 2명) 🔍

**파일:** `packages/server/src/meetings.ts`, `packages/server/src/chief-agent.ts`

**분석:** 코드 로직 자체는 정상 (parseMeetingParticipantRoleCounts, ensureMeetingParticipants, startPlanningMeeting 모두 participant 수를 올바르게 처리). 근본 원인은 LLM이 `participants` 파라미터를 잘못 생성하는 경우 (예: "pm,developer" = 2명으로 파싱되는데 사용자는 PM 3명을 원함).

**수정 내용:**
- `parseMeetingParticipantRoleCounts`, `ensureMeetingParticipants`, `startPlanningMeeting`에 상세 console.log 추가
- 서버 로그에서 `[chief]`/`[meeting]` 접두사로 실시간 추적 가능
- `startPlanningMeeting`의 기존 자동 보강(deficit fill) 로직은 유지

**향후:** 로그 확인 후 LLM 프롬프트 또는 파싱 로직 추가 조정 필요시 Round 4에서 처리.

## 버그 4: 회의 완료 알림 중복 ✅

**파일:** `packages/web/src/store.ts`

**근본 원인:** 회의 완료 시 2개 경로로 사용자에게 알림:
1. `chief_notification` WS → `handleChiefNotification` → 알림 카드 추가
2. `meetings_update` WS → toast("Meeting complete! ... proposals ready")

두 이벤트 모두 같은 meeting 완료에 대해 발생하여 중복.

**수정 내용:**
- `meetings_update` WS 핸들러에서 완료 toast 제거
- 회의 완료 알림은 `chief_notification` 단일 경로로만 전달

## 버그 5: 미팅 삭제 시 cancel_task로 처리하는 문제 ✅

**파일:** `packages/shared/src/types.ts`, `packages/server/src/chief-agent.ts`, `packages/server/src/meetings.ts`

**근본 원인:** `delete_meeting` / `delete_all_meetings` 액션 타입이 없어서 Chief LLM이 `cancel_task(meetingId)`로 대체 시도 → "작업을 찾을 수 없습니다" 오류.

**수정 내용:**
- `ChiefActionType`에 `delete_meeting`, `delete_all_meetings` 추가
- `meetings.ts`에 `deleteMeeting(id)`, `deleteAllMeetings()` 함수 추가
- `executeAction`에 두 액션 타입 처리 추가
- `buildChiefSystemPrompt`에 `[ACTION:delete_meeting]`, `[ACTION:delete_all_meetings]` 안내 추가
- `ACTION_LABEL_MAP`에 라벨 추가

## 빌드 확인

```
✓ server build (tsc)
✓ web build (tsc + vite) — 510 modules, 0 errors
```
