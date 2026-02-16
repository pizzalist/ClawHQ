# QC_MEETING_TRANSACTION_FIXLOG

## 작업 개요
남은 UX 핵심 버그 2건 수정 완료:
1. `start_meeting` 참여자 자동 구성 (부족 role 자동 생성 + 최소 2명 보장)
2. multi-action 부분 실패 시 기본 fail-fast 중단 정책 적용 (`continueOnError=false` 기본)

---

## 변경 사항

### 1) start_meeting 참여자 자동구성
- 파일: `packages/server/src/chief-agent.ts`
- 주요 수정:
  - `parseMeetingParticipantRoleCounts()` 추가
    - 입력 예시 처리: `pm`, `pm 2`, `pm 2명`, `2 pm`, `pm 2명 필요` 등
    - role alias 및 한글 숫자/아라비아 숫자 파싱 지원
  - `ensureMeetingParticipants()` 추가
    - idle 우선 + 동일 role 기존 에이전트 재사용
    - 부족 인원 자동 `createAgent(...)`
    - **최소 2명 하드 보장 로직** 추가
  - `start_meeting` 액션 실행 시 위 로직을 사용해 participantIds 구성
  - 자동 생성 발생 시 실행 결과 메시지에 생성 에이전트명 포함

### 2) multi-action fail-fast 일관성
- 파일: `packages/server/src/chief-agent.ts`
- 주요 수정:
  - `approveProposal()` 시그니처 확장
    - `options?: { continueOnError?: boolean }`
    - 기본값: `continueOnError=false` (fail-fast)
  - 중간 action 실패 시 즉시 중단
  - 응답 필드 확장:
    - `stoppedReason`
    - `skippedActions` (미실행 액션 목록)
  - Chief 피드백 메시지에
    - 중단 이유
    - 미실행 액션 목록
    명시

### 3) API 옵션 연동
- 파일: `packages/server/src/index.ts`
- 주요 수정:
  - `/api/chief/proposal/approve`에서 `continueOnError` 입력 수용
  - `approveProposal(..., { continueOnError: continueOnError === true })` 전달
  - 값 미지정 시 기본 fail-fast 유지

### 4) 회귀 테스트 추가
- 파일: `packages/server/src/chief-agent.meeting-transaction.regression.test.ts`
- 시나리오:
  1. `pm 2명 필요` 요청 → 미팅 생성 성공 + 참여자 2명 이상 + 부족 PM 자동 생성 검증
  2. 5개 action 중 2번째 실패 → 3~5번째 미실행 검증 (fail-fast)
  3. 기존 승인 흐름 회귀 확인: `continueOnError=true` 시 후속 액션 계속 실행
- 테스트 편의를 위한 helper 추가:
  - `__unsafeSetPendingProposalForTest(...)` (`packages/server/src/chief-agent.ts`)

### 5) 스크립트 추가
- 파일: `packages/server/package.json`
- `test:meeting-transaction` 추가

---

## 실행 결과

- `npm run test:meeting-transaction -w @ai-office/server` → **PASS**
- `npm run test:chief-intent -w @ai-office/server` → **PASS**
- `npm run test:ux-hotfix -w @ai-office/server` → **PASS**
- `npm run build -w @ai-office/server` → **PASS**

---

## 비고
- 기본 정책은 fail-fast로 변경되었으며, 필요 시에만 `continueOnError=true`로 옵트인 가능.
- 기존 승인 플로우(전부 승인/실행) 자체는 유지, 실패 처리 정책만 일관화됨.
