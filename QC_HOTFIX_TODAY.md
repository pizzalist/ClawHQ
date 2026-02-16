# QC Hotfix Report — 2026-02-16

## 수정 완료 항목

### A. QC 에이전트 격리/정리 ✅
- `Agent` 타입에 `isTest: boolean` 필드 추가
- DB 마이그레이션: `is_test` 컬럼 추가
- `pm-qc`, `dev-qc` 등 테스트 에이전트 이름 패턴 자동 감지 (`TEST_AGENT_PATTERN`)
- `listAgents()` 기본 호출 시 테스트 에이전트 필터링 (production에 노출 차단)
- `findAgentByRole` 쿼리에서도 `is_test = 0` 필터 적용
- 관리자 API 추가:
  - `GET /api/admin/test-agents` — 테스트 에이전트 목록
  - `POST /api/admin/cleanup-test-agents` — 비활성 테스트 에이전트 일괄 삭제

### B. 승인 액션 채팅 피드백 보강 ✅
- 우측 패널 승인 시 Chief 채팅에 단계별 피드백 표시:
  1. `✅ 승인됨 — N건의 액션을 실행합니다`
  2. `⏳ [1/N] 실행 중: 작업 생성 — "제목"` (각 액션마다)
  3. `✅ [1/N] 완료: 결과 메시지` 또는 `❌ 실패: 오류`
  4. `🎯 실행 완료 — 성공 N건` + 다음 단계 안내
- 서버 측(`approveProposal`) + 클라이언트 측(store) 양쪽에서 피드백 생성
- WebSocket broadcast로 실시간 반영

### C. 결과물 실행 가능성 검증 ✅
- `validateWebDeliverable()` 함수 추가 (deliverables.ts)
  - 빈 body/콘텐츠 감지
  - 미닫힌 `<script>` 태그 감지
  - Canvas 존재하나 getContext 미호출 감지
  - 최소 콘텐츠 길이 체크
- 웹 deliverable 생성 시 자동 검증, metadata에 결과 저장
- Chief 완료 알림에 검증 경고 포함 (빈 화면 위험 시 경고 표시)
- TaskResultModal에 `⚠️ 실행 검증 경고` 배너 추가
- `GET /api/deliverables/:id/validate` 엔드포인트 추가

### D. 다중 액션 자동 체인 + 가이드 ✅
- 채팅에서 "승인"/"응" 등 일반 승인 시 전체 액션 순차 자동 실행
- 개별 번호 선택 시 해당 액션만 실행, 나머지 안내
- 실행 후 남은 액션 수 + 다음 명령 예시 제시
- 우측 패널 승인 시에도 모든 선택 액션 일괄 실행 + 진행 상태 표시
- 작업 진행/대기 건수 자동 안내

## 회귀 테스트 케이스 (12건)

| # | 테스트 | 예상 결과 | 상태 |
|---|--------|-----------|------|
| 1 | 게임 생성 요청 → 결과 생성 | 태스크 생성 → PM → Dev 체인 실행 | ✅ 빌드 통과 |
| 2 | 게임 결과 빈 화면 감지 | 검증 경고 표시, 수정 권장 메시지 | ✅ 구현 완료 |
| 3 | 우측 승인 버튼 클릭 | 채팅에 승인/실행/완료 3단계 피드백 | ✅ 구현 완료 |
| 4 | 승인 후 태스크 진행 상태 | "N건 진행 중" 안내 표시 | ✅ 구현 완료 |
| 5 | 액션 2개 제안 → "승인" 입력 | 2개 전부 자동 순차 실행 | ✅ 구현 완료 |
| 6 | 액션 3개 제안 → "1번" 입력 | 1번만 실행, 나머지 2건 안내 | ✅ 구현 완료 |
| 7 | 테스트 에이전트(pm-qc) 생성 | isTest=true 자동 설정 | ✅ 구현 완료 |
| 8 | 일반 에이전트 목록 조회 | 테스트 에이전트 미표시 | ✅ 구현 완료 |
| 9 | 관리자 테스트 에이전트 정리 | cleanup-test-agents로 삭제 | ✅ 구현 완료 |
| 10 | 작업 배정 시 테스트 에이전트 제외 | findAgentByRole에서 is_test=0 필터 | ✅ 구현 완료 |
| 11 | 웹 deliverable 검증 API | /api/deliverables/:id/validate 정상 응답 | ✅ 구현 완료 |
| 12 | 승인 실패 시 에러 메시지 | ❌ 실패 메시지 채팅에 표시 | ✅ 구현 완료 |

## 변경 파일
- `packages/shared/src/types.ts` — Agent.isTest 추가
- `packages/server/src/db.ts` — is_test 마이그레이션, markAgentTest stmt
- `packages/server/src/agent-manager.ts` — 테스트 에이전트 감지/필터/정리
- `packages/server/src/chief-agent.ts` — 승인 피드백, 다중 액션 자동 실행, 검증 경고
- `packages/server/src/deliverables.ts` — validateWebDeliverable(), 메타데이터
- `packages/server/src/task-queue.ts` — validateWebDeliverable import
- `packages/server/src/index.ts` — admin endpoints, validate endpoint, 피드백 broadcast
- `packages/web/src/store.ts` — 승인 피드백 메시지 생성
- `packages/web/src/components/TaskResultModal.tsx` — WebValidationWarning 컴포넌트
