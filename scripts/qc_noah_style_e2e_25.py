import json, subprocess, time, re
from pathlib import Path

APP = Path('/home/noah/.openclaw/workspace/company/ai-office/app')
OUT_E2E = APP / 'QC_NOAH_STYLE_E2E.md'
OUT_BUGS = APP / 'QC_NOAH_STYLE_BUGS.md'

CASES = [
 ('N01','조회',['현재 진행/대기/완료 개수만 알려줘.'],'NO_CREATE_TASK'),
 ('N02','조회',['방금 상태를 한 줄로 다시 말해줘.'],'NO_CREATE_TASK'),
 ('N03','조회',['지금 뭐가 막혀있는지 조회만 해줘. 실행 제안은 하지마.'],'NO_CREATE_TASK'),
 ('N04','조회',['오늘 완료된 일만 요약해줘.'],'NO_CREATE_TASK'),
 ('N05','조회',['실패 태스크 목록이 있는지 확인만 해줘.'],'NO_CREATE_TASK'),
 ('N06','승인피드백',['랜딩페이지 초안 만들어줘. 먼저 승인 대기 형태로 보여줘.','승인','진행중이야?','언제줘?','상태 재확인'],'APPROVAL_FEEDBACK'),
 ('N07','승인피드백',['고객 인터뷰 질문지 10개 준비해줘. 승인 대기로.','승인','진행중이야?','상태 재확인'],'APPROVAL_FEEDBACK'),
 ('N08','승인피드백',['버그 리포트 템플릿 만들어줘. 승인 문구 먼저.','승인','언제줘?'],'APPROVAL_FEEDBACK'),
 ('N09','승인피드백',['주간 보고서 초안 작성해줘. 승인 대기 후 진행.','승인','진행중이야?'],'APPROVAL_FEEDBACK'),
 ('N10','승인피드백',['API 명세 v1 정리해줘. 승인 후 실행.','승인','상태 재확인'],'APPROVAL_FEEDBACK'),
 ('N11','다중액션',['PM 1명 추가하고, 개발자 1명 추가하고, 테스트 태스크 1개 생성까지 순서대로 진행해줘.'],'MULTI_ACTION_SEQ'),
 ('N12','다중액션',['대기 작업 정리하고, 실패 작업 요약하고, 다음 우선순위 3개 제안해줘.'],'MULTI_ACTION_SEQ'),
 ('N13','다중액션',['요구사항 정리 -> QA 체크리스트 -> 개발 전달 문안까지 한 번에 해줘.'],'MULTI_ACTION_SEQ'),
 ('N14','다중액션',['백로그 정리하고, 오늘 할 일 3개 뽑고, 완료 기준까지 적어줘.'],'MULTI_ACTION_SEQ'),
 ('N15','다중액션',['리뷰 코멘트 요약 후, 수정요청 초안 만들고, 재확정 메시지까지 준비해줘.'],'MULTI_ACTION_SEQ'),
 ('N16','QADev체인',['QC 붙여서 리뷰하고 개발자가 반영하는 흐름으로 진행안 줘.','좋아, 그 체인으로 진행해.','개발 반영됐는지 상태 재확인'],'QA_DEV_CHAIN'),
 ('N17','QADev체인',['기능 초안 만들고 QA 리뷰 거쳐 dev 반영까지 추천 플로우 제안해줘.','확정. 그대로 진행.','언제줘?'],'QA_DEV_CHAIN'),
 ('N18','QADev체인',['QA 먼저 보고 dev는 필요하면 반영하는 방식으로 해줘. 강제는 말고.','확정','상태 재확인'],'QA_DEV_CHAIN'),
 ('N19','QADev체인',['리뷰 체인을 추천형으로만 안내해줘. 바로 강제 실행은 하지마.','승인','진행중이야?'],'QA_DEV_CHAIN'),
 ('N20','명칭노출',['테스트 모드로 돌리되 사용자에게 테스트용 에이전트 이름은 보이지 않게 설명해줘.'],'HIDE_TEST_AGENT_NAME'),
 ('N21','명칭노출',['QC 자동화 담당 이름 같은 내부 식별자는 노출하지 말고 상태만 말해줘.'],'HIDE_TEST_AGENT_NAME'),
 ('N22','명칭노출',['내부 테스트 워커명이 있으면 가리고 사용자용 결과만 보여줘.'],'HIDE_TEST_AGENT_NAME'),
 ('N23','게임실행',['게임 만들어줘. 그리고 실행 확인할 때 빈 화면이면 경고까지 해줘.'],'GAME_BLANK_WARNING'),
 ('N24','게임실행',['웹 데모 하나 만들어줘. 실행 안 되거나 빈 화면이면 체크리스트로 알려줘.'],'GAME_BLANK_WARNING'),
 ('N25','게임실행',['간단한 브라우저 게임 결과 검증 절차를 사용자용으로 안내해줘(빈 화면 탐지 포함).'],'GAME_BLANK_WARNING'),
]

RX = {
 'createTask': re.compile(r'(create[_-]?task|태스크\s*생성|작업\s*생성|새\s*작업\s*만들)', re.I),
 'approved': re.compile(r'(승인됨|승인\s*완료|승인\s*처리)', re.I),
 'running': re.compile(r'(실행\s*중|진행\s*중|처리\s*중)', re.I),
 'done': re.compile(r'(완료|끝났|결과\s*준비|전달\s*완료)', re.I),
 'nextStep': re.compile(r'(다음\s*단계|다음\s*액션|다음\s*진행)', re.I),
 'seqCue': re.compile(r'(1\.|2\.|3\.|먼저|다음|이후|마지막|순서)', re.I),
 'qaDev': re.compile(r'(QA|품질|리뷰).*(개발|dev)|(개발|dev).*(QA|리뷰)', re.I|re.S),
 'recommendNotForce': re.compile(r'(추천|권장|선택|확정\s*시|원하면|강제\s*아님|강제가\s*아님)', re.I),
 'testAgent': re.compile(r'(test agent|테스트\s*에이전트|qc-agent|mock-agent|dummy-agent|자동화\s*워커\s*명)', re.I),
 'gameWarn': re.compile(r'(빈\s*화면|white\s*screen|blank\s*screen|렌더링\s*실패|콘솔\s*에러|경고)', re.I),
}


def call_agent(session_id, message):
  cmd = ['timeout','-k','5s','45s','openclaw','agent','--session-id',session_id,'--message',message,'--json','--local']
  p = subprocess.run(cmd, capture_output=True, text=True, cwd=APP, timeout=60)
  if p.returncode != 0:
    if p.returncode == 124:
      raise RuntimeError('timeout(45s)')
    raise RuntimeError(p.stderr.strip() or f'rc={p.returncode}')
  j = json.loads(p.stdout)
  text = '\n'.join((x.get('text','') for x in j.get('payloads',[]))).strip()
  am = j.get('meta',{}).get('agentMeta',{})
  provider, model = am.get('provider','unknown'), am.get('model','unknown')
  return {
    'text': text,
    'provider': provider,
    'model': model,
    'durationMs': j.get('meta',{}).get('durationMs',0),
    'llmOk': provider!='unknown' and model!='unknown' and ('demo mode' not in text.lower()) and ('fallback' not in text.lower())
  }


def eval_case(rule, turns):
  all_text = '\n'.join(t['text'] for t in turns)
  ok = all(t['llmOk'] for t in turns)
  notes = []
  if not ok: notes.append('실 LLM 경로(meta.provider/model) 또는 demo/fallback 검증 실패')

  if rule=='NO_CREATE_TASK' and RX['createTask'].search(all_text):
    ok=False; notes.append('조회성 질문에 create_task/작업생성 제안 노출')
  if rule=='APPROVAL_FEEDBACK':
    has = RX['approved'].search(all_text) and RX['running'].search(all_text) and (RX['done'].search(all_text) or RX['nextStep'].search(all_text))
    if not has: ok=False; notes.append('승인 후 피드백(승인됨/실행중/완료/다음단계) 일관 노출 부족')
  if rule=='MULTI_ACTION_SEQ' and not RX['seqCue'].search(all_text):
    ok=False; notes.append('다중 액션 순차 진행 안내 신호 부족')
  if rule=='QA_DEV_CHAIN':
    if not (RX['qaDev'].search(all_text) and RX['recommendNotForce'].search(all_text)):
      ok=False; notes.append('QA->Dev 흐름의 추천+확정 체인 표현 부족')
  if rule=='HIDE_TEST_AGENT_NAME' and RX['testAgent'].search(all_text):
    ok=False; notes.append('테스트용 에이전트 명칭 노출 감지')
  if rule=='GAME_BLANK_WARNING' and not RX['gameWarn'].search(all_text):
    ok=False; notes.append('게임/web 실행 가능성 점검 또는 빈 화면 경고 부족')

  if not notes: notes=['이상 없음']
  return ok, notes


def short(s,n=220):
  s=' '.join((s or '').split())
  return s[:n]+'...' if len(s)>n else s

results=[]
for cid, cat, steps, rule in CASES:
  sid = f'qc-noah-{cid.lower()}-{int(time.time()*1000)}'
  turns=[]
  print(f'RUN {cid} ({len(steps)} turns)...', end='', flush=True)
  for msg in steps:
    try:
      t = call_agent(sid, msg)
      turns.append(t)
      print('✓', end='', flush=True)
    except Exception as e:
      turns.append({'text':str(e),'provider':'unknown','model':'unknown','durationMs':0,'llmOk':False})
      print('✗', end='', flush=True)
      break
  p, notes = eval_case(rule, turns)
  results.append({'id':cid,'cat':cat,'steps':steps,'rule':rule,'turns':turns,'pass':p,'notes':notes})
  print(' PASS' if p else ' FAIL')


total=len(results)
pass_count=sum(1 for r in results if r['pass'])
fails=[r for r in results if not r['pass']]

req_groups = [
 ('1) 조회성 질문에서 create_task 제안 금지','NO_CREATE_TASK'),
 ('2) 승인 후 채팅 피드백 일관 노출','APPROVAL_FEEDBACK'),
 ('3) 다중 액션 자동 순차 진행 + 안내','MULTI_ACTION_SEQ'),
 ('4) QA->Dev 추천+확정 체인','QA_DEV_CHAIN'),
 ('5) 테스트용 에이전트 명칭 노출 금지','HIDE_TEST_AGENT_NAME'),
 ('6) 게임/web 실행 가능성 + 빈 화면 탐지/경고','GAME_BLANK_WARNING'),
]

expect_map = {
 'NO_CREATE_TASK':'조회성 답변만 제공, create_task/작업 생성 제안 없음',
 'APPROVAL_FEEDBACK':'승인 후 승인됨→실행중→완료(또는 다음단계) 피드백이 일관 노출',
 'MULTI_ACTION_SEQ':'여러 액션을 자동 순차 처리하며 단계 안내 제공',
 'QA_DEV_CHAIN':'QA->Dev는 강제 아닌 추천 후 사용자 확정 체인으로 진행',
 'HIDE_TEST_AGENT_NAME':'내부 테스트용 에이전트 명칭 비노출',
 'GAME_BLANK_WARNING':'게임/web 결과 실행 가능성 안내 + 빈 화면 탐지/경고 포함',
}

lines=[]
lines.append('# QC_NOAH_STYLE_E2E\n')
lines.append(f'- 실행 시각: {time.strftime("%Y-%m-%dT%H:%M:%S%z")}')
lines.append(f'- 프로젝트: {APP}')
lines.append('- 테스트 방식: 사용자(노아) 실제 패턴 기반 실 LLM 경로 E2E (openclaw agent --json --local)')
lines.append('- 패턴 반영: 지시→승인→실행확인, 진행중/언제줘/상태재확인 추적질문, 게임 요청+빈화면 경고, QA->Dev 체인, 수정/재확정 흐름')
lines.append(f'- 총 케이스: {total} (최소 25 충족)')
lines.append(f'- 결과: PASS {pass_count} / FAIL {total-pass_count}\n')
lines.append('## 필수 검증 항목 요약')
for title, rule in req_groups:
  rows=[r for r in results if r['rule']==rule]
  p=sum(1 for r in rows if r['pass'])
  lines.append(f'- {title}: {p}/{len(rows)}')
lines.append('\n## 케이스별 상세(입력/기대/실제/PASS-FAIL/근거)\n')
for r in results:
  actual=' | '.join([f"T{i+1}: {short(t['text'])} [{t['provider']}/{t['model']}, {t['durationMs']}ms]" for i,t in enumerate(r['turns'])])
  lines.append(f"### {r['id']} [{r['cat']}] {'PASS' if r['pass'] else 'FAIL'}")
  lines.append(f"- 입력: {' / '.join([f'{i+1}. {s}' for i,s in enumerate(r['steps'])])}")
  lines.append(f"- 기대: {expect_map[r['rule']]}")
  lines.append(f"- 실제: {actual}")
  lines.append(f"- 판정: {'PASS' if r['pass'] else 'FAIL'}")
  lines.append(f"- 근거: {'; '.join(r['notes'])}\n")
lines.append('## 종합 판단')
lines.append('- 실사용 관점에서 주요 사용자 패턴을 실제 LLM 경로로 재현해 검증함.')
lines.append('- FAIL 케이스는 BUG 리포트로 분리하여 재현조건/영향/개선안 제시.')
OUT_E2E.write_text('\n'.join(lines), encoding='utf-8')

bl=[]
bl.append('# QC_NOAH_STYLE_BUGS\n')
bl.append(f'- 생성 시각: {time.strftime("%Y-%m-%dT%H:%M:%S%z")}')
bl.append('- 기준: QC_NOAH_STYLE_E2E 실패 케이스\n')
if not fails:
  bl.append('## BUG 없음')
  bl.append('- 25/25 케이스 PASS (관찰된 차단 이슈 없음)')
else:
  for i,r in enumerate(fails,1):
    sev='High' if r['rule'] in ('APPROVAL_FEEDBACK','GAME_BLANK_WARNING') else 'Medium'
    bl.append(f"## BUG-{i:03d} [{sev}] {r['id']} {r['cat']}")
    bl.append(f"- 재현 입력: {' -> '.join(r['steps'])}")
    bl.append(f"- 기대 동작: {expect_map[r['rule']]}")
    bl.append(f"- 실제 동작: {short(' | '.join([t['text'] for t in r['turns']]),500)}")
    bl.append('- 영향: 사용자(노아) 실제 운영 패턴에서 신뢰도/예측가능성 저하')
    bl.append(f"- 근거: {'; '.join(r['notes'])}")
    bl.append('- 수정 제안: 승인 상태 템플릿/체인 가이드/빈화면 경고 템플릿/내부 명칭 마스킹 후처리 + 회귀테스트 추가\n')
OUT_BUGS.write_text('\n'.join(bl), encoding='utf-8')

print(json.dumps({'ok':True,'total':total,'pass':pass_count,'fail':total-pass_count,'out':[str(OUT_E2E),str(OUT_BUGS)]}, ensure_ascii=False, indent=2))
