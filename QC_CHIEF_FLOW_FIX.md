# QC_CHIEF_FLOW_FIX — 총괄자/미팅 흐름 UX 핫픽스

**날짜:** 2026-02-16  
**커밋 prefix:** `fix(flow):`

## 재현 이슈 및 수정 내역

### 1. 빈 총괄자 버블 (사이드바 클릭 시 빈 값)
- **원인:** `pushMessage()`가 empty content 체크 없이 chief 메시지를 저장 → 프론트에서 빈 버블 렌더링
- **수정:**
  - `pushMessage()`: chief role 메시지에 content+notification 둘 다 비어있으면 drop + console.warn
  - `ChatMessage` 컴포넌트: empty chief 메시지 → `return null` (렌더 안함)
  - `store.handleChiefResponse`: empty reply + no actions → 메시지 추가 안함, thinking만 해제

### 2. 확정 후 '다음 단계' 안내 누락
- **원인:** `handleChiefAction`의 approve 분기가 고정 문자열 `"✅ 확정되었습니다."` 만 반환
- **수정:** approve 시 meeting/task 컨텍스트에 따라 동적 next-step 생성:
  - planning/brainstorm meeting → "리뷰어 점수화" 또는 "실행 작업 생성" 안내
  - review meeting → 추천안 기반 실행 작업 생성 안내  
  - task → 남은 작업 수 기반 안내
  - fallback → 일반 안내

### 3. 회의 결과/확정 카드 중복
- **원인:** `isNotificationDuplicate` dedup이 notification/checkin 각각 독립 → 같은 entity에 중복 카드 가능
- **수정:** `isEntityFullyReported()` 통합 dedup 가드 추가 (notification + checkin 모두 발행된 entity 추적)

### 4. 액션 버튼 상태 머신 정리
- **원인:** `InlineNotification` dismiss 시 일괄 "✓ 처리됨" → 사용자가 무슨 상태인지 모름
- **수정:**
  - approve → `"✅ 확정됨 — 다음 단계 안내가 아래에 표시됩니다"`
  - revise → `"🔄 수정 요청됨 — 수정 방향을 입력해주세요"`
  - request_revision reply에 가이드 문구 추가

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `packages/server/src/chief-agent.ts` | pushMessage 빈값 가드, handleChiefAction next-step 생성, dedup 강화 |
| `packages/web/src/components/ChiefConsole.tsx` | ChatMessage 빈값 가드, InlineNotification 상태 피드백 개선 |
| `packages/web/src/store.ts` | handleChiefResponse 빈 reply 가드 |
| `packages/server/src/chief-flow-fix.test.ts` | 회귀 테스트 18개 시나리오 |

## 검증 결과

- ✅ 시나리오 12개 (+ 6개 추가) → 빈 총괄자 메시지 **0건**
- ✅ 확정 클릭 후 다음 단계 안내 **100% 노출** (4개 approve 시나리오 전수 검증)
- ✅ TypeScript 컴파일 오류 0건 (server + web)
- ✅ 회귀 테스트 18/18 통과
