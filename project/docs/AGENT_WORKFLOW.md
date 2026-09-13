# AGENT_WORKFLOW — standard coding-agent loop

This is the operating procedure for work in this repository. It is intentionally separate from the project facts and UI tokens.

## 1. Orient

Read `AGENTS.md`, then use `docs/DOCS.md` to open only the documents relevant to the task. Do not load every document by default.

For UI work also read:

- `docs/UI_TOKENS.md`
- `docs/UI_COMPONENTS.md`
- `skills/atl-frosted-ui/SKILL.md`
- `skills/atl-user-protocol/SKILL.md`

## 2. Establish scope

State exactly what is changing and what is frozen. One task at a time.

For UI tasks, the default scope is the HTML/CSS shell and `backend/ui_app.js`. Backend, API, database, hardware, deployment, and tests are not changed unless the request requires them.

## 3. Use current truth

Prefer current code and tests over prose. Then use the owning document for intent. Treat `plan/` as notes, not authority.

When a document conflicts with another document, update the owner rather than adding another exception.

## 4. Implement the smallest coherent change

Reuse an existing component pattern before inventing a new one. Remove obsolete rules rather than stacking overrides. Keep state changes layout-stable.

For UI, preserve the current black-and-cream wall unless the user explicitly orders a theme change.

## 5. Verify

Use the narrowest useful verification first, then the full relevant suite when the change can affect behavior.

For UI, re-read changed selectors and check sibling screens/modals for accidental coupling. Browser or screenshot verification must be truthfully reported; do not imply it happened when it did not.

## 6. Documentation

When behavior, structure, or reusable UI rules change, update the owning documentation in the same task. Avoid duplicating the rule in multiple files.

## 7. Git discipline

Work on the current branch. Do not switch branches, force-move tags, deploy to production, or push to `main` as a side effect of a task.

Do not commit or push active UI redesign work until the user accepts the visual result, unless the user explicitly asks for a commit earlier.

When the user explicitly requests a commit/push, make one focused commit for the approved change and report the resulting SHA.

## 8. Definition of done

A task is done when the requested result is implemented, relevant verification is complete, documentation is synchronized, no unrelated files changed, and no machine-local or secret artifacts are included.
