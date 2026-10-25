# Script Entry-Point Parity

Approved scope: align existing package launchers, generated project launchers, CLI/direct bootstrap/npm setup, and standalone step execution with the terminal bootstrap architecture.

- [x] Share CLI argument parsing and dispatch. Preserve all options, validation, exit codes and environment defaults for direct bootstrap and npm setup.
- [x] Use canonical batch/shell launchers with Node >=18 or Bun selection. Generated launchers use the same source and delegate preparation to the CLI. Preserve offline/local preference and arguments.
- [x] Provide `init --refresh-launchers` to back up and replace existing launchers without overwriting setup.config.json. `--copy-tools` refreshes the local runtime snapshot.
- [x] Share command resolution, process logging/timeouts/cancellation and step cwd/skip rules between terminal installation and run-steps.
- [x] Exercise real entry points, launchers, copied tools, malformed inputs, exit propagation and process cleanup. Run the full suite and independent diff review.

No external dependencies. Preserve the web wizard and the verified reset protections. Existing externally copied directories can only be updated when explicitly targeted; document the migration command.

Documentation review: README.md, ENTEGRASYON.md and CHANGELOG.md describe the terminal menu, wizard port precedence, launcher refresh migration and local-copy dependency/cache requirements. Superseded 5049 examples were removed from the integration guide. Full pre-commit verification was repeated on 2026-10-25: 187 tests, 186 passed, 0 failed, 1 platform-specific skip; exit 0.

Validation: npm test completed with exit 0 — 187 tests, 186 passed, 0 failed, 1 POSIX-only test skipped on Windows. Verified native batch and Git sh launchers, generated offline tools, real Bun fallback and step execution, npm flag forwarding, percent-containing local/remote arguments, exit codes, refresh backups/config preservation, self-copy avoidance, candidate wizard HTTP startup, environment port precedence, read-only diagnostics, process timeouts and shutdown. Node 25 selection was simulated through a preload; actual primary runtime was Node 22. Native Linux/macOS execution was not performed. Independent read-only review found no remaining must-fix issues. Syntax checks and git diff --check passed.
