<div align="center">

# ClawHQ

### Your AI team, one office. Brainstorm, plan, build, review — together.

An open-source AI team operating system built on [OpenClaw](https://github.com/openclaw/openclaw).
Agents brainstorm ideas, debate approaches, score candidates, write specs, implement code, and review each other's work — just like a real engineering team.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![ClawHQ Dashboard](docs/media/main-dashboard.png)

</div>

## 🎬 Demo

> Chief chat → Brainstorm meeting → Reviewer scoring → Implementation chain → Completed

https://github.com/user-attachments/assets/a636ff8b-c65c-4a23-84b3-fd596128caf7

---

## 🤔 Why ClawHQ?

Most multi-agent tools run tasks in isolation. ClawHQ agents work as a **team**.

- **They brainstorm** — Multiple agents propose competing approaches in structured meetings
- **They debate & vote** — Reviewers score each candidate with structured scorecards and pick the best one
- **They plan & spec** — PMs write technical specifications and break down work
- **They build** — Developers implement code with automatic chain handoffs (spec → implement → review)
- **They review & test** — Reviewers evaluate quality, flag issues, and request fixes
- **They decide together** — Every decision has an audit trail: who proposed what, who scored how, why it was chosen

One instruction in, full team execution out. You manage the team, not individual agents.

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
- 🌐 **i18n** — Full English and Korean language support

---

## 🚀 Quickstart

```bash
git clone https://github.com/pizzalist/ClawHQ.git
cd ClawHQ/app
npm install
npm run dev
```

Requires [OpenClaw](https://github.com/openclaw/openclaw) for agent orchestration.

Open **http://localhost:3000** and try Chief Chat:
1. `Build me a todo app` → PM creates a spec
2. `yes` → Dev implements, Reviewer evaluates
3. `approve` → Decision finalized, visible in dashboard

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
