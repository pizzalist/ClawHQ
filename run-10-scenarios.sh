#!/bin/bash
# 10 Scenario Full Pipeline QA
API="http://localhost:3001"
REPORT="/home/noah/.openclaw/workspace/company/ai-office/app/QC_FULL_PIPELINE.md"
SESSION="qa-full-$(date +%s)"

cat > "$REPORT" << 'HEADER'
# AI Office 풀 파이프라인 QA 리포트 (10개 시나리오)
**일시:** 2026-02-17
**테스터:** Naruto (자동화)

HEADER

chat() {
  curl -sf -X POST "$API/api/chief/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"$1\",\"sessionId\":\"$SESSION\"}" 2>/dev/null
}

wait_idle() {
  local max=$1 waited=0
  while [ $waited -lt $max ]; do
    local active=$(curl -sf "$API/api/tasks" | python3 -c "import json,sys; t=json.load(sys.stdin); print(len([x for x in t if x['status'] in ('in-progress','pending')]))" 2>/dev/null)
    [ "$active" = "0" ] && return 0
    sleep 10
    waited=$((waited+10))
    echo "  ⏳ waiting... ($waited/${max}s, active=$active)"
  done
  return 1
}

get_newest_tasks() {
  curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
for t in sorted(tasks, key=lambda x: x.get('createdAt',''), reverse=True)[:$1]:
  rl=len(t.get('result','') or '')
  print(f\"{t['id'][:8]} | {t['title'][:50]:50s} | {t['status']:10s} | {rl}ch\")
" 2>/dev/null
}

task_count() {
  curl -sf "$API/api/tasks" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null
}

run_scenario() {
  local num="$1" name="$2" prompt="$3" extra_steps="$4"
  echo ""
  echo "========================================="
  echo "SCENARIO $num: $name"
  echo "========================================="
  
  local before=$(task_count)
  local start=$(date +%s)
  
  # Step 1: Send request
  echo "[$(date +%H:%M:%S)] 💬 요청: $prompt"
  chat "$prompt"
  sleep 20
  
  # Step 2: Approve
  echo "[$(date +%H:%M:%S)] 💬 승인"
  chat "응"
  sleep 10
  
  # Step 3: Wait for completion
  echo "[$(date +%H:%M:%S)] ⏳ 대기..."
  wait_idle 180
  
  # Step 4: Confirm
  echo "[$(date +%H:%M:%S)] 💬 확정"
  chat "확정"
  sleep 10
  
  # Step 5: Wait for chain
  echo "[$(date +%H:%M:%S)] ⏳ 체인 대기..."
  wait_idle 180
  
  # Optional: second confirm for longer chains
  if [ "$extra_steps" = "2confirm" ]; then
    echo "[$(date +%H:%M:%S)] 💬 2차 확정"
    chat "확정"
    sleep 10
    wait_idle 180
  fi
  
  local end=$(date +%s)
  local elapsed=$((end-start))
  local after=$(task_count)
  local new_tasks=$((after-before))
  
  echo "[$(date +%H:%M:%S)] ✅ 완료 (${elapsed}s, +${new_tasks} tasks)"
  
  # Check results
  local results=$(get_newest_tasks $new_tasks)
  echo "$results"
  
  # Write to report
  cat >> "$REPORT" << EOF

## 시나리오 $num: $name
- **요청:** $prompt
- **소요시간:** ${elapsed}초
- **생성 태스크:** ${new_tasks}건
- **결과:**
\`\`\`
$results
\`\`\`

EOF
}

# ====== RUN 10 SCENARIOS ======

run_scenario 1 "소셜커머스 MVP 기획" \
  "소셜 커머스 MVP 앱 기획서 만들어줘" "2confirm"

run_scenario 2 "REST API 설계" \
  "REST API 서버 설계해줘. 인증, 결제, 상품 API 포함." "2confirm"

run_scenario 3 "모바일 헬스케어 앱" \
  "모바일 헬스케어 앱 UI/UX 기획서 만들어줘" ""

run_scenario 4 "MSA 전환 계획서" \
  "마이크로서비스 아키텍처 전환 계획서 만들어줘" ""

run_scenario 5 "버그 수정 워크플로우" \
  "로그인 세션 만료 후 자동 로그아웃 안 되는 버그 수정해줘" ""

run_scenario 6 "AI 스타트업 기획" \
  "AI 스타트업 NeuralPet 반려동물 건강 모니터링 서비스 MVP 기획해줘" "2confirm"

run_scenario 7 "프레임워크 비교 분석" \
  "React vs Vue vs Svelte 비교 분석 문서 만들어줘" ""

run_scenario 8 "대시보드 설계" \
  "관리자 대시보드 API + UI 설계 문서 만들어줘" ""

run_scenario 9 "푸시 알림 시스템" \
  "모바일 푸시 알림 시스템 설계서 작성해줘" ""

run_scenario 10 "결제 시스템 설계" \
  "PG 연동 결제 시스템 아키텍처 설계해줘" ""

# ====== FINAL SUMMARY ======
echo ""
echo "========================================="
echo "FINAL SUMMARY"
echo "========================================="

FINAL_STATS=$(curl -sf "$API/api/tasks" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
by_status={}
total_result=0
for t in tasks:
  s=t['status']
  by_status[s]=by_status.get(s,0)+1
  total_result+=len(t.get('result','') or '')
print(f'Total tasks: {len(tasks)}')
for k,v in sorted(by_status.items()):
  print(f'  {k}: {v}')
print(f'Total result chars: {total_result}')
" 2>/dev/null)
echo "$FINAL_STATS"

AGENT_STATS=$(curl -sf "$API/api/agents" | python3 -c "
import json,sys
agents=json.load(sys.stdin)
for a in agents:
  print(f\"  {a['name']} ({a['role']}): {a['state']}\")
" 2>/dev/null)
echo "Agents:"
echo "$AGENT_STATS"

cat >> "$REPORT" << EOF

---

## 최종 요약

### 태스크 통계
\`\`\`
$FINAL_STATS
\`\`\`

### 에이전트 상태
\`\`\`
$AGENT_STATS
\`\`\`

### 결론
10개 시나리오 순차 실행 완료. 세부 결과는 각 시나리오 섹션 참조.
EOF

echo ""
echo "Report saved to $REPORT"
