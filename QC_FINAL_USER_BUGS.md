# QC_FINAL_USER_BUGS — 최종 감사 발견 버그/이슈

**감사일:** 2026-02-16  
**기준 커밋:** 7cc0288

---

## CONDITIONAL 이슈 (3건)

### BUG-C1: 점수표 markdown 테이블이 raw 텍스트로 렌더됨 (E1)
- **위치:** `MeetingRoom.tsx` → `MeetingReport` 컴포넌트
- **현상:** `buildReviewScoringReport`가 markdown 테이블(`| 후보 | 항목 | 총점 |`)을 생성하지만, `MeetingReport`는 `<div className="whitespace-pre-wrap">{report}</div>`로 raw 텍스트 출력. pipe 문자가 그대로 보임.
- **영향도:** Medium — 점수표 가독성 저하. Chief 콘솔에서는 MarkdownContent로 렌더되므로 거기서는 정상.
- **수정안:** MeetingReport에서 `MarkdownContent` 컴포넌트 사용

### BUG-C2: [SCORE] 파싱 실패 시 무조건 7점 대입 (E3)
- **위치:** `meetings.ts` → `extractCandidateScoreFromText` fallback (`?? 7`)
- **현상:** LLM이 [SCORE] 형식을 따르지 않고, legacy N/10 패턴도 없을 때, 기본값 7점이 사용됨. 사용자에게 "파싱 실패" 알림 없음.
- **영향도:** Medium — 부정확한 점수가 의사결정에 영향. 사용자는 7점이 실제 평가인지 기본값인지 구분 불가.
- **수정안:** 파싱 실패 시 점수 옆에 "(추정)" 표기, 또는 파싱 실패 횟수 경고 표시

### BUG-C3: 확정 후 실질적 다음 단계 자동 진행 미지원 (D5)
- **위치:** `chief-agent.ts` → `handleChiefAction` approve 분기
- **현상:** "✅ 확정" 클릭 시 '다음 단계로 진행합니다' 메시지만 출력. 실제로 리뷰→개발 전환, 체인 다음 단계 실행 등 자동 동작은 없음. 사용자가 다시 지시해야 함.
- **영향도:** Low-Medium — UX 기대 불일치. "진행합니다"라고 했는데 아무것도 안 일어남.
- **수정안:** approve 시 활성 체인 플랜이 있으면 advanceChainPlan 호출, 또는 메시지를 '확정되었습니다. 다음 작업을 지시해주세요.'로 변경

---

## 이전 핫픽스로 해결된 이슈 (확인 완료)

| 이슈 | 핫픽스 | 확인 |
|------|--------|------|
| 미팅 전 후보 선제 제시 | 1566cae: 시스템 프롬프트에 순서 규칙 추가 | ✅ |
| 'Unsupported action' 노출 | 1566cae: catch-all fallback 친화적 변경 | ✅ |
| 리뷰어 3명 미달 | 1566cae: ensureMeetingParticipants guarantee | ✅ |
| 중복 알림 | 1566cae: emittedNotificationKeys dedup | ✅ |
| 랜덤 점수 생성 | 7cc0288: fallback 완전 제거, [SCORE] 필수 | ✅ |
| sourceCandidates 없이 리뷰 시작 | 7cc0288: 사전 차단 + 안내 메시지 | ✅ |
