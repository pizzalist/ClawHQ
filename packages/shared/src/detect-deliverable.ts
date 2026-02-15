import type { AgentRole, DeliverableType } from './types.js';

const KEYWORD_MAP: Array<{ type: DeliverableType; keywords: RegExp }> = [
  { type: 'web', keywords: /게임|game|웹|web|html|사이트|site|페이지|page|app|앱/i },
  { type: 'report', keywords: /보고서|report|분석|analysis|리서치|research|조사|리포트|요약|summary|정리/i },
  { type: 'code', keywords: /코드|code|스크립트|script|프로그램|program|함수|function|api/i },
  { type: 'data', keywords: /데이터|data|csv|json|통계|표/i },
  { type: 'design', keywords: /디자인|design|ui|ux|레이아웃|목업/i },
];

/** Allowed deliverable types per agent role */
const ROLE_ALLOWED_TYPES: Record<AgentRole, DeliverableType[]> = {
  pm: ['report', 'document'],
  developer: ['web', 'code', 'data'],
  designer: ['design', 'web'],
  reviewer: ['report'],
  devops: ['code', 'document'],
  qa: ['report'],
};

/** Fallback type when the detected type is not allowed for the role */
const ROLE_DEFAULT_TYPE: Record<AgentRole, DeliverableType> = {
  pm: 'report',
  developer: 'code',
  designer: 'design',
  reviewer: 'report',
  devops: 'code',
  qa: 'report',
};

export function detectDeliverableType(text: string): DeliverableType {
  for (const { type, keywords } of KEYWORD_MAP) {
    if (keywords.test(text)) return type;
  }
  return 'document';
}

/**
 * Detect deliverable type with role-aware filtering.
 * The detected type is clamped to what the role is allowed to produce.
 */
export function detectDeliverableTypeForRole(text: string, role: AgentRole): DeliverableType {
  const detected = detectDeliverableType(text);
  const allowed = ROLE_ALLOWED_TYPES[role];
  if (allowed.includes(detected)) return detected;
  return ROLE_DEFAULT_TYPE[role];
}
