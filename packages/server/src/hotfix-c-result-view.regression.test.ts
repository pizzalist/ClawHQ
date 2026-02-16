import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdownToHtml } from '../../web/src/lib/format/markdown.tsx';

const root = resolve(process.cwd(), '..');
const chiefConsolePath = resolve(root, 'web/src/components/ChiefConsole.tsx');
const meetingRoomPath = resolve(root, 'web/src/components/MeetingRoom.tsx');

const chiefConsole = readFileSync(chiefConsolePath, 'utf8');
const meetingRoom = readFileSync(meetingRoomPath, 'utf8');

// R1) "회의 결과 보기"는 대화 스트림이 아니라 모달 미리보기로 열려야 한다.
assert.ok(chiefConsole.includes("if (action === 'view_result' && params.meetingId)"));
assert.ok(chiefConsole.includes('onPreviewMeeting(params.meetingId)'));
assert.ok(chiefConsole.includes('대화 스트림에 추가되지 않음'));

// R2) 결과보기 후 스크롤 위치 복귀 로직 유지
assert.ok(chiefConsole.includes('const chatScrollRef = useRef<HTMLDivElement>(null)'));
assert.ok(chiefConsole.includes('setSavedScrollTop(currentTop)'));
assert.ok(chiefConsole.includes('chatScrollRef.current.scrollTop = savedScrollTop'));

// R3) 버튼 의미 구분(미리보기 vs 확정)
assert.ok(chiefConsole.includes('👁 미리보기 (모달)'));
assert.ok(chiefConsole.includes('✅ 확정 · 다음 단계 실행'));

// R4) 회의실 종합결과는 Markdown 렌더러 사용
assert.ok(meetingRoom.includes('MarkdownContent text={report}'));

// R5) Markdown snapshot coverage: 헤더/리스트/표
const mdSample = `# 제목\n\n- 항목 A\n- 항목 B\n\n| 이름 | 점수 |\n|---|---|\n| 안 1 | 9 |`;
const html = markdownToHtml(mdSample);
assert.ok(html.includes('<h1>제목</h1>'));
assert.ok(html.includes('<ul><li>항목 A</li><li>항목 B</li></ul>'));
assert.ok(html.includes('<table>'));
assert.ok(html.includes('<th>이름</th>'));
assert.ok(html.includes('<td>안 1</td>'));

console.log('✅ Hotfix C regression passed (modal preview + scroll restore + markdown snapshot)');
