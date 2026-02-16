# QC_CHAIN_UX_FIX

작성일: 2026-02-16 (KST)
업데이트: 요구사항 변경 반영 ("강제 QA->Dev" → "상황별 최적 체인 제안 + 사용자 확정")

## 변경 배경
기존 교정은 QA->Dev 체인을 강하게 우선하는 방향이었으나,
요구사항 변경에 따라 **고정 체인 강제**를 제거하고,
**요청 의도/산출물/복잡도 기반 동적 추천 + 사용자 편집 후 확정 실행**으로 전환.

---

## 1) 체인 추천 엔진: 동적 제안으로 변경

### 반영 내용
- `packages/server/src/task-queue.ts`
  - `estimateTaskComplexity()` 추가
    - 의도 텍스트 + 산출물 타입(web/code/api/report 등) + 키워드 기반으로 `low/medium/high` 추정
  - `decideNextRoleByIntent()` 재조정
    - 더 이상 QA->Dev를 전역 강제하지 않음
    - 케이스별 동적 전이:
      - PM->Developer (구현 중심)
      - PM->Reviewer (리포트/검토 중심)
      - Developer 단독 종료
      - QA->Developer (검증 후 반영 의도)
      - 고복잡도는 PM->Developer 우선 후 리뷰/QA로 유도
- `packages/server/src/chief-agent.ts`
  - `recommendStartRoleFromIntent()` 추가
    - create_task 승인 시 초기 담당 역할을 의도 기반으로 선택
    - 예: 구현 단독은 Developer 시작, 리포트 검토는 Reviewer 시작, 일반 복합은 PM 시작

### 요약
고정된 "QA 먼저"가 아니라,
요청 성격에 맞는 체인 패턴을 추천.

---

## 2) 실행 전 사용자 편집 가능

### 반영 내용
- 체인 플랜 기반 편집 UX 유지/강화
  - `packages/web/src/components/ChainPlanEditor.tsx`
    - 단계 추가
    - 단계 삭제
    - 단계 순서 변경(↑/↓)
    - 단계 역할/이유 수정
- `packages/server/src/chain-plan.ts`
  - `editChainPlan()`으로 proposed 상태에서 단계 수정 허용

### 요약
사용자는 실행 전에 추천 체인을 직접 편집 가능.

---

## 3) 승인 시 최종 확정 체인으로 실행

### 반영 내용
- `packages/server/src/chief-agent.ts`
  - 기존의 `normalizeChainedTaskActions()` 강제 정규화 제거
  - 사용자 승인 시 선택된(또는 override된) 액션 그대로 실행
- `packages/server/src/index.ts`
  - `/api/chief/proposal/approve`에서 `overrideActions` 수용
- `packages/web/src/store.ts`
  - `approveProposal(messageId, selectedIndices, overrideActions)` 확장
  - UI에서 편집된 액션/체인을 서버로 확정 전달 가능

### 요약
시스템이 임의로 체인을 강제 수정하지 않고,
사용자가 최종 확정한 체인 기준으로 실행.

---

## 4) 체인 미리보기 UI + 단계 이유 설명

### 반영 내용
- `packages/web/src/components/ChainPlanEditor.tsx`
  - 단계별 reason 표기 (`왜 이 단계가 필요한지`)
  - 편집 화면에서 reason 직접 수정 가능
- `packages/server/src/chain-plan.ts`
  - `STEP_REASONS` 기반 기본 이유 자동 생성

### 요약
각 단계가 필요한 이유를 사용자에게 명시적으로 설명.

---

## 5) 자동 실행 여부 사용자 토글

### 반영 내용
- `packages/web/src/components/ChainPlanEditor.tsx`
  - `자동 실행` 체크박스 제공
- `packages/server/src/chain-plan.ts`
  - `setChainAutoExecute()`로 서버 상태 반영
  - autoExecute=false면 단계 완료 후 다음 단계 대기(사용자 확인 필요)
  - autoExecute=true면 다음 단계 자동 진행

### 요약
연쇄 실행 자동/수동 여부를 사용자가 선택.

---

## 기존 요구사항(테스트 명칭 노출 금지) 유지

### 유지 사항
- `packages/server/src/agent-manager.ts`
  - 실사용 이름에서 `*_QC`, `PM-QC`, `DEV-QC`, `TEST/DEBUG` 노출 차단
  - 친화 기본명(`QA-01`, `DEV-03` 등) 정책 유지
  - 테스트 전용 표시는 `isTest=true`일 때만 허용

---

## 검증 포인트

### 핵심 시나리오
필수 문장:
- "QC 한명 붙여 리뷰하고 개발자가 반영해서 재수정해"

검증 기준:
1. 고정 강제 체인 아님 (상황별 제안)
2. 체인 편집 가능(추가/삭제/순서변경)
3. 단계 이유 노출
4. 자동 실행 토글 동작
5. 최종 확정 체인으로 실행

### 실행 로그(최근)
- `npm run build` ✅
- `npx tsx src/task-queue.chain.test.ts` ✅
- `npx tsx src/regression-qc.ts` ✅
- `npx tsx src/qc-suite.ts` ✅

---

## 최종 상태 요약
- [x] 강제 QA->Dev 제거
- [x] 동적 체인 추천 엔진 반영
- [x] 실행 전 체인 편집(추가/삭제/순서변경) 가능
- [x] 단계 이유 표시
- [x] 자동 실행 토글 지원
- [x] 승인 시 사용자 확정 체인으로 실행
- [x] 테스트 명칭 노출 금지 정책 유지
