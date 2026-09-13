# Documentation index

This repository uses a small set of authoritative documents plus task-specific notes. The goal is to make the project easy for humans and coding agents to navigate without repeating the same rule in five places.

## Authority order

When documents disagree, resolve them in this order:

1. Current code and tests.
2. `AGENTS.md` for repository-wide constraints and navigation.
3. `docs/PROJECT.md` for product intent and non-goals.
4. `docs/ARCHITECTURE.md` for system/file ownership.
5. `docs/DATA_MODEL.md` and `API.md` for behavior contracts.
6. `docs/WORKFLOW.md` for runtime sequences.
7. `docs/ADMIN.md` for Admin UX behavior.
8. `docs/UI_TOKENS.md` for visual tokens and current theme.
9. `docs/UI_COMPONENTS.md` for component structure and UI decisions.
10. `docs/DEVELOPMENT.md`, `TESTING.md`, and `OPERATIONS.md` for execution and verification.
11. `skills/*/SKILL.md` for agent procedure and collaboration rules.
12. `plan/` for active or historical task notes only.

Never use an old plan note to override current code or current canonical docs.

## Document map

| File | Purpose | Owner of truth |
|---|---|---|
| `PROJECT.md` | Product purpose, users, non-goals, attendance principles | Product behavior |
| `ARCHITECTURE.md` | Runtime layers, file ownership, serve-time composition | System structure |
| `DATA_MODEL.md` | Tables, fields, validation, schedules, statuses | Data rules |
| `WORKFLOW.md` | Boot, scan, enrollment, reconciliation, reporting flows | Runtime sequence |
| `ADMIN.md` | Students, Attendance, Setup, Backup responsibilities | Admin behavior |
| `UI_TOKENS.md` | Current visual language and exact values | UI design system |
| `UI_COMPONENTS.md` | Current component inventory and interaction patterns | UI structure |
| `DEVELOPMENT.md` | Safe code changes and local development | Engineering procedure |
| `TESTING.md` | Test suites and verification commands | Verification |
| `OPERATIONS.md` | Pi, deployment, backup, recovery, hardware | Operations |
| `VERSIONS.md` | Production tags and branch milestones | Release history |
| `AGENT_WORKFLOW.md` | Standard coding-agent loop | Agent procedure |

## Current branch note

`feature/ui-glass-redesign` currently uses the black-and-cream wall as the primary Admin visual language. The wall rules in `UI_TOKENS.md` are current. Older desert/frost material is historical unless a section explicitly says it still applies.

## Maintenance rule

Do not duplicate a rule merely to make a document feel complete. Update the document that owns the rule, then update this index only when ownership or navigation changes.
