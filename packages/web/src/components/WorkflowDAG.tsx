import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Task, Agent } from '@clawhq/shared';

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  'in-progress': '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

const STATUS_BG: Record<string, string> = {
  pending: '#374151',
  'in-progress': '#1e3a5f',
  completed: '#14532d',
  failed: '#7f1d1d',
  cancelled: '#374151',
};

const ROLE_EMOJI: Record<string, string> = {
  pm: '📋',
  developer: '💻',
  reviewer: '🔍',
  designer: '🎨',
  tester: '🧪',
  devops: '🔧',
};

const NODE_W = 200;
const NODE_H = 72;
const GAP_X = 60;
const GAP_Y = 80;

interface NodePos {
  task: Task;
  x: number;
  y: number;
}

function layoutDAG(tasks: Task[]): NodePos[] {
  if (!tasks.length) return [];

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const pid = t.parentTaskId;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid)!.push(t);
  }

  // BFS layers
  const layers: Task[][] = [];
  const placed = new Set<string>();

  // Roots: tasks with no parent or whose parent isn't in current set
  const roots = tasks.filter((t) => !t.parentTaskId || !byId.has(t.parentTaskId));
  if (roots.length) {
    layers.push(roots);
    roots.forEach((r) => placed.add(r.id));
  }

  let safety = 0;
  while (safety++ < 20) {
    const next: Task[] = [];
    for (const t of layers[layers.length - 1] || []) {
      for (const c of children.get(t.id) || []) {
        if (!placed.has(c.id)) {
          next.push(c);
          placed.add(c.id);
        }
      }
    }
    if (!next.length) break;
    layers.push(next);
  }

  // Any orphans not placed
  for (const t of tasks) {
    if (!placed.has(t.id)) {
      layers.push([t]);
      placed.add(t.id);
    }
  }

  const nodes: NodePos[] = [];
  for (let row = 0; row < layers.length; row++) {
    const layer = layers[row];
    const totalW = layer.length * NODE_W + (layer.length - 1) * GAP_X;
    const startX = -totalW / 2 + NODE_W / 2;
    for (let col = 0; col < layer.length; col++) {
      nodes.push({
        task: layer[col],
        x: startX + col * (NODE_W + GAP_X),
        y: row * (NODE_H + GAP_Y),
      });
    }
  }
  return nodes;
}

export default function WorkflowDAG() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const agentMap = useMemo(() => new Map<string, Agent>(agents.map((a) => [a.id, a])), [agents]);

  const initialLayout = useMemo(() => layoutDAG(tasks), [tasks]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Reset positions when task list changes structurally
  const taskIdsKey = useMemo(() => tasks.map((t) => t.id).sort().join(','), [tasks]);
  useEffect(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of initialLayout) m.set(n.task.id, { x: n.x, y: n.y });
    setPositions(m);
  }, [taskIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ task: Task; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const getPos = useCallback(
    (id: string) => positions.get(id) || { x: 0, y: 0 },
    [positions],
  );

  const onMouseDownNode = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const pos = getPos(id);
    setDrag({ id, ox: e.clientX - pos.x, oy: e.clientY - pos.y });
  };

  const onMouseDownSvg = (e: React.MouseEvent) => {
    if (drag) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag) {
        setPositions((prev) => {
          const next = new Map(prev);
          next.set(drag.id, { x: e.clientX - drag.ox, y: e.clientY - drag.oy });
          return next;
        });
      } else if (isPanning) {
        setPan({
          x: panStart.current.px + (e.clientX - panStart.current.x),
          y: panStart.current.py + (e.clientY - panStart.current.y),
        });
      }
    };
    const onUp = () => {
      setDrag(null);
      setIsPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, isPanning]);

  // Center the view — run after positions are set
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current && positions.size) {
      const rect = containerRef.current.getBoundingClientRect();
      // Calculate centroid of all nodes
      let sumX = 0, sumY = 0;
      positions.forEach(p => { sumX += p.x; sumY += p.y; });
      const cx = sumX / positions.size;
      const cy = sumY / positions.size;
      // Pan so centroid is at center of container
      setPan({ x: rect.width / 2 - cx, y: rect.height / 2 - cy });
    }
  }, [positions.size, taskIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tasks.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">🔗</div>
          <p>No tasks yet. Create a task to see the workflow graph.</p>
        </div>
      </div>
    );
  }

  // Edges
  const edges: { from: string; to: string }[] = [];
  for (const t of tasks) {
    if (t.parentTaskId && positions.has(t.parentTaskId)) {
      edges.push({ from: t.parentTaskId, to: t.id });
    }
  }

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none">
      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={onMouseDownSvg}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y})`}>
          {/* Edges */}
          {edges.map(({ from, to }) => {
            const fp = getPos(from);
            const tp = getPos(to);
            const x1 = fp.x;
            const y1 = fp.y + NODE_H / 2;
            const x2 = tp.x;
            const y2 = tp.y - NODE_H / 2;
            const cy1 = y1 + (y2 - y1) * 0.4;
            const cy2 = y1 + (y2 - y1) * 0.6;
            return (
              <path
                key={`${from}-${to}`}
                d={`M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`}
                fill="none"
                stroke="#4b5563"
                strokeWidth={2}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Nodes */}
          {tasks.map((task) => {
            const pos = getPos(task.id);
            const agent = task.assigneeId ? agentMap.get(task.assigneeId) : null;
            const color = STATUS_COLORS[task.status] || '#6b7280';
            const bg = STATUS_BG[task.status] || '#374151';
            const emoji = agent ? (ROLE_EMOJI[agent.role] || '🤖') : '❓';

            return (
              <g
                key={task.id}
                transform={`translate(${pos.x - NODE_W / 2},${pos.y - NODE_H / 2})`}
                onMouseDown={(e) => onMouseDownNode(e, task.id)}
                onMouseEnter={(e) => setTooltip({ task, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => {
                  if (task.assigneeId) setSelectedAgent(task.assigneeId);
                }}
                className="cursor-pointer"
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={bg}
                  stroke={color}
                  strokeWidth={2}
                />
                {/* Status bar */}
                <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={color} />
                {/* Emoji */}
                <text x={16} y={28} fontSize={18}>{emoji}</text>
                {/* Title */}
                <text x={40} y={26} fill="#e5e7eb" fontSize={12} fontWeight="600">
                  {task.title.length > 18 ? task.title.slice(0, 17) + '…' : task.title}
                </text>
                {/* Agent name */}
                <text x={40} y={44} fill="#9ca3af" fontSize={10}>
                  {agent ? agent.name : 'Unassigned'}
                </text>
                {/* Status badge */}
                <text x={40} y={60} fill={color} fontSize={9} fontWeight="500">
                  {task.status.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl pointer-events-none max-w-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold text-sm text-gray-100 mb-1">{tooltip.task.title}</div>
          <div className="text-xs text-gray-400 mb-1">{tooltip.task.description || 'No description'}</div>
          <div className="flex gap-3 text-xs">
            <span style={{ color: STATUS_COLORS[tooltip.task.status] }}>● {tooltip.task.status}</span>
            <span className="text-gray-500">
              {tooltip.task.assigneeId
                ? agentMap.get(tooltip.task.assigneeId)?.name || 'Unknown'
                : 'Unassigned'}
            </span>
          </div>
          {tooltip.task.result && (
            <div className="text-xs text-gray-500 mt-1 border-t border-gray-700 pt-1 line-clamp-3">
              {/^\s*<!DOCTYPE|^\s*<html/i.test(tooltip.task.result!) ? '🌐 HTML 결과물' : tooltip.task.result!.slice(0, 80)}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-gray-900/80 border border-gray-700/50 rounded-lg px-3 py-2 flex gap-4 text-xs">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-gray-400 capitalize">{status}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
