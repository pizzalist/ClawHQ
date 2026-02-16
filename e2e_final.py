#!/usr/bin/env python3
"""AI Office E2E Project-Level Test - 6 Scenarios (Final)"""
import requests, time, json, sys, traceback
from datetime import datetime

BASE = "http://localhost:3001"
RESULTS = []
BUGS = []
START_TIME = datetime.now()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def api(path, method="GET", data=None):
    url = f"{BASE}{path}"
    try:
        if method == "POST":
            r = requests.post(url, json=data, timeout=60)
        elif method == "PUT":
            r = requests.put(url, json=data, timeout=60)
        elif method == "DELETE":
            r = requests.delete(url, timeout=30)
        else:
            r = requests.get(url, timeout=30)
        return r.json() if r.text.strip() else {}
    except Exception as e:
        log(f"  API error: {e}")
        return {}

def wait_meeting(mid, max_wait=240):
    elapsed = 0
    while elapsed < max_wait:
        m = api(f"/api/meetings/{mid}")
        if m.get("status") == "completed":
            log(f"  Meeting completed ({elapsed}s), contributions={len(m.get('proposals',[]))}")
            return m
        time.sleep(10)
        elapsed += 10
    log(f"  Meeting TIMEOUT ({max_wait}s)")
    return api(f"/api/meetings/{mid}")

def wait_task(tid, max_wait=300):
    elapsed = 0
    while elapsed < max_wait:
        t = api(f"/api/tasks/{tid}")
        status = t.get("status")
        if status == "completed":
            rlen = len(t.get("result", "") or "")
            log(f"  Task completed ({elapsed}s), result_len={rlen}")
            return t
        if status == "failed":
            log(f"  Task FAILED ({elapsed}s)")
            return t
        if status is None:
            log(f"  Task NOT FOUND ({elapsed}s)")
            return t
        time.sleep(10)
        elapsed += 10
    log(f"  Task TIMEOUT ({max_wait}s, status={api(f'/api/tasks/{tid}').get('status')})")
    return api(f"/api/tasks/{tid}")

def score_result(scenario, checks):
    passed = sum(1 for c in checks if c)
    total = len(checks)
    score = round((passed / total) * 10, 1) if total else 0
    status = "PASS" if score >= 6 else "FAIL"
    return {"scenario": scenario, "score": score, "status": status, "passed": passed, "total": total}

# SETUP
log("=== SETUP ===")
agents = {a['name']: a['id'] for a in api("/api/agents")}
for name, aid in agents.items():
    api(f"/api/agents/{aid}/reset", "POST")
log(f"Team: {list(agents.keys())}")

################################################################
# A: 나루토 미니게임
################################################################
log("\n" + "="*60)
log("SCENARIO A: 나루토 미니게임 프로토타입")
log("="*60)

log("A1: Meeting (4 agents)")
meet_a = api("/api/meetings", "POST", {
    "title": "나루토 미니게임 프로토타입 기획",
    "description": "나루토 테마 HTML5 Canvas 수리검 던지기 미니게임. 키보드 조종, 적 맞추기, 점수.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Charlie"], agents["Eve"]],
    "character": "brainstorm"
})
meet_a_result = wait_meeting(meet_a["id"])
a_meet_ok = meet_a_result.get("status") == "completed"
a_meet_multi = len(meet_a_result.get("proposals", [])) >= 3
a_report = bool(meet_a_result.get("report"))

log("A2: Dev task (Bob)")
task_a = api("/api/tasks", "POST", {
    "title": "나루토 수리검 미니게임 구현",
    "description": "HTML5 Canvas+JS 나루토 수리검 던지기 게임. 단일 HTML. 방향키 이동, 스페이스 발사, 적 랜덤, 점수, 게임오버/재시작.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["web"]
})
api("/api/tasks/process", "POST")
task_a_result = wait_task(task_a["id"])
a_task_ok = task_a_result.get("status") == "completed"

delivs_a = api(f"/api/deliverables?taskId={task_a['id']}")
a_deliv = len(delivs_a) > 0
try:
    a_preview = requests.get(f"{BASE}/api/tasks/{task_a['id']}/preview", timeout=10).status_code == 200
except:
    a_preview = False
a_valid = False
if delivs_a:
    v = api(f"/api/deliverables/{delivs_a[0]['id']}/validate")
    a_valid = v.get("valid", False)
    if not a_valid:
        BUGS.append({"scenario":"A", "issue": f"Web validation: {v.get('issues',[])}","severity":"Major","fix":"N/A"})

result_a = score_result("A: 나루토 미니게임", [a_meet_ok, a_meet_multi, a_report, a_task_ok, a_deliv, a_preview, a_valid])
RESULTS.append({**result_a, "timeline": f"Meeting 30s + Task ~60s"})
log(f"RESULT: {result_a['status']} ({result_a['score']}/10)")

################################################################
# B: 랜딩페이지
################################################################
log("\n" + "="*60)
log("SCENARIO B: 랜딩페이지 제작")
log("="*60)

log("B1: Meeting (4 agents)")
meet_b = api("/api/meetings", "POST", {
    "title": "SaaS 랜딩페이지 기획",
    "description": "AI SaaS 랜딩페이지. Hero, 기능소개, 가격표, CTA, 반응형.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Eve"], agents["Diana"]],
    "character": "planning"
})
meet_b_result = wait_meeting(meet_b["id"])
b_meet_ok = meet_b_result.get("status") == "completed"
b_meet_multi = len(meet_b_result.get("proposals", [])) >= 3

log("B2: Dev task (Charlie)")
task_b = api("/api/tasks", "POST", {
    "title": "AI SaaS 랜딩페이지 구현",
    "description": "반응형 SaaS 랜딩페이지 단일 HTML. Hero+CTA, 기능 3개, 가격표, FAQ, 푸터. Tailwind CDN. 다크 모드.",
    "assigneeId": agents["Charlie"],
    "expectedDeliverables": ["web"]
})
api("/api/tasks/process", "POST")
task_b_result = wait_task(task_b["id"])
b_task_ok = task_b_result.get("status") == "completed"

delivs_b = api(f"/api/deliverables?taskId={task_b['id']}")
b_deliv = len(delivs_b) > 0
try:
    b_preview = requests.get(f"{BASE}/api/tasks/{task_b['id']}/preview", timeout=10).status_code == 200
except:
    b_preview = False
b_valid = False
if delivs_b:
    v = api(f"/api/deliverables/{delivs_b[0]['id']}/validate")
    b_valid = v.get("valid", False)

result_b = score_result("B: 랜딩페이지", [b_meet_ok, b_meet_multi, b_task_ok, b_deliv, b_preview, b_valid])
RESULTS.append({**result_b, "timeline": "Meeting 30s + Task ~60s"})
log(f"RESULT: {result_b['status']} ({result_b['score']}/10)")

################################################################
# C: 분석 리포트
################################################################
log("\n" + "="*60)
log("SCENARIO C: 분석 리포트 + 검토")
log("="*60)

log("C1: Meeting (3 agents)")
meet_c = api("/api/meetings", "POST", {
    "title": "AI Office 품질 분석 방법론",
    "description": "품질 분석 리포트 방법론. 메트릭, 테스트 커버리지, 성능.",
    "participantIds": [agents["Alice"], agents["Diana"], agents["Grace"]],
    "character": "review"
})
meet_c_result = wait_meeting(meet_c["id"])
c_meet_ok = meet_c_result.get("status") == "completed"
c_meet_multi = len(meet_c_result.get("proposals", [])) >= 3

log("C2: Report task (Diana - reviewer)")
task_c = api("/api/tasks", "POST", {
    "title": "AI Office 품질 분석 리포트",
    "description": "AI Office 코드 품질/아키텍처/테스트 분석 마크다운 리포트. 아키텍처 개요, 코드 품질, 테스트 커버리지, 개선 권장, 리스크.",
    "assigneeId": agents["Diana"],
    "expectedDeliverables": ["report"]
})
api("/api/tasks/process", "POST")
task_c_result = wait_task(task_c["id"])
c_task_ok = task_c_result.get("status") == "completed"
c_result_len = len(task_c_result.get("result", "") or "")
c_quality = c_result_len > 500

result_c = score_result("C: 분석 리포트", [c_meet_ok, c_meet_multi, c_task_ok, c_quality, c_result_len > 200])
RESULTS.append({**result_c, "timeline": "Meeting 40s + Task ~30s"})
log(f"RESULT: {result_c['status']} ({result_c['score']}/10)")

################################################################
# D: API 구현
################################################################
log("\n" + "="*60)
log("SCENARIO D: API 구현 + 리뷰")
log("="*60)

log("D1: Meeting (4 agents)")
meet_d = api("/api/meetings", "POST", {
    "title": "REST API 설계 회의",
    "description": "사용자 관리 REST API. CRUD, 인증, 에러 핸들링, 페이지네이션.",
    "participantIds": [agents["Alice"], agents["Bob"], agents["Diana"], agents["Frank"]],
    "character": "planning"
})
meet_d_result = wait_meeting(meet_d["id"])
d_meet_ok = meet_d_result.get("status") == "completed"
d_meet_multi = len(meet_d_result.get("proposals", [])) >= 3

log("D2: API task (Bob)")
task_d = api("/api/tasks", "POST", {
    "title": "사용자 관리 REST API 구현",
    "description": "Express.js 사용자 REST API. GET/POST/PUT/DELETE /users. JWT, 검증, 에러핸들링. TypeScript.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["api", "code"]
})
api("/api/tasks/process", "POST")
task_d_result = wait_task(task_d["id"])
d_task_ok = task_d_result.get("status") == "completed"
d_result_len = len(task_d_result.get("result", "") or "")

delivs_d = api(f"/api/deliverables?taskId={task_d['id']}")
d_deliv = len(delivs_d) > 0

result_d = score_result("D: API 구현", [d_meet_ok, d_meet_multi, d_task_ok, d_result_len > 300, d_deliv])
RESULTS.append({**result_d, "timeline": "Meeting 30s + Task ~60s"})
log(f"RESULT: {result_d['status']} ({result_d['score']}/10)")

################################################################
# E: 오류 재현/수정
################################################################
log("\n" + "="*60)
log("SCENARIO E: 오류 재현/수정 루프")
log("="*60)

log("E1: Buggy calculator (Bob)")
task_e1 = api("/api/tasks", "POST", {
    "title": "버그 포함 계산기",
    "description": "HTML/JS 계산기. 의도적 버그: 0 나눗셈 에러X, 소수점 중복, 음수 미지원.",
    "assigneeId": agents["Bob"],
    "expectedDeliverables": ["web"]
})
api("/api/tasks/process", "POST")
task_e1_result = wait_task(task_e1["id"])
e1_ok = task_e1_result.get("status") == "completed"

log("E2: QA report (Grace)")
task_e2 = api("/api/tasks", "POST", {
    "title": "계산기 QA 버그 리포트",
    "description": "계산기 버그 분석: 재현단계, 예상/실제 동작, 심각도, 수정 제안. 주요: 0 나눗셈, 소수점 중복, 음수.",
    "assigneeId": agents["Grace"],
    "expectedDeliverables": ["report"]
})
api("/api/tasks/process", "POST")
task_e2_result = wait_task(task_e2["id"])
e2_ok = task_e2_result.get("status") == "completed"

log("E3: Fix (Charlie)")
task_e3 = api("/api/tasks", "POST", {
    "title": "계산기 버그 수정",
    "description": "수정: 0 나눗셈→Error, 소수점 중복 방지, 음수 지원. 전체 HTML/JS.",
    "assigneeId": agents["Charlie"],
    "expectedDeliverables": ["web"]
})
api("/api/tasks/process", "POST")
task_e3_result = wait_task(task_e3["id"])
e3_ok = task_e3_result.get("status") == "completed"
try:
    e3_preview = requests.get(f"{BASE}/api/tasks/{task_e3['id']}/preview", timeout=10).status_code == 200
except:
    e3_preview = False

result_e = score_result("E: 오류 재현/수정", [e1_ok, e2_ok, e3_ok, e3_preview, e1_ok and e2_ok and e3_ok])
RESULTS.append({**result_e, "timeline": "Buggy→QA→Fix chain"})
log(f"RESULT: {result_e['status']} ({result_e['score']}/10)")

################################################################
# F: 다중 액션/체인
################################################################
log("\n" + "="*60)
log("SCENARIO F: 다중 액션/체인 편집")
log("="*60)

log("F1: Chief chat")
chief = api("/api/chief/chat", "POST", {
    "message": "실시간 차트 위젯을 HTML로 구현해줘.",
    "sessionId": "e2e-final-f"
})
f_chief_ok = "messageId" in chief
log(f"  Chief OK={f_chief_ok}, async={chief.get('async')}")

if chief.get("async"):
    time.sleep(20)

# Check chain plans
chains = api("/api/chain-plans")
f_chains = len(chains) > 0
log(f"  Chains: {len(chains)}")

# Test chain edit
f_edit_ok = False
if chains:
    c = chains[0]
    try:
        edited = api(f"/api/chain-plans/{c['id']}/steps", "PUT", {
            "steps": c["steps"] + [{"role": "qa", "label": "QA", "reason": "최종 확인"}]
        })
        f_edit_ok = "steps" in edited
    except:
        pass

# Stats
stats = api("/api/stats")
f_stats_ok = "total" in stats

# Meetings report
f_meetings_report = False
all_meetings = api("/api/meetings")
for m in all_meetings:
    if m.get("report"):
        f_meetings_report = True
        break

# Notifications via chief 
chief_msgs = api("/api/chief/chat", "POST", {"message": "상태 확인", "sessionId": "e2e-final-f"})
f_status_ok = "messageId" in chief_msgs

result_f = score_result("F: 다중 액션/체인", [f_chief_ok, f_chains, f_edit_ok, f_stats_ok, f_meetings_report, f_status_ok])
RESULTS.append({**result_f, "timeline": "Chief + Chain + Stats"})
log(f"RESULT: {result_f['status']} ({result_f['score']}/10)")

################################################################
# SUMMARY
################################################################
log("\n" + "="*60)
log("FINAL SUMMARY")
log("="*60)

total_pass = sum(1 for r in RESULTS if r["status"] == "PASS")
total_fail = sum(1 for r in RESULTS if r["status"] == "FAIL")
avg_score = sum(r["score"] for r in RESULTS) / len(RESULTS)

for r in RESULTS:
    log(f"  {r['status']} {r['scenario']:30} {r['score']}/10 ({r['passed']}/{r['total']})")

log(f"\nOverall: {total_pass} PASS / {total_fail} FAIL, Avg: {avg_score:.1f}/10")
log(f"Bugs: {len(BUGS)}")
log(f"Duration: {(datetime.now() - START_TIME).seconds}s")

# Save
with open("/home/noah/.openclaw/workspace/company/ai-office/app/e2e_results.json", "w") as f:
    json.dump({"results": RESULTS, "bugs": BUGS, "timestamp": datetime.now().isoformat(),
               "duration_s": (datetime.now() - START_TIME).seconds}, f, ensure_ascii=False, indent=2)

log("Results saved to e2e_results.json")
