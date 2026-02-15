import assert from 'node:assert/strict';
import type { DeliverableType } from '@ai-office/shared';
import { decideNextRoleByIntent } from './task-queue.js';

type Case = {
  name: string;
  title: string;
  description: string;
  expectedDeliverables: DeliverableType[];
  currentRole: 'pm' | 'developer';
  expectedNext: 'developer' | 'reviewer' | undefined;
};

const cases: Case[] = [
  {
    name: 'PM만: report 요청은 PM 단독 종료',
    title: '주간 리포트 작성',
    description: '핵심 지표를 요약해 보고서 작성',
    expectedDeliverables: ['report'],
    currentRole: 'pm',
    expectedNext: undefined,
  },
  {
    name: 'PM→Reviewer: report + 검토 의도',
    title: '시장 조사 리포트',
    description: '완료 후 리뷰/검토까지 진행',
    expectedDeliverables: ['report'],
    currentRole: 'pm',
    expectedNext: 'reviewer',
  },
  {
    name: 'Developer만: web 구현 요청(검토 없음)',
    title: '랜딩 페이지 구현',
    description: '반응형 HTML/CSS로 구현',
    expectedDeliverables: ['web'],
    currentRole: 'developer',
    expectedNext: undefined,
  },
  {
    name: 'PM→Developer: web/code 구현 요청',
    title: '대시보드 웹 앱 구현',
    description: '기능 정의 후 구현',
    expectedDeliverables: ['web'],
    currentRole: 'pm',
    expectedNext: 'developer',
  },
  {
    name: '3단계: PM→Developer→Reviewer (검토 포함)',
    title: '사내 툴 구현',
    description: '웹앱 구현 후 QA 리뷰/검토 포함',
    expectedDeliverables: ['web'],
    currentRole: 'pm',
    expectedNext: 'developer',
  },
  {
    name: '단순관리: 상태조회/취소류는 단일 단계 종료',
    title: 'task 상태 조회',
    description: '대기열 상태 check 후 보고',
    expectedDeliverables: ['document'],
    currentRole: 'pm',
    expectedNext: undefined,
  },
];

for (const c of cases) {
  const next = decideNextRoleByIntent(c, c.currentRole);
  assert.equal(next, c.expectedNext, `${c.name} (expected=${c.expectedNext}, actual=${next})`);
}

// 3단계 케이스의 2단계 전이(Developer -> Reviewer) 검증
const threeStepTask = {
  title: '사내 툴 구현',
  description: '웹앱 구현 후 QA 리뷰/검토 포함',
  expectedDeliverables: ['web'] as DeliverableType[],
};
assert.equal(decideNextRoleByIntent(threeStepTask, 'developer'), 'reviewer', '3단계 케이스에서 Developer 다음 Reviewer 이어야 함');

console.log(`✅ chain policy regression passed: ${cases.length + 1} assertions`);
