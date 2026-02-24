<div align="center">

# ClawHQ

### Your AI team, one office. Plan, execute, decide, review.

An open-source AI team operating system built on [OpenClaw](https://github.com/openclaw/openclaw).
Not just task execution — full decision history, failure debugging, and team-level observability.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![ClawHQ Dashboard](docs/media/main-dashboard.png)

</div>

## 🎬 Demo

> Chief chat → Brainstorm meeting → Reviewer scoring → Implementation chain → Completed

https://github.com/pizzalist/ClawHQ/releases/download/demo-v1/clawhq_demo.mp4

---

## 🤔 Why ClawHQ?

Most agent tools generate outputs. Few answer the questions that actually matter:

- **Who decided what?** — Full decision audit trail with reviewer scorecards
- **Why did this fail?** — Failure timeline for debugging operational issues
- **Which task passed QC?** — Quality gates with traceability at every step

ClawHQ focuses on **team operations** — not single-shot generation.

---

## ✨ Features

- 🏢 **Isometric Office View** — PixiJS 2.5D office with agent sprites, desks, meeting room, and decorations
- 🧠 **Chief Chat** — Natural language control, proactive check-ins, inline actions, notifications
- 👥 **Multi-Agent Teams** — 6 roles: PM, Developer, Reviewer, Designer, DevOps, QA
- ⛓️ **Chain Plans** — Editable task pipeline (plan → implement → review) with visual chain editor
- 🏗️ **Team Presets** — Pre-configured team templates for common workflows
- 📋 **13 Meeting Types** — brainstorm, planning, review, retrospective, kickoff, architecture, design, sprint-planning, estimation, demo, postmortem, code-review, daily
- 🔬 **Tech Spec Meeting** — 4-panel discussion (CTO / Frontend Lead / Backend Lead / QA) with conflict detection and synthesis
- ⚖️ **Decision System** — Proposal comparison, reviewer scorecards, Devil's Advocate, approve/revise/reject
- 📦 **Deliverables** — 6 types (Web / Code / Report / Data / Document / API) with live preview
- ⏪ **History Replay** — Event timeline playback for full session audit
- 📊 **Monitoring Dashboard** — KPI metrics, time series charts, alert system
- 🔥 **Failure Timeline** — Debug operational issues with full event context
- 🏢 **Meeting Lineage** — Parent-child meeting relationships, candidate inheritance

---

## 🚀 Quickstart

```bash
git clone https://github.com/pizzalist/ClawHQ.git
cd ClawHQ/app
npm install
npm run demo:start
```

`demo:start` behavior:
- If OpenClaw is installed → **full runtime mode** (real agent orchestration)
- If OpenClaw is missing → attempts auto-install, then falls back to **demo mode** (UI preview)

Disable auto-install: `CLAWHQ_AUTO_INSTALL_OPENCLAW=0 npm run demo:start`

Open **http://localhost:3001** and try Chief Chat:
1. `AI 챗봇 MVP 기획서 만들어줘` → PM creates a plan
2. `응` → Dev implements, Reviewer evaluates
3. `확정` → Decision finalized, visible in dashboard

---

## ⚙️ Runtime

- **Full mode (recommended):** [OpenClaw](https://github.com/openclaw/openclaw) required — real agent orchestration, task execution, quality gates
- **Demo mode (fallback):** OpenClaw optional — UI + simulated flow for product preview

---

## 🏗️ Architecture

```
Frontend: React + PixiJS + Zustand
Backend:  Express + WebSocket + SQLite
Runtime:  OpenClaw sessions

UI ↔ WebSocket/API ↔ Task Queue ↔ Agent Runtime ↔ Results/Events
```

**Tech Stack:** React · PixiJS · Zustand · Express · WebSocket · SQLite · TypeScript

---

## 📁 Project Structure

```text
app/
├── packages/
│   ├── web/      # React + PixiJS UI
│   ├── server/   # Express + task orchestration + DB
│   └── shared/   # Shared types
├── scripts/      # Demo, fixture, healthcheck scripts
├── docs/         # Scenarios, release notes, checklists
├── README.md
└── package.json
```

---

## 🤝 Contributing

PRs welcome! Good starting points:

- Fix bugs and add tests
- Improve scenario templates
- Add observability and quality gates
- Improve docs and onboarding

---

## 📄 License

MIT

---

<div align="center">

If this project is useful, consider giving it a ⭐

</div>
