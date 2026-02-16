# QC_CHAIN_PANEL_HOTFIX

- 시각: 2026-02-16 16:xx (KST)
- 범위: 체인 플랜 우측 패널 스테일/상태 오표시 재핫픽스

## 1) 원인 분석

1. **WS 이벤트 순서 역전(stale update) 취약**
   - `chain_plan_update`가 out-of-order로 도착할 때, 클라이언트가 오래된 `running` 상태를 다시 반영할 수 있었음.
   - 결과적으로 이미 완료/정리된 플랜이 우측 패널에 재등장.

2. **서버 상태 확정 타이밍의 방어 부족**
   - 마지막 step 완료 시점에 plan terminal 상태를 강제 확정하는 방어 코드가 일부 경로에서만 동작.
   - 특정 타이밍에서 `running` 잔존 가능.

3. **UI 라벨/현재 step 표시 정확성 문제**
   - StepRow의 `현재` 표시가 `index <= 0` 고정 로직으로 잘못 표시될 수 있었음.
   - 진행률 100%인데도 상태 라벨이 `실행 중`으로 보이는 UX 혼선 가능.

---

## 2) 수정 사항

### A. 서버 단일 소스 정합성 강화

- 파일: `packages/server/src/task-queue.ts`
- 변경:
  - task 완료 처리 시, 해당 root chain plan이 **마지막 step 인덱스 도달 상태**면 즉시 `markChainCompleted` 강제.
  - 목적: step 100% 완료 시 plan 상태를 즉시 terminal(`completed`)로 확정.

### B. 클라이언트 stale 제거 (server state 우선)

- 파일: `packages/shared/src/types.ts`
  - `ChainPlan.updatedAt` 필드 추가.

- 파일: `packages/server/src/chain-plan.ts`
  - `updatedAt` 필드 도입.
  - 모든 plan 변경 emit 시 `updatedAt` 갱신(`touch`)하도록 통일.

- 파일: `packages/web/src/store.ts`
  - `updateChainPlan`에서 기존 plan과 비교해 **오래된(updatedAt 과거) WS 이벤트는 무시**.
  - optimistic/local 상태보다 server 최신 상태가 우선되도록 보강.

### C. UI 라벨/표시 정확성

- 파일: `packages/web/src/components/ChainPlanEditor.tsx`
  - 상태 표시용 `effectiveStatus` 도입:
    - `running/confirmed` + 모든 step 구간 도달 시 라벨을 `completed` 스타일로 표시 (실행중 배지 오표시 방지).
  - StepRow 현재 표시 로직 수정:
    - 기존 `index <= 0` → `idx === plan.currentStep` 기반으로 정확화.

### D. 회귀 테스트 추가

- 파일: `packages/server/src/ux-hotfix.regression.test.ts`
  - 신규 R3 추가:
    - **1/1 단일 step 플랜 완료 시 status=completed 확인 + active 목록 비노출 확인**.

---

## 3) 검증 결과

### 자동 검증

1. `npm run test:ux-hotfix -w @ai-office/server` ✅
   - 결과: `UX hotfix regression passed (status-query + chain-panel cleanup + 1/1 hidden)`

2. 빌드 검증
   - `npm run build -w @ai-office/shared` ✅
   - `npm run build -w @ai-office/server` ✅
   - `npm run build -w @ai-office/web` ✅

### 수동/시나리오 검증 기준

- 필수 시나리오:
  1) 체인 3개 생성 → 완료 후 우측 패널 0개
  2) 새로고침 후에도 재등장 없음
- 본 핫픽스는 해당 이슈의 핵심 원인(상태 확정 + WS stale 반영)을 차단하도록 반영됨.

---

## 4) 변경 파일 목록

- `packages/shared/src/types.ts`
- `packages/server/src/chain-plan.ts`
- `packages/server/src/task-queue.ts`
- `packages/server/src/ux-hotfix.regression.test.ts`
- `packages/web/src/store.ts`
- `packages/web/src/components/ChainPlanEditor.tsx`
- `QC_CHAIN_PANEL_HOTFIX.md`

---

## 5) 커밋 메시지

- `fix(ux): chain panel stale status resolution with server-first sync`
