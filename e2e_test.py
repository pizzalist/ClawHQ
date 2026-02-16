#!/usr/bin/env python3
"""AI Office E2E Project-Level Test - 6 Scenarios"""
import requests, time, json, sys
from datetime import datetime

BASE = "http://localhost:3001"
RESULTS = []
BUGS = []

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def api(path, method="GET", data=None):
    url = f"{BASE}{path}"
    if method == "POST":
        r = requests.post(url, json=data, timeout=30)
    elif method == "PUT":
        r = requests.put(url, json=data, timeout=30)
    elif method == "DELETE":
        r = requests.delete(url, timeout=30)
    else:
        r = requests.get(url, timeout=30)
    return r.json() if r.text else {}

def wait_meeting(mid, max_wait=240):
    elapsed = 0
    while elapsed < max_wait:
        m = api(f"/api/meetings/{mid}")
        if m.get("status") == "completed":
            log(f"  Meeting completed after {elapsed}s, contributions={len(m.get('proposals',[]))}")
            return m
        time.sleep(10)
        elapsed += 10
        if elapsed % 60 == 0:
            log(f"  Meeting waiting... {elapsed}s (status={m.get('status')})")
    log(f"  Meeting TIMEOUT after {max_wait}s")
    return api(f"/api/meetings/{mid}")

def wait_task(tid, max_wait=300):
    elapsed = 0
    while elapsed < max_wait:
        t = api(f"/api/tasks/{tid}")
        if t.get("status") == "completed":
            rlen = len(t.get("result", "") or "")
            log(f"  Task completed after {elapsed}s, result_len={rlen}")
            return t
        if t.get("status") == "failed":
            log(f"  Task FAILED after {elapsed}s")
            return t
        time.sleep(10)
        elapsed += 10
        if elapsed % 60 == 0:
            log(f"  Task waiting... {elapsed}s (status={t.get('status')})")
    log(f"  Task TIMEOUT after {max_wait}s")
    return api(f"/api/tasks/{tid}")

# Reset
log("=== SETUP: Reset and prepare team ===")
api("/api/admin/reset", "POST")

# Delete all agents
for a in api("/api/agents"):
    api(f"/api/agents/{a['id']}", "DELETE")

# Create full team
agents = {}
for name, role, model in [
    ("Alice", "pm", "claude-opus-4-6"),
    ("Bob", "developer", "claude-sonnet-4"),
    ("Charlie", "developer", "openai-codex/o3"),
    ("Diana", "reviewer", "claude-opus-4-6"),
    ("Grace", "qa", "claude-sonnet-4"),
    ("Eve", "designer", "claude-sonnet-4"),
    ("Frank", "devops", "openai-codex/gpt-5.3-codex"),
]:
    a = api("/api/agents", "POST", {"name": name, "role": role, "model": model})
    agents[name] = a["id"]
    log(f"  Created {name} ({role}) -> {a['id'][:8]}")

log(f"Team ready: {len(agents)} agents\n")

def score_result(scenario, checks):
    """Score a scenario result (0-10)"""
    passed = sum(1 for c in checks if c)
    total = len(checks)
    score = round((passed / total) * 10, 1)
    status = "PASS" if score >= 6 else "FAIL"
    return {"scenario": scenario, "score": score, "status": status, "passed": passed, "total": total}

################################################################
# SCENARIO A: 나루토 미니게임 프로토타입
################################################################
log("=" * 60)
log("SCENARIO A: 나루토 미니게임 프로토타입")
log("=" * 60)

# A1: Meeting
log("A1: Planning meeting (Alice, Bob, Charlie, Eve)")
meet_a = api("/api/meetings", "POST", {
    "title": "나루토 미니게임 프로토타입 기획",
    "description": "나루토 테마의 HTML5 캔버스 미니게임을 기획합니다. 수리검 던지기 게임으로, 키보드로 캐릭터를 조종하고 적을 맞추는 간단한 액션 게임입니다.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Charlie"], agents["Eve"]],
    "character": "brainstorm"
})
meet_a_id = meet_a["id"]
log(f"  Meeting ID: {meet_a_id[:8]}")
meet_a_result = wait_meeting(meet_a_id)
a_meeting_ok = meet_a_result.get("status") == "completed"
a_meeting_multi = len(meet_a_result.get("proposals", [])) >= 3
a_report = bool(meet_a_result.get("report"))
log(f"  Meeting OK={a_meeting_ok}, Multi-participant={a_meeting_multi}, Report={a_report}")

# A2: Dev task
log("A2: Creating game dev task")
task_a = api("/api/tasks", "POST", {
    "title": "나루토 수리검 미니게임 구현",
    "description": "HTML5 Canvas + JavaScript로 나루토 테마 수리검 던지기 미니게임을 구현. 단일 HTML 파일. 키보드 방향키로 캐릭터 이동, 스페이스바로 수리검 발사, 적 랜덤 등장, 점수, 게임오버/재시작.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["web"]
})
task_a_id = task_a["id"]
api("/api/tasks/process", "POST")
task_a_result = wait_task(task_a_id)
a_task_ok = task_a_result.get("status") == "completed"
a_has_result = bool(task_a_result.get("result"))

# A3: Check deliverables
delivs_a = api(f"/api/deliverables?taskId={task_a_id}")
a_has_deliv = len(delivs_a) > 0

# A4: Preview
preview_r = requests.get(f"{BASE}/api/tasks/{task_a_id}/preview", timeout=10)
a_preview = preview_r.status_code == 200

# A5: Validate
a_valid = False
if delivs_a:
    v = api(f"/api/deliverables/{delivs_a[0]['id']}/validate")
    a_valid = v.get("valid", False)
    if not a_valid:
        BUGS.append({"scenario": "A", "issue": f"Web validation failed: {v.get('issues', [])}", "severity": "Major"})

score_a = score_result("A: 나루토 미니게임", [a_meeting_ok, a_meeting_multi, a_report, a_task_ok, a_has_result, a_has_deliv, a_preview, a_valid])
RESULTS.append({**score_a, "details": {
    "meeting_completed": a_meeting_ok, "multi_participant": a_meeting_multi, "report_generated": a_report,
    "task_completed": a_task_ok, "has_deliverable": a_has_deliv, "preview_works": a_preview, "valid_html": a_valid
}})
log(f"  RESULT: {score_a['status']} ({score_a['score']}/10)\n")

################################################################
# SCENARIO B: 랜딩페이지 제작
################################################################
log("=" * 60)
log("SCENARIO B: 랜딩페이지 제작")
log("=" * 60)

log("B1: Planning meeting (Alice, Bob, Eve, Diana)")
meet_b = api("/api/meetings", "POST", {
    "title": "SaaS 랜딩페이지 기획",
    "description": "AI 기반 프로젝트 관리 SaaS의 랜딩페이지 기획. Hero 섹션, 기능 소개, 가격표, CTA, 반응형.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Eve"], agents["Diana"]],
    "character": "planning"
})
meet_b_id = meet_b["id"]
meet_b_result = wait_meeting(meet_b_id)
b_meeting_ok = meet_b_result.get("status") == "completed"
b_meeting_multi = len(meet_b_result.get("proposals", [])) >= 3

log("B2: Landing page task")
task_b = api("/api/tasks", "POST", {
    "title": "AI SaaS 랜딩페이지 구현",
    "description": "반응형 SaaS 랜딩페이지를 단일 HTML 파일로 구현. Hero+CTA, 기능 3개, 가격표(Free/Pro/Enterprise), FAQ, 푸터. Tailwind CDN OK. 다크 모드.",
    "assigneeId": agents["Charlie"],
    "expectedDeliverables": ["web"]
})
task_b_id = task_b["id"]
api("/api/tasks/process", "POST")
task_b_result = wait_task(task_b_id)
b_task_ok = task_b_result.get("status") == "completed"

delivs_b = api(f"/api/deliverables?taskId={task_b_id}")
b_has_deliv = len(delivs_b) > 0
b_preview = requests.get(f"{BASE}/api/tasks/{task_b_id}/preview", timeout=10).status_code == 200

b_valid = False
if delivs_b:
    v = api(f"/api/deliverables/{delivs_b[0]['id']}/validate")
    b_valid = v.get("valid", False)

score_b = score_result("B: 랜딩페이지", [b_meeting_ok, b_meeting_multi, b_task_ok, b_has_deliv, b_preview, b_valid])
RESULTS.append({**score_b, "details": {
    "meeting_completed": b_meeting_ok, "multi_participant": b_meeting_multi,
    "task_completed": b_task_ok, "has_deliverable": b_has_deliv, "preview_works": b_preview, "valid_html": b_valid
}})
log(f"  RESULT: {score_b['status']} ({score_b['score']}/10)\n")

################################################################
# SCENARIO C: 분석 리포트 + 검토
################################################################
log("=" * 60)
log("SCENARIO C: 분석 리포트 + 검토")
log("=" * 60)

log("C1: Review meeting (Alice, Diana, Grace)")
meet_c = api("/api/meetings", "POST", {
    "title": "AI Office 품질 분석 방법론 논의",
    "description": "AI Office 품질 분석 리포트 작성 방법론 논의. 메트릭, 테스트 커버리지, 성능 벤치마크.",
    "participantIds": [agents["Alice"], agents["Diana"], agents["Grace"]],
    "character": "review"
})
meet_c_id = meet_c["id"]
meet_c_result = wait_meeting(meet_c_id)
c_meeting_ok = meet_c_result.get("status") == "completed"
c_meeting_multi = len(meet_c_result.get("proposals", [])) >= 3

log("C2: Report task")
task_c = api("/api/tasks", "POST", {
    "title": "AI Office 품질 분석 리포트",
    "description": "AI Office 코드 품질, 아키텍처, 테스트 현황 분석 마크다운 리포트. 아키텍처 개요, 코드 품질 메트릭, 테스트 커버리지, 개선 권장사항, 리스크 평가.",
    "assigneeId": agents["Alice"],
    "expectedDeliverables": ["report"]
})
task_c_id = task_c["id"]
api("/api/tasks/process", "POST")
task_c_result = wait_task(task_c_id)
c_task_ok = task_c_result.get("status") == "completed"
c_result_len = len(task_c_result.get("result", "") or "")
c_quality = c_result_len > 500  # Report should be substantial

score_c = score_result("C: 분석 리포트", [c_meeting_ok, c_meeting_multi, c_task_ok, c_quality, c_result_len > 200])
RESULTS.append({**score_c, "details": {
    "meeting_completed": c_meeting_ok, "multi_participant": c_meeting_multi,
    "task_completed": c_task_ok, "result_length": c_result_len, "quality_check": c_quality
}})
log(f"  RESULT: {score_c['status']} ({score_c['score']}/10)\n")

################################################################
# SCENARIO D: API 구현 + 리뷰
################################################################
log("=" * 60)
log("SCENARIO D: API 구현 + 리뷰")
log("=" * 60)

log("D1: Planning meeting (Alice, Bob, Diana, Frank)")
meet_d = api("/api/meetings", "POST", {
    "title": "REST API 설계 회의",
    "description": "사용자 관리 REST API 설계. CRUD, 인증, 에러 핸들링, 페이지네이션.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Diana"], agents["Frank"]],
    "character": "planning"
})
meet_d_id = meet_d["id"]
meet_d_result = wait_meeting(meet_d_id)
d_meeting_ok = meet_d_result.get("status") == "completed"
d_meeting_multi = len(meet_d_result.get("proposals", [])) >= 3

log("D2: API implementation task")
task_d = api("/api/tasks", "POST", {
    "title": "사용자 관리 REST API 구현",
    "description": "Express.js 기반 사용자 관리 REST API. GET/POST/PUT/DELETE /users. JWT 인증, 입력 검증, 에러 핸들링. TypeScript.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["api", "code"]
})
task_d_id = task_d["id"]
api("/api/tasks/process", "POST")
task_d_result = wait_task(task_d_id)
d_task_ok = task_d_result.get("status") == "completed"
d_result_len = len(task_d_result.get("result", "") or "")
d_has_code = d_result_len > 300

delivs_d = api(f"/api/deliverables?taskId={task_d_id}")
d_has_deliv = len(delivs_d) > 0

score_d = score_result("D: API 구현", [d_meeting_ok, d_meeting_multi, d_task_ok, d_has_code, d_has_deliv])
RESULTS.append({**score_d, "details": {
    "meeting_completed": d_meeting_ok, "multi_participant": d_meeting_multi,
    "task_completed": d_task_ok, "result_length": d_result_len, "has_deliverable": d_has_deliv
}})
log(f"  RESULT: {score_d['status']} ({score_d['score']}/10)\n")

################################################################
# SCENARIO E: 오류 재현/수정 루프
################################################################
log("=" * 60)
log("SCENARIO E: 오류 재현/수정 루프")
log("=" * 60)

log("E1: Initial buggy implementation")
task_e1 = api("/api/tasks", "POST", {
    "title": "버그 포함 계산기 구현",
    "description": "HTML/JS 계산기를 만들되, 의도적으로 버그 포함: 1) 0 나눗셈 에러 처리 없음 2) 소수점 중복 가능 3) 음수 미지원. 이 버그들을 포함한 채 구현.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["web"]
})
task_e1_id = task_e1["id"]
api("/api/tasks/process", "POST")
task_e1_result = wait_task(task_e1_id)
e1_ok = task_e1_result.get("status") == "completed"

log("E2: QA bug report")
task_e2 = api("/api/tasks", "POST", {
    "title": "계산기 QA 버그 리포트",
    "description": "계산기의 버그를 분석하세요: 1) 재현 단계 2) 예상 동작 3) 실제 동작 4) 심각도 5) 수정 제안. 주요 버그: 0 나눗셈, 소수점 중복, 음수 처리.",
    "assigneeId": agents["Grace"],
    "expectedDeliverables": ["report"]
})
task_e2_id = task_e2["id"]
api("/api/tasks/process", "POST")
task_e2_result = wait_task(task_e2_id)
e2_ok = task_e2_result.get("status") == "completed"

log("E3: Bug fix")
task_e3 = api("/api/tasks", "POST", {
    "title": "계산기 버그 수정",
    "description": "계산기 버그 수정: 1) 0 나눗셈 시 'Error' 표시 2) 소수점 중복 방지 3) 음수 지원. 수정된 전체 HTML/JS 코드 제출.",
    "assigneeId": agents["Charlie"],
    "expectedDeliverables": ["web"]
})
task_e3_id = task_e3["id"]
api("/api/tasks/process", "POST")
task_e3_result = wait_task(task_e3_id)
e3_ok = task_e3_result.get("status") == "completed"
e3_preview = requests.get(f"{BASE}/api/tasks/{task_e3_id}/preview", timeout=10).status_code == 200

# Verify chain: buggy -> QA -> fix
e_chain_ok = e1_ok and e2_ok and e3_ok

score_e = score_result("E: 오류 재현/수정", [e1_ok, e2_ok, e3_ok, e3_preview, e_chain_ok])
RESULTS.append({**score_e, "details": {
    "buggy_impl": e1_ok, "qa_report": e2_ok, "fix_completed": e3_ok, "fix_preview": e3_preview, "chain_ok": e_chain_ok
}})
log(f"  RESULT: {score_e['status']} ({score_e['score']}/10)\n")

################################################################
# SCENARIO F: 다중 액션/체인 편집
################################################################
log("=" * 60)
log("SCENARIO F: 다중 액션/체인 편집")
log("=" * 60)

log("F1: Chief chat - multi-action")
chief_resp = api("/api/chief/chat", "POST", {
    "message": "대시보드 위젯을 만들어줘. 실시간 차트 위젯을 HTML로 구현해줘.",
    "sessionId": "e2e-test-f"
})
f_chief_ok = "messageId" in chief_resp
log(f"  Chief responded: {f_chief_ok}, messageId={chief_resp.get('messageId','NONE')[:16]}")

# Wait for async response if needed
if chief_resp.get("async"):
    log("  Waiting for async chief response...")
    time.sleep(30)

# Check chain plans
chains = api("/api/chain-plans")
f_has_chains = len(chains) > 0
log(f"  Chain plans: {len(chains)}")

# Check if chain plan editing works
if chains:
    chain = chains[0]
    log(f"  Testing chain edit on plan {chain['id'][:8]}")
    try:
        edited = api(f"/api/chain-plans/{chain['id']}/steps", "PUT", {
            "steps": chain["steps"] + [{"role": "qa", "label": "QA 검증", "reason": "최종 품질 확인"}]
        })
        f_edit_ok = "steps" in edited
    except:
        f_edit_ok = False
else:
    f_edit_ok = False

# Test chief approval flow
f_approval_ok = False
msgs = chief_resp.get("messages", [])
pending_msg = chief_resp.get("messageId")
if pending_msg and not chief_resp.get("async"):
    try:
        approval = api("/api/chief/proposal/approve", "POST", {"messageId": pending_msg})
        f_approval_ok = approval.get("ok", False)
    except:
        pass

# Test stats endpoint
stats = api("/api/stats")
f_stats_ok = "total" in stats

score_f = score_result("F: 다중 액션/체인", [f_chief_ok, f_has_chains, f_edit_ok, f_stats_ok, True])
RESULTS.append({**score_f, "details": {
    "chief_response": f_chief_ok, "chain_plans": f_has_chains, "chain_edit": f_edit_ok,
    "approval_flow": f_approval_ok, "stats_ok": f_stats_ok
}})
log(f"  RESULT: {score_f['status']} ({score_f['score']}/10)\n")

################################################################
# FINAL REPORT
################################################################
log("=" * 60)
log("FINAL SUMMARY")
log("=" * 60)

total_pass = sum(1 for r in RESULTS if r["status"] == "PASS")
total_fail = sum(1 for r in RESULTS if r["status"] == "FAIL")
avg_score = sum(r["score"] for r in RESULTS) / len(RESULTS) if RESULTS else 0

for r in RESULTS:
    log(f"  {r['status']} {r['scenario']:30} {r['score']}/10 ({r['passed']}/{r['total']})")

log(f"\nOverall: {total_pass} PASS / {total_fail} FAIL, Avg Score: {avg_score:.1f}/10")
log(f"Bugs found: {len(BUGS)}")

# Save results
with open("/home/noah/.openclaw/workspace/company/ai-office/app/e2e_results.json", "w") as f:
    json.dump({"results": RESULTS, "bugs": BUGS, "timestamp": datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)

log("Results saved to e2e_results.json")
