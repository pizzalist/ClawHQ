import { create } from 'zustand';

export type Lang = 'en' | 'ko';

interface LangStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const STORAGE_KEY = 'clawhq-lang';

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ko' || stored === 'en') return stored;
  } catch {}
  return 'en';
}

export const useLang = create<LangStore>((set) => ({
  lang: getInitialLang(),
  setLang: (lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ lang });
  },
}));

const translations: Record<string, { en: string; ko: string }> = {
  // TopBar
  'topbar.agents': { en: 'agents', ko: 'agents' },
  'topbar.working': { en: 'working', ko: 'working' },
  'topbar.pending': { en: 'pending', ko: 'pending' },
  'topbar.decisions': { en: 'decisions', ko: 'decisions' },
  'topbar.connected': { en: 'Connected', ko: '연결됨' },
  'topbar.disconnected': { en: 'Disconnected', ko: '연결 끊김' },
  'topbar.export': { en: '📥 Export', ko: '📥 내보내기' },
  'topbar.reset': { en: '🗑️ Reset Data', ko: '🗑️ 데이터 초기화' },
  'topbar.resetConfirm': {
    en: '⚠️ This will delete all data (meetings, tasks, events, decisions).\n\nAre you sure you want to reset?',
    ko: '⚠️ 모든 데이터(회의, 태스크, 이벤트, 결정)를 삭제합니다.\n\n정말 초기화하시겠습니까?',
  },
  'topbar.resetFail': { en: 'Reset failed', ko: '초기화 실패' },
  'topbar.networkError': { en: 'Network error', ko: '네트워크 오류' },

  // Tabs
  'tab.office': { en: '🏢 Office', ko: '🏢 오피스' },
  'tab.tasks': { en: '📋 Tasks', ko: '📋 작업' },
  'tab.dashboard': { en: '📊 Dashboard', ko: '📊 대시보드' },
  'tab.decisions': { en: '📌 Decisions', ko: '📌 의사결정' },
  'tab.meetings': { en: '🏛️ Meetings', ko: '🏛️ 회의' },
  'tab.workflow': { en: '🔗 Workflow', ko: '🔗 워크플로우' },
  'tab.failures': { en: '⚠️ Failures', ko: '⚠️ 실패' },
  'tab.history': { en: '🕐 History', ko: '🕐 히스토리' },

  // Sidebar
  'sidebar.agents': { en: 'Agents', ko: 'Agents' },
  'sidebar.add': { en: '+ Add', ko: '+ 추가' },
  'sidebar.presets': { en: '🏗️ Presets', ko: '🏗️ 프리셋' },
  'sidebar.noAgents': { en: 'No agents yet', ko: '아직 에이전트가 없어요' },
  'sidebar.noAgentsDesc': { en: 'Add your first AI agent to get started', ko: '시작하려면 첫 AI 에이전트를 추가하세요' },
  'sidebar.addAgent': { en: '+ Add Agent', ko: '+ 에이전트 추가' },

  // OfficeView
  'office.floor': { en: '🏢 Office Floor', ko: '🏢 오피스 플로어' },
  'office.chief': { en: '🧠 Chief', ko: '🧠 총괄자' },
  'office.online': { en: 'Online', ko: '온라인' },
  'office.closePanel': { en: 'Close panel', ko: '패널 닫기' },

  // ChiefConsole
  'chief.console': { en: '🧠 Chief Console', ko: '🧠 총괄자 콘솔' },
  'chief.processing': { en: 'Processing...', ko: '처리 중...' },
  'chief.thinking': { en: 'Thinking', ko: '생각하는 중' },
  'chief.you': { en: 'You', ko: '나' },
  'chief.chief': { en: 'Chief', ko: '총괄자' },
  'chief.welcome': {
    en: 'Talk to the Chief naturally. All work instructions, result reviews, and decisions happen here.',
    ko: '총괄자에게 자연스럽게 말해보세요. 모든 업무 지시, 결과 확인, 의사결정이 여기서 이루어집니다.',
  },
  'chief.example1': { en: '💡 e.g. "Build me a website"', ko: '💡 예: "웹사이트 만들어줘"' },
  'chief.example2': { en: '💡 e.g. "Give me a status update"', ko: '💡 예: "현재 진행 상황 알려줘"' },
  'chief.example3': { en: '💡 e.g. "Set up a team with 2 PMs and 3 devs"', ko: '💡 예: "PM 2명, 개발자 3명으로 팀 꾸려줘"' },
  'chief.placeholder': { en: 'Give instructions to the Chief...', ko: '총괄자에게 지시하세요...' },
  'chief.send': { en: 'Send', ko: '전송' },
  'chief.executionResults': { en: '⚡ Execution Results', ko: '⚡ 실행 결과' },
  'chief.teamSuggestion': { en: 'Team Composition Suggestion', ko: '팀 편성 제안' },
  'chief.apply': { en: '✅ Apply', ko: '✅ 적용' },
  'chief.applying': { en: 'Applying...', ko: '적용 중...' },
  'chief.kickoff': { en: 'Kickoff Meeting', ko: '킥오프 미팅' },
  'chief.startMeeting': { en: '🏛️ Start', ko: '🏛️ 시작' },
  'chief.starting': { en: 'Starting...', ko: '시작 중...' },
  'chief.chainPlans': { en: '🔗 Chain Plans', ko: '🔗 체인 플랜' },
  'chief.guide': { en: '💡 Guide', ko: '💡 가이드' },
  'chief.guideDesc': { en: 'All work is done through the Chief:', ko: '모든 업무가 Chief를 통해 이루어집니다:' },
  'chief.guideInstruct': { en: '🗣️ Natural language instructions → Chief proposes a plan', ko: '🗣️ 자연어로 지시 → Chief가 계획 제안' },
  'chief.guideComplete': { en: '✅ Result complete → Chief notifies + requests confirmation', ko: '✅ 결과 완료 → Chief가 알림 + 확정 요청' },
  'chief.guideMeeting': { en: '⚖️ Meeting results → Chief presents options', ko: '⚖️ 미팅 결과 → Chief가 선택지 제시' },
  'chief.guideRevise': { en: '🔄 Need revision → Tell Chief and it reworks', ko: '🔄 수정 필요 → Chief에게 말하면 재작업' },
  'chief.checkInTitle': { en: 'Chief Check-in Request', ko: '총괄자 확인 요청' },
  'chief.additionalComment': { en: 'Additional comment (optional)', ko: '추가 의견 (선택)' },

  // ChiefConsole - Error boundary
  'chief.renderError': { en: '⚠️ Render Error', ko: '⚠️ 화면 오류 발생' },
  'chief.retry': { en: 'Retry', ko: '다시 시도' },
  'chief.reload': { en: 'Reload', ko: '새로고침' },

  // ChiefConsole - Actions
  'action.createTask': { en: 'Create Task', ko: '작업 생성' },
  'action.createAgent': { en: 'Create Agent', ko: '에이전트 생성' },
  'action.startMeeting': { en: 'Start Meeting', ko: '미팅 시작' },
  'action.assignTask': { en: 'Assign Task', ko: '작업 배정' },
  'action.viewResult': { en: '📊 View Result', ko: '📊 결과 보기' },
  'action.viewMeetingResult': {
    en: 'View detailed meeting results (scorecard, participant opinions).',
    ko: '회의 결과를 상세히 봅니다 (점수표, 참여자 의견 포함).',
  },
  'action.viewResultGeneric': { en: 'View the result.', ko: '결과를 확인합니다.' },
  'action.chiefFinalize': {
    en: '🧭 Chief Final Decision',
    ko: '🧭 총괄자 최종안 작성',
  },
  'action.chiefFinalizeDesc': {
    en: 'No comparable candidates — skip scoring and proceed with Chief consolidation.',
    ko: '비교 가능한 후보가 없어 점수화 평가를 건너뛰고, 총괄자 취합 결정으로 진행합니다.',
  },
  'action.confirmNext': { en: '✅ Confirm & Execute Next Step', ko: '✅ 확정 · 다음 단계 실행' },
  'action.confirmNextDesc': {
    en: 'Approve the preview and proceed to the next step.',
    ko: '미리보기 내용을 승인하고 다음 단계를 실제로 진행합니다.',
  },
  'action.actioning': { en: 'Processing...', ko: '처리 중...' },
  'action.livePreview': { en: '🖥️ Live Preview', ko: '🖥️ 라이브 프리뷰' },
  'action.applyFix': { en: '🔧 Apply Fix', ko: '🔧 수정 반영' },
  'action.chatHintReview': {
    en: "💬 Type 'confirm', 'score candidates', 'request revision', etc. in chat",
    ko: "💬 채팅으로 '확정', '후보 평가', '수정 요청' 등을 입력하세요",
  },
  'action.chatHintDecision': {
    en: "💬 Type 'confirm', 'chief final decision', 'request revision', etc. in chat",
    ko: "💬 채팅으로 '확정', '총괄자 최종안', '수정 요청' 등을 입력하세요",
  },

  // Notifications
  'notif.htmlResult': { en: '🌐 HTML Web Result', ko: '🌐 HTML 웹 결과물' },

  // MeetingRoom
  'meeting.room': { en: '🏛️ Meeting Room', ko: '🏛️ 회의실' },
  'meeting.new': { en: '+ New Meeting', ko: '+ 새 회의' },
  'meeting.empty': { en: 'No meetings yet.\nStart a new meeting.', ko: '아직 회의가 없어요.\n새 회의를 시작해보세요.' },
  'meeting.select': { en: 'Select a meeting or start a new one', ko: '회의를 선택하거나 새로 시작하세요' },
  'meeting.active': { en: 'In Progress', ko: '진행 중' },
  'meeting.completed': { en: 'Completed', ko: '완료' },
  'meeting.participants': { en: 'participants', ko: '명 참여' },
  'meeting.collecting': { en: 'Collecting expert opinions...', ko: '전문가 의견 수집 중...' },
  'meeting.report': { en: '📝 Meeting Summary', ko: '📝 회의 종합 결과' },
  'meeting.contributions': { en: 'Individual Contributions', ko: '개별 의견' },
  'meeting.viewMore': { en: 'Show more', ko: '더 보기...' },
  'meeting.viewLess': { en: 'Collapse', ko: '접기' },
  'meeting.type': { en: 'Type', ko: '유형' },
  'meeting.participantsList': { en: 'Participants', ko: '참여자' },
  'meeting.viewResult': { en: 'View Result', ko: '결과 보기' },

  // MeetingRoom - New meeting form
  'meeting.newTitle': { en: '🏛️ Start New Meeting', ko: '🏛️ 새 회의 시작' },
  'meeting.titleLabel': { en: 'Meeting Title', ko: '회의 제목' },
  'meeting.titlePlaceholder': { en: 'e.g. New Project Planning Meeting', ko: '예: 신규 프로젝트 기획 회의' },
  'meeting.descLabel': { en: 'Agenda / Description', ko: '안건 / 설명' },
  'meeting.descPlaceholder': { en: 'Describe what the meeting will cover', ko: '회의에서 다룰 내용을 적어주세요' },
  'meeting.characterLabel': { en: 'Meeting Character', ko: '회의 성격' },
  'meeting.selectParticipants': { en: 'Select Participants (min 2)', ko: '참여자 선택 (최소 2명)' },
  'meeting.cancel': { en: 'Cancel', ko: '취소' },
  'meeting.start': { en: '🚀 Start Meeting', ko: '🚀 회의 시작' },
  'meeting.startingMeeting': { en: 'Starting...', ko: '시작 중...' },

  // Meeting characters
  'meetingChar.brainstorm': { en: '🧠 Brainstorming (Free Discussion)', ko: '🧠 브레인스토밍 (자유 토론)' },
  'meetingChar.planning': { en: '📋 Planning Meeting', ko: '📋 기획 회의' },
  'meetingChar.review': { en: '🔍 Review Meeting', ko: '🔍 검토 회의' },
  'meetingChar.retrospective': { en: '🔄 Retrospective', ko: '🔄 회고' },
  'meetingChar.kickoff': { en: '🚀 Project Kickoff', ko: '🚀 프로젝트 킥오프' },
  'meetingChar.architecture': { en: '🏗️ Architecture Design', ko: '🏗️ 아키텍처 설계' },
  'meetingChar.design': { en: '🎨 UI/UX Design', ko: '🎨 UI/UX 설계' },
  'meetingChar.sprintPlanning': { en: '📅 Sprint Planning', ko: '📅 스프린트 계획' },
  'meetingChar.estimation': { en: '📊 Estimation', ko: '📊 공수 산정' },
  'meetingChar.demo': { en: '🎬 Demo/Presentation', ko: '🎬 데모/시연' },
  'meetingChar.postmortem': { en: '🔥 Postmortem', ko: '🔥 포스트모템' },
  'meetingChar.codeReview': { en: '💻 Code Review', ko: '💻 코드 리뷰' },
  'meetingChar.daily': { en: '☀️ Daily Standup', ko: '☀️ 데일리 스탠드업' },

  // Meeting review scoring
  'meeting.scoringResult': { en: '📊 Scoring Results (Structured)', ko: '📊 점수화 결과 (구조화 렌더)' },
  'meeting.candidateTable': { en: 'Candidate Score Table', ko: '후보별 점수표' },
  'meeting.candidate': { en: 'Candidate', ko: '후보' },
  'meeting.description': { en: 'Description', ko: '설명' },
  'meeting.reviewerScores': { en: 'Reviewer Scores', ko: '리뷰어 점수' },
  'meeting.total': { en: 'Total', ko: '총점' },
  'meeting.average': { en: 'Average', ko: '평균' },
  'meeting.detail': { en: '📝 Detail:', ko: '📝 상세:' },
  'meeting.topRecommendation': { en: '#1 Recommendation', ko: '1순위 추천' },
  'meeting.alternatives': { en: 'Alternatives', ko: '대안' },
  'meeting.none': { en: 'None', ko: '없음' },

  // Meeting result modal
  'meeting.resultDetail': { en: '📊 Meeting Result Detail', ko: '📊 회의 결과 상세' },
  'meeting.resultPreview': { en: '📝 Meeting Result Preview', ko: '📝 회의 결과 미리보기' },
  'meeting.previewTab': { en: 'Preview', ko: '미리보기' },
  'meeting.detailTab': { en: 'Detail', ko: '상세' },
  'meeting.close': { en: 'Close ✕', ko: '닫기 ✕' },

  // TaskListView
  'task.noTasks': { en: 'No tasks found', ko: '작업이 없습니다' },
  'task.showChainSteps': { en: 'Show chain steps', ko: '체인 단계 표시' },
  'task.oldest': { en: '↑ Oldest', ko: '↑ 오래된 순' },
  'task.newest': { en: '↓ Newest', ko: '↓ 최신 순' },
  'task.status': { en: 'Status', ko: '상태' },
  'task.title': { en: 'Title', ko: '제목' },
  'task.agent': { en: 'Agent', ko: '에이전트' },
  'task.created': { en: 'Created', ko: '생성일' },
  'task.duration': { en: 'Duration', ko: '소요시간' },

  // Dashboard
  'dashboard.title': { en: 'Operations Monitoring Dashboard', ko: '운영 모니터링 대시보드' },
  'dashboard.desc': { en: 'View real-time KPIs, time series trends, and alert status in one place.', ko: '실시간 KPI, 시계열 추이, 알림 상태를 한 화면에서 확인합니다.' },
  'dashboard.refresh': { en: 'Refresh', ko: '새로고침' },
  'dashboard.refreshing': { en: 'Refreshing…', ko: '갱신 중…' },
  'dashboard.autoRefresh': { en: 'Auto-refresh 15s', ko: '자동 갱신 15초' },
  'dashboard.loading': { en: 'Loading monitoring data…', ko: '모니터링 데이터 로딩 중…' },
  'dashboard.timeSeriesTrend': { en: 'Time Series Trend', ko: '시계열 추이' },
  'dashboard.lastPoint': { en: 'Last point', ko: '마지막 포인트' },
  'dashboard.noTimeSeries': { en: 'No time series data available.', ko: '시계열 데이터가 없습니다.' },
  'dashboard.selectedMetric': { en: 'Selected Metric', ko: '현재 선택 지표' },
  'dashboard.sampleTime': { en: 'Data Sample Time', ko: '데이터 샘플 시각' },
  'activity.all': { en: 'All', ko: '전체' },
  'activity.errors': { en: 'Errors', ko: '오류' },
  'activity.tasks': { en: 'Tasks', ko: '태스크' },
  'activity.meetings': { en: 'Meetings', ko: '미팅' },
  'activity.agents': { en: 'Agents', ko: '에이전트' },
  'activity.htmlResult': { en: 'HTML Result', ko: 'HTML 결과물' },
  'activity.empty': { en: 'No activity yet. Try asking Chief for a task!', ko: '아직 활동이 없습니다. Chief에게 작업을 요청해보세요!' },
  'activity.emptyFilter': { en: 'No events matching "{filter}" filter.', ko: '"{filter}" 필터에 해당하는 이벤트가 없습니다.' },
  'activity.viewAll': { en: 'View All', ko: '전체 보기' },
  'dashboard.alertSummary': { en: 'Alert Summary', ko: '알림 요약' },
  'dashboard.alertEvents': { en: 'Alert Events', ko: '알림 이벤트' },
  'dashboard.allStatus': { en: 'All Status', ko: '전체 상태' },
  'dashboard.active': { en: 'Active', ko: '활성' },
  'dashboard.resolved': { en: 'Resolved', ko: '해결됨' },
  'dashboard.allSeverity': { en: 'All Severity', ko: '전체 심각도' },
  'dashboard.noAlerts': { en: 'No alerts match the filter.', ko: '필터 조건에 해당하는 알림이 없습니다.' },
  'dashboard.duration': { en: 'Duration', ko: '지속 시간' },
  'dashboard.monitoringError': { en: 'Failed to load monitoring data.', ko: '모니터링 데이터를 불러오지 못했습니다.' },

  // Dashboard - window options
  'dashboard.window1h': { en: 'Last 1 hour', ko: '최근 1시간' },
  'dashboard.window6h': { en: 'Last 6 hours', ko: '최근 6시간' },
  'dashboard.window24h': { en: 'Last 24 hours', ko: '최근 24시간' },
  'dashboard.window7d': { en: 'Last 7 days', ko: '최근 7일' },

  // FailureTimeline
  'failure.title': { en: 'Failure Timeline', ko: 'Failure Timeline' },
  'failure.allAgents': { en: 'All Agents', ko: '전체 에이전트' },
  'failure.noFailures': { en: 'No failures recorded', ko: '기록된 실패 없음' },
  'failure.allSmooth': { en: 'Everything is running smoothly', ko: '모든 것이 원활하게 작동 중' },
  'failure.noFailuresAgent': { en: 'No failures for this agent', ko: '이 에이전트의 실패 없음' },

  // HistoryReplay
  'history.noHistory': { en: 'No history yet', ko: '아직 히스토리 없음' },
  'history.noHistoryDesc': { en: 'Events will appear here as agents work on tasks', ko: '에이전트가 작업하면 여기에 이벤트가 표시됩니다' },
  'history.restart': { en: 'Restart', ko: '처음부터' },
  'history.pause': { en: '⏸ Pause', ko: '⏸ 일시정지' },
  'history.play': { en: '▶ Play', ko: '▶ 재생' },

  // Error messages
  'error.runtime': { en: 'Runtime error detected. Attempting auto-recovery.', ko: '런타임 오류를 감지했습니다. 자동 복구를 시도합니다.' },
  'error.unhandled': { en: 'An unhandled error occurred.', ko: '처리되지 않은 오류가 발생했습니다.' },
  'error.chiefChat': { en: 'Failed to chat with Chief', ko: '총괄자 대화에 실패했어요' },

  // Settings
  'settings.title': { en: 'Settings', ko: '설정' },
  'settings.chiefModel': { en: 'Chief Model', ko: 'Chief 모델' },
  'settings.agentModels': { en: 'Agent Default Models', ko: '에이전트 기본 모델' },
  'settings.save': { en: 'Save', ko: '저장' },
  'settings.saved': { en: 'Settings saved', ko: '설정이 저장되었습니다' },
  'settings.role.pm': { en: 'PM', ko: 'PM' },
  'settings.role.developer': { en: 'Developer', ko: '개발자' },
  'settings.role.reviewer': { en: 'Reviewer', ko: '리뷰어' },
  'settings.role.designer': { en: 'Designer', ko: '디자이너' },
  'settings.role.devops': { en: 'DevOps', ko: 'DevOps' },
  'settings.role.qa': { en: 'QA', ko: 'QA' },

  // Roles
  'role.pm': { en: 'PM', ko: 'PM' },
  'role.developer': { en: 'Developer', ko: '개발' },
  'role.reviewer': { en: 'Reviewer', ko: '리뷰어' },
  'role.designer': { en: 'Designer', ko: '디자이너' },
  'role.devops': { en: 'DevOps', ko: 'DevOps' },
  'role.qa': { en: 'QA', ko: 'QA' },

  // Mobile
  'mobile.agents': { en: 'Agents', ko: '에이전트' },
};

export function t(key: string): string {
  const lang = useLang.getState().lang;
  const entry = translations[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

/** Hook version for reactive updates */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string): string => {
    const entry = translations[key];
    if (!entry) return key;
    return entry[lang] || entry.en || key;
  };
}
