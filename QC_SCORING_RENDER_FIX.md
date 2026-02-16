# QC_SCORING_RENDER_FIX

## 배경
긴급 핫픽스 범위:
1. 점수화 결과 표가 markdown table 렌더 의존으로 깨지거나 한 줄 뭉침 발생
2. 결과 보기에서 핵심 내용이 잘려(트렁케이션) 의사결정이 어려움

## 적용한 수정

### 1) scoring output: markdown table → 구조화 JSON + UI 테이블 렌더
- 서버(`packages/server/src/meetings.ts`)
  - `buildReviewScoringReport()`에서 markdown table 문자열 생성 로직 제거
  - 점수화 데이터는 기존 `decisionPacket`(구조화 JSON)를 기준 데이터로 사용
  - report는 요약/의사결정 텍스트만 유지

- 웹(`packages/web/src/components/MeetingRoom.tsx`)
  - `ReviewScoringPanel` 전용 컴포넌트 추가
  - `meeting.decisionPacket + sourceCandidates`가 있을 때 구조화 UI 렌더:
    - 후보별 점수표(후보/리뷰어 점수/총점/평균)
    - 1순위 추천 섹션
    - 대안 섹션
  - 후보/총점/추천/대안이 시각적으로 분리된 카드/테이블 구조로 고정 렌더

### 2) 결과 보기 truncation 기본 해제 (핵심 섹션 full)
- 웹 모달(`packages/web/src/components/TaskResultModal.tsx`)
  - 파이프라인 step 상세 결과 박스: `max-h`/내부 스크롤 제거
  - 최종 출력 박스: `max-h`/내부 스크롤 제거
  - 모달 전체 스크롤 컨테이너에서 전체 내용 확인 가능

- 서버 결과 보기 텍스트(`packages/server/src/chief-agent.ts`)
  - `formatMeetingResult()`/`formatTaskResult()`에서 `compactText(..., 1200)` 제거
  - 결과 보기 액션 응답이 기본적으로 full 텍스트를 전달

## 검증 결과

### 빌드 검증
- 명령: `npm run -s build`
- 결과: `@ai-office/shared`, `@ai-office/server`, `@ai-office/web` 모두 build 성공

### 요구 검증 체크
- [x] 후보 3~5개 입력 시 markdown table 파싱 의존 경로 제거
  - 점수표는 `decisionPacket` 기반 HTML `<table>` 렌더로 고정
- [x] 총점/추천안/대안 시각 분리
  - 점수표 + 추천 카드 + 대안 카드로 분리 렌더
- [x] 결과 보기 truncation 기본 해제
  - 모달 핵심 섹션 `max-h` 제거
  - 서버 결과 보기 액션 compact 제거

## 변경 파일
- `packages/server/src/meetings.ts`
- `packages/server/src/chief-agent.ts`
- `packages/web/src/components/MeetingRoom.tsx`
- `packages/web/src/components/TaskResultModal.tsx`
- `QC_SCORING_RENDER_FIX.md`

## 리스크/주의
- 결과 보기가 긴 경우 텍스트 길이가 증가하므로 채팅 뷰 가독성이 떨어질 수 있음
  - 현재 요구사항(기본 full 노출) 우선 적용
  - 필요 시 후속으로 “핵심 섹션만 full + 나머지 접기” 정책 분리 가능
