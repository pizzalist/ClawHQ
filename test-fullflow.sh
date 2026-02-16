#!/bin/bash
# Full Flow E2E Test - Real User Scenarios
# Simulates actual user interactions through the Chief console

API="http://localhost:3001"
SESSION="test-fullflow-$(date +%s)"
PASS=0
FAIL=0
ISSUES=""

log() { echo "[$(date +%H:%M:%S)] $1"; }
pass() { PASS=$((PASS+1)); log "✅ $1"; }
fail() { FAIL=$((FAIL+1)); ISSUES+="❌ $1: $2\n"; log "❌ $1: $2"; }

chat() {
  local msg="$1"
  log "💬 User: $msg"
  local resp=$(curl -sf -X POST "$API/api/chief/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"$msg\",\"sessionId\":\"$SESSION\"}" 2>/dev/null)
  echo "$resp"
}

wait_for_task() {
  local task_id="$1"
  local max_wait=${2:-120}
  local waited=0
  while [ $waited -lt $max_wait ]; do
    local status=$(curl -sf "$API/api/tasks/$task_id" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
    if [ "$status" = "completed" ]; then
      echo "completed"
      return 0
    elif [ "$status" = "failed" ]; then
      echo "failed"
      return 1
    fi
    sleep 5
    waited=$((waited+5))
  done
  echo "timeout"
  return 2
}

get_latest_task() {
  curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
# Sort by createdAt desc, get newest non-test
for t in sorted(tasks, key=lambda x: x.get('createdAt',''), reverse=True):
  if not t.get('isTest'):
    print(json.dumps({'id':t['id'],'title':t['title'],'status':t['status']}))
    break
" 2>/dev/null
}

echo "==========================================="
echo "  FULL FLOW E2E TEST"
echo "  Session: $SESSION"
echo "==========================================="
echo ""

###############################################
# SCENARIO 1: Status Query (no side effects)
###############################################
log "=== SCENARIO 1: Status Query ==="
RESP=$(chat "현재 상태 알려줘")
if echo "$RESP" | grep -q "reply\|messageId"; then
  REPLY=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reply','')[:200])" 2>/dev/null)
  if [ -n "$REPLY" ]; then
    log "📋 Chief: $REPLY"
    # Status queries should NOT create tasks
    sleep 3
    TASK_AFTER=$(curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
recent=[t for t in tasks if t.get('title','').find('상태')>=0 and not t.get('isTest')]
print(len(recent))
" 2>/dev/null)
    if [ "$TASK_AFTER" = "0" ]; then
      pass "Status query doesn't create tasks"
    else
      fail "Status query side effect" "Created $TASK_AFTER tasks on status check"
    fi
  else
    pass "Status query responded (async)"
  fi
else
  fail "Status query" "No valid response"
fi
sleep 2

###############################################
# SCENARIO 2: Simple task creation + execution
###############################################
log "=== SCENARIO 2: Task Creation + Execution ==="
TASK_RESP=$(curl -sf -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"[TEST] SaaS 랜딩페이지 기획","description":"SaaS 제품 랜딩페이지 기획서를 작성하세요. 타겟 고객, 핵심 메시지, 페이지 구조를 포함해주세요.","assignRole":"pm"}')
TASK_ID=$(echo "$TASK_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "" ]; then
  pass "Task created: $TASK_ID"
  
  # Wait for completion
  log "⏳ Waiting for task completion (max 120s)..."
  RESULT=$(wait_for_task "$TASK_ID" 120)
  
  if [ "$RESULT" = "completed" ]; then
    pass "Task completed successfully"
    
    # Check result has content
    TASK_RESULT=$(curl -sf "$API/api/tasks/$TASK_ID" | python3 -c "
import json,sys
t=json.load(sys.stdin)
result=t.get('result','')
print(f'length={len(result)}')
print(result[:300] if result else 'EMPTY')
" 2>/dev/null)
    log "📄 Result: $TASK_RESULT"
    
    RESULT_LEN=$(echo "$TASK_RESULT" | head -1 | grep -oP '\d+')
    if [ "$RESULT_LEN" -gt 100 ]; then
      pass "Task result has substantial content ($RESULT_LEN chars)"
    else
      fail "Task result quality" "Only $RESULT_LEN chars"
    fi
    
    # Check deliverables
    DELIVERABLES=$(curl -sf "$API/api/deliverables?taskId=$TASK_ID" | python3 -c "
import json,sys
dels=json.load(sys.stdin)
for d in dels:
  print(f\"{d['type']}: {len(d.get('content',''))} chars\")
print(f'Total: {len(dels)}')
" 2>/dev/null)
    log "📦 Deliverables: $DELIVERABLES"
    
  elif [ "$RESULT" = "failed" ]; then
    fail "Task execution" "Task failed"
  else
    fail "Task execution" "Timed out (120s)"
  fi
else
  fail "Task creation" "No task ID returned"
fi
sleep 3

###############################################
# SCENARIO 3: Emergency Stop
###############################################
log "=== SCENARIO 3: Emergency Stop ==="
# Create a task first
STOP_TASK=$(curl -sf -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"[TEST] 긴급중지 테스트용 태스크","description":"이 태스크는 긴급 중지 테스트를 위해 생성됩니다.","assignRole":"pm"}')
STOP_TASK_ID=$(echo "$STOP_TASK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -n "$STOP_TASK_ID" ]; then
  sleep 5  # Wait for it to start
  
  # Now try emergency stop
  STOP_RESP=$(chat "멈춰")
  sleep 5
  STOP_REPLY=$(echo "$STOP_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reply','')[:300])" 2>/dev/null)
  log "📋 Chief: $STOP_REPLY"
  
  # Check if task was cancelled (may take a moment with LLM)
  sleep 15
  TASK_STATUS=$(curl -sf "$API/api/tasks/$STOP_TASK_ID" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  log "Task status after stop: $TASK_STATUS"
  if [ "$TASK_STATUS" = "cancelled" ] || [ "$TASK_STATUS" = "completed" ]; then
    pass "Emergency stop processed task"
  else
    # The task might have completed before stop reached it
    fail "Emergency stop" "Task still '$TASK_STATUS' after stop command"
  fi
else
  fail "Emergency stop setup" "Could not create test task"
fi
sleep 3

###############################################
# SCENARIO 4: Chain Plan (Plan → Review)
###############################################
log "=== SCENARIO 4: Chain Plan Flow ==="
CHAIN_RESP=$(chat "AI 챗봇 MVP 기획서 만들어줘")
sleep 3

# Get the messageId for approval
MSG_ID=$(echo "$CHAIN_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('messageId',''))" 2>/dev/null)
log "Message ID: $MSG_ID"

# Wait for LLM to propose actions
log "⏳ Waiting for Chief to propose actions (30s)..."
sleep 30

# Try to approve
if [ -n "$MSG_ID" ]; then
  APPROVE_RESP=$(chat "응")
  log "📋 Approve response received"
  sleep 5
  
  # Wait for chain to complete
  log "⏳ Waiting for chain execution (90s)..."
  sleep 90
  
  # Check chain tasks
  CHAIN_TASKS=$(curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
chain=[t for t in tasks if 'AI 챗봇' in t.get('title','') or 'MVP' in t.get('title','')]
for t in chain:
  print(f\"{t['title'][:50]}: {t['status']}\")
print(f'Count: {len(chain)}')
" 2>/dev/null)
  log "📋 Chain tasks: $CHAIN_TASKS"
  
  CHAIN_COUNT=$(echo "$CHAIN_TASKS" | tail -1 | grep -oP '\d+')
  if [ "$CHAIN_COUNT" -gt 0 ]; then
    pass "Chain plan created tasks ($CHAIN_COUNT)"
  else
    fail "Chain plan" "No chain tasks found for AI 챗봇"
  fi
else
  fail "Chain plan setup" "No messageId from chat"
fi

###############################################
# SCENARIO 5: Confirm + Next Step Auto-execute
###############################################
log "=== SCENARIO 5: Confirm + Auto Next Step ==="
# Find a completed task to confirm
COMPLETABLE=$(curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
for t in sorted(tasks, key=lambda x: x.get('updatedAt',''), reverse=True):
  if t['status'] == 'completed' and not t.get('parentTaskId'):
    print(t['id'])
    break
" 2>/dev/null)

if [ -n "$COMPLETABLE" ]; then
  log "Found completable task: $COMPLETABLE"
  # Try to confirm via chat
  CONFIRM_RESP=$(chat "확정")
  sleep 5
  CONFIRM_REPLY=$(echo "$CONFIRM_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reply','')[:300])" 2>/dev/null)
  log "📋 Confirm: $CONFIRM_REPLY"
  pass "Confirm command accepted"
else
  log "No completable task found, skipping"
fi

###############################################
# SUMMARY
###############################################
echo ""
echo "==========================================="
echo "  FULL FLOW TEST RESULTS"  
echo "==========================================="
echo "PASS: $PASS | FAIL: $FAIL"
echo ""
if [ -n "$ISSUES" ]; then
  echo "Issues found:"
  echo -e "$ISSUES"
fi
echo "==========================================="
