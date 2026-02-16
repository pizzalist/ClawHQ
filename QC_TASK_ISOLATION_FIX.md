# QC Task Isolation Fix

## 목적
핫픽스/QC/테스트성 task가 실사용 보드(Task/Chief/대시보드)에 섞이는 문제를 운영 분리 정책으로 해결.

## 적용 내용

### 1) 테스트성 task 생성 경로 `isTest=true` 강제
- `packages/server/src/task-queue.ts`
  - `Task` hydrate 시 `isTest` 매핑 추가
  - `createTask(..., opts?: { isTest?: boolean })`로 확장
  - QC/QA/테스트/자동검증/내부핫픽스 키워드 기반 `shouldForceTestTask()` 도입
  - `opts.isTest === true` 또는 키워드 매칭 시 DB `is_test=1` 저장
  - 체인 후속 task 생성 시 source task의 `isTest`를 상속

### 2) 기본 API/상태에서 `isTest` 제외 (기본값)
- `packages/server/src/db.ts`
  - `tasks` 테이블 `is_test INTEGER NOT NULL DEFAULT 0` 마이그레이션 추가
  - 기본 조회/큐/통계 SQL에서 `is_test=0` 필터 적용
    - `listTasks`, `pendingTasks`, `activeTasks`, `taskCounts`, `avgCompletionTime`, `perAgentStats`, `failedTasks`
- `packages/server/src/task-queue.ts`
  - `listTasks(includeTest = false)`로 확장
- `packages/server/src/index.ts`
  - `/api/tasks` 기본은 테스트 task 제외
  - `includeTest=true`는 `admin=1|true` 또는 `debug=1|true`일 때만 허용
  - `/api/tasks/:id` 응답에 `isTest` 포함

### 3) 웹 UI 기본 비노출
- `packages/web/src/store.ts`
  - `filterVisibleTasks()` 추가 (`!task.isTest`)
  - init/setTasks/chief 승인결과 반영 시 테스트 task 제거

### 4) 기존 혼재 테스트 task 정리 스크립트/명령
- `scripts/cleanup-test-tasks.mjs`
  - 테스트 키워드/테스트 에이전트/`is_test=1` 기준으로 정리 대상 탐지
  - `--dry-run` 지원
  - deliverables/events/task 연쇄 삭제
- `package.json`
  - `ops:cleanup-test-tasks` 명령 추가
- `packages/server/src/index.ts`
  - `/api/admin/cleanup-test-tasks` 관리 엔드포인트 추가

### 5) 회귀 테스트
- `packages/server/src/task-isolation.regression.test.ts`
  - 실사용 task 기본 목록 노출 검증
  - 테스트 task 기본 목록 비노출 검증
  - `listTasks(true)` (includeTest 대응)에서 테스트 task 노출 검증
- `packages/server/package.json`
  - `test:task-isolation` 추가

## 실행 결과
- `npm run build` ✅
- `npm run test:task-isolation -w @ai-office/server` ✅ PASS
- `node scripts/cleanup-test-tasks.mjs --dry-run` → `matched: 2`
- `node scripts/cleanup-test-tasks.mjs` → `cleaned: 2`

## 운영 가이드
- 기본 조회(실보드): `/api/tasks`
- 테스트 포함 조회(관리자/디버그 전용): `/api/tasks?includeTest=true&admin=true`
- 기존 테스트 task 정리: `npm run ops:cleanup-test-tasks`
