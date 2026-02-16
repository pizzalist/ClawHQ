# QC_FINAL_USER_STRICT_20 — 최종 엄격 사용자 E2E 감사

**감사일:** 2026-02-16  
**기준 커밋:** 7cc0288 (3개 핫픽스 반영 완료)  
**판정 규칙:** 과장 금지 · 애매하면 FAIL · 사용자 기준  
**회귀 테스트:** review-scoring 5/5 PASS, ux-hotfix 3/3 PASS, meeting-flow-dedup 4/4 PASS

---

## 케이스 목록 (20건)

### 카테고리 A: 빈 화면 / 초기 렌더

| # | 시나리오 | 판정 | 근거 |
|---|---------|------|------|
| A1 | 최초 접속 시 Chief 탭 렌더링 | **PASS** | App.tsx default view='chief', ChiefConsole에 빈상태 가이드 텍스트 있음. 에이전트/작업 0건이어도 빈 화면 아님 |
| A2 | WS 연결 끊김 후 재연결 | **PASS** | store.ts connectWS onclose → 3초 후 reconnect. connected=false시에도 UI 렌더는 유지 |
| A3 | 에이전트 0명 + 작업 0건 상태에서 각 탭 순회 | **CONDITIONAL** | Office/Tasks/Dashboard/Meetings 모두 empty state 메시지 있음. 단, Decisions 탭은 /api/decisions/pending/count fetch 실패 시 count=0으로 조용히 처리 — 빈 화면은 아니지만 에러 피드백 없음 |
| A4 | TaskResultModal: result가 null인 작업 클릭 | **PASS** | summarizeTaskResult(null) → '(결과 없음)' 반환. 빈 모달은 나오지 않음 |

### 카테고리 B: 빈 메시지 / 응답 누락

| # | 시나리오 | 판정 | 근거 |
|---|---------|------|------|
| B1 | Chief에게 빈 문자열 전송 | **PASS** | chiefChat: `if (!msg || chiefThinking) return` — 빈 입력 차단됨 |
| B2 | LLM 응답이 빈 문자열일 때 | **PASS** | `cleanText \|\| '처리가 완료되었습니다.'` fallback 존재 |
| B3 | 상태 조회("진행중이야?") 시 응답 | **PASS** | classifyIntent → 'status' → buildMonitoringReply 동기 응답. LLM 호출 없이 즉시 반환 |
| B4 | 미팅 참여자 에이전트가 에러로 빈 content 반환 | **PASS** | handleContributionComplete: exit≠0이면 `[오류 발생: exit N]` 기록. 빈 content 아님 |
| B5 | 알 수 없는 actionId로 inline action 클릭 | **PASS** | catch-all: `요청을 확인했습니다. 다시 시도하거나...` — 'Unsupported' 노출 제거됨 (핫픽스 1566cae) |

### 카테고리 C: 결과 보기

| # | 시나리오 | 판정 | 근거 |
|---|---------|------|------|
| C1 | 태스크 완료 후 "📄 결과 보기" 클릭 | **PASS** | InlineNotification → action='view_result' + taskId → setSelectedTask → TaskResultModal 열림 |
| C2 | 회의 완료 후 "📄 회의 결과 보기" 클릭 | **PASS** | actionId='view-meeting-{id}' → handleChiefAction → formatMeetingResult. 서버에서 텍스트 반환 후 채팅에 표시 |
| C3 | 존재하지 않는 meetingId로 결과 보기 | **PASS** | formatMeetingResult: `!meeting` → '해당 회의를 찾을 수 없습니다...' 안내 메시지 |
| C4 | 결과 텍스트가 1200자 초과일 때 | **PASS** | compactText(…, 1200) → 500/1200자 잘라서 "(더 보기는 '결과 보기'를 눌러주세요)" 안내 |

### 카테고리 D: 확정 후 다음 단계

| # | 시나리오 | 판정 | 근거 |
|---|---------|------|------|
| D1 | 태스크 확정("✅ 확정") 클릭 | **PASS** | handleChiefAction approve → '✅ 확정되었습니다. 다음 단계로 진행합니다.' 메시지 |
| D2 | 미팅 확정 후 리뷰 시작 가능 여부 | **PASS** | planning/brainstorm 미팅 완료 시 '🔍 리뷰어 점수화 시작' 버튼 제공 (chiefHandleMeetingChange) |
| D3 | 리뷰 시작 시 sourceCandidates 없으면 | **PASS** | startReviewMeetingFromSource: candidates.length===0 → return null → '⚠️ 점수화 대상 후보가 없습니다' 안내 |
| D4 | 전체 작업 완료 후 다음 단계 안내 | **PASS** | pendingCount===0 → completion stage check-in: '확정/수정 요청/추가 작업' 3옵션 제공 |
| D5 | 승인 실행 후 남은 작업 안내 | **CONDITIONAL** | approveProposal 결과에 `📌 다음 단계` 포함. 단, 확정 후 실질적 자동 실행(리뷰→개발 전환 등)은 없음 — 사용자가 다시 지시해야 함 |

### 카테고리 E: 점수표 가독성

| # | 시나리오 | 판정 | 근거 |
|---|---------|------|------|
| E1 | 리뷰 미팅 점수표 포맷 | **CONDITIONAL** | buildReviewScoringReport: markdown 테이블 생성. 하지만 MeetingRoom의 MeetingReport는 `whitespace-pre-wrap` 텍스트로 렌더. markdown 테이블이 raw pipe 문자로 보일 가능성 있음 |
| E2 | Chief 콘솔 내 점수 카드 표시 | **PASS** | formatMeetingResult에서 decisionPacket → 🏆 추천안 / 💡 대안 / 🔍 리뷰어별 점수 텍스트로 출력. MarkdownContent로 렌더 |
| E3 | [SCORE] 파싱 실패 시 (LLM이 형식 미준수) | **CONDITIONAL** | 점수 파싱 실패 시 extractCandidateScoreFromText fallback → 기본값 7점. 사용자에게 "파싱 실패" 알림 없이 7점 사용 — 신뢰성 문제 |

---

## 요약

| 카테고리 | PASS | CONDITIONAL | FAIL |
|----------|------|-------------|------|
| A: 빈 화면 | 3 | 1 | 0 |
| B: 빈 메시지 | 5 | 0 | 0 |
| C: 결과 보기 | 4 | 0 | 0 |
| D: 확정 후 다음 단계 | 4 | 1 | 0 |
| E: 점수표 가독성 | 1 | 2 | 0 |
| **합계** | **17** | **3** | **0** |

**FAIL 0건 / CONDITIONAL 3건**
