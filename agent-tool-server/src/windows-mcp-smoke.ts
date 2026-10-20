import { WindowsMcpBridge } from "./windows-mcp.js";

const bridge = new WindowsMcpBridge();

try {
  const tools = await bridge.listTools();
  const status = await bridge.callTool("ControlStatus", {}, 15_000);
  console.log(JSON.stringify({ tools, status }, null, 2));
} finally {
  await bridge.close();
}

