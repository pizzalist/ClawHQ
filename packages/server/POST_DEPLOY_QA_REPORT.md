# QA 재검증 보고서 (배포 후 검증)

## 1) 실행 개요
- 시작 시각: 2026-02-16T06:49:02.750Z
- 종료 시각: 2026-02-16T06:49:03.694Z
- 대상 서버: http://127.0.0.1:3001
- 총 점검 수: 5
- PASS: 5
- FAIL: 0

## 2) 점검 결과
| ID | 항목 | 결과 | 소요(ms) | 상세 |
|---|---|---|---:|---|
| D01 | Health endpoint | PASS | 931 | status=ok, demoMode=false, agents=8 |
| D02 | Core list endpoints | PASS | 4 | agents=8, tasks=8, meetings=0, events=24 |
| D03 | Monitoring endpoints | PASS | 2 | alerts=3, timeseries.points=25 |
| D04 | Chief chat smoke test | PASS | 5 | sync-reply |
| D05 | Agent create/delete round-trip | PASS | 2 | created-and-deleted=343bb594-7ec1-41c5-a693-c88b006f64cc |

## 3) 판정
- ✅ 배포 후 핵심 API/기능 재검증을 통과했습니다.

## 4) 후속 권장 작업
- 실패 항목이 있으면 동일 스크립트를 수정 없이 재실행하여 회귀 여부를 확인하세요.
- 운영 배포 파이프라인에 본 스크립트를 붙여 post-deploy gate로 사용하세요.
- 필요 시 WebSocket 이벤트 수신 검증(브라우저/Playwright) 케이스를 추가하세요.
