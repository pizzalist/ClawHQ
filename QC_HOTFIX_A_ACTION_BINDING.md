# QC_HOTFIX_A_ACTION_BINDING

## 범위
긴급 핫픽스 A 대응:
1) `create_task -> assign_task` 체인에서 placeholder taskId로 인한 `task not found` 차단
2) 확정/승인 액션 중복 실행(idempotency)
3) UI/서버 중복 확정 메시지 제거 및 확정 액션 진입점 단일화

---

## 수정 사항

### 1) create_task → assign_task 실제 taskId 바인딩 보장
**파일:** `packages/server/src/chief-agent.ts`

- 추가: placeholder 감지 정규식
  - `(생성된 taskId)`, `taskId`, `{taskId}`, `<taskId>`, `new task` 등
- 추가: `bindActionWithRuntimeContext(...)`
  - 승인 실행 루프에서 `create_task` 성공 시 생성된 `result.id`를 `lastCreatedTaskId`로 저장
  - 후속 `assign_task`/`cancel_task`가 placeholder taskId를 가지면 자동으로 실제 id 바인딩
- 방어 로직 추가:
  - `assign_task` 실행 시 placeholder가 그대로 남아있으면 즉시 실패 (`placeholder는 실행 불가`) 처리

효과:
- 승인 체인 내 placeholder taskId가 DB 조회로 직접 들어가 `작업을 찾을 수 없습니다`를 내던 경로 차단

---

### 2) 승인/확정 idempotency 키 도입
**파일:** `packages/server/src/chief-agent.ts`

- 추가 상태:
  - `handledInlineActionKeys`
  - `handledCheckInResponseKeys`
- 키 생성:
  - inline action: `notificationId::actionId`
  - check-in: `checkInId::optionId`
- 중복 클릭 시 처리:
  - `handleChiefAction(...)`에서 동일 키 재요청 시 `이미 처리된 요청입니다. (중복 클릭 방지)` 반환
  - `respondToCheckIn(...)`에서 동일 키 재요청 시 `이미 처리된 응답입니다. (중복 클릭 방지)` 반환

효과:
- 동일 알림/동일 버튼 2회 클릭 시 1회만 유효 처리

---

### 3) 확정 액션 단일 진입점 정리 + 중복 메시지 제거

#### 3-1. 서버 측 체크인 액션 정리
**파일:** `packages/server/src/chief-agent.ts`

- `task_completed` 이후 completion/progress check-in에서 확정/수정 옵션 버튼 제거
- completion check-in은 **정보성 안내만** 남김:
  - 확정/수정은 완료 알림 카드(notification) 버튼으로 진행 안내

#### 3-2. 프론트 중복 메시지 제거
**파일:** `packages/web/src/store.ts`

- `handleChiefInlineAction`에서 `/api/chief/action` 호출 후
  - 로컬로 chief reply 메시지를 직접 append하던 코드 제거
  - 서버 WS(`chief_response`)만 단일 소스로 반영

효과:
- `확정되었습니다` 메시지 2회 출력 현상 제거
- 확정 액션 경로가 notification 버튼 중심으로 단일화

---

## 회귀 테스트

### 추가 테스트 스크립트
**파일:** `packages/server/src/hotfix-action-binding.regression.test.ts`

검증 항목:
1. `create_task + assign_task(placeholder)` 연속 20회
   - 기대: `task not found` 0건
2. 동일 확정 액션 2회 클릭
   - 기대: 1회만 정상 처리, 2회차는 idempotency 차단

### 실행 결과
```bash
$ npx tsx packages/server/src/hotfix-action-binding.regression.test.ts

🧪 Hotfix A regression tests
  ✅ create+assign 20회: task not found 0건
  ✅ 동일 확정 2회 클릭: 1회만 반영
🎉 Hotfix A regression tests passed
```

---

## 참고
- `packages/server/src/chief-flow-fix.test.ts`는 `vitest` 의존성이 현재 환경에 없어 직접 실행 불가(환경 이슈)
- 본 핫픽스 검증은 독립 `tsx` 회귀 스크립트로 통과 확인

---

## 커밋 권장 메시지
`fix(flow): bind create->assign taskId and dedupe confirm action/reply`
