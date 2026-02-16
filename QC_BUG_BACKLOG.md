# QC_BUG_BACKLOG

- 생성일: 2026-02-16 (KST)
- 출처: QC_USER_JOURNEY_DEEP (42케이스), 브라우저 UI 스냅샷 실측

## BUG-001 [High]
- 제목: code fence + inline code + 줄바꿈 혼합 시 TaskResultModal 렌더 깨짐
- 재현조건:
  1) Chief에 `## 제목`, `- 리스트`, `` `inline` ``, ```js ... ``` 혼합 결과 생성 요청
  2) 승인 후 완료 Task를 TaskResultModal에서 확인
- 실제: 코드펜스 경계가 문단으로 분해되어 backtick 일부가 원문 잔존
- 기대: fenced block은 하나의 `<pre><code>` 블록으로 안정 렌더
- 영향: 결과 신뢰도 저하, 복붙 오류 가능
- 우선순위: High
- 우회책:
  - Raw Output 대신 Deliverable의 `Open` 뷰 우선 사용
  - 코드 결과는 다운로드 링크(`/download`) 확인
- 권장수정:
  - 토큰 기반 markdown 파서로 fenced block 우선 파싱
  - inline 파서와 block 파서 순서 재정의

## BUG-002 [Medium]
- 제목: 줄바꿈 많은 문장에서 backtick/문단 경계 처리 불일치
- 재현조건: 여러 줄 + 코드표기 혼합 결과를 Chief/TaskResultModal에 표시
- 실제: 일부 구간에서 의도치 않은 문단 분리
- 영향: 가독성 저하
- 우선순위: Medium
- 권장수정: normalize 단계에서 블록 경계 보존 후 paragraph 빌드

## BUG-003 [Medium]
- 제목: 탭 라벨 비일관성(Chief → Chief1 표기)
- 재현조건: 탭 전환 반복 시 간헐 표기 변형
- 영향: 초보 사용자 인지 혼란
- 우선순위: Medium
- 권장수정: 탭 라벨 소스 단일화 및 상태 동기화 점검

## BUG-004 [Low]
- 제목: 일부 응답에서 문장 길이 과다(간결성 저하)
- 재현조건: 모호 요청/복합 요청 입력
- 영향: UX 피로도 증가
- 우선순위: Low
- 권장수정: Chief 응답 길이 clamp(문장 수/토큰 상한)

---

## 집계
- Critical: 0
- High: 1 (우회책 명시)
- Medium: 2
- Low: 1
