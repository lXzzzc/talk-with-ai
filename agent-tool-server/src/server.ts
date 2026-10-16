#!/usr/bin/env node
import os from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  isWriteEnabled,
  parseAllowedHosts,
  requireWriteEnabled,
  validateCoordinate,
  validateHttpUrl,
  validateText,
} from "./policy.js";
import {
  captureScreen,
  clickScreen,
  getCursorPosition,
  listVisibleWindows,
  openApplication,
  openUrl,
  type AllowedApplication,
  typeText,
} from "./windows.js";

const server = new McpServer(
  {
    name: "talk-with-ai-local-computer-tools",
    version: "0.1.0",
  },
  {
    instructions:
      "Inspect state before acting. Prefer window metadata over coordinates. " +
      "After clicks or typing, capture the screen to verify the result. " +
      "Never request or type passwords, API keys, payment data, or other secrets.",
  },
);

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

async function safeToolCall<T>(operation: () => Promise<T> | T) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

server.registerTool(
  "computer_status",
  {
    title: "Computer tool status",
    description:
      "Check platform support, write permission, and URL host restrictions before using local computer tools.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    const allowedHosts = [...parseAllowedHosts()];
    const status = {
      platform: process.platform,
      supported: process.platform === "win32",
      writeEnabled: isWriteEnabled(),
      allowedHosts,
    };
    return textResult(JSON.stringify(status, null, 2), status);
  },
);

server.registerTool(
  "get_system_info",
  {
    title: "Get local system information",
    description: "Return basic, non-secret operating system and runtime information.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () => {
    const info = {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      hostname: os.hostname(),
      nodeVersion: process.version,
    };
    return textResult(JSON.stringify(info, null, 2), info);
  },
);

server.registerTool(
  "list_windows",
  {
    title: "List visible Windows applications",
    description:
      "List visible top-level Windows application windows. Use this before coordinate-based actions.",
    inputSchema: {
      titleContains: z.string().max(200).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ titleContains }) =>
    safeToolCall(async () => {
      const windows = await listVisibleWindows();
      const needle = titleContains?.trim().toLowerCase();
      const filtered = needle
        ? windows.filter((window) => window.title.toLowerCase().includes(needle))
        : windows;
      return textResult(
        filtered.length > 0
          ? JSON.stringify(filtered, null, 2)
          : "No matching visible windows were found.",
        { windows: filtered },
      );
    }),
);

server.registerTool(
  "get_cursor_position",
  {
    title: "Get pointer position",
    description: "Return the current mouse pointer coordinates without changing the computer.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    safeToolCall(async () => {
      const position = await getCursorPosition();
      return textResult(JSON.stringify(position), position);
    }),
);

server.registerTool(
  "capture_screen",
  {
    title: "Capture the local screen",
    description:
      "Capture all Windows displays and return a PNG image. Avoid capturing secrets or private content.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async () =>
    safeToolCall(async () => {
      const capture = await captureScreen();
      return {
        content: [
          {
            type: "text" as const,
            text: `Captured ${capture.width}x${capture.height} at (${capture.left}, ${capture.top}).`,
          },
          {
            type: "image" as const,
            data: capture.data,
            mimeType: "image/png",
          },
        ],
      };
    }),
);

server.registerTool(
  "open_application",
  {
    title: "Open an allowlisted application",
    description:
      "Open Notepad, Calculator, Paint, or File Explorer. Requires local write actions to be enabled.",
    inputSchema: {
      application: z.enum(["notepad", "calculator", "paint", "explorer"]),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ application }) =>
    safeToolCall(async () => {
      requireWriteEnabled("open_application");
      await openApplication(application as AllowedApplication);
      return textResult(`Opened ${application}.`);
    }),
);

server.registerTool(
  "open_url",
  {
    title: "Open an HTTP URL",
    description:
      "Open a validated HTTP or HTTPS URL in the default browser. Honors TALK_AI_TOOLS_ALLOWED_HOSTS and requires write actions to be enabled.",
    inputSchema: {
      url: z.string().max(2_048),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ url }) =>
    safeToolCall(async () => {
      requireWriteEnabled("open_url");
      const validatedUrl = validateHttpUrl(url);
      await openUrl(validatedUrl);
      return textResult(`Opened ${validatedUrl.origin}.`);
    }),
);

server.registerTool(
  "click_screen",
  {
    title: "Click a screen coordinate",
    description:
      "Move the pointer to a screen coordinate and click. Inspect or capture the screen first. Requires write actions to be enabled.",
    inputSchema: {
      x: z.number().int(),
      y: z.number().int(),
      button: z.enum(["left", "right", "middle"]).default("left"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  async ({ x, y, button }) =>
    safeToolCall(async () => {
      requireWriteEnabled("click_screen");
      validateCoordinate(x, "x");
      validateCoordinate(y, "y");
      await clickScreen(x, y, button);
      return textResult(`Clicked ${button} at (${x}, ${y}).`);
    }),
);

server.registerTool(
  "type_text",
  {
    title: "Type text into the focused control",
    description:
      "Paste non-sensitive text into the currently focused control. Never use for passwords, tokens, payment data, or messages sent to other people. Requires write actions to be enabled.",
    inputSchema: {
      text: z.string().min(1).max(2_000),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  async ({ text }) =>
    safeToolCall(async () => {
      requireWriteEnabled("type_text");
      validateText(text);
      await typeText(text);
      return textResult(`Typed ${text.length} characters.`);
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("talk-with-ai local computer MCP server is ready");
