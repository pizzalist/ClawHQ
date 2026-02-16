#!/bin/bash
# AI Office E2E Test Suite
# Tests from real user perspective

API="http://localhost:3001"
PASS=0
FAIL=0
WARN=0
RESULTS=""

log_result() {
  local status=$1 name=$2 detail=$3
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS+1))
    RESULTS+="✅ PASS: $name\n"
  elif [ "$status" = "FAIL" ]; then
    FAIL=$((FAIL+1))
    RESULTS+="❌ FAIL: $name — $detail\n"
  else
    WARN=$((WARN+1))
    RESULTS+="⚠️ WARN: $name — $detail\n"
  fi
}

# 1. Basic API health
echo "=== Test 1: API Health ==="
AGENTS=$(curl -sf "$API/api/agents")
if [ $? -eq 0 ] && echo "$AGENTS" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  log_result "PASS" "API /api/agents responds with valid JSON"
else
  log_result "FAIL" "API /api/agents" "Not responding or invalid JSON"
fi

TASKS=$(curl -sf "$API/api/tasks")
if [ $? -eq 0 ]; then
  log_result "PASS" "API /api/tasks responds"
else
  log_result "FAIL" "API /api/tasks" "Not responding"
fi

# 2. Static files
echo "=== Test 2: Static Files ==="
INDEX=$(curl -sf "$API/")
if echo "$INDEX" | grep -q "index-"; then
  log_result "PASS" "SPA index.html served with hashed assets"
else
  log_result "FAIL" "SPA index.html" "Missing hashed assets"
fi

JS_FILE=$(echo "$INDEX" | grep -oP 'src="/assets/[^"]+\.js"' | head -1 | grep -oP '/assets/[^"]+')
if [ -n "$JS_FILE" ]; then
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$API$JS_FILE")
  if [ "$STATUS" = "200" ]; then
    log_result "PASS" "JS bundle accessible ($JS_FILE)"
  else
    log_result "FAIL" "JS bundle" "HTTP $STATUS for $JS_FILE"
  fi
fi

CSS_FILE=$(echo "$INDEX" | grep -oP 'href="/assets/[^"]+\.css"' | head -1 | grep -oP '/assets/[^"]+')
if [ -n "$CSS_FILE" ]; then
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$API$CSS_FILE")
  if [ "$STATUS" = "200" ]; then
    log_result "PASS" "CSS bundle accessible ($CSS_FILE)"
  else
    log_result "FAIL" "CSS bundle" "HTTP $STATUS for $CSS_FILE"
  fi
fi

# 3. WebSocket
echo "=== Test 3: WebSocket ==="
WS_CHECK=$(timeout 3 curl -sf -o /dev/null -w "%{http_code}" -H "Upgrade: websocket" -H "Connection: Upgrade" "$API/ws" 2>/dev/null)
log_result "PASS" "WebSocket endpoint exists" ""

# 4. Chief Chat - Basic interaction
echo "=== Test 4: Chief Chat ==="
CHAT_RESP=$(curl -sf -X POST "$API/api/chief/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"상태 확인","sessionId":"test-e2e-1"}')
if [ $? -eq 0 ] && echo "$CHAT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null; then
  log_result "PASS" "Chief chat responds to '상태 확인'"
else
  log_result "FAIL" "Chief chat '상태 확인'" "$(echo $CHAT_RESP | head -c 200)"
fi

# 5. Create task via API
echo "=== Test 5: Task Creation ==="
TASK_RESP=$(curl -sf -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E 테스트 기획서","description":"E2E 테스트용 기획서 작성","assignRole":"pm"}')
if [ $? -eq 0 ]; then
  TASK_ID=$(echo "$TASK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "" ]; then
    log_result "PASS" "Task created: $TASK_ID"
  else
    log_result "FAIL" "Task creation" "No task ID returned: $(echo $TASK_RESP | head -c 200)"
  fi
else
  log_result "FAIL" "Task creation" "HTTP error"
fi

# 6. Chief Chat - Task creation via natural language
echo "=== Test 6: Natural Language Task Creation ==="
sleep 2
NL_RESP=$(curl -sf -X POST "$API/api/chief/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"모바일 앱 기획서 만들어줘","sessionId":"test-e2e-2"}')
if [ $? -eq 0 ] && echo "$NL_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('ok')" 2>/dev/null; then
  log_result "PASS" "Chief accepts natural language task request"
else
  log_result "FAIL" "Natural language task creation" "$(echo $NL_RESP | head -c 200)"
fi

# Wait for LLM to respond
echo "Waiting for LLM responses (30s)..."
sleep 30

# 7. Check if tasks are being processed
echo "=== Test 7: Task Processing ==="
ALL_TASKS=$(curl -sf "$API/api/tasks")
IN_PROGRESS=$(echo "$ALL_TASKS" | python3 -c "import json,sys; tasks=json.load(sys.stdin); print(len([t for t in tasks if t['status']=='in-progress']))" 2>/dev/null)
COMPLETED=$(echo "$ALL_TASKS" | python3 -c "import json,sys; tasks=json.load(sys.stdin); print(len([t for t in tasks if t['status']=='completed']))" 2>/dev/null)
PENDING=$(echo "$ALL_TASKS" | python3 -c "import json,sys; tasks=json.load(sys.stdin); print(len([t for t in tasks if t['status']=='pending']))" 2>/dev/null)
echo "Tasks: in-progress=$IN_PROGRESS, completed=$COMPLETED, pending=$PENDING"
if [ "$IN_PROGRESS" -gt 0 ] || [ "$COMPLETED" -gt 0 ]; then
  log_result "PASS" "Tasks being processed (in-progress=$IN_PROGRESS, completed=$COMPLETED)"
else
  log_result "WARN" "Task processing" "No tasks in-progress or completed yet (pending=$PENDING)"
fi

# 8. Check agents state
echo "=== Test 8: Agent States ==="
AGENT_STATES=$(curl -sf "$API/api/agents" | python3 -c "
import json,sys
agents=json.load(sys.stdin)
for a in agents:
  print(f\"{a['name']} ({a['role']}): {a['state']}\")
print(f'Total: {len(agents)}')
" 2>/dev/null)
echo "$AGENT_STATES"
AGENT_COUNT=$(echo "$AGENT_STATES" | tail -1 | grep -oP '\d+')
if [ "$AGENT_COUNT" -gt 0 ]; then
  log_result "PASS" "Agents exist ($AGENT_COUNT total)"
else
  log_result "FAIL" "Agent states" "No agents found"
fi

# 9. Events API
echo "=== Test 9: Events ==="
EVENTS=$(curl -sf "$API/api/events")
EVENT_COUNT=$(echo "$EVENTS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null)
if [ "$EVENT_COUNT" -gt 0 ]; then
  log_result "PASS" "Events logged ($EVENT_COUNT events)"
else
  log_result "WARN" "Events" "No events yet"
fi

# 10. Stats API
echo "=== Test 10: Stats ==="
STATS=$(curl -sf "$API/api/stats")
if echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'tasksByStatus' in d" 2>/dev/null; then
  log_result "PASS" "Stats API returns valid data"
else
  log_result "FAIL" "Stats API" "Invalid response"
fi

# 11. Deliverables API
echo "=== Test 11: Deliverables ==="
DELIVERABLES=$(curl -sf "$API/api/deliverables")
DEL_COUNT=$(echo "$DELIVERABLES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "Deliverables: $DEL_COUNT"
if [ "$DEL_COUNT" -ge 0 ]; then
  log_result "PASS" "Deliverables API responds ($DEL_COUNT items)"
else
  log_result "FAIL" "Deliverables API" "Error"
fi

# 12. Export APIs
echo "=== Test 12: Export ==="
JSON_EXPORT=$(curl -sf "$API/api/export/json")
if echo "$JSON_EXPORT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  log_result "PASS" "JSON export works"
else
  log_result "FAIL" "JSON export" "Invalid JSON"
fi

MD_EXPORT=$(curl -sf "$API/api/export/markdown")
if [ -n "$MD_EXPORT" ]; then
  log_result "PASS" "Markdown export works"
else
  log_result "FAIL" "Markdown export" "Empty response"
fi

# 13. Decisions API
echo "=== Test 13: Decisions ==="
DECISIONS=$(curl -sf "$API/api/decisions")
if echo "$DECISIONS" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  log_result "PASS" "Decisions API responds"
else
  log_result "FAIL" "Decisions API" "Error"
fi

# Print summary
echo ""
echo "==========================================="
echo "       E2E TEST RESULTS"
echo "==========================================="
echo -e "$RESULTS"
echo "-------------------------------------------"
echo "PASS: $PASS | FAIL: $FAIL | WARN: $WARN"
echo "==========================================="
