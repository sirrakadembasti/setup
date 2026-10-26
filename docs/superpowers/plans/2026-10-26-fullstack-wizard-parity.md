# Full-Stack Wizard Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the critical full-stack setup issues: (1) propagate full environment variables and .env file to build, migrate, and seed child processes so migrations like drizzle/better-sqlite3 do not fail on missing Zod-validated secrets; (2) bridge wizard admin credentials to target seed variables (e.g., SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD); (3) support separate backend and frontend UI port controls in the wizard for dual-process fullstack setups.

**Architecture:** 
1. In `wizard/shared.mjs`, parse `temporaryEnv` before running build, migration, and seed steps, and pass all defined environment variables to `runCommand`. Additionally, ensure `.env` is temporarily staged (or symlinked/copied) at the project root and subprojects prior to migration so tools reading disk-based `.env` via `dotenv` can load them, with guaranteed cleanup and restore on failure.
2. In `wizard/config.mjs` and `wizard/shared.mjs`, detect if the target project defines seed admin variables (such as `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) in `.env.example` and automatically map the wizard's admin credentials to them.
3. In `wizard/ui.html.mjs` and `wizard/server.mjs`, detect Scenario 3 (Full-Stack / Dual) and provide explicit frontend and backend port controls in the wizard UI, and pass both ports to `createDualProcessController`.

**Tech Stack:** Node.js, Bun, ESM, Drizzle, Vite/Nuxt, HTML/CSS/Vanilla JS Wizard UI

---

### Task 1: Environment Variable Propagation to Build, Migrate, and Seed Processes

**Files:**
- Modify: `wizard/shared.mjs`
- Test: `scripts/wizard.test.mjs`, `scripts/deep-discovery.test.mjs`

- [x] **Step 1: Check existing migrate and build command execution in `wizard/shared.mjs`**
- [x] **Step 2: Parse `temporaryEnv` and pass `tempEnvVars` into `runCommand` for server build, client build, migration, and seed**
- [x] **Step 3: Stage `.env` (and subproject `.env` files) before migration so tools using `dotenv.config({ path: ... })` see the file, while keeping rollback intact on error**
- [x] **Step 4: Run unit tests to verify existing behavior is intact and new behavior works**

---

### Task 2: Bridge Wizard Admin Credentials to Project Seed Variables

**Files:**
- Modify: `wizard/config.mjs`
- Modify: `wizard/shared.mjs`
- Test: `scripts/wizard.test.mjs`

- [x] **Step 1: Inspect how `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (or similar seed keys) can be identified from `.env.example`**
- [x] **Step 2: Update `buildServerEnv` in `wizard/config.mjs` to map `payload.admin.email` and `payload.admin.password` to `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` if declared**
- [x] **Step 3: Pass these seed variables to `runCommand` during the `seed` execution step in `wizard/shared.mjs`**
- [x] **Step 4: Add test coverage in `scripts/wizard.test.mjs`**

---

### Task 3: Dual Port Configuration in Wizard UI for Full-Stack Applications

**Files:**
- Modify: `wizard/ui.html.mjs`
- Modify: `wizard/server.mjs`
- Modify: `wizard/shared.mjs`
- Test: `scripts/wizard.test.mjs`, `scripts/app-start.test.mjs`

- [x] **Step 1: Add frontend port UI elements to Step 2 in `wizard/ui.html.mjs` when full-stack / dual scenario is active**
- [x] **Step 2: Accept `frontendPort` in `/api/apply` payload schema in `wizard/server.mjs` and `wizard/shared.mjs`**
- [x] **Step 3: Wire `frontendPort` into `createDualProcessController`**
- [x] **Step 4: Run test suite to verify fullstack dual startup with custom ports**

---

### Task 4: End-to-End Verification on `gezi_portali-main`

- [x] **Step 1: Synchronize updated setup tools to `gezi_portali-main/tools/setup`**
- [x] **Step 2: Test `gezi_portali-main` migration and setup execution end-to-end**
- [x] **Step 3: Verify all test suites pass with zero regressions**
