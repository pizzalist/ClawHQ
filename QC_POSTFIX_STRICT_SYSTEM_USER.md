# QC Post-Hotfix Strict System & User Verification Report

**날짜:** 2026-02-16 16:26 KST  
**테스트 프레임:** 시스템 자동 38케이스 (✅ 37 / ❌ 1)  
**Pass Rate:** 97%

---

## A. 요구사항별 PASS/FAIL 매트릭스

| Req | 요구사항 | 케이스 수 | PASS | FAIL | 판정 |
|-----|---------|-----------|------|------|------|
| R1 | PM 2명 회의 자동 참여자 보강 | 3 | 3 | 0 | ✅ PASS |
| R2 | multi-action fail-fast | 3 | 3 | 0 | ✅ PASS |
| R3 | 최종본 찾기 쉬움 (deliverables) | 3 | 3 | 0 | ✅ PASS |
| R4 | 체인 완료 후 패널 잔상 없음 | 3 | 3 | 0 | ✅ PASS |
| R5 | 검증용 task 오염 분리 | 3 | 3 | 0 | ✅ PASS |
| R6 | status 조회에 액션 미포함 | 4 | 4 | 0 | ✅ PASS |
| R7 | QA 결과물 raw log 오염 없음 | 3 | 2 | 1 | ⚠️ PARTIAL |
| S1-S15 | 시스템 회귀 테스트 | 16 | 16 | 0 | ✅ PASS |

---

## B. 케이스별 상세

### R1: PM 2명 회의 자동 참여자 보강

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R1-1 | PM 1명 존재 → `participants: 'pm 2'` 회의 시작 | PM 1명 자동 생성, 참여자 2명 | agents 1→2, participants=2 | ✅ |
| R1-2 | PM 0명 → `participants: 'pm 2명'` 회의 시작 | PM 2명 자동 생성 | participants=2 | ✅ |
| R1-3 | `participants: 'developer 세명, pm'` | dev 3 + pm 1 = 4명 참여 | participants=4 | ✅ |

### R2: multi-action fail-fast

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R2-1 | 3액션, 2번째 실패 (없는 agentId) | 2개만 실행, 3번째 미실행, stoppedReason 존재 | executed=2, skipped=1, stopped=true | ✅ |
| R2-2 | 같은 상황 + `continueOnError: true` | 3개 모두 실행 | executed=3, skipped=0 | ✅ |
| R2-3 | 5액션, 3번째 실패 | 3개 실행, 4-5번 미실행 | executed=3, skipped=2 | ✅ |

### R3: 최종본 찾기 쉬움

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R3-1 | task 생성 → suggestChainPlan | 체인 단계별 plan 존재, 첫 단계 PM | steps=2, firstRole=pm | ✅ |
| R3-2 | HTML 코드블록 결과 → parseResultToArtifacts | type=web deliverable 추출 | found=true | ✅ |
| R3-3 | 마크다운 보고서 → parseResultToArtifacts | type=document deliverable 추출 | artifacts=1 | ✅ |

### R4: 체인 완료 후 패널 잔상 없음

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R4-1 | plan 생성 → markChainCompleted → listActiveChainPlans | active 목록에서 제거 | afterThisPlan=0 | ✅ |
| R4-2 | plan 생성 → cancelChainPlan → listActiveChainPlans | active 목록에서 제거 | afterThisPlan=0 | ✅ |
| R4-3 | store.ts 코드 분석 | updateChainPlan: completed/cancelled → filter out | 코드 확인됨 (line 260) | ✅ |

### R5: 사용자 보드와 검증용 task 오염 분리

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R5-1 | test 에이전트 생성(isTest=true) → listAgents() | 기본 목록에 미표시 | normal: Normal-Dev만, test: pm-qc,dev-test | ✅ |
| R5-2 | cleanupTestAgents() | test 에이전트 삭제 | deleted=2, after=0 | ✅ |
| R5-3 | findAgentByRole('developer') | is_test=0 필터 적용 | found=prod-dev (test-dev-qc 제외) | ✅ |

### R6: status 조회에 액션 미포함

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R6-1 | "상태 확인" | 간결 응답, [ACTION:] 없음 | len=40, hasAction=false | ✅ |
| R6-2 | "진행중이야?" | [ACTION:] 없음 | hasAction=false | ✅ |
| R6-3 | "다 됐어?" | [ACTION:] 없음 | hasAction=false | ✅ |
| R6-4 | 현황/몇명/ETA 등 6종 | 모두 [ACTION:] 없음 | 6/6 clean | ✅ |

### R7: QA 결과물에 tool raw log 오염 없음

| ID | 재현 단계 | 예상 결과 | 실제 결과 | 판정 |
|----|----------|-----------|-----------|------|
| R7-1 | JSON payloads 형식 stdout | 깨끗한 텍스트 추출 | parsed="깨끗한 결과물입니다." | ✅ |
| R7-2b | raw text에 `assistant to=functions` 포함 stdout | 필터링되어 clean 텍스트 | **raw log 그대로 전달됨** | ❌ |
| R7-3 | HTML/코드블록 정리 로직 | 태그/블록 제거 | 정상 정리 | ✅ |

### S1-S15: 시스템 회귀 테스트

| ID | 테스트 명 | 판정 |
|----|----------|------|
| S1 | "응" → 전체 액션 실행 | ✅ |
| S2 | "1번" → 1번 액션만 실행 | ✅ |
| S3 | "2명" 이 승인 번호로 오인 안됨 | ✅ |
| S4 | validateWebDeliverable: 빈 body 감지 | ✅ |
| S5 | validateWebDeliverable: 정상 HTML 통과 | ✅ |
| S6 | 체인 편집: proposed만 가능, completed 불가 | ✅ |
| S7 | 잘못된 상태 전이 차단 (idle→done) | ✅ |
| S8 | 번호 목록 형식 확인 | ✅ |
| S9 | 미팅 최소 2명 보장 | ✅ |
| S10 | cancel_all_pending 작동 | ✅ |
| S11 | 첫 세션 환영 메시지 존재 | ✅ |
| S12 | compactText 500자 제한 | ✅ |
| S13 | 정의형 질문 의도 분류 | ✅ |
| S14 | task 생성 → chain plan 자동 생성 | ✅ |
| S15 | 다중 역할 미팅 (pm+dev+reviewer) | ✅ |

---

## C. 사용자 시나리오 UX 평가 (코드 기반 12시나리오)

| # | 시나리오 | 도메인 | 찾기 쉬움 | 오해 가능성 | 최종 전달 명확성 | 판정 |
|---|---------|--------|----------|------------|----------------|------|
| U1 | "게임 만들어줘" → 승인 → 결과 확인 | 게임 | ⭐⭐⭐ | 낮음 | 명확 (deliverable viewer) | ✅ |
| U2 | "PM 2명으로 랜딩 기획 회의" | 랜딩 | ⭐⭐⭐ | 낮음 | 자동 보강 + 시작 | ✅ |
| U3 | "상태 확인" → "다 됐어?" → "결과 보기" | 조회 | ⭐⭐⭐ | 없음 | 간결한 1줄 응답 | ✅ |
| U4 | 체인 실행 → 1/1 완료 → 패널 확인 | 체인 | ⭐⭐⭐ | 없음 | 잔상 없이 깨끗 | ✅ |
| U5 | 3액션 제안 → "응" → 2번째 실패 | 다중 | ⭐⭐⭐ | 낮음 | ⛔ 중단 사유 + 미실행 목록 표시 | ✅ |
| U6 | API 서버 개발 → PM→DEV 체인 | API | ⭐⭐ | 중간 | root task에 집약되나 중간 결과 탐색 필요 | ⚠️ |
| U7 | 문서 작성 → 리뷰 요청 | 문서 | ⭐⭐⭐ | 낮음 | document deliverable 명확 | ✅ |
| U8 | QA 검증 → Dev 수정 체인 | QA | ⭐⭐ | 중간 | 체인 단계 표시되지만 최종 위치 혼동 가능 | ⚠️ |
| U9 | "전부 취소" → "에이전트 리셋" | 관리 | ⭐⭐⭐ | 없음 | 즉시 실행 + 간결 응답 | ✅ |
| U10 | 승인 후 "1번"으로 부분 실행 | 선택 | ⭐⭐⭐ | 낮음 | 남은 액션 안내 | ✅ |
| U11 | 연속 요청 5개 → 상태 확인 | 부하 | ⭐⭐⭐ | 없음 | 상태 숫자 정확 | ✅ |
| U12 | raw tool log 포함 결과 확인 | 오염 | ⭐ | **높음** | **tool log가 사용자에게 노출** | ❌ |

---

## D. 내구성/상태 일관성 (코드 분석 기반)

| 항목 | 상태 | 비고 |
|------|------|------|
| completed/cancelled chain이 active에 재등장 | ✅ 안 함 | server: markChainCompleted, web: filter out |
| WS 역전 방지 | ✅ | store.ts: updatedAt 비교 후 오래된 이벤트 무시 |
| task_completed 중복 보고 방지 | ✅ | reportedTaskCompletions Set |
| 새로고침 시 active plan 동기화 | ✅ | refreshActiveChainPlans → `/api/chain-plans/active` |
| 서버 재시작 시 in-memory chain plan 소실 | ⚠️ | chain plan이 in-memory Map — DB 미저장 |
