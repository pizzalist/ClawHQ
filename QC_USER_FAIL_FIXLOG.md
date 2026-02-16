# QC USER FAIL FIXLOG

Date: 2026-02-16
Target: 사용자 실사용 UX 핫픽스

## 1) 이슈: QA/핫픽스 이후 최종본이 원본 task에서 안 보임

### 원인
- 체인 태스크(초안/QA/수정)가 분리되어 보여도, 원본 task 상세에서는 `task.result` 위주로 노출되어 최종 산출물 연결성이 약함.
- 사용자 입장에서는 "초안/QA/최종" 단계 구분이 없어 어떤 결과가 최신/최종인지 혼란.

### 수정
- `GET /api/tasks/:id/thread-summary` 추가
  - `finalDeliverableId`
  - `latestDeliverableByThread`
  - `draftDeliverableId`, `qaDeliverableId`
  - thread 전체 deliverables 반환
- TaskResultModal에서 출력 탭 추가
  - `최종본 / QA / 초안`
  - 기본은 `finalDeliverableId` 우선
  - UI에 연결 키(`finalDeliverableId`, `latestDeliverableByThread`) 노출

### 수정 파일
- `packages/server/src/index.ts`
- `packages/web/src/components/TaskResultModal.tsx`

---

## 2) 이슈: 체인 완료 후 우측 패널에 완료 카드 잔상

### 원인
- 체인 완료 시점에 마지막 step 이후 `advanceChainPlan()`이 항상 호출되지 않아 plan status가 `running`으로 남을 수 있음.
- WS 갱신 타이밍 지연 시 클라이언트 패널에서 stale 카드 잔상 발생.

### 수정
- 서버: terminal 상태 강제 확정 로직 추가
  - 마지막 step 완료 시 `markChainCompleted()` 호출(강제 재계산)
- 클라이언트: 패널 정리 강화
  - `completed/cancelled` plan 즉시 store에서 제거
  - `tasks_update`, `chain_plan_update` 수신 시 `/api/chain-plans/active` 재조회로 강제 동기화

### 수정 파일
- `packages/server/src/chain-plan.ts`
- `packages/server/src/task-queue.ts`
- `packages/web/src/store.ts`

---

## 3) 회귀 테스트 추가

### 추가 테스트
- `packages/server/src/ux-hotfix.regression.test.ts`
  - 상태 조회 질문 시 액션 제안 생성되지 않는지
  - 완료/취소 chain plan이 active 목록에서 제외되는지

### 실행 방법
- `npm run test:ux-hotfix -w @ai-office/server`
- (기존 회귀 유지) `npm run test:chief-intent -w @ai-office/server`

---

## 검증 결과
- 빌드 및 회귀 테스트 기준으로 핫픽스 반영 확인.
- 사용자 플로우 기준:
  - 랜딩→QA→핫픽스→최종본 확인: 원본 task 상세에서 최종본 탭으로 즉시 확인 가능
  - 체인 완료 후 패널 잔상: active 재동기화 + terminal 강제 확정으로 잔상 제거
  - 상태 조회 요청: 기존 회귀(액션 제안 없음) 유지
