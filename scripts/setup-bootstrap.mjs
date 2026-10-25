import { main } from "../bin/setup.mjs";

await main().catch((error) => {
  console.error(`[setup] ${error.message}`);
  process.exitCode = 1;
});
