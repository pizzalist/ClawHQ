# QC_RAW_LOG_SANITIZE_FIX

## 1) 원인
`packages/server/src/openclaw-adapter.ts`의 `parseAgentOutput()`는 JSON 파싱 실패 시 `stdout.trim().slice(0, 4000)`를 그대로 반환했습니다.

그 결과, raw fallback 경로에서 다음 내부 로그/노이즈가 사용자 응답 본문으로 노출될 수 있었습니다.
- `assistant to=functions...`
- tool call/result wrapper JSON
- tool 로그가 포함된 ```json fenced block
- command echo(`+ npm ...`, `$ openclaw ...`) 및 traceback 노이즈

## 2) 수정
### 핵심 변경
- `sanitizeAgentRawText(input: string)` 함수 추가
- `parseAgentOutput()`의 raw fallback 직전에 sanitize 단계 적용

### sanitize 규칙
1. ANSI 색상 코드 제거
2. tool 로그를 담은 ` ```json ... ``` ` 블록 제거
   - 내부에 `assistant to=functions`, `tool_call/tool_result`, `recipient_name: functions.*`, `name: functions.*` 패턴 포함 시 제거
3. 라인 단위 제거
   - `assistant to=functions.*`
   - `tool call/result` 접두 라인
   - command echo 노이즈 (`+ npm`, `$ openclaw`, `$ node`, `$ python`, `$ bash`, `$ sh`)
4. one-line JSON wrapper 제거
   - JSON 라인에 `tool_call/tool_result/call_id/functions.*` 메타 포함 시 제거
5. traceback 블록 제거
   - `Traceback (most recent call last):` 시작 구간 스킵
6. 과도한 빈 줄 정리 후 trim

### 파일
- 수정: `packages/server/src/openclaw-adapter.ts`
- 추가: `packages/server/src/openclaw-adapter.sanitize.regression.test.ts`
- 스크립트 추가: `packages/server/package.json` (`test:adapter-sanitize`)

## 3) 테스트
### 신규 회귀 테스트
`openclaw-adapter.sanitize.regression.test.ts`
- 케이스 A: raw log 포함 입력
  - tool/log 패턴 제거 검증
  - 보고 본문(`# 최종 보고`, 결과 bullet) 유지 검증
- 케이스 B: 정상 markdown/report 입력
  - 일반 문서(일반 json code block 포함) 본문 원형 유지 검증

### 실행 결과
- `npm run test:adapter-sanitize -w @ai-office/server` ✅ PASS
- `npm run build -w @ai-office/server` ✅ PASS
- 기존 관련 회귀 테스트 출력 확인:
  - `test:chain` ✅ PASS
  - `test:chief-intent` ✅ PASS
  - `test:ux-hotfix` ✅ PASS
  - `test:meeting-transaction` ✅ PASS (성공 로그 확인)

## 4) 결과
raw fallback 경로에서 내부 tool/raw 로그가 사용자에게 노출되는 문제를 차단했고, 정상 보고/마크다운 본문은 유지되도록 회귀 테스트를 추가해 재발 방지했습니다.
