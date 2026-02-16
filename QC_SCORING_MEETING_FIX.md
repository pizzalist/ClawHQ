# QC_SCORING_MEETING_FIX

- Date: 2026-02-16
- Scope: 리뷰 점수화 미팅이 일반론만 출력하는 문제 긴급 핫픽스
- Project: `/home/noah/.openclaw/workspace/company/ai-office/app`

## 재현 이슈
- meeting title: `사이드프로젝트 후보 점수화 및 최종 추천`
- 기존 결과: 후보별 점수표/최종 추천이 아닌 일반론 텍스트 장문

## 수정 사항

### 1) 리뷰 미팅 입력을 sourceCandidates 기반으로 강제
- `start_review` 실패 메시지를 구체화:
  - sourceCandidates 미존재 시 생성 실패 사유를 명확히 안내
  - 완료된 기획/브레인스토밍 회의에서 시작하도록 유도
- `start_meeting` 액션에서 점수화/리뷰성 직접 생성 차단:
  - `character=review` 또는 제목에 `점수화|스코어|scoring` 포함 시 차단
  - 안내 메시지: `"리뷰어 점수화 시작"` 경로 사용

### 2) 출력 포맷 구조화 강제
- `packages/server/src/meetings.ts`
  - `buildReviewScoringReport(meeting)` 추가
  - 리뷰 미팅 완료 시 일반 통합 리포트 대신 **구조화 점수 리포트** 생성
- 구조화 리포트 필수 섹션:
  - 후보별 점수표(항목/가중치/점수/총점)
  - 1순위 추천 + 이유
  - 대안 1~2 + 보류 이유
  - 사용자 의사결정 요청(확정/수정)

### 3) sourceCandidates 미존재 시 점수화 미팅 차단/안내
- 생성 단계 차단 + UX 안내 메시지 보강(Chief action path)
- 리뷰 리포트 생성 유틸에서도 방어 로직 추가

### 4) 회귀 테스트 추가
- `packages/server/src/meeting-flow.test.ts`
  - **T15**: 후보 3개 입력 시 점수표 row >= 3 검증
  - **T16**: 총점 필드/추천안 필수 검증 (`총점`, `1순위 추천`, `decisionPacket.recommendation`)

### 5) 기존 흐름/중복알림/actionId 충돌 점검
- 기존 actionId 회귀(T03~T08) 통과
- unknown action fallback 문구를 기존 회귀 기대치와 충돌 없게 조정
- meeting completion/notification 흐름 유지

## 변경 파일
- `packages/server/src/meetings.ts`
- `packages/server/src/chief-agent.ts`
- `packages/server/src/meeting-flow.test.ts`

## 테스트 결과

### 실행 커맨드
- `npm run -w @ai-office/server build`
- `npx tsx packages/server/src/meeting-flow.test.ts`

### 결과
- Build: **PASS**
- Meeting flow regression: **16 passed, 0 failed**

## 결론
핫픽스 목표(1~5) 반영 완료. 리뷰 점수화 미팅은 sourceCandidates 기반으로만 생성되며, 완료 결과는 후보별 점수표/최종 추천/대안/의사결정 요청을 포함한 구조화 포맷으로 출력됩니다.
