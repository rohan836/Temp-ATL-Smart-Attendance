# VERSIONS — releases and development milestones

## Production releases

- `v1.2.0` — `bf575451` — verified production release with unified Backup Manager, Google Drive, Telegram, USB backup, automated reconciliation, and the unified Admin architecture.
- `v1.1.0` — `da89bdf` — Google Drive Device Flow, automated reconciliation, backup scheduling, Playwright suite.
- `v1.0.1` — `32e5ef7` — Pi setup resilience, deployment checks, live hardware scan/duplicate verification.
- `v1.0.0` — `c0fe411` — first verified production release.

These tags are historical checkpoints. Never rewrite or force-move them.

## Current development branch

`feature/ui-glass-redesign` is the active development line for the current UI and Setup work.

Latest documented branch milestone before the documentation cleanup:

`7d549d5` — class-scoped batches, enrollment linkage, rename propagation, per-class/per-batch cutoff persistence, Setup readability, classic black-and-cream wall restore, and dead-CSS cleanup.

That commit explicitly notes that backend and Playwright suites were not run for that UI-focused pass; it was verified by live screenshots. Do not convert that note into a claim that the suites passed.

## Test inventory

The current source tree contains 124 backend unit tests and 16 Playwright E2E scenarios. Test counts describe the current tree; they are not historical release claims unless the release section says so.

## Versioning rule

Use semantic versioning for future production releases:

- patch = maintenance/bug fix
- minor = backwards-compatible feature
- major = breaking contract, schema, or hardware change

A production release requires explicit verification. Do not tag or deploy merely because a branch is visually complete.
