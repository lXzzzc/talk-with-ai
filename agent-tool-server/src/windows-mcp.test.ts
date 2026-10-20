import assert from "node:assert/strict";
import test from "node:test";

import {
  WINDOWS_MCP_PACKAGE,
  WINDOWS_MCP_TOOLS,
  buildWindowsMcpLaunchConfig,
  getWindowsMcpRuntimeInfo,
  isWindowsMcpEnabled,
} from "./windows-mcp.js";

test("Windows-MCP is enabled only on Windows unless explicitly disabled", () => {
  assert.equal(isWindowsMcpEnabled({}, "win32"), true);
  assert.equal(isWindowsMcpEnabled({ TALK_AI_WINDOWS_MCP_ENABLED: "off" }, "win32"), false);
  assert.equal(isWindowsMcpEnabled({}, "linux"), false);
});

test("launch configuration pins the package, tools, policy and telemetry", () => {
  const config = buildWindowsMcpLaunchConfig({ TALK_AI_WINDOWS_MCP_UVX_PATH: "C:\\uv\\uvx.exe" });
  assert.equal(config.command, "C:\\uv\\uvx.exe");
  assert.deepEqual(config.args, [
    "--from",
    WINDOWS_MCP_PACKAGE,
    "windows-mcp",
    "serve",
    "--transport",
    "stdio",
    "--tools",
    WINDOWS_MCP_TOOLS.join(","),
  ]);
  assert.equal(config.env?.ANONYMIZED_TELEMETRY, "false");
  assert.equal(config.env?.WINDOWS_MCP_CONTROL_POLICY, "strict");
  assert.equal(config.env?.WINDOWS_MCP_TOOLS, WINDOWS_MCP_TOOLS.join(","));
});

test("runtime info does not expose arbitrary process environment values", () => {
  const info = getWindowsMcpRuntimeInfo(
    { TALK_AI_WINDOWS_MCP_ENABLED: "1", SECRET_VALUE: "do-not-return" },
    "win32",
  );
  assert.equal(info.enabled, true);
  assert.equal(info.package, WINDOWS_MCP_PACKAGE);
  assert.equal(info.controlPolicy, "strict");
  assert.equal(info.telemetryEnabled, false);
  assert.equal("SECRET_VALUE" in info, false);
});

