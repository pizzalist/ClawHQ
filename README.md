<div align="center">

# AI Office

### Plan, Execute, Decide, Review — your AI team operating system.

AI Office is an open-source platform for running AI agents as a real team on top of OpenClaw.
Not just task execution — decision history, failure timeline, and team-level observability.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![AI Office Dashboard](docs/media/main-dashboard.png)

![AI Office Demo Flow](docs/media/demo-flow.gif)

</div>

---

## Why AI Office?

Most agent tools can generate outputs.
Few help teams answer:

- Who decided what?
- Why did this fail?
- Which task passed quality gate and why?

AI Office focuses on **team operations**, not just single-shot generation.

---

## What you get

- Multi-agent team orchestration (PM / Dev / Reviewer)
- Task chain workflow (plan → implement → review)
- Chief chat for natural-language control
- Decision / meeting / task history tracking
- Failure timeline for debugging operational issues
- Real-time office dashboard (agent states, task flow)

---

## Runtime requirement (important)

- **Full mode (recommended): OpenClaw required**
  - real agent orchestration
  - real task execution chain quality
- **Demo mode (fallback): OpenClaw optional**
  - UI + simulated flow for product preview
  - not equivalent to full production behavior

If your goal is real usage, connect/install OpenClaw.

## 5-minute quickstart

### 1) Install

```bash
git clone <your-repo-url>
cd app
npm install
```

### 2) Run

```bash
npm run demo:start
```

`demo:start` behavior:
- If OpenClaw exists: uses **full runtime mode** (real usage)
- If OpenClaw is missing: tries auto-install (`npm install -g openclaw`)
- If install fails: falls back to **demo mode** (preview only)

(or `npm run dev` if you want raw logs immediately)

Tip: disable auto-install with `AI_OFFICE_AUTO_INSTALL_OPENCLAW=0 npm run demo:start`

### 3) Verify

```bash
npm run healthcheck
```

### 4) Seed demo fixture (optional but recommended)

```bash
npm run demo:fixture
```

### 5) Run scripted demo scenarios (optional)

```bash
npm run demo:scenarios
```

### 6) Generate latest demo report (optional)

```bash
npm run demo:report
```

### 7) Open

- Web/API server: `http://localhost:3001`

---

## First demo scenario (30~60s)

Try this in Chief chat:

1. `AI 챗봇 MVP 기획서 만들어줘`
2. `응`
3. wait for execution
4. `확정`

Expected:

- PM creates plan
- Dev implements
- Reviewer evaluates
- final result + history are visible in dashboard

---

## Product positioning

AI Office is **not** a code-only assistant.
It is an **AI Team Operating System** for:

- execution visibility
- decision traceability
- operational quality control

---

## Architecture (high-level)

- Frontend: React + PixiJS + Zustand
- Backend: Express + WebSocket + SQLite
- Runtime orchestration: OpenClaw sessions

Flow:

UI ↔ WebSocket/API ↔ Task Queue ↔ Agent Runtime ↔ Results/Events

---

## Project structure

```text
app/
├── packages/
│   ├── web/      # React + PixiJS UI
│   ├── server/   # Express + task orchestration + DB
│   └── shared/   # shared types
├── scripts/
├── README.md
└── package.json
```

---

## Demo artifacts

- Scenario script: `docs/demo-scenarios.md`
- Latest demo report: `docs/demo-latest-report.md`
- Launch checklist: `docs/launch-day-checklist.md`
- Good first issues: `docs/good-first-issues.md`

---

## Current status

- Core E2E flow is operational
- 10-scenario pipeline executed with completed outputs
- Remaining focus: consistency hardening, UX polish, contributor onboarding

---

## Contributing

PRs are welcome.

- Fix bugs and add tests
- Improve scenario templates
- Improve docs and onboarding
- Add observability and quality gates

If you want a good starting point, search issues tagged `good first issue`.

---

## License

MIT

---

If this project is useful, consider giving it a ⭐
