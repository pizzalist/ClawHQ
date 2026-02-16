import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from './Toast';

type MonitoringWindow = '1h' | '6h' | '24h' | '7d';
type TimeSeriesInterval = '5m' | '15m' | '1h' | '6h' | '1d';
type MetricKey = 'active_agents' | 'queue_depth' | 'task_success_rate' | 'avg_cycle_time_sec' | 'error_rate';
type AlertStatus = 'active' | 'resolved' | 'all';
type AlertSeverity = 'critical' | 'warning' | 'info' | 'all';

interface MonitoringMetric {
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

interface MetricsResponse {
  window: MonitoringWindow;
  sampledAt: string;
  metrics: MonitoringMetric[];
}

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface TimeSeriesResponse {
  metric: MetricKey;
  unit: 'count' | 'percent' | 'seconds';
  window: MonitoringWindow;
  interval: TimeSeriesInterval;
  points: TimeSeriesPoint[];
}

interface MonitoringAlert {
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

interface AlertsResponse {
  total: number;
  active: number;
  alerts: MonitoringAlert[];
}

const WINDOW_OPTIONS: Array<{ key: MonitoringWindow; label: string }> = [
  { key: '1h', label: '최근 1시간' },
  { key: '6h', label: '최근 6시간' },
  { key: '24h', label: '최근 24시간' },
  { key: '7d', label: '최근 7일' },
];

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: 'task_success_rate', label: 'Task Success Rate' },
  { key: 'error_rate', label: 'Error Rate' },
  { key: 'queue_depth', label: 'Queue Depth' },
  { key: 'active_agents', label: 'Active Agents' },
  { key: 'avg_cycle_time_sec', label: 'Avg Cycle Time' },
];

const INTERVAL_OPTIONS: Array<{ key: TimeSeriesInterval; label: string }> = [
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '1d', label: '1d' },
];

function formatMetricValue(value: number, unit: MonitoringMetric['unit']) {
  if (unit === 'percent') return `${value.toFixed(2)}%`;
  if (unit === 'seconds') return `${value.toFixed(1)}s`;
  return new Intl.NumberFormat('ko-KR').format(Math.round(value));
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR', { hour12: false });
}

function toDurationLabel(fromIso: string, toIso: string) {
  const diffMs = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}시간`;
  return `${Math.round(hour / 24)}일`;
}

function getTrendColor(metric: MonitoringMetric) {
  if (metric.key === 'error_rate' || metric.key === 'avg_cycle_time_sec' || metric.key === 'queue_depth') {
    if (metric.trend.direction === 'up') return 'text-red-400';
    if (metric.trend.direction === 'down') return 'text-emerald-400';
    return 'text-gray-400';
  }
  if (metric.trend.direction === 'up') return 'text-emerald-400';
  if (metric.trend.direction === 'down') return 'text-red-400';
  return 'text-gray-400';
}

function TrendLine({ points, color }: { points: TimeSeriesPoint[]; color: string }) {
  if (points.length < 2) return null;

  const width = 900;
  const height = 220;
  const paddingX = 24;
  const paddingY = 20;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const toXY = (point: TimeSeriesPoint, idx: number) => {
    const x = paddingX + (idx / (points.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - ((point.value - min) / range) * (height - paddingY * 2);
    return `${x},${y}`;
  };

  const line = points.map(toXY).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56">
      {Array.from({ length: 4 }).map((_, i) => {
        const y = paddingY + (i / 3) * (height - paddingY * 2);
        return <line key={i} x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="rgba(148,163,184,0.2)" strokeDasharray="4 4" />;
      })}

      <polyline fill="none" stroke={color} strokeWidth="3" points={line} />

      {points
        .filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1)
        .map((p, i) => {
          const originalIndex = points.indexOf(p);
          const x = paddingX + (originalIndex / (points.length - 1)) * (width - paddingX * 2);
          return (
            <text key={i} x={x} y={height - 4} fill="rgba(148,163,184,0.85)" fontSize="11" textAnchor="middle">
              {new Date(p.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </text>
          );
        })}
    </svg>
  );
}

export default function Dashboard() {
  const [window, setWindow] = useState<MonitoringWindow>('24h');
  const [metric, setMetric] = useState<MetricKey>('task_success_rate');
  const [interval, setSeriesInterval] = useState<TimeSeriesInterval>('1h');
  const [alertStatus, setAlertStatus] = useState<AlertStatus>('active');
  const [alertSeverity, setAlertSeverity] = useState<AlertSeverity>('all');

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const knownCriticalAlerts = useRef<Set<string>>(new Set());

  const safeNotifyCriticalAlert = (title: string) => {
    queueMicrotask(() => {
      try {
        toast(`🚨 Critical Alert: ${title || 'Unknown alert'}`, 'error');
      } catch (error) {
        console.error('[Dashboard] critical alert toast failed', error);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;

    const load = async (isManual = false) => {
      if (isManual) setRefreshing(true);
      if (!isManual) setLoading(true);

      try {
        const [metricsRes, timeseriesRes, alertsRes] = await Promise.all([
          fetch(`/api/monitoring/metrics?window=${window}`),
          fetch(`/api/monitoring/timeseries?metric=${metric}&window=${window}&interval=${interval}`),
          fetch(`/api/monitoring/alerts${alertStatus === 'all' ? '' : `?status=${alertStatus}`}`),
        ]);

        if (!metricsRes.ok || !timeseriesRes.ok || !alertsRes.ok) {
          throw new Error('모니터링 API 요청 실패');
        }

        const [metricsData, seriesData, alertsData] = (await Promise.all([
          metricsRes.json(),
          timeseriesRes.json(),
          alertsRes.json(),
        ])) as [MetricsResponse, TimeSeriesResponse, AlertsResponse];

        if (cancelled) return;

        const safeAlerts: AlertsResponse = {
          total: Number.isFinite(alertsData?.total) ? alertsData.total : 0,
          active: Number.isFinite(alertsData?.active) ? alertsData.active : 0,
          alerts: Array.isArray(alertsData?.alerts) ? alertsData.alerts : [],
        };

        setMetrics(metricsData);
        setTimeseries(seriesData);
        setAlerts(safeAlerts);

        const newCriticalActive = safeAlerts.alerts.filter((a) => a?.severity === 'critical' && a?.status === 'active');
        for (const alert of newCriticalActive) {
          if (!alert?.id) continue;
          if (!knownCriticalAlerts.current.has(alert.id)) {
            knownCriticalAlerts.current.add(alert.id);
            safeNotifyCriticalAlert(alert.title);
          }
        }
      } catch {
        if (!cancelled) {
          toast('모니터링 데이터를 불러오지 못했습니다.', 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    load();
    const timer = setInterval(() => load(true), 15_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [window, metric, interval, alertStatus, reloadTick]);

  const visibleAlerts = useMemo(() => {
    if (!alerts) return [];
    return alerts.alerts.filter((a) => (alertSeverity === 'all' ? true : a.severity === alertSeverity));
  }, [alerts, alertSeverity]);

  const selectedMetric = useMemo(
    () => metrics?.metrics.find((m) => m.key === metric) ?? metrics?.metrics[0] ?? null,
    [metrics, metric],
  );

  const chartColor = metric === 'error_rate' ? '#f87171' : metric === 'queue_depth' ? '#fb923c' : '#22d3ee';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">운영 모니터링 대시보드</h2>
          <p className="text-sm text-gray-400">실시간 KPI, 시계열 추이, 알림 상태를 한 화면에서 확인합니다.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as MonitoringWindow)}
            className="bg-surface border border-gray-700/50 rounded-md px-2.5 py-1.5 text-xs text-gray-200"
          >
            {WINDOW_OPTIONS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setReloadTick((v) => v + 1)}
            className="px-3 py-1.5 rounded-md border border-gray-700/50 text-xs text-gray-300 hover:text-white hover:border-gray-500"
            disabled={refreshing}
          >
            {refreshing ? '갱신 중…' : '새로고침'}
          </button>

          <span className="text-xs text-gray-500">자동 갱신 15초</span>
        </div>
      </div>

      {loading ? (
        <div className="h-48 rounded-xl border border-gray-700/40 bg-surface/60 flex items-center justify-center text-sm text-gray-400">모니터링 데이터 로딩 중…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            {(metrics?.metrics ?? []).map((item) => (
              <div key={item.key} className="rounded-xl border border-gray-700/30 bg-surface p-3.5">
                <div className="text-[11px] text-gray-400">{item.label}</div>
                <div className="text-xl font-semibold text-gray-100 mt-1">{formatMetricValue(item.value, item.unit)}</div>
                <div className={`text-xs mt-1 ${getTrendColor(item)}`}>
                  {item.trend.direction === 'up' ? '▲' : item.trend.direction === 'down' ? '▼' : '•'} {Math.abs(item.trend.delta).toFixed(2)} ({Math.abs(item.trend.deltaPct).toFixed(2)}%)
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 rounded-xl border border-gray-700/30 bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-200 mr-auto">시계열 추이</h3>

                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  className="bg-panel border border-gray-700/50 rounded px-2 py-1 text-xs text-gray-200"
                >
                  {METRIC_OPTIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <select
                  value={interval}
                  onChange={(e) => setSeriesInterval(e.target.value as TimeSeriesInterval)}
                  className="bg-panel border border-gray-700/50 rounded px-2 py-1 text-xs text-gray-200"
                >
                  {INTERVAL_OPTIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              {timeseries && timeseries.points.length > 1 ? (
                <>
                  <TrendLine points={timeseries.points} color={chartColor} />
                  <div className="mt-1 text-xs text-gray-500">
                    마지막 포인트: {formatDateTime(timeseries.points[timeseries.points.length - 1].timestamp)}
                  </div>
                </>
              ) : (
                <div className="h-56 flex items-center justify-center text-sm text-gray-500">시계열 데이터가 없습니다.</div>
              )}
            </div>

            <div className="rounded-xl border border-gray-700/30 bg-surface p-4 space-y-4">
              <div>
                <div className="text-xs text-gray-500">현재 선택 지표</div>
                <div className="text-lg font-semibold text-gray-100 mt-1">{selectedMetric?.label ?? '-'}</div>
                <div className="text-sm text-cyan-300 mt-0.5">
                  {selectedMetric ? formatMetricValue(selectedMetric.value, selectedMetric.unit) : '-'}
                </div>
              </div>

              <div className="pt-3 border-t border-gray-700/40">
                <div className="text-xs text-gray-500">데이터 샘플 시각</div>
                <div className="text-sm text-gray-200 mt-1">{metrics ? formatDateTime(metrics.sampledAt) : '-'}</div>
              </div>

              <div className="pt-3 border-t border-gray-700/40">
                <div className="text-xs text-gray-500">알림 요약</div>
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className="px-2 py-1 rounded bg-red-500/10 text-red-300">
                    Critical {alerts?.alerts.filter((a) => a.severity === 'critical' && a.status === 'active').length ?? 0}
                  </span>
                  <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300">
                    Warning {alerts?.alerts.filter((a) => a.severity === 'warning' && a.status === 'active').length ?? 0}
                  </span>
                  <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-300">
                    Info {alerts?.alerts.filter((a) => a.severity === 'info').length ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-700/30 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-200 mr-auto">알림 이벤트</h3>

              <select
                value={alertStatus}
                onChange={(e) => setAlertStatus(e.target.value as AlertStatus)}
                className="bg-panel border border-gray-700/50 rounded px-2 py-1 text-xs text-gray-200"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="resolved">해결됨</option>
              </select>

              <select
                value={alertSeverity}
                onChange={(e) => setAlertSeverity(e.target.value as AlertSeverity)}
                className="bg-panel border border-gray-700/50 rounded px-2 py-1 text-xs text-gray-200"
              >
                <option value="all">전체 심각도</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>

            {visibleAlerts.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">필터 조건에 해당하는 알림이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {visibleAlerts.map((alert) => {
                  const severityClass =
                    alert.severity === 'critical'
                      ? 'border-red-500/40 bg-red-500/5'
                      : alert.severity === 'warning'
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-sky-500/40 bg-sky-500/5';

                  return (
                    <div key={alert.id} className={`rounded-lg border p-3 ${severityClass}`}>
                      <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-black/20 text-gray-200 uppercase">{alert.severity}</span>
                        <span className="px-1.5 py-0.5 rounded bg-black/20 text-gray-300">{alert.status}</span>
                        <span className="text-gray-400">{alert.source}</span>
                        <span className="ml-auto text-gray-500">{formatDateTime(alert.lastSeenAt)}</span>
                      </div>

                      <div className="text-sm font-medium text-gray-100">{alert.title}</div>
                      <div className="text-xs text-gray-300 mt-1">{alert.message}</div>

                      <div className="text-[11px] text-gray-500 mt-2">
                        지속 시간: {toDurationLabel(alert.firstSeenAt, alert.resolvedAt ?? alert.lastSeenAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
