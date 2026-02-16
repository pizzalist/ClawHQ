# Monitoring API (Mock Data) — Chain-2

체인 2 구현으로 추가된 모니터링 Mock API 문서입니다.

## Base URL

- `http://localhost:3100`

---

## 1) 지표 API

### `GET /api/monitoring/metrics`

#### Query
- `window`: `1h | 6h | 24h | 7d` (default: `24h`)

#### Response (예시)
```json
{
  "window": "24h",
  "sampledAt": "2026-02-16T07:01:14.889Z",
  "metrics": [
    {
      "key": "active_agents",
      "label": "Active Agents",
      "value": 9,
      "unit": "count",
      "trend": { "direction": "up", "delta": 1, "deltaPct": 12.5 },
      "sampledAt": "2026-02-16T07:01:14.889Z"
    }
  ]
}
```

---

## 2) 시계열 API

### `GET /api/monitoring/timeseries`

#### Query
- `metric`: `active_agents | queue_depth | task_success_rate | avg_cycle_time_sec | error_rate`
  - default: `task_success_rate`
- `window`: `1h | 6h | 24h | 7d` (default: `24h`)
- `interval`: `5m | 15m | 1h | 6h | 1d` (default: `1h`)

#### Response (예시)
```json
{
  "metric": "task_success_rate",
  "unit": "percent",
  "window": "24h",
  "interval": "1h",
  "points": [
    { "timestamp": "2026-02-15T08:00:00.000Z", "value": 93.81 },
    { "timestamp": "2026-02-15T09:00:00.000Z", "value": 95.12 }
  ]
}
```

---

## 3) 알림 API

### `GET /api/monitoring/alerts`

#### Query
- `status`: `active | resolved` (optional)

#### Response (예시)
```json
{
  "total": 2,
  "active": 2,
  "alerts": [
    {
      "id": "alert-error-rate-002",
      "severity": "critical",
      "status": "active",
      "source": "execution-worker",
      "title": "Error rate spike detected",
      "message": "Task error rate exceeded 8% over a rolling 15m window.",
      "firstSeenAt": "2026-02-16T06:43:00.000Z",
      "lastSeenAt": "2026-02-16T06:59:30.000Z",
      "resolvedAt": null
    }
  ]
}
```

---

## 4) 샘플 스키마 묶음

### `GET /api/monitoring/schema-sample`

- metrics / timeseries / alerts 샘플 응답을 한 번에 반환
- 프론트(Chain-3)에서 타입 설계/목업 연결할 때 빠른 참고용

---

## Notes
- 현재는 **mock 전용**이며 DB/실시간 수집과 연결되지 않습니다.
- 수치 생성은 seed 기반 pseudo-random + 파형 조합으로, 요청 시점에 따라 변동됩니다.
- Chain-3에서 차트/알림 UI 연결 시 위 스키마를 그대로 사용하면 됩니다.
