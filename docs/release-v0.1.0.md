# ClawHQ v0.1.0

Release date: 2026-02-17

## TL;DR

ClawHQ v0.1.0 establishes the **AI Team Operating System** baseline:
- plan → execute → decide → review workflow
- deterministic demo fixture + scripted scenarios
- automated healthcheck + demo report + media generation

## Highlights

- Repositioned docs around team operations (not single-shot generation)
- 5-minute quickstart with operational commands
- Added one-command bootstrap and validation scripts:
  - `npm run demo:start`
  - `npm run healthcheck`
  - `npm run demo:fixture`
  - `npm run demo:scenarios`
  - `npm run demo:report`
  - `npm run demo:media`
- Added launch artifacts:
  - `docs/demo-latest-report.md`
  - `docs/demo-scenarios.md`
  - `docs/launch-day-checklist.md`
  - `docs/media/main-dashboard.png`
  - `docs/media/demo-flow.gif`

## What works now

- Core task orchestration and role-based assignment
- PM → Dev → Reviewer chain flow
- Chief chat natural language control
- Dashboard visibility for agents/tasks/events
- Demo fixture reset and reproducible startup flow

## Known limitations

- Some flows still depend on LLM action consistency
- Scenario 3 can be slower in some runtime conditions
- Meeting auto-creation consistency still needs hardening

## Recommended demo flow

```bash
npm install
npm run demo:start
npm run healthcheck
npm run demo:fixture
npm run demo:scenarios
npm run demo:report
npm run demo:media
```

Then open: `http://localhost:3001`

## Next priorities (v0.1.x)

1. Harden long-tail scenario consistency (timeouts/retries)
2. Expand quality-gate enforcement and metrics
3. Publish contributor-friendly issue pipeline (`good first issue`)
4. Add release-ready public repo linking and distribution workflow

## Feedback

If you run it, please share:
- onboarding friction points
- unclear UX moments
- where this helps (or fails) in real team operations
