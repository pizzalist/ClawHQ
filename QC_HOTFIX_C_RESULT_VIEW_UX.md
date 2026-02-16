# QC_HOTFIX_C_RESULT_VIEW_UX

## 범위
긴급 핫픽스 C 대응:
1) 결과보기 UX/스크롤 불편
2) 회의실 종합결과 Markdown 가독성
3) 결과보기/확정 버튼 의미 구분

---

## 적용 변경사항

### 1) "회의 결과 보기"를 모달 미리보기로 전환 (대화 스트림 오염 방지)
- 파일: `packages/web/src/components/ChiefConsole.tsx`
- 변경:
  - `view_result + meetingId` 액션을 서버 라운드트립 대신 **클라이언트 모달**로 처리
  - 미리보기 문구 명시: `대화 스트림에 추가되지 않음`
  - 회의 결과가 있으면 `meeting.report` 우선, 없으면 제목/설명/개별 의견으로 fallback 렌더

### 2) 결과보기 시 스크롤 위치 유지/복귀
- 파일: `packages/web/src/components/ChiefConsole.tsx`
- 변경:
  - 채팅 스크롤 컨테이너 ref(`chatScrollRef`) 도입
  - 미리보기 오픈 전 `scrollTop` 저장
  - 모달 닫을 때 저장 위치로 복귀
  - 모달 열림 중 auto-scroll 억제
  - `Esc`로 모달 닫기 지원

### 3) 회의실 종합결과 Markdown renderer 일관 적용
- 파일: `packages/web/src/components/MeetingRoom.tsx`
- 변경:
  - `MeetingReport`를 plain text(`whitespace-pre-wrap`)에서
  - `MarkdownContent` 기반 렌더로 전환

### 4) 버튼 라벨/도움말 개선 (미리보기 vs 확정)
- 파일: `packages/web/src/components/ChiefConsole.tsx`
- 변경:
  - 인라인 액션 카피 함수 추가 (`getInlineActionCopy`)
  - 회의 결과 보기: `👁 미리보기 (모달)` + tooltip
  - 승인/확정: `✅ 확정 · 다음 단계 실행` + tooltip

---

## 회귀 테스트

### 자동 회귀 테스트 추가
- 파일: `packages/server/src/hotfix-c-result-view.regression.test.ts`
- 스크립트: `packages/server/package.json` → `test:hotfix-c`

### 검증 항목
1. 회의 결과보기가 모달 미리보기 경로로 연결되는지
2. 스크롤 저장/복귀 로직 존재 여부
3. 버튼 라벨 구분(미리보기/확정)
4. MeetingRoom 종합결과 Markdown 렌더 적용 여부
5. Markdown 스냅샷(헤더/리스트/표) 출력 검증

### 실행 결과
```bash
npm run test:hotfix-c -w @ai-office/server
✅ Hotfix C regression passed (modal preview + scroll restore + markdown snapshot)
```

추가 빌드 확인:
```bash
npm run build
# @ai-office/shared, @ai-office/server, @ai-office/web build 성공
```

---

## 비고
- 현재 리포지토리는 기존 작업으로 인해 unrelated 변경/산출물이 이미 다수 존재함.
- 이번 핫픽스 구현 핵심 파일은 아래 4개:
  - `packages/web/src/components/ChiefConsole.tsx`
  - `packages/web/src/components/MeetingRoom.tsx`
  - `packages/server/src/hotfix-c-result-view.regression.test.ts`
  - `packages/server/package.json`
