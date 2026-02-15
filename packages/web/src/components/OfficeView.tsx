import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { OfficeScene } from '../office/OfficeScene';

export default function OfficeView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const agents = useStore((s) => s.agents);
  const meetings = useStore((s) => s.meetings);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new OfficeScene(containerRef.current, (id) => setSelectedAgent(id));
    sceneRef.current = scene;
    return () => { scene.destroy(); };
  }, [setSelectedAgent]);

  useEffect(() => {
    // Compute active meeting participants
    const activeMeetings = meetings.filter(m => m.status === 'active' || m.status === 'reviewing');
    const meetingParticipantIds = activeMeetings.flatMap(m => m.participants);
    sceneRef.current?.setMeetingParticipants(meetingParticipantIds);
    sceneRef.current?.updateAgents(agents);
  }, [agents, meetings]);

  useEffect(() => {
    sceneRef.current?.setSelectedAgent(selectedAgentId);
  }, [selectedAgentId]);

  return (
    <div className="flex-1 min-h-0 relative">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 text-xs text-gray-500 bg-surface/80 px-2 py-1 rounded pointer-events-none">
        🏢 Office Floor
      </div>
    </div>
  );
}
