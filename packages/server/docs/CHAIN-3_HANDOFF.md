# Chain-3 Handoff — Monitoring Mock API

Chain-2 완료 사항:

## 구현 엔드포인트
- `GET /api/monitoring/metrics`
- `GET /api/monitoring/timeseries`
- `GET /api/monitoring/alerts`
- `GET /api/monitoring/schema-sample`

## 소스 위치
- API 라우팅: `packages/server/src/index.ts`
- Mock 데이터 생성기: `packages/server/src/monitoring-mock.ts`
- 샘플 응답 문서: `packages/server/docs/monitoring-api-mock.md`

## 프론트(Chain-3) 권장 연결
1. 모니터링 탭 로드 시 `metrics` + `alerts` 동시 조회
2. 차트 metric 선택 시 `timeseries` 재호출
3. 초기 개발 시 `schema-sample`로 타입/스토어 부트스트랩
4. 필터 상태
   - window: `24h` 기본
   - interval: `1h` 기본
   - alerts status: `active` 기본

## 주의
- 현 단계는 mock-only. 백엔드 실측값 연동 전까지 SLA 해석 금지.
- timestamps는 UTC ISO 문자열입니다.
