# QC REAL LLM 10 SAMPLES (진행 중/차단 보고)

- 실행 시각: 2026-02-16 05:00~05:15 KST
- 목표: 실제 OpenClaw LLM 경로(비 demo/fallback) 10건 확보
- 현재 상태: **1건 완료, 9건 추가 실행 차단**

## 실제 LLM 경로 검증
- `/api/health`에서 `demoMode=false` 확인
- `openclaw agent --json --local` 직접 호출 시 `meta.agentMeta.provider=openai-codex` 확인
- demo 문구(`Demo mode`) 없는 실제 응답 확인

## 확보된 샘플

### 1) [기획] P1
- 요청: 2주 내 출시 가능한 AI 회의록 SaaS MVP 기획안 작성
- 실제 Chief 응답(핵심): 작업 생성 후 PM 실행 제안(비동기 chief processing 경로)
- 실제 최종 산출물 요약: MVP 범위/기능 포함·제외, 리스크(정확도·비용·개인정보), 2주 일정, 출시 체크리스트까지 포함된 구조화 기획 문서 완성
- 체인 경로(pm/dev/reviewer): `pm`
- 품질평가(요구일치/구체성/유용성/한국어): 상/상/상/상

## 실행 중 확인된 주요 이슈
1. **Chief API 응답 포맷 혼재**
   - 일부 경로는 `async`, 일부는 `status: processing`만 반환
   - QC 스크립트에서 초기엔 async만 체크해 오탐 발생
   - 개선: `async===true || status==='processing'`로 판별 로직 보강

2. **장기 대기/정체 이슈(서버 OOM 방지 위해 순차 실행 중에도 발생)**
   - 특정 케이스에서 chief_response 수신 지연 또는 태스크 장시간 in-progress
   - 완화 시도: QC 전용 에이전트 모델을 `openai-codex/gpt-5.3-codex`로 통일

## 이번 세션에서 적용한 개선
- `scripts/qc-real-llm-10.mjs` 비동기 판별 로직 개선
- QC 전용 pm/dev/reviewer 에이전트 모델 통일(gpt-5.3-codex)

## 차단 사유 요약
- 10건 연속 자동 수집 중, chief 응답/태스크 완료 대기 구간에서 장시간 정체가 반복되어 본 세션 내 10건 완주 실패

## 다음 재실행 권장
1. 서버 재시작 후(`npm run dev:server`) 빈 상태에서 재실행
2. 케이스당 타임아웃을 더 짧게 두고 실패 즉시 다음 케이스로 스킵
3. chief_response 수신 실패 시 fallback으로 동일 요청을 task API 직접 생성해 chain만 수집(단, chief 응답 항목은 별도 표기)
