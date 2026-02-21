# Demo Scenarios (Run in Chief Chat)

Use these scripts to show ClawHQ value quickly.

## Scenario 1 — Product planning chain

Input:
- `B2B SaaS MVP 기획서 만들어줘`
- `응`
- wait
- `확정`

Expected outcome:
- PM plan task
- Dev implementation task
- Reviewer notes
- completed result in task history

## Scenario 2 — Engineering spec chain

Input:
- `결제 시스템 아키텍처 설계해줘`
- `응`
- wait
- `확정`

Expected outcome:
- architecture proposal and review trail
- risk and reliability sections in output

## Scenario 3 — Incident-style workflow

Input:
- `로그인 세션 만료 자동 로그아웃 버그 수정해줘`
- `응`
- wait

Expected outcome:
- bug-fix oriented task output
- state transitions visible in timeline

## Demo checklist

- [ ] Task created
- [ ] Agent assigned
- [ ] Status changes observed (pending/in-progress/completed)
- [ ] Result length > 1,000 chars
- [ ] No stuck tasks after flow
