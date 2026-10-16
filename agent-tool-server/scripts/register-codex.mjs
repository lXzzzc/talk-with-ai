import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptDirectory, "..");
const serverPath = path.join(serverDirectory, "dist", "server.js");
const serverName = "talk-with-ai-computer";

function run(args, options = {}) {
  const result = spawnSync("codex", args, {
    encoding: "utf8",
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  return result;
}

const existing = run(["mcp", "get", serverName, "--json"], { capture: true });
if (existing.status === 0) {
  const removed = run(["mcp", "remove", serverName]);
  if (removed.status !== 0) process.exit(removed.status ?? 1);
}

const args = [
  "mcp",
  "add",
  "--env",
  "TALK_AI_TOOLS_WRITE_ENABLED=0",
  serverName,
  "--",
  process.execPath,
  serverPath,
];
const added = run(args);
if (added.status !== 0) process.exit(added.status ?? 1);

console.log(`Registered ${serverName} with write actions disabled.`);
console.log("Restart Codex so the newly registered tools become available.");
