import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export const WINDOWS_MCP_PACKAGE = "windows-mcp==0.8.8";
const WINDOWS_MCP_STARTUP_TIMEOUT_MS = 90_000;
export const WINDOWS_MCP_TOOLS = [
  "ControlStatus",
  "DisplayInventory",
  "Snapshot",
  "Screenshot",
  "App",
  "WaitFor",
] as const;

export type WindowsMcpToolName = (typeof WINDOWS_MCP_TOOLS)[number];

export interface WindowsMcpRuntimeInfo {
  enabled: boolean;
  transport: "stdio";
  package: string;
  controlPolicy: "strict";
  telemetryEnabled: false;
  tools: readonly WindowsMcpToolName[];
}

interface WindowsMcpConnection {
  client: Client;
  transport: StdioClientTransport;
}

export function isWindowsMcpEnabled(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  const configured = (env.TALK_AI_WINDOWS_MCP_ENABLED ?? "true").trim().toLowerCase();
  return !FALSE_VALUES.has(configured);
}

export function getWindowsMcpRuntimeInfo(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): WindowsMcpRuntimeInfo {
  return {
    enabled: isWindowsMcpEnabled(env, platform),
    transport: "stdio",
    package: WINDOWS_MCP_PACKAGE,
    controlPolicy: "strict",
    telemetryEnabled: false,
    tools: WINDOWS_MCP_TOOLS,
  };
}

/**
 * Build a fixed, shell-free launch configuration for the upstream MCP server.
 * Only the uvx executable path is configurable; package, policy and tools are pinned here.
 */
export function buildWindowsMcpLaunchConfig(
  env: NodeJS.ProcessEnv = process.env,
): StdioServerParameters {
  const command = env.TALK_AI_WINDOWS_MCP_UVX_PATH?.trim() || "uvx";
  const childEnv = getDefaultEnvironment();
  childEnv.ANONYMIZED_TELEMETRY = "false";
  childEnv.WINDOWS_MCP_CONTROL_POLICY = "strict";
  childEnv.WINDOWS_MCP_TOOLS = WINDOWS_MCP_TOOLS.join(",");

  return {
    command,
    args: [
      "--from",
      WINDOWS_MCP_PACKAGE,
      "windows-mcp",
      "serve",
      "--transport",
      "stdio",
      "--tools",
      WINDOWS_MCP_TOOLS.join(","),
    ],
    env: childEnv,
    stderr: "pipe",
    maxBufferSize: 20 * 1024 * 1024,
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WindowsMcpBridge {
  private connectionPromise: Promise<WindowsMcpConnection> | undefined;
  private stderrTail = "";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  runtimeInfo(): WindowsMcpRuntimeInfo {
    return getWindowsMcpRuntimeInfo(this.env);
  }

  async listTools(): Promise<string[]> {
    const { client } = await this.getConnection();
    const result = await client.listTools(undefined, { timeout: 30_000 });
    return result.tools.map((tool) => tool.name);
  }

  async callTool(
    name: WindowsMcpToolName,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<CallToolResult> {
    if (!WINDOWS_MCP_TOOLS.includes(name)) {
      throw new Error(`Windows-MCP tool '${name}' is not allowlisted.`);
    }

    let connection: WindowsMcpConnection | undefined;
    try {
      connection = await this.getConnection();
      const result = await connection.client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: timeoutMs, maxTotalTimeout: timeoutMs },
      );
      if (!("content" in result)) {
        throw new Error(`Windows-MCP tool '${name}' returned an unsupported task result.`);
      }
      return result as CallToolResult;
    } catch (error) {
      await this.reset(connection);
      const suffix = this.stderrTail ? ` Windows-MCP: ${this.stderrTail}` : "";
      throw new Error(`Windows-MCP call failed: ${messageFrom(error)}.${suffix}`);
    }
  }

  async close(): Promise<void> {
    const pending = this.connectionPromise;
    this.connectionPromise = undefined;
    if (!pending) return;
    try {
      const connection = await pending;
      await connection.client.close();
    } catch {
      // The child may already have exited. Closing remains best-effort.
    }
  }

  private async getConnection(): Promise<WindowsMcpConnection> {
    if (!isWindowsMcpEnabled(this.env)) {
      throw new Error(
        "Windows-MCP is unavailable. It requires Windows and TALK_AI_WINDOWS_MCP_ENABLED must not be disabled.",
      );
    }

    this.connectionPromise ??= this.connect();
    try {
      return await this.connectionPromise;
    } catch (error) {
      this.connectionPromise = undefined;
      throw error;
    }
  }

  private async connect(): Promise<WindowsMcpConnection> {
    this.stderrTail = "";
    const transport = new StdioClientTransport(buildWindowsMcpLaunchConfig(this.env));
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      const next = `${this.stderrTail}${chunk.toString()}`.replace(/\s+/g, " ").trim();
      this.stderrTail = next.slice(-1_000);
    });

    const client = new Client({ name: "talk-with-ai-windows-mcp-bridge", version: "0.2.0" });
    // The first uvx launch may need to populate its isolated package cache.
    await client.connect(transport, {
      timeout: WINDOWS_MCP_STARTUP_TIMEOUT_MS,
      maxTotalTimeout: WINDOWS_MCP_STARTUP_TIMEOUT_MS,
    });

    const listed = await client.listTools(undefined, { timeout: 30_000 });
    const available = new Set(listed.tools.map((tool) => tool.name));
    const missing = WINDOWS_MCP_TOOLS.filter((tool) => !available.has(tool));
    if (missing.length > 0) {
      await client.close();
      throw new Error(`Pinned Windows-MCP is missing required tools: ${missing.join(", ")}`);
    }

    return { client, transport };
  }

  private async reset(connection?: WindowsMcpConnection): Promise<void> {
    if (!connection) {
      this.connectionPromise = undefined;
      return;
    }
    const current = this.connectionPromise;
    this.connectionPromise = undefined;
    try {
      const active = current ? await current : connection;
      await active.client.close();
    } catch {
      try {
        await connection.transport.close();
      } catch {
        // Nothing else to clean up.
      }
    }
  }
}

let sharedBridge: WindowsMcpBridge | undefined;

export function getWindowsMcpBridge(): WindowsMcpBridge {
  sharedBridge ??= new WindowsMcpBridge();
  return sharedBridge;
}

