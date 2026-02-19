# Meeting Flow Regression Checklist

후보 평가 게이트(명시 후보 2개 이상)와 총괄자 최종안 분기 검증용 QA 템플릿.

---

## 테스트 환경

- Build: `npm run build -w @ai-office/server && npm run build -w @ai-office/web`
- Server: `http://127.0.0.1:3001` (또는 운영 URL)
- 기준 커밋:
  - `c865a73` `fix(meeting): gate review scoring to explicit comparable candidates`
  - `fc18282` `feat(meeting): enforce synthesis-vs-candidate flow with chief-first UX`

---

## 공통 판정 규칙

- 후보 `0~1개` → 리뷰 점수화 **차단**, `총괄자 최종안 작성` 경로
- 후보 `2개+` → 리뷰 점수화 **허용**

실패 조건:
- 후보 없음/1개인데 리뷰가 시작됨
- 후보 2개 이상인데 리뷰 진입이 안 됨
- UI 라벨/가이드가 서버 분기와 불일치

---

## Scenario 1 — 후보 없는 기획 회의

### 입력
- Chief 요청(예시):
  - `신규 온보딩 개선 기획안 정리해줘`  
  (의도: `[CANDIDATE]` 태그 없이 일반 취합형)

### 기대 결과
- 회의 완료 후 알림/액션에서:
  - `후보 평가` 진입 없음 또는 비활성
  - 후보 비교 불가 안내 메시지 노출
  - `🧭 총괄자 최종안 작성` 중심 안내
- `확정` 입력 시:
  - 리뷰 점수화 회의 생성 없이 다음 단계 진행

### 실제 결과 기록
- 회의 ID:
- 알림 요약:
- 노출 액션:
- 확정 후 동작:
- 판정: PASS / FAIL
- 비고:

---

## Scenario 2 — 명시 후보 2개 이상

### 입력
- Chief 요청(예시):
  - `아래 2개 대안을 후보로 비교해 기획 결론 내줘.\n[CANDIDATE] A안: 셀프서브 온보딩\n[CANDIDATE] B안: 세일즈 온보딩`

### 기대 결과
- 회의 완료 후:
  - `🏆 후보 순위 평가`(start_review) 가능
- 후보 평가 실행 시:
  - 리뷰 회의 생성 및 점수/추천 구조화 결과 제공

### 실제 결과 기록
- 회의 ID:
- 알림 요약:
- 노출 액션:
- 리뷰 회의 생성 여부:
- 리뷰 결과 요약:
- 판정: PASS / FAIL
- 비고:

---

## Scenario 3 — 명시 후보 1개(경계값)

### 입력
- Chief 요청(예시):
  - `아래 대안을 후보로 검토해줘.\n[CANDIDATE] 단일안: 챗봇 온보딩`

### 기대 결과
- 리뷰 점수화 시작 차단
- `점수화 대상 후보가 2개 이상 필요` 계열 안내
- `총괄자 최종안 작성` 경로로 유도

### 실제 결과 기록
- 회의 ID:
- 알림 요약:
- 차단 메시지:
- 최종 분기:
- 판정: PASS / FAIL
- 비고:

---

## 로그 캡처 권장

- Chief Console 알림 카드 캡처
- Meeting Room 결과 패널 캡처
- 서버 로그(분기 판단 지점):
  - candidate extraction 결과
  - startReviewMeetingFromSource 진입/차단
  - approve(finalize_by_chief) 처리 경로

---

## 최종 리포트 템플릿

- 실행 일시:
- 실행자:
- 환경(로컬/터널/운영):
- 결과 요약: `총 3건 / PASS n / FAIL n`
- FAIL 상세:
  1. 시나리오:
  2. 재현 단계:
  3. 기대 vs 실제:
  4. 추정 원인:
  5. 후속 액션:
