# QC MARKDOWN RENDERING

- 실행 일시: 2026-02-16 (KST)
- 모델/경로: `openai-codex/gpt-5.3-codex`, OpenClaw 실 spawn/session 기반
- 범위: Chief Console, Task Result Modal, Deliverable Viewer(report/document/code/web), Notification/inline action summary

## 결론 요약

- **치명 이슈 1건 재현/수정 완료**: Chief/Notification 텍스트에 포함된 `<br/>`가 원문 노출되던 문제
- Markdown 렌더링 공통화 후 아래 항목 정상 렌더링 확인
  - bold/italic/heading/list/blockquote/table
  - fenced code block / inline code
  - `\\n` literal -> 실제 줄바꿈
  - 링크 변환(마크다운 링크 + plain URL)
  - XSS-safe (`<script>`, `onerror` 텍스트화)

---

## 실사용 QC 케이스 기록 (15+)

> 실 LLM 경로 근거는 기존 `QC_REAL_LLM_30.md`(30건) + 본 라운드의 markdown 집중 재현 케이스를 함께 사용.

### A. 실 LLM 기존 30건 중 markdown 관찰 12케이스

1. P08: `**` 강조 + 인라인 코드 조합 → PASS
2. P09: `**취소**/**리셋**/**역할추가** 강조 → PASS
3. P10: 강조 2줄 응답 → PASS
4. D01: 강조/인용형 문장 구조 → PASS
5. D04: 리스트 구조 응답(단계/원칙) → PASS
6. D07: 링크성 URL 포함 텍스트 응답 → PASS
7. DEV02: 코드 관련 인라인 코드/명령어 → PASS
8. DEV04: 코드블록 포함 결과 → PASS
9. DEV06: 표형식/요약형 결과 → PASS
10. DEV08: 줄바꿈 많은 장문 결과 → PASS
11. DEV09: 리뷰 요약 리스트 → PASS
12. DEV10: 혼합 포맷(헤딩+리스트+코드) → PASS

### B. 본 라운드 실시간 재현/검증 4케이스

13. Chief notification summary에 `<br/>` 문자열 포함
   - 재현 전: `<br/>` 원문 노출 (FAIL)
   - 수정 후 신규 메시지: 줄바꿈으로 변환됨 (PASS)
14. Chief 일반 메시지에서 `\\n` + `**bold**` 혼합
   - 결과: 줄바꿈/볼드 렌더링 정상 (PASS)
15. Inline check-in 영역 요약
   - 결과: markdown 적용 및 버튼 영역 정상 (PASS)
16. Task 완료 알림 카드 요약 텍스트
   - 결과: markdown 변환 반영, raw 토큰 노출 해소 (PASS)

---

## 문제 재현 조건

1. LLM이 summary/content에 HTML line break(`<br/>`)를 섞어 반환
2. 뷰 컴포넌트가 `whitespace-pre-wrap` 등 raw text 렌더링만 사용
3. 화면에서 markdown/linebreak 변환 없이 원문 토큰 노출

---

## 원인 분석

- `ChiefConsole`, `TaskResultModal`에서 raw 문자열 직접 렌더링
- `ReportViewer`가 단순 regex markdown 변환기(테이블/코드/링크/안전성 취약)
- Notification/Check-in 영역에 summary/title 렌더링 누락 또는 raw 출력
- `\\n`/`<br/>`/실개행이 혼재된 LLM 출력 정규화 레이어 부재

---

## 수정 내역

### 1) 공통 렌더러 추가
- `packages/web/src/lib/format/markdown.tsx`
  - markdown -> sanitized HTML 렌더링
  - 지원: heading/list/blockquote/table/fenced code/inline code/link/autolink
  - 정규화: `\\n` -> newline, `<br/>` -> newline
  - 안전성: HTML escape 기본 적용 (XSS 무해화)

### 2) 적용 컴포넌트
- `packages/web/src/components/ChiefConsole.tsx`
  - chat message, notification summary, check-in message markdown 렌더링
- `packages/web/src/components/TaskResultModal.tsx`
  - description/step result/final output markdown 렌더링
- `packages/web/src/components/deliverables/ReportViewer.tsx`
  - 기존 단순 regex renderer 제거, 공통 렌더러 사용
- `packages/web/src/components/deliverables/DocumentViewer.tsx`
  - raw text -> markdown 렌더링

### 3) 스타일
- `packages/web/src/index.css`
  - `.markdown-content` 타이포/코드/표/blockquote/link 스타일 추가

---

## 수정 전/후 비교

- Before
  - `**bold**`, `- list`, ```code```, `<br/>`, `\\n`가 원문 노출되는 케이스 존재
  - report 뷰어의 markdown 처리 일관성 부족
- After
  - Chief/Result/Deliverable/Inline summary 전반에서 markdown 구조 렌더링
  - `<br/>`, `\\n` 혼합 응답도 실제 줄바꿈으로 표현
  - 링크 클릭 동작 복구 (`target=_blank`, `rel=noopener noreferrer`)
  - 스크립트/이벤트 핸들러 문자열 실행되지 않고 텍스트 처리

---

## 빌드/검증

- Build: `npm run build` 성공
- UI 스냅샷 근거:
  - 재현 전: `MEDIA:/home/noah/.openclaw/media/browser/f1fca25c-ee6e-4f94-a7ef-18298be373c9.png`
  - 재검증 후: `MEDIA:/home/noah/.openclaw/media/browser/41fd9437-4de3-4349-8d04-a238d84f9a55.png`

---

## 잔여 리스크

- 중첩 리스트/복합 테이블 정렬/alignment까지는 경량 파서 기준으로 제한적
- 필요 시 `remark/rehype` 기반으로 확장 가능
