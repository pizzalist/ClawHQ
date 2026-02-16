import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { OfficeScene } from '../office/OfficeScene';
import ChiefConsole from './ChiefConsole';

export default function OfficeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const agents = useStore((s) => s.agents);
  const meetings = useStore((s) => s.meetings);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const chiefThinking = useStore((s) => s.chiefThinking);
  const chiefPendingDecisions = useStore((s) => s.chiefPendingDecisions);
  const [chiefOpen, setChiefOpen] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new OfficeScene(containerRef.current, (id) => setSelectedAgent(id));
    sceneRef.current = scene;
    return () => { scene.destroy(); };
  }, [setSelectedAgent]);

  useEffect(() => {
    const activeMeetings = meetings.filter(m => m.status === 'active' || m.status === 'reviewing');
    const meetingParticipantIds = activeMeetings.flatMap(m => m.participants);
    sceneRef.current?.setMeetingParticipants(meetingParticipantIds);
    sceneRef.current?.updateAgents(agents);
  }, [agents, meetings]);

  useEffect(() => {
    sceneRef.current?.setSelectedAgent(selectedAgentId);
  }, [selectedAgentId]);

  // Trigger PixiJS resize when panel toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 350);
    return () => clearTimeout(timer);
  }, [chiefOpen]);

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Left: Office visualization */}
      <div className={`relative min-h-0 transition-all duration-300 ${chiefOpen ? 'flex-[7]' : 'flex-1'}`}>
        <div ref={containerRef} className="absolute inset-0" />
        <div className="absolute top-3 left-3 text-xs text-gray-500 bg-surface/80 px-2 py-1 rounded pointer-events-none">
          🏢 Office Floor
        </div>
        {/* Chief toggle button (visible when panel is closed) */}
        {!chiefOpen && (
          <button
            onClick={() => setChiefOpen(true)}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-surface/90 border border-gray-700/50 rounded-lg text-xs text-gray-300 hover:text-accent hover:border-accent/40 transition-colors shadow-lg backdrop-blur-sm"
          >
            🧠 Chief
            {chiefPendingDecisions > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500 text-black rounded-full font-bold leading-none">
                {chiefPendingDecisions}
              </span>
            )}
            {chiefThinking && (
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            )}
          </button>
        )}
      </div>

      {/* Right: Chief console panel */}
      <div className={`transition-all duration-300 border-l border-gray-700/30 bg-surface overflow-hidden flex flex-col ${chiefOpen ? 'w-[35%] min-w-[320px] max-w-[480px]' : 'w-0'}`}>
        {chiefOpen && (
          <>
            {/* Panel header with Chief avatar */}
            <div className="px-3 py-2.5 border-b border-gray-700/30 flex items-center gap-2 shrink-0">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm">
                  🧠
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-surface" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-200">Chief</div>
                <div className="text-[10px] text-emerald-400">온라인</div>
              </div>
              {chiefPendingDecisions > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500 text-black rounded-full font-bold">
                  {chiefPendingDecisions}
                </span>
              )}
              <button
                onClick={() => setChiefOpen(false)}
                className="p-1 rounded hover:bg-gray-700/40 text-gray-400 hover:text-gray-200 transition-colors"
                title="패널 닫기"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
            {/* Embedded ChiefConsole in panel mode */}
            <ChiefConsole panel />
          </>
        )}
      </div>
    </div>
  );
}
