# QC_FIXLOG_FINAL — 버그별 수정 이력

- 생성 시각: 2026-02-16T13:35:00+09:00
- 커밋: `fix: stabilize noah-style e2e flow and eliminate remaining high issues`

---

## 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `packages/server/src/chief-agent.ts` | BUG-001: 추적질문 패턴 12종 추가, wantsResult/wantsEta 분기 강화 |
| `packages/server/src/chief-agent.ts` | BUG-002: 다중 액션 완료 후 "📌 다음 단계" 안내 블록 추가 |
| `packages/server/src/chief-agent.ts` | BUG-003: 체인 알림 추천형 문구 + 시스템 프롬프트 비강제 정책 |
| `packages/server/src/chief-agent.ts` | BUG-004: 빈화면 경고 체크리스트 포함 + re-validate 강제 |
| `packages/server/src/deliverables.ts` | BUG-004: validateWebDeliverable 강화 (empty body, 외부 리소스, truncated script) |
| `packages/server/src/chief-agent.intent-regression.test.ts` | 회귀 테스트 12케이스로 확장 |

---

## BUG-001: 승인 후 추적질문 timeout

### 수정 1: classifyIntent 패턴 확장
```diff
- const readOnlyStatusLike = /(상태\s*재?확인|...|몇\s*건)/i.test(msg);
+ const readOnlyStatusLike = /(상태\s*재?확인|...|다\s*됐|아직(이야|인가|이냐|이에요)?|어떻게\s*되|되고\s*있|결과\s*나왔|끝났|완료\s*됐|다\s*했|했어\?|됐어\?|...|몇\s*건)/i.test(msg);
```

### 수정 2: buildMonitoringReply에 wantsResult 분기 추가
```diff
+ const wantsResult = /(다\s*됐|끝났|완료\s*됐|결과\s*나왔)/i.test(userMessage);
+ if (wantsResult) {
+   // 최근 완료 태스크 정보 포함 즉시 응답
+ }
```

### 수정 3: wantsEta 패턴 확장
```diff
- const wantsEta = /(eta|예상\s*시간|얼마나\s*남|언제\s*끝)/i.test(userMessage);
+ const wantsEta = /(eta|예상\s*시간|얼마나\s*남|언제\s*끝|언제\s*줘|언제\s*돼)/i.test(userMessage);
```

---

## BUG-002: 다중 액션 순차 안내 약함

### 수정: 완료 후 "📌 다음 단계" 블록 추가
```diff
- reply += `\n\n📋 현재 ${pendingTasks.length}건의 작업이 진행/대기 중입니다.`;
+ reply += `\n\n📌 **다음 단계:** ${pendingTasks.length}건의 작업이 진행/대기 중입니다.\n• 상태 확인: ...\n• 결과 확인: ...\n• 추가 요청: ...`;
```

approveProposal 함수도 동일 패턴 적용.

---

## BUG-003: QA→Dev 체인 강제성 문구

### 수정 1: 체인 알림 메시지 추천형으로 변경
```diff
- message: `🔗 승인된 체인을 계속 진행합니다.\n현재 단계가 완료되어 다음 단계를 자동 시작했습니다.`,
+ message: `🔗 **추천:** 다음 단계로 진행하는 것을 권장합니다.\n현재 단계 결과를 바탕으로 자동 시작했습니다. 원치 않으면 멈출 수 있습니다.`,
```

### 수정 2: 시스템 프롬프트에 추천 정책 추가
```diff
+ 체인/파이프라인 제안 시:
+ - 반드시 "추천안입니다. 확정하시면 실행합니다." 형태로 안내하세요.
+ - 확정 전에는 "실행합니다" 같은 단정 문구 금지
+ - QA→Dev 전환 시 "추천합니다. 진행할까요?" 형태 사용
```

---

## BUG-004: 빈화면 경고 누락

### 수정 1: validateWebDeliverable 강화
```diff
+ // Empty <body> 탐지
+ if (!/<canvas/i.test(html) && /<body[^>]*>\s*<\/body>/i.test(html)) {
+   issues.push('Empty <body> tag — page will show blank screen');
+ }
+ // 외부 리소스 과다
+ if (externalScripts + externalStyles > 3) {
+   issues.push('... external resources — may fail in sandboxed environment');
+ }
+ // Script truncation
+ if (/\bconst\s+\w+\s*=\s*$/.test(inner.trim())) {
+   issues.push('Script appears truncated — may cause runtime error');
+ }
```

### 수정 2: Chief 알림에 체크리스트 포함
```diff
- validationWarning = `\n\n⚠️ **실행 검증 경고**: ${validation.issues.join('; ')}...`;
+ validationWarning = `\n\n⚠️ **빈 화면 위험 경고**:\n${issues.map(...)}\n\n🔍 체크리스트: DOM mount / console error / network 404·500 / 렌더 루프\n수정 요청을 권장합니다.`;
```

---

## 회귀 테스트

- 파일: `packages/server/src/chief-agent.intent-regression.test.ts`
- 확장: 6 → 12 케이스 (추가: "다 됐어?", "아직이야?", "결과 나왔어?", "끝났어?", "언제 줘?", "언제 돼?")
- 결과: **12/12 PASS**
- assertion 완화: DB 요약 형식 검증을 `(\d+건|완료|진행|대기)` 패턴으로 유연화 (wantsResult 분기 응답 대응)
