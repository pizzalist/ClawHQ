# QC_PROJECT_LEVEL_BUGS — 프로젝트단 버그 트래커

- **생성 시각**: 2026-02-16T15:03:00+09:00
- **출처**: `QC_PROJECT_LEVEL_E2E.md` 시나리오 8종 + 코드 정적 분석 + 이전 QC 회귀 확인
- **프로젝트**: `/home/noah/.openclaw/workspace/company/ai-office/app`

---

## 상태 요약

| ID | 심각도 | 제목 | 상태 |
|----|--------|------|------|
| BUG-P01 | Medium | in-memory 상태 장기 운영 시 메모리 누수 위험 | ⚠️ **미해결** |
| BUG-P02 | Medium | 체인 결과 전달 시 1000자 잘림으로 컨텍스트 손실 | ⚠️ **미해결** |
| BUG-P03 | Low | 데모 모드 타이머 랜덤 지연이 UX 혼란 유발 가능 | ℹ️ 관찰 중 |
| BUG-P04 | Low | LivePreview iframe sandbox에 allow-same-origin 미포함 | ℹ️ 의도적 제한 |
| BUG-P05 | Low | 체인 플랜 편집 시 validation 부족 (중복 역할 허용) | ℹ️ 관찰 중 |
| PREV-001 | ~~High~~ | 승인 후 추적질문 반복 시 응답 시간초과 | ✅ 수정 완료 |
| PREV-002 | ~~Medium~~ | 다중 액션 순차 안내 문구 약함 | ✅ 수정 완료 |
| PREV-003 | ~~Medium~~ | QA→Dev 체인 강제성 문구 잔존 | ✅ 수정 완료 |
| PREV-004 | ~~Medium~~ | 게임/web 빈화면 경고 누락 | ✅ 수정 완료 |

---

| 총계 | 수치 |
|------|------|
| **Critical** | 0 |
| **High** | 0 (이전 1건 수정 완료) |
| **Medium 미해결** | 2 |
| **Low 미해결** | 3 |
| **수정 완료** | 4 (이전 QC) |

---

## 신규 이슈 상세

### BUG-P01 [Medium] in-memory 상태 장기 운영 시 메모리 누수 위험

**위치**: `packages/server/src/`
- `chain-plan.ts` — `plans: Map`, `taskPlanIndex: Map` (무한 성장)
- `openclaw-adapter.ts` — `activeRuns: Map` (완료 후 cleanupRun 호출 의존)
- `chief-agent.ts` — `sessionMessages: Map`, `pendingProposals: Map`, `reportedTaskCompletions: Set`, `reportedTaskFailures: Set`

**증상**: 서버 장기 운영(24h+) 시 완료된 플랜/세션/보고 기록이 계속 누적. GC 대상이 아닌 Map/Set에 참조가 남음.

**재현 방법**:
1. 서버 시작
2. 100+ 태스크를 순차 생성/완료
3. `process.memoryUsage()` 모니터링 → rss 단조 증가

**원인**: 완료된 chain plan, reported task ID, session message 등에 대한 정리 로직 부재.

**권장 수정**:
```typescript
// chain-plan.ts — completed/cancelled 플랜 30분 후 정리
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, plan] of plans) {
    if ((plan.status === 'completed' || plan.status === 'cancelled') 
        && new Date(plan.createdAt).getTime() < cutoff) {
      plans.delete(id);
      taskPlanIndex.delete(plan.taskId);
    }
  }
}, 10 * 60 * 1000);
```

**수정 여부**: 미수정 — 현재 서버 재시작으로 대응 가능하나, 프로덕션 배포 전 수정 필요.

---

### BUG-P02 [Medium] 체인 결과 전달 시 1000자 잘림으로 컨텍스트 손실

**위치**: `packages/server/src/task-queue.ts` — `spawnChainFollowUp` 함수

```typescript
const chainDesc = `Auto-chained from ${agent.name}'s ${prevStepLabel} step.\n\nPrevious result:\n${result.slice(0, 1000)}`;
```

**증상**: 이전 단계 결과가 1000자를 초과하면 잘림. 특히 코드 생성 태스크(HTML/JS)에서 후속 리뷰어가 불완전한 코드를 받아 부정확한 리뷰 생성.

**재현 방법**:
1. Developer에게 복잡한 웹앱 태스크 배정
2. 결과: 3000자+ HTML
3. 체인으로 Reviewer 배정 → Reviewer가 받는 `Previous result`는 1000자까지만

**원인**: 하드코딩된 `.slice(0, 1000)` 제한.

**권장 수정**:
- deliverable ID 참조 방식으로 전환 (전체 결과를 DB에서 조회)
- 또는 제한을 3000~5000자로 상향 + 요약 생성

**수정 여부**: 미수정 — 기능적으로 동작하나 결과 품질에 영향.

---

### BUG-P03 [Low] 데모 모드 타이머 랜덤 지연

**위치**: `packages/server/src/openclaw-adapter.ts`

```typescript
setTimeout(() => options.onComplete(run), 5000 + Math.random() * 10000);
```

**증상**: 데모 모드에서 5~15초 랜덤 지연. 사용자가 "왜 어떤 건 빠르고 어떤 건 느리지?" 의문.

**수정 필요성**: Low — 데모 목적으로 현실감 제공. 다만 시연 시 최대 15초 대기는 길 수 있음. 5~8초로 축소 고려.

---

### BUG-P04 [Low] LivePreview iframe sandbox 제한

**위치**: `packages/web/src/components/LivePreview.tsx`

```tsx
sandbox="allow-scripts allow-modals"
```

**증상**: `allow-same-origin` 미포함으로 localStorage, fetch API 등 사용하는 웹앱은 프리뷰 불가.

**수정 필요성**: Low — 보안상 의도적 제한. `allow-same-origin` 추가 시 iframe이 부모 DOM 접근 가능해져 XSS 위험. 현재 설계가 적절.

---

### BUG-P05 [Low] 체인 플랜 편집 시 중복 역할 허용

**위치**: `packages/server/src/chain-plan.ts` — `editChainPlan`

```typescript
export function editChainPlan(planId: string, steps: ChainStep[]): ChainPlan {
  // steps 내 중복 역할 검증 없음
  if (steps.length === 0) throw new Error('Plan must have at least 1 step');
```

**증상**: 사용자가 developer → developer → developer 같은 무의미 체인 생성 가능.

**수정 필요성**: Low — 사용자 자유도 vs 가드레일 트레이드오프. 경고 표시 정도면 충분.

---

## 이전 QC 수정 완료 확인 (회귀 테스트)

### PREV-001 [수정 완료] 승인 후 추적질문 시간초과

- **수정 내용**: `classifyIntent`에 12종 추적질문 패턴 추가
- **회귀 확인**: 코드에 패턴 존재 확인 ✅, 이전 테스트 12/12 PASS 기록 확인 ✅
- **재현 시도**: 해당 패턴들이 모두 status 분류로 라우팅되는 코드 경로 확인 완료

### PREV-002 [수정 완료] 다중 액션 순차 안내

- **수정 내용**: "📌 **다음 단계:**" 프리픽스 + 번호 목록
- **회귀 확인**: `approveProposal` 및 인라인 승인 경로 모두에 안내 블록 존재 ✅

### PREV-003 [수정 완료] 체인 강제성 문구

- **수정 내용**: "**추천:**" 프리픽스 + "원치 않으면 멈출 수 있습니다" 추가
- **회귀 확인**: `chiefHandleTaskEvent` chain_spawned 이벤트 메시지에 추천 문구 확인 ✅

### PREV-004 [수정 완료] 빈화면 경고 누락

- **수정 내용**: `validateWebDeliverable` 강화 (empty body, 외부 리소스, truncated script)
- **회귀 확인**: 검증 로직 3가지 추가 탐지 조건 존재 확인 ✅, Chief 알림에 체크리스트 포함 ✅

---

## 종합 평가

- **Critical: 0** — 서비스 중단 유발 이슈 없음
- **High: 0** — 이전 1건(PREV-001) 수정 완료
- **Medium: 2** — 프로덕션 배포 전 수정 권장 (메모리 누수, 체인 컨텍스트 잘림)
- **Low: 3** — 개선 사항 수준, 즉시 수정 불요

### 권장 다음 조치

1. **BUG-P01 수정**: 완료된 플랜/세션 자동 정리 타이머 추가 (프로덕션 필수)
2. **BUG-P02 수정**: 체인 결과 전달을 deliverable 참조 방식으로 전환 (품질 개선)
3. **모니터링 추가**: `process.memoryUsage()` 주기 로깅 + 임계치 알림
4. **E2E 자동화**: Playwright 기반 브라우저 테스트 CI 파이프라인 구축
5. **부하 테스트**: 동시 태스크 10+ 시나리오 검증
