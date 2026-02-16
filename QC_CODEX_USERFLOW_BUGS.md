# QC_CODEX_USERFLOW_BUGS

- 프로젝트: `/home/noah/.openclaw/workspace/company/ai-office/app`
- 기준: E2E 사용자여정 QC(34케이스) + UI 표시 품질 점검
- 분류 기준: Critical / High / Medium / Low

## Severity Summary

- Critical: **0**
- High: **1**
- Medium: **3**
- Low: **3**

---

## Bug List

## BUG-001 [High] TaskResultModal/Chief 영역에서 code fence 줄바꿈 깨짐
- 재현 단계:
  1) 링크/리스트/코드블록 혼합 결과를 생성
  2) Chief 결과 또는 TaskResultModal에서 렌더 확인
- 기대: fenced code block이 블록 단위로 깨지지 않고 표시
- 실제: 일부 케이스에서 문단 경계가 어긋나며 줄바꿈이 깨짐
- 영향: 코드 복사/해석 오류 가능, 신뢰도 저하
- 관련 케이스: D07 (FAIL)
- 우회책: Deliverable 원문/Raw Output과 교차 확인
- 권장 수정:
  - fenced block 우선 파싱 후 inline 처리
  - list-item 내부 code fence 처리 순서 고정

## BUG-002 [Medium] backtick + 줄바꿈 경계에서 원문 토큰 잔존
- 재현 단계: 줄바꿈 많은 본문에 inline/backtick 혼합
- 기대: 자연 줄바꿈 + 코드 인라인 안정 렌더
- 실제: 경계에서 원문(backtick/개행 토큰) 잔존
- 영향: 가독성 저하
- 관련 케이스: D08 (FAIL)
- 권장 수정: tokenizer 단계에서 escape/linebreak 정규화 선행

## BUG-003 [Medium] Chief 요약 영역 문단 분리 일관성 부족
- 재현 단계: 장문 요약 생성 후 Chief 영역 확인
- 기대: 문단 경계가 일정하게 표현
- 실제: 일부 응답에서 문단 간격 불균등
- 영향: 읽기 피로 증가
- 관련 케이스: D01 (PASS이지만 경미 이슈)
- 권장 수정: summary 렌더에 문단 규칙 단일화

## BUG-004 [Medium] UI 라벨 표기 비일관성(간헐)
- 재현 단계: 탭 전환 반복 시 라벨 확인
- 기대: 동일 객체는 동일 라벨 유지
- 실제: 간헐적 라벨 변형 보고(예: Chief1)
- 영향: 초보 사용자 혼란
- 권장 수정: 라벨 소스 단일화 및 상태 동기화 점검

## BUG-005 [Low] 긴 응답에서 불필요 장문 경향
- 재현 단계: 복합 요청(여러 조건 포함) 입력
- 기대: 핵심 위주 압축 응답
- 실제: 일부 케이스에서 설명이 길어짐
- 영향: 모바일/협소 화면 가독성 저하
- 권장 수정: 길이 clamp + 핵심 3문장 요약 후 상세 접기

## BUG-006 [Low] 수정요청/재확정 CTA 문구 톤 편차
- 재현 단계: 유사 요청을 여러 번 반복
- 기대: CTA 문구 톤/형식 일관
- 실제: 문구 스타일 편차 존재
- 영향: UX 일관성 저하(기능 영향 없음)
- 권장 수정: CTA 템플릿 통일

## BUG-007 [Low] 실패 알림 문구 템플릿 표준화 부족
- 재현 단계: 실패/재시도 상황 메시지 관찰
- 기대: 원인/조치/다음행동 3요소 포함
- 실제: 케이스별 정보 밀도 차이
- 영향: 운영자 판단 시간 증가
- 권장 수정: 알림 템플릿 표준 규격 적용

---

## 개선 우선순위 Top 10 (버그/품질 통합)

1. BUG-001 수정 (High) – code fence/list 혼합 렌더 안정화
2. BUG-002 수정 (Medium) – backtick/개행 경계 토큰 처리
3. BUG-003 수정 (Medium) – Chief 문단 렌더 일관성
4. TaskResultModal/Chief/Deliverable 렌더러 공통 파이프라인 통합
5. D영역 회귀테스트(혼합 markdown 20샘플) 자동화
6. 라벨 상태 동기화 점검(BUG-004)
7. 장문 응답 clamp 적용(BUG-005)
8. CTA 템플릿 통일(BUG-006)
9. 실패 알림 3요소 템플릿 적용(BUG-007)
10. 배포 전 UI 스냅샷 골든 비교(주요 8화면)

---

## Release Gate 제안

- 출시 차단 기준:
  - Critical 1개 이상 또는 High 미해결
- 현재 상태:
  - Critical 0, High 1 → **High 해결 전 조건부 운영 권장**