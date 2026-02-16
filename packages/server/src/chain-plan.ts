/**
 * Chain Plan Manager
 *
 * Replaces forced auto-chaining with user-editable pipeline plans.
 * When a task is created, a chain plan is proposed based on intent analysis.
 * The user can edit steps (add/remove/reorder) before confirming.
 * Execution proceeds step-by-step, with optional auto-advance.
 */

import { v4 as uuid } from 'uuid';
import type { AgentRole, DeliverableType } from '@ai-office/shared';
import { CHAIN_STEP_LABELS } from '@ai-office/shared';
import { decideNextRoleByIntent } from './task-queue.js';

export interface ChainStep {
  role: AgentRole;
  label: string;
  reason: string;
  agentId?: string;
}

export interface ChainPlan {
  id: string;
  taskId: string;
  taskTitle: string;
  steps: ChainStep[];
  currentStep: number;
  status: 'proposed' | 'confirmed' | 'running' | 'completed' | 'cancelled';
  autoExecute: boolean;
  createdAt: string;
}
import { listAgents, getAgent } from './agent-manager.js';

// In-memory store (persists for server lifetime; could be DB-backed later)
const plans = new Map<string, ChainPlan>();
// Index: taskId → planId
const taskPlanIndex = new Map<string, string>();

type PlanChangeCallback = (plan: ChainPlan) => void;
const changeCallbacks: PlanChangeCallback[] = [];
export function onChainPlanChange(cb: PlanChangeCallback) { changeCallbacks.push(cb); }
function emitChange(plan: ChainPlan) { for (const cb of changeCallbacks) cb(plan); }

const STEP_REASONS: Record<AgentRole, string> = {
  pm: '프로젝트 기획 및 작업 분해를 위한 PM 단계',
  developer: '실제 코드 구현/결과물 생성 단계',
  reviewer: '품질 검증 및 코드 리뷰 단계',
  designer: 'UI/UX 디자인 산출물 생성 단계',
  devops: '배포/인프라 설정 단계',
  qa: '테스트 및 QA 검증 단계',
};

/**
 * Suggest a chain plan for a task based on intent analysis.
 * Does NOT auto-execute — returns a proposed plan for user editing.
 */
export function suggestChainPlan(
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  startRole: AgentRole,
  expectedDeliverables?: DeliverableType[],
): ChainPlan {
  const steps: ChainStep[] = [];

  // Start with the initial role
  steps.push({
    role: startRole,
    label: CHAIN_STEP_LABELS[startRole] || startRole,
    reason: STEP_REASONS[startRole] || `${startRole} 단계`,
  });

  // Walk the intent-based chain
  let currentRole: AgentRole = startRole;
  const taskLike = { title: taskTitle, description: taskDescription, expectedDeliverables };
  for (let i = 0; i < 5; i++) { // safety limit
    const nextRole = decideNextRoleByIntent(taskLike, currentRole);
    if (!nextRole) break;
    steps.push({
      role: nextRole,
      label: CHAIN_STEP_LABELS[nextRole] || nextRole,
      reason: STEP_REASONS[nextRole] || `${nextRole} 단계`,
    });
    currentRole = nextRole;
  }

  const plan: ChainPlan = {
    id: uuid(),
    taskId,
    taskTitle,
    steps,
    currentStep: -1,
    status: 'proposed',
    autoExecute: false,
    createdAt: new Date().toISOString(),
  };

  plans.set(plan.id, plan);
  taskPlanIndex.set(taskId, plan.id);
  emitChange(plan);
  return plan;
}

/** Get plan by ID */
export function getChainPlan(planId: string): ChainPlan | null {
  return plans.get(planId) || null;
}

/** Get plan by task ID */
export function getChainPlanForTask(taskId: string): ChainPlan | null {
  const planId = taskPlanIndex.get(taskId);
  return planId ? plans.get(planId) || null : null;
}

/** List all active (non-completed/cancelled) plans */
export function listActiveChainPlans(): ChainPlan[] {
  return [...plans.values()].filter(p => p.status !== 'completed' && p.status !== 'cancelled');
}

/** List all plans */
export function listAllChainPlans(): ChainPlan[] {
  return [...plans.values()];
}

/**
 * Update the steps of a proposed plan (user editing).
 * Only allowed in 'proposed' status.
 */
export function editChainPlan(planId: string, steps: ChainStep[]): ChainPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  if (plan.status !== 'proposed') throw new Error(`Cannot edit plan in '${plan.status}' status`);
  if (steps.length === 0) throw new Error('Plan must have at least 1 step');

  plan.steps = steps;
  emitChange(plan);
  return plan;
}

/**
 * Set auto-execute toggle for a plan.
 */
export function setChainAutoExecute(planId: string, autoExecute: boolean): ChainPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  plan.autoExecute = autoExecute;
  emitChange(plan);
  return plan;
}

/**
 * Confirm a proposed plan — locks the steps and marks ready for execution.
 * The first step will be triggered by the caller (task-queue).
 */
export function confirmChainPlan(planId: string): ChainPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  if (plan.status !== 'proposed') throw new Error(`Plan is '${plan.status}', expected 'proposed'`);

  plan.status = 'confirmed';
  plan.currentStep = 0; // Ready to execute step 0
  emitChange(plan);
  return plan;
}

/**
 * Advance to the next step after current step completes.
 * Returns the next step's role, or null if chain is done.
 */
export function advanceChainPlan(planId: string): { nextStep: ChainStep | null; plan: ChainPlan } {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  if (plan.status !== 'running' && plan.status !== 'confirmed') {
    throw new Error(`Plan is '${plan.status}', cannot advance`);
  }

  plan.status = 'running';
  const nextIdx = plan.currentStep + 1;

  if (nextIdx >= plan.steps.length) {
    plan.status = 'completed';
    emitChange(plan);
    return { nextStep: null, plan };
  }

  plan.currentStep = nextIdx;
  emitChange(plan);
  return { nextStep: plan.steps[nextIdx], plan };
}

/**
 * Mark the plan as running (first step started).
 */
export function markChainRunning(planId: string): ChainPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  plan.status = 'running';
  emitChange(plan);
  return plan;
}

/** Cancel a plan */
export function cancelChainPlan(planId: string): ChainPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  plan.status = 'cancelled';
  emitChange(plan);
  return plan;
}

/**
 * Check if a task has a chain plan and whether auto-chain should proceed.
 * Called from task-queue handleRunComplete instead of forced spawnChainFollowUp.
 * Returns: { shouldChain, nextRole, planId } or null.
 */
export function shouldAutoChain(taskId: string): { nextRole: AgentRole; planId: string; nextStep: ChainStep } | null {
  const plan = getChainPlanForTask(taskId);
  if (!plan) return null;
  if (plan.status !== 'running' && plan.status !== 'confirmed') return null;
  if (!plan.autoExecute) return null;

  const nextIdx = plan.currentStep + 1;
  if (nextIdx >= plan.steps.length) return null;

  return {
    nextRole: plan.steps[nextIdx].role,
    planId: plan.id,
    nextStep: plan.steps[nextIdx],
  };
}

/**
 * Check if a task has a pending chain plan awaiting user confirmation.
 * Used by handleRunComplete to decide whether to pause and notify user.
 */
export function hasPendingChainPlan(taskId: string): boolean {
  const plan = getChainPlanForTask(taskId);
  if (!plan) return false;
  // If plan exists, is running, has more steps, and auto-execute is OFF
  if ((plan.status === 'running' || plan.status === 'confirmed') && !plan.autoExecute) {
    const nextIdx = plan.currentStep + 1;
    return nextIdx < plan.steps.length;
  }
  return false;
}
