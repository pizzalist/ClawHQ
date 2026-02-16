import assert from 'node:assert/strict';
import { parseAgentOutput } from './openclaw-adapter.js';

// R1) raw fallback should strip tool/log noise while preserving report body.
{
  const raw = `assistant to=functions.exec {"command":"npm test"}

\`\`\`json
{"recipient_name":"functions.exec","parameters":{"command":"echo hi"}}
\`\`\`
{"tool_result":{"ok":true},"call_id":"abc123"}
+ npm run qa
Traceback (most recent call last):
  File "runner.py", line 1, in <module>
    raise RuntimeError("boom")
RuntimeError: boom

# 최종 보고
- 핵심 결과: 핫픽스 완료
- 회귀 테스트: PASS
`;

  const out = parseAgentOutput(raw);

  assert.ok(!/assistant\s+to=functions\./i.test(out));
  assert.ok(!/tool_result|call_id|recipient_name/i.test(out));
  assert.ok(!/Traceback \(most recent call last\):/i.test(out));
  assert.ok(!/^\s*(\+|\$)\s*(openclaw|npm|node|python|bash|sh)\b/im.test(out));

  assert.ok(out.includes('# 최종 보고'));
  assert.ok(out.includes('핫픽스 완료'));
  assert.ok(out.includes('회귀 테스트: PASS'));
}

// R2) normal markdown/report should remain intact.
{
  const normal = `# 주간 보고

## 요약
- 배포 완료
- 장애 없음

\`\`\`json
{"service":"api","status":"ok"}
\`\`\`

다음 주 계획을 진행합니다.
`;

  const out = parseAgentOutput(normal);
  assert.equal(out, normal.trim());
}

console.log('✅ openclaw adapter sanitize regression passed');
