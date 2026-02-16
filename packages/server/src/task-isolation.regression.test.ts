import { createTask, listTasks } from './task-queue.js';
import { stmts } from './db.js';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function resetTasks() {
  stmts.deleteAllDeliverables.run();
  stmts.deleteAllTasks.run();
  stmts.deleteAllEvents.run();
}

function run() {
  resetTasks();

  const prodTask = createTask('실사용 요청 생성', '사용자 요청 기반 실작업', null, null, undefined, { isTest: false });
  const qcTask = createTask('QC 자동검증', '내부 핫픽스 자동 검증 플로우', null, null, undefined, { isTest: true });
  const inferredTestTask = createTask('긴급 qc test flow', '자동 검증 경로 점검');

  const visible = listTasks();
  const all = listTasks(true);

  assert(visible.some(t => t.id === prodTask.id), '실사용 task가 기본 목록에서 보여야 합니다.');
  assert(!visible.some(t => t.id === qcTask.id), '테스트 task가 기본 목록에서 숨겨져야 합니다.');
  assert(!visible.some(t => t.id === inferredTestTask.id), '키워드 추론 테스트 task가 기본 목록에서 숨겨져야 합니다.');

  assert(all.some(t => t.id === prodTask.id), 'includeTest=true 목록에서 실사용 task가 보여야 합니다.');
  assert(all.some(t => t.id === qcTask.id), 'includeTest=true 목록에서 테스트 task가 보여야 합니다.');
  assert(all.some(t => t.id === inferredTestTask.id), 'includeTest=true 목록에서 추론 테스트 task가 보여야 합니다.');

  console.log('PASS task-isolation.regression.test');
}

run();
