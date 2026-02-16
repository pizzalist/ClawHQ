# QC Post-Hotfix 남은 버그 목록

## Critical / High

| # | 버그 | 심각도 | 재현율 | 사용자 영향 | 파일 |
|---|------|--------|--------|------------|------|
| B1 | `parseAgentOutput` raw text fallback에서 `assistant to=functions` 등 tool log가 필터링되지 않음 | **HIGH** | 100% (raw text 경로 진입 시) | QA/Dev 결과물에 tool 내부 로그가 사용자에게 그대로 노출. 사용자가 "이게 뭐지?" 혼동 | `openclaw-adapter.ts:178` |

## Medium

| # | 버그 | 심각도 | 재현율 | 사용자 영향 | 파일 |
|---|------|--------|--------|------------|------|
| B2 | Chain plan이 in-memory Map에만 저장 — 서버 재시작 시 모든 plan 소실 | MEDIUM | 100% (재시작 시) | 진행 중 체인이 있으면 plan 없이 root task만 남음. UI에서 체인 상태 표시 불가 | `chain-plan.ts:36` |
| B3 | 복잡 체인(PM→DEV→QA→DEV) 최종 결과물 위치가 직관적이지 않음 | MEDIUM | 체인 2+ 단계 | root task result에 집약되지만, 사용자가 "어디서 최종본 보지?" 1회 이상 탐색 필요 | `task-queue.ts:340-380` |

## Low

| # | 버그 | 심각도 | 재현율 | 사용자 영향 | 파일 |
|---|------|--------|--------|------------|------|
| B4 | meeting spawn 시 에이전트가 이미 working이면 FSM 전이 실패 (silent catch) | LOW | 동시 작업 시 | 회의 기여가 누락될 수 있음 (silent fail) | `meetings.ts:138` |
| B5 | `parseApprovalSelection`이 "go" 등 영문 1단어를 승인으로 인식하지만 문맥 무관 | LOW | 드묾 | 사용자가 "go back" 등을 입력하면 오인식 가능 (10자 미만 조건으로 완화됨) | `chief-agent.ts:73` |

---

## 수정 권장 우선순위

1. **B1** — `parseAgentOutput`에 tool log 패턴 strip 로직 추가 (1시간 이내 수정 가능)
   ```ts
   // openclaw-adapter.ts parseAgentOutput 끝에 추가
   const sanitized = raw.replace(/^assistant to=\S+\n.*$/gm, '').trim();
   ```
2. **B2** — chain plan을 SQLite에 persist (구조적 개선, 2-3시간)
3. **B3** — 최종 결과물 접근 UX 개선 (deliverable list에 "최종본" 배지 추가)
