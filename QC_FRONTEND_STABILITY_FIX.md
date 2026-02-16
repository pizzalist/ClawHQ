# QC_FRONTEND_STABILITY_FIX

- 일시: 2026-02-16 20:50~
- 범위: 프론트 안정화 잔여 이슈 재검증 + 방어 코드 보강

## 작업 내용

### 1) 빈화면 재현 10회 테스트
- 스크립트: `scripts/qc-frontend-stability-fix.mjs`
- 검증 방식:
  - `http://localhost:3000` 접속 후 10회 reload
  - 각 회차마다 `#root` 텍스트 유효성 + `main` 렌더 존재 확인
- 결과: **PASS (10/10, blank 0회)**

### 2) 새로고침 후 Chief 운영 메시지 유지
- 동일 스크립트에서 chief 탭 메시지 전송(marker) 후 reload
- reload 이후 marker 재검출 확인
- 결과: **PASS (메시지 유지 확인)**

### 3) Critical Alert 표시 시 렌더 트리 붕괴 방지
- 변경 파일: `packages/web/src/components/Dashboard.tsx`
- 조치:
  - `normalizeAlert()` 추가
  - alerts API 응답을 렌더 전 정규화하여 필드 누락/타입 이상 시 fallback 처리
  - `id/severity/status/source/title/message/timestamps` 안전 기본값 보장
- 검증:
  - Dashboard 진입 후 auto-refresh 3사이클(약 16.5초) 동안 렌더 유지 확인
  - `Critical` 텍스트 존재 + pageerror 0건
- 결과: **PASS (붕괴 0회)**

## 실행 커맨드

```bash
npm run -s dev -w @ai-office/server
npm run -s dev -w @ai-office/web -- --host 0.0.0.0 --port 3000
node scripts/qc-frontend-stability-fix.mjs
```

## 최종 판정
- Blank screen 10회 재현: **PASS (0회)**
- Chief 메시지 persistence: **PASS**
- Critical Alert 렌더 안정성: **PASS**
- 남은 이슈: **0 (유지 이슈 없음)**
