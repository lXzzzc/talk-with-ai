import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes the expected tools and keeps writes disabled", async () => {
  const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "C:\\Windows",
      TALK_AI_TOOLS_WRITE_ENABLED: "0",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "talk-with-ai-tools-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "capture_desktop",
      "capture_screen",
      "click_screen",
      "computer_status",
      "get_cursor_position",
      "get_system_info",
      "inspect_desktop",
      "launch_installed_application",
      "list_displays",
      "list_windows",
      "open_application",
      "open_url",
      "type_text",
      "wait_for_ui",
      "windows_mcp_status",
    ]);

    const status = await client.callTool({
      name: "computer_status",
      arguments: {},
    });
    assert.equal(status.isError, undefined);
    assert.equal(
      (status.structuredContent as { writeEnabled?: boolean } | undefined)?.writeEnabled,
      false,
    );

    const blockedWrite = await client.callTool({
      name: "open_application",
      arguments: { application: "notepad" },
    });
    assert.equal(blockedWrite.isError, true);
  } finally {
    await client.close();
  }
});
