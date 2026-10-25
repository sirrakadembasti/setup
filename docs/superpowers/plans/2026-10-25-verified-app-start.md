# Verified Application Start Implementation Plan

**Goal:** After successful wizard installation, automatically start the target application under the original terminal's process supervision and open its address only after readiness checks pass.

**Architecture:** Reuse the wizard's existing application process ownership and shutdown. Extract one serialized start operation for automatic start and manual retry. Share HTTP readiness results across start, status and navigation; forward masked application output and state to the terminal. Preserve embedded and desktop flows.

**Tech stack:** Node.js >=18 built-in modules, existing wizard API and inline browser UI; no dependencies.

## Approved requirements and constraints

- Installation failure must never launch the application.
- Application startup failure must preserve the successful installation and expose a retryable error.
- Verify the actual HTTP endpoint; require both backend and frontend when applicable. A listening TCP socket alone is insufficient.
- Delayed startup must remain pending until ready or a bounded timeout, with a clear failure.
- All browser navigation must be gated; use the URL returned by current health checks.
- Preserve one process tree, safe cancellation, external data directories, candidate roots, package-manager selection, and embedded/desktop behavior.

## Implementation tasks

- [x] Add failing integration tests for automatic startup after apply, failure/no premature readiness, slow frontend, and browser navigation gates.
- [x] Extract shared start/health operations in wizard/server.mjs; connect successful apply to automatic startup with serialized retries.
- [x] Forward masked process output and startup states through the existing terminal-supervised wizard; avoid duplicate launches.
- [x] Update wizard/ui.html.mjs to show startup state, gate all links/buttons and recover from failures/timeouts.
- [x] Run focused tests, full npm test, syntax and diff checks; review readiness, cancellation and compatibility paths.
- [x] Update README.md, ENTEGRASYON.md and CHANGELOG.md with automatic startup and readiness behavior and actual validation limits.

Additional compatibility checks cover Vite's explicit port selection, single web servers with unused development ports, auto-resolved dual topology, preserved/stripped subpath proxies, external address readiness, split-secret output, stalled HTTP deadlines, static bind failure retry, and shutdown during listener startup. Dedicated signal-exit retry is POSIX-only and skipped on Windows. Native Linux/macOS execution and an installed Vite distribution were not exercised; Vite forwarding is tested through a real npm invocation of a controlled local CLI fixture.

Final verification (2026-10-26, Windows, Node 22): `npm test` exited 0 with 209 tests, 207 passed, 0 failed and 2 platform-specific skips (109312 ms). All changed JavaScript modules passed `node --check`; `git diff --check` passed. Independent review found no remaining must-fix findings, including the subpath compatibility follow-up. The original-terminal E2E verifies automatic application startup after apply, IPC readiness, external data directory, split-secret masking, and shutdown of the application when the terminal cancels.
