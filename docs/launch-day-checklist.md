# Launch Day Checklist (Star Sprint)

## A. Repo polish (must)

- [ ] Replace `<your-repo-url>` in README with actual GitHub URL
- [x] Generate media with `npm run demo:media`
- [x] Add 1 main screenshot (`docs/media/main-dashboard.png`)
- [x] Add 1 short demo GIF (`docs/media/demo-flow.gif`, 20~40s)
- [x] Pin key docs in README:
  - `docs/demo-scenarios.md`
  - `docs/demo-latest-report.md`
  - `docs/good-first-issues.md`

## B. Product trust signals (must)

- [ ] Run `npm run healthcheck` and include output snippet in release note
- [ ] Run `npm run demo:fixture && npm run demo:report`
- [ ] Ensure `docs/demo-latest-report.md` shows:
  - Health: PASS
  - Active Tasks: 0 (or explain if not 0)

## C. Release assets (must)

- [ ] Finalize `docs/release-v0.1.0-draft.md`
- [ ] Create GitHub Release v0.1.0 with:
  - Highlights
  - What works
  - Known limitations
  - Next priorities

## D. Community distribution (must)

- [ ] Post X draft (from `docs/launch-posts.md`)
- [ ] Post Reddit draft (from `docs/launch-posts.md`)
- [ ] Post HN draft (from `docs/launch-posts.md`)
- [ ] Monitor first 12h feedback and answer quickly

## E. Contributor onboarding (must)

- [ ] Open 5+ issues from `docs/good-first-issues.md`
- [ ] Label them `good first issue`
- [ ] Add one issue template for bug report
- [ ] Add one issue template for feature request

## F. Success criteria (24h)

- [ ] New visitors can run in 5 minutes
- [ ] At least 3 external users reproduce demo flow
- [ ] Initial stars/feedback collected and triaged
