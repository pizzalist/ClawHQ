# QC_CHAIN_UX_FIX

작성일: 2026-02-16 (KST)

## 목적
사용자 지적 3가지(체인 분리, QC 명칭 노출, 승인 UX 불일치)를 실사용 흐름 기준으로 교정.

---

## 1) 체인 실행 구조 교정 (QA -> Dev 단일 체인)

### 변경 사항
- `packages/server/src/task-queue.ts`
  - `needsDevFollowupAfterReview()` 추가
    - 리뷰/QA 의도 + 개발 반영/수정 의도를 함께 감지.
  - `decideNextRoleByIntent()` 확장
    - `pm` 단계에서 QA->Dev 의도 감지 시 **첫 단계를 qa로 강제**.
    - `qa`/`reviewer` 단계에서 해당 의도면 **developer로 연쇄**.
    - QA->Dev 교정 플로우는 developer 단계에서 기본 종료(추가 reviewer 루프 방지).
- `packages/server/src/chief-agent.ts`
  - 승인 실행 전 `normalizeChainedTaskActions()` 추가
    - LLM이 QA task + Dev task를 분리 제안해도 승인 시 1개 루트 체인으로 정규화.
  - `executeAction(create_task)`에서 QA->Dev 의도 감지 시 기본 assignee를 `qa`로 설정.

### 기대 효과
- "QA 리뷰 후 개발자 수정" 의도에서 분리된 독립 task 병렬 생성 대신,
  **단일 루트 task 아래 QA step -> Developer step 자동 연쇄**.

---

## 2) 테스트 에이전트/이름 노출 금지

### 변경 사항
- `packages/server/src/agent-manager.ts`
  - 친화적 기본 이름 정책 추가:
    - PM-01, DEV-01, QA-01, REV-01, DES-01, OPS-01
  - `suggestFriendlyAgentName()` 추가 (역할별 번호 자동 증가)
  - `normalizeAgentName()` 추가
    - 실사용(`isTest !== true`)에서 `*_QC`, `PM-QC`, `DEV-QC`, `TEST`, `DEBUG` 패턴 이름 입력 시
      자동으로 친화적 이름으로 치환.
  - `createAgent()` 정책 변경
    - 테스트 표시는 **오직 `isTest=true`일 때만** DB 마킹.
- `packages/shared/src/constants.ts`
  - `FRIENDLY_AGENT_PREFIX` 상수 추가(명명 정책 명시).
- `packages/server/src/chief-agent.ts`
  - `create_agent` 액션 기본 이름 생성 시 timestamp 대신 `suggestFriendlyAgentName()` 사용.

### 기대 효과
- 실사용 UX에서 QC/테스트 명칭 노출 방지.
- 테스트 전용은 내부 플래그 기반으로만 허용.

---

## 3) 승인 UX 정리 ("네, 실행" 즉시 피드백 + 자동 진행 안내)

### 변경 사항
- `packages/server/src/chief-agent.ts`
  - 텍스트 승인 인식 강화: `네, 실행` 포함.
  - 승인 시 즉시 메시지:
    - 승인됨
    - 실행 시작
    - step별 완료/실패
    - QA->Dev 체인의 경우 "다음 단계 자동 진행" 안내
  - `chain_spawned` 이벤트 수신 시 check-in 생성:
    - 현재 단계 완료 및 다음 단계 자동 시작을 사용자에게 즉시 알림.
- `packages/web/src/store.ts`
  - 승인 후 클라이언트 로컬로 중복 생성하던 피드백 메시지 제거.
  - 서버 단일 소스 메시지 기준으로 일관된 UX 유지.

### 기대 효과
- 사용자가 "네, 실행" 후 추가 지시 없이도 체인 진행 신뢰 확보.
- 메시지 중복/엇갈림 감소로 피드백 일관성 개선.

---

## 4) 회귀 테스트 보정 (실사용 흐름 기준)

### 변경 파일
- `packages/server/src/regression-qc.ts`
  - R13~R20 추가 (8개)
  - 필수 문장 포함:
    - "QC 한명 붙여 리뷰하고 개발자가 반영해서 재수정해"
- `packages/server/src/task-queue.chain.test.ts`
  - QA->Dev 체인 3개 케이스 추가
- `packages/server/src/qc-suite.ts`
  - C33 추가 (실사용 체인 케이스)

### 통과 기준 반영
- QA->Dev 의도에서 단일 체인 역할 전이:
  - PM -> QA
  - QA -> Developer
  - Developer -> End
- 자동 진행/피드백 문구 일관성 확인.

---

## 검증 실행 로그

### 1) 빌드
- 명령: `npm run build`
- 결과: 성공

### 2) 체인 정책 테스트
- 명령: `npx tsx src/task-queue.chain.test.ts`
- 결과: `✅ chain policy regression passed: 10 assertions`

### 3) 회귀 테스트
- 명령: `npx tsx src/regression-qc.ts`
- 결과: `20 passed, 0 failed`

### 4) QC 스위트
- 명령: `npx tsx src/qc-suite.ts`
- 결과: FAIL 없음
- 포함 확인: `C33 | 실사용 체인 | QC 한명 붙여 리뷰하고 개발자가 반영해서 재수정해 | PASS | pm→qa, dev→end`

---

## 최종 상태 요약
- [x] QA->Dev 의도 시 단일 체인 연쇄 실행
- [x] 실사용 QC/테스트 명칭 자동 노출 차단
- [x] "네, 실행" 승인 UX 즉시/단계별/자동진행 안내 정리
- [x] 실사용 기준 회귀 케이스(최소 8개) 추가 및 통과
