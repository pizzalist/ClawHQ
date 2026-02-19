# Meeting Flow Regression Result — 2026-02-19

기준: `c865a73`, `fc18282`

## 실행 방식
- 서버 로직 실측 검증(실제 함수 호출): `handleChiefAction()` + 실제 DB 삽입 데이터
- 테스트 데이터: planning 완료 회의 3종(후보 0/1/2)
- 검증 포인트:
  - `start-review-*` 응답
  - `approve-*` 응답(특히 finalize_by_chief 분기)
  - 파생 review meeting 생성 여부

## 요약
- 총 3건
- PASS 3 / FAIL 0

---

## Scenario 1 — 후보 없음

- 입력 데이터(proposals): 후보 태그 없음
- 기대:
  - 리뷰 점수화 차단
  - 총괄자 최종안 경로 안내
- 실제:
  - reviewReply:
    - `ℹ️ 비교 가능한 후보가 없어 후보 평가는 생략됩니다. ... 총괄자 최종안 작성(취합 결정) ...`
  - approveReply:
    - `비교 가능한 후보가 없어 점수화 평가는 건너뜁니다 ... 총괄자 최종안 ...`
  - 파생 review meeting: 생성 안 됨
- 판정: **PASS**

## Scenario 2 — 후보 1개(경계값)

- 입력 데이터(proposals): `[CANDIDATE] 단일안: 단일 후보`
- 기대:
  - 리뷰 점수화 차단(2개 미만)
  - 총괄자 최종안 경로
- 실제:
  - reviewReply:
    - `ℹ️ 비교 가능한 후보가 없어 후보 평가는 생략됩니다 ...`
  - approveReply:
    - `비교 가능한 후보가 없어 점수화 평가는 건너뜁니다 ... 총괄자 최종안 ...`
  - 파생 review meeting: 생성 안 됨
- 판정: **PASS**

## Scenario 3 — 후보 2개

- 입력 데이터(proposals):
  - `[CANDIDATE] A안: 대안 A`
  - `[CANDIDATE] B안: 대안 B`
- 기대:
  - 리뷰 점수화 허용
  - review meeting 생성
- 실제:
  - reviewReply:
    - `🔍 리뷰 미팅 "[리뷰] QA-후보2개"을 시작했습니다 ...`
  - meetings:
    - source planning meeting 1개
    - `type=review`, `sourceMeetingId=<원본회의ID>` 파생 meeting 1개 생성 확인
- 판정: **PASS**

---

## 결론
이번 패치 의도대로 동작 확인:
- 후보 0~1개: 점수화 차단 + 총괄자 최종안 분기
- 후보 2개+: 리뷰 점수화 시작 + review meeting 생성

## 비고
- 테스트 후 `POST /api/reset-all`로 상태 초기화 완료.
