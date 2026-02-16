<div align="center">

# AI Office

### Plan, Execute, Decide, Review — your AI team operating system.

AI Office is an open-source platform for running AI agents as a real team.
Not just task execution — decision history, failure timeline, and team-level observability.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

## 5-minute quickstart

### 1) Install

```bash
git clone <your-repo-url>
cd app
npm install
```

### 2) Run

```bash
npm run dev
```

### 3) Open

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
