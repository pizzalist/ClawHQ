# QC Final Bugs Fixed

**Date:** 2026-02-16  
**Commit:** `fix(all): final e2e fixes before user retest`

## Bug 1: 회의 결과 알림 이중 렌더링 (Critical)

**증상:** Chief 채팅에서 회의 완료 알림이 항상 2번 표시됨  
**원인:** `ChatMessage` 컴포넌트가 notification 메시지에 대해:
1. `<MarkdownContent text={m.content}>` 으로 summary 렌더링
2. `<InlineNotification>` 에서 `notification.summary` 다시 렌더링

`m.content === notification.summary` 이므로 동일 내용이 2번 출력됨  
**수정:** notification 메시지는 `InlineNotification` 만 렌더링하도록 변경  
**파일:** `packages/web/src/components/ChiefConsole.tsx`

## Bug 2: 서버 재시작 후 알림 세션 라우팅 실패 (High)

**증상:** 서버 재시작 후 인라인 액션(리뷰어 점수화 시작 등) 클릭 → 미팅 완료 알림이 클라이언트에 도착하지 않음  
**원인:** 서버 메모리의 `lastActiveChiefSessionId`가 재시작 시 `'chief-default'`로 초기화되는데, 인라인 액션 핸들러(`handleChiefAction`)에서 클라이언트 세션 ID를 갱신하지 않아 미팅 완료 notification이 `'chief-default'` 세션으로 전송됨. 클라이언트는 세션 ID 불일치로 무시.  
**수정:** `handleChiefAction` 진입 시 `lastActiveChiefSessionId` 갱신  
**파일:** `packages/server/src/chief-agent.ts`
