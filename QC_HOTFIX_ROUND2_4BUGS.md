# QC Hotfix Round 2 — 4 Bugs Fix Report

**커밋**: `0a8da5d`
**날짜**: 2026-02-16

## Bug 1: 미팅 인원 불일치 (3명 요청 → 2명 참여)

**원인**: 
1. `generateConsolidatedReport`에서 `meeting.proposals.length` (실제 완료 수)를 표시 → 요청 인원과 불일치
2. 에이전트가 이미 `working` 상태일 때 FSM 전환 실패 → 세션 스폰 중복/누락

**수정**:
- `meetings.ts`: 보고서에 `meeting.participants.length` (요청 인원) 사용
- `meetings.ts`: 미팅 시작 전 `resetAgent(agentId)` 강제 호출하여 idle 상태 보장 (planning + review 양쪽)

**PASS** ✅

## Bug 2: 회의 완료 알림/확정 중복

**원인**: `chiefHandleMeetingChange`에서 `notifyChief` (notification 카드 + 확정/수정 버튼) **과** `emitCheckIn` (총괄자 확인 카드 + 확정/수정 버튼)을 동시 발행

**수정**:
- `chief-agent.ts`: `emitCheckIn` 호출 제거. notification 카드 하나만 남김

**PASS** ✅

## Bug 3: 회의 결과 내용 2번 중복 출력

**원인**: Bug 2와 동일 — notification + check-in 두 경로에서 같은 회의 완료 내용을 각각 push

**수정**: Bug 2 해결로 자연 해소 (단일 경로만 남음)

**PASS** ✅

## Bug 4: 후보 디테일 내용 볼 수 없음

**원인**: `ReviewScoringPanel` 테이블에 후보 이름과 점수만 표시, description/summary 없음

**수정**:
- `MeetingRoom.tsx` `ReviewScoringPanel`:
  - "설명" 컬럼 추가 (summary 60자 truncate + tooltip)
  - 후보 이름 클릭 시 expand/collapse로 전체 summary 표시
  - `sourceCandidates`의 summary를 candidateMap으로 매핑

**PASS** ✅

## 빌드 결과

```
Tasks:    3 successful, 3 total
Cached:    1 cached, 3 total
Time:    4.869s
```

모든 패키지 빌드 성공 (shared, server, web).
