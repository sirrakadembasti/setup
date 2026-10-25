# Terminal Bootstrap Implementation Plan

**Goal:** Move every bootstrap-page operation to the terminal; open only the existing web wizard after preparation.

**Architecture:** Keep detection, configuration generation, dependency inspection, language profiles, backup/reset and wizard APIs. Replace the bootstrap HTTP presentation with a terminal controller and menu. All entry points (`setup`, npm setup, launchers) converge on the same terminal flow.

**Constraints:** Node >=18, no external dependencies; Windows/macOS/Linux; preserve offline copies, package manager fallback/shims, external and desktop data paths, embedded wizard invocation, reconfiguration and existing wizard security. No listener on 5049. `--port` selects the wizard port; `--no-open` suppresses browser launch; `--check-only` prints JSON without writes or prompts.

- [x] Add failing behavioral tests for terminal diagnostics, dependency install/repair, failure gating, candidate selection, reset safeguards, reconfiguration, port conflicts and wizard handoff.
- [x] Implement a reusable terminal bootstrap controller using existing detection, language profiles and verified backup utilities. Run real child processes with logs, timeouts and process-tree cleanup.
- [x] Add terminal menu: install/repair, wizard, reconfigure, refresh, verified clean reset, candidate selection and exit. Keep dangerous actions behind explicit terminal confirmation. Noninteractive input must terminate safely on EOF.
- [x] Route CLI and direct bootstrap entry to terminal; adapt launchers to stop checking obsolete port 5049. Preserve wizard-only command.
- [x] Update README/integration/changelog and npm test coverage.
- [x] Run targeted tests, full existing regression suite and a real local wizard handoff. Review diff against all bootstrap actions and verify no bootstrap listener.

Approved behavior: terminal diagnosis/preparation -> existing web wizard (5050 by default). Fresh interactive runs show a menu, just as the previous page offered buttons; users can repeat repairs and refresh, resolve failures and then continue.

Validation (Windows, Node 22): npm test — 166 tests, 165 passed, 0 failed, 1 POSIX-only test skipped. Real HTTP wizard handoff, external data directory/reconfiguration, parent disconnect shutdown, npm wrapper leaf cleanup, timeouts, reset confirmations and read-only diagnostics verified. Independent code review found no remaining must-fix issues. node --check and git diff --check passed.
