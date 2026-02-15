import type { DeliverableType } from './types.js';

const KEYWORD_MAP: Array<{ type: DeliverableType; keywords: RegExp }> = [
  { type: 'web', keywords: /게임|game|웹|web|html|사이트|site|페이지|page|app|앱/i },
  { type: 'report', keywords: /보고서|report|분석|analysis|리서치|research|조사/i },
  { type: 'code', keywords: /코드|code|스크립트|script|프로그램|program|함수|function|api/i },
  { type: 'data', keywords: /데이터|data|csv|json|통계|표/i },
  { type: 'design', keywords: /디자인|design|ui|ux|레이아웃|목업/i },
];

export function detectDeliverableType(text: string): DeliverableType {
  for (const { type, keywords } of KEYWORD_MAP) {
    if (keywords.test(text)) return type;
  }
  return 'document';
}
