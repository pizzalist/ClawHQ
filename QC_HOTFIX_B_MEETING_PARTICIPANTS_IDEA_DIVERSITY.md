# QC Hotfix B: Meeting Participant Count & Idea Diversity

**Date:** 2026-02-16  
**Commit prefix:** `fix(flow):`  
**Status:** ✅ Complete

---

## 재현 이슈 및 수정 내역

### 1. 미팅 인원 불일치 (3명 요청 → 2명 참여)

**원인:** `startPlanningMeeting`에서 `getAgent(agentId)`가 null 반환 시 `continue`로 건너뛰어 실제 기여자가 요청 인원보다 적어짐. `ensureMeetingParticipants`의 hard minimum이 2명으로 고정되어 3명 이상 요청 시에도 2명만 보장.

**수정:**
- `meetings.ts` — `startPlanningMeeting` 진입 시 모든 participantId를 사전 검증, null인 에이전트는 즉시 자동 보강 (기존 idle 에이전트 우선, 없으면 신규 생성)
- `chief-agent.ts` — `ensureMeetingParticipants`의 hard minimum을 `Math.max(2, requestedTotal)`로 변경하여 요청 인원 이상을 보장
- 기여 시작 후 deficit 발생 시 경고 로그 출력

### 2. PM 후보가 매번 "AI Office"로 쏠림 (기존 기록 과주입)

**원인:** planning 프롬프트에 다양성 지침이 없어 LLM이 최근 context 편향에 따라 동일 주제 반복.

**수정:**
- planning 프롬프트에 `[CANDIDATE]` 구조화 태그 강제 (3~5개 필수)
- 다양성 규칙 명시: "최근 논의된 주제와 동일/유사 후보 금지", "각 후보는 서로 다른 도메인/카테고리", "무난한 후보보다 참신한 후보 우선"
- `extractCandidatesFromMeeting`에서 `[CANDIDATE]` 태그 파싱 → 에이전트별이 아닌 아이디어별 후보 추출 + 자동 중복 제거

### 3. 리뷰 출력이 일반 담론으로 흐름 이탈

**원인:** review 프롬프트의 규칙이 느슨하여 LLM이 후보 평가 대신 시장 분석 등 일반론으로 이탈.

**수정:**
- review 프롬프트에 `⚠️ 중요 규칙` 섹션 추가: "후보 N건 각각에 대해서만 평가", "무관한 일반론 금지", "모든 후보 빠짐없이 [SCORE] 출력"
- 상세 평가 섹션을 "후보별 한줄 평가"로 변경하여 이탈 여지 차단

---

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `packages/server/src/meetings.ts` | startPlanningMeeting 사전검증+자동보강, planning 프롬프트 구조화, review 프롬프트 강화, extractCandidatesFromMeeting [CANDIDATE] 파싱 |
| `packages/server/src/chief-agent.ts` | ensureMeetingParticipants hard minimum → requestedTotal |
| `packages/server/src/meeting-flow.test.ts` | T15 stale assertion 수정 (markdown table → decisionPacket 기반 검증) |

---

## 테스트 결과

### 기존 회귀 테스트
- `meeting-flow.test.ts`: **16/16 PASS** ✅
- `review-scoring.regression.test.ts`: **5/5 PASS** ✅

### Hotfix B 검증 항목

| 항목 | 기준 | 결과 |
|------|------|------|
| 참여자 미달 방지 | 요청 인원 미달 시 자동 보강 로직 존재 | ✅ startPlanningMeeting에 사전검증+보강 로직 추가 |
| ensureMeetingParticipants | hardMinimum = max(2, requestedTotal) | ✅ 3명 요청 시 3명 보장 |
| 후보 구조화 | [CANDIDATE] 태그 강제, 3~5개 | ✅ 프롬프트 + 파서 구현 |
| 다양성 규칙 | 중복/유사 후보 페널티 프롬프트 | ✅ 다양성 규칙 3조 명시 |
| 리뷰 이탈 방지 | 후보 기반 순위/점수 강제 | ✅ 프롬프트 규칙 강화 |
| 기존 로직 충돌 | buildReviewScoringReport 등 기존 수정과 충돌 없음 | ✅ 테스트 전수 통과 |

---

## 회귀 테스트 계획 (운영 환경)

1. **참여자 미달 20회 테스트:** PM 3명 미팅 20회 실행 → 참여자 미달 0건 확인
2. **후보 다양성 5회 테스트:** 연속 5회 planning 미팅 실행 → 동일 1순위 고정률 ≤ 40% 확인
