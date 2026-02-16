# QC_FINAL_STRICT_30_BUGS — 실사용 흐름 30 케이스 버그 감사

**일시:** 2026-02-16 21:17 KST  
**감사자:** Subagent (strict-e2e-user-regression-30)  
**기준:** 코드 정적 분석, 사용자 관점 판정, 애매하면 FAIL

---

## 테스트 케이스 및 결과

| # | 시나리오 | 판정 | 비고 |
|---|----------|------|------|
| C01 | 첫 접속 → Chief 콘솔 → 웰컴 메시지 표시 | ✅ PASS | 기본 뷰='chief', seed 메시지 생성됨 |
| C02 | Chief에 "팀 꾸려줘" → 팀 편성 제안 | ✅ PASS | LLM/keyword 모드 모두 처리 |
| C03 | Chief 제안 → 승인 → 에이전트 생성 | ✅ PASS | approveProposal + executeAction 정상 |
| C04 | Chief에 "상태 확인" → 즉시 응답 | ✅ PASS | classifyIntent='status' → buildMonitoringReply |
| C05 | 미팅 생성 → 참여자 자동 보강 | ✅ PASS | ensureMeetingParticipants 동작 |
| C06 | 미팅 완료 → 알림 카드 표시 | ✅ PASS | chiefHandleMeetingChange → notifyChief |
| C07 | 알림 카드 "결과 보기" → 결과 표시 | ✅ PASS | handleChiefAction view_result 처리 |
| C08 | 알림 카드 "확정" → 확정 메시지 + 다음 단계 | ✅ PASS | approve prefix 매칭 정상 |
| C09 | 알림 카드 "수정 요청" → 수정 안내 | ✅ PASS | revise- prefix 매칭 정상 |
| C10 | 태스크 생성 → 체인 플랜 생성 | ✅ PASS | suggestChainPlan 호출됨 |
| C11 | 체인 플랜 단계 편집 | ✅ PASS | editChainPlan API + 프론트 ChainPlanEditor |
| C12 | 체인 플랜 확정 → 실행 시작 | ✅ PASS | confirmChainPlan + processQueue |
| C13 | 태스크 완료 → 알림 + 체크인 | ✅ PASS | chiefHandleTaskEvent 정상 |
| C14 | 태스크 실패 → 실패 알림 + 옵션 | ✅ PASS | task_failed 분기 처리 |
| C15 | 확정 메시지 중복 여부 | ✅ PASS | 3중 dedup 적용 |
| C16 | 새로고침 → Chief 채팅 복원 | ✅ PASS | localStorage persist/load |
| C17 | WS 끊김 → 3초 후 재연결 | ✅ PASS | onclose → setTimeout(connectWS, 3000) |
| C18 | ErrorBoundary → 자동 복구 | ✅ PASS | 1초 후 재렌더 + toast |
| C19 | 사이드바 에이전트 클릭 → 상세 패널 | ✅ PASS | setSelectedAgent toggle |
| C20 | 에이전트 추가 → 모달 → 생성 | ✅ PASS | AgentModal + POST /api/agents |
| C21 | 회의실 → 회의 선택 → 상세 보기 | ✅ PASS | MeetingDetail 렌더 |
| C22 | 리뷰 미팅 → 점수표 UI 렌더 | ✅ PASS | ReviewScoringPanel (decisionPacket 기반) |
| C23 | MeetingReport markdown 렌더 | ❌ FAIL | MeetingReport는 whitespace-pre-wrap 직접 렌더, MarkdownContent 미사용 |
| C24 | ContributionCard markdown 렌더 | ❌ FAIL | 동일 — raw markdown 노출 |
| C25 | 미팅 리스트 참여자 수 정확성 | ❌ FAIL | proposals.length 표시 (active 미팅=0) |
| C26 | 후보 다양성 — 서로 다른 관점 보장 | ❌ FAIL | 다양성 메커니즘 없음 |
| C27 | 체인 autoExecute 기본 동작 | ⚠️ WARN | 기본 off → 사용자 혼란 가능하나 설계 의도 |
| C28 | 태스크 결과 모달 → Deliverable 탭 | ✅ PASS | 초안/QA/최종 탭 분리 |
| C29 | Chief 빈 메시지 방지 | ✅ PASS | pushMessage guard + handleChiefResponse guard |
| C30 | 전체 대기 작업 취소 → 즉시 응답 | ✅ PASS | cancel_all_pending SQL 실행 |

---

## 요약

- **PASS:** 25/30
- **FAIL:** 4/30 (C23, C24, C25, C26)
- **WARN:** 1/30 (C27)

---

## FAIL 상세

### BUG-F1: MeetingReport MarkdownContent 미사용 (C23)
- **재현:** 회의 완료 → 회의실 → 결과 보기 → `# 제목`, `## 섹션`, `**볼드**` 등이 raw 텍스트로 표시
- **원인:** MeetingRoom.tsx L46 `{report}` 직접 렌더
- **영향:** 회의 결과 가독성 저하
- **수정:** `<div>{report}</div>` → `<MarkdownContent text={report} />`
- **우선순위:** P2

### BUG-F2: ContributionCard MarkdownContent 미사용 (C24)
- **재현:** 개별 의견 카드에서 markdown 태그 raw 노출
- **원인:** MeetingRoom.tsx L30 `{contribution.content}` 직접 렌더
- **영향:** 에이전트 발언 가독성 저하
- **수정:** `{contribution.content}` → `<MarkdownContent text={contribution.content} />`
- **우선순위:** P2

### BUG-F3: 미팅 리스트 참여자 수 오표시 (C25)
- **재현:** 미팅 생성 직후 사이드바에서 "0명 참여" 표시
- **원인:** MeetingRoom.tsx L216 `{m.proposals.length}명 참여` — proposals = 완료된 발언 수
- **영향:** 사용자에게 아무도 참여하지 않는 것처럼 보임
- **수정:** `m.proposals.length` → `m.participants.length` (또는 `m.proposals.length}/${m.participants.length}`)
- **우선순위:** P2

### BUG-F4: 후보 다양성 미보장 (C26)
- **재현:** PM 3명 미팅 → 3개 후보가 비슷한 내용
- **원인:** 동일 role 에이전트에 차별화 프롬프트 없음
- **영향:** 리뷰 점수화의 비교 가치 저하
- **수정:** 에이전트별 persona 분화 또는 "이전 참여자와 다른 관점" 프롬프트 주입
- **우선순위:** P3 (설계 개선)
