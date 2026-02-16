# Claude Code `Agent Teams` vs AI Office 시장 겹침 분석

작성일: 2026-02-16

## 0) 핵심 요약 (TL;DR)
- **겹치는 영역**: 멀티에이전트 분업, 병렬 실행, 역할 분화, 훅 기반 품질 게이트.
- **Claude Code 우위 영역(우리가 잃는 영역)**: 개발자 워크플로우(터미널/IDE) 밀착, 팀 간 직접 메시징, 성숙한 권한/훅/에이전트 SDK 생태.
- **AI Office 우위 영역(우리가 강한 영역)**: 시각적 오피스 UX, 의사결정/회의/결과물 타입 중심 운영, PM 관점 통합 관제(Chief/체인 편집/실패 타임라인).
- **전략 결론**: Claude와 정면으로 “코딩 에이전트” 경쟁보다, **“업무 운영 OS + 시각적 협업/의사결정 레이어”**로 포지셔닝해야 방어 가능.

---

## 1) Claude Code Team Agents 최신 기능/포지셔닝 (확인 기반)

> 주의: Anthropic 공식 문서에서 용어는 `Agent teams`/`Subagents`로 표기됨.

### 1-1. 공식적으로 확인된 기능
- **Agent teams (실험 기능)**
  - 다수 Claude Code 인스턴스를 팀 리드+팀원으로 오케스트레이션.
  - 팀원 간 직접 메시징, 공유 task list, 의존성 기반 task 진행.
  - 인-프로세스/분할창(tmux·iTerm2) 모드 지원.
  - 문서가 **토큰 사용량이 단일 세션 대비 유의미하게 증가**한다고 명시.
- **Subagents**
  - 별도 컨텍스트 윈도우 + 툴 제한 + 모델 분기(haiku/sonnet/opus/inherit).
  - 프로젝트/사용자/플러그인 스코프로 재사용 가능.
- **Hooks**
  - PreToolUse/PostToolUse/TaskCompleted/TeammateIdle 등 이벤트 훅.
  - 규칙 위반 시 block/피드백 가능(품질 게이트).
- **자율성 강화 발표**
  - VS Code 확장, 체크포인트(/rewind), SDK에서 subagents/hooks 지원 강조.

### 1-2. 포지셔닝 신호
- “개발자가 팀 리드가 되어 병렬 에이전트를 조정”하는 **개발 생산성 중심 포지셔닝**.
- Agent SDK로 확장해 코딩 밖의 일반 에이전트 루프까지 확장하려는 전략 공개.

---

## 2) 기능 겹침 매트릭스 (기획/협업/실행/관측/결과물/UX)

| 축 | Claude Code Agent Teams | AI Office | 겹침도 | 메모 |
|---|---|---|---|---|
| 기획 | Plan mode, 팀 리드 중심 분해/할당 | Chief + Chain Plan 제안/수정/확정 | 높음 | 둘 다 “계획→실행” 파이프라인 보유 |
| 협업 | 팀원 간 직접 메시징/자기 claim | 회의(Planning/Review/Tech-spec), Proposal/ReviewScore/Decision | 중간 | AI Office는 의사결정 구조화가 더 강함 |
| 실행 | 병렬 팀원/서브에이전트/권한모드 | 역할별 에이전트 + task queue + 체인 실행 | 높음 | 실행 엔진은 양측 모두 강함 |
| 관측(Observability) | 터미널/패널 중심, task list/상태 | 대시보드/활동로그/실패 타임라인/히스토리 리플레이 | 중간~높음 | AI Office 시각 관측 우위 |
| 결과물 | 코드 변경 중심(개발 워크플로우 친화) | web/report/code/api/design/data/document 타입화 | 중간 | AI Office는 산출물 범주가 더 넓음 |
| UX | CLI+IDE(개발자 기본 도구) | 가상 오피스(픽시JS) + 운영 콘솔 | 낮음(차별) | 타깃 사용자와 사용 문맥이 다름 |

---

## 3) 우리가 잃는 영역 vs 우리가 더 강한 영역

### 3-1. 우리가 잃는 영역 (위험 구간)
1. **개발자 기본 채널 장악력**: Claude는 터미널/VS Code 내부에서 바로 동작.
2. **팀원 간 직접 협업 모델**: Agent teams는 동료 간 직접 메시징/자기조정.
3. **정교한 권한/훅 통제**: 이벤트 훅으로 실행 전후 게이트를 강하게 구성 가능.
4. **SDK 외연 확장성**: Agent SDK를 통한 커스텀 에이전트 제작 생태.
5. **브랜드 모멘텀**: Anthropic 공식 발표+문서 업데이트 속도.

### 3-2. 우리가 더 강한 영역 (증거 기반 5개)
1. **시각적 운영 관제 UX**
   - 증거: Isometric Office View, Live Dashboard, Failure Timeline, History Replay.
2. **의사결정 시스템 내장**
   - 증거: `DecisionItem/Proposal/ReviewScore/DecisionHistory` 타입 및 관련 컴포넌트.
3. **회의 중심 협업 프로토콜**
   - 증거: `Meeting/TechSpecMeetingData/MeetingReview` 및 Planning·Review·Debate·Tech-spec 흐름.
4. **산출물 다형성(코드 외 업무까지)**
   - 증거: `DeliverableType`에 web/report/code/api/design/data/document 포함.
5. **체인 편집 가능 워크플로우**
   - 증거: `ChainPlan`(proposed/confirmed/running), 단계 편집 전 실행 구조.

---

## 4) 위험요소 5개 + 완화전략

1. **위험: “Claude로 충분하다” 인식 확대**
   - 완화: AI Office를 코딩도구가 아닌 **운영/의사결정 레이어**로 재포지셔닝.

2. **위험: Agent Teams 대비 협업 밀도 열세(직접 메시징/자기 claim)**
   - 완화: 에이전트 간 직접 코멘트 스레드 + task claim UX(현재 task queue 위 확장) 2주 내 프로토타입.

3. **위험: 품질 게이트 신뢰도 열세(Claude hooks 대비)**
   - 완화: TaskCompleted 전 필수 QC 규칙(테스트/린트/빈화면 검증) 강제 훅형 체커 추가.

4. **위험: 개발자 채널(IDE/CLI) 접점 부족**
   - 완화: 최소 CLI 브리지(작업 생성/상태조회/결과열람) 제공, VS Code 알림 연동 PoC.

5. **위험: 토큰/비용 효율 메시지 부재**
   - 완화: “회의/의사결정 단계에서만 고성능 모델, 실행은 저비용 모델” 비용 정책 대시보드화.

---

## 5) 당장 2주 내 실행 가능한 차별화 액션 7개

1. **포지셔닝 문구/랜딩 교체**
   - “AI 코더” 대신 “AI 팀 운영 OS”로 헤드라인 변경.

2. **결정 로그 데모 시나리오 제작**
   - 같은 과제에 대해 `Proposal 비교 → ReviewScore → 최종 결정` 3분 데모 영상.

3. **체인 편집 UX 강화**
   - Chain 단계 drag/drop + 단계별 승인 토글(자동/수동) 노출.

4. **품질 게이트 카드 추가**
   - Task 완료 카드에 테스트/린트/웹 검증(빈 화면) 배지 표준화.

5. **역할별 결과물 템플릿 6종 배포**
   - PRD, Tech Spec, QA Report, Launch Checklist, Exec Summary, Postmortem.

6. **비용/속도 모드 스위치**
   - “Fast/Balanced/Quality” 프리셋을 팀 단위로 설정, 모델 매핑 자동화.

7. **경쟁 비교 데모(정면승부 회피형)**
   - Claude가 강한 “코드 생성”은 인정하고, AI Office가 강한 “결정 투명성/운영 관제”를 전면 시연.

---

## 6) 제품 메시지/로드맵/데모 포인트 제안

### 제품 메시지
- 핵심 메시지: **“실행 에이전트가 아니라, 팀 운영을 통제하는 레이어”**
- 보조 메시지: “결정 근거가 남고, 실패 원인이 보이며, 결과물이 표준화된다.”

### 로드맵 우선순위 (단기)
1) 협업 밀도 보강(직접 메시징/claim)  
2) 품질 게이트 강제화  
3) 비용 가시화/모델 라우팅 정책화

### 데모 포인트 (고객 미팅용)
1) 복잡 과제 투입 → 팀 자동 편성  
2) 체인 편집 후 실행  
3) 회의/결정 로그 확인  
4) 실패 타임라인으로 원인 추적  
5) 다형 산출물 자동 패키징

---

## 7) 한 줄 포지셔닝 카피 3개
1. **“AI Office는 AI를 ‘잘 코딩’시키는 도구가 아니라, AI 팀을 ‘잘 운영’하게 만드는 운영체계입니다.”**
2. **“코드는 Claude가 잘 짭니다. AI Office는 결정·협업·품질을 끝까지 책임집니다.”**
3. **“여러 에이전트를 돌리는 것과, 팀으로 성과를 내는 것은 다릅니다—AI Office가 그 간극을 메웁니다.”**

---

## 출처 링크

### Claude Code 공식 문서/발표
- Agent teams 문서: https://code.claude.com/docs/en/agent-teams
- Subagents 문서: https://code.claude.com/docs/en/sub-agents
- Hooks 문서: https://code.claude.com/docs/en/hooks
- Common workflows (Plan mode/agent team 언급): https://code.claude.com/docs/en/common-workflows
- Anthropic 발표(자율성 강화, 체크포인트/SDK/subagents/hooks): https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously
- Claude Agent SDK 엔지니어링 포스트: https://claude.com/blog/building-agents-with-the-claude-agent-sdk

### 외부 리뷰/해설
- WinBuzzer (Sub-agents 롤아웃 보도): https://winbuzzer.com/2025/07/26/anthropic-rolls-out-sub-agents-for-claude-code-to-streamline-complex-ai-workflows-xcxwbn/
- Geeky-Gadgets (Agent Teams 해설): https://www.geeky-gadgets.com/agent-teams-token-usage/

### AI Office 내부 근거(코드베이스)
- 프로젝트 개요/기능: ./README.md
- 도메인 타입(결정/회의/산출물/체인): ./packages/shared/src/types.ts
- Chief 운영 흐름/알림/체크인: ./packages/server/src/chief-agent.ts
