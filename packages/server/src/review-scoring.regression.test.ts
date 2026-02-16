import assert from 'node:assert/strict';
import { _parseStructuredScores as parseStructuredScores, _parseRecommendation as parseRecommendation } from './chief-agent.js';

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e instanceof Error ? e.message : e}`);
    failCount++;
  }
}

console.log('--- Review Scoring Regression Tests ---');

// T1: Parse 3 candidates with [SCORE] format
test('3 candidates → 3 score table rows', () => {
  const content = `## 점수표

[SCORE] AI 코딩 도우미 | Problem: 8/10 | Feasibility: 7/10 | Differentiation: 6/10 | Time-to-Demo: 9/10 | Risk: 7/10 | Total: 37/50
[SCORE] 스마트 일정 관리 | Problem: 7/10 | Feasibility: 8/10 | Differentiation: 5/10 | Time-to-Demo: 8/10 | Risk: 8/10 | Total: 36/50
[SCORE] 실시간 협업 보드 | Problem: 9/10 | Feasibility: 5/10 | Differentiation: 8/10 | Time-to-Demo: 4/10 | Risk: 5/10 | Total: 31/50

[RECOMMENDATION] 1순위: AI 코딩 도우미 | 이유: 높은 문제 정의 + 빠른 데모 가능 | 실행조건: GPT API 비용 확보 | Kill Criteria: 3개월 내 MAU 1000 미달
[ALTERNATIVE] 2순위: 스마트 일정 관리 | 이유: 안정적 실현 가능성`;

  const candidates = ['AI 코딩 도우미', '스마트 일정 관리', '실시간 협업 보드'];
  const scores = parseStructuredScores(content, candidates);

  assert.equal(scores.length, 3, `Expected 3 rows, got ${scores.length}`);
  assert.equal(scores[0].candidateName, 'AI 코딩 도우미');
  assert.equal(scores[0].total, 37);
  assert.ok(Object.keys(scores[0].breakdown).length >= 4, 'Breakdown should have at least 4 fields');
  assert.equal(scores[1].total, 36);
  assert.equal(scores[2].total, 31);
});

// T2: Parse [RECOMMENDATION] and [ALTERNATIVE]
test('Recommendation and alternatives parsed', () => {
  const content = `[RECOMMENDATION] 1순위: AI 코딩 도우미 | 이유: 최고 점수 | 실행조건: 예산 확보 | Kill Criteria: MAU 미달
[ALTERNATIVE] 2순위: 스마트 일정 관리 | 이유: 안정적`;

  const rec = parseRecommendation(content);
  assert.equal(rec.recommendation, 'AI 코딩 도우미');
  assert.ok(rec.reason.length > 0, 'Reason should not be empty');
  assert.equal(rec.alternatives.length, 1);
  assert.equal(rec.alternatives[0], '스마트 일정 관리');
});

// T3: Missing [SCORE] falls back to legacy N/10 pattern
test('Legacy N/10 fallback works', () => {
  const content = `AI 코딩 도우미: 8/10점으로 평가합니다.
스마트 일정 관리: 7/10`;
  const candidates = ['AI 코딩 도우미', '스마트 일정 관리'];
  const scores = parseStructuredScores(content, candidates);
  assert.equal(scores.length, 2);
  assert.equal(scores[0].total, 8);
  assert.equal(scores[1].total, 7);
});

// T4: Empty content returns empty scores (no random fallback)
test('Empty content → 0 parsed scores (no random)', () => {
  const scores = parseStructuredScores('일반적인 점수화 방법론 설명...', ['후보A', '후보B']);
  assert.equal(scores.length, 0, 'Should not produce random scores from general text');
});

// T5: Recommendation missing → empty string
test('Missing recommendation → empty', () => {
  const rec = parseRecommendation('일반 텍스트만 있음');
  assert.equal(rec.recommendation, '');
  assert.equal(rec.alternatives.length, 0);
});

console.log(`\n--- Results: ${passCount} PASS, ${failCount} FAIL ---`);
if (failCount > 0) process.exit(1);
process.exit(0);
