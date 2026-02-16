#!/bin/bash
# AI Office E2E Project-Level Test Script
# Tests 6 scenarios with full flow: Meeting -> Dev -> QA -> Fix -> Confirm

BASE="http://localhost:3001"
LOG="/home/noah/.openclaw/workspace/company/ai-office/app/e2e-test-log.jsonl"
> "$LOG"

log() { echo "[$(date +%H:%M:%S)] $*"; }
api() { curl -s "$BASE$1" "${@:2}"; }
post() { curl -s -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }

# Get agent IDs
ALICE=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Alice'))")
BOB=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Bob'))")
CHARLIE=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Charlie'))")
DIANA=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Diana'))")
GRACE=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Grace'))")
EVE=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Eve'))")
FRANK=$(api /api/agents | python3 -c "import sys,json; print(next(a['id'] for a in json.load(sys.stdin) if a['name']=='Frank'))")

log "Agent IDs loaded: Alice=$ALICE Bob=$BOB Charlie=$CHARLIE Diana=$DIANA Grace=$GRACE Eve=$EVE Frank=$FRANK"

wait_for_meeting() {
  local MID=$1
  local MAX_WAIT=${2:-180}
  local ELAPSED=0
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(api /api/meetings/$MID | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
    if [ "$STATUS" = "completed" ]; then
      log "  Meeting $MID completed after ${ELAPSED}s"
      return 0
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    if [ $((ELAPSED % 30)) -eq 0 ]; then
      log "  Waiting for meeting... ${ELAPSED}s"
    fi
  done
  log "  Meeting $MID TIMEOUT after ${MAX_WAIT}s (status=$STATUS)"
  return 1
}

wait_for_task() {
  local TID=$1
  local MAX_WAIT=${2:-300}
  local ELAPSED=0
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(api /api/tasks/$TID | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
    if [ "$STATUS" = "completed" ]; then
      log "  Task $TID completed after ${ELAPSED}s"
      return 0
    fi
    if [ "$STATUS" = "failed" ]; then
      log "  Task $TID FAILED after ${ELAPSED}s"
      return 2
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    if [ $((ELAPSED % 30)) -eq 0 ]; then
      log "  Waiting for task... ${ELAPSED}s (status=$STATUS)"
    fi
  done
  log "  Task $TID TIMEOUT after ${MAX_WAIT}s (status=$STATUS)"
  return 1
}

echo "=== AI Office E2E Test Starting ==="
echo ""

######################################################################
# SCENARIO A: 나루토 미니게임 프로토타입
######################################################################
log "=== SCENARIO A: 나루토 미니게임 프로토타입 ==="

# Step 1: Planning meeting with 4 participants
log "A1: Starting planning meeting (Alice, Bob, Charlie, Eve)"
MEET_A=$(post /api/meetings "{
  \"title\": \"나루토 미니게임 프로토타입 기획\",
  \"description\": \"나루토 테마의 HTML5 캔버스 미니게임을 기획합니다. 수리검 던지기 게임으로, 키보드로 캐릭터를 조종하고 적을 맞추는 간단한 액션 게임입니다. 기술 스택, UI/UX, 게임 로직을 논의합니다.\",
  \"participantIds\": [\"$ALICE\", \"$BOB\", \"$CHARLIE\", \"$EVE\"],
  \"character\": \"brainstorm\"
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Meeting ID: $MEET_A"

wait_for_meeting "$MEET_A" 240
MEET_A_PROPS=$(api /api/meetings/$MEET_A | python3 -c "import sys,json; m=json.load(sys.stdin); print(len(m.get('proposals',[])))")
log "  Meeting contributions: $MEET_A_PROPS"

# Step 2: Create dev task
log "A2: Creating dev task"
TASK_A=$(post /api/tasks "{
  \"title\": \"나루토 수리검 미니게임 구현\",
  \"description\": \"HTML5 Canvas + JavaScript로 나루토 테마 수리검 던지기 미니게임을 구현하세요. 단일 HTML 파일로 완성. 키보드 방향키로 캐릭터 이동, 스페이스바로 수리검 발사, 적 캐릭터가 랜덤 등장하여 맞추면 점수 획득. 게임오버/재시작 기능 포함.\",
  \"assigneeId\": \"$BOB\",
  \"expectedDeliverables\": [\"web\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_A"

# Trigger processing
post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_A" 300

# Step 3: Check deliverables and preview
DELIV_A=$(api "/api/deliverables?taskId=$TASK_A" | python3 -c "import sys,json; ds=json.load(sys.stdin); print(len(ds))")
log "A3: Deliverables count: $DELIV_A"

PREVIEW_A=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tasks/$TASK_A/preview")
log "  Preview endpoint: HTTP $PREVIEW_A"

# Step 4: Validate web deliverable
if [ "$DELIV_A" -gt 0 ]; then
  DELIV_A_ID=$(api "/api/deliverables?taskId=$TASK_A" | python3 -c "import sys,json; ds=json.load(sys.stdin); print(ds[0]['id'] if ds else 'NONE')")
  VALID_A=$(api "/api/deliverables/$DELIV_A_ID/validate" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'valid={d.get(\"valid\",\"?\")} issues={d.get(\"issues\",[])}')")
  log "  Validation: $VALID_A"
fi

echo ""

######################################################################
# SCENARIO B: 랜딩페이지 제작
######################################################################
log "=== SCENARIO B: 랜딩페이지 제작 ==="

log "B1: Starting planning meeting (Alice, Bob, Eve, Diana)"
MEET_B=$(post /api/meetings "{
  \"title\": \"SaaS 랜딩페이지 기획\",
  \"description\": \"AI 기반 프로젝트 관리 SaaS의 랜딩페이지를 기획합니다. Hero 섹션, 기능 소개, 가격표, CTA 버튼 등을 포함한 반응형 원페이지 디자인을 논의합니다.\",
  \"participantIds\": [\"$ALICE\", \"$BOB\", \"$EVE\", \"$DIANA\"],
  \"character\": \"planning\"
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Meeting ID: $MEET_B"

wait_for_meeting "$MEET_B" 240
MEET_B_PROPS=$(api /api/meetings/$MEET_B | python3 -c "import sys,json; m=json.load(sys.stdin); print(len(m.get('proposals',[])))")
log "  Meeting contributions: $MEET_B_PROPS"

log "B2: Creating landing page task"
TASK_B=$(post /api/tasks "{
  \"title\": \"AI SaaS 랜딩페이지 구현\",
  \"description\": \"반응형 SaaS 랜딩페이지를 단일 HTML 파일로 구현하세요. 포함: Hero 섹션(제목+CTA), 기능 소개 3개, 가격표(Free/Pro/Enterprise), FAQ 아코디언, 푸터. Tailwind CDN 사용 가능. 다크 모드 스타일.\",
  \"assigneeId\": \"$CHARLIE\",
  \"expectedDeliverables\": [\"web\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_B"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_B" 300

DELIV_B=$(api "/api/deliverables?taskId=$TASK_B" | python3 -c "import sys,json; ds=json.load(sys.stdin); print(len(ds))")
log "B3: Deliverables: $DELIV_B"

PREVIEW_B=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tasks/$TASK_B/preview")
log "  Preview: HTTP $PREVIEW_B"

echo ""

######################################################################
# SCENARIO C: 분석 리포트 + 검토
######################################################################
log "=== SCENARIO C: 분석 리포트 + 검토 ==="

log "C1: Starting analysis meeting (Alice, Diana, Grace)"
MEET_C=$(post /api/meetings "{
  \"title\": \"AI Office 품질 분석 방법론 논의\",
  \"description\": \"AI Office 프로덕트의 품질 분석 리포트 작성 방법론을 논의합니다. 어떤 메트릭을 사용할지, 테스트 커버리지 기준, 성능 벤치마크 등을 정합니다.\",
  \"participantIds\": [\"$ALICE\", \"$DIANA\", \"$GRACE\"],
  \"character\": \"review\"
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Meeting ID: $MEET_C"

wait_for_meeting "$MEET_C" 240

log "C2: Creating report task"
TASK_C=$(post /api/tasks "{
  \"title\": \"AI Office 품질 분석 리포트 작성\",
  \"description\": \"AI Office의 현재 코드 품질, 아키텍처 구조, 테스트 현황을 분석하는 마크다운 리포트를 작성하세요. 포함 항목: 1) 아키텍처 개요 2) 코드 품질 메트릭 3) 테스트 커버리지 분석 4) 개선 권장사항 5) 리스크 평가\",
  \"assigneeId\": \"$ALICE\",
  \"expectedDeliverables\": [\"report\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_C"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_C" 300

RESULT_C_LEN=$(api /api/tasks/$TASK_C | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',''); print(len(r) if r else 0)")
log "C3: Report result length: $RESULT_C_LEN chars"

echo ""

######################################################################
# SCENARIO D: API 구현 + 리뷰
######################################################################
log "=== SCENARIO D: API 구현 + 리뷰 ==="

log "D1: Planning meeting (Alice, Bob, Diana, Frank)"
MEET_D=$(post /api/meetings "{
  \"title\": \"REST API 설계 회의\",
  \"description\": \"사용자 관리 REST API를 설계합니다. CRUD 엔드포인트, 인증 방식, 에러 핸들링 패턴, 페이지네이션 전략을 논의합니다.\",
  \"participantIds\": [\"$ALICE\", \"$BOB\", \"$DIANA\", \"$FRANK\"],
  \"character\": \"planning\"
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Meeting ID: $MEET_D"

wait_for_meeting "$MEET_D" 240

log "D2: Creating API implementation task"
TASK_D=$(post /api/tasks "{
  \"title\": \"사용자 관리 REST API 구현\",
  \"description\": \"Express.js 기반 사용자 관리 REST API를 구현하세요. 엔드포인트: GET /users, GET /users/:id, POST /users, PUT /users/:id, DELETE /users/:id. JWT 인증 미들웨어, 입력 검증, 에러 핸들링 포함. TypeScript로 작성.\",
  \"assigneeId\": \"$BOB\",
  \"expectedDeliverables\": [\"api\", \"code\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_D"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_D" 300

RESULT_D_LEN=$(api /api/tasks/$TASK_D | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',''); print(len(r) if r else 0)")
log "D3: API result length: $RESULT_D_LEN chars"

echo ""

######################################################################
# SCENARIO E: 오류 재현/수정 루프
######################################################################
log "=== SCENARIO E: 오류 재현/수정 루프 ==="

log "E1: Creating intentionally broken task"
TASK_E1=$(post /api/tasks "{
  \"title\": \"버그 있는 계산기 구현\",
  \"description\": \"HTML/JS로 간단한 계산기를 만드세요. 단, 이 계산기에는 의도적으로 다음 버그를 포함하세요: 1) 나눗셈에서 0으로 나눌 때 에러 처리 없음 2) 소수점 버튼을 여러 번 누를 수 있음 3) 음수 처리가 안 됨. 이 버그들을 포함한 채로 구현하세요.\",
  \"assigneeId\": \"$BOB\",
  \"expectedDeliverables\": [\"web\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_E1"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_E1" 300

log "E2: QA review task"
TASK_E2=$(post /api/tasks "{
  \"title\": \"계산기 버그 리포트 작성\",
  \"description\": \"이전에 구현된 계산기의 버그를 찾아 리포트를 작성하세요. 각 버그에 대해: 1) 재현 단계 2) 예상 동작 3) 실제 동작 4) 심각도(Critical/Major/Minor) 5) 수정 제안을 포함하세요.\",
  \"assigneeId\": \"$GRACE\",
  \"expectedDeliverables\": [\"report\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_E2"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_E2" 300

log "E3: Fix task based on QA"
TASK_E3=$(post /api/tasks "{
  \"title\": \"계산기 버그 수정\",
  \"description\": \"QA에서 발견한 계산기 버그를 모두 수정하세요: 1) 0으로 나눌 때 'Error' 표시 2) 소수점 중복 입력 방지 3) 음수 처리 지원. 수정된 전체 HTML/JS 코드를 제출하세요.\",
  \"assigneeId\": \"$CHARLIE\",
  \"expectedDeliverables\": [\"web\"]
}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))")
log "  Task ID: $TASK_E3"

post /api/tasks/process '{}' > /dev/null
wait_for_task "$TASK_E3" 300

PREVIEW_E3=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tasks/$TASK_E3/preview")
log "  Fixed calculator preview: HTTP $PREVIEW_E3"

echo ""

######################################################################
# SCENARIO F: 다중 액션/체인 편집
######################################################################
log "=== SCENARIO F: 다중 액션/체인 편집 ==="

log "F1: Chief chat - multi-action request"
CHIEF_F=$(post /api/chief/chat "{
  \"message\": \"대시보드 위젯 3개를 만들어야 해. 1) 실시간 차트 위젯 2) 할일 목록 위젯 3) 날씨 위젯. 각각 개발자에게 배정하고 리뷰까지 체인으로 연결해줘.\",
  \"sessionId\": \"e2e-test-f\"
}")
log "  Chief response received"

CHIEF_F_MSGID=$(echo "$CHIEF_F" | python3 -c "import sys,json; print(json.load(sys.stdin).get('messageId','NONE'))")
CHIEF_F_ASYNC=$(echo "$CHIEF_F" | python3 -c "import sys,json; print(json.load(sys.stdin).get('async',False))")
log "  MessageId: $CHIEF_F_MSGID, Async: $CHIEF_F_ASYNC"

if [ "$CHIEF_F_ASYNC" = "True" ]; then
  log "F2: Waiting for async chief response..."
  sleep 30
fi

# Check chain plans
CHAINS=$(api /api/chain-plans | python3 -c "import sys,json; plans=json.load(sys.stdin); print(len(plans))")
log "F2: Chain plans count: $CHAINS"

# Check tasks created
TASKS_ALL=$(api /api/tasks | python3 -c "import sys,json; tasks=json.load(sys.stdin); print(len(tasks))")
log "  Total tasks now: $TASKS_ALL"

echo ""
echo "=== ALL SCENARIOS COMPLETED ==="

# Final state
log "Final state:"
api /api/health | python3 -m json.tool
echo ""

# Collect all results
log "Collecting results..."
MEETINGS=$(api /api/meetings | python3 -c "
import sys,json
meetings=json.load(sys.stdin)
for m in meetings:
    props=len(m.get('proposals',[]))
    print(f'  {m[\"id\"][:8]} {m[\"title\"][:40]:40} status={m[\"status\"]:10} contributions={props}')
")
echo "Meetings:"
echo "$MEETINGS"

TASKS=$(api /api/tasks | python3 -c "
import sys,json
tasks=json.load(sys.stdin)
for t in tasks:
    rlen=len(t.get('result','') or '')
    print(f'  {t[\"id\"][:8]} {t[\"title\"][:40]:40} status={t[\"status\"]:10} result_len={rlen}')
")
echo "Tasks:"
echo "$TASKS"

echo ""
echo "=== E2E Test Complete ==="
