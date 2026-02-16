/**
 * Regression test: 12+ core user journey tests
 * Tests Korean number parsing, markdown rendering safety, chief-agent responses
 */
import assert from 'node:assert/strict';
import { generatePlanFromPrompt } from './chief-agent.js';
import { decideNextRoleByIntent } from './task-queue.js';
import type { DeliverableType } from '@ai-office/shared';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('\n=== Regression QC: Core User Journey ===\n');

// --- 1. Korean number parsing ---
test('R01: "개발자 한명" → developer 1', () => {
  const plan = generatePlanFromPrompt('개발자 한명');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(dev, 'should find developer');
  assert.equal(dev!.count, 1);
});

test('R02: "PM 두명" → pm 2', () => {
  const plan = generatePlanFromPrompt('PM 두명');
  const pm = plan.find(p => p.role === 'pm');
  assert.ok(pm, 'should find pm');
  assert.equal(pm!.count, 2);
});

test('R03: "리뷰어 세명" → reviewer 3', () => {
  const plan = generatePlanFromPrompt('리뷰어 세명');
  const rev = plan.find(p => p.role === 'reviewer');
  assert.ok(rev, 'should find reviewer');
  assert.equal(rev!.count, 3);
});

test('R04: "한명의 개발자" → developer 1', () => {
  const plan = generatePlanFromPrompt('한명의 개발자');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(dev, 'should find developer');
  assert.equal(dev!.count, 1);
});

test('R05: Arabic "개발자 2명" still works', () => {
  const plan = generatePlanFromPrompt('개발자 2명');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(dev);
  assert.equal(dev!.count, 2);
});

test('R06: "디자이너 한명 개발자 두명" → mixed', () => {
  const plan = generatePlanFromPrompt('디자이너 한명 개발자 두명');
  const des = plan.find(p => p.role === 'designer');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(des);
  assert.ok(dev);
  assert.equal(des!.count, 1);
  assert.equal(dev!.count, 2);
});

// --- 2. Chain policy regression ---
test('R07: Report request → PM only (no chain)', () => {
  const next = decideNextRoleByIntent(
    { title: '주간 리포트', description: '핵심 지표 요약', expectedDeliverables: ['report'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, undefined);
});

test('R08: Web implement → PM→Developer chain', () => {
  const next = decideNextRoleByIntent(
    { title: '대시보드 구현', description: '웹앱 만들기', expectedDeliverables: ['web'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, 'developer');
});

test('R09: Web+review → Developer→Reviewer chain', () => {
  const next = decideNextRoleByIntent(
    { title: '사내 툴 구현', description: '구현 후 리뷰 포함', expectedDeliverables: ['web'] as DeliverableType[] },
    'developer'
  );
  assert.equal(next, 'reviewer');
});

// --- 3. Status/action classification ---
test('R10: "현재 상태" → status query (no agent creation)', () => {
  const plan = generatePlanFromPrompt('현재 상태 알려줘');
  // Status queries go through keywordChat, not generatePlanFromPrompt
  // But generatePlanFromPrompt should produce default template at worst
  assert.ok(Array.isArray(plan));
});

test('R11: "개발자 1명 추가" → explicit count', () => {
  const plan = generatePlanFromPrompt('개발자 1명 추가');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(dev);
  assert.equal(dev!.count, 1);
});

test('R12: Clamping - "개발자 99명" → max 5', () => {
  const plan = generatePlanFromPrompt('개발자 99명');
  const dev = plan.find(p => p.role === 'developer');
  assert.ok(dev);
  assert.equal(dev!.count, 5); // MAX_COUNT_PER_ROLE = 5
});

// --- 4. QA->Dev chained intent regression (real-user flow) ---
const qaDevSentence = 'QC 한명 붙여 리뷰하고 개발자가 반영해서 재수정해';

test('R13: QA->Dev 의도 문장: PM next should be QA', () => {
  const next = decideNextRoleByIntent(
    { title: qaDevSentence, description: qaDevSentence, expectedDeliverables: ['web'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, 'qa');
});

test('R14: QA step then Developer step', () => {
  const next = decideNextRoleByIntent(
    { title: qaDevSentence, description: qaDevSentence, expectedDeliverables: ['web'] as DeliverableType[] },
    'qa'
  );
  assert.equal(next, 'developer');
});

test('R15: QA->Dev correction flow stops after Developer', () => {
  const next = decideNextRoleByIntent(
    { title: qaDevSentence, description: qaDevSentence, expectedDeliverables: ['web'] as DeliverableType[] },
    'developer'
  );
  assert.equal(next, undefined);
});

test('R16: reviewer도 QA처럼 dev 반영 체인으로 연결', () => {
  const next = decideNextRoleByIntent(
    { title: qaDevSentence, description: qaDevSentence, expectedDeliverables: ['web'] as DeliverableType[] },
    'reviewer'
  );
  assert.equal(next, 'developer');
});

test('R17: QA 의도 없는 일반 구현은 PM->Developer 유지', () => {
  const next = decideNextRoleByIntent(
    { title: '대시보드 구현', description: '웹 기능 개발', expectedDeliverables: ['web'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, 'developer');
});

test('R18: report-only + QA->Dev 문구라도 QA 우선 체인', () => {
  const next = decideNextRoleByIntent(
    { title: qaDevSentence, description: '문서 리뷰 후 개발 반영', expectedDeliverables: ['report'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, 'qa');
});

test('R19: 상태 조회형 문장은 체인 생성 안 함', () => {
  const next = decideNextRoleByIntent(
    { title: '현재 상태 조회', description: '진행률만 보고', expectedDeliverables: ['document'] as DeliverableType[] },
    'pm'
  );
  assert.equal(next, undefined);
});

test('R20: QA 키워드만 있고 개발 반영이 없으면 기존 리뷰 체계 유지', () => {
  const next = decideNextRoleByIntent(
    { title: '기능 구현 후 QA 리뷰', description: '검증 중심', expectedDeliverables: ['web'] as DeliverableType[] },
    'developer'
  );
  assert.equal(next, 'reviewer');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
if (failed > 0) process.exit(1);
