# Good First Issues (Starter Backlog)

## 1) Improve empty-state UX
- Add better empty-state text in Dashboard / Meetings / Failures tabs.
- Acceptance: all tabs show actionable guidance when no data.

## 2) Task status badge consistency
- Normalize status badge colors across task cards and detail panels.
- Acceptance: pending/in-progress/completed/cancelled are visually consistent.

## 3) Meeting topic fallback text
- Some meetings appear without topic in list.
- Add fallback formatter for missing topic/agenda fields.
- Acceptance: meeting list never shows blank title.

## 4) README screenshot refresh
- Replace outdated screenshot with latest UI capture.
- Acceptance: README image matches current interface.

## 5) Add API healthcheck script
- Add `npm run healthcheck` to verify core endpoints.
- Acceptance: script returns non-zero on failed endpoint.

## 6) Event log filter presets
- Add quick filters: errors only / meetings only / task lifecycle.
- Acceptance: one-click filter buttons work in UI.

## 7) Decision history export button
- Add markdown export for decision history panel.
- Acceptance: exported file includes timestamp + decision metadata.
