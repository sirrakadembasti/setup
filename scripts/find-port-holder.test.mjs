import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const finder = path.join(scriptDir, "find-port-holder.mjs");

test("find-port-holder.mjs dinleyen portun PID değerini yazar", async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const result = spawnSync(process.execPath, [finder, String(port)], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+$/);

  const jsonResult = spawnSync(process.execPath, [finder, String(port), "--json"], { encoding: "utf8" });
  assert.equal(jsonResult.status, 0);
  const parsed = JSON.parse(jsonResult.stdout.trim());
  assert.equal(Number(parsed.pid), process.pid);

  const nameResult = spawnSync(process.execPath, [finder, String(port), "--name"], { encoding: "utf8" });
  assert.equal(nameResult.status, 0);
  assert.equal(typeof nameResult.stdout, "string");
});

test("find-port-holder.mjs boş portta çıkış 1 verir", () => {
  const result = spawnSync(process.execPath, [finder, "1"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "");
});
