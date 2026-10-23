#!/usr/bin/env node
import { findListeningProcess } from "./setup-bootstrap-lib.mjs";

const port = Number(process.argv[2]) || 5049;
const holder = findListeningProcess(port);
if (holder?.pid) {
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(holder));
  } else if (process.argv.includes("--name")) {
    process.stdout.write(holder.name || "");
  } else {
    process.stdout.write(String(holder.pid));
  }
  process.exit(0);
}
process.exit(1);
