export type MonitoringWindow = '1h' | '6h' | '24h' | '7d';
export type TimeSeriesInterval = '5m' | '15m' | '1h' | '6h' | '1d';

export type MetricKey =
  | 'active_agents'
  | 'queue_depth'
  | 'task_success_rate'
  | 'avg_cycle_time_sec'
  | 'error_rate';

export interface MonitoringMetric {
  key: MetricKey;
  label: string;
  value: number;
  unit: 'count' | 'percent' | 'seconds';
  trend: {
    direction: 'up' | 'down' | 'flat';
    delta: number;
    deltaPct: number;
  };
  sampledAt: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface MonitoringAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'active' | 'resolved';
  source: string;
  title: string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

const METRIC_CONFIG: Array<{ key: MetricKey; label: string; unit: MonitoringMetric['unit']; base: number; jitter: number }> = [
  { key: 'active_agents', label: 'Active Agents', unit: 'count', base: 8, jitter: 3 },
  { key: 'queue_depth', label: 'Queue Depth', unit: 'count', base: 14, jitter: 8 },
  { key: 'task_success_rate', label: 'Task Success Rate', unit: 'percent', base: 95, jitter: 4 },
  { key: 'avg_cycle_time_sec', label: 'Avg Cycle Time', unit: 'seconds', base: 82, jitter: 24 },
  { key: 'error_rate', label: 'Error Rate', unit: 'percent', base: 3.6, jitter: 2.1 },
];

const WINDOW_TO_MS: Record<MonitoringWindow, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const INTERVAL_TO_MS: Record<TimeSeriesInterval, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

const ALERTS: MonitoringAlert[] = [
  {
    id: 'alert-queue-001',
    severity: 'warning',
    status: 'active',
    source: 'task-queue',
    title: 'Task queue backlog growing',
    message: 'Queue depth stayed above 20 for the last 12 minutes.',
    firstSeenAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    lastSeenAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    resolvedAt: null,
  },
  {
    id: 'alert-error-rate-002',
    severity: 'critical',
    status: 'active',
    source: 'execution-worker',
    title: 'Error rate spike detected',
    message: 'Task error rate exceeded 8% over a rolling 15m window.',
    firstSeenAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    lastSeenAt: new Date(Date.now() - 90 * 1000).toISOString(),
    resolvedAt: null,
  },
  {
    id: 'alert-ws-003',
    severity: 'info',
    status: 'resolved',
    source: 'websocket-gateway',
    title: 'Temporary WS disconnect burst',
    message: 'Transient disconnects recovered automatically.',
    firstSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 2.4 * 60 * 60 * 1000).toISOString(),
  },
];

function seededNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function parseWindow(value: string | undefined): MonitoringWindow {
  if (value === '1h' || value === '6h' || value === '24h' || value === '7d') return value;
  return '24h';
}

function parseInterval(value: string | undefined): TimeSeriesInterval {
  if (value === '5m' || value === '15m' || value === '1h' || value === '6h' || value === '1d') return value;
  return '1h';
}

function parseMetric(value: string | undefined): MetricKey {
  const valid = METRIC_CONFIG.find((m) => m.key === value);
  return valid?.key ?? 'task_success_rate';
}

function metricValue(base: number, jitter: number, seed: number): number {
  const noise = (seededNoise(seed) - 0.5) * 2;
  const wave = Math.sin(seed / 2.5) * 0.6;
  return base + (noise + wave) * jitter;
}

export function getMockMetrics(windowInput?: string) {
  const window = parseWindow(windowInput);
  const sampledAt = new Date().toISOString();
  const seedBase = Math.floor(Date.now() / (5 * 60 * 1000));

  const metrics: MonitoringMetric[] = METRIC_CONFIG.map((cfg, idx) => {
    const valueRaw = metricValue(cfg.base, cfg.jitter, seedBase + idx * 11);
    const previousRaw = metricValue(cfg.base, cfg.jitter, seedBase + idx * 11 - 1);
    const value = cfg.unit === 'count' ? Math.max(0, Math.round(valueRaw)) : Number(Math.max(0, valueRaw).toFixed(2));
    const previous = cfg.unit === 'count' ? Math.max(0, Math.round(previousRaw)) : Math.max(0, previousRaw);
    const delta = Number((value - previous).toFixed(2));
    const deltaPct = previous === 0 ? 0 : Number(((delta / previous) * 100).toFixed(2));

    return {
      key: cfg.key,
      label: cfg.label,
      value,
      unit: cfg.unit,
      trend: {
        direction: delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat',
        delta,
        deltaPct,
      },
      sampledAt,
    };
  });

  return {
    window,
    sampledAt,
    metrics,
  };
}

export function getMockTimeSeries(metricInput?: string, windowInput?: string, intervalInput?: string) {
  const metric = parseMetric(metricInput);
  const window = parseWindow(windowInput);
  const interval = parseInterval(intervalInput);

  const now = Date.now();
  const windowMs = WINDOW_TO_MS[window];
  const intervalMs = INTERVAL_TO_MS[interval];
  const pointsCount = Math.max(2, Math.floor(windowMs / intervalMs) + 1);

  const cfg = METRIC_CONFIG.find((m) => m.key === metric) ?? METRIC_CONFIG[0];
  const points: TimeSeriesPoint[] = Array.from({ length: pointsCount }).map((_, idx) => {
    const timestampMs = now - (pointsCount - 1 - idx) * intervalMs;
    const seed = Math.floor(timestampMs / intervalMs) + idx * 7;
    const raw = metricValue(cfg.base, cfg.jitter, seed);
    const value = cfg.unit === 'count' ? Math.max(0, Math.round(raw)) : Number(Math.max(0, raw).toFixed(2));
    return {
      timestamp: new Date(timestampMs).toISOString(),
      value,
    };
  });

  return {
    metric,
    unit: cfg.unit,
    window,
    interval,
    points,
  };
}

export function getMockAlerts(statusInput?: string) {
  const statusFilter = statusInput === 'active' || statusInput === 'resolved' ? statusInput : undefined;
  const alerts = statusFilter ? ALERTS.filter((a) => a.status === statusFilter) : ALERTS;
  return {
    total: alerts.length,
    active: alerts.filter((a) => a.status === 'active').length,
    alerts,
  };
}

export function getMonitoringSchemaSample() {
  return {
    metrics: getMockMetrics('24h'),
    timeseries: getMockTimeSeries('task_success_rate', '24h', '1h'),
    alerts: getMockAlerts('active'),
  };
}
