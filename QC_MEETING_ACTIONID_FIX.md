# QC_MEETING_ACTIONID_FIX

## 1) 원인

### 이슈 A: `view-meeting-*` actionId 미지원
- Chief inline action dispatcher(`handleChiefAction`)가 고정 문자열(`view_result`, `approve` 등)만 처리.
- 버튼에서 전달되는 `actionId=view-meeting-<id>` 패턴은 매칭 실패.
- 결과적으로 `Unsupported actionId: view-meeting-<id>` 예외가 그대로 사용자에게 노출됨.

### 이슈 B: 세션/미팅 결과 오염
- 알림/체크인/액션 응답이 `chief-default` 세션으로 고정 라우팅됨.
- 서로 다른 대화 세션에서 이벤트가 합쳐져 "새 대화에 이전 미팅 결과가 섞이는" 현상 발생.
- WebSocket 수신 측도 세션 필터 없이 `chief_response/checkin/notification`을 합침.

---

## 2) 수정 내용

### A. actionId 처리 강화
- `packages/server/src/chief-agent.ts`
  - `handleChiefAction()`에 `view-meeting-*` 패턴 인식 추가.
  - meetingId를 actionId/params에서 추출 후 실제 회의 상세/결과 텍스트 반환(`formatMeetingResult`).
  - taskId 대상 `view_result`도 상세 결과 반환(`formatTaskResult`).
  - unknown action은 throw 대신 사용자 친화 fallback 메시지 반환(디버그 문자열 비노출).

### B. 세션 스코프 분리
- `packages/server/src/chief-agent.ts`
  - `notificationSessionById` 맵 추가: notificationId → sessionId 매핑.
  - `lastActiveChiefSessionId` 추적: 최근 사용자 대화 세션 기반으로 알림 기본 라우팅.
  - `notifyChief()`/`emitCheckIn()`/`handleChiefAction()`를 세션 스코프 기반 push로 변경.
- `packages/shared/src/types.ts`
  - `ChiefResponse`, `ChiefCheckIn`, `ChiefNotification`에 `sessionId?: string` 추가.
- `packages/server/src/index.ts`
  - `/api/chief/action`에서 `sessionId` 수신/전달.
  - action 응답 WS payload에 `sessionId` 포함.
  - action 실패 fallback 메시지 일반화(내부 오류 문자열 노출 방지).
- `packages/web/src/store.ts`
  - `chiefSessionId`(클라이언트별 고유 세션) 도입.
  - chief chat/apply/action API 호출 시 동일 sessionId 전달.
  - 수신한 `chief_response/checkin/notification`은 sessionId가 현재 세션과 다르면 무시.

---

## 3) 회귀 테스트

신규 테스트 파일:
- `packages/server/src/chief-agent.actionid-session.regression.test.ts`

검증 항목:
1. `view-meeting-<id>` 클릭 시 정상 결과 반환
2. 세션 A/B pending proposal 격리 (B 승인 시 A 액션 미실행)
3. Unknown action fallback에서 `Unsupported actionId` 문자열 미노출

실행:
```bash
cd /home/noah/.openclaw/workspace/company/ai-office/app
npm run -w @ai-office/server build
npx -y tsx packages/server/src/chief-agent.actionid-session.regression.test.ts
```

---

## 4) 재현 절차 (수정 전/후 비교)

### 이슈 1: 회의결과 보기 오류
1. 회의 완료 알림 생성
2. `회의결과 보기` 버튼 클릭 (`actionId=view-meeting-<id>`)
3. (수정 전) `Unsupported actionId` 에러
4. (수정 후) 회의 제목/상태/요약이 채팅 응답으로 표시

### 이슈 2: 세션 오염
1. 세션 A에서 Chief 대화/알림 생성
2. 세션 B(새 대화)로 전환
3. (수정 전) 세션 A 결과 일부가 세션 B에 섞여 표시
4. (수정 후) sessionId 불일치 payload 무시 + 서버측 세션 라우팅으로 분리

---

## 5) 비고
- 본 수정은 기존 기능 호환성을 유지하면서, 액션 라우팅과 세션 분리를 중심으로 hotfix 적용.
- unknown action 처리 정책은 “안전한 사용자 메시지 반환”으로 통일.
